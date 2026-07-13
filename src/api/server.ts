/**
 * Tehuti Public API Server
 *
 * HTTP API server for programmatic access to Tehuti functionality.
 * Provides RESTful endpoints for agent operations, sessions, and configuration.
 */

import { type Server, createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { URL } from "node:url";
import { logger } from "../utils/logger.js";
import { getTelemetry } from "../utils/telemetry.js";

export interface APIServerConfig {
	port: number;
	host?: string;
	apiKey?: string;
	cors?: boolean;
}

export interface APIRequest {
	method: string;
	path: string;
	query: Record<string, string>;
	headers: Record<string, string | string[] | undefined>;
	body?: unknown;
}

export interface APIResponse {
	status: number;
	body: unknown;
	headers?: Record<string, string>;
}

export interface RouteHandler {
	method: string;
	path: string;
	handler: (req: APIRequest) => Promise<APIResponse>;
}

class APIServer {
	private server: ReturnType<typeof createServer> | null = null;
	private config: APIServerConfig;
	private routes: RouteHandler[] = [];
	private running = false;

	constructor(config: APIServerConfig) {
		this.config = {
			host: "127.0.0.1",
			cors: false,
			...config,
		};
		this.registerDefaultRoutes();
	}

	/**
	 * Register a route handler
	 */
	route(method: string, path: string, handler: (req: APIRequest) => Promise<APIResponse>): void {
		this.routes.push({ method: method.toUpperCase(), path, handler });
	}

	/**
	 * Start the API server
	 */
	async start(): Promise<void> {
		if (this.running) {
			throw new Error("API server is already running");
		}

		return new Promise((resolve, reject) => {
			this.server = createServer(async (req, res) => {
				try {
					await this.handleRequest(req, res);
				} catch (error) {
					logger.error("API server error:", error);
					this.sendError(res, 500, "Internal server error");
				}
			});

			this.server.listen(this.config.port, this.config.host, () => {
				this.running = true;
				logger.success(`API server started on ${this.config.host}:${this.config.port}`);
				resolve();
			});

			this.server.on("error", (error) => {
				logger.error("API server failed to start:", error);
				reject(error);
			});
		});
	}

	/**
	 * Stop the API server
	 */
	async stop(): Promise<void> {
		if (!this.running || !this.server) {
			return;
		}

		return new Promise((resolve) => {
			this.server!.close(() => {
				this.running = false;
				this.server = null;
				logger.info("API server stopped");
				resolve();
			});
		});
	}

	/**
	 * Check if server is running
	 */
	isRunning(): boolean {
		return this.running;
	}

	/**
	 * Handle incoming HTTP request
	 */
	private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
		const startTime = Date.now();
		const url = new URL(req.url || "/", `http://${req.headers.host}`);

		// Parse request
		const apiReq: APIRequest = {
			method: req.method || "GET",
			path: url.pathname,
			query: Object.fromEntries(url.searchParams),
			headers: req.headers,
		};

		// Parse body for POST/PUT/PATCH
		if (["POST", "PUT", "PATCH"].includes(apiReq.method)) {
			apiReq.body = await this.parseBody(req);
		}

		// Authenticate
		if (this.config.apiKey) {
			const authHeader = req.headers.authorization;
			const apiKey = req.headers["x-api-key"];

			if (authHeader !== `Bearer ${this.config.apiKey}` && apiKey !== this.config.apiKey) {
				this.sendError(res, 401, "Unauthorized");
				return;
			}
		}

		// CORS headers
		if (this.config.cors) {
			res.setHeader("Access-Control-Allow-Origin", "*");
			res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
			res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-API-Key");

			if (apiReq.method === "OPTIONS") {
				res.writeHead(204);
				res.end();
				return;
			}
		}

		// Find matching route
		const route = this.findRoute(apiReq.method, apiReq.path);
		if (!route) {
			this.sendError(res, 404, `Route not found: ${apiReq.method} ${apiReq.path}`);
			return;
		}

		// Execute handler
		try {
			const response = await route.handler(apiReq);
			this.sendResponse(res, response);

			// Record telemetry
			const duration = Date.now() - startTime;
			getTelemetry().recordToolExecution(
				`api:${apiReq.method}:${apiReq.path}`,
				duration,
				response.status < 400,
				false,
			);
		} catch (error) {
			logger.error(`API route error: ${apiReq.method} ${apiReq.path}`, error);
			this.sendError(res, 500, "Internal server error");
		}
	}

	/**
	 * Find a matching route for the request
	 */
	private findRoute(method: string, path: string): RouteHandler | null {
		return (
			this.routes.find((r) => r.method === method && r.path === path) ||
			null
		);
	}

	/**
	 * Parse request body
	 */
	private async parseBody(req: IncomingMessage): Promise<unknown> {
		return new Promise((resolve) => {
			let body = "";
			req.on("data", (chunk) => {
				body += chunk.toString();
			});
			req.on("end", () => {
				try {
					resolve(JSON.parse(body));
				} catch {
					resolve(body);
				}
			});
		});
	}

	/**
	 * Send JSON response
	 */
	private sendResponse(res: ServerResponse, response: APIResponse): void {
		res.writeHead(response.status, {
			"Content-Type": "application/json",
			...response.headers,
		});
		res.end(JSON.stringify(response.body));
	}

	/**
	 * Send error response
	 */
	private sendError(res: ServerResponse, status: number, message: string): void {
		this.sendResponse(res, {
			status,
			body: { error: message },
		});
	}

	/**
	 * Register default API routes
	 */
	private registerDefaultRoutes(): void {
		// Health check
		this.route("GET", "/health", async () => ({
			status: 200,
			body: { status: "ok", timestamp: Date.now() },
		}));

		// API info
		this.route("GET", "/", async () => ({
			status: 200,
			body: {
				name: "Tehuti API",
				version: "1.0.0",
				endpoints: [
					"GET /health",
					"GET /session",
					"GET /config",
					"POST /chat",
				],
			},
		}));

		// Get current session info
		this.route("GET", "/session", async () => ({
			status: 200,
			body: {
				sessionId: "api-session",
				startedAt: Date.now(),
				model: "default",
				provider: "default",
			},
		}));

		// Get configuration
		this.route("GET", "/config", async () => ({
			status: 200,
			body: {
				message: "Configuration endpoint - implementation pending",
			},
		}));

		// Chat endpoint (placeholder)
		this.route("POST", "/chat", async (req) => ({
			status: 200,
			body: {
				message: "Chat endpoint - implementation pending",
				query: req.body,
			},
		}));
	}
}

let globalAPIServer: APIServer | null = null;

/**
 * Initialize and start the API server
 */
export async function startAPIServer(config: APIServerConfig): Promise<APIServer> {
	if (globalAPIServer?.isRunning()) {
		throw new Error("API server is already running");
	}

	globalAPIServer = new APIServer(config);
	await globalAPIServer.start();
	return globalAPIServer;
}

/**
 * Stop the API server
 */
export async function stopAPIServer(): Promise<void> {
	if (globalAPIServer) {
		await globalAPIServer.stop();
		globalAPIServer = null;
	}
}

/**
 * Get the API server instance
 */
export function getAPIServer(): APIServer | null {
	return globalAPIServer;
}

export { APIServer };
