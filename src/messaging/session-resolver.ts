import { randomUUID } from "node:crypto";
import db from "../agent/memory/db";

export interface MessagingSession {
	platform_sender_id: string;
	tehuti_session_id: string;
	created_at: number;
	last_active: number;
}

export class SessionResolver {
	private sessionCache = new Map<string, string>();
	private reverseCache = new Map<string, string>();
	private readonly CACHE_MAX_SIZE = 1000;

	private updateCache(platformSenderId: string, tehutiSessionId: string) {
		// Update primary cache
		if (this.sessionCache.has(platformSenderId)) {
			this.sessionCache.delete(platformSenderId);
		} else if (this.sessionCache.size >= this.CACHE_MAX_SIZE) {
			const firstKey = this.sessionCache.keys().next().value;
			if (firstKey !== undefined) {
				const oldVal = this.sessionCache.get(firstKey);
				this.sessionCache.delete(firstKey);
				if (oldVal) this.reverseCache.delete(oldVal);
			}
		}
		this.sessionCache.set(platformSenderId, tehutiSessionId);

		// Update reverse cache
		if (this.reverseCache.has(tehutiSessionId)) {
			this.reverseCache.delete(tehutiSessionId);
		} else if (this.reverseCache.size >= this.CACHE_MAX_SIZE) {
			const firstKey = this.reverseCache.keys().next().value;
			if (firstKey !== undefined) {
				const oldVal = this.reverseCache.get(firstKey);
				this.reverseCache.delete(firstKey);
				if (oldVal) this.sessionCache.delete(oldVal);
			}
		}
		this.reverseCache.set(tehutiSessionId, platformSenderId);
	}

	private getFromCache(platformSenderId: string): string | undefined {
		if (!this.sessionCache.has(platformSenderId)) return undefined;
		const tehutiSessionId = this.sessionCache.get(platformSenderId)!;
		this.updateCache(platformSenderId, tehutiSessionId);
		return tehutiSessionId;
	}

	private getFromReverseCache(tehutiSessionId: string): string | undefined {
		if (!this.reverseCache.has(tehutiSessionId)) return undefined;
		const platformSenderId = this.reverseCache.get(tehutiSessionId)!;
		this.updateCache(platformSenderId, tehutiSessionId);
		return platformSenderId;
	}

	/**
	 * Resolves an inbound platform sender ID to a persistent Tehuti session ID.
	 * If the sender does not exist, a new session is created.
	 *
	 * @param platformSenderId The unique ID of the sender on the messaging platform (e.g., Slack user ID)
	 * @returns The persistent Tehuti session ID for this sender
	 */
	public resolveSession(platformSenderId: string): string {
		if (!platformSenderId) {
			throw new Error("platformSenderId is required and cannot be empty.");
		}
		const cachedSessionId = this.getFromCache(platformSenderId);
		if (cachedSessionId) {
			return cachedSessionId;
		}

		try {
			const stmt = db.prepare(
				"SELECT tehuti_session_id FROM messaging_sessions WHERE platform_sender_id = ?",
			);
			const row = stmt.get(platformSenderId) as
				| { tehuti_session_id: string }
				| undefined;

			if (row) {
				// Update last_active
				const updateStmt = db.prepare(
					"UPDATE messaging_sessions SET last_active = cast(strftime('%s', 'now') as integer) WHERE platform_sender_id = ?",
				);
				updateStmt.run(platformSenderId);
				this.updateCache(platformSenderId, row.tehuti_session_id);
				return row.tehuti_session_id;
			}

			// Create new session
			const newSessionId = randomUUID();
			const insertStmt = db.prepare(
				"INSERT INTO messaging_sessions (platform_sender_id, tehuti_session_id) VALUES (?, ?)",
			);
			insertStmt.run(platformSenderId, newSessionId);
			this.updateCache(platformSenderId, newSessionId);

			return newSessionId;
		} catch (error: any) {
			if (error.code === "SQLITE_BUSY" || error.code === "SQLITE_LOCKED") {
				throw new Error(
					`Database is currently locked (SQLITE_BUSY). Failed to resolve session for platform sender: ${platformSenderId}`,
				);
			}
			throw error;
		}
	}

	/**
	 * Retrieves all active sessions.
	 */
	public getAllSessions(): MessagingSession[] {
		try {
			const stmt = db.prepare("SELECT * FROM messaging_sessions");
			return stmt.all() as MessagingSession[];
		} catch (error: any) {
			if (error.code === "SQLITE_BUSY" || error.code === "SQLITE_LOCKED") {
				throw new Error(
					"Database is currently locked. Failed to get all sessions.",
				);
			}
			throw error;
		}
	}

	/**
	 * Retrieves the platform sender ID for a given Tehuti session ID.
	 */
	public getPlatformSenderId(tehutiSessionId: string): string | null {
		if (!tehutiSessionId) return null;
		const cachedSenderId = this.getFromReverseCache(tehutiSessionId);
		if (cachedSenderId) {
			return cachedSenderId;
		}

		try {
			const stmt = db.prepare(
				"SELECT platform_sender_id FROM messaging_sessions WHERE tehuti_session_id = ?",
			);
			const row = stmt.get(tehutiSessionId) as
				| { platform_sender_id: string }
				| undefined;
			
			if (row) {
				this.updateCache(row.platform_sender_id, tehutiSessionId);
				return row.platform_sender_id;
			}
			return null;
		} catch (error: any) {
			if (error.code === "SQLITE_BUSY" || error.code === "SQLITE_LOCKED") {
				throw new Error(
					`Database is currently locked. Failed to get platform sender for session: ${tehutiSessionId}`,
				);
			}
			throw error;
		}
	}
}
