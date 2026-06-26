import fs from 'fs';

const path = 'src/agent/parallel-executor.ts';
let code = fs.readFileSync(path, 'utf8');

const regex1 = /export const SAFE_PARALLEL_TOOLS = new Set\(\[[\s\S]*?\]\);\n+/;
const regex2 = /export const WRITE_TOOLS = new Set\(\[[\s\S]*?\]\);\n+/;

code = code.replace(regex1, '');
code = code.replace(regex2, '');

fs.writeFileSync(path, code);
