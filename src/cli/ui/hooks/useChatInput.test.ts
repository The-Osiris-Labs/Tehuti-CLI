import { render, useInput } from "ink";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type UseChatInputProps, useChatInput } from "./useChatInput.js";

// Mock the 'ink' module to capture the useInput callback
vi.mock("ink", async () => {
	const actual = await vi.importActual("ink");
	let inputCallback: any = null;
	return {
		...actual,
		useInput: vi.fn((cb) => {
			inputCallback = cb;
		}),
		// Helper to invoke the input callback in tests
		__triggerInput: (k: string, key: any) => {
			if (inputCallback) {
				inputCallback(k, key);
			}
		},
	};
});

describe("useChatInput hook", () => {
	let props: UseChatInputProps;
	let triggerInput: (k: string, key: any) => void;

	const HookWrapper = ({ props }: { props: UseChatInputProps }) => {
		useChatInput(props);
		return null;
	};

	beforeEach(async () => {
		vi.clearAllMocks();
		const inkMock = await import("ink");
		triggerInput = (inkMock as any).__triggerInput;

		props = {
			input: "hello world",
			setInput: vi.fn(),
			cursorPos: 11,
			setCursorPos: vi.fn(),
			showCommandPalette: false,
			setShowCommandPalette: vi.fn(),
			history: ["history-1", "history-2"],
			setHistory: vi.fn(),
			historyIndex: -1,
			setHistoryIndex: vi.fn(),
			inputBeforeHistoryRef: { current: "" },
			commands: [],
			sessionId: "session-1",
			ctxRef: { current: {} },
			sessionManager: { saveSession: vi.fn() },
			costTracker: { getSessionSummary: vi.fn(() => "summary") },
			onExit: vi.fn(),
			exit: vi.fn(),
			selectionStart: null,
			setSelectionStart: vi.fn(),
			selectionEnd: null,
			setSelectionEnd: vi.fn(),
			loading: false,
			scrollPageUp: vi.fn(),
			scrollPageDown: vi.fn(),
			scrollLineUp: vi.fn(),
			scrollLineDown: vi.fn(),
			scrollToTop: vi.fn(),
			scrollToBottom: vi.fn(),
			resetConversation: vi.fn(),
			send: vi.fn(),
			saveHistory: vi.fn(),
		};
	});

	it("should register input callback using useInput", () => {
		const { unmount } = render(React.createElement(HookWrapper, { props }));
		expect(useInput).toHaveBeenCalled();
		unmount();
	});

	it("should trigger command palette when typing '/' as the first character", () => {
		props.input = "";
		props.cursorPos = 0;
		const { unmount } = render(React.createElement(HookWrapper, { props }));

		triggerInput("/", { ctrl: false, meta: false });
		expect(props.setShowCommandPalette).toHaveBeenCalledWith(true);
		expect(props.setInput).not.toHaveBeenCalled();
		unmount();
	});

	it("should NOT trigger command palette when typing '/' as a non-first character", () => {
		props.input = "hello";
		props.cursorPos = 5;
		const { unmount } = render(React.createElement(HookWrapper, { props }));

		triggerInput("/", { ctrl: false, meta: false });
		expect(props.setShowCommandPalette).not.toHaveBeenCalled();
		expect(props.setInput).toHaveBeenCalled();
		const lastCall = (props.setInput as any).mock.calls.at(-1);
		const updater = lastCall[0];
		expect(typeof updater).toBe("string");
		expect(updater).toBe("hello/");
		unmount();
	});

	it("should handle selection using Shift+LeftArrow", () => {
		props.cursorPos = 5;
		const { unmount } = render(React.createElement(HookWrapper, { props }));

		triggerInput("", { shift: true, leftArrow: true });
		expect(props.setSelectionStart).toHaveBeenCalledWith(5);
		expect(props.setSelectionEnd).toHaveBeenCalledWith(4);
		expect(props.setCursorPos).toHaveBeenCalledWith(4);
		unmount();
	});

	it("should handle selection using Shift+RightArrow", () => {
		props.cursorPos = 5;
		const { unmount } = render(React.createElement(HookWrapper, { props }));

		triggerInput("", { shift: true, rightArrow: true });
		expect(props.setSelectionStart).toHaveBeenCalledWith(5);
		expect(props.setSelectionEnd).toHaveBeenCalledWith(6);
		expect(props.setCursorPos).toHaveBeenCalledWith(6);
		unmount();
	});

	it("should clear selection on Arrow keys without Shift", () => {
		props.selectionStart = 2;
		props.selectionEnd = 5;
		const { unmount } = render(React.createElement(HookWrapper, { props }));

		triggerInput("", { shift: false, leftArrow: true });
		expect(props.setSelectionStart).toHaveBeenCalledWith(null);
		expect(props.setSelectionEnd).toHaveBeenCalledWith(null);
		unmount();
	});

	it("should handle forward delete via key.delete", () => {
		props.input = "hello";
		props.cursorPos = 2;
		const { unmount } = render(React.createElement(HookWrapper, { props }));

		triggerInput("\x1b[3~", { delete: true });
		expect(props.setInput).toHaveBeenCalled();
		const setInputCall = (props.setInput as any).mock.calls[0][0];
		expect(typeof setInputCall).toBe("string");
		expect(setInputCall).toBe("helo");
		unmount();
	});

	it("should handle word deletion via Ctrl+W", () => {
		props.input = "hello world";
		props.cursorPos = 11;
		const { unmount } = render(React.createElement(HookWrapper, { props }));

		triggerInput("w", { ctrl: true });
		expect(props.setInput).toHaveBeenCalledWith("hello ");
		expect(props.setCursorPos).toHaveBeenCalledWith(6);
		unmount();
	});

	it("should trigger scrollToTop on Shift+Home instead of text selection", () => {
		const { unmount } = render(React.createElement(HookWrapper, { props }));

		triggerInput("", { shift: true, home: true });
		expect(props.scrollToTop).toHaveBeenCalled();
		expect(props.setSelectionStart).not.toHaveBeenCalled();
		unmount();
	});

	it("should trigger scrollToBottom on Shift+End instead of text selection", () => {
		const { unmount } = render(React.createElement(HookWrapper, { props }));

		triggerInput("", { shift: true, end: true });
		expect(props.scrollToBottom).toHaveBeenCalled();
		expect(props.setSelectionStart).not.toHaveBeenCalled();
		unmount();
	});

	it("should navigate history on Shift+UpArrow instead of selection or vertical cursor movement", () => {
		const { unmount } = render(React.createElement(HookWrapper, { props }));

		triggerInput("", { shift: true, upArrow: true });
		expect(props.setInput).toHaveBeenCalledWith("history-1");
		expect(props.setHistoryIndex).toHaveBeenCalledWith(0);
		expect(props.setSelectionStart).not.toHaveBeenCalled();
		unmount();
	});

	it("should handle Ctrl+C selection copy using console.log of OSC 52 sequence", () => {
		props.selectionStart = 0;
		props.selectionEnd = 5;
		const { unmount } = render(React.createElement(HookWrapper, { props }));

		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		triggerInput("c", { ctrl: true });

		expect(consoleSpy).toHaveBeenCalled();
		const logArg = consoleSpy.mock.calls[0][0];
		expect(logArg).toContain("\x1B]52;;");
		expect(logArg).toContain(Buffer.from("hello").toString("base64"));

		expect(props.setSelectionStart).toHaveBeenCalledWith(null);
		expect(props.setSelectionEnd).toHaveBeenCalledWith(null);
		consoleSpy.mockRestore();
		unmount();
	});

	it("should await session save before exiting on Ctrl+D with empty input", async () => {
		props.input = "";
		props.cursorPos = 0;
		let resolveSave: () => void = () => {};
		props.sessionManager.saveSession = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					resolveSave = resolve;
				}),
		);
		const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const { unmount } = render(React.createElement(HookWrapper, { props }));

		triggerInput("d", { ctrl: true });
		await Promise.resolve();

		expect(props.sessionManager.saveSession).toHaveBeenCalledWith(
			"session-1",
			props.ctxRef.current,
		);
		expect(props.exit).not.toHaveBeenCalled();

		resolveSave();
		await Promise.resolve();
		await Promise.resolve();

		expect(props.exit).toHaveBeenCalled();
		consoleSpy.mockRestore();
		unmount();
	});
});
