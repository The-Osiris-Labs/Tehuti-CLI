const fs = require('fs');

const path = 'src/agent/model-router.ts';
let code = fs.readFileSync(path, 'utf8');

code = code.replace(
    'import { SAFE_PARALLEL_TOOLS, WRITE_TOOLS } from "./parallel-executor.js";',
    'import { getTool } from "./tools/registry.js";'
);

code = code.replace(
    'SAFE_PARALLEL_TOOLS.has(t.name),',
    'getTool(t.name)?.isReadonly ?? false,'
);

code = code.replace(
    'WRITE_TOOLS.has(t.name)',
    '!(getTool(t.name)?.isReadonly ?? true)'
);

fs.writeFileSync(path, code);
