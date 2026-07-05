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
	setupErrorHandlers(
		Boolean(process.argv.includes("--debug") || process.env.TEHUTI_DEBUG),
	);
	initializeHttpAgent();
	await initHighlighter();
	showUpdateNotification();
	const program = createProgram();
	program.parse(process.argv);
}

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
