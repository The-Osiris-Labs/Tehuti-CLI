export * from "./prompts.js";

export const PERMISSION_RULES = {
	fs: {
		read: { safe: true, requiresPermission: false },
		write: { safe: false, requiresPermission: true },
		edit: { safe: false, requiresPermission: true },
		delete: { safe: false, requiresPermission: true },
	},
	bash: {
		execute: { safe: false, requiresPermission: true },
	},
	web: {
		fetch: { safe: true, requiresPermission: false },
		search: { safe: true, requiresPermission: false },
	},
	mcp: {
		execute: { safe: false, requiresPermission: true },
	},
	git: {
		status: { safe: true, requiresPermission: false },
		diff: { safe: true, requiresPermission: false },
		log: { safe: true, requiresPermission: false },
		add: { safe: false, requiresPermission: true },
		commit: { safe: false, requiresPermission: true },
		branch: { safe: false, requiresPermission: true },
		remote: { safe: true, requiresPermission: false },
		pull: { safe: false, requiresPermission: true },
		push: { safe: false, requiresPermission: true },
	},
} as const;

type Category = keyof typeof PERMISSION_RULES;

export function isToolSafe(category: string, operation: string): boolean {
	const cat = category as Category;
	if (!(cat in PERMISSION_RULES)) return false;

	const catRules = PERMISSION_RULES[cat] as Record<string, { safe: boolean }>;
	const op = operation as string;
	if (!(op in catRules)) return false;

	return catRules[op].safe;
}

export function requiresPermission(
	category: string,
	operation: string,
): boolean {
	const cat = category as Category;
	if (!(cat in PERMISSION_RULES)) return true;

	const catRules = PERMISSION_RULES[cat] as Record<
		string,
		{ requiresPermission: boolean }
	>;
	const op = operation as string;
	if (!(op in catRules)) return true;

	return catRules[op].requiresPermission;
}

export interface PermissionRule {
	id: string;
	pattern: string;
	action: "allow" | "deny" | "prompt";
	scope: "session" | "always" | "once";
	reason?: string;
	createdAt: Date;
}

export interface PermissionPattern {
	tool: string | RegExp;
	args?: Record<string, string | RegExp>;
}

function parsePermissionPattern(pattern: string): PermissionPattern {
	const match = pattern.match(/^(\w+)(?:\(([^)]*)\))?$/);
	if (!match) {
		return { tool: pattern };
	}

	const tool = match[1];
	const argsStr = match[2];

	if (!argsStr) {
		return { tool };
	}

	const args: Record<string, string> = {};
	const parts = argsStr.split(",").map((p) => p.trim());

	for (const part of parts) {
		if (part.includes(":")) {
			const [key, value] = part.split(":").map((s) => s.trim());
			if (key && value) {
				args[key] = value;
			}
		} else {
			args._ = part;
		}
	}

	return { tool, args };
}

function matchesPattern(value: string, pattern: string): boolean {
	if (pattern === "*") return true;
	if (pattern.startsWith("*") && pattern.endsWith("*")) {
		return value.includes(pattern.slice(1, -1));
	}
	if (pattern.startsWith("*")) {
		return value.endsWith(pattern.slice(1));
	}
	if (pattern.endsWith("*")) {
		return value.startsWith(pattern.slice(0, -1));
	}
	if (pattern.includes("*")) {
		const regex = new RegExp(`^${pattern.replace(/\*/g, ".*")}$`);
		return regex.test(value);
	}
	return value === pattern;
}

export class PermissionManager {
	private rules: PermissionRule[] = [];
	private sessionAllowed: Set<string> = new Set();
	private sessionDenied: Set<string> = new Set();

	constructor() {
		this.loadRules();
	}

	private loadRules(): void {
		try {
			const stored = process.env.TEHUTI_PERMISSION_RULES;
			if (stored) {
				this.rules = JSON.parse(stored);
			}
		} catch {}
	}

	private saveRules(): void {
		try {
			process.env.TEHUTI_PERMISSION_RULES = JSON.stringify(this.rules);
		} catch {}
	}

	addRule(rule: Omit<PermissionRule, "id" | "createdAt">): PermissionRule {
		const fullRule: PermissionRule = {
			...rule,
			id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
			createdAt: new Date(),
		};
		this.rules.push(fullRule);
		this.saveRules();
		return fullRule;
	}

	removeRule(id: string): boolean {
		const index = this.rules.findIndex((r) => r.id === id);
		if (index >= 0) {
			this.rules.splice(index, 1);
			this.saveRules();
			return true;
		}
		return false;
	}

	listRules(): PermissionRule[] {
		return [...this.rules];
	}

	clearSessionDecisions(): void {
		this.sessionAllowed.clear();
		this.sessionDenied.clear();
	}

	check(
		toolName: string,
		args: Record<string, unknown>,
	): "allow" | "deny" | "prompt" {
		const key = this.makeKey(toolName, args);

		if (this.sessionAllowed.has(key)) return "allow";
		if (this.sessionDenied.has(key)) return "deny";

		for (const rule of this.rules) {
			if (this.matchesRule(toolName, args, rule)) {
				if (rule.scope === "always" || rule.scope === "session") {
					return rule.action;
				}
			}
		}

		return "prompt";
	}

	recordDecision(
		toolName: string,
		args: Record<string, unknown>,
		allowed: boolean,
	): void {
		const key = this.makeKey(toolName, args);
		if (allowed) {
			this.sessionAllowed.add(key);
		} else {
			this.sessionDenied.add(key);
		}
	}

	private makeKey(toolName: string, args: Record<string, unknown>): string {
		const argsStr = JSON.stringify(args, Object.keys(args).sort());
		return `${toolName}:${argsStr}`;
	}

	private matchesRule(
		toolName: string,
		args: Record<string, unknown>,
		rule: PermissionRule,
	): boolean {
		const pattern = parsePermissionPattern(rule.pattern);

		const toolMatch =
			typeof pattern.tool === "string"
				? matchesPattern(toolName, pattern.tool)
				: pattern.tool.test(toolName);

		if (!toolMatch) return false;

		if (!pattern.args) return true;

		for (const [key, valuePattern] of Object.entries(pattern.args)) {
			const actualValue = key === "_" ? args._ : args[key];
			if (actualValue === undefined) return false;

			const strValue = String(actualValue);
			const match =
				typeof valuePattern === "string"
					? matchesPattern(strValue, valuePattern)
					: valuePattern.test(strValue);

			if (!match) return false;
		}

		return true;
	}
}

export const permissionManager = new PermissionManager();

export function checkPermissionPattern(pattern: string): {
	valid: boolean;
	error?: string;
} {
	try {
		parsePermissionPattern(pattern);
		return { valid: true };
	} catch (error) {
		return {
			valid: false,
			error: error instanceof Error ? error.message : "Invalid pattern",
		};
	}
}
