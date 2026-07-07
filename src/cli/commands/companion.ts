import { Command } from "commander";
import { createProgram } from "./chat.js";

export function companionCommand(): Command {
	const companion = new Command("companion")
		.description(
			"Connect a client socket to the running daemon for interactive sessions",
		)
		.action(async () => {
			// Proxy over to the main chat command with the --companion flag enabled
			const prog = createProgram();
			// Re-parse with the --companion flag explicitly injected
			await prog.parseAsync(["node", "tehuti", "--companion"]);
		});

	return companion;
}
