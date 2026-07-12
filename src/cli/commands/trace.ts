import { createReadStream, existsSync, statSync } from "node:fs";
import * as readline from "node:readline";
import chalk from "chalk";
import { Command } from "commander";
import {
	defaultTraceLogPath,
	type TraceEvent,
	type TraceLevel,
} from "../../utils/trace.js";
import {
	parseTraceFile,
	type SwarmProfileNode,
} from "../../utils/trace-parser.js";

interface TraceCommandOptions {
	json?: boolean;
	follow?: boolean;
	limit?: string;
	level?: TraceLevel;
	kind?: string;
	session?: string;
	actor?: string;
	from?: string;
	to?: string;
	since?: string;
}

function colorizeLevel(level: TraceLevel): string {
	if (level === "error") return chalk.red(level);
	if (level === "warn") return chalk.yellow(level);
	if (level === "debug") return chalk.gray(level);
	return chalk.cyan(level);
}

function colorizeKind(kind: string): string {
	if (kind.startsWith("tool.")) return chalk.cyan(kind);
	if (kind.startsWith("file.")) return chalk.green(kind);
	if (kind.startsWith("shell.")) return chalk.yellow(kind);
	if (kind.startsWith("model.")) return chalk.magenta(kind);
	if (kind.startsWith("subagent.")) return chalk.blue(kind);
	if (kind.startsWith("swarm.")) return chalk.blue(kind);
	if (kind.startsWith("session.")) return chalk.gray(kind);
	if (kind.includes("error")) return chalk.red(kind);
	return chalk.white(kind);
}

function formatEventLine(event: TraceEvent): string {
	const ts = new Date(event.ts).toISOString().slice(11, 23);
	const level = colorizeLevel(event.level).padEnd(5);
	const kind = colorizeKind(event.kind).padEnd(22);
	const session = event.sessionId
		? chalk.gray(`[${event.sessionId.slice(0, 8)}]`)
		: "";
	const actor = event.actor ? chalk.gray(`<${event.actor}>`) : "";
	return `${chalk.gray(ts)} ${level} ${kind} ${actor}${session} ${event.summary}`;
}

function parseSince(since: string): number {
	const trimmed = since.trim();
	const now = Date.now();
	if (trimmed.endsWith("m")) {
		return now - Number.parseInt(trimmed, 10) * 60_000;
	}
	if (trimmed.endsWith("h")) {
		return now - Number.parseInt(trimmed, 10) * 3_600_000;
	}
	if (trimmed.endsWith("d")) {
		return now - Number.parseInt(trimmed, 10) * 86_400_000;
	}
	const parsed = Date.parse(trimmed);
	if (Number.isNaN(parsed)) {
		throw new Error(`Invalid --since value: ${since}`);
	}
	return parsed;
}

async function readEvents(
	logPath: string,
	limit: number,
): Promise<TraceEvent[]> {
	if (!existsSync(logPath)) {
		throw new Error(`Trace log not found: ${logPath}`);
	}
	const fileStream = createReadStream(logPath);
	const rl = readline.createInterface({
		input: fileStream,
		crlfDelay: Infinity,
	});

	const all: TraceEvent[] = [];
	for await (const line of rl) {
		if (!line.trim()) continue;
		try {
			all.push(JSON.parse(line) as TraceEvent);
		} catch {
			// Skip malformed lines
		}
	}

	const events: TraceEvent[] = [];
	for (let i = all.length - 1; i >= 0 && events.length < limit; i--) {
		events.push(all[i]);
	}
	return events;
}

function applyFilters(
	events: TraceEvent[],
	options: TraceCommandOptions,
): TraceEvent[] {
	return events.filter((event) => {
		if (options.level && event.level !== options.level) return false;
		if (options.kind && !event.kind.includes(options.kind)) return false;
		if (options.session && event.sessionId !== options.session) return false;
		if (options.actor && event.actor !== options.actor) return false;
		if (options.from && event.ts < Date.parse(options.from)) return false;
		if (options.to && event.ts > Date.parse(options.to)) return false;
		if (options.since) {
			const sinceMs = parseSince(options.since);
			if (event.ts < sinceMs) return false;
		}
		return true;
	});
}

async function runTail(
	logPath: string,
	options: TraceCommandOptions,
): Promise<void> {
	const limit = Number.parseInt(options.limit ?? "20", 10);
	const events = applyFilters(
		await readEvents(logPath, limit * 5),
		options,
	).slice(0, limit);

	if (options.json) {
		console.log(JSON.stringify(events, null, 2));
		return;
	}

	if (events.length === 0) {
		console.log(chalk.gray(`No events in ${logPath}`));
		return;
	}

	console.log(chalk.bold(`Last ${events.length} events from ${logPath}`));
	console.log();
	for (const event of events.reverse()) {
		console.log(formatEventLine(event));
	}
	console.log();
}

