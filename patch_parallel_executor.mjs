import fs from 'fs';

const path = 'src/agent/parallel-executor.ts';
let code = fs.readFileSync(path, 'utf8');

const safeToolsStr = `export const SAFE_PARALLEL_TOOLS = new Set([
	"read",
	"read_file",
	"read_image",
	"read_pdf",
	"glob",
	"grep",
	"grep_search",
	"file_info",
	"list_dir",
	"list_directory",
	"web_fetch",
	"webfetch",
	"web_search",
	"code_search",
	"git_status",
	"git_log",
	"git_diff",
]);

export const WRITE_TOOLS = new Set([
	"write",
	"write_file",
	"edit",
	"edit_file",
	"delete_file",
	"delete_dir",
	"create_dir",
	"move",
	"copy",
]);

`;

code = code.replace(
    'export const INTERACTIVE_TOOLS = new Set(["question"]);',
    safeToolsStr + 'export const INTERACTIVE_TOOLS = new Set(["question"]);'
);

code = code.replace(/const toolDef = getTool\(toolName\);/g, '');
code = code.replace(/} else if \(toolDef\?\.isReadonly\) {/g, '} else if (SAFE_PARALLEL_TOOLS.has(toolName)) {');
code = code.replace(/const hasWrites = names\.some\(\(n\) => \{\n\s+const tool = getTool\(n\);\n\s+return !tool\?\.isReadonly;\n\s+\}\);/g, 'const hasWrites = names.some((n) => WRITE_TOOLS.has(n));');

code = code.replace(/getTool\(tc\.function\.name\)\?\.isReadonly/g, 'SAFE_PARALLEL_TOOLS.has(tc.function.name)');
code = code.replace(/!getTool\(tc\.function\.name\)\?\.isReadonly/g, '!SAFE_PARALLEL_TOOLS.has(tc.function.name)');
code = code.replace(/!toolDef\?\.isReadonly/g, 'WRITE_TOOLS.has(toolName)');
code = code.replace(/shouldCacheTool\(toolDef, toolName, args\)/g, 'shouldCacheTool(toolName, args)');
code = code.replace(/invalidateOnWrite\(toolDef, toolName, args\)/g, 'invalidateOnWrite(toolName, args)');


fs.writeFileSync(path, code);
