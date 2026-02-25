import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { MCPServerConfig, TehutiConfig } from "../config/schema.js";
import { debug } from "../utils/debug.js";
import { createMCPError, MCPErrorCode } from "../utils/errors.js";

const DEFAULT_TIMEOUT = 30000;

function withTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
	operation: string,
): Promise<T> {
	let timeoutId: ReturnType<typeof setTimeout> | null = null;

	return Promise.race([
		promise.finally(() => {
			if (timeoutId) {
				clearTimeout(timeoutId);
				timeoutId = null;
			}
		}),
		new Promise<never>((_, reject) => {
			timeoutId = setTimeout(() => {
				reject(
					createMCPError(
						`${operation} timed out after ${timeoutMs}ms`,
						MCPErrorCode.TIMEOUT,
					),
				);
			}, timeoutMs);
		}),
	]);
}

export type ServerStatus =
	| "disconnected"
	| "connecting"
	| "connected"
	| "reconnecting"
	| "error"
	| "unhealthy";

export interface MCPServerInfo {
	name: string;
	config: MCPServerConfig;
	client: Client | null;
	transport: Transport | null;
	connected: boolean;
	status: ServerStatus;
	lastHealthCheck: Date | null;
	lastError: string | null;
	reconnectAttempts: number;
	tools: MCPTool[];
	resources: MCPResource[];
	prompts: MCPPrompt[];
	capabilities: ServerCapabilities;
}

export interface ServerCapabilities {
	tools: boolean;
	resources: boolean;
	prompts: boolean;
	logging: boolean;
}

export interface MCPTool {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
}

export interface MCPResource {
	uri: string;
	name: string;
	description?: string;
	mimeType?: string;
}

export interface MCPPrompt {
	name: string;
	description?: string;
	arguments?: Array<{
		name: string;
		description?: string;
		required?: boolean;
	}>;
}

export interface MCPPromptResult {
	description?: string;
	messages: Array<{
		role: "user" | "assistant";
		content: {
			type: "text" | "image" | "resource";
			text?: string;
			data?: string;
			mimeType?: string;
		};
	}>;
}

export interface ResourceSubscription {
	serverName: string;
	uri: string;
	callback: (content: unknown) => void;
}

export type SamplingHandler = (
	request: SamplingRequest,
) => Promise<SamplingResponse>;

export interface SamplingRequest {
	messages: Array<{
		role: "user" | "assistant";
		content: {
			type: "text" | "image";
			text?: string;
			data?: string;
			mimeType?: string;
		};
	}>;
	modelPreferences?: {
		hints?: Array<{ name?: string }>;
		costPriority?: number;
		speedPriority?: number;
		intelligencePriority?: number;
	};
	systemPrompt?: string;
	includeContext?: "none" | "thisServer" | "allServers";
	temperature?: number;
	maxTokens: number;
	stopSequences?: string[];
	metadata?: Record<string, unknown>;
}

export interface SamplingResponse {
	model: string;
	role: "assistant";
	content: {
		type: "text" | "image";
		text?: string;
		data?: string;
		mimeType?: string;
	};
	stopReason?: "endTurn" | "stopSequence" | "maxTokens";
}

type HealthCheckCallback = (serverName: string, healthy: boolean) => void;
type ToolRefreshCallback = (serverName: string, tools: MCPTool[]) => void;
type ConnectionStatusCallback = (
	serverName: string,
	status: ServerStatus,
) => void;

class MCPClientManager {
	private servers: Map<string, MCPServerInfo> = new Map();
	private healthCheckIntervals: Map<string, ReturnType<typeof setInterval>> =
		new Map();
	private subscriptions: Map<string, ResourceSubscription[]> = new Map();
	private healthCheckCallback: HealthCheckCallback | null = null;
	private toolRefreshCallback: ToolRefreshCallback | null = null;
	private statusCallback: ConnectionStatusCallback | null = null;
	private samplingHandler: SamplingHandler | null = null;

	onHealthCheck(callback: HealthCheckCallback): void {
		this.healthCheckCallback = callback;
	}

	onToolRefresh(callback: ToolRefreshCallback): void {
		this.toolRefreshCallback = callback;
	}

	onStatusChange(callback: ConnectionStatusCallback): void {
		this.statusCallback = callback;
	}

	setSamplingHandler(handler: SamplingHandler): void {
		this.samplingHandler = handler;
	}

	private updateStatus(info: MCPServerInfo, status: ServerStatus): void {
		info.status = status;
		this.statusCallback?.(info.name, status);
	}

