const fs = require('fs');

const path = 'src/agent/parallel-executor.ts';
let code = fs.readFileSync(path, 'utf8');

// Replace the parallel chunks logic
const oldParallelLogic = `	const parallelStartTime = Date.now();
	const parallelChunks: ToolCall[][] = [];

	for (let i = 0; i < classified.parallel.length; i += maxConcurrency) {
		parallelChunks.push(classified.parallel.slice(i, i + maxConcurrency));
	}

	for (const chunk of parallelChunks) {
		const chunkResults = await Promise.all(
			chunk.map(async (tc) => {
				const result = await executeToolCall(
					tc,
					ctx,
					toolContext,
					cache,
					telemetry,
				);

				return result;
			}),
		);

		for (let i = 0; i < chunk.length; i++) {
			const tc = chunk[i];
			const result = chunkResults[i];
			await mutex.runExclusive(async () => {
				addToolResult(ctx, tc.id, tc.function.name, resultForModel(result));
			});
			onToolResult?.(tc.function.name, result);

			const globalIndex = toolCalls.indexOf(tc);
			if (globalIndex >= 0) {
				results[globalIndex] = result;
			}
		}
	}`;

const newParallelLogic = `	const parallelStartTime = Date.now();

	// Use proper concurrency limiting instead of chunking
	const semaphore = require('../utils/concurrency.js').createSemaphore(maxConcurrency);
	
	const parallelPromises = classified.parallel.map(async (tc) => {
		return semaphore.acquire(async () => {
			const result = await executeToolCall(
				tc,
				ctx,
				toolContext,
				cache,
				telemetry,
			);
			
			await mutex.runExclusive(async () => {
				addToolResult(ctx, tc.id, tc.function.name, resultForModel(result));
			});
			onToolResult?.(tc.function.name, result);
			
			const globalIndex = toolCalls.indexOf(tc);
			if (globalIndex >= 0) {
				results[globalIndex] = result;
			}
			return result;
		});
	});
	
	await Promise.all(parallelPromises);`;

code = code.replace(oldParallelLogic, newParallelLogic);

// Actually, wait, let's use p-limit style since createSemaphore might not exist. Let's check utils/concurrency.ts first.
