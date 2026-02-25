export class AsyncMutex {
	private locked = false;
	private queue: Array<() => void> = [];

	async acquire(): Promise<void> {
		if (!this.locked) {
			this.locked = true;
			return;
		}
		return new Promise((resolve) => this.queue.push(resolve));
	}

	release(): void {
		const next = this.queue.shift();
		if (next) {
			next();
		} else {
			this.locked = false;
		}
	}

	async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
		await this.acquire();
		try {
			return await fn();
		} finally {
			this.release();
		}
	}

	isLocked(): boolean {
		return this.locked;
	}
}

export class AsyncSemaphore {
	private permits: number;
	private waitQueue: Array<() => void> = [];

	constructor(permits: number) {
		this.permits = permits;
	}

	async acquire(): Promise<void> {
		if (this.permits > 0) {
			this.permits--;
			return;
		}
		return new Promise((resolve) => this.waitQueue.push(resolve));
	}

	release(): void {
		const next = this.waitQueue.shift();
		if (next) {
			next();
		} else {
			this.permits++;
		}
	}

	async runWithPermit<T>(fn: () => Promise<T>): Promise<T> {
		await this.acquire();
		try {
			return await fn();
		} finally {
			this.release();
		}
	}
}

export class ReadWriteLock {
	private readers = 0;
	private writers = 0;
	private writeQueue: Array<() => void> = [];
	private readQueue: Array<() => void> = [];

	async readLock(): Promise<void> {
		if (this.writers === 0 && this.writeQueue.length === 0) {
			this.readers++;
			return;
		}
		return new Promise((resolve) => this.readQueue.push(resolve));
	}

	async writeLock(): Promise<void> {
		if (this.readers === 0 && this.writers === 0) {
			this.writers++;
			return;
		}
		return new Promise((resolve) => this.writeQueue.push(resolve));
	}

	readUnlock(): void {
		this.readers--;
		if (this.readers === 0 && this.writeQueue.length > 0) {
			this.writers++;
			const next = this.writeQueue.shift();
			if (next) next();
		}
	}

	writeUnlock(): void {
		this.writers--;
		if (this.writeQueue.length > 0) {
			this.writers++;
			const next = this.writeQueue.shift();
			if (next) next();
		} else {
			while (this.readQueue.length > 0) {
				this.readers++;
				const next = this.readQueue.shift();
				if (next) next();
			}
		}
	}

	async withReadLock<T>(fn: () => Promise<T>): Promise<T> {
		await this.readLock();
		try {
			return await fn();
		} finally {
			this.readUnlock();
		}
	}

	async withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
		await this.writeLock();
		try {
			return await fn();
		} finally {
			this.writeUnlock();
		}
	}
}
