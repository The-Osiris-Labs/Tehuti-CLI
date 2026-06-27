import { z } from "zod";
import { createTool } from "./registry.js";
import { addNode, searchGraph } from "../memory/graph.js";
import type { ToolContext } from "./registry.js";

export const memoryTools = [
	createTool({
		name: "store_insight",
		description: "Stores a factual insight, project rule, or important entity into Tehuti's long-term memory graph. Use 'project_rule' or 'critical_fact' for type to ensure it appears in future contexts.",
		parameters: z.object({
			id: z.string().describe("A unique identifier for the fact (e.g. 'auth-logic', 'react-setup')."),
			type: z.string().describe("Type of memory: 'project_rule', 'critical_fact', 'entity', or 'concept'."),
			content: z.string().describe("The information to store."),
		}),
		category: "system",
		execute: async (args: any, ctx: ToolContext) => {
			await addNode(args.id, args.type, args.content);
			return {
				output: `Stored ${args.type} '${args.id}' to long-term memory.`,
				success: true,
			};
		},
	}),
	createTool({
		name: "query_memory",
		description: "Searches the long-term memory graph by keyword or entity ID to retrieve past context.",
		parameters: z.object({
			query: z.string().describe("Keyword or entity ID to search for."),
		}),
		category: "system",
		execute: async (args: any, ctx: ToolContext) => {
			const results = await searchGraph(args.query);
			if (results.length === 0) {
				return {
					output: `No memory found matching '${args.query}'.`,
					success: true,
				};
			}
			return {
				output: results.map((n) => `[${n.type}] ${n.id}: ${n.content}`).join("\n"),
				success: true,
			};
		},
	}),
];
