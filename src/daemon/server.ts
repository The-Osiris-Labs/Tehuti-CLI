import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { sweepCacheDir } from "../agent/cache/persistent-cache.js";
import { daemonStateEngine } from "./state-engine.js";

export const SOCKET_PATH = path.join(os.homedir(), ".tehuti", "tehutid.sock");

export class TehutiDaemonServer extends EventEmitter {
	private server: net.Server;
	private activeSockets: Set<net.Socket> = new Set();
	private processHandlersSetup = false;
	private gcInterval?: ReturnType<typeof setInterval>;
	private readonly daemonStartTime: string;

	constructor() {
		super();
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
							if (msg.type === "collab") {
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
				this.emit("clientError", err);
			});

			socket.on("close", () => {
				this.activeSockets.delete(socket);
			});

			socket.on("end", () => {
				this.emit("clientDisconnect");
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

		const cleanup = () => {
			if (fs.existsSync(SOCKET_PATH)) {
				try {
					fs.unlinkSync(SOCKET_PATH);
				} catch (err) {}
			}
			process.exit(0);
		};

		process.on("SIGINT", cleanup);
		process.on("SIGTERM", cleanup);
		process.on("exit", () => {
			if (fs.existsSync(SOCKET_PATH)) {
				try {
					fs.unlinkSync(SOCKET_PATH);
				} catch (err) {}
			}
		});

		process.on("uncaughtException", (err) => {
			console.error("Uncaught exception in daemon:", err);
			cleanup();
		});

		process.on("unhandledRejection", (reason, promise) => {
			console.error("Unhandled Rejection at:", promise, "reason:", reason);
			cleanup();
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
				} catch (err) {}
			}
		};

		this.server.once("error", restoreUmask);

		try {
			this.server.listen(SOCKET_PATH, () => {
				restoreUmask();
				try {
					fs.chmodSync(SOCKET_PATH, 0o600);
				} catch (err) {}
				this.emit("listening", SOCKET_PATH);
				this.setupProcessHandlers();
				this.startGarbageCollector();
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

		// Run a sweep every 12 hours
		const GC_INTERVAL = 12 * 60 * 60 * 1000;
		this.gcInterval = setInterval(() => {
			sweepCacheDir().catch(() => {});
		}, GC_INTERVAL);

		if (this.gcInterval?.unref) {
			this.gcInterval.unref();
		}
	}

	public stop(): void {
		if (this.gcInterval) {
			clearInterval(this.gcInterval);
		}

		daemonStateEngine.stop().catch(console.error);

		for (const socket of this.activeSockets) {
			socket.destroy();
		}
		this.activeSockets.clear();

		this.server.close(() => {
			if (fs.existsSync(SOCKET_PATH)) {
				try {
					fs.unlinkSync(SOCKET_PATH);
				} catch (err) {}
			}
			this.emit("close");
		});
	}
}
