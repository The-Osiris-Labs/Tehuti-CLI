import { useInput } from "ink";
import chalk from "chalk";
import { isMouseSequence } from "../../../utils/mouse.js";
import { type CommandItem } from "../components/CommandPalette.js";
import React from "react";

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
}

export function useChatInput(props: UseChatInputProps) {
	const {
		input,
		setInput,
		cursorPos,
		setCursorPos,
		showCommandPalette,
		setShowCommandPalette,
		history,
		setHistory,
		historyIndex,
		setHistoryIndex,
		inputBeforeHistoryRef,
		commands,
		sessionId,
		ctxRef,
		sessionManager,
		costTracker,
		onExit,
		exit,
		selectionStart,
		setSelectionStart,
		selectionEnd,
		setSelectionEnd,
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
	} = props;

	const showCommandPaletteRef = React.useRef(showCommandPalette);
	React.useEffect(() => {
		showCommandPaletteRef.current = showCommandPalette;
	}, [showCommandPalette]);

	useInput((k, key) => {
		if (k && k.startsWith("\x1b[<64;")) {
			scrollLineUp();
			return;
		}
		if (k && k.startsWith("\x1b[<65;")) {
			scrollLineDown();
			return;
		}
		if (isMouseSequence(k)) {
			return;
		}

		if (key.ctrl && k === "p") {
			const newVal = !showCommandPaletteRef.current;
			showCommandPaletteRef.current = newVal;
			setShowCommandPalette(newVal);
			return;
		}

		if (showCommandPaletteRef.current || showConfigEditor || pendingQuestion) {
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
		if (!key.shift && (
			key.leftArrow || key.rightArrow || key.upArrow || key.downArrow ||
			key.pageUp || key.pageDown || key.home || key.end ||
			(key.ctrl && (key.upArrow || key.downArrow))
		)) {
			if (hasSelection) {
				setSelectionStart(null);
				setSelectionEnd(null);
			}
		}

		// Bracketed paste handling
		if (k && k.startsWith("\x1b[200~") && k.endsWith("\x1b[201~")) {
			if (loading) return;
			const pastedText = k.slice(7, -6).replace(/\r?\n/g, " ");
			let targetText = input;
			let targetPos = cursorPos;
			if (hasSelection) {
				const res = deleteSelection();
				targetText = res.text;
				targetPos = res.pos;
			}
			setInput(targetText.slice(0, targetPos) + pastedText + targetText.slice(targetPos));
			setCursorPos(targetPos + pastedText.length);
			setHistoryIndex(-1);
			return;
		}

		// Backspace handling
		if (key.backspace || k === "\x7f" || k === "\b" || k === "\x08" || (key.delete && k !== "\x1b[3~")) {
			if (loading) return;
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
			if (loading) return;
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
			if (input.length === 0) {
				if (sessionId && ctxRef.current) {
					sessionManager.saveSession(sessionId, ctxRef.current);
				}
				console.log();
				console.log(chalk.hex("#F5C518")(costTracker.getSessionSummary()));
				onExit();
				exit();
			} else if (hasSelection) {
				const [start, end] = [Math.min(selectionStart!, selectionEnd!), Math.max(selectionStart!, selectionEnd!)];
				const selectedText = input.slice(start, end);
				console.log("\x1B]52;;" + Buffer.from(selectedText).toString("base64") + "\x07");
				setSelectionStart(null);
				setSelectionEnd(null);
			} else {
				if (loading) return;
				setInput("");
				setCursorPos(0);
			}
			return;
		}

		if (key.return && input.trim()) {
			if (loading) return;
			const newHistory = [
				input.trim(),
				...history.filter((h) => h !== input.trim()),
			].slice(0, 100);
			setHistory(newHistory);
			saveHistory(newHistory);
			setHistoryIndex(-1);
			void send(input.trim());
			return;
		}

		if (key.upArrow && !loading) {
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

		if (key.downArrow && !loading) {
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

		if (key.home) {
			scrollToTop();
			return;
		}

		if (key.end) {
			scrollToBottom();
			return;
		}

		if (key.ctrl && k === "l") {
			if (loading) return;
			void resetConversation();
			return;
		}

		if (key.ctrl && k === "u") {
			if (loading) return;
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
		if (((key.meta || key.ctrl) && (k === "\x7f" || k === "\b")) || (key.ctrl && k === "w")) {
			if (loading) return;
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
			if (loading) return;
			setInput(input.slice(0, cursorPos));
			setCursorPos(cursorPos);
			return;
		}

		if (key.ctrl && k === "d") {
			if (input.length === 0) {
				if (sessionId && ctxRef.current) {
					sessionManager.saveSession(sessionId, ctxRef.current);
				}
				console.log();
				console.log(chalk.hex("#F5C518")(costTracker.getSessionSummary()));
				onExit();
				exit();
			} else {
				if (loading) return;
				if (hasSelection) {
					deleteSelection();
				} else {
					setInput(input.slice(0, cursorPos) + input.slice(cursorPos + 1));
				}
			}
			return;
		}

		if (key.ctrl && k === "x") {
			if (loading) return;
			if (hasSelection) {
				const [start, end] = [Math.min(selectionStart!, selectionEnd!), Math.max(selectionStart!, selectionEnd!)];
				const selectedText = input.slice(start, end);
				console.log("\x1B]52;;" + Buffer.from(selectedText).toString("base64") + "\x07");
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
			if (loading) return;
			const before = input.slice(0, cursorPos);
			const after = input.slice(cursorPos);
			if (before.length > 0) {
				const lastChar = before.slice(-1);
				setInput(before.slice(0, -1) + after.slice(0, 1) + lastChar + after.slice(1));
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

		if (key.escape) {
			if (loading) return;
			setInput("");
			setCursorPos(0);
			setHistoryIndex(-1);
			return;
		}

		// Handle normal character input and paste
		if (k && !key.ctrl && !key.meta && !k.startsWith("\x1b") && k !== "\r" && k !== "\n" && k !== "\t") {
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
			if (loading) return;
			// Trigger Command Palette automatically when typing '/' as the first character
			if (k === "/" && input.trim() === "" && cursorPos === 0) {
				showCommandPaletteRef.current = true;
				setShowCommandPalette(true);
				return;
			}

			const sanitized = k.replace(/[\x00-\x1F\x7F]/g, "").replace(/\r?\n/g, " ");
			if (sanitized.length > 0) {
				let targetText = input;
				let targetPos = cursorPos;
				if (hasSelection) {
					const res = deleteSelection();
					targetText = res.text;
					targetPos = res.pos;
				}
				setInput(targetText.slice(0, targetPos) + sanitized + targetText.slice(targetPos));
				setCursorPos(targetPos + sanitized.length);
				setHistoryIndex(-1);
			}
		}
	});
}
