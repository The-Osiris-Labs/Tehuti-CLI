import type { ContentBlock } from "../../api/base-client.js";
import type { ToolResult } from "./registry.js";

const MODEL_TOOL_RESULT_MAX_CHARS = 250000;

export function formatToolResultForLLM(result: unknown): string | ContentBlock[] {
	const record =
		result && typeof result === "object"
			? (result as Record<string, unknown>)
			: undefined;
	const outStr = String(record?.output ?? "");
	const baseResultStr = record?.success
		? outStr
		: `Error: ${String(record?.error ?? "Tool failed")}\nOutput: ${outStr}`;

	let diagnosticsHeader = "";
	if (record?.metadata && typeof record.metadata === "object") {
		const meta = record.metadata as Record<string, unknown>;
		if (typeof meta.base64 === "string" && typeof meta.mimeType === "string") {
			return [
				{
					type: "text",
					text: record?.success
						? outStr
						: `Error: ${String(record?.error ?? "Tool failed")}\nOutput: ${outStr}`,
				},
				{
					type: "image_url",
					image_url: {
						url: `data:${meta.mimeType};base64,${meta.base64}`,
					},
				},
			];
		}

		const entries = Object.entries(meta)
			.filter(
				([k, v]) =>
					v !== undefined && v !== null && k !== "base64" && k !== "mimeType",
			)
			.map(([k, v]) => `${k}: ${String(v)}`);
		if (entries.length > 0) {
			diagnosticsHeader = `[Diagnostics | ${entries.join(" | ")}]\n`;
		}
	}

	const resultStr = `${diagnosticsHeader}${baseResultStr}`;
	if (resultStr.length <= MODEL_TOOL_RESULT_MAX_CHARS) {
		return resultStr;
	}
	return `${resultStr.slice(0, MODEL_TOOL_RESULT_MAX_CHARS)}\n... [Output truncated: showing ${MODEL_TOOL_RESULT_MAX_CHARS.toLocaleString()} of ${resultStr.length.toLocaleString()} total characters]`;
}

export interface ToolFailureHealer {
	wrapToolFailure?: (
		toolName: string,
		args: unknown,
		result: ToolResult,
	) => Promise<ToolResult> | ToolResult;
}

export function makeToolErrorResult(
	error: unknown,
	output = "",
	metadata?: Record<string, unknown>,
): ToolResult {
	return {
		success: false,
		output,
		error: error instanceof Error ? error.message : String(error),
		...(metadata ? { metadata } : {}),
	};
}

export function normalizeToolResult(result: unknown): ToolResult {
	if (result && typeof result === "object") {
		const record = result as Record<string, unknown>;
		if ("success" in record) {
			return {
				success: record.success !== false,
				output:
					typeof record.output === "string"
						? record.output
						: JSON.stringify(record.output ?? ""),
				...(typeof record.uiOutput === "string"
					? { uiOutput: record.uiOutput }
					: {}),
				...(record.error !== undefined ? { error: String(record.error) } : {}),
				...(record.metadata &&
				typeof record.metadata === "object" &&
				!Array.isArray(record.metadata)
					? { metadata: record.metadata as Record<string, unknown> }
					: {}),
			};
		}

		if ("error" in record) {
			return makeToolErrorResult(record.error, String(record.output ?? ""));
		}
	}

	return {
		success: true,
		output: typeof result === "string" ? result : JSON.stringify(result ?? ""),
	};
}

export async function applySelfHealingSafely(
	toolName: string,
	args: unknown,
	result: ToolResult,
	selfHealer?: ToolFailureHealer,
): Promise<ToolResult> {
	if (result.success || typeof selfHealer?.wrapToolFailure !== "function") {
		return result;
	}

	try {
		return normalizeToolResult(
			await selfHealer.wrapToolFailure(toolName, args, result),
		);
	} catch (error) {
		return {
			...result,
			success: false,
			error: `${result.error ?? "Tool failed"}; self-healing failed: ${
				error instanceof Error ? error.message : String(error)
			}`,
			metadata: {
				...(result.metadata ?? {}),
				selfHealingFailed: true,
			},
		};
	}
}
