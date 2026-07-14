import { EventEmitter } from "node:events";

export interface AgentEvents {
	wakeup: (message: string) => void;
	error: (error: Error) => void;
	memoryEvent: (data: { type: string; message: string }) => void;
	streamEvent: (data: any) => void;
}

export class TypedEventEmitter<TEvents extends Record<string, any>> {
	private emitter = new EventEmitter();

	public emit<TEventName extends keyof TEvents & string>(
		eventName: TEventName,
		...eventArg: Parameters<TEvents[TEventName]>
	) {
		this.emitter.emit(eventName, ...(eventArg as unknown as any[]));
	}

	public on<TEventName extends keyof TEvents & string>(
		eventName: TEventName,
		handler: TEvents[TEventName],
	) {
		this.emitter.on(eventName, handler as any);
	}

	public once<TEventName extends keyof TEvents & string>(
		eventName: TEventName,
		handler: TEvents[TEventName],
	) {
		this.emitter.once(eventName, handler as any);
	}

	public off<TEventName extends keyof TEvents & string>(
		eventName: TEventName,
		handler: TEvents[TEventName],
	) {
		this.emitter.off(eventName, handler as any);
	}
}

export const agentEventBus = new TypedEventEmitter<AgentEvents>();

agentEventBus.on("error", (error: Error) => {
	console.error("Unhandled agent event error:", error);
});

export class WakeupQueue {
	private queue: string[] = [];
	private waitingResolves: Array<(msg: string) => void> = [];

	constructor() {
		agentEventBus.on("wakeup", (msg: string) => {
			if (this.waitingResolves.length > 0) {
				const resolve = this.waitingResolves.shift();
				if (resolve) resolve(msg);
			} else {
				this.queue.push(msg);
			}
		});
	}

	public async consume(signal?: AbortSignal): Promise<string> {
		if (this.queue.length > 0) {
			const msg = this.queue.shift();
			if (msg !== undefined) return Promise.resolve(msg);
		}
		return new Promise((resolve, reject) => {
			let cleanup: (() => void) | undefined;
			const resolver = (msg: string) => {
				cleanup?.();
				resolve(msg);
			};
			this.waitingResolves.push(resolver);
			if (signal) {
				const onAbort = () => {
					cleanup = undefined;
					const idx = this.waitingResolves.indexOf(resolver);
					if (idx !== -1) this.waitingResolves.splice(idx, 1);
					reject(new DOMException('Aborted', 'AbortError'));
				};
				signal.addEventListener('abort', onAbort, { once: true });
				cleanup = () => signal.removeEventListener('abort', onAbort);
			}
		});
	}

	public get isEmpty(): boolean {
		return this.queue.length === 0;
	}

	public clear() {
		this.queue = [];
		this.waitingResolves = [];
	}
}

export const wakeupQueue = new WakeupQueue();

// Queue for mid-flight context injection (e.g. /btw)
export class InjectionQueue {
	private queue: string[] = [];

	public push(message: string) {
		this.queue.push(message);
	}

	public consumeAll(): string[] {
		const msgs = [...this.queue];
		this.queue = [];
		return msgs;
	}

	public clear() {
		this.queue = [];
	}
}

// Global abort controller for interrupting the agent loop
export let globalAbortController = new AbortController();

export function resetGlobalAbortController() {
	// Abort the old controller so any in-flight listeners receive the signal
	// before we swap. Remove all listeners to avoid dangling references.
	if (!globalAbortController.signal.aborted) {
		globalAbortController.abort();
	}
	globalAbortController = new AbortController();
}

export function interruptAgent() {
	globalAbortController.abort();
}
