import { describe, expect, it, vi } from "vitest";
import { AgentError } from "../../utils/errors.js";
import {
	ChunkReceiver,
	sendChunkedMessage,
	serializeError,
} from "./serialization.js";

describe("swarm serialization", () => {
	describe("serializeError", () => {
		it("extracts phase and message from AgentError", () => {
			const err = new AgentError("test message", "test_phase");
			expect(serializeError(err)).toBe("[AgentError: test_phase] test message");
		});

		it("extracts message from generic Error", () => {
			expect(serializeError(new Error("oops"))).toBe("oops");
		});

		it("handles non-Error values", () => {
			expect(serializeError("plain string")).toBe("plain string");
			expect(serializeError(42)).toBe("42");
		});
	});

	describe("sendChunkedMessage", () => {
		it("sends small payloads in a single message", () => {
			const send = vi.fn();
			const proc: any = { send };
			sendChunkedMessage(proc, "completed", { ok: true });
			expect(send).toHaveBeenCalledTimes(1);
			expect(send).toHaveBeenCalledWith({
				type: "completed",
				payload: { ok: true },
			});
		});

		it("splits large payloads into chunks", () => {
			const send = vi.fn();
			const proc: any = { send };
			const huge = { content: "x".repeat(2_000_000) };
			sendChunkedMessage(proc, "completed", huge);
			const totalChunks = Math.ceil(JSON.stringify(huge).length / (512 * 1024));
			expect(send.mock.calls.length).toBe(totalChunks);
			// All chunk messages should share the same id.
			const ids = new Set(send.mock.calls.map((c) => c[0].id));
			expect(ids.size).toBe(1);
			// Chunk indices should be 0..n-1.
			const indices = send.mock.calls.map((c) => c[0].chunkIndex).sort();
			expect(indices).toEqual(Array.from({ length: totalChunks }, (_, i) => i));
		});
	});

	describe("ChunkReceiver", () => {
		it("passes through non-chunk messages", () => {
			const r = new ChunkReceiver();
			const { complete, payload } = r.receive({ type: "token" } as any);
			expect(complete).toBe(true);
			expect(payload).toBeUndefined();
		});

		it("reassembles a chunked payload in order", () => {
			const r = new ChunkReceiver();
			const obj = { a: 1, b: "hello", c: [1, 2, 3] };
			const json = JSON.stringify(obj);
			const CHUNK = 16;
			const chunks: string[] = [];
			for (let i = 0; i < json.length; i += CHUNK) {
				chunks.push(json.slice(i, i + CHUNK));
			}
			let result: unknown;
			for (let i = 0; i < chunks.length; i++) {
				const out = r.receive({
					type: "completed_chunk",
					id: "x",
					chunkIndex: i,
					totalChunks: chunks.length,
					payload: chunks[i],
				} as any);
				if (i === chunks.length - 1) {
					expect(out.complete).toBe(true);
					result = out.payload;
				} else {
					expect(out.complete).toBe(false);
				}
			}
			expect(result).toEqual(obj);
		});

		it("reassembles out-of-order chunks", () => {
			const r = new ChunkReceiver();
			const obj = { value: "abcdef" };
			const json = JSON.stringify(obj);
			const chunks: string[] = [
				json.slice(0, 4),
				json.slice(4, 8),
				json.slice(8),
			];
			// Deliver in order 1, 2, 0
			const deliveries: Array<{
				type: string;
				id: string;
				chunkIndex: number;
				totalChunks: number;
				payload: string;
			}> = [
				{
					type: "x_chunk",
					id: "y",
					chunkIndex: 1,
					totalChunks: 3,
					payload: chunks[1],
				},
				{
					type: "x_chunk",
					id: "y",
					chunkIndex: 2,
					totalChunks: 3,
					payload: chunks[2],
				},
				{
					type: "x_chunk",
					id: "y",
					chunkIndex: 0,
					totalChunks: 3,
					payload: chunks[0],
				},
			];
			let final: unknown;
			for (const d of deliveries) {
				const out = r.receive(d as any);
				if (out.complete) final = out.payload;
			}
			expect(final).toEqual(obj);
		});

		it("returns null payload on JSON parse failure", () => {
			const r = new ChunkReceiver();
			const out = r.receive({
				type: "x_chunk",
				id: "bad",
				chunkIndex: 0,
				totalChunks: 1,
				payload: "not json {",
			} as any);
			expect(out.complete).toBe(true);
			expect(out.payload).toHaveProperty("error", "Failed to parse JSON chunks");
			expect(out.payload).toHaveProperty("details");
		});
	});
});
