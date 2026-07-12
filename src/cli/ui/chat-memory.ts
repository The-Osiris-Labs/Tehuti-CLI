import type { CompactionDigest } from "../../agent/context-compressor.js";

export const UI_MAX_MESSAGES = 120;
export const UI_KEEP_FULL_RECENT_MESSAGES = 24;
export const UI_MAX_TEXT_CHARS = 24000;
export const UI_MAX_REASONING_CHARS = 8000;
export const UI_MAX_TOOL_OUTPUT_CHARS = 6000;
export const UI_MAX_TOOL_ARRAY_ITEMS = 40;
export const UI_MAX_TOOL_OBJECT_KEYS = 80;
export const TOOL_RESULT_PREVIEW_CHARS = 12000;

export type UiBlock =
	| { type: "text"; content: string }
	| { type: "reasoning"; content: string }
	| {
			type: "tool";
			id: string;
			name: string;
			description: string;
			result: unknown;
	  };

export type UiMessage = {
	id: number;
	role: string;
	content: string;
	kind?: "compaction";
	compaction?: CompactionDigest;
	status?: "success" | "error" | "loading";
	toolCalls?: Array<{
		id: string;
		name: string;
		description: string;
		result: unknown;
		isExpanded: boolean;
	}>;
	blocks?: UiBlock[];
};

export function formatCompactionDigestForUi(digest: CompactionDigest): string {
	const range = `${digest.source.activeStartIndex + 1}-${digest.source.activeEndIndex + 1}`;
	const section = (title: string, values: string[]) =>
		`${title}: ${values.length > 0 ? values.join(" · ") : "No evidence recorded"}`;

	return [
		`Historical context digest ${digest.id}`,
		`Messages ${range} summarized · ${digest.source.messageCount} messages · ${digest.originalTokens.toLocaleString()} → ${digest.compactedTokens.toLocaleString()} tokens`,
		section("Actions", digest.actions),
		section("Observed decisions", digest.keyDecisions),
		section("Errors/recoveries", digest.recoveries),
		section("Open threads", digest.openThreads),
		"Full original messages remain in the session archive; use /export json to inspect them.",
	].join("\n");
}

export function truncateMiddle(
	text: string,
	maxChars: number,
	label = "truncated",
): string {
	if (text.length <= maxChars) return text;
	if (maxChars <= 64) return `${text.slice(0, maxChars)}\n... [${label}]`;
	const head = Math.floor(maxChars * 0.65);
	const tail = maxChars - head;
	return `${text.slice(0, head)}\n... [${text.length - maxChars} chars ${label}]\n${text.slice(-tail)}`;
}

export function safeStringify(
	value: unknown,
	maxChars = TOOL_RESULT_PREVIEW_CHARS,
): string {
	try {
		if (typeof value === "string") return truncateMiddle(value, maxChars);
		return truncateMiddle(JSON.stringify(value, null, 2), maxChars);
	} catch {
		return truncateMiddle(String(value), maxChars);
	}
}

export function compactToolResultForUi(
	value: unknown,
	depth = 0,
	isUiOutputField = false,
): unknown {
	if (typeof value === "string") {
		if (isUiOutputField) {
			return truncateMiddle(value, 500000, "truncated for UI memory");
		}
		return truncateMiddle(
			value,
			UI_MAX_TOOL_OUTPUT_CHARS,
			"truncated for UI memory",
		);
	}
	if (typeof value !== "object" || value === null) {
		return value;
	}
	if (depth >= 4) {
		return "[nested object omitted for UI memory]";
	}
	if (Array.isArray(value)) {
		const items = value
			.slice(0, UI_MAX_TOOL_ARRAY_ITEMS)
			.map((item) => compactToolResultForUi(item, depth + 1, isUiOutputField));
		if (value.length > UI_MAX_TOOL_ARRAY_ITEMS) {
			items.push(
				`... [${value.length - UI_MAX_TOOL_ARRAY_ITEMS} items omitted]`,
			);
		}
		return items;
	}

	const compacted: Record<string, unknown> = {};
	let count = 0;
	for (const [key, nested] of Object.entries(
		value as Record<string, unknown>,
	)) {
		if (count >= UI_MAX_TOOL_OBJECT_KEYS) {
			compacted.__omitted__ = "additional object keys omitted for UI memory";
			break;
		}
		compacted[key] = compactToolResultForUi(
			nested,
			depth + 1,
			key === "uiOutput",
		);
		count++;
	}
	return compacted;
}

