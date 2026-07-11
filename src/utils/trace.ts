/**
 * Central per-second trace system for Tehuti.
 *
 * Every observable event in the system — tool calls, file I/O, commands,
 * subagent lifecycle, model responses, lifecycle changes, user input,
 * errors — emits a TraceEvent through this collector. Events are:
 *
 *  1. Appended to an in-memory ring buffer (default last 10,000 events) for
 *     fast in-process queries.
 *  2. Written to `~/.tehuti/trace.jsonl` as line-delimited JSON, append-only,
 *     so the history survives process exit.
 *  3. Optionally mirrored to `debug.log` when TEHUTI_DEBUG=true.
 *
 * The collector is a singleton (process-wide) so subagent and tool events
 * are automatically correlated to the active session via `setSession()`.
 * Cross-process traces (subagents are forked) use a `parentId` to tie back
 * to the parent. Each event has a monotonic `ts` (ms) and an ISO `iso` for
 * human readability.
 *
 * Design constraints:
 *  - Fire-and-forget: emit() must never block, never throw, never allocate
 *    large objects on the hot path. The ring buffer is preallocated.
 *  - Persistent: the on-disk log uses O_APPEND so a crash leaves a clean
 *    file (no torn lines).
 *  - Cheap: emit() is O(1) and writes are batched (default 1 second OR 64
 *    events per flush).
 *  - Truncation: long strings in `data` are clamped to bound memory.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { debug } from "./debug.js";

export type TraceKind =
	// Model
	| "model.request"
	| "model.response"
	| "model.token"
	| "model.thinking"
	| "model.error"
	// Tool calls
	| "tool.dispatched"
	| "tool.start"
	| "tool.success"
	| "tool.error"
	| "tool.cache_hit"
	| "tool.cache_miss"
	| "tool.retry"
	// File I/O
	| "file.read"
	| "file.write"
	| "file.edit"
	| "file.list"
	| "file.glob"
	| "file.delete"
	// Shell
	| "shell.start"
	| "shell.stdout"
	| "shell.stderr"
	| "shell.exit"
	| "shell.signal"
	| "shell.timeout"
	// Network
	| "http.request"
	| "http.response"
	| "http.error"
	| "ws.open"
	| "ws.close"
	| "ws.message"
	| "mcp.request"
	| "mcp.response"
	// Subagent
	| "subagent.spawn"
	| "subagent.ready"
	| "subagent.token"
	| "subagent.thinking"
	| "subagent.tool_call"
	| "subagent.tool_result"
	| "subagent.message_in"
	| "subagent.message_out"
	| "subagent.completed"
	| "subagent.failed"
	| "subagent.killed"
	| "subagent.exit"
	// Session
	| "session.create"
	| "session.save"
	| "session.load"
	| "session.list"
	| "session.compress"
	| "session.export"
	| "session.import"
	| "session.delete"
	| "session.cleanup"
	| "session.prune"
	// Memory
	| "memory.read"
	| "memory.write"
	| "memory.search"
	| "memory.consolidate"
	| "memory.evict"
	// Cache
	| "cache.hit"
	| "cache.miss"
	| "cache.evict"
	| "cache.fill"
	// Lifecycle
	| "lifecycle.startup"
	| "lifecycle.shutdown"
	| "lifecycle.signal"
	| "lifecycle.error"
	| "lifecycle.unhandled_rejection"
	// User
	| "user.input"
	| "user.interrupt"
	| "user.command"
	// Prefetch
	| "prefetch.predict"
	| "prefetch.hit"
	| "prefetch.miss";

export type TraceLevel = "debug" | "info" | "warn" | "error";

export interface TraceEvent {
	/** Monotonic-ish ms timestamp (Date.now()). */
	ts: number;
	/** ISO timestamp for human readability. */
	iso: string;
	/** Event level for filtering. */
	level: TraceLevel;
	/** Event kind — what happened. */
	kind: TraceKind;
	/** Session this event belongs to (null if no session). */
	sessionId: string | null;
	/** Parent event id (for nested tool calls, subagent dispatch, etc.). */
	parentId: string | null;
	/** Actor: which component emitted the event. */
	actor: string;
	/** Short one-line summary (always present, <= 200 chars). */
	summary: string;
	/** Optional structured data (truncated per field). */
	data?: Record<string, unknown>;
	/** Optional duration in ms (for events with a clear start/end). */
	durationMs?: number;
	/** Optional correlation id (e.g. tool call id, request id). */
	correlationId?: string;
	/** Subagent id (for subagent.* events). */
	subagentId?: string;
	/** True if emitted from a forked subagent process. */
	fromSubagent?: boolean;
}

/** In-memory ring buffer size. */
const TRACE_RING_SIZE = 10_000;
/** Flush threshold: events. */
const TRACE_FLUSH_EVENTS = 64;
/** Flush threshold: ms. */
const TRACE_FLUSH_MS = 1_000;

/** Max size of any single string in `data` to bound memory. */
const TRACE_MAX_FIELD = 8 * 1024;

