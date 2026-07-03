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
	readFilesThisSession?: Set<string>;
	agentContext?: any; // Avoiding circular dependency with AgentContext
}

export interface ToolDefinition {
	name: string;
	description: string;
	parameters: z.ZodType<unknown> | Record<string, unknown>;
	jsonSchema?: Record<string, unknown>;
	execute: (args: any, ctx: ToolContext) => Promise<ToolResult>;
	requiresPermission?: boolean;
	isReadonly?: boolean;
	prefetchRules?: Array<{
		tool: string;
		argMapper: (args: any, ctx: ToolContext) => unknown | null;
		condition?: (args: any) => boolean;
		priority?: "high" | "medium" | "low";
	}>;
	category:
		| "fs"
		| "bash"
		| "web"
		| "mcp"
		| "system"
		| "git"
		| "search"
		| "development";
	onRegister?: (manager: ToolRegistryManager) => Promise<void> | void;
	onUnregister?: (manager: ToolRegistryManager) => Promise<void> | void;
}

export type AnyToolExecutor = (
	args: any,
	ctx: ToolContext,
) => Promise<ToolResult>;

export function validateJsonSchema(
	data: unknown,
	schema: Record<string, any>,
): { success: boolean; error?: string } {
	if (!schema || typeof schema !== "object") {
		return { success: true };
	}

	const type = schema.type;
	if (type === "object") {
		if (typeof data !== "object" || data === null) {
			return { success: false, error: "Expected an object" };
		}

		const properties = schema.properties || {};
		const required = schema.required || [];

		// Check required fields
		for (const reqKey of required) {
			if (!(reqKey in data) || (data as any)[reqKey] === undefined) {
				return {
					success: false,
					error: `Missing required property: ${reqKey}`,
				};
			}
		}

		// Validate properties recursively
		for (const [key, val] of Object.entries(data)) {
			if (properties[key]) {
				const res = validateJsonSchema(val, properties[key]);
				if (!res.success) {
					return { success: false, error: `${key}: ${res.error}` };
				}
			}
		}
	} else if (type === "array") {
		if (!Array.isArray(data)) {
			return { success: false, error: "Expected an array" };
		}
		if (schema.items) {
			for (let i = 0; i < data.length; i++) {
				const res = validateJsonSchema(data[i], schema.items);
				if (!res.success) {
					return { success: false, error: `[${i}]: ${res.error}` };
				}
			}
		}
	} else if (type === "string") {
		if (typeof data !== "string") {
			return { success: false, error: `Expected string, got ${typeof data}` };
		}
		if (schema.enum && !schema.enum.includes(data)) {
			return {
				success: false,
				error: `Expected one of [${schema.enum.join(", ")}], got ${data}`,
			};
		}
	} else if (type === "number") {
		if (typeof data !== "number") {
			return { success: false, error: `Expected number, got ${typeof data}` };
		}
	} else if (type === "integer") {
		if (typeof data !== "number" || !Number.isInteger(data)) {
			return { success: false, error: `Expected integer, got ${data}` };
		}
	} else if (type === "boolean") {
		if (typeof data !== "boolean") {
			return { success: false, error: `Expected boolean, got ${typeof data}` };
		}
	}

	return { success: true };
}

export class ToolRegistryManager {
	private tools = new Map<string, ToolDefinition>();
	private parent?: ToolRegistryManager;

	constructor(parent?: ToolRegistryManager) {
		this.parent = parent;
	}

	registerTool(tool: ToolDefinition): void {
		if (this.tools.has(tool.name)) {
			debug.log("tools", `Overwriting existing tool: ${tool.name}`);
			const existing = this.tools.get(tool.name);
			if (existing?.onUnregister) {
				try {
					const res = existing.onUnregister(this);
					if (res instanceof Promise) {
						res.catch((err) =>
							debug.log(
								"tools",
								`Error in onUnregister for ${tool.name}:`,
								err,
							),
						);
					}
				} catch (err) {
					debug.log("tools", `Error in onUnregister for ${tool.name}:`, err);
				}
			}
		}
		this.tools.set(tool.name, tool);
		debug.log("tools", `Registered tool: ${tool.name}`);
		if (tool.onRegister) {
			try {
				const res = tool.onRegister(this);
				if (res instanceof Promise) {
					res.catch((err) =>
						debug.log("tools", `Error in onRegister for ${tool.name}:`, err),
					);
				}
			} catch (err) {
				debug.log("tools", `Error in onRegister for ${tool.name}:`, err);
			}
		}
	}

	registerTools(tools: ToolDefinition[]): void {
		for (const tool of tools) {
			this.registerTool(tool);
		}
	}

