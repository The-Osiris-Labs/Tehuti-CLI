import type { z } from "zod";
import type { OpenRouterTool } from "../../api/openrouter.js";
import { debug } from "../../utils/debug.js";

export interface ToolResult {
	success: boolean;
	output: string;
	error?: string;
	metadata?: Record<string, unknown>;
}

export interface DiffPreviewOptions {
	showPreview: boolean;
	autoConfirm?: boolean;
	maxDiffLines?: number;
}

export interface ToolContext {
	cwd: string;
	workingDir: string;
	env: Record<string, string>;
	timeout: number;
	signal?: AbortSignal;
	diffPreview?: DiffPreviewOptions;
	cache?: unknown;
}

export interface ToolDefinition {
	name: string;
	description: string;
	parameters: z.ZodType<unknown>;
	execute: (args: unknown, ctx: ToolContext) => Promise<ToolResult>;
	requiresPermission?: boolean;
	category: "fs" | "bash" | "web" | "mcp" | "system" | "git";
}

export type AnyToolExecutor = (
	args: unknown,
	ctx: ToolContext,
) => Promise<ToolResult>;

const toolRegistry = new Map<string, ToolDefinition>();

export function registerTool(tool: ToolDefinition): void {
	if (toolRegistry.has(tool.name)) {
		debug.log("tools", `Overwriting existing tool: ${tool.name}`);
	}
	toolRegistry.set(tool.name, tool);
	debug.log("tools", `Registered tool: ${tool.name}`);
}

export function registerTools(tools: ToolDefinition[]): void {
	for (const tool of tools) {
		registerTool(tool);
	}
}

export function getTool(name: string): ToolDefinition | undefined {
	return toolRegistry.get(name);
}

export function getAllTools(): ToolDefinition[] {
	return Array.from(toolRegistry.values());
}

export function getToolsByCategory(
	category: ToolDefinition["category"],
): ToolDefinition[] {
	return getAllTools().filter((t) => t.category === category);
}

export function clearTools(): void {
	toolRegistry.clear();
}

export function getToolDefinitions(): OpenRouterTool[] {
	return getAllTools().map((tool) => {
		const schema = zodToJsonSchema(tool.parameters);
		return {
			type: "function",
			function: {
				name: tool.name,
				description: tool.description,
				parameters: schema,
			},
		};
	});
}

export async function executeTool(
	name: string,
	args: unknown,
	ctx: ToolContext,
): Promise<ToolResult> {
	const tool = getTool(name);

	if (!tool) {
		return {
			success: false,
			output: "",
			error: `Unknown tool: ${name}`,
		};
	}

	debug.log("tools", `Executing tool: ${name}`, args);

	try {
		const parsed = tool.parameters.safeParse(args);

		if (!parsed.success) {
			const formattedErrors = parsed.error.issues
				.map((issue) => {
					const path = issue.path.length > 0 ? issue.path.join(".") : "value";
					return `${path}: ${issue.message}`;
				})
				.join("; ");

			return {
				success: false,
				output: "",
				error: `Invalid parameters for ${name}: ${formattedErrors}`,
			};
		}

		const result = await tool.execute(parsed.data, ctx);
		debug.log(
			"tools",
			`Tool ${name} completed: ${result.success ? "success" : "failed"}`,
		);

		return result;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		debug.log("tools", `Tool ${name} error: ${message}`);

		return {
			success: false,
			output: "",
			error: message,
		};
	}
}

function zodToJsonSchema(schema: z.ZodType<unknown>): Record<string, unknown> {
	const def = (schema as z.ZodType<unknown> & { _def: unknown })._def as Record<
		string,
		unknown
	>;

	if (!def) {
		return { type: "object" };
	}

	const typeName = def.typeName as string | undefined;

	switch (typeName) {
		case "ZodString":
			return {
				type: "string",
				description: def.description as string | undefined,
			};
		case "ZodNumber":
			return {
				type: "number",
				description: def.description as string | undefined,
			};
		case "ZodBoolean":
			return {
				type: "boolean",
				description: def.description as string | undefined,
			};
		case "ZodArray":
			return {
				type: "array",
				items: zodToJsonSchema(def.type as z.ZodType<unknown>),
				description: def.description as string | undefined,
			};
		case "ZodObject": {
			const shapeDef = def.shape;
			const shape = (
				typeof shapeDef === "function" ? shapeDef() : shapeDef
			) as Record<string, z.ZodType<unknown>>;
			const properties: Record<string, unknown> = {};
			const required: string[] = [];

			for (const [key, value] of Object.entries(shape)) {
				properties[key] = zodToJsonSchema(value);
				const innerDef = (value as z.ZodType<unknown> & { _def: unknown })
					._def as Record<string, unknown>;
				const innerTypeName = innerDef?.typeName as string | undefined;
				if (
					innerTypeName !== "ZodOptional" &&
					innerTypeName !== "ZodNullable" &&
					innerTypeName !== "ZodDefault"
				) {
					required.push(key);
				}
			}

			return {
				type: "object",
				properties,
				required: required.length > 0 ? required : undefined,
				description: def.description as string | undefined,
			};
		}
		case "ZodOptional":
		case "ZodNullable":
			return zodToJsonSchema(def.innerType as z.ZodType<unknown>);
		case "ZodDefault":
			return zodToJsonSchema(def.innerType as z.ZodType<unknown>);
		case "ZodEnum":
			return {
				type: "string",
				enum: def.values as string[],
				description: def.description as string | undefined,
			};
		case "ZodLiteral":
			return {
				type: typeof def.value,
				const: def.value,
				description: def.description as string | undefined,
			};
		case "ZodUnion":
			return {
				oneOf: (def.options as z.ZodType<unknown>[]).map((o) =>
					zodToJsonSchema(o),
				),
				description: def.description as string | undefined,
			};
		case "ZodRecord":
			return {
				type: "object",
				additionalProperties: zodToJsonSchema(
					def.valueType as z.ZodType<unknown>,
				),
				description: def.description as string | undefined,
			};
		case "ZodTuple":
			return {
				type: "array",
				items: (def.items as z.ZodType<unknown>[]).map((i) =>
					zodToJsonSchema(i),
				),
				minItems: (def.items as z.ZodType<unknown>[]).length,
				maxItems: (def.items as z.ZodType<unknown>[]).length,
				description: def.description as string | undefined,
			};
		case "ZodEffects":
			return zodToJsonSchema(def.schema as z.ZodType<unknown>);
		case "ZodLazy":
			return zodToJsonSchema((def.getter as () => z.ZodType<unknown>)());
		case "ZodIntersection": {
			const left = zodToJsonSchema(def.left as z.ZodType<unknown>);
			const right = zodToJsonSchema(def.right as z.ZodType<unknown>);
			return {
				allOf: [left, right],
				description: def.description as string | undefined,
			};
		}
		default:
			return { type: "object" };
	}
}