function clampString(value: string, max: number): string {
	if (value.length <= max) return value;
	return `${value.slice(0, max)}…(+${value.length - max})`;
}

function clampData(
	data: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
	if (!data) return undefined;
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(data)) {
		if (typeof v === "string") {
			out[k] = clampString(v, TRACE_MAX_FIELD);
		} else if (typeof v === "number" || typeof v === "boolean" || v == null) {
			out[k] = v;
		} else if (v instanceof Error) {
			out[k] = {
				name: v.name,
				message: clampString(v.message, TRACE_MAX_FIELD),
				stack: v.stack ?? undefined,
			};
		} else if (Array.isArray(v)) {
			if (v.length > 32) {
				out[k] = `[Array(${v.length})]`;
			} else {
				out[k] = v.slice(0, 32);
			}
		} else if (typeof v === "object") {
			const keys = Object.keys(v as object);
			if (keys.length > 32) {
				out[k] = `[Object(${keys.length} keys)]`;
			} else {
				out[k] = clampData(v as Record<string, unknown>);
			}
		} else {
			out[k] = String(v);
		}
	}
	return out;
}

class TraceCollector {
	private buffer: Array<TraceEvent | undefined> = [];
	private nextIndex = 0;
	private size = 0;
	private fd: number | null = null;
	private logPath: string | null = null;
	private dirty = 0;
	private lastFlush = Date.now();
	private currentSessionId: string | null = null;
	private currentActor = "main";
	private closed = false;
	private enabled = true;
	private writeQueue: string[] = [];
	private writing = false;
	private flushScheduled = false;

	/**
	 * Configure the on-disk log file. Safe to call multiple times.
	 * If never called, the trace stays in-memory only.
	 *
	 * Calling configure() also re-enables the collector if it was previously
	 * closed. Use this when you want a fresh log target (e.g. in tests).
	 */
	configure(logPath: string): void {
		try {
			if (this.fd != null) {
				fs.closeSync(this.fd);
				this.fd = null;
			}
			fs.mkdirSync(path.dirname(logPath), { recursive: true });
			this.fd = fs.openSync(logPath, "a");
			this.logPath = logPath;
			this.closed = false;
			this.writeQueue = [];
			this.dirty = 0;
		} catch (err) {
			debug.log(
				"agent",
				`TraceCollector: failed to open log ${logPath}: ${err}`,
			);
			this.fd = null;
			this.logPath = null;
		}
	}

	setEnabled(value: boolean): void {
		this.enabled = value;
	}

	isEnabled(): boolean {
		return this.enabled;
	}

	setSession(id: string | null): void {
		this.currentSessionId = id;
	}

	setActor(actor: string): void {
		this.currentActor = actor;
	}

	getSessionId(): string | null {
		return this.currentSessionId;
	}

	getActor(): string {
		return this.currentActor;
	}

	getLogPath(): string | null {
		return this.logPath;
	}

	/**
	 * Emit a trace event. Fire-and-forget; never throws.
	 */
	emit(partial: Omit<TraceEvent, "ts" | "iso" | "actor" | "sessionId">): void {
		if (!this.enabled) return;
		if (this.closed) return;
		const ts = Date.now();
		const event: TraceEvent = {
			ts,
			iso: new Date(ts).toISOString(),
			level: partial.level,
			kind: partial.kind,
			summary: clampString(partial.summary, 200),
			actor: this.currentActor,
			sessionId: this.currentSessionId,
			parentId: partial.parentId ?? null,
			data: clampData(partial.data),
			durationMs: partial.durationMs,
			correlationId: partial.correlationId,
			subagentId: partial.subagentId,
			fromSubagent: partial.fromSubagent,
		};

		// 1) Ring buffer
		this.buffer[this.nextIndex] = event;
		if (this.size < TRACE_RING_SIZE) {
			this.size++;
		}
		this.nextIndex = (this.nextIndex + 1) % TRACE_RING_SIZE;

		// 2) On-disk log (queued, drained asynchronously)
		if (this.fd != null) {
			this.writeQueue.push(`${JSON.stringify(event)}\n`);
			this.dirty++;
			if (
				this.dirty >= TRACE_FLUSH_EVENTS ||
				ts - this.lastFlush >= TRACE_FLUSH_MS
			) {
				this.scheduleFlush();
			}
		}

		// 3) Debug mirror
		if (debug.isEnabled()) {
			debug.log("agent", `[trace] ${event.kind} ${event.summary}`);
		}
	}

	private scheduleFlush(): void {
		if (this.flushScheduled || this.writing) return;
		this.flushScheduled = true;
		setImmediate(() => {
			this.flushScheduled = false;
			this.flush();
		});
	}

	private flush(): void {
		if (this.fd == null || this.writeQueue.length === 0) {
			this.dirty = 0;
			this.lastFlush = Date.now();
			return;
		}
		const batch = this.writeQueue.join("");
		this.writeQueue = [];
		this.dirty = 0;
		this.lastFlush = Date.now();
		this.writing = true;
		try {
			fs.writeSync(this.fd, batch);
		} catch (err) {
			debug.log("agent", `TraceCollector: write failed: ${err}`);
		} finally {
			this.writing = false;
		}
	}

