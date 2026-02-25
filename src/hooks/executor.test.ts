import { beforeEach, describe, expect, it } from "vitest";
import {
	type HooksConfig,
	hookExecutor,
	parseHooksConfig,
} from "./executor.js";

describe("HookExecutor", () => {
	beforeEach(() => {
		hookExecutor.loadConfig({});
	});

	describe("parseHooksConfig", () => {
		it("should parse valid hooks config", () => {
			const config = {
				PreToolUse: [
					{
						matcher: "Write|Edit",
						hooks: [{ type: "command", command: "echo test" }],
					},
				],
				PostToolUse: [
					{
						matcher: "*",
						hooks: [{ type: "command", command: "npm run lint" }],
					},
				],
			};

			const result = parseHooksConfig(config);

			expect(result.PreToolUse).toBeDefined();
			expect(result.PreToolUse?.[0].matcher).toBe("Write|Edit");
			expect(result.PostToolUse).toBeDefined();
		});

		it("should return empty config for invalid input", () => {
			expect(parseHooksConfig(null)).toEqual({});
			expect(parseHooksConfig(undefined)).toEqual({});
			expect(parseHooksConfig("invalid")).toEqual({});
		});
	});

	describe("loadConfig", () => {
		it("should load hooks configuration", () => {
			const config: HooksConfig = {
				PreToolUse: [
					{
						matcher: "Bash",
						hooks: [{ type: "command", command: "echo checking" }],
					},
				],
			};

			hookExecutor.loadConfig(config);
		});
	});

	describe("matchesMatcher", () => {
		it("should match wildcard", async () => {
			hookExecutor.loadConfig({
				PreToolUse: [
					{
						matcher: "*",
						hooks: [{ type: "command", command: "echo test" }],
					},
				],
			});

			const result = await hookExecutor.executeHook("PreToolUse", {
				toolName: "AnyTool",
				args: {},
				cwd: "/tmp",
				env: {},
			});

			expect(result.proceed).toBe(true);
		});

		it("should match pipe-separated patterns", async () => {
			hookExecutor.loadConfig({
				PreToolUse: [
					{
						matcher: "Write|Edit|Bash",
						hooks: [{ type: "command", command: "echo valid" }],
					},
				],
			});

			const result = await hookExecutor.executeHook("PreToolUse", {
				toolName: "Edit",
				args: {},
				cwd: "/tmp",
				env: {},
			});

			expect(result.proceed).toBe(true);
		});

		it("should match prefix patterns", async () => {
			hookExecutor.loadConfig({
				PreToolUse: [
					{
						matcher: "mcp_*",
						hooks: [{ type: "command", command: "echo mcp" }],
					},
				],
			});

			const result = await hookExecutor.executeHook("PreToolUse", {
				toolName: "mcp_server_tool",
				args: {},
				cwd: "/tmp",
				env: {},
			});

			expect(result.proceed).toBe(true);
		});
	});

	describe("executeHook", () => {
		it("should proceed when no hooks configured", async () => {
			const result = await hookExecutor.executeHook("PreToolUse", {
				toolName: "Write",
				args: { file_path: "/tmp/test.txt" },
				cwd: "/tmp",
				env: {},
			});

			expect(result.proceed).toBe(true);
		});

		it("should proceed for non-matching tools", async () => {
			hookExecutor.loadConfig({
				PreToolUse: [
					{
						matcher: "Bash",
						hooks: [{ type: "command", command: "exit 1" }],
					},
				],
			});

			const result = await hookExecutor.executeHook("PreToolUse", {
				toolName: "Write",
				args: {},
				cwd: "/tmp",
				env: {},
			});

			expect(result.proceed).toBe(true);
		});

		it("should block on hook failure for PreToolUse", async () => {
			hookExecutor.loadConfig({
				PreToolUse: [
					{
						matcher: "*",
						hooks: [{ type: "command", command: "exit 1" }],
					},
				],
			});

			const result = await hookExecutor.executeHook("PreToolUse", {
				toolName: "Write",
				args: {},
				cwd: "/tmp",
				env: {},
			});

			expect(result.proceed).toBe(false);
			expect(result.error).toBeDefined();
		});

		it("should proceed on hook failure for PostToolUse", async () => {
			hookExecutor.loadConfig({
				PostToolUse: [
					{
						matcher: "*",
						hooks: [{ type: "command", command: "exit 1" }],
					},
				],
			});

			const result = await hookExecutor.executeHook("PostToolUse", {
				toolName: "Write",
				args: {},
				cwd: "/tmp",
				env: {},
			});

			expect(result.proceed).toBe(true);
		});
	});
});
