import { loadConfig } from "../../config/index.js";
import { debug } from "../../utils/debug.js";
import {
	agentEventBus,
	globalAbortController,
	interruptAgent,
} from "../events.js";
import { createAgentContext, runAgentLoop } from "../index.js";
import { sendChunkedMessage, serializeError } from "./serialization.js";

/**
 * Subagent runner executed in a forked child process.
 *
 * Protocol:
 *   child -> parent: { type: "ready" }                       (once on startup)
 *   parent -> child: { type: "start", payload: {...} }      (begins work)
 *   child -> parent: { type: "token" | "tool_call" | ... }   (streamed events)
 *   child -> parent: { type: "completed" | "error" }        (terminal)
 *   parent -> child: { type: "message", payload: string }   (mid-flight injection)
 *   parent -> child: { type: "abort" }                      (graceful cancel)
 *
 * Notes:
 *   - We must NEVER emit `agentEventBus` events for the parent to consume,
 *     because that bus is per-process. All cross-boundary signals go over IPC.
 *   - We forward the parent's AbortSignal via `globalAbortController` so the
 *     running loop can be cancelled cleanly without a hard SIGKILL.
 *   - Stdio is piped (set by the parent in `SwarmManager.spawnSubagent`); we
 *     use the tagged debug channel rather than console.* to avoid filling
 *     the pipe buffer (the parent does not drain the child's stdio).
 */
export function startRunner() {
	const log = (msg: string) => debug.log("agent", `[swarm-runner] ${msg}`);

	// Acknowledge readiness so the parent knows it is safe to send the first
	// real message. `process.send` is async-safe but the listener on our side
	// is only registered inside this function, so the parent might race us.
	// The handshake guarantees the parent's `start` cannot arrive before us.
	try {
		process.send?.({ type: "ready" });
	} catch (err) {
		log(`Failed to send ready handshake: ${(err as Error).message}`);
	}

	let activeLoop: Promise<void> | null = null;
	let aborted = false;
	let abortTimer: NodeJS.Timeout | null = null;

	const handleAbort = () => {
		if (aborted) return;
		aborted = true;
		log("Abort requested; interrupting loop");
		try {
			interruptAgent();
		} catch (err) {
			log(`Interrupt failed: ${(err as Error).message}`);
		}
		// Give the loop a short grace period to unwind, then force exit.
		abortTimer = setTimeout(() => {
			log("Forcing exit after abort grace period");
			process.exit(2);
		}, 5000);
		// Don't keep the event loop alive solely for this timer.
		abortTimer.unref();
	};

	process.on("SIGTERM", handleAbort);
	process.on("SIGINT", handleAbort);

	process.on("disconnect", () => {
		// Parent hung up. Stop gracefully.
		log("Parent disconnected; aborting");
		handleAbort();
	});

	process.on("message", async (msg: any) => {
		if (!msg || typeof msg.type !== "string") return;

		if (msg.type === "abort") {
			handleAbort();
			return;
		}

		if (msg.type === "message") {
			// Inject a wakeup event into OUR local bus. The child loop is
			// sleeping on `wakeupQueue.consume()`; the event bus is per-process
			// so this is the correct way to wake ourselves up.
			const payload =
				typeof msg.payload === "string"
					? msg.payload
					: String(msg.payload ?? "");
			agentEventBus.emit("wakeup", payload);
			return;
		}

		if (msg.type !== "start") return;

		// Idempotency: if a loop is already running, ignore re-entries.
		if (activeLoop) {
			log("Received 'start' while loop is active; ignoring");
			return;
		}

		activeLoop = (async () => {
			try {
				const { prompt, workingDir } = msg.payload ?? {};
				if (typeof workingDir !== "string" || typeof prompt !== "string") {
					throw new Error(
						"Invalid 'start' payload: prompt and workingDir required",
					);
				}

				const config = await loadConfig();
				const ctx = await createAgentContext(workingDir, config);

				const result = await runAgentLoop(ctx, prompt, {
					onToken: () => {
						process.send?.({ type: "token" });
					},
					onThinking: (content) => {
						process.send?.({ type: "thinking", payload: content });
					},
					onToolCall: (id, name, args) => {
						process.send?.({
							type: "tool_call",
							payload: { id, name, args },
						});
					},
					onToolResult: (id, name, toolResult) => {
						process.send?.({
							type: "tool_result",
							payload: { id, name, result: toolResult },
						});
					},
					onProgress: (progress, label) => {
						process.send?.({ type: "progress", payload: { progress, label } });
					},
					signal: globalAbortController.signal,
				});

				if (aborted) {
					sendChunkedMessage(process, "error", "Aborted by parent");
				} else {
					sendChunkedMessage(process, "completed", result);
				}
			} catch (error) {
				log(`Loop error: ${(error as Error).stack ?? String(error)}`);
				sendChunkedMessage(process, "error", serializeError(error));
			} finally {
				activeLoop = null;
				if (abortTimer) {
					clearTimeout(abortTimer);
					abortTimer = null;
				}
				// Give the IPC channel a tick to flush, then exit cleanly.
				setImmediate(() => {
					if (!aborted) process.exit(0);
				});
			}
		})();

		await activeLoop;
	});
}
