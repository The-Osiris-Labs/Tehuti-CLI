import { execSync } from "child_process";

export async function stressTest(iterations: number = 10): Promise<{
	success: boolean;
	runs: { iteration: number; durationMs: number; success: boolean; error?: string }[];
}> {
	console.log(`Starting stress test of E2E baseline with ${iterations} iterations...`);
	const runs: { iteration: number; durationMs: number; success: boolean; error?: string }[] = [];
	let allSuccessful = true;

	for (let i = 1; i <= iterations; i++) {
		const start = Date.now();
		let success = true;
		let error: string | undefined;

		try {
			execSync("npm run test:e2e", { stdio: "pipe", cwd: process.cwd() });
		} catch (err) {
			success = false;
			allSuccessful = false;
			error = err instanceof Error ? err.message : String(err);
		}

		const durationMs = Date.now() - start;
		runs.push({ iteration: i, durationMs, success, error });
		console.log(`Iteration ${i}/${iterations}: ${success ? "PASSED" : "FAILED"} in ${durationMs}ms`);
	}

	return {
		success: allSuccessful,
		runs,
	};
}

if (import.meta.url.endsWith(process.argv[1]) || process.argv[1]?.endsWith("stress-test-baseline.ts")) {
	stressTest(10).then((res) => {
		console.log("\n--- Stress Test Results ---");
		console.log(`Overall Status: ${res.success ? "SUCCESS" : "FAILED"}`);
		console.log(`Total Runs: ${res.runs.length}`);
		console.log(`Passed: ${res.runs.filter(r => r.success).length}`);
		console.log(`Failed: ${res.runs.filter(r => !r.success).length}`);
		const durations = res.runs.map(r => r.durationMs);
		const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
		console.log(`Average run time: ${avg.toFixed(2)}ms`);
		process.exit(res.success ? 0 : 1);
	});
}
