import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { initializeHttpAgent } from "./api/http-agent.js";
import { createProgram } from "./cli/index.js";
import { initHighlighter } from "./terminal/highlighter.js";
import {
	formatError,
	restoreTerminal,
	setupErrorHandlers,
} from "./utils/errors.js";
import { showUpdateNotification } from "./utils/update-checker.js";

async function main() {
	if (process.env.SWARM_RUNNER === "1") {
		const { startRunner } = await import("./agent/swarm/runner-process.js");
		startRunner();
		return;
	}

	setupErrorHandlers(
		Boolean(process.argv.includes("--debug") || process.env.TEHUTI_DEBUG),
	);
	initializeHttpAgent();
	await initHighlighter();
	showUpdateNotification();
	const program = createProgram();
	await program.parseAsync(process.argv);
}

let isMain = false;
try {
	if (process.argv[1]) {
		isMain = realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
	}
} catch (e) {
	// Fallback check
	if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
		isMain = true;
	}
}

if (isMain) {
	main().catch((err) => {
	restoreTerminal();
	console.error("Failed to initialize Tehuti:");
	console.error(
		formatError(
			err,
			Boolean(process.argv.includes("--debug") || process.env.TEHUTI_DEBUG),
		),
	);
	process.exit(1);
});

}
