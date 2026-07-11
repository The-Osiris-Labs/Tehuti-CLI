import { randomUUID } from "node:crypto";
import db from "../agent/memory/db.js";

export interface UserProfile {
	profile_id: string;
	tehuti_session_id: string;
	created_at: number;
	last_active: number;
}

export interface MessagingSession {
	platform_sender_id: string;
	profile_id: string;
	platform: string;
	tehuti_session_id: string; // Deprecated, mapped to profile for backward-compat
	created_at: number;
	last_active: number;
}

export class SessionResolver {
	// Cache: platformSenderId -> profileId
	private platformCache = new Map<string, string>();
	// Cache: profileId -> tehutiSessionId
	private profileCache = new Map<string, string>();
	private readonly CACHE_MAX_SIZE = 1000;

	private evictOldest(cacheMap: Map<string, string>): void {
		const firstKey = cacheMap.keys().next().value;
		if (firstKey !== undefined) {
			cacheMap.delete(firstKey);
		}
	}

	private updateCache(
		platformSenderId: string,
		profileId: string,
		tehutiSessionId: string,
	) {
		// Evict the old profile mapping if this sender is being remapped
		const oldProfileId = this.platformCache.get(platformSenderId);
		if (oldProfileId !== undefined && oldProfileId !== profileId) {
			this.profileCache.delete(oldProfileId);
		}

		while (this.platformCache.size >= this.CACHE_MAX_SIZE) {
			this.evictOldest(this.platformCache);
		}
		while (this.profileCache.size >= this.CACHE_MAX_SIZE) {
			this.evictOldest(this.profileCache);
		}

		this.platformCache.set(platformSenderId, profileId);
		this.profileCache.set(profileId, tehutiSessionId);
	}

	/**
	 * Links an external platform sender to an existing user profile.
	 */
	public linkPlatformToProfile(
		platformSenderId: string,
		platform: string,
		profileId: string,
	): void {
		try {
			const stmt = db.prepare(
				"SELECT tehuti_session_id FROM user_profiles WHERE profile_id = ?",
			);
			const row = stmt.get(profileId) as
				| { tehuti_session_id: string }
				| undefined;

			if (!row) throw new Error("Profile ID does not exist.");

			const insertStmt = db.prepare(`
				INSERT INTO messaging_sessions (platform_sender_id, platform, profile_id, tehuti_session_id)
				VALUES (?, ?, ?, ?)
				ON CONFLICT(platform_sender_id) DO UPDATE SET profile_id = excluded.profile_id
			`);
			insertStmt.run(
				platformSenderId,
				platform,
				profileId,
				row.tehuti_session_id,
			);

			this.updateCache(platformSenderId, profileId, row.tehuti_session_id);
		} catch (error: any) {
			if (error.code === "SQLITE_BUSY" || error.code === "SQLITE_LOCKED") {
				throw new Error(
					"Database is currently locked. Failed to link platform.",
				);
			}
			throw error;
		}
	}

	/**
	 * Resolves an inbound platform sender ID to a persistent Tehuti session ID via a Unified Profile.
	 * If the sender does not exist, a new profile and session are created.
	 *
	 * @param platformSenderId The unique ID of the sender on the messaging platform (e.g., Slack user ID)
	 * @param platform The platform identifier (e.g., "slack", "discord")
	 * @returns The persistent Tehuti session ID for this sender's unified profile
	 */
	public resolveSession(
		platformSenderId: string,
		platform: string = "unknown",
	): string {
		if (!platformSenderId) {
			throw new Error("platformSenderId is required and cannot be empty.");
		}

		const cachedProfileId = this.platformCache.get(platformSenderId);
		if (cachedProfileId && this.profileCache.has(cachedProfileId)) {
			return this.profileCache.get(cachedProfileId)!;
		}

		try {
			// Cross-platform resolution joining messaging_sessions and user_profiles
			const stmt = db.prepare(`
				SELECT p.profile_id, p.tehuti_session_id 
				FROM messaging_sessions m
				JOIN user_profiles p ON m.profile_id = p.profile_id
				WHERE m.platform_sender_id = ?
			`);
			const row = stmt.get(platformSenderId) as
				| { profile_id: string; tehuti_session_id: string }
				| undefined;

			if (row) {
				// Update ambient context last_active timestamp
				db.prepare(
					"UPDATE user_profiles SET last_active = cast(unixepoch() * 1000 as integer) WHERE profile_id = ?",
				).run(row.profile_id);
				db.prepare(
					"UPDATE messaging_sessions SET last_active = cast(unixepoch() * 1000 as integer) WHERE platform_sender_id = ?",
				).run(platformSenderId);

				this.updateCache(
					platformSenderId,
					row.profile_id,
					row.tehuti_session_id,
				);
				return row.tehuti_session_id;
			}

			// Create new unified profile & session
			const newProfileId = randomUUID();
			const newSessionId = randomUUID();

			db.transaction(() => {
				db.prepare(
					"INSERT INTO user_profiles (profile_id, tehuti_session_id) VALUES (?, ?)",
				).run(newProfileId, newSessionId);
				db.prepare(
					"INSERT INTO messaging_sessions (platform_sender_id, platform, profile_id, tehuti_session_id) VALUES (?, ?, ?, ?)",
				).run(platformSenderId, platform, newProfileId, newSessionId);
			})();

			this.updateCache(platformSenderId, newProfileId, newSessionId);
			return newSessionId;
		} catch (error: any) {
			if (error.code === "SQLITE_BUSY" || error.code === "SQLITE_LOCKED") {
				throw new Error(
					`Database is locked. Failed to resolve session for platform sender: ${platformSenderId}`,
				);
			}
			throw error;
		}
	}

	public getAllSessions(): MessagingSession[] {
		return db
			.prepare("SELECT * FROM messaging_sessions")
			.all() as MessagingSession[];
	}

	public getAllProfiles(): UserProfile[] {
		return db.prepare("SELECT * FROM user_profiles").all() as UserProfile[];
	}

	public clearCache(): void {
		this.platformCache.clear();
		this.profileCache.clear();
	}
}
