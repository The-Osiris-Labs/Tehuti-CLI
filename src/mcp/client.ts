import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
	type CreateMessageRequestParams,
	CreateMessageRequestSchema,
	type CreateMessageResult,
	PromptListChangedNotificationSchema,
	ResourceListChangedNotificationSchema,
	ResourceUpdatedNotificationSchema,
	ToolListChangedNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { MCPServerConfig, TehutiConfig } from "../config/schema.js";
import { createLogger } from '../utils/structured-logger.js';
import {
	createMCPError,
	MCPErrorCode,
	registerCleanupHandler,
} from "../utils/errors.js";
import { metrics } from "../utils/metrics.js";

const log = createLogger('mcp');

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
	stderrBuffer?: string[];
	_stderrListener?: (chunk: Buffer | string) => void;
	_stderrStream?: NodeJS.ReadableStream & { on: Function; off: Function };
	samplingDepth: number;
	samplingRequests: number;
	samplingResetTime: number;
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
	request: CreateMessageRequestParams,
	serverName: string,
) => Promise<CreateMessageResult>;

type HealthCheckCallback = (serverName: string, healthy: boolean) => void;
type ToolRefreshCallback = (serverName: string, tools: MCPTool[]) => void;
type ConnectionStatusCallback = (
	serverName: string,
	status: ServerStatus,
) => void;

export class MCPClientManager {
	private servers: Map<string, MCPServerInfo> = new Map();
	private healthCheckIntervals: Map<string, ReturnType<typeof setTimeout>> =
		new Map();
	private reconnectTimeouts: Map<string, ReturnType<typeof setTimeout>> =
		new Map();
	private subscriptions: Map<string, ResourceSubscription[]> = new Map();
	private healthCheckCallback: HealthCheckCallback | null = null;
	private toolRefreshCallback: ToolRefreshCallback | null = null;
	private statusCallback: ConnectionStatusCallback | null = null;
	private samplingHandler: SamplingHandler | null = null;
	private intentionalDisconnects: Set<string> = new Set();

	// Infinite loop protection for sampling
	private readonly MAX_SAMPLING_DEPTH = 3;
	private readonly MAX_SAMPLING_PER_MINUTE = 15;

