import fs from 'fs';

const path = 'src/agent/model-router.ts';
let code = fs.readFileSync(path, 'utf8');

code = code.replace(
    'import { getTool } from "./tools/registry.js";',
    'import { SAFE_PARALLEL_TOOLS, WRITE_TOOLS } from "./parallel-executor.js";'
);

code = code.replace(
    /getTool\(t\.name\)\?\.isReadonly \?\? false/g,
    'SAFE_PARALLEL_TOOLS.has(t.name)'
);

code = code.replace(
    /!\(getTool\(t\.name\)\?\.isReadonly \?\? true\)/g,
    'WRITE_TOOLS.has(t.name)'
);

fs.writeFileSync(path, code);
