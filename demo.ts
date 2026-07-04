
import { checkPermission } from "./src/permissions/prompts.js";
import { getToolDefinitions } from "./src/agent/tools/index.js";

async function runDemo() {
	console.log("=== DEMO 1: Docker Daemon Detection ===");
	const tools = getToolDefinitions();
	const bashTool = tools.find(t => t.name === "bash");
	
	console.log("Bash tool loaded. Let's run a simple echo command.");
	try {
		// Mock the context
		const ctx = {
			config: {
				mcp: { servers: {} },
				defaultMode: "interactive"
			}
		};
		// Disable docker explicitly or let it detect
		const res = await bashTool.execute({ command: "echo 'Hello from Tehuti Bash!'" }, ctx);
		console.log("Bash output:", JSON.stringify(res.output).trim());
	} catch (e) {
		console.error("Bash failed:", e.message);
	}

	console.log("\n=== DEMO 2: Web Search Error Surfacing ===");
	const webSearchTool = tools.find(t => t.name === "web_search");
	try {
		const res = await webSearchTool.execute({ query: "What is the capital of Egypt?" }, {});
		console.log("Web search result (success):", res.success);
		console.log("Web search error output:\n", res.error);
	} catch (e) {
		console.error("Web search tool crashed instead of returning error payload:", e.message);
	}

	console.log("\n=== DEMO 3: Production Permission Fallback (Fail Closed) ===");
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
}

runDemo().catch(console.error);