export function compactBlockForUi(block: UiBlock, keepFull: boolean): UiBlock {
	if (block.type === "tool") {
		return {
			...block,
			result: keepFull ? compactToolResultForUi(block.result) : "[Compacted]",
		};
	}
	const limit =
		block.type === "reasoning" ? UI_MAX_REASONING_CHARS : UI_MAX_TEXT_CHARS;
	return {
		...block,
		content: keepFull
			? truncateMiddle(block.content, limit, "truncated for UI memory")
			: `[Older ${block.type} block compacted to keep the terminal responsive]`,
	};
}

export function compactMessageForUi(
	message: UiMessage,
	keepFull: boolean,
): UiMessage {
	const hasBlocks = Boolean(message.blocks?.length);
	const content = hasBlocks
		? truncateMiddle(message.content, 1200, "block-backed content compacted")
		: keepFull
			? truncateMiddle(
					message.content,
					UI_MAX_TEXT_CHARS,
					"truncated for UI memory",
				)
			: truncateMiddle(
					message.content,
					1200,
					"older message compacted for UI memory",
				);
	const blocks = message.blocks?.map((block) =>
		compactBlockForUi(block, keepFull),
	);
	const blocksContainToolResult = Boolean(
		blocks?.some((block) => block.type === "tool"),
	);
	const toolCalls = message.toolCalls?.map((toolCall) => ({
		...toolCall,
		result:
			keepFull && !blocksContainToolResult
				? compactToolResultForUi(toolCall.result)
				: "[Compacted]",
	}));

	return {
		...message,
		content,
		...(blocks ? { blocks } : {}),
		...(toolCalls ? { toolCalls } : {}),
	};
}

export function compactMessagesForUi<T extends UiMessage>(messages: T[]): T[] {
	const markers = messages.filter((message) => message.kind === "compaction");
	const kept = messages
		.filter((message) => message.kind !== "compaction")
		.slice(-UI_MAX_MESSAGES);
	const fullStart = Math.max(0, kept.length - UI_KEEP_FULL_RECENT_MESSAGES);
	return [
		...markers,
		...kept.map(
			(message, index) => compactMessageForUi(message, index >= fullStart) as T,
		),
	] as T[];
}

export function estimateUiMessageChars(message: UiMessage): number {
	let total = message.content.length;
	for (const block of message.blocks ?? []) {
		if (block.type === "tool") {
			total += safeStringify(block.result, UI_MAX_TOOL_OUTPUT_CHARS).length;
		} else {
			total += block.content.length;
		}
	}
	for (const toolCall of message.toolCalls ?? []) {
		total += safeStringify(toolCall.result, UI_MAX_TOOL_OUTPUT_CHARS).length;
	}
	return total;
}

export function needsUiCompaction(messages: UiMessage[]): boolean {
	const historyMessages = messages.filter(
		(message) => message.kind !== "compaction",
	);
	if (historyMessages.length > UI_MAX_MESSAGES) return true;
	const fullStart = Math.max(
		0,
		historyMessages.length - UI_KEEP_FULL_RECENT_MESSAGES,
	);
	return messages.some((message) => {
		if (message.kind === "compaction") return false;
		const historyIndex = historyMessages.indexOf(message);
		const size = estimateUiMessageChars(message);
		if (historyIndex < fullStart && size > 1500) return true;
		return size > UI_MAX_TEXT_CHARS * 2;
	});
}
