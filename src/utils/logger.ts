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
	info: (message: string, ...args: unknown[]) => consola.info(message, ...args),
	success: (message: string, ...args: unknown[]) =>
		consola.success(message, ...args),
	warn: (message: string, ...args: unknown[]) => consola.warn(message, ...args),
	error: (message: string, ...args: unknown[]) =>
		consola.error(message, ...args),
	debug: (message: string, ...args: unknown[]) =>
		consola.debug(message, ...args),
	trace: (message: string, ...args: unknown[]) =>
		consola.trace(message, ...args),
	start: (message: string) => consola.start(message),
	box: (message: string) => consola.box(message),
	log: (message: string, ...args: unknown[]) => consola.log(message, ...args),
	raw: (message: string) => process.stdout.write(message),
	rawError: (message: string) => process.stderr.write(message),
	newline: () => console.log(),
	prompt: consola.prompt.bind(consola),
};

export function setDebugMode(enabled: boolean): void {
	consola.level = enabled ? 5 : 3;
}

export function createTaggedLogger(tag: string) {
	return {
		info: (message: string, ...args: unknown[]) =>
			consola.withTag(tag).info(message, ...args),
		success: (message: string, ...args: unknown[]) =>
			consola.withTag(tag).success(message, ...args),
		warn: (message: string, ...args: unknown[]) =>
			consola.withTag(tag).warn(message, ...args),
		error: (message: string, ...args: unknown[]) =>
			consola.withTag(tag).error(message, ...args),
		debug: (message: string, ...args: unknown[]) =>
			consola.withTag(tag).debug(message, ...args),
	};
}

export default logger;
