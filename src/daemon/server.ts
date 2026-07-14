import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import type { ConnectorConfig } from "../messaging/connector-manager.js";
import { sweepCacheDir } from "../agent/cache/persistent-cache.js";
import { sweepResponseCache } from "../api/response-cache.js";
import { daemonStateEngine } from "./state-engine.js";
import { debug } from "../utils/debug.js";

export const SOCKET_PATH = path.join(os.homedir(), ".tehuti", "tehutid.sock");

export class TehutiDaemonServer extends EventEmitter {
	private server: net.Server;
	private activeSockets: Set<net.Socket> = new Set();
	private processHandlersSetup = false;
	private gcInterval: ReturnType<typeof setInterval> | undefined;
	private logRotationInterval: ReturnType<typeof setInterval> | undefined;
	private readonly daemonStartTime: string;
	private readonly messagingConfig?: ConnectorConfig;

	constructor(messagingConfig?: ConnectorConfig) {
		super();
		this.messagingConfig = messagingConfig;
		this.daemonStartTime = new Date().toISOString();
		this.server = net.createServer((socket: net.Socket) => {
			this.activeSockets.add(socket);
			this.emit("connection", socket);

			socket.setEncoding("utf8");
			socket.setTimeout(300000, () =>
				socket.destroy(new Error("Idle Timeout")),
			);
			let buffer = "";

			socket.on("data", (chunk: string) => {
				buffer += chunk;

				// Prevent memory leak from unbounded buffer
				if (buffer.length > 1024 * 1024 * 10) {
					// 10MB limit
					buffer = "";
					socket.destroy(new Error("Buffer size limit exceeded"));
					return;
				}

				let newlineIndex: number;
				while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
					let line = buffer.slice(0, newlineIndex);
					buffer = buffer.slice(newlineIndex + 1);
					if (line.endsWith("\r")) {
						line = line.slice(0, -1);
					}

					if (line) {
						let msg: any;
						try {
							msg = JSON.parse(line);
						} catch (e) {
							console.error(
								"Daemon Server: IPC JSON parse error",
								e instanceof Error ? e.message : e,
							);
							// Not JSON, just emit as normal data
							this.emit("data", socket, Buffer.from(line));
							continue;
						}

						if (typeof msg === "object" && msg !== null) {
							if (msg.type === "ping") {
								// Count connected sockets by asking the server
								this.server.getConnections((_err, count) => {
									if (!socket.destroyed) {
										socket.write(
											`${JSON.stringify({
												type: "pong",
												pid: process.pid,
												uptime: process.uptime(),
												session_start_time: this.daemonStartTime,
												clients: count || 0,
											})}\n`,
										);
									}
								});
								continue;
							}
							if (msg.type === "stop") {
								if (!socket.destroyed) {
									socket.write(
										`${JSON.stringify({ type: "stopping" })}\n`,
										() => {
											this.stop();
											setTimeout(() => process.exit(0), 100);
										},
									);
								} else {
									this.stop();
									setTimeout(() => process.exit(0), 100);
								}
								return;
							}
							if (msg.type === "collab" || msg.type === "advisory") {
								// Broadcast to all active sockets (simple IPC multiplexing)
								for (const peerSocket of this.activeSockets) {
									if (peerSocket !== socket && !peerSocket.destroyed) {
										peerSocket.write(`${JSON.stringify(msg)}\n`);
									}
								}
								continue;
							}
						}
						this.emit("message", socket, msg);
					}
				}
			});

			socket.on("error", (err: Error) => {
				debug.log("daemon", `Socket error: ${err.message}`);
				this.emit("clientError", err);
				this.activeSockets.delete(socket);
				if (!socket.destroyed) {
					socket.destroy();
				}
			});

			socket.on("close", (hadError: boolean) => {
				this.activeSockets.delete(socket);
				if (hadError) {
					debug.log("daemon", "Socket closed after error");
				}
			});

			socket.on("end", () => {
				this.emit("clientDisconnect");
				this.activeSockets.delete(socket);
			});
		});