	private async createTransport(config: MCPServerConfig): Promise<Transport> {
		const transportType = config.transport ?? "stdio";

		switch (transportType) {
			case "stdio": {
				if (!config.command) {
					throw createMCPError(
						"stdio transport requires 'command' field",
						MCPErrorCode.CONFIG_ERROR,
					);
				}
				return new StdioClientTransport({
					command: config.command,
					args: config.args ?? [],
					env: { ...process.env, ...config.env } as Record<string, string>,
				});
			}

			case "sse": {
				if (!config.url) {
					throw createMCPError(
						"sse transport requires 'url' field",
						MCPErrorCode.CONFIG_ERROR,
					);
				}
				return new SSEClientTransport(new URL(config.url), {
					requestInit: { headers: config.headers },
				});
			}

			case "http": {
				if (!config.url) {
					throw createMCPError(
						"http transport requires 'url' field",
						MCPErrorCode.CONFIG_ERROR,
					);
				}
				const { StreamableHTTPClientTransport } = await import(
					"@modelcontextprotocol/sdk/client/streamableHttp.js"
				);
				return new StreamableHTTPClientTransport(new URL(config.url), {
					requestInit: { headers: config.headers },
				});
			}

			case "websocket": {
				if (!config.url) {
					throw createMCPError(
						"websocket transport requires 'url' field",
						MCPErrorCode.CONFIG_ERROR,
					);
				}
				const { WebSocketClientTransport } = await import(
					"@modelcontextprotocol/sdk/client/websocket.js"
				);
				return new WebSocketClientTransport(new URL(config.url));
			}

			default:
				throw createMCPError(
					`Unknown transport type: ${transportType}`,
					MCPErrorCode.CONFIG_ERROR,
				);
		}
	}

	private setupTransportHandlers(info: MCPServerInfo): void {
		if (!info.transport) return;

		info.transport.onclose = () => {
			debug.log("mcp", `[${info.name}] Connection closed`);
			info.connected = false;
			this.updateStatus(info, "disconnected");
			this.handleReconnect(info.name);
		};

		info.transport.onerror = (error: Error) => {
			debug.log("mcp", `[${info.name}] Transport error:`, error);
			info.lastError = error.message;
			this.updateStatus(info, "error");
		};
	}

	private setupClientHandlers(info: MCPServerInfo): void {
		if (!info.client) return;

		info.client.onerror = (error: Error) => {
			debug.log("mcp", `[${info.name}] Client error:`, error);
			info.lastError = error.message;
		};

		info.client.onclose = () => {
			debug.log("mcp", `[${info.name}] Client closed`);
			info.connected = false;
			this.updateStatus(info, "disconnected");
		};
	}

	private async handleReconnect(serverName: string): Promise<void> {
		const info = this.servers.get(serverName);
		if (!info || !info.config.reconnect?.enabled) return;

		const {
			maxAttempts = 3,
			delayMs = 1000,
			backoff = "exponential",
		} = info.config.reconnect;

		if (info.reconnectAttempts >= maxAttempts) {
			debug.log("mcp", `[${serverName}] Max reconnect attempts reached`);
			this.updateStatus(info, "error");
			return;
		}

		this.updateStatus(info, "reconnecting");
		info.reconnectAttempts++;

		const delay =
			backoff === "exponential"
				? delayMs * 2 ** (info.reconnectAttempts - 1)
				: delayMs * info.reconnectAttempts;

		debug.log(
			"mcp",
			`[${serverName}] Reconnecting in ${delay}ms (attempt ${info.reconnectAttempts}/${maxAttempts})`,
		);

		await new Promise((resolve) => setTimeout(resolve, delay));

		try {
			await this.connectServer(serverName, info.config);
			info.reconnectAttempts = 0;
		} catch (error) {
			debug.log("mcp", `[${serverName}] Reconnect failed:`, error);
			await this.handleReconnect(serverName);
		}
	}

