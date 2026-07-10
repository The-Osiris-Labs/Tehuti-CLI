import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";

export const SOCKET_PATH = path.join(os.homedir(), ".tehuti", "tehutid.sock");

export class TehutiDaemonClient {
	private client: net.Socket | null = null;
	private buffer: string = "";

	public connect(): Promise<void> {
		return new Promise((resolve, reject) => {
			this.client = net.createConnection(SOCKET_PATH);

			this.client.on("connect", () => {
				resolve();
			});

			this.client.on("error", (err: Error) => {
				reject(err);
			});
		});
	}

	public send(data: any): void {
		if (this.client) {
			const payload = JSON.stringify(data);
			this.client.write(`${payload}\n`);
		} else {
			throw new Error("Not connected");
		}
	}

	public disconnect(): void {
		if (this.client) {
			this.client.end();
			this.client = null;
		}
	}

	public onMessage(callback: (data: any) => void): void {
		if (this.client) {
			this.client.setEncoding("utf8");
			this.client.on("data", (chunk: string) => {
				this.buffer += chunk;

				// Prevent memory leak from unbounded buffer
				if (this.buffer.length > 1024 * 1024 * 10) {
					// 10MB limit
					console.error("Daemon client buffer overflow. Disconnecting.");
					this.disconnect();
					return;
				}

				let newlineIndex: number;
				while ((newlineIndex = this.buffer.indexOf("\n")) !== -1) {
					let line = this.buffer.slice(0, newlineIndex);
					this.buffer = this.buffer.slice(newlineIndex + 1);
					if (line.endsWith("\r")) {
						line = line.slice(0, -1);
					}
					if (line) {
						let parsed: any;
						try {
							parsed = JSON.parse(line);
						} catch (err) {
							// If not JSON, just return the raw string
							callback(line);
							continue;
						}
						callback(parsed);
					}
				}
			});
		}
	}
}
