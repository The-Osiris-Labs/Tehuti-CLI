import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	defaultTraceLogPath,
	initTrace,
	readPersistedTrace,
	trace,
	traceEmit,
	traceTimer,
} from "./trace.js";

let testDir: string;

beforeEach(async () => {
	testDir = await fs.promises.mkdtemp(
		path.join(os.tmpdir(), "tehuti-trace-test-"),
	);
	trace.setEnabled(true);
	trace.close();
	trace.configure(path.join(testDir, "trace.jsonl"));
	trace.clearRing();
});

afterEach(async () => {
	trace.close();
	trace.clearRing();
	trace.setSession(null);
	trace.setActor("main");
	await fs.promises.rm(testDir, { recursive: true, force: true });
});

describe("trace.emit()", () => {
	it("records a basic event to the ring buffer", () => {
		traceEmit("user.input", "hello", { data: { text: "hi" } });
		const recent = trace.recent(1);
		expect(recent).toHaveLength(1);
		expect(recent[0].kind).toBe("user.input");
		expect(recent[0].summary).toBe("hello");
		expect(recent[0].data?.text).toBe("hi");
	});

	it("attaches current session and actor to each event", () => {
		trace.setSession("sess-1");
		trace.setActor("runner");
		traceEmit("tool.dispatched", "bash", { data: { command: "ls" } });
		const recent = trace.recent(1);
		expect(recent[0].sessionId).toBe("sess-1");
		expect(recent[0].actor).toBe("runner");
	});

	it("is a no-op when disabled", () => {
		trace.setEnabled(false);
		traceEmit("user.input", "should not record");
		expect(trace.recent(1)).toHaveLength(0);
		trace.setEnabled(true);
	});

	it("appends to on-disk log synchronously after flushSync", () => {
		traceEmit("file.read", "/tmp/foo");
		traceEmit("file.write", "/tmp/bar");
		trace.flushSync();
		const logPath = trace.getLogPath();
		expect(logPath).not.toBeNull();
		if (!logPath) return;
		const lines = fs.readFileSync(logPath, "utf8").trim().split("\n");
		expect(lines).toHaveLength(2);
		const first = JSON.parse(lines[0]);
		expect(first.kind).toBe("file.read");
		expect(first.summary).toBe("/tmp/foo");
		const second = JSON.parse(lines[1]);
		expect(second.kind).toBe("file.write");
	});

	it("clamps long strings in data", () => {
		const long = "x".repeat(10_000);
		traceEmit("model.response", "ok", { data: { output: long } });
		const recent = trace.recent(1);
		const out = recent[0].data?.output as string;
		expect(out.length).toBeLessThan(10_000);
		expect(out).toMatch(/\(\+\d+\)$/);
	});

	it("summarizes large arrays and objects", () => {
		const bigArr = Array.from({ length: 100 }, (_, i) => i);
		const bigObj = Object.fromEntries(
			Array.from({ length: 50 }, (_, i) => [`k${i}`, i]),
		);
		traceEmit("tool.success", "ok", { data: { arr: bigArr, obj: bigObj } });
		const recent = trace.recent(1);
		expect(recent[0].data?.arr).toBe("[Array(100)]");
		expect(recent[0].data?.obj).toBe("[Object(50 keys)]");
	});

	it("serializes Error instances into name/message/stack", () => {
		const err = new Error("boom");
		traceEmit("tool.error", "failed", { data: { error: err } });
		const recent = trace.recent(1);
		const data = recent[0].data?.error as {
			name: string;
			message: string;
			stack?: string;
		};
		expect(data.name).toBe("Error");
		expect(data.message).toBe("boom");
		expect(data.stack).toBeDefined();
	});
});

describe("trace.recent() and trace.query()", () => {
	beforeEach(() => {
		traceEmit("user.input", "msg1");
		traceEmit("user.input", "msg2");
		traceEmit("tool.dispatched", "bash");
		traceEmit("tool.success", "ls done");
	});

	it("recent(2) returns the 2 most recent events newest-first", () => {
		const recent = trace.recent(2);
		expect(recent).toHaveLength(2);
		expect(recent[0].summary).toBe("ls done");
		expect(recent[1].summary).toBe("bash");
	});

	it("query() filters by predicate", () => {
		const userEvents = trace.query((e) => e.kind === "user.input");
		expect(userEvents).toHaveLength(2);
		expect(userEvents.map((e) => e.summary)).toEqual(["msg2", "msg1"]);
	});

	it("query() respects the limit", () => {
		const userEvents = trace.query((e) => e.kind === "user.input", 1);
		expect(userEvents).toHaveLength(1);
	});
});

