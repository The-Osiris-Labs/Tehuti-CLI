import fs from 'fs';

let path = 'src/agent/parallel-executor.ts';
let code = fs.readFileSync(path, 'utf8');

code = code.replace(/shouldCacheTool\(toolName, args\)/g, 'shouldCacheTool(getTool(toolName), toolName, args)');
code = code.replace(/invalidateOnWrite\(toolName, args\)/g, 'invalidateOnWrite(getTool(toolName), toolName, args)');

fs.writeFileSync(path, code);

path = 'src/agent/parallel-executor.test.ts';
code = fs.readFileSync(path, 'utf8');
const lines = code.split('\n');
if (lines[lines.length - 1] === '' && lines[lines.length - 2] === '}' && lines[lines.length - 3] === '}') {
    // maybe there's a stray bracket
}
