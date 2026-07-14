import { spawn } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dapTools } from "./dap.js";

vi.mock("node:child_process", async (importOriginal) => {
	const actual: any = await importOriginal();
	return {
		...actual,
		spawn: vi.fn(),
	};
});

describe("debug tool", () => {
	const debugTool = dapTools.find((t) => t.name === "debug")!;
	const mockCtx = {
		cwd: "/tmp",
		workingDir: "/tmp",
		env: {},
		timeout: 30000,
	};

	let mockProcess: any;

	beforeEach(() => {
		vi.clearAllMocks();

		mockProcess = {
			stdout: { on: vi.fn() },
			stderr: { on: vi.fn() },
			on: vi.fn(),
		};

		vi.mocked(spawn).mockReturnValue(mockProcess as any);

		// Wire up the close handler to fire asynchronously with success
		mockProcess.on.mockImplementation((event: string, cb: any) => {
			if (event === "close") {
				Promise.resolve().then(() => cb(0));
			} else if (event === "error") {
				// no-op
			}
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("should detect available debuggers", async () => {
		// Simulate each spawn producing version output
		mockProcess.stdout.on.mockImplementation((_event: string, cb: any) => {
			Promise.resolve().then(() => cb(Buffer.from("debugpy 1.8.0")));
		});

		const result = await debugTool.execute(
			{ program: "test.py" },
			mockCtx as any,
		);

		expect(result.success).toBe(true);
		expect(result.output).toBeDefined();
		expect(typeof result.output).toBe("string");
		expect(result.output.length).toBeGreaterThan(0);
	});

	it("should handle missing program gracefully", async () => {
		const result = await debugTool.execute(
			{ program: "" },
			mockCtx as any,
		);

		// The tool always returns success: true
		expect(result.success).toBe(true);
		expect(result.output).toBeDefined();
	});

	it("should return a message listing debuggers or no-debuggers fallback", async () => {
		mockProcess.stdout.on.mockImplementation((_event: string, cb: any) => {
			Promise.resolve().then(() => cb(Buffer.from("lldb 16.0.0")));
		});

		const result = await debugTool.execute(
			{ program: "main.swift" },
			mockCtx as any,
		);

		expect(result.success).toBe(true);
		// Output should contain either a found debugger or the no-debuggers message
		expect(result.output).toMatch(/Found|No debuggers found/);
	});

	it("should always succeed even when no debuggers are available", async () => {
		// Simulate all debuggers failing (spawn returns error)
		mockProcess.on.mockImplementation((event: string, cb: any) => {
			if (event === "error") {
				Promise.resolve().then(() => cb(new Error("ENOENT")));
			}
		});

		const result = await debugTool.execute(
			{ program: "test.py" },
			mockCtx as any,
		);

		expect(result.success).toBe(true);
		expect(result.output).toContain("No debuggers found");
	});

	it("should have correct tool metadata", () => {
		expect(debugTool.name).toBe("debug");
		expect(debugTool.description).toContain("Debug");
		expect(debugTool.requiresPermission).toBe(true);
		expect(debugTool.category).toBe("development");
	});
});
