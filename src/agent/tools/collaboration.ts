import { z } from "zod";
import type { ToolDefinition, ToolResult } from "./registry.js";

export const collaborationTools: ToolDefinition[] = [
	{
		name: "collaboration",
		description:
			"Multi-user collaboration features. Currently not available — transport layer not implemented.",
		parameters: z.object({
			action: z.enum(["status"]).describe("Action to perform"),
		}),
		category: "system",
		execute: async (): Promise<ToolResult> => ({
			success: true,
			output:
				"Collaboration features are not yet implemented. The transport layer is still under development.",
		}),
	},
];
