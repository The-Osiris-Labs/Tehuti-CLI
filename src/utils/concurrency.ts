export async function promiseAllWithConcurrency<T>(
	tasks: (() => Promise<T>)[],
	maxConcurrency: number,
): Promise<T[]> {
	if (maxConcurrency <= 0) {
		throw new Error("maxConcurrency must be positive");
	}

	if (tasks.length === 0) {
		return [];
	}

	if (tasks.length <= maxConcurrency) {
		return Promise.all(tasks.map((task) => task()));
	}

	const results: T[] = new Array(tasks.length);
	let nextIndex = 0;
	let completedCount = 0;

	const executeTask = async (workerIndex: number): Promise<void> => {
		while (nextIndex < tasks.length) {
			const taskIndex = nextIndex++;
			try {
				results[taskIndex] = await tasks[taskIndex]();
			} catch (error) {
				results[taskIndex] = error as T;
			}
			completedCount++;
		}
	};

	const workers = Array.from({ length: Math.min(maxConcurrency, tasks.length) }, (_, i) =>
		executeTask(i),
	);

	await Promise.all(workers);
	return results;
}

export async function promiseAllSettledWithConcurrency<T>(
	tasks: (() => Promise<T>)[],
	maxConcurrency: number,
): Promise<PromiseSettledResult<T>[]> {
	if (maxConcurrency <= 0) {
		throw new Error("maxConcurrency must be positive");
	}

	if (tasks.length === 0) {
		return [];
	}

	if (tasks.length <= maxConcurrency) {
		return Promise.allSettled(tasks.map((task) => task()));
	}

	const results: PromiseSettledResult<T>[] = new Array(tasks.length);
	let nextIndex = 0;

	const executeTask = async (): Promise<void> => {
		while (nextIndex < tasks.length) {
			const taskIndex = nextIndex++;
			try {
				const value = await tasks[taskIndex]();
				results[taskIndex] = { status: "fulfilled", value };
			} catch (error) {
				results[taskIndex] = { status: "rejected", reason: error };
			}
		}
	};

	const workers = Array.from({ length: Math.min(maxConcurrency, tasks.length) }, () =>
		executeTask(),
	);

	await Promise.all(workers);
	return results;
}

export function chunk<T>(array: T[], size: number): T[][] {
	const chunks: T[][] = [];
	for (let i = 0; i < array.length; i += size) {
		chunks.push(array.slice(i, i + size));
	}
	return chunks;
}

export async function mapWithConcurrency<T, R>(
	items: T[],
	fn: (item: T, index: number) => Promise<R>,
	maxConcurrency: number,
): Promise<R[]> {
	const tasks = items.map((item, index) => () => fn(item, index));
	return promiseAllWithConcurrency(tasks, maxConcurrency);
}

export class TaskQueue {
	private queue: Array<() => Promise<void>> = [];
	private running = 0;
	private readonly maxConcurrency: number;

	constructor(maxConcurrency: number = 5) {
		this.maxConcurrency = maxConcurrency;
	}

	add<T>(task: () => Promise<T>): Promise<T> {
		return new Promise((resolve, reject) => {
			this.queue.push(async () => {
				try {
					resolve(await task());
				} catch (error) {
					reject(error);
				}
			});
			this.process();
		});
	}

	private async process(): Promise<void> {
		if (this.running >= this.maxConcurrency || this.queue.length === 0) {
			return;
		}

		this.running++;
		const task = this.queue.shift();

		if (task) {
			await task();
			this.running--;
			this.process();
		}
	}

	get pending(): number {
		return this.queue.length;
	}

	get active(): number {
		return this.running;
	}
}
