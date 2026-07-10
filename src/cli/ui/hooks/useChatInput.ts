import chalk from "chalk";
import { useInput } from "ink";
import React from "react";
import { injectionQueue, interruptAgent } from "../../../agent/events.js";
import {
	isMouseSequence,
	isMouseSequenceFragment,
	isMouseSequenceTail,
} from "../../../utils/mouse.js";

// Maximum time to wait for a mouse sequence fragment to complete before flushing.
const MOUSE_BUFFER_TIMEOUT_MS = 50;

export interface UseChatInputProps {
	input: string;
	setInput: (val: string | ((prev: string) => string)) => void;
	cursorPos: number;
	setCursorPos: (val: number | ((prev: number) => number)) => void;
	showCommandPalette: boolean;
	setShowCommandPalette: (val: boolean) => void;
	history: string[];
	setHistory: (val: string[]) => void;
	historyIndex: number;
	setHistoryIndex: (val: number) => void;
	inputBeforeHistoryRef: React.MutableRefObject<string>;
	commands: any[];
	sessionId: string | null;
	ctxRef: React.MutableRefObject<any>;
	sessionManager: any;
	costTracker: any;
	onExit: () => void;
	exit: () => void;
	selectionStart: number | null;
	setSelectionStart: (val: number | null) => void;
	selectionEnd: number | null;
	setSelectionEnd: (val: number | null) => void;
	loading: boolean;
	scrollPageUp: () => void;
	scrollPageDown: () => void;
	scrollLineUp: () => void;
	scrollLineDown: () => void;
	scrollToTop: () => void;
	scrollToBottom: () => void;
	resetConversation: () => Promise<void>;
	send: (text: string) => Promise<void>;
	saveHistory: (history: string[]) => void;
	showConfigEditor?: boolean;
	pendingQuestion?: any;
	showSessionList?: boolean;
	queuedMessages: string[];
	setQueuedMessages: React.Dispatch<React.SetStateAction<string[]>>;
}

