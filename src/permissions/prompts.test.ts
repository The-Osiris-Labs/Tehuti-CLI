import { describe, expect, it, vi } from "vitest";
import type { PermissionsConfig } from "../config/schema.js";
import { checkPermission, setPermissionResolver } from "./prompts.js";
import {
	isToolSafe,
	matchesPattern,
	permissionManager,
	requiresPermission,
} from "./rules.js";

// Mock @inquirer/prompts confirm
vi.mock("@inquirer/prompts", () => ({
	confirm: vi.fn().mockResolvedValue(true),
}));

import { confirm } from "@inquirer/prompts";

describe("Permissions and Rules System", () => {
	describe("matchesPattern", () => {
		it("should match exact string", () => {
			expect(matchesPattern("read", "read")).toBe(true);
			expect(matchesPattern("read", "write")).toBe(false);
		});

		it("should match prefix wildcard", () => {
			expect(matchesPattern("git_status", "git_*")).toBe(true);
			expect(matchesPattern("git_status", "git*")).toBe(true);
			expect(matchesPattern("bash", "git_*")).toBe(false);
		});

		it("should match suffix wildcard", () => {
			expect(matchesPattern("git_status", "*_status")).toBe(true);
			expect(matchesPattern("git_status", "*status")).toBe(true);
			expect(matchesPattern("bash", "*_status")).toBe(false);
		});

		it("should match middle/multiple wildcards", () => {
			expect(matchesPattern("git_commit_force", "git*force")).toBe(true);
			expect(matchesPattern("git_commit_force", "*commit*")).toBe(true);
		});

		it("should escape special RegExp characters to prevent regex injection", () => {
			// Without escaping, dot matches any character (e.g. "a-b" matches "a.b").
			// With escaping, "a.b" pattern only matches "a.b" exactly (or if '*' is used).
			expect(matchesPattern("axb", "a.b")).toBe(false);
			expect(matchesPattern("a.b", "a.b")).toBe(true);

			// Check bracket matching literal brackets
			expect(matchesPattern("git[commit]", "git[commit]")).toBe(true);
			// Check brackets with wildcards
			expect(matchesPattern("git[commit]", "git[*]")).toBe(true);
			expect(matchesPattern("git(commit)", "git(commit)")).toBe(true);
		});
	});

	describe("Prototype Pollution Prevention", () => {
		it("should not crash or return true for inherited Object properties in isToolSafe", () => {
			expect(isToolSafe("toString", "safe")).toBe(false);
			expect(isToolSafe("__proto__", "safe")).toBe(false);
		});

		it("should not crash or return false for inherited Object properties in requiresPermission", () => {
			expect(requiresPermission("toString", "safe")).toBe(true);
			expect(requiresPermission("__proto__", "safe")).toBe(true);
		});
	});

	describe("checkPermission validation", () => {
		beforeEach(() => {
			setPermissionResolver(async () => {
				return await confirm({ message: "Allow?" });
			});
		});

		const baseConfig: PermissionsConfig = {
			defaultMode: "interactive",
			alwaysAllow: ["read", "glob", "git_*"],
			alwaysDeny: ["delete_*"],
			trustedMode: false,
			allowedCommands: ["git status", "npm test*"],
			deniedCommands: ["rm -rf*", "*DROP DATABASE*"],
		};

		it("should allow trustedMode", async () => {
			const res = await checkPermission(
				{ toolName: "write", args: {} },
				{ ...baseConfig, trustedMode: true },
			);
			expect(res.allowed).toBe(true);
			expect(res.reason).toBe("Trusted mode enabled");
		});

		it("should always deny if tool is in alwaysDeny (with wildcard support)", async () => {
			const res = await checkPermission(
				{ toolName: "delete_file", args: {} },
				baseConfig,
			);
			expect(res.allowed).toBe(false);
			expect(res.reason).toBe("Tool in always-deny list");
		});

		it("should always allow if tool is in alwaysAllow (with wildcard support)", async () => {
			const res1 = await checkPermission(
				{ toolName: "read", args: {} },
				baseConfig,
			);
			expect(res1.allowed).toBe(true);
			expect(res1.reason).toBe("Tool in always-allow list");

			const res2 = await checkPermission(
				{ toolName: "git_commit", args: {} },
				baseConfig,
			);
			expect(res2.allowed).toBe(true);
			expect(res2.reason).toBe("Tool in always-allow list");
		});

		it("should check allowedCommands for bash tool", async () => {
			const res = await checkPermission(
				{ toolName: "bash", args: { command: "git status" } },
				baseConfig,
			);
			expect(res.allowed).toBe(true);
			expect(res.reason).toBe("Command in allowed-commands list");
		});

		it("should check deniedCommands for bash tool", async () => {
			const res = await checkPermission(
				{ toolName: "bash", args: { command: "rm -rf /" } },
				baseConfig,
			);
			expect(res.allowed).toBe(false);
			expect(res.reason).toBe("Command in denied-commands list");
		});

		it("should check allowedCommands with wildcards", async () => {
			const res = await checkPermission(
				{ toolName: "bash", args: { command: "npm test -- --watch" } },
				baseConfig,
			);
			expect(res.allowed).toBe(true);
			expect(res.reason).toBe("Command in allowed-commands list");
		});

		it("should check deniedCommands with wildcards", async () => {
			const res = await checkPermission(
				{ toolName: "bash", args: { command: "sql; DROP DATABASE tehuti;" } },
				baseConfig,
			);
			expect(res.allowed).toBe(false);
			expect(res.reason).toBe("Command in denied-commands list");
		});

		it("should check defaultMode readonly", async () => {
			const res = await checkPermission(
				{ toolName: "write", args: {} },
				{ ...baseConfig, alwaysAllow: [], defaultMode: "readonly" },
			);
			expect(res.allowed).toBe(false);
			expect(res.reason).toBe("Read-only mode");
		});

		it("should trigger interactivePrompt and cache decision in PermissionManager", async () => {
			permissionManager.clearSessionDecisions();
			vi.mocked(confirm).mockResolvedValueOnce(true);

			const res = await checkPermission(
				{ toolName: "write", args: { filePath: "test.txt" } },
				{ ...baseConfig, alwaysAllow: [] },
			);
			expect(res.allowed).toBe(true);
			expect(res.reason).toBe("User approved");

			// The decision should be cached now
			const cachedRes = await checkPermission(
				{ toolName: "write", args: { filePath: "test.txt" } },
				{ ...baseConfig, alwaysAllow: [] },
			);
			expect(cachedRes.allowed).toBe(true);
			expect(cachedRes.reason).toBe("Allowed by permission rule");
		});
	});
});
