import { EventEmitter } from "node:events";

/**
 * Typed event definitions for the agent event bus.
 *
 * Uses a type alias (not interface) because TypeScript interfaces lack implicit
 * index signatures and cannot satisfy `Record<string, ...>` constraints.
 * Separating this from events.ts breaks the circular dependency where multiple
 * modules need the event contract but shouldn't pull in the full events.ts
 * (which also contains queues, abort controllers, etc.).
 */
export type AgentEvents = {
	wakeup: (message: string) => void;
	error: (error: Error) => void;
	memoryEvent: (data: { type: string; message: string }) => void;
	streamEvent: (data: Record<string, unknown>) => void;
};

/**
 * Generic typed wrapper around Node's EventEmitter.
 *
 * Provides compile-time safety for event names and handler signatures while
 * delegating to the underlying EventEmitter at runtime.
 *
 * The constraint uses `never[]` as the parameter type: since `never` is the
 * bottom type, any concrete handler `(msg: string) => void` is assignable.
 * Casts go through `unknown` to satisfy the EventEmitter's untyped API without
 * widening the public type surface.
 */
export class TypedEventEmitter<
	TEvents extends Record<string, (...args: never[]) => void>,
> {
	private emitter = new EventEmitter();

	public emit<TEventName extends keyof TEvents & string>(
		eventName: TEventName,
		...eventArg: Parameters<TEvents[TEventName]>
	) {
		this.emitter.emit(eventName, ...(eventArg as unknown[]));
	}

	public on<TEventName extends keyof TEvents & string>(
		eventName: TEventName,
		handler: TEvents[TEventName],
	) {
		this.emitter.on(eventName, handler as unknown as (...args: unknown[]) => void);
	}

	public once<TEventName extends keyof TEvents & string>(
		eventName: TEventName,
		handler: TEvents[TEventName],
	) {
		this.emitter.once(eventName, handler as unknown as (...args: unknown[]) => void);
	}

	public off<TEventName extends keyof TEvents & string>(
		eventName: TEventName,
		handler: TEvents[TEventName],
	) {
		this.emitter.off(eventName, handler as unknown as (...args: unknown[]) => void);
	}
}
