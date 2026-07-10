import { z } from "zod";
import { addNode, searchGraph } from "../memory/graph.js";
import type { ToolContext } from "./registry.js";
import { createTool } from "./registry.js";

export const memoryTools = [
	createTool({
		name: "store_insight",
		description:
			"Stores a factual insight, project rule, or important entity into Tehuti's long-term memory graph. Use 'project_rule' or 'critical_fact' for type to ensure it appears in future contexts.",
		parameters: z.object({
			id: z
				.string()
				.describe(
					"A unique identifier for the fact (e.g. 'auth-logic', 'react-setup').",
				),
			type: z
				.string()
				.describe(
					"Type of memory: 'project_rule', 'critical_fact', 'entity', or 'concept'.",
				),
			content: z.string().describe("The information to store."),
			epistemicStatus: z
				.enum(["verified_fact", "speculative", "user_preference"])
				.optional()
				.describe(
					"Epistemic tag. Use 'verified_fact' if proven via empirical output. Use 'speculative' if inferred.",
				),
			confidenceScore: z
				.number()
				.min(0)
				.max(1)
				.optional()
				.describe(
					"Confidence from 0.0 to 1.0 about the accuracy of this insight.",
				),
		}),
		category: "system",
		execute: async (args: any, _ctx: ToolContext) => {
			await addNode(
				args.id,
				args.type,
				args.content,
				process.cwd(),
				0,
				0,
				args.epistemicStatus,
				args.confidenceScore,
			);
			const statusNote = args.epistemicStatus
				? ` [${args.epistemicStatus}]`
				: "";
			return {
				output: `Stored ${args.type} '${args.id}'${statusNote} to long-term memory.`,
				success: true,
			};
		},
	}),
	createTool({
		name: "query_memory",
		description:
			"Searches the long-term memory graph by keyword or entity ID to retrieve past context.",
		parameters: z.object({
			query: z.string().describe("Keyword or entity ID to search for."),
		}),
		category: "system",
		execute: async (args: any, _ctx: ToolContext) => {
			const results = await searchGraph(args.query);
			if (results.length === 0) {
				return {
					output: `No memory found matching '${args.query}'.`,
					success: true,
				};
			}
			return {
				output: results
					.map((n) => `[${n.type}] ${n.id}: ${n.content}`)
					.join("\n"),
				success: true,
			};
		},
	}),
];
