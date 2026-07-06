import { Command } from "commander";
import { consola } from "consola";
import { spawn } from "node:child_process";
import * as path from "node:path";
import * as net from "node:net";
import { TehutiDaemonServer } from "../../daemon/server.js";
import { TehutiDaemonClient, SOCKET_PATH } from "../../daemon/client.js";
import { installLaunchAgent } from "../../daemon/launch-agent.js";
import * as fs from "node:fs";

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
							consola.warn("Daemon socket exists and connects, but daemon is unresponsive (zombie).");
							consola.info("Please run `tehuti daemon stop` or manually kill the process and remove the socket file.");
							client.disconnect();
							process.exit(1);
						}
					}, 2000);
				} catch (e) {
					// Socket exists but connection failed (e.g. ECONNREFUSED) -> dead socket
					try { fs.unlinkSync(SOCKET_PATH); } catch (err) {}
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
						console.log("  " + "=".repeat(35));
						console.log(`  PID              | ${msg.pid}`);
						console.log(`  Uptime           | ${uptimeStr}`);
						console.log(`  Active Clients   | ${msg.clients}`);
						console.log("  " + "=".repeat(35) + "\n");
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
				consola.info("Run `launchctl load ~/Library/LaunchAgents/com.tehuti.daemon.plist` to start it now, or it will start on next login.");
			} catch (e: any) {
				consola.error(`Failed to install launch agent: ${e.message}`);
				process.exit(1);
			}
		});

	daemon
		.command("_run_server", { hidden: true })
		.action(() => {
			const server = new TehutiDaemonServer();
			server.start();
			consola.info(`Daemon server started on ${SOCKET_PATH}`);
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