export function useChatInput(props: UseChatInputProps) {
	const {
		input,
		setInput: originalSetInput,
		cursorPos,
		setCursorPos: originalSetCursorPos,
		showCommandPalette,
		setShowCommandPalette,
		history,
		setHistory: originalSetHistory,
		historyIndex,
		setHistoryIndex: originalSetHistoryIndex,
		inputBeforeHistoryRef,
		commands,
		sessionId,
		ctxRef,
		sessionManager,
		costTracker,
		onExit,
		exit,
		selectionStart,
		setSelectionStart: originalSetSelectionStart,
		selectionEnd,
		setSelectionEnd: originalSetSelectionEnd,
		loading,
		scrollPageUp,
		scrollPageDown,
		scrollLineUp,
		scrollLineDown,
		scrollToTop,
		scrollToBottom,
		resetConversation,
		send,
		saveHistory,
		showConfigEditor,
		pendingQuestion,
		showSessionList,
		queuedMessages,
		setQueuedMessages,
	} = props;

	const showCommandPaletteRef = React.useRef(showCommandPalette);
	const showConfigEditorRef = React.useRef(showConfigEditor);
	const pendingQuestionRef = React.useRef(pendingQuestion);
	const showSessionListRef = React.useRef(showSessionList);

	const inputRef = React.useRef(input);
	const cursorPosRef = React.useRef(cursorPos);
	const selectionStartRef = React.useRef(selectionStart);
	const selectionEndRef = React.useRef(selectionEnd);
	const historyRef = React.useRef(history);
	const historyIndexRef = React.useRef(historyIndex);
	const loadingRef = React.useRef(loading);
	// Buffer for split mouse sequence fragments arriving across multiple useInput() callbacks.
	const mouseBufferRef = React.useRef<string>("");
	const mouseBufferTimerRef = React.useRef<ReturnType<
		typeof setTimeout
	> | null>(null);

	const setInput = React.useCallback(
		(newVal: string | ((prev: string) => string)) => {
			const next =
				typeof newVal === "function" ? newVal(inputRef.current) : newVal;
			inputRef.current = next;
			originalSetInput(next);
		},
		[originalSetInput],
	);

	const setCursorPos = React.useCallback(
		(newVal: number | ((prev: number) => number)) => {
			const next =
				typeof newVal === "function" ? newVal(cursorPosRef.current) : newVal;
			cursorPosRef.current = next;
			originalSetCursorPos(next);
		},
		[originalSetCursorPos],
	);

	const setSelectionStart = React.useCallback(
		(newVal: number | null | ((prev: number | null) => number | null)) => {
			const next =
				typeof newVal === "function"
					? newVal(selectionStartRef.current)
					: newVal;
			selectionStartRef.current = next;
			originalSetSelectionStart(next);
		},
		[originalSetSelectionStart],
	);

	const setSelectionEnd = React.useCallback(
		(newVal: number | null | ((prev: number | null) => number | null)) => {
			const next =
				typeof newVal === "function" ? newVal(selectionEndRef.current) : newVal;
			selectionEndRef.current = next;
			originalSetSelectionEnd(next);
		},
		[originalSetSelectionEnd],
	);

	const setHistoryIndex = React.useCallback(
		(newVal: number | ((prev: number) => number)) => {
			const next =
				typeof newVal === "function" ? newVal(historyIndexRef.current) : newVal;
			historyIndexRef.current = next;
			originalSetHistoryIndex(next);
		},
		[originalSetHistoryIndex],
	);

	const setHistory = React.useCallback(
		(newVal: string[] | ((prev: string[]) => string[])) => {
			const next =
				typeof newVal === "function" ? newVal(historyRef.current) : newVal;
			historyRef.current = next;
			originalSetHistory(next);
		},
		[originalSetHistory],
	);

	React.useEffect(() => {
		showCommandPaletteRef.current = showCommandPalette;
		showConfigEditorRef.current = showConfigEditor;
		pendingQuestionRef.current = pendingQuestion;
		showSessionListRef.current = showSessionList;
		inputRef.current = input;
		cursorPosRef.current = cursorPos;
		selectionStartRef.current = selectionStart;
		selectionEndRef.current = selectionEnd;
		historyRef.current = history;
		historyIndexRef.current = historyIndex;
		loadingRef.current = loading;
	}, [
		showCommandPalette,
		showConfigEditor,
		pendingQuestion,
		showSessionList,
		input,
		cursorPos,
		selectionStart,
		selectionEnd,
		history,
		historyIndex,
		loading,
	]);

	// Cleanup the mouse buffer timer on unmount.
	React.useEffect(() => {
		return () => {
			if (mouseBufferTimerRef.current) {
				clearTimeout(mouseBufferTimerRef.current);
				mouseBufferTimerRef.current = null;
			}
		};
	}, []);

	const flushMouseBuffer = React.useCallback(() => {
		mouseBufferRef.current = "";
		if (mouseBufferTimerRef.current) {
			clearTimeout(mouseBufferTimerRef.current);
			mouseBufferTimerRef.current = null;
		}
	}, []);

	const absorbMouseFragment = React.useCallback(
		(k: string): boolean => {
			// True if the chunk was absorbed into the mouse buffer (caller should return early).
			// NOTE: Bare "M"/"m" is NOT treated as a tail — that would eat literal
			// letter M/m typed by the user (the old isMouseSequence() bare-tail check
			// was removed in mouse.ts for the same reason).
			if (
				mouseBufferRef.current.length > 0 &&
				(isMouseSequenceTail(k) ||
					(k.length > 1 && (k.endsWith("M") || k.endsWith("m"))))
			) {
				// Tail arrived — consume the whole buffer + this chunk as a mouse sequence.
				const fullSeq = mouseBufferRef.current + k;
				if (fullSeq.includes("<64;")) scrollLineUp();
				if (fullSeq.includes("<65;")) scrollLineDown();

				flushMouseBuffer();
				return true;
			}
			if (isMouseSequenceFragment(k)) {
				mouseBufferRef.current += k;
				// Reset the timeout — if no more data arrives, drop the buffer.
				if (mouseBufferTimerRef.current) {
					clearTimeout(mouseBufferTimerRef.current);
				}
				mouseBufferTimerRef.current = setTimeout(
					flushMouseBuffer,
					MOUSE_BUFFER_TIMEOUT_MS,
				);
				return true;
			}
			// Complete mouse sequence in one chunk.
			if (isMouseSequence(k)) {
				if (k.includes("<64;")) scrollLineUp();
				if (k.includes("<65;")) scrollLineDown();
				flushMouseBuffer();
				return true;
			}
			return false;
		},
		[flushMouseBuffer, scrollLineUp, scrollLineDown],
	);

	useInput((k, key) => {
		const input = inputRef.current;
		const cursorPos = cursorPosRef.current;
		const selectionStart = selectionStartRef.current;
		const selectionEnd = selectionEndRef.current;
		const history = historyRef.current;
		const historyIndex = historyIndexRef.current;
		const loading = loadingRef.current;

		if (
			k?.startsWith("\x1b[<64;") ||
			k?.startsWith("[<64;") ||
			k?.startsWith("<64;")
		) {
			scrollLineUp();
			return;
		}
		if (
			k?.startsWith("\x1b[<65;") ||
			k?.startsWith("[<65;") ||
			k?.startsWith("<65;")
		) {
			scrollLineDown();
			return;
		}
		// Absorb split mouse sequence fragments before they can pollute the input.
		if (absorbMouseFragment(k)) {
			return;
		}
		// Final safety net: a complete mouse sequence we missed.
		if (isMouseSequence(k)) {
			return;
		}

		if (key.ctrl && k === "p") {
			const newVal = !showCommandPaletteRef.current;
			showCommandPaletteRef.current = newVal;
			setShowCommandPalette(newVal);
			return;
		}

		if (
			showCommandPaletteRef.current ||
			showConfigEditorRef.current ||
			pendingQuestionRef.current ||
			showSessionListRef.current
		) {
			return;
		}

		const hasSelection = selectionStart !== null && selectionEnd !== null;

		const deleteSelection = () => {
			if (!hasSelection) return { text: input, pos: cursorPos };
			const start = Math.min(selectionStart!, selectionEnd!);
			const end = Math.max(selectionStart!, selectionEnd!);
			const newText = input.slice(0, start) + input.slice(end);
			setInput(newText);
			setCursorPos(start);
			setSelectionStart(null);
			setSelectionEnd(null);
			return { text: newText, pos: start };
		};

		// Clear selection on cursor navigation without Shift
		if (
			!key.shift &&
			(key.leftArrow ||
				key.rightArrow ||
				key.upArrow ||
				key.downArrow ||
				key.pageUp ||
				key.pageDown ||
				key.home ||
				key.end)
		) {
			if (hasSelection) {
				setSelectionStart(null);
				setSelectionEnd(null);
			}
		}

		// Bracketed paste handling. Preserve newlines so multi-line content
		// (e.g. code snippets, stack traces, lists) survives the round-trip
		// to the model. Strip only the surrounding paste-mode escape sequences.
		if (k?.startsWith("\x1b[200~") && k.endsWith("\x1b[201~")) {
			const pastedText = k.slice(6, -6);
			let targetText = input;
			let targetPos = cursorPos;
			if (hasSelection) {
				const res = deleteSelection();
				targetText = res.text;
				targetPos = res.pos;
			}
			setInput(
				targetText.slice(0, targetPos) +
					pastedText +
					targetText.slice(targetPos),
			);
			setCursorPos(targetPos + pastedText.length);
			setHistoryIndex(-1);
			return;
		}

		// Backspace handling
		if (
			key.backspace ||
			k === "\x7f" ||
			k === "\b" ||
			k === "\x08" ||
			(key.delete && k !== "\x1b[3~")
		) {
			if (hasSelection) {
				deleteSelection();
				return;
			}
			if (cursorPos > 0) {
				setInput((i: string) => i.slice(0, cursorPos - 1) + i.slice(cursorPos));
				setCursorPos((p: number) => Math.max(0, p - 1));
			}
			return;
		}

		// Delete handling (forward delete)
		if ((key.delete && k === "\x1b[3~") || k === "\x1b[3~") {
			if (hasSelection) {
				deleteSelection();
				return;
			}
			if (cursorPos < input.length) {
				setInput((i: string) => i.slice(0, cursorPos) + i.slice(cursorPos + 1));
			}
			return;
		}

		if (key.ctrl && k === "c") {
			if (hasSelection) {
				const [start, end] = [
					Math.min(selectionStart!, selectionEnd!),
					Math.max(selectionStart!, selectionEnd!),
				];
				const selectedText = input.slice(start, end);
				console.log(
					`\x1B]52;;${Buffer.from(selectedText).toString("base64")}\x07`,
				);
				setSelectionStart(null);
				setSelectionEnd(null);
				return;
			}

			if (loading) {
				interruptAgent();
				setInput("");
				setCursorPos(0);
				return;
			}

			if (input.length === 0) {
				const performExit = async () => {
					if (sessionId && ctxRef.current) {
						try {
							await sessionManager.saveSession(sessionId, ctxRef.current);
						} catch (e) {
							console.error("Failed to save session:", e);
						}
					}
					console.log();
					console.log(chalk.hex("#F5C518")(costTracker.getSessionSummary()));
					onExit();
					exit();
				};
				void performExit();
				return;
			}

			setInput("");
			setCursorPos(0);
			return;
		}

		// Shift+Enter / Alt+Enter / Ctrl+Enter: insert a newline.
		// Three delivery channels from Ink must all be recognized:
		//   1. Ink key flags: key.shift/meta/ctrl && key.return (e.g. plain mode terminals)
		//   2. Standard CSI (Ghostty, iTerm2, most xterms): \x1b[13;<mod>~ — Ink parses
		//      these to key.code="[13~" with key.shift/ctrl/meta set, and DROPS the
		//      string `k` to "" because the key name is a function key (f3/f4).
		//   3. xterm modifyOtherKeys=2: \x1b[27;<mod>;13~ — Ink does not understand
		//      this format (no name, no code), so it leaves the leading ESC-stripped
		//      string as `k` and reports NO modifier flags. The handler must match
		//      both with-ESC and without-ESC variants.
		const kAny = k as unknown as string;
		const keyAny = key as unknown as { code?: string };
		const isModifiedEnter =
			// Channel 1: Ink key flags
			(key.shift && key.return) ||
			(key.meta && key.return) ||
			(key.ctrl && key.return) ||
			// Channel 2: standard CSI — match by Ink's decoded code (only non-return
			// modifier keys are decoded to name="f3"/"f4", so key.return is false here)
			(keyAny.code === "[13~" && (key.shift || key.meta || key.ctrl)) ||
			// Channel 3: xterm modifyOtherKeys=2 — ESC byte gets stripped by Ink,
			// so compare against the ESC-stripped literal.
			k === "[27;2;13~" || // Shift+Enter
			k === "[27;3;13~" || // Alt+Enter
			k === "[27;4;13~" || // Alt+Shift+Enter
			k === "[27;5;13~" || // Ctrl+Enter
			k === "[27;6;13~" || // Ctrl+Shift+Enter
			k === "[27;7;13~" || // Ctrl+Alt+Enter
			// Defensive: if a terminal bypasses Ink's stripping, match the raw form too
			kAny === "\x1b[13;2~" ||
			kAny === "\x1b[13;3~" ||
			kAny === "\x1b[13;4~" ||
			kAny === "\x1b[13;5~" ||
			kAny === "\x1b[13;6~" ||
			kAny === "\x1b[27;2;13~" ||
			kAny === "\x1b[27;3;13~" ||
			kAny === "\x1b[27;4;13~" ||
			kAny === "\x1b[27;5;13~" ||
			kAny === "\x1b[27;6;13~" ||
			kAny === "\x1b[27;7;13~";
		if (isModifiedEnter) {
			const before = input.slice(0, cursorPos);
			const after = input.slice(cursorPos);
			setInput(`${before}\n${after}`);
			setCursorPos(cursorPos + 1);
			setHistoryIndex(-1);
			return;
		}

		if (key.return && !key.shift && input.trim()) {
			const text = input.trim();

			if (loading) {
				if (text.startsWith("/btw ")) {
					injectionQueue.push(text.slice(5));
				} else {
					setQueuedMessages((prev) => [...prev, text]);
				}
				setInput("");
				setCursorPos(0);
				return;
			}

			const newHistory = [text, ...history.filter((h) => h !== text)].slice(
				0,
				100,
			);
			setHistory(newHistory);
			saveHistory(newHistory);
			setHistoryIndex(-1);
			void send(text);
			return;
		}

		if (key.pageUp) {
			scrollPageUp();
			return;
		}

		if (key.pageDown) {
			scrollPageDown();
			return;
		}

		if ((key.ctrl || key.meta) && key.upArrow) {
			scrollLineUp();
			return;
		}

		if ((key.ctrl || key.meta) && key.downArrow) {
			scrollLineDown();
			return;
		}

		if (key.home) {
			scrollToTop();
			return;
		}

		if (key.end) {
			scrollToBottom();
			return;
		}

		if (key.upArrow && !key.ctrl && !key.meta && !loading) {
			if (history.length > 0) {
				if (historyIndex === -1) {
					inputBeforeHistoryRef.current = input;
					setHistoryIndex(0);
					setInput(history[0]);
					setCursorPos(history[0].length);
				} else if (historyIndex < history.length - 1) {
					const newIndex = historyIndex + 1;
					setHistoryIndex(newIndex);
					setInput(history[newIndex]);
					setCursorPos(history[newIndex].length);
				}
			}
			return;
		}

		if (key.downArrow && !key.ctrl && !key.meta && !loading) {
			if (historyIndex > 0) {
				const newIndex = historyIndex - 1;
				setHistoryIndex(newIndex);
				setInput(history[newIndex]);
				setCursorPos(history[newIndex].length);
			} else if (historyIndex === 0) {
				setHistoryIndex(-1);
				setInput(inputBeforeHistoryRef.current);
				setCursorPos(inputBeforeHistoryRef.current.length);
			}
			return;
		}

		if (key.ctrl && k === "l") {
			void resetConversation();
			return;
		}

		if (key.ctrl && k === "u") {
			setInput(input.slice(cursorPos));
			setCursorPos(0);
			setHistoryIndex(-1);
			return;
		}

		if (key.ctrl && k === "a") {
			setCursorPos(0);
			return;
		}

		if (key.ctrl && k === "e") {
			setCursorPos(input.length);
			return;
		}

		// Delete previous word: Ctrl+W or Option+Backspace (Meta+Backspace / Meta+Delete)
		if (
			((key.meta || key.ctrl) && (k === "\x7f" || k === "\b")) ||
			(key.ctrl && k === "w")
		) {
			const before = input.slice(0, cursorPos);
			const after = input.slice(cursorPos);
			const match = before.match(/\S+\s*$/);
			if (match) {
				const newPos = cursorPos - match[0].length;
				setInput(before.slice(0, newPos) + after);
				setCursorPos(newPos);
			} else {
				setInput(after);
				setCursorPos(0);
			}
			return;
		}

		if (key.ctrl && k === "k") {
			setInput(input.slice(0, cursorPos));
			setCursorPos(cursorPos);
			return;
		}

		if (key.ctrl && k === "d") {
			if (input.length === 0) {
				const performExit = async () => {
					if (sessionId && ctxRef.current) {
						try {
							await sessionManager.saveSession(sessionId, ctxRef.current);
						} catch (e) {
							console.error("Failed to save session:", e);
						}
					}
					console.log();
					console.log(chalk.hex("#F5C518")(costTracker.getSessionSummary()));
					onExit();
					exit();
				};
				void performExit();
			} else {
				if (hasSelection) {
					deleteSelection();
				} else {
					setInput(input.slice(0, cursorPos) + input.slice(cursorPos + 1));
				}
			}
			return;
		}

		if (key.ctrl && k === "x") {
			if (hasSelection) {
				const [start, end] = [
					Math.min(selectionStart!, selectionEnd!),
					Math.max(selectionStart!, selectionEnd!),
				];
				const selectedText = input.slice(start, end);
				console.log(
					`\x1B]52;;${Buffer.from(selectedText).toString("base64")}\x07`,
				);
				setInput(input.slice(0, start) + input.slice(end));
				setCursorPos(start);
				setSelectionStart(null);
				setSelectionEnd(null);
			}
			return;
		}

		if (key.ctrl && k === "v") {
			return;
		}

		if (key.ctrl && k === "t") {
			const before = input.slice(0, cursorPos);
			const after = input.slice(cursorPos);
			if (before.length > 0) {
				const lastChar = before.slice(-1);
				setInput(
					before.slice(0, -1) + after.slice(0, 1) + lastChar + after.slice(1),
				);
				setCursorPos(cursorPos + 1);
			}
			return;
		}

		// Text selection
		if (key.shift && key.leftArrow) {
			const newPos = Math.max(0, cursorPos - 1);
			if (selectionStart === null) {
				setSelectionStart(cursorPos);
			}
			setSelectionEnd(newPos);
			setCursorPos(newPos);
			return;
		}

		if (key.shift && key.rightArrow) {
			const newPos = Math.min(input.length, cursorPos + 1);
			if (selectionStart === null) {
				setSelectionStart(cursorPos);
			}
			setSelectionEnd(newPos);
			setCursorPos(newPos);
			return;
		}

		if (!key.shift && selectionStart !== null) {
			setSelectionStart(null);
			setSelectionEnd(null);
		}

		// Cursor navigation
		if (key.leftArrow && !key.shift) {
			if (key.ctrl || key.meta) {
				const before = input.slice(0, cursorPos);
				const match = before.match(/\S+\s*$/);
				if (match) {
					setCursorPos(cursorPos - match[0].length);
				} else {
					setCursorPos(0);
				}
			} else {
				setCursorPos((p: number) => Math.max(0, p - 1));
			}
			return;
		}

		if (key.rightArrow && !key.shift) {
			if (key.ctrl || key.meta) {
				const after = input.slice(cursorPos);
				const match = after.match(/^\s*\S+/);
				if (match) {
					setCursorPos(cursorPos + match[0].length);
				} else {
					setCursorPos(input.length);
				}
			} else {
				setCursorPos((p: number) => Math.min(input.length, p + 1));
			}
			return;
		}

		// PageUp / PageDown for scrolling history without a mouse
		if (key.pageUp) {
			scrollPageUp();
			return;
		}
		if (key.pageDown) {
			scrollPageDown();
			return;
		}

		if (key.ctrl && key.upArrow) {
			scrollLineUp();
			return;
		}

		if (key.ctrl && key.downArrow) {
			scrollLineDown();
			return;
		}

		if (key.escape) {
			setInput("");
			setCursorPos(0);
			setHistoryIndex(-1);
			return;
		}

		// Handle normal character input and paste
		if (
			k &&
			!key.ctrl &&
			!key.meta &&
			!k.startsWith("\x1b") &&
			k !== "\r" &&
			k !== "\n" &&
			k !== "\t"
		) {
			// Aggressively filter out mouse sequence fragments that leak into stdin
			// This covers individual characters, partial sequences, and glued sequences
			// produced by rapid mouse scrolling or dragging in SGR tracking mode.
			if (
				isMouseSequence(k) ||
				k === "[" ||
				k === "<" ||
				k === "[[ " ||
				/^(?:\d+;)+\d+[Mm]?$/.test(k) ||
				/(?:\d+;\d+(?:;\d+)?[Mm])+/.test(k) ||
				k.includes("[<") ||
				k.includes("[M")
			) {
				return;
			}

			// Trigger Command Palette automatically when typing '/' as the first character
			if (k === "/" && input.trim() === "" && cursorPos === 0) {
				showCommandPaletteRef.current = true;
				setShowCommandPalette(true);
				return;
			}

			const sanitized = k
				.replace(/[\x00-\x1F\x7F]/g, "")
				.replace(/\r?\n/g, " ");
			if (sanitized.length > 0) {
				if (hasSelection) {
					deleteSelection();
				}
				// B3 fix: use functional setters so rapid keystrokes cannot clobber
				// intermediate values via stale closure.
				const insertAt = cursorPos;
				setInput(
					(prev: string) =>
						prev.slice(0, insertAt) + sanitized + prev.slice(insertAt),
				);
				setCursorPos((p: number) => p + sanitized.length);
				setHistoryIndex(-1);
			}
		}
	});
}
