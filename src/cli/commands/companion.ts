import { Command } from "commander";
import { consola } from "consola";
import { TehutiDaemonClient } from "../../daemon/client.js";

export function companionCommand(): Command {
	const companion = new Command("companion")
		.description(
			"Connect a client socket to the running daemon for interactive sessions",
		)
		.action(async () => {
			const client = new TehutiDaemonClient();
			try {
				await client.connect();
				consola.success("Connected to Tehuti companion daemon.\n");
				
				client.onMessage((data: any) => {
					if (typeof data === "string") {
						process.stdout.write(data + "\n");
					} else {
						process.stdout.write(JSON.stringify(data) + "\n");
					}
				});
				
				process.stdin.on("data", (data) => {
					client.send(data.toString());
				});
				
				// Handle exit
				process.on("SIGINT", () => {
					client.disconnect();
					process.exit(0);
				});
			} catch (e: any) {
				consola.error(`Failed to connect to daemon: ${e.message}`);
				consola.info("Is the daemon running? Try: tehuti daemon start");
				process.exit(1);
			}
		});

	return companion;
}
