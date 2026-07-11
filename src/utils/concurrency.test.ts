import { describe, expect, it } from "vitest";
import {
	chunk,
	mapWithConcurrency,
	promiseAllSettledWithConcurrency,
	promiseAllWithConcurrency,
	TaskQueue,
} from "./concurrency";

describe("concurrency utils", () => {
	describe("promiseAllWithConcurrency", () => {
		it("should resolve all promises with the correct concurrency limit", async () => {
			let active = 0;
			let maxActive = 0;
			const tasks = Array.from({ length: 10 }, (_, i) => async () => {
				active++;
				maxActive = Math.max(maxActive, active);
				await new Promise((r) => setTimeout(r, 10));
				active--;
				return i;
			});

			const results = await promiseAllWithConcurrency(tasks, 3);
			expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
			expect(maxActive).toBeLessThanOrEqual(3);
		});

		it("should throw if maxConcurrency <= 0", async () => {
			await expect(promiseAllWithConcurrency([], 0)).rejects.toThrow(
				"maxConcurrency must be positive",
			);
		});

		it("should return empty array for empty tasks", async () => {
			const results = await promiseAllWithConcurrency([], 2);
			expect(results).toEqual([]);
		});

		it("should handle task rejections by rejecting", async () => {
			const tasks = [
				async () => 1,
				async () => {
					throw new Error("task 2 failed");
				},
				async () => 3,
			];
			await expect(promiseAllWithConcurrency(tasks, 2)).rejects.toThrow(
				"task 2 failed",
			);
		});

		it("should use fast path if tasks length <= maxConcurrency", async () => {
			const tasks = [async () => 1, async () => 2];
			const results = await promiseAllWithConcurrency(tasks, 2);
			expect(results).toEqual([1, 2]);
		});
	});

	describe("promiseAllSettledWithConcurrency", () => {
		it("should resolve all settled promises with correct status", async () => {
			const tasks = [
				async () => 1,
				async () => {
					throw new Error("task 2 failed");
				},
				async () => 3,
			];

			const results = await promiseAllSettledWithConcurrency(tasks, 2);
			expect(results[0]).toEqual({ status: "fulfilled", value: 1 });
			expect(results[1]).toEqual(
				expect.objectContaining({ status: "rejected" }),
			);
			expect(results[2]).toEqual({ status: "fulfilled", value: 3 });
		});

		it("should throw if maxConcurrency <= 0", async () => {
			await expect(promiseAllSettledWithConcurrency([], 0)).rejects.toThrow(
				"maxConcurrency must be positive",
			);
		});

		it("should return empty array for empty tasks", async () => {
			const results = await promiseAllSettledWithConcurrency([], 2);
			expect(results).toEqual([]);
		});

		it("should use fast path if tasks length <= maxConcurrency", async () => {
			const tasks = [async () => 1, async () => 2];
			const results = await promiseAllSettledWithConcurrency(tasks, 2);
			expect(results[0]).toEqual({ status: "fulfilled", value: 1 });
			expect(results[1]).toEqual({ status: "fulfilled", value: 2 });
		});
	});

	describe("chunk", () => {
		it("should split array into chunks of given size", () => {
			const array = [1, 2, 3, 4, 5];
			const result = chunk(array, 2);
			expect(result).toEqual([[1, 2], [3, 4], [5]]);
		});

		it("should return empty array when given empty array", () => {
			expect(chunk([], 2)).toEqual([]);
		});
	});

	describe("mapWithConcurrency", () => {
		it("should map items to results with concurrency", async () => {
			const items = [1, 2, 3];
			const fn = async (item: number) => item * 2;
			const results = await mapWithConcurrency(items, fn, 2);
			expect(results).toEqual([2, 4, 6]);
		});
	});

	describe("TaskQueue", () => {
		it("should execute tasks adhering to max concurrency", async () => {
			const queue = new TaskQueue(2);
			let active = 0;
			let maxActive = 0;

			const makeTask = (val: number) => async () => {
				active++;
				maxActive = Math.max(maxActive, active);
				await new Promise((r) => setTimeout(r, 10));
				active--;
				return val;
			};

			const p1 = queue.add(makeTask(1));
			const p2 = queue.add(makeTask(2));
			const p3 = queue.add(makeTask(3));

			expect(queue.active).toBeGreaterThan(0);
			expect(queue.pending).toBeGreaterThanOrEqual(0);

			const results = await Promise.all([p1, p2, p3]);
			expect(results).toEqual([1, 2, 3]);
			expect(maxActive).toBeLessThanOrEqual(2);
		});

		it("should reject on task failure", async () => {
			const queue = new TaskQueue(2);
			const p = queue.add(async () => {
				throw new Error("failed");
			});
			await expect(p).rejects.toThrow("failed");
		});

		it("should do nothing if process called when already max running", async () => {
			const queue = new TaskQueue(1);
			const p1 = queue.add(async () => {
				await new Promise((r) => setTimeout(r, 10));
				return 1;
			});
			const p2 = queue.add(async () => 2);
			const results = await Promise.all([p1, p2]);
			expect(results).toEqual([1, 2]);
		});
	});
});
