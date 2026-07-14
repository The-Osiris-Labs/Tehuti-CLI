import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { initializeHttpAgent } from "./api/http-agent.js";
import { createProgram } from "./cli/index.js";
import { initHighlighter } from "./terminal/highlighter.js";
import { isMachineReadableOutput } from "./utils/cli-output.js";
import {
	formatError,
	registerCleanupHandler,
	restoreTerminal,
	setupErrorHandlers,
} from "./utils/errors.js";
import { initTrace, trace, traceEmit } from "./utils/trace.js";
import { showUpdateNotification } from "./utils/update-checker.js";

async function main() {
	// Trace initialization is deliberately first and non-throwing: failure to
	// open local audit storage must never block the CLI from starting.
	initTrace();
	traceEmit("lifecycle.startup", "CLI startup", { actor: "cli" });
	registerCleanupHandler(() => {
		traceEmit("lifecycle.shutdown", "CLI shutdown", { actor: "cli" });
		trace.close();
	});

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
	if (!isMachineReadableOutput(process.argv)) {
		showUpdateNotification();
	}
	const program = createProgram();
	await program.parseAsync(process.argv);
}

let isMain = false;
try {
	if (process.argv[1]) {
		isMain =
			realpathSync(process.argv[1]) ===
			realpathSync(fileURLToPath(import.meta.url));
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
