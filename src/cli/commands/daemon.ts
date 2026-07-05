import { Command } from "commander";
import { consola } from "consola";

export function daemonCommand(): Command {
	const daemon = new Command("daemon").description(
		"Manage the background IPC server",
	);

	daemon
		.command("start")
		.description("Start the daemon")
		.action(() => {
			consola.info("Starting daemon...");
		});

	daemon
		.command("stop")
		.description("Stop the daemon")
		.action(() => {
			consola.info("Stopping daemon...");
		});

	daemon
		.command("status")
		.description("Check daemon status")
		.action(() => {
			consola.info("Daemon status: unknown");
		});

	daemon
		.command("install")
		.description("Install daemon as a background service")
		.action(() => {
			consola.info("Installing daemon...");
		});

	return daemon;
}