	async connectServer(
		name: string,
		config: MCPServerConfig,
	): Promise<MCPServerInfo> {
		debug.log("mcp", `Connecting to MCP server: ${name}`);

		const existing = this.servers.get(name);
		if (existing?.connected) {
			return existing;
		}

		const info: MCPServerInfo = {
			name,
			config,
			client: null,
			transport: null,
			connected: false,
			status: "connecting",
			lastHealthCheck: null,
			lastError: null,
			reconnectAttempts: existing?.reconnectAttempts ?? 0,
			tools: [],
			resources: [],
			prompts: [],
			capabilities: {
				tools: false,
				resources: false,
				prompts: false,
				logging: false,
			},
		};

		this.servers.set(name, info);
		this.statusCallback?.(name, "connecting");

		try {
			const transport = await this.createTransport(config);
			info.transport = transport;
			this.setupTransportHandlers(info);

			const capabilities: Record<string, unknown> = {};

			const client = new Client(
				{ name: "tehuti-cli", version: "0.1.0" },
				{ capabilities },
			);

			info.client = client;

			await withTimeout(
				client.connect(transport),
				config.timeout ?? DEFAULT_TIMEOUT,
				`Connect to ${name}`,
			);

			this.setupClientHandlers(info);

			info.connected = true;
			this.updateStatus(info, "connected");

			const serverCapabilities = client.getServerCapabilities();
			info.capabilities = {
				tools: !!serverCapabilities?.tools,
				resources: !!serverCapabilities?.resources,
				prompts: !!serverCapabilities?.prompts,
				logging: !!serverCapabilities?.logging,
			};

			await this.discoverCapabilities(info);

			if (config.healthCheck?.enabled) {
				this.startHealthCheck(name);
			}

			return info;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			debug.log("mcp", `Failed to connect to ${name}: ${message}`);
			info.lastError = message;
			this.updateStatus(info, "error");
			throw createMCPError(
				`Failed to connect to MCP server "${name}": ${message}`,
				MCPErrorCode.CONNECTION_FAILED,
			);
		}
	}

	private async discoverCapabilities(info: MCPServerInfo): Promise<void> {
		if (!info.client) return;

		if (info.capabilities.tools) {
			try {
				const toolsResult = await info.client.listTools();
				info.tools = this.filterTools(
					info.name,
					(toolsResult.tools as MCPTool[]).map((t) => ({
						name: t.name,
						description: t.description ?? "",
						inputSchema: t.inputSchema as Record<string, unknown>,
					})),
				);
				debug.log(
					"mcp",
					`Discovered ${info.tools.length} tools from ${info.name}`,
				);
			} catch (error) {
				debug.log("mcp", `No tools from ${info.name}: ${error}`);
			}
		}

		if (info.capabilities.resources) {
			try {
				const resourcesResult = await info.client.listResources();
				info.resources = (resourcesResult.resources as MCPResource[]).map(
					(r) => ({
						uri: r.uri,
						name: r.name,
						description: r.description,
						mimeType: r.mimeType,
					}),
				);
				debug.log(
					"mcp",
					`Discovered ${info.resources.length} resources from ${info.name}`,
				);
			} catch (error) {
				debug.log("mcp", `No resources from ${info.name}: ${error}`);
			}
		}

		if (info.capabilities.prompts) {
			try {
				const promptsResult = await info.client.listPrompts();
				info.prompts = (promptsResult.prompts as MCPPrompt[]).map((p) => ({
					name: p.name,
					description: p.description,
					arguments: p.arguments,
				}));
				debug.log(
					"mcp",
					`Discovered ${info.prompts.length} prompts from ${info.name}`,
				);
			} catch (error) {
				debug.log("mcp", `No prompts from ${info.name}: ${error}`);
			}
		}
	}

	private filterTools(serverName: string, tools: MCPTool[]): MCPTool[] {
		const config = this.servers.get(serverName)?.config;
		if (!config?.toolFilter) return tools;

		const { allowlist, denylist } = config.toolFilter;

		return tools.filter((tool) => {
			if (denylist?.length && denylist.includes(tool.name)) return false;
			if (allowlist?.length && !allowlist.includes(tool.name)) return false;
			return true;
		});
	}

	private startHealthCheck(serverName: string): void {
		const info = this.servers.get(serverName);
		if (!info) return;

		const { intervalMs = 30000, timeoutMs = 5000 } =
			info.config.healthCheck ?? {};

		const interval = setInterval(async () => {
			const server = this.servers.get(serverName);
			if (!server?.connected || !server.client) {
				this.updateStatus(server!, "disconnected");
				return;
			}

			try {
				await withTimeout(
					server.client.ping(),
					timeoutMs,
					`Health check ${serverName}`,
				);
				server.lastHealthCheck = new Date();
				this.updateStatus(server, "connected");
				this.healthCheckCallback?.(serverName, true);
			} catch (error) {
				debug.log("mcp", `[${serverName}] Health check failed:`, error);
				this.updateStatus(server, "unhealthy");
				this.healthCheckCallback?.(serverName, false);
			}
		}, intervalMs);

		this.healthCheckIntervals.set(serverName, interval);
	}

	private stopHealthCheck(serverName: string): void {
		const interval = this.healthCheckIntervals.get(serverName);
		if (interval) {
			clearInterval(interval);
			this.healthCheckIntervals.delete(serverName);
		}
	}