async function runShow(
	logPath: string,
	id: string,
	options: TraceCommandOptions,
): Promise<void> {
	const events = await readEvents(logPath, 10_000);
	const match = events.find(
		(event) =>
			event.correlationId === id || event.subagentId === id,
	);

	if (!match) {
		console.error(chalk.red(`No trace event with id ${id}`));
		process.exitCode = 1;
		return;
	}

	if (options.json) {
		console.log(JSON.stringify(match, null, 2));
		return;
	}

	console.log(formatEventLine(match));
	if (match.data && Object.keys(match.data).length > 0) {
		console.log(chalk.gray(JSON.stringify(match.data, null, 2)));
	}
}

async function runSearch(
	logPath: string,
	query: string,
	options: TraceCommandOptions,
): Promise<void> {
	const limit = Number.parseInt(options.limit ?? "50", 10);
	const needle = query.toLowerCase();
	const events = applyFilters(
		await readEvents(logPath, 10_000),
		options,
	).filter((event) => {
		const haystack = `${event.kind} ${event.summary} ${event.actor ?? ""} ${
			event.sessionId ?? ""
		} ${JSON.stringify(event.data ?? {})}`.toLowerCase();
		return haystack.includes(needle);
	});

	if (options.json) {
		console.log(JSON.stringify(events.slice(0, limit), null, 2));
		return;
	}

	if (events.length === 0) {
		console.log(chalk.gray(`No matches for "${query}"`));
		return;
	}

	console.log(
		chalk.bold(
			`${events.length} match(es) for "${query}" (showing ${Math.min(events.length, limit)})`,
		),
	);
	console.log();
	for (const event of events.slice(0, limit).reverse()) {
		console.log(formatEventLine(event));
	}
	console.log();
}

function renderTree(node: SwarmProfileNode, depth = 0, isLast = true): string {
	const indent =
		depth === 0 ? "" : "│   ".repeat(depth - 1) + (isLast ? "└── " : "├── ");
	const duration = node.durationMs > 0 ? chalk.gray(` (${node.durationMs}ms)`) : "";
	const eventCount = chalk.gray(` [${node.events.length}ev]`);
	const header = `${indent}${chalk.cyan(node.name)}${duration}${eventCount}`;
	const lines = [header];
	for (let i = 0; i < node.children.length; i++) {
		const child = node.children[i];
		const last = i === node.children.length - 1;
		lines.push(renderTree(child, depth + 1, last));
	}
	return lines.join("\n");
}

async function runTree(
	logPath: string,
	options: TraceCommandOptions,
): Promise<void> {
	if (!existsSync(logPath)) {
		throw new Error(`Trace log not found: ${logPath}`);
	}
	const nodes = await parseTraceFile(logPath);

	if (options.json) {
		console.log(JSON.stringify(nodes, null, 2));
		return;
	}

	if (nodes.length === 0) {
		console.log(chalk.gray("No correlated events to render as a tree"));
		return;
	}

	console.log(chalk.bold(`Swarm lifecycle tree (${nodes.length} root nodes)`));
	console.log();
	for (const node of nodes) {
		console.log(renderTree(node));
		console.log();
	}
}

function buildStats(events: TraceEvent[]): {
	byKind: Record<string, number>;
	byLevel: Record<string, number>;
	byActor: Record<string, number>;
	total: number;
} {
	const byKind: Record<string, number> = {};
	const byLevel: Record<string, number> = {};
	const byActor: Record<string, number> = {};
	for (const event of events) {
		byKind[event.kind] = (byKind[event.kind] ?? 0) + 1;
		byLevel[event.level] = (byLevel[event.level] ?? 0) + 1;
		const actor = event.actor ?? "unknown";
		byActor[actor] = (byActor[actor] ?? 0) + 1;
	}
	return { byKind, byLevel, byActor, total: events.length };
}

async function runStats(
	logPath: string,
	options: TraceCommandOptions,
): Promise<void> {
	if (!existsSync(logPath)) {
		throw new Error(`Trace log not found: ${logPath}`);
	}
	const events = applyFilters(
		await readEvents(logPath, Number.parseInt(options.limit ?? "10000", 10)),
		options,
	);
	const stats = buildStats(events);

	if (options.json) {
		console.log(JSON.stringify(stats, null, 2));
		return;
	}

	console.log(chalk.bold(`Trace stats — ${stats.total} events`));
	console.log();
	const levelEntries = Object.entries(stats.byLevel).sort((a, b) => b[1] - a[1]);
	if (levelEntries.length > 0) {
		console.log(chalk.underline("By level"));
		for (const [level, count] of levelEntries) {
			console.log(`  ${colorizeLevel(level as TraceLevel).padEnd(5)} ${count}`);
		}
		console.log();
	}

	const topKinds = Object.entries(stats.byKind)
		.sort((a, b) => b[1] - a[1])
		.slice(0, 15);
	if (topKinds.length > 0) {
		console.log(chalk.underline("Top kinds"));
		for (const [kind, count] of topKinds) {
			console.log(`  ${colorizeKind(kind).padEnd(28)} ${count}`);
		}
		console.log();
	}

	const actorEntries = Object.entries(stats.byActor).sort((a, b) => b[1] - a[1]);
	if (actorEntries.length > 0) {
		console.log(chalk.underline("By actor"));
		for (const [actor, count] of actorEntries) {
			console.log(`  ${chalk.cyan(actor).padEnd(20)} ${count}`);
		}
	}
}