		this.server.on("error", (err: Error) => {
			this.emit("error", err);
		});
	}

	public start(): void {
		const socketDir = path.dirname(SOCKET_PATH);
		if (!fs.existsSync(socketDir)) {
			fs.mkdirSync(socketDir, { recursive: true, mode: 0o700 });
		}

		if (fs.existsSync(SOCKET_PATH)) {
			const client = net.createConnection({ path: SOCKET_PATH });
			client.setTimeout(2000, () => client.destroy(new Error("Timeout")));
			client.on("connect", () => {
				client.end();
				this.emit("error", new Error("EADDRINUSE"));
			});
			client.on("error", (err: any) => {
				if (err.code === "ECONNREFUSED") {
					try {
						fs.unlinkSync(SOCKET_PATH);
					} catch (e) {
						// ignore if already removed
					}
					this.listen();
				} else if (err.code === "ENOENT") {
					// Socket was deleted by another process right after our existsSync check
					this.listen();
				} else {
					this.emit("error", err);
				}
			});
		} else {
			this.listen();
		}
	}

	private setupProcessHandlers() {
		if (this.processHandlersSetup) return;
		this.processHandlersSetup = true;

		const cleanup = async () => {
			await this.stop();
			if (fs.existsSync(SOCKET_PATH)) {
				try {
					fs.unlinkSync(SOCKET_PATH);
				} catch (err) {
					debug.log("daemon", `Failed to unlink socket during cleanup: ${err}`);
				}
			}
			process.exit(0);
		};

		process.on("SIGINT", () => { void cleanup(); });
		process.on("SIGTERM", () => { void cleanup(); });
		process.on("exit", () => {
			if (fs.existsSync(SOCKET_PATH)) {
				try {
					fs.unlinkSync(SOCKET_PATH);
				} catch (err) {
					debug.log("daemon", `Failed to unlink socket on exit: ${err}`);
				}
			}
		});

		process.on("uncaughtException", (err) => {
			console.error("Uncaught exception in daemon:", err);
			process.exit(1);
		});

		process.on("unhandledRejection", (reason, promise) => {
			console.error("Unhandled Rejection at:", promise, "reason:", reason);
			process.exit(1);
		});
	}

	private listen(): void {
		const oldUmask = process.umask(0o177);
		let umaskRestored = false;
		const restoreUmask = () => {
			if (!umaskRestored) {
				umaskRestored = true;
				try {
					process.umask(oldUmask);
				} catch (err) {
					debug.log("daemon", `Failed to restore umask: ${err}`);
				}
			}
		};

		this.server.once("error", restoreUmask);

		try {
			this.server.listen(SOCKET_PATH, () => {
				restoreUmask();
				try {
					fs.chmodSync(SOCKET_PATH, 0o600);
				} catch (err) {
					debug.log("daemon", `Failed to chmod socket: ${err}`);
				}
				this.emit("listening", SOCKET_PATH);
				this.setupProcessHandlers();
				this.startGarbageCollector();
				this.startLogRotation();
				if (this.messagingConfig) {
					daemonStateEngine.configure({ messaging: this.messagingConfig });
				}
				daemonStateEngine.start().catch(console.error);
			});
		} catch (err) {
			restoreUmask();
			throw err;
		}
	}

	private startGarbageCollector(): void {
		// Run a sweep immediately
		sweepCacheDir().catch(() => {});
		sweepResponseCache().catch(() => {});

		// Run a sweep every 12 hours
		const GC_INTERVAL = 12 * 60 * 60 * 1000;
		this.gcInterval = setInterval(() => {
			sweepCacheDir().catch(() => {});
			sweepResponseCache().catch(() => {});
		}, GC_INTERVAL);

		if (this.gcInterval?.unref) {
			this.gcInterval.unref();
		}
	}

	private startLogRotation(): void {
		const checkAndRotate = () => {
			const maxSizeBytes = 50 * 1024 * 1024; // 50MB
			const logFiles = [
				path.join(os.homedir(), ".tehuti", "tehutid.out.log"),
				path.join(os.homedir(), ".tehuti", "tehutid.err.log"),
			];

			for (const file of logFiles) {
				if (fs.existsSync(file)) {
					try {
						const stats = fs.statSync(file);
						if (stats.size > maxSizeBytes) {
							// Truncate the file to 0 bytes if it exceeds the limit
							fs.truncateSync(file, 0);
						}
					} catch (e) {
						// Ignore errors during log rotation
					}
				}
			}
		};

		// Run immediately on startup
		checkAndRotate();

		// Run every hour
		const ROTATE_INTERVAL = 60 * 60 * 1000;
		this.logRotationInterval = setInterval(checkAndRotate, ROTATE_INTERVAL);

		if (this.logRotationInterval?.unref) {
			this.logRotationInterval.unref();
		}
	}

	public async stop(): Promise<void> {
		if (this.gcInterval) {
			clearInterval(this.gcInterval);
		}
		if (this.logRotationInterval) {
			clearInterval(this.logRotationInterval);
		}

		await daemonStateEngine.stop().catch(console.error);

		for (const socket of this.activeSockets) {
			socket.destroy();
		}
		this.activeSockets.clear();

		this.server.close(() => {
			if (fs.existsSync(SOCKET_PATH)) {
				try {
					fs.unlinkSync(SOCKET_PATH);
				} catch (err) {
					debug.log("daemon", `Failed to unlink socket during stop: ${err}`);
				}
			}
			this.emit("close");
		});
	}
}
