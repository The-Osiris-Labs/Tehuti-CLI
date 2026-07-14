import { randomUUID } from "node:crypto";
import { open } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import Fuse from "fuse.js";
import { v4 as uuidv4 } from "uuid";
import type { AgentContext } from "../agent/context.js";
import type { CompactionDigest } from "../agent/context-compressor.js";
import { exportState, importState } from "../agent/subagents/manager.js";
import { swarmManager } from "../agent/swarm/manager.js";
import type { StandardMessage } from "../api/base-client.js";
import type { TehutiConfig } from "../config/schema.js";
import { debug } from "../utils/debug.js";
import { metrics } from "../utils/metrics.js";
import { AsyncMutex } from "../utils/mutex.js";
import { consola } from "../utils/logger.js";
import { SessionBackup } from "./backup.js";

const UUID_REGEX =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidSessionId(id: string): boolean {
	return UUID_REGEX.test(id);
}

/**
 * Safely extract the last user message text from a messages array.
 * Handles both string and ContentBlock[] content formats.
 */
function extractTextContent(messages: StandardMessage[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg.role !== "user") continue;
		if (typeof msg.content === "string") return msg.content;
		if (Array.isArray(msg.content)) {
			return msg.content
				.map((b) => (typeof b === "object" && "text" in b ? b.text : ""))
				.join(" ")
				.trim();
		}
	}
	return "";
}

/**
 * Write a JSON file atomically with an fsync barrier. This protects against
 * power-loss / SIGKILL leaving the on-disk file in a half-written state: the
 * data is fsync'd to the journal BEFORE the temp file is renamed, so the
 * rename is a single atomic operation visible to subsequent readers.
 *
 * Cost: 1 extra fsync per write (~1-10ms on SSD, more on spinning disk).
 * Without it, a crash between write() and rename() can leave the final file
 * empty or truncated even though the rename hasn't happened yet.
 */
export async function writeJsonAtomic(
	filePath: string,
	data: unknown,
): Promise<void> {
	const tempPath = `${filePath}.${randomUUID()}.tmp`;
	const json = JSON.stringify(data, null, 2);
	const handle = await open(tempPath, "w");
	try {
		await handle.writeFile(json, "utf8");
		// Force the kernel page cache to disk BEFORE we rename. The OS may
		// otherwise reorder the data write vs. the directory entry update
		// (the rename), leaving the file invisible after a crash.
		await handle.sync();
	} finally {
		await handle.close();
	}
	try {
		await fs.rename(tempPath, filePath);
	} catch (error: any) {
		// Clean up temp file on failure, then rethrow.
		// EXDEV (cross-device link) is impossible here because tempPath and
		// filePath share the same directory by construction.
		try {
			await fs.unlink(tempPath);
		} catch (cleanupErr) {
			debug.log("session", "Failed to cleanup temp file after rename failure:", cleanupErr);
		}
		throw error;
	}
}

/**
 * Defensive shape check for session.json. The schema is permissive: unknown
 * fields are passed through, but required fields must be present and typed
 * correctly. Returning null causes the loader to reject the file rather
 * than crash later on a missing field.
 */
function validateSessionData(data: unknown): data is SessionData {
	if (!data || typeof data !== "object") return false;
	const d = data as Record<string, unknown>;

	if (!d.metadata || typeof d.metadata !== "object") return false;
	const m = d.metadata as Record<string, unknown>;
	if (
		typeof m.id !== "string" ||
		typeof m.cwd !== "string" ||
		typeof m.model !== "string" ||
		typeof m.messageCount !== "number" ||
		typeof m.toolCalls !== "number" ||
		typeof m.tokensUsed !== "number"
	) {
		return false;
	}

	if (!Array.isArray(d.messages)) return false;
	if (!Array.isArray(d.appendOnlyLog)) return false;

	if (!d.context || typeof d.context !== "object") return false;
	const c = d.context as Record<string, unknown>;
	if (typeof c.cwd !== "string" || typeof c.workingDir !== "string") {
		return false;
	}
	if (!c.metadata || typeof c.metadata !== "object") return false;
	if (!Array.isArray(c.readFilesThisSession)) return false;

	// Validate every message has a role. This catches files written by a
	// future schema that removes the role field, before we hit a provider
	// API that rejects them.
	for (const msg of d.messages as unknown[]) {
		if (
			!msg ||
			typeof msg !== "object" ||
			typeof (msg as Record<string, unknown>).role !== "string"
		) {
			return false;
		}
	}

	return true;
}

