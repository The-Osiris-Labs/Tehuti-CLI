import { render } from "ink-testing-library";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const inkState = vi.hoisted(() => ({ inputHandler: undefined as any }));
const configState = vi.hoisted(() => ({ recentCommands: undefined as unknown }));

vi.mock("ink", async () => {
	const actual = await vi.importActual<typeof import("ink")>("ink");
	return {
		...actual,
		useInput: vi.fn((handler) => {
			inkState.inputHandler = handler;
		}),
		useStdout: () => ({ stdout: undefined }),
	};
});

vi.mock("@ink-tools/ink-mouse", () => ({
	useOnClick: () => {},
	useOnMouseEnter: () => {},
	useOnMouseLeave: () => {},
}));

vi.mock("../../../config/index.js", () => ({
	globalConfig: {
		get: vi.fn(() => configState.recentCommands),
		set: vi.fn((_key: string, value: unknown) => {
			configState.recentCommands = value;
		}),
	},
}));

import {
	CommandPalette,
	createCommands,
	formatHelpOutput,
	type CommandItem,
} from "./CommandPalette.js";
import {
	addRecentCommand,
	getRecentCommands,
} from "../commandPaletteRecent.js";

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function command(
	id: string,
	category: CommandItem["category"] = "session",
): CommandItem {
	return { id, label: id, description: `${id} description`, category };
}

function triggerInput(input: string, key: Record<string, boolean> = {}): void {
	inkState.inputHandler(input, key);
}

function paletteProps(
	commands: CommandItem[],
	overrides: Partial<React.ComponentProps<typeof CommandPalette>> = {},
) {
	return {
		commands,
		onSelect: vi.fn(),
		onClose: vi.fn(),
		visible: true,
		initialQuery: "",
		onQueryChange: vi.fn(),
		...overrides,
	};
}

describe("CommandPalette helpers", () => {
	beforeEach(() => {
		inkState.inputHandler = undefined;
		configState.recentCommands = undefined;
		vi.clearAllMocks();
	});

	it("includes the real provider commands in the shared command list", () => {
		const commands = createCommands({
			onCost: () => {},
			onModel: () => {},
			onClear: () => {},
			onExit: () => {},
			onHelp: () => {},
			onSessions: () => {},
			onModels: () => {},
			onProviders: () => {},
		});

		expect(commands.some((item) => item.id === "/provider")).toBe(true);
		expect(commands.find((item) => item.id === "/help")?.shortcut).toBeUndefined();
	});

	it("passes the full saved session id from the load submenu", async () => {
		const onLoad = vi.fn();
		const fullId = "12345678-1234-4234-8234-123456789abc";
		const commands = createCommands({
			onCost: () => {},
			onModel: () => {},
			onClear: () => {},
			onExit: () => {},
			onHelp: () => {},
			onSessions: () => {},
			onModels: () => {},
			onProviders: () => {},
			onLoad,
			getSavedSessions: async () => [
				{ id: fullId, name: "Important Session", date: "today" },
			],
		});

		const loadCommand = commands.find((item) => item.id === "/load");
		const children = await loadCommand?.submenu?.();
		await children?.[0]?.action?.();

		expect(onLoad).toHaveBeenCalledWith(fullId);
	});

	it("documents only the shortcuts that the input loop actually supports", () => {
		const help = formatHelpOutput();
		expect(help).toContain("/provider");
		expect(help).toContain("▶ /");
		expect(help).toContain("Open palette");
		expect(help).not.toContain("Copy selected");
		expect(help).not.toContain("Paste");
		expect(help).not.toContain("Swap characters");
	});

	it("produces structured help with section headers", () => {
		const help = formatHelpOutput();
		expect(help).toContain("TEHUTI");
		expect(help).toContain("SESSION");
		expect(help).toContain("KEYBOARD SHORTCUTS");
		expect(help).toContain("/");
		expect(help).toContain("/help");
	});
});


