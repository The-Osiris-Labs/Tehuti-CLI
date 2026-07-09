import { spawn } from "node:child_process";
import * as fs from "node:fs";
import type * as net from "node:net";
import * as path from "node:path";
import { Command } from "commander";
import { consola } from "consola";
import { loadConfig } from "../../config/index.js";
import { SOCKET_PATH, TehutiDaemonClient } from "../../daemon/client.js";
import { installLaunchAgent } from "../../daemon/launch-agent.js";
import { TehutiDaemonServer } from "../../daemon/server.js";
import { DaemonStateEngine } from "../../daemon/state-engine.js";

export function daemonCommand(): Command {
	const daemon = new Command("daemon").description(
		"Manage the background IPC server",
	);

	daemon
		.command("start")
		.description("Start the daemon in the background")
		.action(async () => {
			if (fs.existsSync(SOCKET_PATH)) {
				// verify it's really running
				try {
					const client = new TehutiDaemonClient();
					await client.connect();

					let responded = false;
					client.onMessage((msg: any) => {
						if (msg.type === "pong") {
							responded = true;
							consola.error("Daemon is already running!");
							client.disconnect();
							process.exit(1);
						}
					});

					client.send({ type: "ping" });

					setTimeout(() => {
						if (!responded) {
							consola.warn(
								"Daemon socket exists and connects, but daemon is unresponsive (zombie).",
							);
							consola.info(
								"Please run `tehuti daemon stop` or manually kill the process and remove the socket file.",
							);
							client.disconnect();
							process.exit(1);
						}
					}, 2000);
				} catch (e) {
					// Socket exists but connection failed (e.g. ECONNREFUSED) -> dead socket
					try {
						fs.unlinkSync(SOCKET_PATH);
					} catch (err) {}
					startDaemonProcess();
				}
			} else {
				startDaemonProcess();
			}
		});

	daemon
		.command("stop")
		.description("Stop the background daemon")
		.action(async () => {
			const client = new TehutiDaemonClient();
			try {
				await client.connect();
				client.onMessage((msg: any) => {
					if (msg.type === "stopping") {
						consola.success("Daemon stopped.");
						client.disconnect();
						process.exit(0);
					}
				});
				client.send({ type: "stop" });
				setTimeout(() => {
					consola.warn("Daemon did not respond, it may have already exited.");
					process.exit(0);
				}, 2000);
			} catch (e: any) {
				consola.error(`Failed to connect to daemon: ${e.message}`);
				process.exit(1);
			}
		});

	daemon
		.command("status")
		.description("Check daemon status")
		.action(async () => {
			const client = new TehutiDaemonClient();
			try {
				await client.connect();
				client.onMessage((msg: any) => {
					if (msg.type === "pong") {
						const uptimeStr = formatUptime(msg.uptime);
						// Format as a simple ASCII table
						console.log("\n  Daemon Status");
						console.log(`  ${"=".repeat(35)}`);
						console.log(`  PID              | ${msg.pid}`);
						console.log(`  Uptime           | ${uptimeStr}`);
						if (msg.session_start_time) {
							console.log(`  Session Start    | ${msg.session_start_time}`);
						}
						console.log(`  Active Clients   | ${msg.clients}`);
						console.log(`  ${"=".repeat(35)}\n`);
						client.disconnect();
						process.exit(0);
					}
				});
				client.send({ type: "ping" });
				setTimeout(() => {
					consola.error("Daemon is running but unresponsive.");
					process.exit(1);
				}, 2000);
			} catch (e: any) {
				consola.error(`Daemon is not running. (Error: ${e.message})`);
				process.exit(1);
			}
		});

	daemon
		.command("install")
		.description("Install daemon as a background service via launchd (macOS)")
		.action(() => {
			try {
				installLaunchAgent();
				consola.success("Daemon launch agent installed.");
				consola.info(
					"Run `launchctl load ~/Library/LaunchAgents/com.tehuti.daemon.plist` to start it now, or it will start on next login.",
				);
			} catch (e: any) {
				consola.error(`Failed to install launch agent: ${e.message}`);
				process.exit(1);
			}
		});

	daemon.command("_run_server", { hidden: true }).action(async () => {
		const cfg = await loadConfig();
		const server = new TehutiDaemonServer();
		server.start();
		consola.info(`Daemon server started on ${SOCKET_PATH}`);

		const stateEngine = new DaemonStateEngine(cfg as any);
		stateEngine.start();

		server.on("message", async (dataOrSocket: any, socketOrData: any) => {
			const socket: net.Socket =
				dataOrSocket && typeof dataOrSocket.write === "function"
					? dataOrSocket
					: socketOrData;
			const data: any =
				dataOrSocket && typeof dataOrSocket.write === "function"
					? socketOrData
					: dataOrSocket;

			if (!data || typeof data !== "object" || !socket) return;

			if (data.type === "agent_message" && typeof data.text === "string") {
				try {
					const { createAgentContext, runAgentLoop } = await import(
						"../../agent/index.js"
					);
					const ctx = await createAgentContext(
						process.cwd(),
						cfg,
						undefined,
						true,
					);
					const result = await runAgentLoop(ctx, data.text);
					if (!socket.destroyed) {
						socket.write(
							`${JSON.stringify({
								type: "agent_response",
								content: result.content,
							})}\n`,
						);
					}
				} catch (error) {
					const errorMessage =
						error instanceof Error ? error.message : String(error);
					if (!socket.destroyed) {
						socket.write(
							`${JSON.stringify({
								type: "error",
								message: errorMessage,
							})}\n`,
						);
					}
				}
			}
		});

		const shutdown = () => {
			stateEngine.stop();
		};
		server.on("close", shutdown);
		process.on("SIGINT", shutdown);
		process.on("SIGTERM", shutdown);
	});

	return daemon;
}

function startDaemonProcess() {
	const cliScript = process.argv[1];
	const child = spawn(process.execPath, [cliScript, "daemon", "_run_server"], {
		detached: true,
		stdio: "ignore",
	});
	child.unref();
	consola.success(`Daemon started in the background (PID: ${child.pid}).`);
}

function formatUptime(seconds: number): string {
	const d = Math.floor(seconds / (3600 * 24));
	const h = Math.floor((seconds % (3600 * 24)) / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = Math.floor(seconds % 60);

	const parts = [];
	if (d > 0) parts.push(`${d}d`);
	if (h > 0) parts.push(`${h}h`);
	if (m > 0) parts.push(`${m}m`);
	parts.push(`${s}s`);
	return parts.join(" ");
}
