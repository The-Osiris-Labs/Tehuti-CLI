import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { computeMessageLines } from "../../../terminal/output.js";

/**
 * Options for the chat viewport hook.
 */
export interface UseChatViewportOptions {
	messages: any[];
	terminalHeight: number;
	terminalWidth: number;
	headerHeight: number;
	promptOverlayHeight: number;
	warningsHeight: number;
	paletteHeight: number;
	loadingOverlayHeight: number;
	thinkingOverlayHeight: number;
	errorOverlayHeight: number;
	input: string;
	showWelcome: boolean;
}

export interface UseChatViewportReturn {
	/** Visible messages for the current viewport window. */
	visibleMessages: any[];
	/** Deferred (lower-priority) version for React 18. */
	deferredVisibleMessages: any[];
	/** Current scroll offset (in lines, 0 = at bottom). */
	scrollOffset: number;
	/** Total estimated lines for all messages. */
	totalMessageLines: number;
	/** Available content width. */
	contentMaxWidth: number;
	/** Viewport height (terminal minus overlays). */
	chatViewportHeight: number;
	/** Whether the user has scrolled to (or past) the bottom. */
	isAtBottom: boolean;
	/** Count of new messages since the user last scrolled to bottom. */
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
 * Manages the line-budgeted chat viewport with tail-follow scrolling,
 * new-message badge tracking, and scroll-anchor behavior.
 *
 * Extracted from the inline viewport logic in chat.ts (lines ~2253-2567).
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
	input,
	showWelcome,
}: UseChatViewportOptions): UseChatViewportReturn {
	const [scrollOffset, setScrollOffset] = useState(0);
	const messagesEndRef = useRef<boolean>(true);
	const messagesRef = useRef<typeof messages>([]);
	const newMessageCountRef = useRef<number>(0);
	const [newMessageCount, setNewMessageCount] = useState(0);
	const scrollAnchorRef = useRef<number>(0);

	const contentMaxWidth = Math.max(40, terminalWidth - 4);

	const chatViewportHeight = Math.max(
		3,
		terminalHeight -
			headerHeight -
			promptOverlayHeight -
			(scrollOffset > 0 ? 3 : 0) - // Scroll banner
			(input.startsWith("/") && input.length > 1 ? 1 : 0) - // Suggestions row
			warningsHeight -
			paletteHeight -
			loadingOverlayHeight -
			thinkingOverlayHeight -
			errorOverlayHeight,
	);

	// Total estimated lines for all messages.
	const totalMessageLines = useMemo(() => {
		let lines = 0;
		for (const msg of messages) {
			lines += computeMessageLines(msg, contentMaxWidth);
		}
		if (showWelcome) {
			lines += messages.length > 0 ? 3 : 12;
		}
		return lines;
	}, [messages, contentMaxWidth, showWelcome]);

	// Keep scroll offset bound to total lines
	useEffect(() => {
		if (messagesEndRef.current) {
			setScrollOffset(0);
		} else {
			setScrollOffset((prev) => {
				const safeMaxOff = Math.max(
					0,
					Math.ceil(totalMessageLines * 3.0) + 100 - chatViewportHeight,
				);
				return Math.min(prev, safeMaxOff);
			});
		}
	}, [totalMessageLines, chatViewportHeight]);

	// Track the previous messages length for new-message badge
	messagesRef.current = messages;

	// For performance, we only render the messages that intersect the viewport plus a buffer.
	// The line estimate is intentionally cheap (no markdown rendering) to avoid hanging
	// the UI when long final responses are streamed.
	const visibleMessages = useMemo(() => {
		const linesNeeded = chatViewportHeight + scrollOffset + 20;
		const avgCharsPerLine = Math.max(20, contentMaxWidth - 4);
		const estimateMsgLines = (msg: any) => {
			let l = 1;
			const blocks =
				msg.blocks && msg.blocks.length > 0
					? msg.blocks
					: Array.isArray(msg.content)
						? msg.content
						: [];

			if (blocks && blocks.length > 0) {
				for (const block of blocks) {
					// Infer block type from shape when `.type` is missing.
					const blockType =
						block.type || (block.text !== undefined ? "text" : undefined);

					if (blockType === "text") {
						let textContent = "";
						if (Array.isArray(block.content)) {
							textContent = block.content
								.map(
									(c: any) =>
										c.text || (typeof c === "string" ? c : JSON.stringify(c)),
								)
								.join("");
						} else {
							textContent = String(block.content || block.text || "");
						}
						l +=
							Math.max(1, Math.ceil(textContent.length / avgCharsPerLine)) +
							(textContent.match(/\n/g) || []).length;
					} else if (blockType === "reasoning") {
						let reasoningContent = "";
						if (Array.isArray(block.content)) {
							reasoningContent = block.content
								.map(
									(c: any) =>
										c.text || (typeof c === "string" ? c : JSON.stringify(c)),
								)
								.join("");
						} else {
							reasoningContent = String(block.content || block.text || "");
						}
						l +=
							2 +
							Math.max(
								1,
								Math.ceil(
									reasoningContent.length / Math.max(10, contentMaxWidth - 5),
								),
							);
					} else if (blockType === "tool") {
						l += 8;
					}
				}
			} else if (typeof msg.content === "string") {
				const text = msg.content;
				l +=
					Math.max(1, Math.ceil(text.length / avgCharsPerLine)) +
					(text.match(/\n/g) || []).length;
			}

			if (msg.toolCalls && msg.toolCalls.length > 0) {
				const hasToolBlock = blocks?.some((b: any) => b.type === "tool");
				if (!hasToolBlock) {
					l += msg.toolCalls.length * 8;
				}
			}

			return l + 1;
		};
		let accumulatedLines = 0;
		let sliceIndex = messages.length;
		for (let i = messages.length - 1; i >= 0; i--) {
			accumulatedLines += estimateMsgLines(messages[i]);
			sliceIndex = i;
			if (accumulatedLines >= linesNeeded) break;
		}
		return messages.slice(Math.max(0, sliceIndex - 10));
	}, [messages, scrollOffset, chatViewportHeight, contentMaxWidth]);

	const deferredVisibleMessages = useDeferredValue(visibleMessages);

	// Scroll actions
	const scrollToBottom = useCallback(() => {
		messagesEndRef.current = true;
		setScrollOffset(0);
	}, [setScrollOffset]);

	const scrollToTop = useCallback(() => {
		messagesEndRef.current = false;
		const safeMaxOff = Math.max(
			0,
			Math.ceil(totalMessageLines * 3.0) + 100 - chatViewportHeight,
		);
		setScrollOffset(safeMaxOff);
	}, [totalMessageLines, chatViewportHeight, setScrollOffset]);

	const scrollPageUp = useCallback(() => {
		messagesEndRef.current = false;
		const safeMaxOff = Math.max(
			0,
			Math.ceil(totalMessageLines * 3.0) + 100 - chatViewportHeight,
		);
		setScrollOffset((off) => Math.min(safeMaxOff, off + chatViewportHeight));
	}, [totalMessageLines, chatViewportHeight, setScrollOffset]);

	const scrollPageDown = useCallback(() => {
		setScrollOffset((off) => {
			const newOff = Math.max(0, off - chatViewportHeight);
			if (newOff <= 0) messagesEndRef.current = true;
			return newOff;
		});
	}, [chatViewportHeight, setScrollOffset]);

	const scrollLineUp = useCallback(() => {
		messagesEndRef.current = false;
		const safeMaxOff = Math.max(
			0,
			Math.ceil(totalMessageLines * 3.0) + 100 - chatViewportHeight,
		);
		setScrollOffset((off) => Math.min(safeMaxOff, off + 1));
	}, [totalMessageLines, chatViewportHeight, setScrollOffset]);

	const scrollLineDown = useCallback(() => {
		setScrollOffset((off) => {
			const newOff = Math.max(0, off - 1);
			if (newOff <= 0) messagesEndRef.current = true;
			return newOff;
		});
	}, [setScrollOffset]);

	const isAtBottom = messagesEndRef.current;

	// Track new message count badge
	useEffect(() => {
		if (messagesEndRef.current) {
			scrollToBottom();
			// User scrolled to (or recently arrived at) the bottom — reset
			// both the anchor and the badge.
			if (newMessageCountRef.current !== 0 || scrollAnchorRef.current !== 0) {
				newMessageCountRef.current = 0;
				setNewMessageCount(0);
				scrollAnchorRef.current = 0;
			}
		} else {
			// User is scrolled up. Take the first snapshot of message length
			// and diff against it in subsequent renders.
			if (scrollAnchorRef.current === 0) {
				scrollAnchorRef.current = messagesRef.current.length;
			}
			const newArrivals = messagesRef.current.length - scrollAnchorRef.current;
			if (newArrivals > 0 && newArrivals !== newMessageCountRef.current) {
				newMessageCountRef.current = newArrivals;
				setNewMessageCount(newArrivals);
			}
		}
	}, [scrollToBottom, messages.length, scrollOffset]);

	return {
		visibleMessages,
		deferredVisibleMessages,
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
