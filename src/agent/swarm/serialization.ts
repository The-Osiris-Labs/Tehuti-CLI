import { AgentError } from "../../utils/errors.js";
import { randomUUID } from "node:crypto";

export function serializeError(error: unknown): string {
	if (error instanceof AgentError) {
		return `[AgentError: ${error.phase}] ${error.message}`;
	}
	return error instanceof Error ? error.message : String(error);
}

// Memory-efficient IPC message chunking for large payloads
export interface IPCMessage {
	type: string;
	payload?: any;
	chunkIndex?: number;
	totalChunks?: number;
	id?: string;
	encoding?: string;
}

const CHUNK_SIZE = 512 * 1024; // 512KB chunks to prevent memory bloat in node IPC

export function sendChunkedMessage(
	processOrChild: any,
	type: string,
	payload: any,
) {
	const jsonStr = JSON.stringify(payload);
	const buffer = Buffer.from(jsonStr, "utf-8");

	if (buffer.length < CHUNK_SIZE) {
		processOrChild.send?.({ type, payload });
		return;
	}

	const id = randomUUID();
	const totalChunks = Math.ceil(buffer.length / CHUNK_SIZE);

	for (let i = 0; i < totalChunks; i++) {
		const chunkBuffer = buffer.subarray(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
		processOrChild.send?.({
			type: `${type}_chunk`,
			id,
			chunkIndex: i,
			totalChunks,
			payload: chunkBuffer.toString("base64"),
			encoding: "base64",
		});
	}
}

export class ChunkReceiver {
	private buffers = new Map<string, Array<string | undefined>>();

	public receive(msg: IPCMessage): { complete: boolean; payload?: any } {
		if (!msg.type.endsWith("_chunk") || !msg.id) {
			return { complete: true, payload: msg.payload };
		}

		let chunks = this.buffers.get(msg.id);
		if (!chunks) {
			// Use a dense array of `undefined` so `every()` actually iterates
			// over every slot. A sparse `new Array(n)` would skip empty slots
			// and report completion prematurely, which is the bug this fixes.
			chunks = new Array<string | undefined>(msg.totalChunks || 0).fill(
				undefined,
			);
			this.buffers.set(msg.id, chunks);
		}

		chunks[msg.chunkIndex || 0] = msg.payload;

		// Use `for` loop instead of `every` so empty slots are not skipped
		// (sparse-array behavior would otherwise mis-report completion).
		let isComplete = chunks.length > 0;
		for (const c of chunks) {
			if (c === undefined) {
				isComplete = false;
				break;
			}
		}
		if (isComplete) {
			this.buffers.delete(msg.id);
			try {
				let fullStr = "";
				if (msg.encoding === "base64") {
					const decodedChunks = chunks.map((c) =>
						Buffer.from(c || "", "base64"),
					);
					fullStr = Buffer.concat(decodedChunks).toString("utf-8");
				} else {
					fullStr = chunks.join("");
				}
				return { complete: true, payload: JSON.parse(fullStr) };
			} catch (err) {
				return { complete: true, payload: { error: "Failed to parse JSON chunks", details: String(err) } };
			}
		}

		return { complete: false };
	}
}
