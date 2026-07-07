import type { ToolResult } from "./registry.js";

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
