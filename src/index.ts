import { initializeHttpAgent } from "./api/http-agent.js";
import { createProgram } from "./cli/index.js";
import { showUpdateNotification } from "./utils/update-checker.js";
import { initHighlighter } from "./terminal/highlighter.js";

async function main() {
	initializeHttpAgent();
	await initHighlighter();
	showUpdateNotification();
	const program = createProgram();
	program.parse(process.argv);
}

process.on("uncaughtException", (err) => {
	// Attempt to forcefully reset terminal state (disable mouse tracking, show cursor)
	process.stdout.write("\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1015l\x1b[?1006l\x1b[?25h");
	console.error("Uncaught Exception:", err);
	process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
	process.stdout.write("\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1015l\x1b[?1006l\x1b[?25h");
	console.error("Unhandled Rejection at:", promise, "reason:", reason);
	process.exit(1);
});

main().catch((err) => {
	process.stdout.write("\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1015l\x1b[?1006l\x1b[?25h");
	console.error("Failed to initialize Tehuti:", err);
	process.exit(1);
});
