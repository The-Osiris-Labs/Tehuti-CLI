import { describe, it } from "vitest";
import { checkPermission } from "./src/permissions/prompts.js";
import { bashTool } from "./src/agent/tools/bash.js";
import { webTools } from "./src/agent/tools/web.js";
import { execSync } from "node:child_process";

describe("Live Demonstration", () => {
	it("should demonstrate bash, web search, and permissions", async () => {
		console.log("\\n\\n=======================================================");
		console.log("=== DEMO 1: Docker Daemon Detection (Bash Tool) ===");
		
		console.log("Bash tool loaded. Let's run a simple echo command.");
		try {
			const ctx = {
				cwd: process.cwd(),
				config: {
					mcp: { servers: {} },
					defaultMode: "interactive"
				}
			};
			const res = await bashTool.execute({ command: "echo 'Hello from Tehuti Bash Demo!'" }, ctx as any);
			console.log("Bash result object:", JSON.stringify(res, null, 2));
		} catch (e) {
			console.error("Bash failed:", (e as Error).message);
		}

		console.log("\\n=== DEMO 2: Web Search Error Surfacing ===");
		const webSearchTool = webTools.find((t: any) => t.name === "web_search");
		try {
			const res = await webSearchTool.execute({ query: "What is the capital of Egypt?" }, {} as any);
			console.log("Web search result (success):", res.success);
			console.log("Web search error output:\\n", res.error || "No error, query succeeded!");
		} catch (e) {
			console.error("Web search tool crashed instead of returning error payload:", (e as Error).message);
		}

		console.log("\\n=== DEMO 3: Production Permission Fallback (Fail Closed) ===");
		// Requesting write to a file, which is dangerous.
		// Since no UI resolver is mounted in this pure script context, it MUST fail closed.
		const result = await checkPermission(
			{ toolName: "write", args: { filePath: "/tmp/test.txt" } },
			{
				defaultMode: "interactive",
				alwaysAllow: [],
				alwaysDeny: [],
				trustedMode: false
			}
		);
		console.log("Is write allowed?", result.allowed);
		console.log("Reason:", result.reason);

		const safeResult = await checkPermission(
			{ toolName: "read", args: { filePath: "/tmp/test.txt" } },
			{
				defaultMode: "interactive",
				alwaysAllow: [],
				alwaysDeny: [],
				trustedMode: false
			}
		);
		console.log("Is read allowed (safe tool)?", safeResult.allowed);
		console.log("Reason:", safeResult.reason);
		console.log("=======================================================\\n\\n");
	});
});
