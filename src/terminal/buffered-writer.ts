import { refreshCapabilities } from "./capabilities.js";
import { renderMarkdownToAnsi } from "./markdown.js";

const CSI = "\x1b[";
const ANSI_REGEX = /\x1b\[[0-9;]*[a-zA-Z]/g;
const UNICODE_ESCAPE_REGEX = /\x1b[()([0-9A-Za-z]/g;
const DECORATIVE = {
	ibisBird: "\u{135E}",
	eye: "\u{13075}",
	eyeOfHorus: "\u{13080}",
	arrow: "\u{13009}",
};

function stripAnsi(str: string): string {
	let result = str.replace(ANSI_REGEX, "");
	result = result.replace(UNICODE_ESCAPE_REGEX, "");
	return result;
}

function getVisualWidth(str: string): number {
	const stripped = stripAnsi(str);
	let width = 0;
	for (const char of stripped) {
		const code = char.codePointAt(0) || 0;
		if (code >= 0x13000 && code <= 0x1342F) {
			width += 1;
		} else if (code >= 0x10000) {
			width += 2;
		} else if (code < 32 || (code >= 0x7F && code < 0xA0)) {
			continue;
		} else if (code > 0xFFFF) {
			width += 2;
		} else {
			width += 1;
		}
	}
	return width;
}

function splitAtVisualWidth(str: string, maxWidth: number): { left: string; right: string } {
	let width = 0;
	let pos = 0;
	let inEscape = false;
	let lastSpacePos = -1;
	let lastSpaceWidth = 0;

	for (let i = 0; i < str.length; i++) {
		const char = str[i];

		if (char === "\x1b") {
			inEscape = true;
			continue;
		}

		if (inEscape) {
			if (/[a-zA-Z]/.test(char)) {
				inEscape = false;
			}
			continue;
		}

		if (char === " " || char === "\t") {
			lastSpacePos = i + 1;
			lastSpaceWidth = width;
		}

		const code = char.codePointAt(0) || 0;
		let charWidth = 1;
		if (code >= 0x13000 && code <= 0x1342F) {
			charWidth = 1;
		} else if (code >= 0x10000) {
			charWidth = 2;
		}

		if (width + charWidth > maxWidth) {
			if (lastSpacePos > 0 && lastSpaceWidth > maxWidth * 0.3) {
				return {
					left: str.substring(0, lastSpacePos),
					right: str.substring(lastSpacePos),
				};
			}
			return {
				left: str.substring(0, pos),
				right: str.substring(pos),
			};
		}

		width += charWidth;
		pos = i + 1;

		if (code > 0xFFFF) {
			i++;
		}
	}

	return { left: str, right: "" };
}

export class BufferedStreamWriter {
	private buffer: string = "";
	private terminalWidth: number;
	private flushTimer: NodeJS.Timeout | null = null;
	private lastFlushTime: number = 0;
	private readonly FLUSH_INTERVAL = 30;
	private resizeHandler: (() => void) | null = null;
	private destroyed: boolean = false;

	constructor() {
		this.terminalWidth = process.stdout.columns || 80;
		this.setupResizeHandler();
	}

	private setupResizeHandler(): void {
		this.resizeHandler = () => {
			this.terminalWidth = process.stdout.columns || 80;
			refreshCapabilities();
		};
		process.on("SIGWINCH", this.resizeHandler);
	}

	write(chunk: string): void {
		if (this.destroyed) return;
		this.buffer += chunk;
		this.scheduleFlush();
	}

	writeImmediate(chunk: string): void {
		if (this.destroyed) return;
		this.flushNow();
		try {
			process.stdout.write(chunk);
		} catch {
			// Ignore write errors
		}
	}

	private scheduleFlush(): void {
		const now = Date.now();
		if (now - this.lastFlushTime >= this.FLUSH_INTERVAL) {
			this.flushNow();
		} else if (!this.flushTimer) {
			this.flushTimer = setTimeout(() => {
				this.flushTimer = null;
				this.flushNow();
			}, this.FLUSH_INTERVAL - (now - this.lastFlushTime));
		}
	}

	private flushNow(): void {
		if (this.flushTimer) {
			clearTimeout(this.flushTimer);
			this.flushTimer = null;
		}

		if (this.buffer.length === 0 || this.destroyed) return;

		this.lastFlushTime = Date.now();
		const toFlush = this.buffer;
		this.buffer = "";
		this.processAndWrite(toFlush);
	}

	private processAndWrite(text: string): void {
		const lines = text.split("\n");
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			if (line.length === 0) {
				this.safeWrite("\n");
				continue;
			}

			const visualWidth = getVisualWidth(line);
			if (visualWidth <= this.terminalWidth) {
				this.safeWrite(line);
				if (i < lines.length - 1) {
					this.safeWrite("\n");
				}
			} else {
				this.writeWrappedLine(line, i < lines.length - 1);
			}
		}
	}

	private safeWrite(text: string): void {
		try {
			process.stdout.write(text);
		} catch {
			// Ignore write errors
		}
	}

	private writeWrappedLine(line: string, addNewline: boolean): void {
		let remaining = line;
		let iterations = 0;
		const maxIterations = 1000;

		while (remaining.length > 0 && iterations < maxIterations) {
			iterations++;
			const { left, right } = splitAtVisualWidth(remaining, this.terminalWidth);

			if (left.length > 0) {
				this.safeWrite(left);
				if (right.length > 0 || addNewline) {
					this.safeWrite("\n");
				}
				remaining = right;
			} else if (remaining.length > 0) {
				this.safeWrite(remaining[0]);
				remaining = remaining.slice(1);
				if (remaining.length > 0 || addNewline) {
					this.safeWrite("\n");
				}
			} else {
				break;
			}
		}
	}

	flush(): void {
		this.flushNow();
	}

	end(): void {
		if (this.flushTimer) {
			clearTimeout(this.flushTimer);
			this.flushTimer = null;
		}
		this.flushNow();
	}

	destroy(): void {
		this.destroyed = true;
		if (this.flushTimer) {
			clearTimeout(this.flushTimer);
			this.flushTimer = null;
		}
		if (this.resizeHandler) {
			process.off("SIGWINCH", this.resizeHandler);
			this.resizeHandler = null;
		}
		this.buffer = "";
	}

	clearLine(): void {
		this.safeWrite(`${CSI}2K${CSI}0G`);
	}

	clearScreen(): void {
		this.safeWrite(`${CSI}2J${CSI}H`);
	}

	moveUp(lines: number = 1): void {
		if (lines > 0) {
			this.safeWrite(`${CSI}${lines}A`);
		}
	}

	moveDown(lines: number = 1): void {
		if (lines > 0) {
			this.safeWrite(`${CSI}${lines}B`);
		}
	}

	moveToColumn(col: number): void {
		this.safeWrite(`${CSI}${col + 1}G`);
	}

	hideCursor(): void {
		this.safeWrite(`${CSI}?25l`);
	}

	showCursor(): void {
		this.safeWrite(`${CSI}?25h`);
	}

	saveCursor(): void {
		this.safeWrite(`${CSI}s`);
	}

	restoreCursor(): void {
		this.safeWrite(`${CSI}u`);
	}

	getTerminalWidth(): number {
		return this.terminalWidth;
	}
}

export class StreamingOutputManager {
	private writer: BufferedStreamWriter;
	private currentContent: string = "";
	private linesWritten: number = 0;
	private batchedTokens: string = "";
	private batchTimer: NodeJS.Timeout | null = null;
	private readonly BATCH_INTERVAL = 50;
	private destroyed: boolean = false;
	private inCodeBlock: boolean = false;
	private codeBlockBuffer: string = "";

	constructor() {
		this.writer = new BufferedStreamWriter();
	}

	append(token: string): void {
		if (this.destroyed) return;
		
		this.currentContent += token;
		
		if (this.detectsCodeBlockBoundary(token)) {
			if (this.inCodeBlock) {
				this.batchedTokens += this.codeBlockBuffer + token;
				this.codeBlockBuffer = "";
			} else {
				this.codeBlockBuffer = token;
			}
			this.inCodeBlock = !this.inCodeBlock;
			this.scheduleBatch();
			return;
		}
		
		if (this.inCodeBlock) {
			this.codeBlockBuffer += token;
			return;
		}
		
		this.batchedTokens += token;
		this.scheduleBatch();
	}

	private detectsCodeBlockBoundary(token: string): boolean {
		return token.includes("```");
	}

	private scheduleBatch(): void {
		if (this.batchedTokens.includes("\n\n") || this.batchedTokens.includes("```")) {
			this.flushBatch();
			return;
		}

		if (!this.batchTimer) {
			this.batchTimer = setTimeout(() => {
				this.batchTimer = null;
				this.flushBatch();
			}, this.BATCH_INTERVAL);
		}
	}

	private flushBatch(): void {
		if (this.batchTimer) {
			clearTimeout(this.batchTimer);
			this.batchTimer = null;
		}

		if (this.batchedTokens.length === 0 || this.destroyed) return;

		const tokens = this.batchedTokens;
		this.batchedTokens = "";
		
		const rendered = this.renderMarkdown(tokens);
		this.writer.write(rendered);
	}

	private renderMarkdown(text: string): string {
		const rendered = renderMarkdownToAnsi(text);
		return rendered;
	}

	writeLine(text: string): void {
		if (this.destroyed) return;
		this.flushBatch();
		this.writer.write(text + "\n");
		this.linesWritten++;
	}

	writeToolCall(toolName: string, args?: unknown): void {
		if (this.destroyed) return;
		this.flushBatch();
		const argsStr = args ? JSON.stringify(args) : "";
		const argsPreview = argsStr.length > 60 ? `${argsStr.slice(0, 60)}...` : argsStr;
		this.writer.write(`\n  ${DECORATIVE.ibisBird} ${toolName} ${argsPreview}\n`);
	}

	writeToolResult(_toolName: string, success: boolean, output?: string): void {
		if (this.destroyed) return;
		this.flushBatch();
		const symbol = success ? DECORATIVE.eye : DECORATIVE.eyeOfHorus;
		const outputPreview = output ? output.slice(0, 80).replace(/\n/g, " ").trim() : "";
		this.writer.write(`    ${symbol} ${outputPreview}${outputPreview.length >= 80 ? "..." : ""}\n`);
	}

	finish(): void {
		if (this.destroyed) return;
		this.flushBatch();
		
		if (this.currentContent.length > 0) {
			const rendered = renderMarkdownToAnsi(this.currentContent);
			this.writer.write("\n");
		}
		
		this.writer.flush();
		this.writer.showCursor();
	}

	destroy(): void {
		this.destroyed = true;
		if (this.batchTimer) {
			clearTimeout(this.batchTimer);
			this.batchTimer = null;
		}
		this.writer.destroy();
	}

	getContent(): string {
		return this.currentContent;
	}

	getTerminalWidth(): number {
		return this.writer.getTerminalWidth();
	}
}

export function createBufferedWriter(): BufferedStreamWriter {
	return new BufferedStreamWriter();
}

export function createStreamingOutputManager(): StreamingOutputManager {
	return new StreamingOutputManager();
}

export { stripAnsi, getVisualWidth };
