import { loadConfig } from "../../config/index.js";
import { createAgentContext, runAgentLoop } from "../index.js";
import { sendChunkedMessage, serializeError } from "./serialization.js";
import { agentEventBus } from "../events.js";

export function startRunner() {
	process.on("message", async (msg: any) => {
		if (msg.type === "start") {
			try {
				const { prompt, workingDir } = msg.payload;
				const config = await loadConfig();
				const ctx = await createAgentContext(workingDir, config);

				const result = await runAgentLoop(ctx, prompt, {
					onToken: () => {
						process.send?.({ type: "token" });
					},
					onProgress: (progress, label) => {
						process.send?.({ type: "progress", payload: { progress, label } });
					}
				});

				sendChunkedMessage(process, "completed", result);
			} catch (error) {
				process.send?.({ type: "error", payload: serializeError(error) });
			}
		} else if (msg.type === "message") {
			agentEventBus.emit("wakeup", msg.payload);
		}
	});
}
