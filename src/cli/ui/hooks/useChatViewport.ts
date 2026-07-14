import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { computeMessageLines } from "../../../terminal/output.js";

/** Options for the chat viewport hook. */
export interface UseChatViewportOptions {
	messages: any[];
	terminalHeight: number;
	terminalWidth: number;
	headerHeight: number;
	/** Height occupied below history by the active input or prompt. */
	promptOverlayHeight: number;
	warningsHeight: number;
	paletteHeight: number;
	loadingOverlayHeight: number;
	thinkingOverlayHeight: number;
	errorOverlayHeight: number;
	dashboardOverlayHeight?: number;
	input: string;
	showWelcome: boolean;
	/** External scroll offset state (from parent). If omitted, the hook creates its own. */
	scrollOffset?: number;
	/** External setScrollOffset (from parent). Must be provided alongside scrollOffset. */
	setScrollOffset?: React.Dispatch<React.SetStateAction<number>>;
}
export interface UseChatViewportReturn {
	/** Visible messages for the current render window. */
	visibleMessages: any[];
	/*
	 * The deferredVisibleMessages slot is intentionally removed from this
	 * return type. It is available for re-addition if a swap-based viewport
	 * implementation ever needs a deferred visible-messages alias.
	 */
	/** Current scroll offset (in lines, 0 = at bottom). */
	scrollOffset: number;
	/** Total estimated lines for all messages. */
	totalMessageLines: number;
	/** Available content width. */
	contentMaxWidth: number;
	/** Viewport height (terminal minus fixed overlays). */
	chatViewportHeight: number;
	/** Whether the user has scrolled to the bottom. */
	isAtBottom: boolean;
	/** Count of messages received while the user is scrolled up. */
	newMessageCount: number;

	scrollToBottom: () => void;
	scrollToTop: () => void;
	scrollPageUp: () => void;
	scrollPageDown: () => void;
	scrollLineUp: () => void;
	scrollLineDown: () => void;
	setScrollOffset: React.Dispatch<React.SetStateAction<number>>;
}

/**
 * Owns the viewport's scroll mechanics: tail following, line/page navigation,
 * message-arrival badge state, and the virtual render window. The chat keeps
 * the negative-margin model; this hook only decides its offset and content
 * slice, never remounts history merely to scroll.
 *
 * Available for a future refactor that swaps the inline viewport logic in
 * chat.ts. Currently fully implemented, tested, but not imported — import
 * and pass the returned {@link UseChatViewportReturn} values in place of the
 * inline scroll/offset state.
 */