	async refreshTools(serverName: string): Promise<MCPTool[]> {
		const info = this.servers.get(serverName);
		if (!info?.client) return [];

		try {
			const toolsResult = await info.client.listTools();
			info.tools = this.filterTools(
				serverName,
				(toolsResult.tools as MCPTool[]).map((t) => ({
					name: t.name,
					description: t.description ?? "",
					inputSchema: t.inputSchema as Record<string, unknown>,
				})),
			);
			this.toolRefreshCallback?.(serverName, info.tools);
			return info.tools;
		} catch (error) {
			debug.log("mcp", `[${serverName}] Failed to refresh tools:`, error);
			return info.tools;
		}
	}

	async refreshResources(serverName: string): Promise<MCPResource[]> {
		const info = this.servers.get(serverName);
		if (!info?.client) return [];

		try {
			const resourcesResult = await info.client.listResources();
			info.resources = (resourcesResult.resources as MCPResource[]).map(
				(r) => ({
					uri: r.uri,
					name: r.name,
					description: r.description,
					mimeType: r.mimeType,
				}),
			);
			return info.resources;
		} catch (error) {
			debug.log("mcp", `[${serverName}] Failed to refresh resources:`, error);
			return info.resources;
		}
	}

	async refreshPrompts(serverName: string): Promise<MCPPrompt[]> {
		const info = this.servers.get(serverName);
		if (!info?.client) return [];

		try {
			const promptsResult = await info.client.listPrompts();
			info.prompts = (promptsResult.prompts as MCPPrompt[]).map((p) => ({
				name: p.name,
				description: p.description,
				arguments: p.arguments,
			}));
			return info.prompts;
		} catch (error) {
			debug.log("mcp", `[${serverName}] Failed to refresh prompts:`, error);
			return info.prompts;
		}
	}

	async subscribeToResource(
		serverName: string,
		uri: string,
		callback: (content: unknown) => void,
	): Promise<void> {
		const info = this.servers.get(serverName);
		if (!info?.client || !info.capabilities.resources) {
			throw createMCPError(
				`Server "${serverName}" does not support resources`,
				MCPErrorCode.CAPABILITY_NOT_SUPPORTED,
			);
		}

		await info.client.subscribeResource({ uri });

		const key = `${serverName}:${uri}`;
		if (!this.subscriptions.has(key)) {
			this.subscriptions.set(key, []);
		}
		this.subscriptions.get(key)?.push({ serverName, uri, callback });
	}

	async unsubscribeFromResource(
		serverName: string,
		uri: string,
	): Promise<void> {
		const info = this.servers.get(serverName);
		if (!info?.client) return;

		await info.client.unsubscribeResource({ uri });
		this.subscriptions.delete(`${serverName}:${uri}`);
	}

	async disconnectServer(name: string): Promise<void> {
		const info = this.servers.get(name);
		if (!info) return;

		this.stopHealthCheck(name);

		for (const key of this.subscriptions.keys()) {
			if (key.startsWith(`${name}:`)) {
				this.subscriptions.delete(key);
			}
		}

		if (info.client && info.connected) {
			try {
				await info.client.close();
			} catch (error) {
				debug.log("mcp", `Error closing ${name}: ${error}`);
			}
		}

		info.connected = false;
		info.client = null;
		info.transport = null;
		this.updateStatus(info, "disconnected");
		this.servers.delete(name);
		debug.log("mcp", `Disconnected from ${name}`);
	}

	async connectAll(config: TehutiConfig): Promise<Map<string, MCPServerInfo>> {
		if (!config.mcp?.enabled) {
			debug.log("mcp", "MCP disabled in config");
			return this.servers;
		}

		const servers = config.mcp.servers ?? {};
		const connectionPromises: Promise<void>[] = [];

		for (const [name, serverConfig] of Object.entries(servers)) {
			if (serverConfig.disabled) {
				debug.log("mcp", `Skipping disabled server: ${name}`);
				continue;
			}

			connectionPromises.push(
				this.connectServer(name, serverConfig)
					.then(() => {})
					.catch((error) => {
						debug.log("mcp", `Failed to connect to ${name}: ${error}`);
					}),
			);
		}

		await Promise.allSettled(connectionPromises);
		return this.servers;
	}

	async disconnectAll(): Promise<void> {
		const disconnectionPromises = Array.from(this.servers.keys()).map((name) =>
			this.disconnectServer(name),
		);
		await Promise.all(disconnectionPromises);
	}

	getServer(name: string): MCPServerInfo | undefined {
		return this.servers.get(name);
	}

