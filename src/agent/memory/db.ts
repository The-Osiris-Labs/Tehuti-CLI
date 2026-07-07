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
db.pragma("foreign_keys = ON");
// Explicit busy timeout pragma as a backup
db.pragma("busy_timeout = 10000");

// Basic schema migrations using user_version
const currentVersion = db.pragma("user_version", { simple: true }) as number;

if (currentVersion === 0) {
	db.exec(`
	  CREATE TABLE IF NOT EXISTS nodes (
	    id TEXT PRIMARY KEY,
	    type TEXT NOT NULL,
	    content TEXT NOT NULL,
	    metadata TEXT,
	    created_at INTEGER DEFAULT (cast(strftime('%s', 'now') as integer)),
	    last_accessed INTEGER DEFAULT (cast(strftime('%s', 'now') as integer))
	  );

	  CREATE TABLE IF NOT EXISTS edges (
	    id TEXT PRIMARY KEY,
	    source_id TEXT NOT NULL,
	    target_id TEXT NOT NULL,
	    relation_type TEXT NOT NULL,
	    weight REAL DEFAULT 1.0,
	    created_at INTEGER DEFAULT (cast(strftime('%s', 'now') as integer)),
	    FOREIGN KEY(source_id) REFERENCES nodes(id) ON DELETE CASCADE,
	    FOREIGN KEY(target_id) REFERENCES nodes(id) ON DELETE CASCADE
	  );

	  CREATE TABLE IF NOT EXISTS messaging_sessions (
	    platform_sender_id TEXT PRIMARY KEY,
	    tehuti_session_id TEXT NOT NULL,
	    created_at INTEGER DEFAULT (cast(strftime('%s', 'now') as integer)),
	    last_active INTEGER DEFAULT (cast(strftime('%s', 'now') as integer))
	  );

	  CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type);
	  CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id);
	  CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id);
	  CREATE INDEX IF NOT EXISTS idx_messaging_sessions_session_id ON messaging_sessions(tehuti_session_id);

	  CREATE TABLE IF NOT EXISTS user_preferences (
	    id TEXT PRIMARY KEY,
	    key TEXT UNIQUE NOT NULL,
	    value TEXT NOT NULL,
	    updated_at INTEGER DEFAULT (cast(strftime('%s', 'now') as integer))
	  );

	  CREATE TABLE IF NOT EXISTS project_profiles (
	    project_path TEXT PRIMARY KEY,
	    formatting_habits TEXT,
	    command_patterns TEXT,
	    updated_at INTEGER DEFAULT (cast(strftime('%s', 'now') as integer))
	  );
	`);

	db.pragma("user_version = 1");
}

export default db;
