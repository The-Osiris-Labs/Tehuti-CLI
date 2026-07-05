import { Command } from "commander";
import { consola } from "consola";

export function companionCommand(): Command {
	const companion = new Command("companion")
		.description("Connect a client socket to the running daemon for interactive sessions")
		.action(() => {
			consola.info("Connecting to daemon...");
		});

	return companion;
}