	getAllServers(): MCPServerInfo[] {
		return Array.from(this.servers.values());
	}

	getConnectedServers(): MCPServerInfo[] {
		return this.getAllServers().filter((s) => s.connected);
	}

	getServerStatus(name: string): ServerStatus | undefined {
		return this.servers.get(name)?.status;
	}

	getAllServerStatuses(): Array<{
		name: string;
		status: ServerStatus;
		lastError?: string;
	}> {
		return this.getAllServers().map((s) => ({
			name: s.name,
			status: s.status,
			lastError: s.lastError ?? undefined,
		}));
	}

	getAllTools(): Array<{ serverName: string; tool: MCPTool }> {
		const tools: Array<{ serverName: string; tool: MCPTool }> = [];

		for (const info of this.getConnectedServers()) {
			for (const tool of info.tools) {
				tools.push({ serverName: info.name, tool });
			}
		}

		return tools;
	}

	getAllPrompts(): Array<{ serverName: string; prompt: MCPPrompt }> {
		const prompts: Array<{ serverName: string; prompt: MCPPrompt }> = [];

		for (const info of this.getConnectedServers()) {
			for (const prompt of info.prompts) {
				prompts.push({ serverName: info.name, prompt });
			}
		}

		return prompts;
	}

	async executeTool(
		serverName: string,
		toolName: string,
		args: Record<string, unknown>,
		timeout?: number,
	): Promise<unknown> {
		const info = this.servers.get(serverName);

		if (!info || !info.connected || !info.client) {
			throw createMCPError(
				`Server "${serverName}" not connected`,
				MCPErrorCode.SERVER_NOT_CONNECTED,
			);
		}

		const toolConfig = info.config.toolFilter;
		if (toolConfig?.denylist?.includes(toolName)) {
			throw createMCPError(
				`Tool "${toolName}" is denied on server "${serverName}"`,
				MCPErrorCode.TOOL_DENIED,
			);
		}
		if (
			toolConfig?.allowlist?.length &&
			!toolConfig.allowlist.includes(toolName)
		) {
			throw createMCPError(
				`Tool "${toolName}" is not allowed on server "${serverName}"`,
				MCPErrorCode.TOOL_NOT_ALLOWED,
			);
		}

		debug.log("mcp", `Executing tool ${toolName} on ${serverName}`);

		try {
			const result = await withTimeout(
				info.client.callTool({
					name: toolName,
					arguments: args,
				}),
				timeout ?? info.config.timeout ?? DEFAULT_TIMEOUT,
				`Tool ${toolName} on ${serverName}`,
			);

			return result.content;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			info.lastError = message;
			throw createMCPError(
				`Tool execution failed: ${message}`,
				MCPErrorCode.TOOL_EXECUTION_FAILED,
			);
		}
	}

	async readResource(
		serverName: string,
		uri: string,
		timeout?: number,
	): Promise<unknown> {
		const info = this.servers.get(serverName);

		if (!info || !info.connected || !info.client) {
			throw createMCPError(
				`Server "${serverName}" not connected`,
				MCPErrorCode.SERVER_NOT_CONNECTED,
			);
		}

		try {
			const result = await withTimeout(
				info.client.readResource({ uri }),
				timeout ?? info.config.timeout ?? DEFAULT_TIMEOUT,
				`Read resource ${uri} on ${serverName}`,
			);
			return result.contents;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw createMCPError(
				`Resource read failed: ${message}`,
				MCPErrorCode.RESOURCE_READ_FAILED,
			);
		}
	}

	async getPrompt(
		serverName: string,
		promptName: string,
		args?: Record<string, string>,
		timeout?: number,
	): Promise<MCPPromptResult> {
		const info = this.servers.get(serverName);

		if (!info || !info.connected || !info.client) {
			throw createMCPError(
				`Server "${serverName}" not connected`,
				MCPErrorCode.SERVER_NOT_CONNECTED,
			);
		}

		debug.log("mcp", `Getting prompt ${promptName} from ${serverName}`);

		try {
			const result = await withTimeout(
				info.client.getPrompt({
					name: promptName,
					arguments: args,
				}),
				timeout ?? info.config.timeout ?? DEFAULT_TIMEOUT,
				`Get prompt ${promptName} on ${serverName}`,
			);

			return result as MCPPromptResult;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw createMCPError(
				`Prompt retrieval failed: ${message}`,
				MCPErrorCode.PROMPT_RETRIEVAL_FAILED,
			);
		}
	}
}

export const mcpManager = new MCPClientManager();
export default mcpManager;
