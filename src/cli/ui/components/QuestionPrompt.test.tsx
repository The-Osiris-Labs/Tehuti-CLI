import { render } from "ink-testing-library";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const inkState = vi.hoisted(() => ({ inputHandler: undefined as any }));

vi.mock("ink", async () => {
	const actual = await vi.importActual<typeof import("ink")>("ink");
	return {
		...actual,
		useInput: vi.fn((handler) => {
			inkState.inputHandler = handler;
		}),
	};
});

import { QuestionPrompt } from "./QuestionPrompt.js";

function trigger(input: string, key: Record<string, boolean> = {}): void {
	inkState.inputHandler(input, key);
}

describe("QuestionPrompt filtered options", () => {
	beforeEach(() => {
		inkState.inputHandler = undefined;
		vi.clearAllMocks();
	});

	it("submits the visible matching option rather than its old source-array index", async () => {
		const onAnswer = vi.fn();
		const view = render(
			React.createElement(QuestionPrompt, {
				question: {
					header: "Pick target",
					question: "Where?",
					multiple: false,
					options: [{ label: "Alpha" }, { label: "Beta" }, { label: "Gamma" }],
				},
				onAnswer,
				onCancel: vi.fn(),
			}),
		);

		trigger("g");
		await new Promise<void>((resolve) => setImmediate(resolve));
		trigger("\n", { return: true });

		expect(view.lastFrame()).toContain("Gamma");
		expect(onAnswer).toHaveBeenCalledWith("Gamma");
	});

	it("does not submit an invisible option when the filter has no matches", async () => {
		const onAnswer = vi.fn();
		render(
			React.createElement(QuestionPrompt, {
				question: {
					header: "Pick target",
					question: "Where?",
					multiple: false,
					options: [{ label: "Alpha" }],
				},
				onAnswer,
				onCancel: vi.fn(),
			}),
		);

		trigger("z");
		await new Promise<void>((resolve) => setImmediate(resolve));
		trigger("\n", { return: true });

		expect(onAnswer).not.toHaveBeenCalled();
	});
});