export interface SessionMetadata {
	id: string;
	name?: string;
	provider?: string;
	baseUrl?: string;
	customProvider?: TehutiConfig["customProvider"];
	createdAt: string;
	updatedAt: string;
	cwd: string;
	model: string;
	messageCount: number;
	lastMessageContent?: string;
	toolCalls: number;
	tokensUsed: number;
}

type SessionSeed = Pick<
	SessionMetadata,
	"provider" | "baseUrl" | "customProvider"
>;

export interface SessionData {
	metadata: SessionMetadata;
	messages: StandardMessage[];
	appendOnlyLog: StandardMessage[];
	/** New sessions store the full append-only transcript outside session.json. */
	archiveFile?: string;
	context: {
		cwd: string;
		workingDir: string;
		metadata: AgentContext["metadata"];
		readFilesThisSession: string[];
		compactionHistory?: CompactionDigest[];
	};
	subagentsState?: any;
	swarmState?: any;
}

/**
 * Resolve a path to its canonical form, returning the original string on any
 * failure (ENOENT, non-string, permission errors). Used by getRecentSession so
 * that symlinked cwd paths (e.g. macOS /tmp -> /private/tmp, or
 * /var/folders/... vs /private/var/folders/...) still match saved session cwd
 * values. Resolving at lookup time (rather than at write time) is intentional:
 * the saved `metadata.cwd` is preserved exactly as the user typed it, so we
 * don't have to migrate existing session files.
 */
async function safeRealpath(p: unknown): Promise<string> {
	if (typeof p !== "string" || !p) return "";
	try {
		return await fs.realpath(p);
	} catch {
		return typeof p === "string" ? p : "";
	}
}

function normalizeStartTime(value: unknown): Date {
	if (value instanceof Date && !Number.isNaN(value.getTime())) {
		return value;
	}

	if (typeof value === "string" || typeof value === "number") {
		const parsed = new Date(value);
		if (!Number.isNaN(parsed.getTime())) {
			return parsed;
		}
	}

	return new Date();
}

function normalizeSessionData(data: SessionData): SessionData {
	return {
		...data,
		context: {
			...data.context,
			metadata: {
				...data.context.metadata,
				startTime: normalizeStartTime(data.context.metadata?.startTime),
			},
		},
	};
}

class SessionManager {
	private sessionsDir: string;
	private currentSessionId: string | null = null;
	private saveTimer: NodeJS.Timeout | null = null;
	private autoSaveTimer: NodeJS.Timeout | null = null;
	private backup?: SessionBackup;
	/** Serializes concurrent saveSession calls to prevent corrupted writes. */
	private readonly saveMutex = new AsyncMutex();
	constructor() {
		const baseDir =
			process.env.TEHUTI_HOME ||
			(process.env.VITEST
				? path.join(os.tmpdir(), "tehuti-vitest")
				: path.join(os.homedir(), ".tehuti"));
		this.sessionsDir = path.join(baseDir, "sessions");
		this.ensureSessionsDir();
	}
	private getBackup(): SessionBackup {
		if (!this.backup) {
			this.backup = new SessionBackup(this.sessionsDir);
		}
		return this.backup;
	}

	getSessionsDir(): string {
		return this.sessionsDir;
	}

	private async ensureSessionsDir(): Promise<void> {
		await fs.ensureDir(this.sessionsDir);
	}

	/**
	 * Removes orphaned .tmp files left behind by interrupted atomic writes.
	 * Safe to run on every startup: the .tmp files are only written via the
	 * temp+rename pattern in saveSession/saveSessionMetadata/renameSession, and
	 * if they're still around it means the previous run was killed mid-write.
	 * Removing them is correct because the corresponding final file is already
	 * in its previous valid state (rename hadn't happened yet).
	 */
	private async cleanupOrphanedTempFiles(): Promise<void> {
		try {
			const dirs = await fs.readdir(this.sessionsDir);
			for (const dir of dirs) {
				const sessionDir = path.join(this.sessionsDir, dir);
				const stat = await fs.stat(sessionDir).catch(() => null);
				if (!stat?.isDirectory()) continue;
				// Match UUID-suffixed temp files: <name>.<uuid>.tmp
				const entries = await fs
					.readdir(sessionDir)
					.catch(() => [] as string[]);
				for (const entry of entries) {
					if (entry.endsWith(".tmp")) {
						await fs.remove(path.join(sessionDir, entry)).catch(() => {});
					}
				}
			}
		} catch {
			// Best-effort cleanup; never fail startup on this
		}
	}