	unregisterTool(name: string): boolean {
		const tool = this.tools.get(name);
		if (tool) {
			if (tool.onUnregister) {
				try {
					const res = tool.onUnregister(this);
					if (res instanceof Promise) {
						res.catch((err) =>
							debug.log("tools", `Error in onUnregister for ${name}:`, err),
						);
					}
				} catch (err) {
					debug.log("tools", `Error in onUnregister for ${name}:`, err);
				}
			}
			this.tools.delete(name);
			return true;
		}
		return false;
	}

	unregisterToolsWhere(predicate: (tool: ToolDefinition) => boolean): number {
		let removed = 0;
		for (const [name, tool] of this.tools.entries()) {
			if (predicate(tool)) {
				this.unregisterTool(name);
				removed++;
			}
		}
		return removed;
	}

	getTool(name: string): ToolDefinition | undefined {
		if (this.tools.has(name)) {
			return this.tools.get(name);
		}
		return this.parent?.getTool(name);
	}

	getAllTools(): ToolDefinition[] {
		const all = new Map<string, ToolDefinition>();
		if (this.parent) {
			for (const tool of this.parent.getAllTools()) {
				all.set(tool.name, tool);
			}
		}
		for (const tool of this.tools.values()) {
			all.set(tool.name, tool);
		}
		return Array.from(all.values());
	}

	getToolsByCategory(category: ToolDefinition["category"]): ToolDefinition[] {
		return this.getAllTools().filter((t) => t.category === category);
	}

	clearTools(): void {
		for (const name of this.tools.keys()) {
			this.unregisterTool(name);
		}
		this.tools.clear();
	}

	getToolDefinitions(): OpenRouterTool[] {
		return this.getAllTools().map((tool) => {
			const schema =
				tool.jsonSchema ??
				(typeof (tool.parameters as any).safeParse === "function"
					? zodToJsonSchema(tool.parameters as z.ZodType<unknown>)
					: (tool.parameters as Record<string, unknown>));
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

	async executeTool(
		name: string,
		args: unknown,
		ctx: ToolContext,
	): Promise<ToolResult> {
		const tool = this.getTool(name);

		if (!tool) {
			return {
				success: false,
				output: "",
				error: `Unknown tool: ${name}. Please check the available tools list and use a valid tool name.`,
			};
		}

		debug.log("tools", `Executing tool: ${name}`, args);

		try {
			let validatedArgs: unknown;
			if (typeof (tool.parameters as any).safeParse === "function") {
				const parsed = (tool.parameters as z.ZodType<unknown>).safeParse(args);

				if (!parsed.success) {
					const formattedErrors = parsed.error.issues
						.map((issue) => {
							const path =
								issue.path.length > 0 ? issue.path.join(".") : "value";
							return `${path}: ${issue.message}`;
						})
						.join("; ");

					return {
						success: false,
						output: "",
						error: `Invalid parameters for ${name}: ${formattedErrors}. Please review the parameter schema and provide valid arguments.`,
					};
				}
				validatedArgs = parsed.data;
			} else {
				const validationResult = validateJsonSchema(
					args,
					tool.parameters as Record<string, unknown>,
				);
				if (!validationResult.success) {
					return {
						success: false,
						output: "",
						error: `Invalid parameters for ${name}: ${validationResult.error}. Please review the parameter schema and provide valid arguments.`,
					};
				}
				validatedArgs = args;
			}

			const result = await tool.execute(validatedArgs, ctx);
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
				error: `Tool execution failed: ${message}. Please review the error, adjust your arguments, and try again.`,
			};
		}
	}
}

// Global default registry for backward compatibility
export const globalRegistry = new ToolRegistryManager();

export function createTool(tool: ToolDefinition): ToolDefinition {
	return tool;
}

export function registerTool(tool: ToolDefinition): void {
	globalRegistry.registerTool(tool);
}

export function registerTools(tools: ToolDefinition[]): void {
	globalRegistry.registerTools(tools);
}

export function unregisterTool(name: string): boolean {
	return globalRegistry.unregisterTool(name);
}

export function unregisterToolsWhere(
	predicate: (tool: ToolDefinition) => boolean,
): number {
	return globalRegistry.unregisterToolsWhere(predicate);
}

export function getTool(name: string): ToolDefinition | undefined {
	return globalRegistry.getTool(name);
}

export function getAllTools(): ToolDefinition[] {
	return globalRegistry.getAllTools();
}

export function getToolsByCategory(
	category: ToolDefinition["category"],
): ToolDefinition[] {
	return globalRegistry.getToolsByCategory(category);
}

export function clearTools(): void {
	globalRegistry.clearTools();
}

export function getToolDefinitions(): OpenRouterTool[] {
	return globalRegistry.getToolDefinitions();
}

export async function executeTool(
	name: string,
	args: unknown,
	ctx: ToolContext,
): Promise<ToolResult> {
	return globalRegistry.executeTool(name, args, ctx);
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
