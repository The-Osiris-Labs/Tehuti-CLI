import * as fs from "node:fs";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { debug } from "../utils/debug.js";

export const SOCKET_PATH = path.join(os.homedir(), ".tehuti", "tehutid.sock");

export class TehutiDaemonClient {
	private client: net.Socket | null = null;
	private buffer: string = "";
	private connected = false;
	private reconnectAttempts = 0;
	private maxReconnectAttempts = 3;
	private reconnectDelay = 1000;

	public connect(): Promise<void> {
		const { promise, resolve, reject } = Promise.withResolvers<void>();

		const attempt = () => {
			// Destroy old socket before retrying
			if (this.client) {
				this.client.destroy();
				this.client = null;
			}

			this.client = net.createConnection(SOCKET_PATH);

			this.client.on("connect", () => {
				this.connected = true;
				this.reconnectAttempts = 0;
				this.reconnectDelay = 1000;
				resolve();
			});

			this.client.on("error", (err: Error) => {
				// Check if socket file exists — if not, fail fast (no point retrying)
				const socketMissing = err.message.includes("ENOENT") || !fs.existsSync(SOCKET_PATH);
				if (socketMissing) {
					this.connected = false;
					reject(err);
					return;
				}
				this.reconnectAttempts++;
				if (this.reconnectAttempts <= this.maxReconnectAttempts) {
					debug.log("daemon", `Connection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} failed: ${err.message}. Retrying in ${this.reconnectDelay}ms...`);
					setTimeout(attempt, this.reconnectDelay);
					this.reconnectDelay *= 2;
				} else {
					this.connected = false;
					debug.log("daemon", `Failed to connect after ${this.maxReconnectAttempts} attempts.`);
					reject(err);
				}
			});
		};

		attempt();
		return promise;
	}

	public send(data: Record<string, unknown>): void {
		if (!this.connected || !this.client) {
			throw new Error("Not connected");
		}
		const payload = JSON.stringify(data);
		this.client.write(`${payload}\n`);
	}

	public sendAdvisory(message: string): void {
		this.send({ type: "advisory", message });
	}

	public disconnect(): void {
		this.connected = false;
		if (this.client) {
			this.client.end();
			this.client = null;
		}
	}

	public onMessage(callback: (data: unknown) => void): void {
		if (!this.client) return;

		this.client.setEncoding("utf8");
		this.client.on("data", (chunk: string) => {
			this.buffer += chunk;

			// Prevent memory leak from unbounded buffer
			if (this.buffer.length > 1024 * 1024 * 10) {
				// 10MB limit
				console.error("Daemon client buffer overflow. Disconnecting.");
				this.buffer = "";
				this.disconnect();
				return;
			}

			let newlineIndex: number;
			while ((newlineIndex = this.buffer.indexOf("\n")) !== -1) {
				const line = this.buffer.slice(0, newlineIndex);
				this.buffer = this.buffer.slice(newlineIndex + 1);
				const trimmed = line.endsWith("\r") ? line.slice(0, -1) : line;
				if (!trimmed) continue;

				let parsed: unknown;
				try {
					parsed = JSON.parse(trimmed);
				} catch (err) {
					console.error(
						"Daemon Client: IPC JSON parse error",
						err instanceof Error ? err.message : err,
					);
					// If not JSON, just return the raw string
					callback(trimmed);
					continue;
				}
				callback(parsed);
			}
		});
	}
}