	generateAutoName(
		cwd: string,
		_model: string,
		messages?: StandardMessage[],
	): string {
		// Try to get name from first user message
		if (messages && messages.length > 0) {
			const firstUserMsg = messages.find((m) => m.role === "user");
			if (firstUserMsg && typeof firstUserMsg.content === "string") {
				let name = firstUserMsg.content
					.trim()
					.split(/\s+/)
					.slice(0, 5)
					.join(" ");
				// Truncate and add ellipsis if too long
				if (name.length > 30) {
					name = `${name.slice(0, 27)}...`;
				}
				if (name) {
					return name;
				}
			}
		}

		// Fallback to date/time format
		const date = new Date();
		const dateStr = date.toLocaleDateString("en-US", {
			month: "short",
			day: "numeric",
		});
		const timeStr = date.toLocaleTimeString("en-US", {
			hour: "2-digit",
			minute: "2-digit",
		});
		const project = path.basename(cwd) || "session";
		return `${project} - ${dateStr} ${timeStr}`;
	}

	async createSession(
		cwd: string,
		model: string,
		name?: string,
		seed?: SessionSeed,
	): Promise<string> {
		const id = uuidv4();
		const sessionDir = path.join(this.sessionsDir, id);
		await fs.ensureDir(sessionDir);

		const autoName = name ?? this.generateAutoName(cwd, model);
		const resolvedProvider = seed?.provider?.trim();
		const resolvedBaseUrl = seed?.baseUrl?.trim();
		const resolvedCustomProvider = seed?.customProvider;

		const metadata: SessionMetadata = {
			id,
			name: autoName,
			provider: resolvedProvider,
			baseUrl: resolvedBaseUrl,
			customProvider: resolvedCustomProvider,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			cwd,
			model,
			messageCount: 0,
			toolCalls: 0,
			tokensUsed: 0,
			lastMessageContent: "",
		};

		await this.saveSessionMetadata(id, metadata);
		this.currentSessionId = id;

		debug.log("session", `Created session: ${id} (${autoName})`);
		return id;
	}

	async saveSession(
		id: string,
		ctx: AgentContext,
		name?: string,
	): Promise<void> {
		if (!isValidSessionId(id)) {
			consola.error(`Invalid session ID format: ${id}`);
			return;
		}

		await this.saveMutex.runExclusive(async () => {
			const sessionDir = path.join(this.sessionsDir, id);
			await fs.ensureDir(sessionDir);

			const existingMetadata = await this.getSessionMetadata(id);
			const sessionName =
				name ??
				existingMetadata?.name ??
				this.generateAutoName(ctx.cwd, ctx.config.model, ctx.messages);

			const metadata: SessionMetadata = {
				id,
				name: sessionName,
				provider: ctx.config.provider,
				baseUrl: ctx.config.baseUrl,
				customProvider: ctx.config.customProvider,
				createdAt: existingMetadata?.createdAt ?? new Date().toISOString(),
				updatedAt: new Date().toISOString(),
				cwd: ctx.cwd,
				model: ctx.config.model,
				messageCount: ctx.messages.length,
				toolCalls: ctx.metadata.toolCalls,
				tokensUsed: ctx.metadata.tokensUsed,
				lastMessageContent: extractTextContent(
					ctx.messages,
				).substring(0, 60),
			};

			await this.saveSessionMetadata(id, metadata);

			const archive = ctx.appendOnlyLog || ctx.messages;
			const needsExternalArchive =
				archive.length > ctx.messages.length ||
				(ctx.compactionHistory?.length ?? 0) > 0;
			const sessionData: SessionData = {
				metadata,
				messages: ctx.messages,
				// Keep ordinary sessions backward-compatible. Once compaction creates
				// a larger audit transcript, move that transcript to archive.json so
				// repeated checkpoints do not duplicate it inside session.json.
				appendOnlyLog: needsExternalArchive ? [] : archive,
				archiveFile: needsExternalArchive ? "archive.json" : undefined,
				context: {
					cwd: ctx.cwd,
					workingDir: ctx.workingDir,
					metadata: ctx.metadata,
					readFilesThisSession: Array.from(ctx.readFilesThisSession || []),
					compactionHistory: ctx.compactionHistory,
				},
				subagentsState: exportState(),
				swarmState: swarmManager.exportState(),
			};

			// Backup existing session before overwriting
			try {
				await this.getBackup().createBackup(id);
			} catch (err) {
				debug.log("session", `Backup failed: ${err}`);
				// Don't fail save if backup fails
			}
			const sessionFile = path.join(sessionDir, "session.json");
			if (sessionData.archiveFile) {
				const archiveFile = path.join(sessionDir, sessionData.archiveFile);
				await writeJsonAtomic(archiveFile, archive);
			}
			await writeJsonAtomic(sessionFile, sessionData);
			metrics.counter('session.save');
			metrics.histogram('session.size', ctx.messages.length);

			debug.log(
				"session",
				`Saved session: ${id} (${sessionName}, ${ctx.messages.length} messages)`,
			);
		});
	}

