import fs from 'fs';

const path = 'src/agent/index.ts';
let code = fs.readFileSync(path, 'utf8');

const regex = /export async function runAgentLoop\([\s\S]*?(?=export async function runOneShot)/;

const newCode = `import { runAgentLoop as _runAgentLoop } from "./loop/index.js";

export async function runAgentLoop(
	ctx: AgentContext,
	userMessage: string,
	options: AgentLoopOptions = {},
): Promise<AgentLoopResult> {
	const client = createProviderClient(ctx);
	return await _runAgentLoop(ctx, userMessage, client, syncMCPToolRegistry, options);
}

`;

if (regex.test(code)) {
    code = code.replace(regex, newCode);
    fs.writeFileSync(path, code);
    console.log("Replaced runAgentLoop successfully.");
} else {
    console.error("Could not find runAgentLoop block.");
}
