import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it } from "vitest";
import { ChatBar } from "./ChatBar.js";

describe("ChatBar", () => {
	it("renders cursor, selection, multiline position, history, and loading interruption feedback", () => {
		const input = "first\nsecond\nthird";
		const view = render(
			React.createElement(ChatBar, {
				input,
				cursorPos: input.indexOf("second") + 2,
				selectionStart: 0,
				selectionEnd: 5,
				loading: false,
				historyIndex: 1,
				historyLength: 4,
				model: "test-model",
				provider: "test-provider",
			}),
		);

		expect(view.lastFrame()).toContain("Ln 2/3");
		expect(view.lastFrame()).toContain("Col 3");
		expect(view.lastFrame()).toContain("Sel 0-5");
		expect(view.lastFrame()).toContain("[2/4]");

		view.rerender(
			React.createElement(ChatBar, {
				input,
				cursorPos: input.length,
				selectionStart: null,
				selectionEnd: null,
				loading: true,
				historyIndex: -1,
				historyLength: 4,
				model: "test-model",
				provider: "test-provider",
			}),
		);
		expect(view.lastFrame()).toContain("Ctrl+C");
	});

	it("clamps malformed external selection coordinates to the input bounds", () => {
		const view = render(
			React.createElement(ChatBar, {
				input: "safe",
				cursorPos: 99,
				selectionStart: -4,
				selectionEnd: 99,
				loading: false,
				historyIndex: -1,
				historyLength: 0,
				model: "test-model",
				provider: "test-provider",
			}),
		);

		expect(view.lastFrame()).toContain("Sel 0-4");
		expect(view.lastFrame()).not.toContain("Sel -4-99");
	});
});

it("renders searchBar input text correctly", () => {
	const view = render(
		React.createElement(ChatBar, {
			input: "/search test query",
			cursorPos: 18,
			selectionStart: null,
			selectionEnd: null,
			loading: false,
			historyIndex: -1,
			historyLength: 0,
			model: "test-model",
			provider: "test-provider",
		}),
	);
	expect(view.lastFrame()).toContain("/search");
});
