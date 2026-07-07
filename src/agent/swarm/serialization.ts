import { AgentError } from "../../utils/errors.js";

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
}

const CHUNK_SIZE = 512 * 1024; // 512KB chunks to prevent memory bloat in node IPC

export function sendChunkedMessage(
	processOrChild: any,
	type: string,
	payload: any,
) {
	const jsonStr = JSON.stringify(payload);
	if (jsonStr.length < CHUNK_SIZE) {
		processOrChild.send?.({ type, payload });
		return;
	}

	const id = Math.random().toString(36).substring(7);
	const totalChunks = Math.ceil(jsonStr.length / CHUNK_SIZE);

	for (let i = 0; i < totalChunks; i++) {
		const chunk = jsonStr.substring(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
		processOrChild.send?.({
			type: `${type}_chunk`,
			id,
			chunkIndex: i,
			totalChunks,
			payload: chunk,
		});
	}
}

export class ChunkReceiver {
	private buffers = new Map<string, string[]>();

	public receive(msg: IPCMessage): { complete: boolean; payload?: any } {
		if (!msg.type.endsWith("_chunk") || !msg.id) {
			return { complete: true, payload: msg.payload };
		}

		let chunks = this.buffers.get(msg.id);
		if (!chunks) {
			chunks = new Array(msg.totalChunks || 0);
			this.buffers.set(msg.id, chunks);
		}

		chunks[msg.chunkIndex || 0] = msg.payload;

		const isComplete = chunks.every((c) => c !== undefined);
		if (isComplete) {
			this.buffers.delete(msg.id);
			try {
				const fullStr = chunks.join("");
				return { complete: true, payload: JSON.parse(fullStr) };
			} catch {
				return { complete: true, payload: null };
			}
		}

		return { complete: false };
	}
}
