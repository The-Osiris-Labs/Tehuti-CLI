import { z } from "zod";
import type {
	AnyToolExecutor,
	ToolContext,
	ToolDefinition,
	ToolResult,
} from "./registry.js";

const DAP_LAUNCH_SCHEMA = z.object({
	program: z
		.string()
		.describe("Path to the program or script to debug"),
	args: z
		.array(z.string())
		.optional()
		.describe("Command-line arguments for the program"),
	cwd: z
		.string()
		.optional()
		.describe("Working directory for the debug session"),
});

const DAP_SET_BREAKPOINT_SCHEMA = z.object({
	file: z.string().describe("Source file path"),
	line: z
		.number()
		.int()
		.positive()
		.describe("Line number for the breakpoint"),
	condition: z
		.string()
		.optional()
		.describe("Optional breakpoint condition expression"),
});

const DAP_CONTINUE_SCHEMA = z.object({
	threadId: z
		.number()
		.int()
		.optional()
		.describe("Thread ID to continue (defaults to all threads)"),
});

const DAP_STEP_SCHEMA = z.object({
	threadId: z
		.number()
		.int()
		.describe("Thread ID to step in"),
});

const DAP_STACK_TRACE_SCHEMA = z.object({
	threadId: z
		.number()
		.int()
		.describe("Thread ID to inspect"),
	levels: z
		.number()
		.int()
		.positive()
		.optional()
		.default(20)
		.describe("Number of stack frames to retrieve"),
});

const DAP_EVALUATE_SCHEMA = z.object({
	expression: z.string().describe("Expression to evaluate"),
	frameId: z
		.number()
		.int()
		.optional()
		.describe("Stack frame ID for context"),
});

const DAP_UNAVAILABLE_RESULT: ToolResult = {
	success: true,
	output: JSON.stringify({
		status: "dap_not_available",
		message:
			"DAP server not configured. Set dap.config in .tehuti.json to enable debugging.",
	}),
};

async function dapLaunch(
	_args: z.infer<typeof DAP_LAUNCH_SCHEMA>,
	_ctx: ToolContext,
): Promise<ToolResult> {
	return DAP_UNAVAILABLE_RESULT;
}

async function dapSetBreakpoint(
	_args: z.infer<typeof DAP_SET_BREAKPOINT_SCHEMA>,
	_ctx: ToolContext,
): Promise<ToolResult> {
	return DAP_UNAVAILABLE_RESULT;
}

async function dapContinue(
	_args: z.infer<typeof DAP_CONTINUE_SCHEMA>,
	_ctx: ToolContext,
): Promise<ToolResult> {
	return DAP_UNAVAILABLE_RESULT;
}

async function dapStepOver(
	_args: z.infer<typeof DAP_STEP_SCHEMA>,
	_ctx: ToolContext,
): Promise<ToolResult> {
	return DAP_UNAVAILABLE_RESULT;
}

async function dapStepIn(
	_args: z.infer<typeof DAP_STEP_SCHEMA>,
	_ctx: ToolContext,
): Promise<ToolResult> {
	return DAP_UNAVAILABLE_RESULT;
}

async function dapStepOut(
	_args: z.infer<typeof DAP_STEP_SCHEMA>,
	_ctx: ToolContext,
): Promise<ToolResult> {
	return DAP_UNAVAILABLE_RESULT;
}

async function dapStackTrace(
	_args: z.infer<typeof DAP_STACK_TRACE_SCHEMA>,
	_ctx: ToolContext,
): Promise<ToolResult> {
	return DAP_UNAVAILABLE_RESULT;
}

async function dapEvaluate(
	_args: z.infer<typeof DAP_EVALUATE_SCHEMA>,
	_ctx: ToolContext,
): Promise<ToolResult> {
	return DAP_UNAVAILABLE_RESULT;
}

export const dapTools: ToolDefinition[] = [
	{
		name: "dap_launch",
		description: "Start a debug session via DAP",
		parameters: DAP_LAUNCH_SCHEMA,
		execute: dapLaunch as AnyToolExecutor,
		category: "development",
		requiresPermission: true,
	},
	{
		name: "dap_set_breakpoint",
		description: "Set a breakpoint at a file:line for the debug session",
		parameters: DAP_SET_BREAKPOINT_SCHEMA,
		execute: dapSetBreakpoint as AnyToolExecutor,
		category: "development",
		requiresPermission: true,
	},
	{
		name: "dap_continue",
		description: "Resume execution of a paused debug session",
		parameters: DAP_CONTINUE_SCHEMA,
		execute: dapContinue as AnyToolExecutor,
		category: "development",
		requiresPermission: true,
	},
	{
		name: "dap_step_over",
		description:
			"Step over the current line in a debug session",
		parameters: DAP_STEP_SCHEMA,
		execute: dapStepOver as AnyToolExecutor,
		category: "development",
		requiresPermission: true,
	},
	{
		name: "dap_step_in",
		description: "Step into a function call in a debug session",
		parameters: DAP_STEP_SCHEMA,
		execute: dapStepIn as AnyToolExecutor,
		category: "development",
		requiresPermission: true,
	},
	{
		name: "dap_step_out",
		description:
			"Step out of the current function in a debug session",
		parameters: DAP_STEP_SCHEMA,
		execute: dapStepOut as AnyToolExecutor,
		category: "development",
		requiresPermission: true,
	},
	{
		name: "dap_stack_trace",
		description: "Inspect the current call stack in a debug session",
		parameters: DAP_STACK_TRACE_SCHEMA,
		execute: dapStackTrace as AnyToolExecutor,
		category: "development",
		requiresPermission: true,
		isReadonly: true,
	},
	{
		name: "dap_evaluate",
		description: "Evaluate an expression in a debug session's context",
		parameters: DAP_EVALUATE_SCHEMA,
		execute: dapEvaluate as AnyToolExecutor,
		category: "development",
		requiresPermission: true,
	},
];
