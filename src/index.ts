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

main().catch((err) => {
	console.error("Failed to initialize Tehuti:", err);
	process.exit(1);
});
