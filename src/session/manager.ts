import os from "node:os";
import path from "node:path";
import fs from "fs-extra";
import { v4 as uuidv4 } from "uuid";
import type { AgentContext } from "../agent/context.js";
import type { OpenRouterMessage } from "../api/openrouter.js";
import { debug } from "../utils/debug.js";
import { consola } from "../utils/logger.js";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidSessionId(id: string): boolean {
	return UUID_REGEX.test(id);
}

function sanitizeSessionId(id: string): string {
	const sanitized = id.replace(/[^0-9a-f\-]/gi, "");
	return sanitized.length === 36 && UUID_REGEX.test(sanitized) ? sanitized : "";
}

export interface SessionMetadata {
	id: string;
	name?: string;
	createdAt: string;
	updatedAt: string;
	cwd: string;
	model: string;
	messageCount: number;
	toolCalls: number;
	tokensUsed: number;
}

export interface SessionData {
	metadata: SessionMetadata;
	messages: OpenRouterMessage[];
	context: {
		cwd: string;
		workingDir: string;
		metadata: AgentContext["metadata"];
	};
}

class SessionManager {
	private sessionsDir: string;
	private currentSessionId: string | null = null;

	constructor() {
		this.sessionsDir = path.join(os.homedir(), ".tehuti", "sessions");
		this.ensureSessionsDir();
	}

	private async ensureSessionsDir(): Promise<void> {
		await fs.ensureDir(this.sessionsDir);
	}

	generateAutoName(cwd: string, _model: string): string {
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
	): Promise<string> {
		const id = uuidv4();
		const sessionDir = path.join(this.sessionsDir, id);
		await fs.ensureDir(sessionDir);

		const autoName = name ?? this.generateAutoName(cwd, model);

		const metadata: SessionMetadata = {
			id,
			name: autoName,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			cwd,
			model,
			messageCount: 0,
			toolCalls: 0,
			tokensUsed: 0,
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

		const sessionDir = path.join(this.sessionsDir, id);
		await fs.ensureDir(sessionDir);

		const existingMetadata = await this.getSessionMetadata(id);
		const sessionName =
			name ??
			existingMetadata?.name ??
			this.generateAutoName(ctx.cwd, ctx.config.model);

		const metadata: SessionMetadata = {
			id,
			name: sessionName,
			createdAt: existingMetadata?.createdAt ?? new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			cwd: ctx.cwd,
			model: ctx.config.model,
			messageCount: ctx.messages.length,
			toolCalls: ctx.metadata.toolCalls,
			tokensUsed: ctx.metadata.tokensUsed,
		};

		await this.saveSessionMetadata(id, metadata);

		const sessionData: SessionData = {
			metadata,
			messages: ctx.messages,
			context: {
				cwd: ctx.cwd,
				workingDir: ctx.workingDir,
				metadata: ctx.metadata,
			},
		};

		const sessionFile = path.join(sessionDir, "session.json");
		const tempFile = path.join(sessionDir, "session.json.tmp");
		await fs.writeJson(tempFile, sessionData, { spaces: 2 });
		await fs.rename(tempFile, sessionFile);

		debug.log(
			"session",
			`Saved session: ${id} (${sessionName}, ${ctx.messages.length} messages)`,
		);
	}

	async loadSession(id: string): Promise<SessionData | null> {
		if (!isValidSessionId(id)) {
			consola.error(`Invalid session ID format: ${id}`);
			return null;
		}

		const sessionFile = path.join(this.sessionsDir, id, "session.json");

		if (!(await fs.pathExists(sessionFile))) {
			return null;
		}

		try {
			const data = (await fs.readJson(sessionFile)) as SessionData;
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
		await fs.writeJson(metaFile, metadata, { spaces: 2 });
	}

	async renameSession(id: string, name: string): Promise<void> {
		const metadata = await this.getSessionMetadata(id);
		if (metadata) {
			metadata.name = name;
			await this.saveSessionMetadata(id, metadata);

			const sessionFile = path.join(this.sessionsDir, id, "session.json");
			if (await fs.pathExists(sessionFile)) {
				const data = (await fs.readJson(sessionFile)) as SessionData;
				data.metadata.name = name;
				await fs.writeJson(sessionFile, data, { spaces: 2 });
			}
		}
	}

	async listSessions(): Promise<SessionMetadata[]> {
		await this.ensureSessionsDir();

		const dirs = await fs.readdir(this.sessionsDir);
		const sessions: SessionMetadata[] = [];

		for (const dir of dirs) {
			const metadata = await this.getSessionMetadata(dir);
			if (metadata) {
				sessions.push(metadata);
			}
		}

		return sessions.sort(
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
		debug.log("session", `Deleted session: ${id}`);
	}

	async getRecentSession(cwd: string): Promise<string | null> {
		const sessions = await this.listSessions();
		const cwdSession = sessions.find((s) => s.cwd === cwd);
		return cwdSession?.id ?? (sessions.length > 0 ? sessions[0].id : null);
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
}

export const sessionManager = new SessionManager();
export default sessionManager;
