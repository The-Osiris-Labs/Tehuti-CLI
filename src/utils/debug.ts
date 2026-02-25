import { consola } from "./logger.js";

const DEBUG_NAMESPACE = "tehuti";

type DebugCategory =
	| "agent"
	| "tools"
	| "mcp"
	| "config"
	| "api"
	| "permissions"
	| "stream"
	| "streaming"
	| "context"
	| "session"
	| "hooks"
	| "chat";

class Debugger {
	private enabled: boolean;
	private namespace: string;

	constructor(namespace: string = DEBUG_NAMESPACE) {
		this.namespace = namespace;
		this.enabled = process.env.TEHUTI_DEBUG === "true";
	}

	enable(): void {
		this.enabled = true;
	}

	disable(): void {
		this.enabled = false;
	}

	isEnabled(): boolean {
		return this.enabled;
	}

	log(category: DebugCategory, message: string, ...args: unknown[]): void {
		if (!this.enabled) return;

		const timestamp = new Date().toISOString().split("T")[1].slice(0, 12);
		const prefix = `[${timestamp}] [${this.namespace}:${category}]`;

		consola.debug(prefix, message, ...args);
	}

	time(label: string): void {
		if (!this.enabled) return;
		console.time(label);
	}

	timeEnd(label: string): void {
		if (!this.enabled) return;
		console.timeEnd(label);
	}

	group(label: string): void {
		if (!this.enabled) return;
		console.group(label);
	}

	groupEnd(): void {
		if (!this.enabled) return;
		console.groupEnd();
	}

	table(data: unknown): void {
		if (!this.enabled) return;
		console.table(data);
	}

	category(name: DebugCategory): Pick<Debugger, "log" | "time" | "timeEnd"> {
		return {
			log: (message: string, ...args: unknown[]) =>
				this.log(name, message, ...args),
			time: (label: string) => this.time(`[${name}] ${label}`),
			timeEnd: (label: string) => this.timeEnd(`[${name}] ${label}`),
		};
	}
}

export const debug = new Debugger();

export function createDebugger(namespace: string): Debugger {
	return new Debugger(namespace);
}

export default debug;
