import { EventEmitter } from "node:events";

export interface AgentEvents {
	wakeup: (message: string) => void;
	error: (error: Error) => void;
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

	public async consume(): Promise<string> {
		if (this.queue.length > 0) {
			const msg = this.queue.shift();
			if (msg !== undefined) return Promise.resolve(msg);
		}
		return new Promise((resolve) => {
			this.waitingResolves.push(resolve);
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
