import { describe, expect, it } from "vitest";
import { ReadWriteLock } from "./mutex.js";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("ReadWriteLock Stress Tests", () => {
	it("should maintain lock safety invariants under high concurrency", async () => {
		const lock = new ReadWriteLock();
		let activeReaders = 0;
		let activeWriters = 0;
		let completedTasks = 0;
		const totalTasks = 200;

		const runTask = async (id: number, type: "read" | "write") => {
			const delayTime = Math.floor(Math.random() * 10) + 1;
			if (type === "read") {
				await lock.withReadLock(async () => {
					// Invariant check: No writers should be active
					expect(activeWriters).toBe(0);
					activeReaders++;
					
					await delay(delayTime);
					
					activeReaders--;
				});
			} else {
				await lock.withWriteLock(async () => {
					// Invariant check: No other writers or readers should be active
					expect(activeWriters).toBe(0);
					expect(activeReaders).toBe(0);
					activeWriters++;
					
					await delay(delayTime);
					
					activeWriters--;
				});
			}
			completedTasks++;
		};

		const promises: Promise<void>[] = [];
		for (let i = 0; i < totalTasks; i++) {
			const type = Math.random() < 0.6 ? "read" as const : "write" as const;
			promises.push(runTask(i, type));
		}

		await Promise.all(promises);
		expect(completedTasks).toBe(totalTasks);
		expect(activeReaders).toBe(0);
		expect(activeWriters).toBe(0);
	});

	it("should demonstrate reader starvation under continuous writing", async () => {
		const lock = new ReadWriteLock();
		let activeReaders = 0;
		let activeWriters = 0;

		// Acquire first write lock to block everything initially
		let initialWriterReleased = false;
		const firstWritePromise = lock.writeLock().then(() => {
			activeWriters++;
		});
		await firstWritePromise;

		// Now attempt to acquire a read lock (should be queued)
		let readAcquired = false;
		const readPromise = lock.withReadLock(async () => {
			readAcquired = true;
			activeReaders++;
			expect(activeWriters).toBe(0);
			activeReaders--;
		});

		// Queue a series of write locks that execute one after another
		const numWriters = 5;
		let writersCompleted = 0;
		
		const writePromises = Array.from({ length: numWriters }).map(async (_, idx) => {
			await lock.withWriteLock(async () => {
				activeWriters++;
				// At each write, verify that the read lock has NOT been acquired yet
				// because readers are starved by the write queue
				expect(readAcquired).toBe(false);
				await delay(10);
				activeWriters--;
				writersCompleted++;
			});
		});

		// Release the first write lock
		activeWriters--;
		initialWriterReleased = true;
		lock.writeUnlock();

		// Wait for all subsequent writers to complete
		await Promise.all(writePromises);
		
		// Finally, the read lock should acquire
		await readPromise;
		
		expect(readAcquired).toBe(true);
		expect(writersCompleted).toBe(numWriters);
	});
});