describe("CommandPalette interaction", () => {
	beforeEach(() => {
		inkState.inputHandler = undefined;
		configState.recentCommands = undefined;
		vi.clearAllMocks();
	});

	it("navigates with j and ArrowDown only while the search query is empty", async () => {
		const props = paletteProps([command("alpha"), command("beta"), command("gamma")]);
		const view = render(React.createElement(CommandPalette, props));

		triggerInput("j");
		await flush();
		triggerInput("\n", { return: true });
		expect(props.onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "beta" }));

		props.onSelect.mockClear();
		view.rerender(
			React.createElement(CommandPalette, { ...props, initialQuery: "a" }),
		);
		await flush();
		triggerInput("", { downArrow: true });
		triggerInput("j");
		triggerInput("\n", { return: true });
		expect(props.onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "alpha" }));
	});

	it("filters from its controlled query, resets selection, and selects the visible item on Enter", async () => {
		const props = paletteProps([command("alpha"), command("beta"), command("bravo")]);
		const view = render(React.createElement(CommandPalette, props));

		triggerInput("", { downArrow: true });
		await flush();
		view.rerender(
			React.createElement(CommandPalette, { ...props, initialQuery: "brav" }),
		);
		await flush();
		expect(view.lastFrame()).toContain("bravo");
		expect(view.lastFrame()).not.toContain("alpha");

		triggerInput("\n", { return: true });
		expect(props.onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "bravo" }));

		props.onSelect.mockClear();
		view.rerender(
			React.createElement(CommandPalette, { ...props, initialQuery: "" }),
		);
		await flush();
		triggerInput("\n", { return: true });
		expect(props.onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "alpha" }));
	});

	it("returns from a submenu before closing for Escape and empty-query Backspace", async () => {
		const children = [command("child", "submenu")];
		const parent: CommandItem = {
			...command("parent"),
			label: "Parent",
			submenu: () => children,
		};
		const props = paletteProps([parent]);
		const view = render(React.createElement(CommandPalette, props));

		triggerInput("\n", { return: true });
		await flush();
		expect(view.lastFrame()).toContain("Palette > Parent");

		triggerInput("", { escape: true });
		await flush();
		expect(view.lastFrame()).toContain("COMMAND PALETTE");
		expect(props.onClose).not.toHaveBeenCalled();

		triggerInput("\n", { return: true });
		await flush();
		triggerInput("", { backspace: true });
		await flush();
		expect(view.lastFrame()).toContain("COMMAND PALETTE");
		expect(props.onClose).not.toHaveBeenCalled();

		triggerInput("", { escape: true });
		expect(props.onClose).toHaveBeenCalledTimes(1);
	});

	it("groups the complete result set before applying its nine-command window", async () => {
		const commands = [
			command("session-0", "session"),
			command("model-in-the-middle", "model"),
			...Array.from({ length: 10 }, (_, index) =>
				command(`session-${index + 1}`, "session"),
			),
		];
		const view = render(React.createElement(CommandPalette, paletteProps(commands)));
		await flush();

		expect(view.lastFrame()).toContain("── SESSION");
		expect(view.lastFrame()).not.toContain("model-in-the-middle");
		expect(view.lastFrame()).not.toContain("── MODEL");

		for (let index = 0; index < 12; index++) {
			triggerInput("", { downArrow: true });
			await flush();
		}
		expect(view.lastFrame()).toContain("model-in-the-middle");
		expect(view.lastFrame()).toContain("── MODEL");
		expect(view.lastFrame()).toContain("showing 4-12 of 12");
	});

	it("windows a command list larger than one hundred without losing the selected tail item", async () => {
		const commands = Array.from({ length: 105 }, (_, index) =>
			command(`item-${String(index).padStart(3, "0")}`),
		);
		const view = render(React.createElement(CommandPalette, paletteProps(commands)));
		await flush();

		expect(view.lastFrame()).toContain("item-000");
		expect(view.lastFrame()).not.toContain("item-009");

		for (let index = 0; index < 105; index++) {
			triggerInput("", { downArrow: true });
			await flush();
		}
		expect(view.lastFrame()).toContain("item-104");
		expect(view.lastFrame()).toContain("showing 97-105 of 105");
	});

	it("bounds durable recent commands at ten and ignores malformed stored data", () => {
		configState.recentCommands = ["ok", 2, "ok", "  ", "also"];
		expect(getRecentCommands()).toEqual(["ok", "also"]);

		for (let index = 0; index < 12; index++) {
			addRecentCommand(`command-${index}`);
		}
		addRecentCommand("command-5");

		expect(getRecentCommands()).toEqual([
			"command-5",
			"command-11",
			"command-10",
			"command-9",
			"command-8",
			"command-7",
			"command-6",
			"command-4",
			"command-3",
			"command-2",
		]);
	});
});