async function runFollow(
	logPath: string,
	options: TraceCommandOptions,
): Promise<void> {
	if (!existsSync(logPath)) {
		throw new Error(`Trace log not found: ${logPath}`);
	}
	let lastSize = statSync(logPath).size;
	console.log(chalk.gray(`Tailing ${logPath} (Ctrl-C to stop)`));

	const drain = async () => {
		const currentSize = statSync(logPath).size;
		if (currentSize <= lastSize) {
			return;
		}
		const stream = createReadStream(logPath, {
			start: lastSize,
			end: currentSize,
		});
		const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
		const lines: string[] = [];
		for await (const line of rl) {
			lines.push(line);
		}
		lastSize = currentSize;

		for (const line of lines) {
			if (!line.trim()) continue;
			try {
				const event = JSON.parse(line) as TraceEvent;
				if (options.level && event.level !== options.level) continue;
				if (options.kind && !event.kind.includes(options.kind)) continue;
				console.log(formatEventLine(event));
			} catch {
				// skip
			}
		}
	};

	const interval = setInterval(() => {
		drain().catch((err) => {
			console.error(chalk.red(`Follow error: ${err.message}`));
		});
	}, 1000);
	await new Promise<void>((resolve) => {
		process.on("SIGINT", () => {
			clearInterval(interval);
			resolve();
		});
	});
}

function listKinds(): string {
	return [
		"model.* (request, response, token, thinking, error)",
		"tool.* (dispatched, start, success, error, retry, cache_hit/miss)",
		"file.* (read, write, edit, list, glob, delete)",
		"shell.* (start, stdout, stderr, exit)",
		"subagent.* / swarm.* (spawn, start, done, error)",
		"session.* (open, close, checkpoint, compacted)",
		"user.input, mcp.*, ws.*, error",
	].join("\n  ");
}

export function traceCommand(): Command {
	return new Command("trace")
		.description("Query the Tehuti trace log (~/.tehuti/trace.jsonl)")
		.argument("[action]", "Action: tail | show | search | tree | stats | kinds", "tail")
		.argument("[query]", "Search query or event id (for show/search)")
		.option("--json", "Print machine-readable JSON")
		.option("--follow", "Tail mode: follow the file as it grows")
		.option("--limit <n>", "Max events to read/print (default 20)", "20")
		.option("--level <level>", "Filter by level: debug | info | warn | error")
		.option("--kind <kind>", "Filter by kind substring (e.g. tool., file.)")
		.option("--session <id>", "Filter by session id")
		.option("--actor <actor>", "Filter by actor (main, subagent, ...)")
		.option("--since <value>", "Filter to events newer than e.g. 5m, 1h, 2026-07-12T10:00:00Z")
		.option("--from <iso>", "Filter to events >= timestamp (ISO 8601)")
		.option("--to <iso>", "Filter to events <= timestamp (ISO 8601)")
		.action(
			async (
				action: string,
				query: string | undefined,
				options: TraceCommandOptions,
				command: Command,
			) => {
				const logPath = defaultTraceLogPath();
				const opts = { ...options, ...command.optsWithGlobals() };

				try {
					if (action === "kinds" || action === "list") {
						console.log(chalk.bold("Supported trace kinds"));
						console.log(`  ${listKinds()}`);
						return;
					}

					if (action === "show") {
						if (!query) {
							console.error("Usage: tehuti trace show <id>");
							process.exitCode = 1;
							return;
						}
						await runShow(logPath, query, opts);
						return;
					}

					if (action === "search") {
						if (!query) {
							console.error("Usage: tehuti trace search <query>");
							process.exitCode = 1;
							return;
						}
						await runSearch(logPath, query, opts);
						return;
					}

					if (action === "tree") {
						await runTree(logPath, opts);
						return;
					}

					if (action === "stats") {
						await runStats(logPath, opts);
						return;
					}

					if (action === "tail") {
						if (opts.follow) {
							await runFollow(logPath, opts);
						} else {
							await runTail(logPath, opts);
						}
						return;
					}

					console.error(`Unknown trace action: ${action}`);
					console.error("Valid: tail, show, search, tree, stats, kinds");
					process.exitCode = 1;
				} catch (err) {
					console.error(
						chalk.red(
							`tehuti trace ${action} failed: ${err instanceof Error ? err.message : String(err)}`,
						),
					);
					process.exitCode = 1;
				}
			},
		);
}
