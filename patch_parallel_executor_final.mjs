import fs from 'fs';

const path = 'src/agent/parallel-executor.ts';
let code = fs.readFileSync(path, 'utf8');

const regex = /\tconst parallelStartTime = Date\.now\(\);\n\tconst parallelChunks: ToolCall\[\]\[\] = \[\];[\s\S]*?const parallelEndTime = Date\.now\(\);/;

const replacement = `\tconst parallelStartTime = Date.now();

\tconst { mapWithConcurrency } = await import("../utils/concurrency.js");
\tawait mapWithConcurrency(
\t\tclassified.parallel,
\t\tasync (tc) => {
\t\t\tconst result = await executeToolCall(
\t\t\t\ttc,
\t\t\t\tctx,
\t\t\t\ttoolContext,
\t\t\t\tcache,
\t\t\t\ttelemetry,
\t\t\t);

\t\t\tawait mutex.runExclusive(async () => {
\t\t\t\tconst resultStr = typeof result.output === "string" ? result.output : JSON.stringify(result.output);
\t\t\t\taddToolResult(ctx, tc.id, tc.function.name, resultStr);
\t\t\t});
\t\t\tonToolResult?.(tc.function.name, result);

\t\t\tconst globalIndex = toolCalls.indexOf(tc);
\t\t\tif (globalIndex >= 0) {
\t\t\t\tresults[globalIndex] = result;
\t\t\t}
\t\t},
\t\tmaxConcurrency
\t);

\tconst parallelEndTime = Date.now();`;

if (regex.test(code)) {
    code = code.replace(regex, replacement);
    fs.writeFileSync(path, code);
} else {
    console.error("Not found! Regex did not match.");
}