	constructor() {
		// Register a global exit handler to send SIGTERM to child processes synchronously when process exits
		process.on("exit", () => {
			for (const server of this.servers.values()) {
				let pid: number | undefined;

				if (server.transport) {
					// StdioClientTransport exposes child process as _process (not on Transport interface)
					if ("_process" in server.transport) {
						const proc = server.transport as unknown as { _process?: { pid?: number } };
						if (proc._process && typeof proc._process.pid === "number") {
							pid = proc._process.pid;
						}
					} else if ("pid" in server.transport) {
						// Some transports expose pid directly
						const p = server.transport as unknown as { pid?: number };
						if (p.pid && typeof p.pid === "number") {
							pid = p.pid;
						}
					}
				}

				if (pid !== undefined) {
					try {
						process.kill(pid, "SIGTERM");
					} catch {
						log.warn(`Failed to kill MCP process ${pid} on exit (already dead)`);
					}
				}
			}
		});

		// Register an async cleanup handler to perform graceful disconnects on terminal signals/crashes
		registerCleanupHandler(async () => {
			await this.disconnectAll();
		});
	}

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
					stderr: "pipe",
				});
			}

			case "sse": {
				if (!config.url) {
					throw createMCPError(
						"sse transport requires 'url' field",
						MCPErrorCode.CONFIG_ERROR,
					);
				}
				// SSEClientTransport accepts custom headers via eventSourceInit (not in standard EventSourceInit)
				const sseOptions = { headers: config.headers } as EventSourceInit & { headers?: Record<string, string> };
				return new SSEClientTransport(new URL(config.url), {
					eventSourceInit: sseOptions,
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
				const reconnectOpts = config.reconnect ?? { enabled: true };
				const initialDelay = reconnectOpts.delayMs ?? 1000;
				const maxRetries = reconnectOpts.enabled
					? (reconnectOpts.maxAttempts ?? 3)
					: 0;

				return new StreamableHTTPClientTransport(new URL(config.url), {
					requestInit: { headers: config.headers },
					reconnectionOptions: {
						initialReconnectionDelay: initialDelay,
						maxReconnectionDelay:
							initialDelay *
							(reconnectOpts.backoff === "exponential"
								? 1.5 ** maxRetries
								: maxRetries),
						reconnectionDelayGrowFactor:
							reconnectOpts.backoff === "exponential" ? 1.5 : 1.0,
						maxRetries: maxRetries,
					},
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

		if ("stderr" in info.transport) {
			// StdioClientTransport exposes stderr stream (not on Transport interface)
			const stdioTransport = info.transport as unknown as { stderr?: NodeJS.ReadableStream & { on: Function; off: Function } };
			const stderrStream = stdioTransport.stderr;
			info.stderrBuffer = [];

			const onData = (chunk: Buffer | string) => {
				const data = chunk.toString();
				log.debug(`[${info.name}] stderr: ${data.trim()}`);
				if (!info.stderrBuffer) {
					info.stderrBuffer = [];
				}
				info.stderrBuffer.push(data);
				if (info.stderrBuffer.length > 50) {
					info.stderrBuffer.shift();
				}
			};

		if (stderrStream) {
				stderrStream.on("data", onData);

				// Store the listener so we can clean it up on close or disconnect
				info._stderrListener = onData;
				info._stderrStream = stderrStream;
			}
		}

		info.transport.onclose = () => {
			log.info(`[${info.name}] Connection closed`);
			this.stopHealthCheck(info.name);
			info.connected = false;
			this.updateStatus(info, "disconnected");
			this.scheduleReconnect(info.name);

			if (info._stderrStream && info._stderrListener) {
				try {
					info._stderrStream.off(
						"data",
						info._stderrListener,
					);
				} catch {
					log.warn(`Failed to remove stderr listener for ${info.name}`);
				}
				info._stderrListener = undefined;
				info._stderrStream = undefined;
			}
		};

		info.transport.onerror = (error: Error) => {
			log.error(`[${info.name}] Transport error: ${error.message}`);
			info.lastError = error.message;
			this.updateStatus(info, "error");
		};
	}

	private setupClientHandlers(info: MCPServerInfo): void {
		if (!info.client) return;

		info.client.onerror = (error: Error) => {
			log.error(`[${info.name}] Client error: ${error.message}`);
			info.lastError = error.message;
		};

		info.client.onclose = () => {
			log.info(`[${info.name}] Client closed`);
			this.stopHealthCheck(info.name);
			info.connected = false;
			this.updateStatus(info, "disconnected");
			this.scheduleReconnect(info.name);
		};

		info.client.setNotificationHandler(
			ToolListChangedNotificationSchema,
			async () => {
				await this.refreshTools(info.name);
			},
		);

		info.client.setNotificationHandler(
			PromptListChangedNotificationSchema,
			async () => {
				await this.refreshPrompts(info.name);
			},
		);

		info.client.setNotificationHandler(
			ResourceListChangedNotificationSchema,
			async () => {
				await this.refreshResources(info.name);
			},
		);

		info.client.setNotificationHandler(
			ResourceUpdatedNotificationSchema,
			async (notification) => {
				await this.handleResourceUpdated(info.name, notification.params.uri);
			},
		);

		info.client.setRequestHandler(
			CreateMessageRequestSchema,
			async (request) => {
				if (!this.samplingHandler) {
					throw new Error("Sampling handler not configured");
				}

				// Protect against infinite sampling loops
				const now = Date.now();
				if (now - info.samplingResetTime > 60000) {
					info.samplingResetTime = now;
					info.samplingRequests = 0;
				}

				if (info.samplingRequests >= this.MAX_SAMPLING_PER_MINUTE) {
					throw new Error(
						`Sampling rate limit exceeded: max ${this.MAX_SAMPLING_PER_MINUTE} requests per minute`,
					);
				}

				if (info.samplingDepth >= this.MAX_SAMPLING_DEPTH) {
					throw new Error(
						`Sampling depth limit exceeded: max ${this.MAX_SAMPLING_DEPTH} concurrent/nested requests`,
					);
				}

				info.samplingRequests++;
				info.samplingDepth++;
				try {
					return await this.samplingHandler(request.params, info.name);
				} finally {
					info.samplingDepth--;
				}
			},
		);
	}

	private clearReconnectTimeout(serverName: string): void {
		const timeout = this.reconnectTimeouts.get(serverName);
		if (timeout) {
			clearTimeout(timeout);
			this.reconnectTimeouts.delete(serverName);
		}
	}

	private scheduleReconnect(serverName: string): void {
		const info = this.servers.get(serverName);
		if (
			!info?.config.reconnect?.enabled ||
			this.intentionalDisconnects.has(serverName) ||
			this.reconnectTimeouts.has(serverName)
		) {
			return;
		}

		const {
			maxAttempts = 3,
			delayMs = 1000,
			backoff = "exponential",
		} = info.config.reconnect;

		if (info.reconnectAttempts >= maxAttempts) {
			log.warn(`[${serverName}] Max reconnect attempts reached`);
			this.updateStatus(info, "error");
			return;
		}

		this.updateStatus(info, "reconnecting");
		info.reconnectAttempts++;

		const delay =
			backoff === "exponential"
				? delayMs * 2 ** (info.reconnectAttempts - 1)
				: delayMs * info.reconnectAttempts;

		log.info(`[${serverName}] Reconnecting in ${delay}ms (attempt ${info.reconnectAttempts}/${maxAttempts})`);

		const timeout = setTimeout(async () => {
			this.reconnectTimeouts.delete(serverName);

			if (this.intentionalDisconnects.has(serverName)) {
				return;
			}

			const currentInfo = this.servers.get(serverName);
			if (!currentInfo) {
				return;
			}

			try {
				await this.connectServer(serverName, currentInfo.config);
				const refreshedInfo = this.servers.get(serverName);
				if (refreshedInfo) {
					refreshedInfo.reconnectAttempts = 0;
				}
			} catch (error) {
				log.error(`[${serverName}] Reconnect failed: ${error instanceof Error ? error.message : String(error)}`);
				this.scheduleReconnect(serverName);
			}
		}, delay);

		this.reconnectTimeouts.set(serverName, timeout);
	}

	private getMatchingSubscriptions(
		serverName: string,
		uri: string,
	): ResourceSubscription[] {
		const matches: ResourceSubscription[] = [];

		for (const subscriptions of this.subscriptions.values()) {
			for (const subscription of subscriptions) {
				if (subscription.serverName !== serverName) {
					continue;
				}

				if (subscription.uri === uri || uri.startsWith(subscription.uri)) {
					matches.push(subscription);
				}
			}
		}

		return matches;
	}

	private async handleResourceUpdated(
		serverName: string,
		uri: string,
	): Promise<void> {
		const subscriptions = this.getMatchingSubscriptions(serverName, uri);
		if (subscriptions.length === 0) {
			return;
		}

		try {
			const content = await this.readResource(serverName, uri);
			for (const subscription of subscriptions) {
				subscription.callback(content);
			}
		} catch (error) {
			log.error(`[${serverName}] Failed to refresh resource ${uri}: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	private async restoreSubscriptions(serverName: string): Promise<void> {
		const info = this.servers.get(serverName);
		if (!info?.client) return;
		const serverPrefix = `${serverName}:`;
		const restoredUris = new Set<string>();

		for (const [key, subscriptions] of this.subscriptions.entries()) {
			if (!key.startsWith(serverPrefix) || subscriptions.length === 0) {
				continue;
			}
			for (const subscription of subscriptions) {
				if (restoredUris.has(subscription.uri)) {
					continue;
				}
				restoredUris.add(subscription.uri);
				try {
					await info.client.subscribeResource({ uri: subscription.uri });
				} catch (error) {
					log.warn(`[${serverName}] Failed to restore subscription ${subscription.uri}: ${error instanceof Error ? error.message : String(error)}`);
				}
			}
		}
	}

	private connectionPromises = new Map<string, Promise<MCPServerInfo>>();

	async connectServer(
		name: string,
		config: MCPServerConfig,
	): Promise<MCPServerInfo> {
		if (this.connectionPromises.has(name)) {
			return this.connectionPromises.get(name)!;
		}

		const promise = this._connectServer(name, config);
		this.connectionPromises.set(name, promise);

		try {
			return await promise;
		} finally {
			this.connectionPromises.delete(name);
		}
	}

	private async _connectServer(
		name: string,
		config: MCPServerConfig,
	): Promise<MCPServerInfo> {
		log.info(`Connecting to MCP server: ${name}`);

		const existing = this.servers.get(name);
		if (existing?.connected) {
			return existing;
		}

		this.intentionalDisconnects.delete(name);
		this.clearReconnectTimeout(name);
		this.stopHealthCheck(name);

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
			samplingDepth: 0,
			samplingRequests: 0,
			samplingResetTime: Date.now(),
		};

		this.servers.set(name, info);
		this.statusCallback?.(name, "connecting");

		try {
			const transport = await this.createTransport(config);
			info.transport = transport;
			this.setupTransportHandlers(info);

			const capabilities: Record<string, unknown> = { sampling: {} };

			const client = new Client(
				{ name: "tehuti-cli", version: "1.2.1" },
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
			metrics.counter('mcp.connection', { server: name });

			const serverCapabilities = client.getServerCapabilities();
			info.capabilities = {
				tools: !!serverCapabilities?.tools,
				resources: !!serverCapabilities?.resources,
				prompts: !!serverCapabilities?.prompts,
				logging: !!serverCapabilities?.logging,
			};

			await this.discoverCapabilities(info);
			await this.restoreSubscriptions(name);

			if (config.healthCheck?.enabled) {
				this.startHealthCheck(name);
			}

			return info;
	} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			log.error(`Failed to connect to ${name}: ${message}`);
			info.lastError = message;
			this.stopHealthCheck(name);
			this.updateStatus(info, "error");
			// Clean up orphaned transport to prevent child process / socket leaks
			if (info.transport) {
				try { await info.transport.close(); } catch {
					log.warn(`Failed to close transport for ${name} during error recovery`);
				}
				info.transport = null;
			}
			// Automatic reconnection with exponential backoff
			if (info.reconnectAttempts < (config.reconnect?.maxAttempts ?? 3)) {
				info.reconnectAttempts++;
				const delay = 1000 * info.reconnectAttempts;
				log.info(`[${name}] Scheduling reconnect attempt ${info.reconnectAttempts} in ${delay}ms`);
				setTimeout(() => this.connectServer(name, config), delay);
			}
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
				const toolsResult = await withTimeout(
					info.client.listTools(),
					info.config.timeout ?? DEFAULT_TIMEOUT,
					`List tools on ${info.name}`,
				);
				info.tools = this.filterTools(
					info.name,
					(toolsResult.tools as MCPTool[]).map((t) => ({
						name: t.name,
						description: t.description ?? "",
						inputSchema: t.inputSchema as Record<string, unknown>,
					})),
				);
				log.info(`Discovered ${info.tools.length} tools from ${info.name}`);
			} catch (error) {
				log.debug(`No tools from ${info.name}: ${error instanceof Error ? error.message : String(error)}`);
			}
		}

		if (info.capabilities.resources) {
			try {
				const resourcesResult = await withTimeout(
					info.client.listResources(),
					info.config.timeout ?? DEFAULT_TIMEOUT,
					`List resources on ${info.name}`,
				);
				info.resources = (resourcesResult.resources as MCPResource[]).map(
					(r) => ({
						uri: r.uri,
						name: r.name,
						description: r.description,
						mimeType: r.mimeType,
					}),
				);
				log.info(`Discovered ${info.resources.length} resources from ${info.name}`);
			} catch (error) {
				log.debug(`No resources from ${info.name}: ${error instanceof Error ? error.message : String(error)}`);
			}
		}

		if (info.capabilities.prompts) {
			try {
				const promptsResult = await withTimeout(
					info.client.listPrompts(),
					info.config.timeout ?? DEFAULT_TIMEOUT,
					`List prompts on ${info.name}`,
				);
				info.prompts = (promptsResult.prompts as MCPPrompt[]).map((p) => ({
					name: p.name,
					description: p.description,
					arguments: p.arguments,
				}));
				log.info(`Discovered ${info.prompts.length} prompts from ${info.name}`);
			} catch (error) {
				log.debug(`No prompts from ${info.name}: ${error instanceof Error ? error.message : String(error)}`);
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
		this.stopHealthCheck(serverName);

		const { intervalMs = 30000, timeoutMs = 5000 } =
			info.config.healthCheck ?? {};

		const runCheck = async () => {
			const server = this.servers.get(serverName);
			if (!server) {
				this.stopHealthCheck(serverName);
				return;
			}

			if (!server.connected || !server.client) {
				this.updateStatus(server, "disconnected");
			} else {
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
					log.error(`[${serverName}] Health check failed: ${error instanceof Error ? error.message : String(error)}`);
					this.updateStatus(server, "unhealthy");
					this.healthCheckCallback?.(serverName, false);
				}
			}
			const timeout = setTimeout(runCheck, intervalMs);
			this.healthCheckIntervals.set(serverName, timeout);
		};

		const initialTimeout = setTimeout(runCheck, intervalMs);
		this.healthCheckIntervals.set(serverName, initialTimeout);
	}

	private stopHealthCheck(serverName: string): void {
		const interval = this.healthCheckIntervals.get(serverName);
		if (interval) {
			clearTimeout(interval);
			this.healthCheckIntervals.delete(serverName);
		}
	}

	async refreshTools(serverName: string): Promise<MCPTool[]> {
		const info = this.servers.get(serverName);
		if (!info?.client) return [];

		try {
			const toolsResult = await withTimeout(
				info.client.listTools(),
				info.config.timeout ?? DEFAULT_TIMEOUT,
				`Refresh tools on ${serverName}`,
			);
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
			log.error(`[${serverName}] Failed to refresh tools: ${error instanceof Error ? error.message : String(error)}`);
			return info.tools;
		}
	}

	async refreshResources(serverName: string): Promise<MCPResource[]> {
		const info = this.servers.get(serverName);
		if (!info?.client) return [];

		try {
			const resourcesResult = await withTimeout(
				info.client.listResources(),
				info.config.timeout ?? DEFAULT_TIMEOUT,
				`Refresh resources on ${serverName}`,
			);
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
			log.error(`[${serverName}] Failed to refresh resources: ${error instanceof Error ? error.message : String(error)}`);
			return info.resources;
		}
	}

	async refreshPrompts(serverName: string): Promise<MCPPrompt[]> {
		const info = this.servers.get(serverName);
		if (!info?.client) return [];

		try {
			const promptsResult = await withTimeout(
				info.client.listPrompts(),
				info.config.timeout ?? DEFAULT_TIMEOUT,
				`Refresh prompts on ${serverName}`,
			);
			info.prompts = (promptsResult.prompts as MCPPrompt[]).map((p) => ({
				name: p.name,
				description: p.description,
				arguments: p.arguments,
			}));
			return info.prompts;
		} catch (error) {
			log.error(`[${serverName}] Failed to refresh prompts: ${error instanceof Error ? error.message : String(error)}`);
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

		const key = `${serverName}:${uri}`;
		const subscriptions = this.subscriptions.get(key) ?? [];

		if (subscriptions.length === 0) {
			await info.client.subscribeResource({ uri });
		}

		subscriptions.push({ serverName, uri, callback });
		this.subscriptions.set(key, subscriptions);
	}

	async unsubscribeFromResource(
		serverName: string,
		uri: string,
		callback?: (content: unknown) => void,
	): Promise<void> {
		const key = `${serverName}:${uri}`;
		const subscriptions = this.subscriptions.get(key) ?? [];

		let updatedSubscriptions = subscriptions;
		if (callback) {
			updatedSubscriptions = subscriptions.filter(
				(s) => s.callback !== callback,
			);
		} else {
			updatedSubscriptions = [];
		}

		if (updatedSubscriptions.length === 0) {
			this.subscriptions.delete(key);
			const info = this.servers.get(serverName);
			if (info?.client && info.connected) {
				try {
					await info.client.unsubscribeResource({ uri });
				} catch {
					log.warn(`Failed to unsubscribe resource ${uri} from ${serverName}`);
				}
			}
		} else {
			this.subscriptions.set(key, updatedSubscriptions);
		}
	}

	async disconnectServer(name: string): Promise<void> {
		const info = this.servers.get(name);
		if (!info) return;

		this.intentionalDisconnects.add(name);
		this.stopHealthCheck(name);
		this.clearReconnectTimeout(name);

		for (const key of this.subscriptions.keys()) {
			if (key.startsWith(`${name}:`)) {
				this.subscriptions.delete(key);
			}
		}

		if (info._stderrStream && info._stderrListener) {
			try {
				info._stderrStream.off("data", info._stderrListener);
			} catch {
				log.warn(`Failed to remove stderr listener for ${name}`);
			}
			info._stderrListener = undefined;
			info._stderrStream = undefined;
		}

		// HTTPClientTransport exposes terminateSession — not on Transport interface
		if (
			info.transport &&
			"terminateSession" in info.transport
		) {
			const httpTransport = info.transport as { terminateSession: () => Promise<void> };
			if (typeof httpTransport.terminateSession === "function") {
				try {
					await httpTransport.terminateSession();
				} catch (error) {
					log.error(`Error terminating HTTP session for ${name}: ${error instanceof Error ? error.message : String(error)}`);
				}
			}
		}

		if (info.transport) {
			info.transport.onclose = undefined;
			info.transport.onerror = undefined;
		}
		if (info.client) {
			info.client.onclose = undefined;
			info.client.onerror = undefined;
			try {
				await info.client.close();
			} catch (error) {
				log.error(`Error closing ${name}: ${error instanceof Error ? error.message : String(error)}`);
			}
		}

		info.connected = false;
		info.client = null;
		info.transport = null;
		info.stderrBuffer = undefined;
		this.updateStatus(info, "disconnected");
		this.servers.delete(name);
		this.intentionalDisconnects.delete(name);
		log.info(`Disconnected from ${name}`);
	}

	async connectAll(config: TehutiConfig): Promise<Map<string, MCPServerInfo>> {
		if (!config.mcp?.enabled) {
			log.info("MCP disabled in config");
			return this.servers;
		}

		const servers = config.mcp.servers ?? {};
		const connectionPromises: Promise<void>[] = [];

		for (const [name, serverConfig] of Object.entries(servers)) {
			if (serverConfig.disabled) {
				log.debug(`Skipping disabled server: ${name}`);
				continue;
			}

			connectionPromises.push(
				this.connectServer(name, serverConfig)
					.then(() => {})
					.catch((error) => {
						log.error(`Failed to connect to ${name}: ${error instanceof Error ? error.message : String(error)}`);
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

		if (!info?.connected || !info.client) {
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
		log.info(`Executing tool ${toolName} on ${serverName}`);

		const startTime = Date.now();
		try {
			const result = await withTimeout(
				info.client.callTool({
					name: toolName,
					arguments: args,
				}),
				timeout ?? info.config.timeout ?? DEFAULT_TIMEOUT,
				`Tool ${toolName} on ${serverName}`,
			);

			metrics.histogram('mcp.tool.duration', Date.now() - startTime, { tool: toolName });
			return result;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			info.lastError = message;

			let wrappedMessage = `MCP Tool "${toolName}" on server "${serverName}" failed: ${message}`;
			wrappedMessage += `\nArguments: ${JSON.stringify(args, null, 2)}`;

			if (info.stderrBuffer && info.stderrBuffer.length > 0) {
				const recentStderr = info.stderrBuffer.join("").trim();
				if (recentStderr) {
					wrappedMessage += `\n\nRecent Server Stderr Output:\n${recentStderr}`;
				}
			}

			throw createMCPError(
				wrappedMessage,
				MCPErrorCode.TOOL_EXECUTION_FAILED,
				serverName,
			);
		}
	}

	async readResource(
		serverName: string,
		uri: string,
		timeout?: number,
	): Promise<unknown> {
		const info = this.servers.get(serverName);

		if (!info?.connected || !info.client) {
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

		if (!info?.connected || !info.client) {
			throw createMCPError(
				`Server "${serverName}" not connected`,
				MCPErrorCode.SERVER_NOT_CONNECTED,
			);
		}

		log.info(`Getting prompt ${promptName} from ${serverName}`);

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