	/**
	 * Schedule a debounced auto-save (500ms). Multiple rapid state changes
	 * coalesce into a single write. Callers should use this instead of
	 * saveSession for automatic saves triggered by message/state changes.
	 * Immediate saves (/save, exit) should still call saveSession directly.
	 */
	scheduleSave(
		id: string,
		ctx: AgentContext,
		name?: string,
	): void {
		this.clearSaveTimer();
		this.saveTimer = setTimeout(() => {
			this.saveTimer = null;
			this.saveSession(id, ctx, name).catch((err: unknown) => {
				debug.log("session", `Debounced auto-save failed: ${err}`);
			});
		}, 500);
	}

	private clearSaveTimer(): void {
		if (this.saveTimer !== null) {
			clearTimeout(this.saveTimer);
			this.saveTimer = null;
		}
	}

	async loadSession(id: string): Promise<SessionData | null> {
		if (!isValidSessionId(id)) {
			consola.error(`Invalid session ID format: ${id}`);
			return null;
		}

		const sessionDir = path.join(this.sessionsDir, id);
		const sessionFile = path.join(sessionDir, "session.json");

		if (!(await fs.pathExists(sessionFile))) {
			return null;
		}

		try {
			const rawData = (await fs.readJson(sessionFile)) as SessionData;
			if (!validateSessionData(rawData)) {
				consola.error(`Session ${id} has invalid structure (refusing to load)`);
				return null;
			}
			const data = normalizeSessionData(rawData);
			if (
				data.archiveFile &&
				path.basename(data.archiveFile) === data.archiveFile
			) {
				const archivePath = path.join(sessionDir, data.archiveFile);
				if (await fs.pathExists(archivePath)) {
					const archive = await fs.readJson(archivePath);
					if (Array.isArray(archive)) {
						data.appendOnlyLog = archive as StandardMessage[];
					}
				}
			}
			if (data.subagentsState) importState(data.subagentsState);
			if (data.swarmState) swarmManager.importState(data.swarmState);
			this.currentSessionId = id;
			debug.log("session", `Loaded session: ${id}`);
			return data;
		} catch (error) {
			consola.error(`Failed to load session ${id}: ${error}`);
			return null;
		}
	}

	async getSessionMetadata(id: string): Promise<SessionMetadata | null> {
		const metaFile = path.join(this.sessionsDir, id, "metadata.json");

		if (!(await fs.pathExists(metaFile))) {
			return null;
		}

		try {
			return (await fs.readJson(metaFile)) as SessionMetadata;
		} catch {
			return null;
		}
	}

	private async saveSessionMetadata(
		id: string,
		metadata: SessionMetadata,
	): Promise<void> {
		const sessionDir = path.join(this.sessionsDir, id);
		await fs.ensureDir(sessionDir);
		const metaFile = path.join(sessionDir, "metadata.json");
		// Atomic write: temp file + rename (see writeJsonAtomic in this file).
		// A SIGKILL or power loss during the write leaves the previous
		// metadata.json intact; the orphaned <file>.<uuid>.tmp is cleaned up
		// on the next startup by cleanupOrphanedTempFiles().
		await writeJsonAtomic(metaFile, metadata);
	}

	async renameSession(id: string, name: string): Promise<void> {
		if (!isValidSessionId(id)) {
			consola.error(`Invalid session ID format: ${id}`);
			return;
		}

		const metadata = await this.getSessionMetadata(id);
		if (!metadata) {
			consola.error(`Session metadata not found for ID: ${id}`);
			return;
		}

		try {
			metadata.name = name;
			await this.saveSessionMetadata(id, metadata);

			const sessionFile = path.join(this.sessionsDir, id, "session.json");
			if (await fs.pathExists(sessionFile)) {
				const data = (await fs.readJson(sessionFile)) as SessionData;
				data.metadata.name = name;
				// Atomic write with fsync (same pattern as saveSession).
				await writeJsonAtomic(sessionFile, data);
			}
			debug.log("session", `Renamed session: ${id} to "${name}"`);
		} catch (error) {
			consola.error(`Failed to rename session ${id}: ${error}`);
		}
	}

