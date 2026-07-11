import { createConsola } from "consola";
import isInteractive from "is-interactive";
import supportsColor from "supports-color";

const isInteractiveTerminal = isInteractive();
const colorSupport = supportsColor.stdout;
const colorLevel =
	typeof colorSupport === "object" && colorSupport !== null
		? colorSupport.level
		: 0;

export const consola = createConsola({
	level: process.env.TEHUTI_DEBUG === "true" ? 5 : 3,
	formatOptions: {
		colors: colorLevel > 0,
		compact: !isInteractiveTerminal,
		date: false,
	},
});

export function deepRedact(obj: unknown): unknown {
	if (typeof obj === "string") {
		return obj.replace(
			/(?:sk-[A-Za-z0-9-_]+|xoxb-[A-Za-z0-9-_]+)/g,
			"[REDACTED]",
		);
	}
	if (Array.isArray(obj)) {
		return obj.map(deepRedact);
	}
	if (obj !== null && typeof obj === "object") {
		if (obj instanceof Error) {
			const newErr = new Error(
				typeof obj.message === "string"
					? obj.message.replace(
							/(?:sk-[A-Za-z0-9-_]+|xoxb-[A-Za-z0-9-_]+)/g,
							"[REDACTED]",
						)
					: obj.message,
			);
			newErr.name = obj.name;
			if (typeof obj.stack === "string") {
				newErr.stack = obj.stack.replace(
					/(?:sk-[A-Za-z0-9-_]+|xoxb-[A-Za-z0-9-_]+)/g,
					"[REDACTED]",
				);
			}
			return newErr;
		}
		if (obj.constructor === Object) {
			const newObj: Record<string, unknown> = {};
			for (const [key, value] of Object.entries(obj)) {
				newObj[key] = deepRedact(value);
			}
			return newObj;
		}
	}
	return obj;
}

export const logger: {
	info: (message: string, ...args: unknown[]) => void;
	success: (message: string, ...args: unknown[]) => void;
	warn: (message: string, ...args: unknown[]) => void;
	error: (message: string, ...args: unknown[]) => void;
	debug: (message: string, ...args: unknown[]) => void;
	trace: (message: string, ...args: unknown[]) => void;
	start: (message: string) => void;
	box: (message: string) => void;
	log: (message: string, ...args: unknown[]) => void;
	raw: (message: string) => void;
	rawError: (message: string) => void;
	newline: () => void;
	prompt: typeof consola.prompt;
} = {
	info: (message: string, ...args: unknown[]) =>
		consola.info(deepRedact(message), ...args.map(deepRedact)),
	success: (message: string, ...args: unknown[]) =>
		consola.success(deepRedact(message), ...args.map(deepRedact)),
	warn: (message: string, ...args: unknown[]) =>
		consola.warn(deepRedact(message), ...args.map(deepRedact)),
	error: (message: string, ...args: unknown[]) =>
		consola.error(deepRedact(message), ...args.map(deepRedact)),
	debug: (message: string, ...args: unknown[]) =>
		consola.debug(deepRedact(message), ...args.map(deepRedact)),
	trace: (message: string, ...args: unknown[]) =>
		consola.trace(deepRedact(message), ...args.map(deepRedact)),
	start: (message: string) => consola.start(deepRedact(message)),
	box: (message: string) => consola.box(deepRedact(message) as string),
	log: (message: string, ...args: unknown[]) =>
		consola.log(deepRedact(message), ...args.map(deepRedact)),
	raw: (message: string) => process.stdout.write(deepRedact(message) as string),
	rawError: (message: string) =>
		process.stderr.write(deepRedact(message) as string),
	newline: () => console.log(),
	prompt: consola.prompt.bind(consola),
};

export function setDebugMode(enabled: boolean): void {
	consola.level = enabled ? 5 : 3;
}

export function createTaggedLogger(tag: string) {
	return {
		info: (message: string, ...args: unknown[]) =>
			consola.withTag(tag).info(deepRedact(message), ...args.map(deepRedact)),
		success: (message: string, ...args: unknown[]) =>
			consola
				.withTag(tag)
				.success(deepRedact(message), ...args.map(deepRedact)),
		warn: (message: string, ...args: unknown[]) =>
			consola.withTag(tag).warn(deepRedact(message), ...args.map(deepRedact)),
		error: (message: string, ...args: unknown[]) =>
			consola.withTag(tag).error(deepRedact(message), ...args.map(deepRedact)),
		debug: (message: string, ...args: unknown[]) =>
			consola.withTag(tag).debug(deepRedact(message), ...args.map(deepRedact)),
	};
}

export default logger;
