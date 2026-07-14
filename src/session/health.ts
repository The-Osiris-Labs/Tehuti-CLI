import { execFileSync } from "node:child_process";
import { statfs } from "node:fs/promises";
import fs from "fs-extra";
import type { SessionData } from "./manager.js";
import { debug } from "../utils/debug.js";

export interface SessionHealth {
	status: "ok" | "warning" | "blocked";
	resumeCwd: string;
	warnings: string[];
	blockers: string[];
	background: {
		transcriptPids: number[];
		aliveOrphanPids: number[];
	};
	git?: {
		root?: string;
		branch?: string;
		head?: string;
		dirtyFiles?: number;
	};
}

function uniqueNumbers(values: number[]): number[] {
	return Array.from(new Set(values)).sort((a, b) => a - b);
}

function messageContentToString(content: unknown): string {
	if (typeof content === "string") return content;
	try {
		return JSON.stringify(content);
	} catch {
		return String(content);
	}
}

function extractTranscriptPids(data: SessionData): number[] {
	const pids: number[] = [];
	const messages = data.appendOnlyLog?.length
		? data.appendOnlyLog
		: data.messages;

	for (const message of messages) {
		const content = messageContentToString(message.content);
		for (const match of content.matchAll(/PID\s+(\d+)/gi)) {
			const pid = Number(match[1]);
			if (Number.isSafeInteger(pid) && pid > 0) pids.push(pid);
		}

		if (message.role === "tool") {
			try {
				const parsed = JSON.parse(content) as { metadata?: { pid?: unknown } };
				const pid = Number(parsed.metadata?.pid);
				if (Number.isSafeInteger(pid) && pid > 0) pids.push(pid);
			} catch (err) {
				debug.log("session", "Failed to parse tool message for PID:", err);
			}
		}
	}

	return uniqueNumbers(pids);
}

function isPidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		try {
			process.kill(-pid, 0);
			return true;
		} catch {
			return false;
		}
	}
}

function readGitInfo(cwd: string): SessionHealth["git"] | undefined {
	try {
		const root = execFileSync(
			"git",
			["-C", cwd, "rev-parse", "--show-toplevel"],
			{
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
			},
		).trim();
		const branch = execFileSync(
			"git",
			["-C", cwd, "branch", "--show-current"],
			{
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
			},
		).trim();
		const head = execFileSync("git", ["-C", cwd, "rev-parse", "HEAD"], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
		const status = execFileSync("git", ["-C", cwd, "status", "--porcelain"], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		})
			.split("\n")
			.filter(Boolean);

		return {
			root,
			branch: branch || "detached",
			head,
			dirtyFiles: status.length,
		};
	} catch {
		return undefined;
	}
}

export async function checkSessionHealth(
	data: SessionData,
	currentCwd: string,
	options: { allowFallbackCwd?: boolean; sessionDir?: string } = {},
): Promise<SessionHealth> {
	const warnings: string[] = [];
	const blockers: string[] = [];
	const savedCwd = data.context?.cwd || data.metadata.cwd;
	let resumeCwd = savedCwd || currentCwd;

	if (savedCwd && savedCwd !== currentCwd) {
		warnings.push(
			`Session cwd differs from current cwd. Saved: ${savedCwd}; current: ${currentCwd}.`,
		);
	}

	try {
		const stat = await fs.stat(resumeCwd);
		if (!stat.isDirectory()) {
			blockers.push(`Saved cwd is not a directory: ${resumeCwd}`);
		} else {
			resumeCwd = await fs.realpath(resumeCwd);
		}
	} catch {
		const message = `Saved cwd no longer exists: ${resumeCwd}`;
		if (options.allowFallbackCwd) {
			warnings.push(`${message}. Falling back to ${currentCwd}.`);
			resumeCwd = currentCwd;
		} else {
			blockers.push(message);
		}
	}

	const git = blockers.length === 0 ? readGitInfo(resumeCwd) : undefined;
	if (!git && blockers.length === 0) {
		warnings.push(`Resume cwd is not a git repository: ${resumeCwd}`);
	}

	const transcriptPids = extractTranscriptPids(data);
	const aliveOrphanPids = transcriptPids.filter(isPidAlive);
	if (aliveOrphanPids.length > 0) {
		warnings.push(
			`Found previously mentioned PID(s) still alive (${aliveOrphanPids.join(
				", ",
			)}), but stdout/stderr pipes cannot be restored after restart.`,
		);
	}

	// Check if session file is readable (requires sessionDir option)
	if (options.sessionDir) {
		const sessionFile = `${options.sessionDir}/session.json`;
		try {
			await fs.access(sessionFile, fs.constants.R_OK);
		} catch {
			warnings.push(
				`Session file is not readable: ${sessionFile}`,
			);
		}
	}

	// Check if session metadata is consistent
	const expectedMessages =
		(data.appendOnlyLog?.length ?? 0) > 0
			? data.appendOnlyLog.length
			: data.messages.length;
	if (
		data.metadata.messageCount !== undefined &&
		data.metadata.messageCount !== expectedMessages
	) {
		warnings.push(
			`Session metadata messageCount (${data.metadata.messageCount}) does not match actual message count (${expectedMessages}).`,
		);
	}

	// Check available disk space (warn if less than 1 MB free)
	try {
		const diskStats = await statfs(resumeCwd);
		const freeBytes = diskStats.bavail * diskStats.bsize;
		const freeMB = freeBytes / (1024 * 1024);
		if (freeMB < 1) {
			warnings.push(
				`Low disk space on ${resumeCwd}: ${freeMB.toFixed(1)} MB available.`,
			);
		}
	} catch {
		// statfs can fail on some filesystems; treat as non-critical
	}

	const status =
		blockers.length > 0 ? "blocked" : warnings.length > 0 ? "warning" : "ok";

	return {
		status,
		resumeCwd,
		warnings,
		blockers,
		background: {
			transcriptPids,
			aliveOrphanPids,
		},
		...(git ? { git } : {}),
	};
}

export function formatSessionHealthSummary(health: SessionHealth): string {
	const lines: string[] = [];
	for (const blocker of health.blockers) {
		lines.push(`Blocked: ${blocker}`);
	}
	for (const warning of health.warnings) {
		lines.push(`Warning: ${warning}`);
	}
	if (health.git) {
		lines.push(
			`Git: ${health.git.branch} @ ${health.git.head?.slice(0, 8)} (${health.git.dirtyFiles ?? 0} dirty files)`,
		);
	}
	return lines.join("\n");
}
