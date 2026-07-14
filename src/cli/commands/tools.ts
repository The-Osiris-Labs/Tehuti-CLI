import chalk from "chalk";
import { Command } from "commander";
import { BRANDING } from "../../branding/index.js";
import "../../agent/index.js";
import { getAllTools } from "../../agent/tools/registry.js";
import { mcpManager } from "../../mcp/index.js";

export function toolsCommand(): Command {
	return new Command("tools")
		.description("List registered built-in and discovered MCP tools")
		.argument("[action]", "Action: list", "list")
		.option("--json", "Print machine-readable JSON")
		.action((action: string, options: { json?: boolean }, command: Command) => {
			if (action !== "list") {
				console.error(`Unknown tools action: ${action}`);
				process.exitCode = 1;
				return;
			}

			const builtIn = getAllTools().map((tool) => ({
				name: tool.name,
				category: tool.category,
				intent: tool.intent,
				readonly: tool.isReadonly,
			}));
			const mcp = mcpManager.getAllTools().map(({ serverName, tool }) => ({
				name: `mcp_${serverName}_${tool.name}`,
				server: serverName,
				description: tool.description,
			}));

			if (options.json || Boolean(command.optsWithGlobals().json)) {
				console.log(JSON.stringify({ builtIn, mcp }, null, 2));
				return;
			}

			console.log();
			console.log(chalk.hex(BRANDING.colors.primary)("  𓆣 Tehuti tools"));
			console.log();
			console.log(chalk.bold(`  Built-in (${builtIn.length})`));
			for (const tool of builtIn) {
				const mode =
					tool.intent || (tool.readonly ? "read-only" : "destructive");
				console.log(
					`    ${chalk.cyan(tool.name)}  ${chalk.gray(`${tool.category} · ${mode}`)}`,
				);
			}

			console.log();
			console.log(chalk.bold(`  Discovered MCP (${mcp.length})`));
			if (mcp.length === 0) {
				console.log(chalk.gray("    None connected or discovered."));
			} else {
				for (const tool of mcp) {
					console.log(
						`    ${chalk.cyan(tool.name)}  ${chalk.gray(tool.server)}`,
					);
				}
			}
			console.log();
		});
}
