import { EventEmitter } from "node:events";
import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";

export const SOCKET_PATH = path.join(os.homedir(), ".tehuti", "tehutid.sock");

export class TehutiDaemonServer extends EventEmitter {
	private server: net.Server;
	private activeSockets: Set<net.Socket> = new Set();
	private processHandlersSetup = false;

	constructor() {
		super();
		this.server = net.createServer((socket: net.Socket) => {
			this.activeSockets.add(socket);
			this.emit("connection", socket);

			socket.setEncoding("utf8");
			let buffer = "";

			socket.on("data", (chunk: string) => {
				buffer += chunk;

				// Prevent memory leak from unbounded buffer
				if (buffer.length > 1024 * 1024 * 10) {
					// 10MB limit
					socket.destroy(new Error("Buffer size limit exceeded"));
					return;
				}

				let newlineIndex;
				while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
					const line = buffer.slice(0, newlineIndex).trim();
					buffer = buffer.slice(newlineIndex + 1);

					if (line) {
						try {
							const msg = JSON.parse(line);
							if (msg.type === "ping") {
								// Count connected sockets by asking the server
								this.server.getConnections((err, count) => {
									if (!socket.destroyed) {
										socket.write(
											JSON.stringify({
												type: "pong",
												pid: process.pid,
												uptime: process.uptime(),
												clients: count || 0,
											}) + "\n",
										);
									}
								});
								continue;
							}
							if (msg.type === "stop") {
								if (!socket.destroyed) {
									socket.write(JSON.stringify({ type: "stopping" }) + "\n");
								}
								this.stop();
								setTimeout(() => process.exit(0), 100);
								return;
							}
							this.emit("message", socket, msg);
						} catch (e) {
							// Not JSON, just emit as normal data
							this.emit("data", socket, Buffer.from(line));
						}
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
	}

	private listen(): void {
		this.server.listen(SOCKET_PATH, () => {
			fs.chmodSync(SOCKET_PATH, 0o600);
			this.emit("listening", SOCKET_PATH);
			this.setupProcessHandlers();
		});
	}

	public stop(): void {
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
