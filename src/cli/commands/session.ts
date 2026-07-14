import * as fs from "node:fs/promises";
import chalk from "chalk";
import { Command } from "commander";
import { consola } from "consola";
import { BRANDING, DECORATIVE } from "../../branding/index.js";
import { exportToJSON, exportToMarkdown } from "../../session/export.js";
import { sessionManager } from "../../session/manager.js";

/**
 * `tehuti session` subcommand.
 *
 * Exposes the existing `SessionManager` API as user-facing CLI commands so the
 * user can list, age-prune, and count-prune session directories under
 * `~/.tehuti/sessions/` without waiting for the daemon's 12h GC cycle.
 */
export function sessionCommand(): Command {
	const session = new Command("session").description(
		"Manage saved sessions (list, cleanup, prune, export)",
	);

	// ─────────────────────────────────────────────────────────────────────
	// tehuti session list
	// ─────────────────────────────────────────────────────────────────────
	session
		.command("list")
		.description("List all saved sessions, newest first")
		.action(async () => {
			const sessions = await sessionManager.listSessions();

			if (sessions.length === 0) {
				consola.info("No sessions found.");
				return;
			}

			console.log();
			console.log(chalk.hex(BRANDING.colors.primary)("  𓆣 Sessions"));
			console.log();

			// Sort newest first explicitly (listSessions already sorts by updatedAt
			// desc, but be defensive in case the default sort changes).
			const ordered = [...sessions].sort(
				(a, b) =>
					new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
			);

			for (const s of ordered) {
				const idShort = s.id.slice(0, 8);
				const name = s.name || "(unnamed)";
				const updated = new Date(s.updatedAt).toISOString().slice(0, 16);
				const msgCount = s.messageCount ?? 0;
				const cwdShort = s.cwd
					? s.cwd.length > 40
						? `…${s.cwd.slice(-39)}`
						: s.cwd
					: "(no cwd)";

				console.log(`  ${chalk.cyan(idShort)}  ${chalk.bold(name)}`);
				console.log(
					`         ${chalk.gray(updated)}  ${msgCount} msgs  ${chalk.dim(cwdShort)}`,
				);
			}

			console.log();
			console.log(chalk.gray(`  Total: ${ordered.length} session(s)`));
			console.log();
		});

	// ─────────────────────────────────────────────────────────────────────
	// tehuti session cleanup [days]  (age-based, wraps cleanupOldSessions)
	// ─────────────────────────────────────────────────────────────────────
	session
		.command("cleanup")
		.description(
			"Delete sessions older than <days> days (default 30). Wraps SessionManager.cleanupOldSessions.",
		)
		.argument(
			"[days]",
			"Age threshold in days; sessions with updatedAt older than this are removed",
			"30",
		)
		.option("--dry-run", "Show what would be deleted without deleting", false)
		.action(async (daysArg: string, opts: { dryRun?: boolean }) => {
			const days = Number.parseInt(daysArg, 10);
			if (!Number.isFinite(days) || days < 0) {
				consola.error(`Invalid days value: "${daysArg}"`);
				process.exit(1);
			}

			const sessions = await sessionManager.listSessions();
			const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
			const stale = sessions.filter(
				(s) => new Date(s.updatedAt).getTime() < cutoff,
			);

			if (stale.length === 0) {
				consola.success(
					`Nothing to clean. 0 sessions older than ${days} day(s).`,
				);
				return;
			}

			if (opts.dryRun) {
				console.log();
				console.log(
					chalk.hex(BRANDING.colors.primary)(
						`  ${DECORATIVE.scroll} Would delete ${stale.length} session(s) older than ${days} day(s):`,
					),
				);
				console.log();
				for (const s of stale) {
					console.log(
						`  ${chalk.cyan(s.id.slice(0, 8))}  ${s.name || "(unnamed)"}  ${chalk.gray(new Date(s.updatedAt).toISOString().slice(0, 10))}`,
					);
				}
				console.log();
				return;
			}

			// Delegate to the tested manager function rather than duplicating logic.
			const removed = await sessionManager.cleanupOldSessions(days);
			consola.success(
				`Removed ${removed} session(s) older than ${days} day(s).`,
			);
		});

	// ─────────────────────────────────────────────────────────────────────
	// tehuti session prune [keep]  (count-based)
	// ─────────────────────────────────────────────────────────────────────
	session
		.command("prune")
		.description(
			"Keep the most recent <keep> sessions and delete the rest (default 10).",
		)
		.argument("[keep]", "Number of most-recent sessions to keep", "10")
		.option("--dry-run", "Show what would be deleted without deleting", false)
		.action(async (keepArg: string, opts: { dryRun?: boolean }) => {
			const keep = Number.parseInt(keepArg, 10);
			if (!Number.isFinite(keep) || keep < 0) {
				consola.error(`Invalid keep value: "${keepArg}"`);
				process.exit(1);
			}

			const sessions = await sessionManager.listSessions();
			const ordered = [...sessions].sort(
				(a, b) =>
					new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
			);

			if (ordered.length <= keep) {
				consola.success(
					`Nothing to prune. Have ${ordered.length} session(s), keep is ${keep}.`,
				);
				return;
			}

			const toDelete = ordered.slice(keep);
			const toKeep = ordered.slice(0, keep);

			if (opts.dryRun) {
				console.log();
				console.log(
					chalk.hex(BRANDING.colors.primary)(
						`  ${DECORATIVE.scroll} Would delete ${toDelete.length} session(s), keeping ${toKeep.length}:`,
					),
				);
				console.log();
				console.log(chalk.gray("  KEEP:"));
				for (const s of toKeep) {
					console.log(
						`    ${chalk.cyan(s.id.slice(0, 8))}  ${s.name || "(unnamed)"}  ${chalk.gray(new Date(s.updatedAt).toISOString().slice(0, 10))}`,
					);
				}
				console.log();
				console.log(chalk.gray("  DELETE:"));
				for (const s of toDelete) {
					console.log(
						`    ${chalk.cyan(s.id.slice(0, 8))}  ${s.name || "(unnamed)"}  ${chalk.gray(new Date(s.updatedAt).toISOString().slice(0, 10))}`,
					);
				}
				console.log();
				return;
			}

			let removed = 0;
			const failures: Array<{ id: string; error: string }> = [];

			for (const s of toDelete) {
				try {
					await sessionManager.deleteSession(s.id);
					removed++;
				} catch (e) {
					failures.push({
						id: s.id,
						error: e instanceof Error ? e.message : String(e),
					});
				}
			}

			consola.success(
				`Pruned ${removed} session(s), kept ${toKeep.length} most recent.`,
			);
			if (failures.length > 0) {
				consola.warn(
					`${failures.length} session(s) could not be deleted (likely permission issues):`,
				);
				for (const f of failures) {
					console.log(
						`  ${chalk.cyan(f.id.slice(0, 8))}  ${chalk.red(f.error)}`,
					);
				}
			}
		});

	// ─────────────────────────────────────────────────────────────────────
	// tehuti session export <id>  (--format markdown|json)
	// ─────────────────────────────────────────────────────────────────────
	session
		.command("export")
		.description("Export a session to markdown or JSON (read-only)")
		.argument("<id>", "Session ID (full or unique prefix)")
		.option(
			"-f, --format <fmt>",
			"Output format: markdown (default) or json",
			"markdown",
		)
		.option(
			"-o, --output <path>",
			"Write to file instead of stdout",
		)
		.action(
			async (
				idArg: string,
				opts: { format?: string; output?: string },
			) => {
				const format = (opts.format ?? "markdown").toLowerCase();
				if (format !== "markdown" && format !== "json") {
					consola.error(
						`Unknown format "${format}". Use "markdown" or "json".`,
					);
					process.exit(1);
				}

				// Resolve prefix → full id
				const sessions = await sessionManager.listSessions();
				const matches = sessions.filter((s) =>
					s.id.startsWith(idArg),
				);
				if (matches.length === 0) {
					consola.error(`No session found matching "${idArg}".`);
					process.exit(1);
				}
				if (matches.length > 1) {
					consola.error(
						`Ambiguous prefix "${idArg}" matches ${matches.length} sessions. Use a longer prefix.`,
					);
					process.exit(1);
				}

				const sessionData = await sessionManager.loadSession(
					matches[0].id,
				);
				if (!sessionData) {
					consola.error(
						`Failed to load session "${matches[0].id}".`,
					);
					process.exit(1);
				}

				const messages = sessionData.messages;
				if (messages.length === 0) {
					consola.warn("Session contains no messages.");
					return;
				}

				const output =
					format === "json"
						? exportToJSON(messages)
						: exportToMarkdown(messages);

				if (opts.output) {
					await fs.writeFile(opts.output, output, "utf-8");
					consola.success(
						`Exported ${messages.length} message(s) to ${opts.output}`,
					);
				} else {
					process.stdout.write(output);
				}
			},
		);

	return session;
}