	/** Force a synchronous flush. Call on process exit / before snapshot. */
	flushSync(): void {
		this.flush();
	}

	/** Close the log file. Idempotent. */
	close(): void {
		if (this.closed) return;
		this.closed = true;
		this.flushSync();
		if (this.fd != null) {
			try {
				fs.closeSync(this.fd);
			} catch {
				/* ignore */
			}
			this.fd = null;
		}
	}

	/**
	 * Return the most recent N events from the ring buffer, newest first.
	 */
	recent(limit = 100): TraceEvent[] {
		const n = Math.min(limit, this.size);
		const out: TraceEvent[] = [];
		for (let i = 0; i < n; i++) {
			const idx = (this.nextIndex - 1 - i + TRACE_RING_SIZE) % TRACE_RING_SIZE;
			const e = this.buffer[idx];
			if (e) out.push(e);
		}
		return out;
	}

	/**
	 * Filter events by predicate. Reads the ring buffer in newest-first order.
	 */
	query(predicate: (e: TraceEvent) => boolean, limit = 100): TraceEvent[] {
		const out: TraceEvent[] = [];
		for (let i = 0; i < this.size && out.length < limit; i++) {
			const idx = (this.nextIndex - 1 - i + TRACE_RING_SIZE) % TRACE_RING_SIZE;
			const e = this.buffer[idx];
			if (e && predicate(e)) out.push(e);
		}
		return out;
	}

	/**
	 * Get ring buffer stats.
	 */
	stats(): {
		size: number;
		capacity: number;
		enabled: boolean;
		logPath: string | null;
	} {
		return {
			size: this.size,
			capacity: TRACE_RING_SIZE,
			enabled: this.enabled,
			logPath: this.logPath,
		};
	}

	/**
	 * Clear the ring buffer (does not touch the on-disk log).
	 */
	clearRing(): void {
		this.buffer = [];
		this.nextIndex = 0;
		this.size = 0;
	}
}

/**
 * Process-wide singleton trace collector.
 */
export const trace = new TraceCollector();

/**
 * Convenience helper: emit a trace event with the current actor and session
 * pre-filled. Fire-and-forget.
 */
export function traceEmit(
	kind: TraceKind,
	summary: string,
	opts: {
		level?: TraceLevel;
		data?: Record<string, unknown>;
		durationMs?: number;
		correlationId?: string;
		parentId?: string;
		subagentId?: string;
		fromSubagent?: boolean;
		actor?: string;
		sessionId?: string | null;
	} = {},
): void {
	if (!trace.isEnabled()) return;

	trace.emit({
		kind,
		level: opts.level ?? "info",
		summary,
		data: opts.data,
		durationMs: opts.durationMs,
		correlationId: opts.correlationId,
		parentId: opts.parentId ?? null,
		subagentId: opts.subagentId,
		fromSubagent: opts.fromSubagent,
	});
}

/**
 * Timer helper: emits `kind` on completion with `durationMs` set.
 */
export function traceTimer(
	kind: TraceKind,
	summary: string,
	extra: {
		level?: TraceLevel;
		correlationId?: string;
		parentId?: string;
		subagentId?: string;
		fromSubagent?: boolean;
	} = {},
): (result?: {
	success?: boolean;
	data?: Record<string, unknown>;
	level?: TraceLevel;
}) => void {
	if (!trace.isEnabled()) {
		return () => {};
	}
	const start = Date.now();
	return (result) => {
		const r = result ?? {};
		trace.emit({
			kind,
			level: r.success === false ? "error" : (extra.level ?? "info"),
			summary,
			data: r.data,
			durationMs: Date.now() - start,
			correlationId: extra.correlationId,
			parentId: extra.parentId ?? null,
			subagentId: extra.subagentId,
			fromSubagent: extra.fromSubagent,
		});
	};
}

/**
 * Default on-disk log path under ~/.tehuti.
 */
export function defaultTraceLogPath(): string {
	const baseDir =
		process.env.TEHUTI_HOME ||
		(process.env.VITEST
			? path.join(os.tmpdir(), "tehuti-vitest")
			: path.join(os.homedir(), ".tehuti"));
	return process.env.TEHUTI_TRACE_LOG || path.join(baseDir, "trace.jsonl");
}

/**
 * Initialize the trace collector with the default log path.
 */
export function initTrace(): void {
	trace.configure(defaultTraceLogPath());
}

let _traceIdCounter = 0;

/**
 * Fast trace/correlation ID generator.
 * Much faster than crypto.randomUUID() for high-throughput tracing.
 */
export function generateTraceId(): string {
	_traceIdCounter = (_traceIdCounter + 1) % 1_000_000;
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}-${_traceIdCounter.toString(36)}`;
}

export default trace;
