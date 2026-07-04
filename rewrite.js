import fs from 'fs';

const chatTsPath = '/Users/youssefsala7/Projects/Tehuti-CLI-Revival/src/cli/commands/chat.ts';
let content = fs.readFileSync(chatTsPath, 'utf8');

// 1. Add imports
content = content.replace(
    'import { useChatState } from "../ui/hooks/useChatState.js";',
    'import { useChatState } from "../ui/hooks/useChatState.js";\nimport { bootstrapCLI, loadTehutiConfig } from "../bootstrap.js";\nimport { renderMarkdown } from "../ui/markdown-mapper.js";'
);

// 2. Remove renderMarkdown and config functions (lines 473-820 approx)
// Find start of renderMarkdown
const renderMarkdownStart = content.indexOf('function renderMarkdown(');
// Find end of saveTehutiConfig
const saveTehutiConfigStart = content.indexOf('function saveTehutiConfig(');
const saveTehutiConfigEnd = content.indexOf('}', saveTehutiConfigStart) + 1;

if (renderMarkdownStart !== -1 && saveTehutiConfigEnd !== 0) {
    content = content.slice(0, renderMarkdownStart) + content.slice(saveTehutiConfigEnd);
}

// 3. Remove bootstrap logic from .action
const actionStartStr = '.action(async (prompt?: string, options?: any) => {\n\t\t\tconst opts = options;';
const actionStart = content.indexOf(actionStartStr);
if (actionStart !== -1) {
    const afterActionStart = actionStart + actionStartStr.length;
    // Find the end of the bootstrap logic to remove
    const mcpConnectEndStr = 'await mcpManager.connectAll(cfg);\n\t\t\t}';
    const mcpConnectEnd = content.indexOf(mcpConnectEndStr, afterActionStart) + mcpConnectEndStr.length;
    
    if (mcpConnectEnd > afterActionStart) {
        const replacement = '\n\t\t\tconst { cfg, apiKey, model, diffPreview } = await bootstrapCLI(prompt, opts);';
        content = content.slice(0, afterActionStart) + replacement + content.slice(mcpConnectEnd);
    }
}

fs.writeFileSync(chatTsPath, content);
console.log('Refactoring complete');
