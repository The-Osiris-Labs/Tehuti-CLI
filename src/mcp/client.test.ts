import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
	const mockClients: Array<InstanceType<typeof MockClient>> = [];
	const mockTransports: Array<InstanceType<typeof MockTransport>> = [];
	const schemas = {
		PromptListChangedNotificationSchema: Symbol(
			"PromptListChangedNotificationSchema",
		),
		ResourceListChangedNotificationSchema: Symbol(
			"ResourceListChangedNotificationSchema",
		),
		ResourceUpdatedNotificationSchema: Symbol(
			"ResourceUpdatedNotificationSchema",
		),
		ToolListChangedNotificationSchema: Symbol(
			"ToolListChangedNotificationSchema",
		),
		CreateMessageRequestSchema: Symbol("CreateMessageRequestSchema"),
	};

	class MockTransport {
		onclose?: () => void;
		onerror?: (error: Error) => void;

		constructor(_options?: unknown) {
			mockTransports.push(this);
		}
	}

	class MockClient {
		onerror?: (error: Error) => void;
		onclose?: () => void;
		private handlers = new Map<unknown, (notification: any) => unknown>();

		connect = vi.fn(async (_transport: unknown) => {});
		getServerCapabilities = vi.fn(() => ({
			tools: { listChanged: true },
			resources: { listChanged: true, subscribe: true },
			prompts: { listChanged: true },
			logging: {},
		}));
		listTools = vi.fn(async () => ({
			tools: [{ name: "mock-tool", description: "", inputSchema: {} }],
		}));
		listResources = vi.fn(async () => ({
			resources: [{ uri: "resource://item", name: "Item" }],
		}));
		listPrompts = vi.fn(async () => ({ prompts: [] }));
		ping = vi.fn(async () => ({}));
		close = vi.fn(async () => {
			this.onclose?.();
		});
		callTool = vi.fn(async (_params: unknown) => ({
			content: "success",
		}));
		subscribeResource = vi.fn(async (_params: unknown) => ({}));
		unsubscribeResource = vi.fn(async (_params: unknown) => ({}));
		readResource = vi.fn(async ({ uri }: { uri: string }) => ({
			contents: [{ uri, text: "fresh content" }],
		}));
		setNotificationHandler = vi.fn(
			(schema: unknown, handler: (notification: any) => unknown) => {
				this.handlers.set(schema, handler);
			},
		);
		setRequestHandler = vi.fn(
			(schema: unknown, handler: (request: any) => unknown) => {
				this.handlers.set(schema, handler);
			},
		);

		constructor() {
			mockClients.push(this);
		}

		async trigger(schema: unknown, notification: any): Promise<void> {
			await this.handlers.get(schema)?.(notification);
		}
	}

	return {
		mockClients,
		mockTransports,
		schemas,
		MockClient,
		MockTransport,
	};
});

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
	Client: mocks.MockClient,
}));

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
	StdioClientTransport: mocks.MockTransport,
}));

vi.mock("@modelcontextprotocol/sdk/client/sse.js", () => ({
	SSEClientTransport: mocks.MockTransport,
}));

vi.mock("@modelcontextprotocol/sdk/types.js", () => mocks.schemas);

import { ResourceUpdatedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { MCPClientManager } from "./client.js";

describe("MCPClientManager", () => {
	let manager: MCPClientManager;

	const reconnectingConfig = {
		command: "mock-server",
		transport: "stdio",
		timeout: 100,
		reconnect: {
			enabled: true,
			maxAttempts: 2,
			delayMs: 1000,
			backoff: "linear",
		},
		healthCheck: {
			enabled: false,
			intervalMs: 500,
			timeoutMs: 100,
		},
		args: [],
		env: {},
		headers: {},
	} as const;

	beforeEach(() => {
		manager = new MCPClientManager();
		mocks.mockClients.length = 0;
		mocks.mockTransports.length = 0;
		vi.useFakeTimers();
	});

	afterEach(async () => {
		await manager.disconnectAll();
		vi.useRealTimers();
		vi.clearAllMocks();
	});

	it("schedules only one reconnect timer for repeated close events", async () => {
		await manager.connectServer("alpha", reconnectingConfig as any);

		mocks.mockTransports[0].onclose?.();
		mocks.mockTransports[0].onclose?.();

		expect(vi.getTimerCount()).toBe(1);

		await vi.advanceTimersByTimeAsync(1000);

		expect(mocks.mockClients).toHaveLength(2);
	});

	it("clears reconnect and health-check timers on disconnect", async () => {
		await manager.connectServer("alpha", {
			...reconnectingConfig,
			healthCheck: {
				enabled: true,
				intervalMs: 500,
				timeoutMs: 100,
			},
		} as any);

		expect(vi.getTimerCount()).toBe(1);

		mocks.mockTransports[0].onclose?.();
		expect(vi.getTimerCount()).toBe(1);

		await manager.disconnectServer("alpha");

		expect(vi.getTimerCount()).toBe(0);
		expect(manager.getServer("alpha")).toBeUndefined();
	});

	it("restores subscriptions after reconnect and dispatches resource updates", async () => {
		await manager.connectServer("alpha", reconnectingConfig as any);

		const callback = vi.fn();
		await manager.subscribeToResource("alpha", "resource://item", callback);

		expect(mocks.mockClients[0].subscribeResource).toHaveBeenCalledWith({
			uri: "resource://item",
		});

		mocks.mockTransports[0].onclose?.();
		await vi.advanceTimersByTimeAsync(1000);

		expect(mocks.mockClients).toHaveLength(2);
		expect(mocks.mockClients[1].subscribeResource).toHaveBeenCalledWith({
			uri: "resource://item",
		});

		await mocks.mockClients[1].trigger(ResourceUpdatedNotificationSchema, {
			method: "notifications/resources/updated",
			params: { uri: "resource://item" },
		});

		expect(callback).toHaveBeenCalledWith([
			{ uri: "resource://item", text: "fresh content" },
		]);
	});

	it("wraps execution errors and appends stderr details", async () => {
		await manager.connectServer("alpha", reconnectingConfig as any);
		const server = manager.getServer("alpha");
		expect(server).toBeDefined();
		const client = server?.client as any;
		expect(client).toBeDefined();

		client.callTool.mockRejectedValueOnce(new Error("Internal API Error"));

		if (server) {
			server.stderrBuffer = ["Process crashed\n", "Code 500\n"];
		}

		try {
			await manager.executeTool("alpha", "test-tool", { query: "hello" });
			expect.fail("Should have thrown");
		} catch (err: any) {
			expect(err.message).toContain(
				'MCP Tool "test-tool" on server "alpha" failed:',
			);
			expect(err.message).toContain("Internal API Error");
			expect(err.message).toContain("Arguments:");
			expect(err.message).toContain("Recent Server Stderr Output:");
			expect(err.message).toContain("Process crashed\nCode 500");
		}
	});
});