	async listSessions(): Promise<SessionMetadata[]> {
		await this.ensureSessionsDir();
		await this.cleanupOrphanedTempFiles();

		const dirs = await fs.readdir(this.sessionsDir);
		const sessions: SessionMetadata[] = [];
		const concurrencyLimit = 10;

		for (let i = 0; i < dirs.length; i += concurrencyLimit) {
			const chunk = dirs.slice(i, i + concurrencyLimit);
			const results = await Promise.all(
				chunk.map((dir) => this.getSessionMetadata(dir)),
			);
			for (const metadata of results) {
				if (metadata) {
					sessions.push(metadata);
				}
			}
		}

		return sessions.sort(
			(a, b) =>
				new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
		);
	}

	async searchSessions(query: string): Promise<SessionMetadata[]> {
		const allSessions = await this.listSessions();

		if (!query.trim()) {
			return allSessions;
		}

		const fuse = new Fuse(allSessions, {
			keys: [
				{ name: "name", weight: 2 },
				{ name: "model", weight: 1 },
				{ name: "id", weight: 0.8 },
				{ name: "createdAt", weight: 0.5 },
				{ name: "updatedAt", weight: 0.5 },
			],
			threshold: 0.4,
			ignoreLocation: true,
			includeScore: false,
		});

		const results = fuse.search(query.trim());
		return results
			.map((result) => result.item)
			.sort(
				(a, b) =>
					new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
			);
	}

	async deleteSession(id: string): Promise<void> {
		if (!isValidSessionId(id)) {
			consola.error(`Invalid session ID format: ${id}`);
			return;
		}
		const sessionDir = path.join(this.sessionsDir, id);
		await fs.remove(sessionDir);

		try {
			const { default: db } = await import("../agent/memory/db.js");
			const stmt = db.prepare(
				"DELETE FROM messaging_sessions WHERE tehuti_session_id = ?",
			);
			stmt.run(id);
		} catch (error) {
			consola.error(`Failed to delete session from database: ${error}`);
		}

		debug.log("session", `Deleted session: ${id}`);
	}

	async getRecentSession(cwd: string): Promise<string | null> {
		const sessions = await this.listSessions();
		const target = await safeRealpath(cwd);
		for (const session of sessions) {
			if (session.cwd === cwd) return session.id;
			if (session.cwd === target) return session.id;
			const saved = await safeRealpath(session.cwd);
			if (saved === target) return session.id;
		}
		return null;
	}

	getCurrentSessionId(): string | null {
		return this.currentSessionId;
	}

	setCurrentSessionId(id: string): void {
		this.currentSessionId = id;
	}

	async cleanupOldSessions(daysOld: number = 30): Promise<number> {
		const sessions = await this.listSessions();
		const cutoff = Date.now() - daysOld * 24 * 60 * 60 * 1000;
		let cleaned = 0;

		for (const session of sessions) {
			if (new Date(session.updatedAt).getTime() < cutoff) {
				await this.deleteSession(session.id);
				cleaned++;
			}
		}

		return cleaned;
	}
	/**
	 * Start auto-saving the session every 5 minutes. Only one auto-save
	 * interval is active at a time — calling this again replaces the previous.
	 * The `getContext` callback is invoked on each tick so the caller always
	 * provides fresh state.
	 */
	startAutoSave(
		sessionId: string,
		getContext: () => AgentContext,
	): NodeJS.Timeout {
		this.stopAutoSave();
		const autoSaveIntervalMs = getContext().config.performance?.autoSaveIntervalMs ?? 300_000;
		this.autoSaveTimer = setInterval(() => {
			this.saveSession(sessionId, getContext()).catch((err: unknown) => {
				debug.log("session", `Auto-save failed: ${err}`);
			});
		}, autoSaveIntervalMs);
		return this.autoSaveTimer;
	}

	/** Stop the auto-save interval if one is running. */
	stopAutoSave(): void {
		if (this.autoSaveTimer !== null) {
			clearInterval(this.autoSaveTimer);
			this.autoSaveTimer = null;
		}
	}
}

export const sessionManager = new SessionManager();
export default sessionManager;