export function useChatViewport({
	messages,
	terminalHeight,
	terminalWidth,
	headerHeight,
	promptOverlayHeight,
	warningsHeight,
	paletteHeight,
	loadingOverlayHeight,
	thinkingOverlayHeight,
	errorOverlayHeight,
	dashboardOverlayHeight = 0,
	showWelcome,
	scrollOffset: externalScrollOffset,
	setScrollOffset: externalSetScrollOffset,
}: UseChatViewportOptions): UseChatViewportReturn {
	const hasExternalScrollOffset =
		externalScrollOffset !== undefined && externalSetScrollOffset !== undefined;
	const [internalScrollOffset, internalSetScrollOffset] = useState(0);
	const [isAtBottom, setIsAtBottom] = useState(true);
	const [newMessageCount, setNewMessageCount] = useState(0);
	const isAtBottomRef = useRef(true);
	const previousMessageCountRef = useRef(messages.length);

	const scrollOffset = hasExternalScrollOffset
		? externalScrollOffset!
		: internalScrollOffset;

	// Forward functional actions to the external React setter unchanged. Resolving
	// them against a captured externalScrollOffset drops rapid consecutive scrolls.
	const setScrollOffset: React.Dispatch<React.SetStateAction<number>> = useCallback(
		(action) => {
			if (hasExternalScrollOffset) {
				externalSetScrollOffset!(action);
				return;
			}
			internalSetScrollOffset(action);
		},
		[externalSetScrollOffset, hasExternalScrollOffset],
	);

	const contentMaxWidth = Math.max(40, terminalWidth - 4);
	const chatViewportHeight = Math.max(
		3,
		terminalHeight -
			headerHeight -
			promptOverlayHeight -
			warningsHeight -
			paletteHeight -
			loadingOverlayHeight -
			thinkingOverlayHeight -
			errorOverlayHeight -
			dashboardOverlayHeight,
	);

	const totalMessageLines = useMemo(() => {
		let lines = 0;
		for (const message of messages) {
			lines += computeMessageLines(message, contentMaxWidth);
		}
		if (showWelcome) {
			lines += messages.length > 0 ? 3 : 12;
		}
		return lines;
	}, [messages, contentMaxWidth, showWelcome]);

	const maxScrollOffset = useMemo(
		() =>
			Math.max(
				0,
				totalMessageLines - chatViewportHeight + 20,
			),
		[totalMessageLines, chatViewportHeight],
	);

	const clearNewMessageBadge = useCallback(() => {
		setNewMessageCount(0);
	}, []);

	const followTail = useCallback(() => {
		isAtBottomRef.current = true;
		setIsAtBottom(true);
		clearNewMessageBadge();
	}, [clearNewMessageBadge]);

	const suspendTailFollow = useCallback(() => {
		if (!isAtBottomRef.current) return;
		isAtBottomRef.current = false;
		setIsAtBottom(false);
	}, []);

	// Keep an intentional upward offset valid after a resize/content compaction;
	// tail-follow always wins at the bottom.
	useEffect(() => {
		setScrollOffset((previous) =>
			isAtBottomRef.current ? 0 : Math.min(Math.max(0, previous), maxScrollOffset),
		);
	}, [maxScrollOffset, setScrollOffset]);

	// Count actual message arrivals independently from line reflows. This avoids
	// resetting an intentional scroll merely because streaming changed height.
	useEffect(() => {
		const previousCount = previousMessageCountRef.current;
		const arrivals = Math.max(0, messages.length - previousCount);
		previousMessageCountRef.current = messages.length;

		if (isAtBottomRef.current) {
			clearNewMessageBadge();
			return;
		}
		if (arrivals > 0) {
			setNewMessageCount((count) => count + arrivals);
		}
	}, [messages.length, clearNewMessageBadge]);

	// Preserve the virtualized render window. Negative margin controls position;
	// this slice only caps the number of Ink trees mounted for long histories.
	const visibleMessages = useMemo(() => {
		const linesNeeded = chatViewportHeight + scrollOffset + 20;
		const averageCharsPerLine = Math.max(20, contentMaxWidth - 4);
		const estimateMessageLines = (message: any) => {
			let lines = 1;
			const blocks =
				message.blocks && message.blocks.length > 0
					? message.blocks
					: Array.isArray(message.content)
						? message.content
						: [];

			if (blocks.length > 0) {
				for (const block of blocks) {
					const blockType =
						block.type || (block.text !== undefined ? "text" : undefined);
					if (blockType === "text" || blockType === "reasoning") {
						const text = Array.isArray(block.content)
							? block.content
									.map((part: any) =>
										part.text ||
										(typeof part === "string" ? part : JSON.stringify(part)),
									)
									.join("")
							: String(block.content || block.text || "");
						const width =
							blockType === "reasoning"
								? Math.max(10, contentMaxWidth - 5)
								: averageCharsPerLine;
						lines +=
							(blockType === "reasoning" ? 2 : 0) +
							Math.max(
								Math.ceil(text.length / width),
								(text.match(/\n/g) || []).length + 1,
							);
					} else if (blockType === "tool") {
						lines += 14;
					}
				}
			} else if (typeof message.content === "string") {
				lines +=
					Math.max(
						Math.ceil(message.content.length / averageCharsPerLine),
						(message.content.match(/\n/g) || []).length + 1,
					);
			}

			if (message.toolCalls?.length > 0 && !blocks.some((block: any) => block.type === "tool")) {
				lines += message.toolCalls.length * 14;
			}
			return lines + 1;
		};

		let accumulatedLines = 0;
		let sliceIndex = messages.length;
		for (let index = messages.length - 1; index >= 0; index--) {
			accumulatedLines += estimateMessageLines(messages[index]);
			sliceIndex = index;
			if (accumulatedLines >= linesNeeded) break;
		}
		return messages.slice(Math.max(0, sliceIndex - 10));
	}, [messages, scrollOffset, chatViewportHeight, contentMaxWidth]);

	const scrollToBottom = useCallback(() => {
		followTail();
		setScrollOffset(0);
	}, [followTail, setScrollOffset]);

	const scrollToTop = useCallback(() => {
		suspendTailFollow();
		setScrollOffset(maxScrollOffset);
	}, [maxScrollOffset, setScrollOffset, suspendTailFollow]);

	const scrollPageUp = useCallback(() => {
		suspendTailFollow();
		setScrollOffset((offset) => Math.min(maxScrollOffset, offset + chatViewportHeight));
	}, [chatViewportHeight, maxScrollOffset, setScrollOffset, suspendTailFollow]);

	const scrollPageDown = useCallback(() => {
		setScrollOffset((offset) => {
			const nextOffset = Math.max(0, offset - chatViewportHeight);
			if (nextOffset === 0) followTail();
			return nextOffset;
		});
	}, [chatViewportHeight, followTail, setScrollOffset]);

	const scrollLineUp = useCallback(() => {
		suspendTailFollow();
		setScrollOffset((offset) => Math.min(maxScrollOffset, offset + 1));
	}, [maxScrollOffset, setScrollOffset, suspendTailFollow]);

	const scrollLineDown = useCallback(() => {
		setScrollOffset((offset) => {
			const nextOffset = Math.max(0, offset - 1);
			if (nextOffset === 0) followTail();
			return nextOffset;
		});
	}, [followTail, setScrollOffset]);

	return {
		visibleMessages,
		scrollOffset,
		totalMessageLines,
		contentMaxWidth,
		chatViewportHeight,
		isAtBottom,
		newMessageCount,
		scrollToBottom,
		scrollToTop,
		scrollPageUp,
		scrollPageDown,
		scrollLineUp,
		scrollLineDown,
		setScrollOffset,
	};
}
