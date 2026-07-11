import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";

const getDbPath = () => {
	const dir = path.join(os.homedir(), ".config", "tehuti", "memory");
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true });
	}
	return path.join(dir, "graph.db");
};

// Add a timeout to prevent SQLITE_BUSY errors during concurrent access
const db: Database.Database = new Database(getDbPath(), { timeout: 10000 });

// Initialize schema
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");
db.pragma("foreign_keys = ON");
db.pragma("temp_store = MEMORY");
db.pragma("cache_size = -64000");
// Explicit busy timeout pragma as a backup
db.pragma("busy_timeout = 10000");

// Basic schema migrations using user_version
const currentVersion = db.pragma("user_version", { simple: true }) as number;

if (currentVersion === 0) {
	const initSchema = db.transaction(() => {
		db.exec(`
	  CREATE TABLE IF NOT EXISTS nodes (
	    id TEXT PRIMARY KEY,
	    type TEXT NOT NULL,
	    content TEXT NOT NULL,
	    metadata TEXT,
	    created_at INTEGER DEFAULT (cast(unixepoch() * 1000 as integer)),
	    last_accessed INTEGER DEFAULT (cast(unixepoch() * 1000 as integer))
	  );

	  CREATE TABLE IF NOT EXISTS edges (
	    id TEXT PRIMARY KEY,
	    source_id TEXT NOT NULL,
	    target_id TEXT NOT NULL,
	    relation_type TEXT NOT NULL,
	    weight REAL DEFAULT 1.0,
	    created_at INTEGER DEFAULT (cast(unixepoch() * 1000 as integer)),
	    FOREIGN KEY(source_id) REFERENCES nodes(id) ON DELETE CASCADE,
	    FOREIGN KEY(target_id) REFERENCES nodes(id) ON DELETE CASCADE
	  );

	  CREATE TABLE IF NOT EXISTS messaging_sessions (
	    platform_sender_id TEXT PRIMARY KEY,
	    tehuti_session_id TEXT NOT NULL,
	    created_at INTEGER DEFAULT (cast(unixepoch() * 1000 as integer)),
	    last_active INTEGER DEFAULT (cast(unixepoch() * 1000 as integer))
	  );

	  CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type);
	  CREATE INDEX IF NOT EXISTS idx_nodes_last_accessed ON nodes(last_accessed);
	  CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id);
	  CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id);
	  CREATE INDEX IF NOT EXISTS idx_messaging_sessions_session_id ON messaging_sessions(tehuti_session_id);
	  CREATE INDEX IF NOT EXISTS idx_messaging_sessions_last_active ON messaging_sessions(last_active);

	  CREATE TABLE IF NOT EXISTS user_preferences (
	    id TEXT PRIMARY KEY,
	    key TEXT UNIQUE NOT NULL,
	    value TEXT NOT NULL,
	    updated_at INTEGER DEFAULT (cast(unixepoch() * 1000 as integer))
	  );

	  CREATE TABLE IF NOT EXISTS project_profiles (
	    project_path TEXT PRIMARY KEY,
	    formatting_habits TEXT,
	    command_patterns TEXT,
	    updated_at INTEGER DEFAULT (cast(unixepoch() * 1000 as integer))
	  );
	`);

		db.pragma("user_version = 1");
	});

	initSchema();
}

/**
 * Migration v2 (user_version = 2)
 *
 * Introduces the unified `user_profiles` table to enable cross-platform identity management
 * for the companion expansion. Previously, `messaging_sessions` mapped a platform-specific ID
 * (e.g., Slack user ID, Discord ID) directly to a Tehuti session. With `user_profiles`,
 * multiple platform identities can now link to a single profile, enabling consistent memory,
 * learned formatting habits, and preferences across all connected clients.
 *
 * This migration:
 * 1. Creates the `user_profiles` table.
 * 2. Alters `messaging_sessions` to include a `profile_id` and `platform`.
 * 3. Backfills existing sessions by generating a unique profile ID for each.
 * 4. Links the legacy sessions to these new profiles.
 */
if (currentVersion === 1) {
	const migrateV2 = db.transaction(() => {
		db.exec(`
			-- 1. Create the unified User Profiles table
			CREATE TABLE IF NOT EXISTS user_profiles (
				profile_id TEXT PRIMARY KEY,
				tehuti_session_id TEXT NOT NULL UNIQUE,
				created_at INTEGER DEFAULT (cast(unixepoch() * 1000 as integer)),
				last_active INTEGER DEFAULT (cast(unixepoch() * 1000 as integer))
			);

			-- 2. Alter existing messaging_sessions to support platforms and profile linking
			ALTER TABLE messaging_sessions ADD COLUMN profile_id TEXT;
			ALTER TABLE messaging_sessions ADD COLUMN platform TEXT DEFAULT 'unknown';

			-- 3. Seed profiles for all existing sessions (backward compatibility)
			INSERT INTO user_profiles (profile_id, tehuti_session_id, created_at, last_active)
			SELECT hex(randomblob(16)), tehuti_session_id, created_at, last_active 
			FROM messaging_sessions;

			-- 4. Link existing sessions to the newly generated profiles
			UPDATE messaging_sessions
			SET profile_id = (
				SELECT profile_id FROM user_profiles 
				WHERE user_profiles.tehuti_session_id = messaging_sessions.tehuti_session_id
			);

			-- 5. Add indices for fast cross-platform resolution
			CREATE INDEX IF NOT EXISTS idx_user_profiles_session ON user_profiles(tehuti_session_id);
			CREATE INDEX IF NOT EXISTS idx_messaging_sessions_profile_id ON messaging_sessions(profile_id);
		`);
		db.pragma("user_version = 2");
	});

	migrateV2();
}

export default db;
