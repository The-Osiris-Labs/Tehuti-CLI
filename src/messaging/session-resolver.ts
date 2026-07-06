import { randomUUID } from "node:crypto";
import db from "../agent/memory/db";

export interface MessagingSession {
	platform_sender_id: string;
	tehuti_session_id: string;
	created_at: number;
	last_active: number;
}

export class SessionResolver {
	/**
	 * Resolves an inbound platform sender ID to a persistent Tehuti session ID.
	 * If the sender does not exist, a new session is created.
	 *
	 * @param platformSenderId The unique ID of the sender on the messaging platform (e.g., Slack user ID)
	 * @returns The persistent Tehuti session ID for this sender
	 */
	public resolveSession(platformSenderId: string): string {
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
				return row.tehuti_session_id;
			}

			// Create new session
			const newSessionId = randomUUID();
			const insertStmt = db.prepare(
				"INSERT INTO messaging_sessions (platform_sender_id, tehuti_session_id) VALUES (?, ?)",
			);
			insertStmt.run(platformSenderId, newSessionId);

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
		try {
			const stmt = db.prepare(
				"SELECT platform_sender_id FROM messaging_sessions WHERE tehuti_session_id = ?",
			);
			const row = stmt.get(tehutiSessionId) as
				| { platform_sender_id: string }
				| undefined;
			return row ? row.platform_sender_id : null;
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