describe("traceTimer()", () => {
	it("captures durationMs on completion", async () => {
		const end = traceTimer("tool.success", "did something");
		await new Promise((r) => setTimeout(r, 20));
		end({ success: true });
		const recent = trace.recent(1);
		expect(recent[0].durationMs).toBeGreaterThanOrEqual(15);
	});

	it("sets level=error when success=false", () => {
		const end = traceTimer("tool.success", "failed");
		end({ success: false, data: { reason: "boom" } });
		const recent = trace.recent(1);
		expect(recent[0].level).toBe("error");
		expect(recent[0].data?.reason).toBe("boom");
	});
});

describe("ring buffer", () => {
	it("evicts oldest events when capacity is reached", () => {
		// 10_000 is the capacity. Emit slightly more.
		for (let i = 0; i < 10_005; i++) {
			traceEmit("user.input", `msg-${i}`);
		}
		const stats = trace.stats();
		expect(stats.size).toBe(stats.capacity);
		const recent = trace.recent(10_000);
		expect(recent).toHaveLength(10_000);
		expect(recent[0].summary).toBe("msg-10004");
		// msg-0..msg-4 should be evicted.
		const summaries = recent.map((e) => e.summary);
		expect(summaries).not.toContain("msg-0");
		expect(summaries).not.toContain("msg-4");
		expect(summaries).toContain("msg-5");
	});

	it("clearRing() empties the buffer without touching the log", () => {
		traceEmit("user.input", "x");
		trace.flushSync();
		trace.clearRing();
		expect(trace.recent()).toHaveLength(0);
		const logPath = trace.getLogPath();
		if (logPath) {
			const size = fs.statSync(logPath).size;
			expect(size).toBeGreaterThan(0);
		}
	});
});

describe("defaultTraceLogPath()", () => {
	it("respects TEHUTI_HOME", () => {
		process.env.TEHUTI_HOME = "/custom/home";
		try {
			expect(defaultTraceLogPath()).toBe("/custom/home/trace.jsonl");
		} finally {
			delete process.env.TEHUTI_HOME;
		}
	});

	it("respects TEHUTI_TRACE_LOG override", () => {
		process.env.TEHUTI_TRACE_LOG = "/override/log.jsonl";
		try {
			expect(defaultTraceLogPath()).toBe("/override/log.jsonl");
		} finally {
			delete process.env.TEHUTI_TRACE_LOG;
		}
	});
});

describe("initTrace()", () => {
	it("configures with the default log path", () => {
		trace.close();
		trace.configure("/tmp/should-be-overwritten.jsonl");
		initTrace();
		const logPath = trace.getLogPath();
		expect(logPath).toBe(defaultTraceLogPath());
		trace.close();
	});
});

describe("durable interaction journal", () => {
	it("persists ordered, session-correlated lifecycle events and tolerates malformed lines", async () => {
		const logPath = path.join(testDir, "absent-trace.jsonl");
		trace.close();
		fs.rmSync(logPath, { force: true });
		process.env.TEHUTI_TRACE_LOG = logPath;
		try {
			initTrace();
			expect(fs.existsSync(logPath)).toBe(true);

			trace.setSession("session-journal-test");
			trace.setActor("chat-ui");
			traceEmit("session.create", "Created session");
			traceEmit("user.input", "Submitted user input", {
				data: { text: "Ship the journal", apiKey: "super-secret-token" },
			});
			traceEmit("user.command", "Submitted slash command", {
				data: { command: "/save" },
			});
			traceEmit("model.request", "Model request started", {
				actor: "agent-runner",
				data: { provider: "opencode", model: "deepseek-v4-flash" },
			});
			traceEmit("model.response", "Model request completed", {
				actor: "agent-runner",
				durationMs: 12,
				data: { totalTokens: 42 },
			});
			traceEmit("tool.start", "Tool started: read_file", {
				actor: "tool-processor",
				correlationId: "tool-1",
				data: { tool: "read_file" },
			});
			traceEmit("tool.success", "Tool completed: read_file", {
				actor: "tool-processor",
				correlationId: "tool-1",
				durationMs: 4,
				data: { tool: "read_file", outputBytes: 9000 },
			});
			traceEmit("lifecycle.error", "Visible error", {
				level: "error",
				data: { message: "network unavailable" },
			});
			fs.appendFileSync(logPath, "not valid json\n");

			const persisted = await readPersistedTrace(logPath);
			expect(persisted.map((event) => event.kind)).toEqual([
				"session.create",
				"user.input",
				"user.command",
				"model.request",
				"model.response",
				"tool.start",
				"tool.success",
				"lifecycle.error",
			]);
			expect(persisted.every((event) => event.sessionId === "session-journal-test")).toBe(true);
			expect(persisted.every((event) => event.actor.length > 0 && event.ts > 0)).toBe(true);
			expect(JSON.stringify(persisted)).not.toContain("super-secret-token");
		} finally {
			delete process.env.TEHUTI_TRACE_LOG;
		}
	});
});
