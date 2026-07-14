import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface BackupInfo {
	sessionId: string;
	timestamp: number;
	path: string;
	size: number;
}

export class SessionBackup {
	private backupDir: string;
	private sessionsDir: string;

	constructor(sessionsDir: string) {
		this.sessionsDir = sessionsDir;
		this.backupDir = path.join(sessionsDir, ".backups");
	}

	async createBackup(sessionId: string): Promise<BackupInfo> {
		await fs.mkdir(this.backupDir, { recursive: true });
		const sessionDir = path.join(this.sessionsDir, sessionId);
		const backupPath = path.join(
			this.backupDir,
			`${sessionId}_${Date.now()}.json`,
		);

		const sessionFile = path.join(sessionDir, "session.json");
		const data = await fs.readFile(sessionFile, "utf-8");
		await fs.writeFile(backupPath, data);

		const stat = await fs.stat(backupPath);
		return {
			sessionId,
			timestamp: Date.now(),
			path: backupPath,
			size: stat.size,
		};
	}

	async restoreBackup(backupPath: string, sessionId: string): Promise<void> {
		const data = await fs.readFile(backupPath, "utf-8");
		const sessionDir = path.join(this.sessionsDir, sessionId);
		await fs.mkdir(sessionDir, { recursive: true });
		await fs.writeFile(path.join(sessionDir, "session.json"), data);
	}

	async listBackups(sessionId?: string): Promise<BackupInfo[]> {
		try {
			const files = await fs.readdir(this.backupDir);
			const backups: BackupInfo[] = [];

			for (const file of files) {
				if (file.endsWith(".json")) {
					const filePath = path.join(this.backupDir, file);
					const stat = await fs.stat(filePath);
					const parts = file.replace(".json", "").split("_");
					const backupSessionId = parts.slice(0, -1).join("_");

					if (!sessionId || backupSessionId === sessionId) {
						backups.push({
							sessionId: backupSessionId,
							timestamp: parseInt(parts[parts.length - 1]),
							path: filePath,
							size: stat.size,
						});
					}
				}
			}

			return backups.sort((a, b) => b.timestamp - a.timestamp);
		} catch {
			return [];
		}
	}

	async cleanupBackups(keepCount = 10): Promise<void> {
		const backups = await this.listBackups();
		if (backups.length > keepCount) {
			for (const backup of backups.slice(keepCount)) {
				await fs.unlink(backup.path);
			}
		}
	}
}
