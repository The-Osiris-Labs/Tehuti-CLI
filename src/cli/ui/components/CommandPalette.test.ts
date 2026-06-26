import { describe, expect, it } from "vitest";
import { createCommands, formatHelpOutput } from "./CommandPalette.js";

describe("CommandPalette helpers", () => {
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

		expect(commands.some((command) => command.id === "/provider")).toBe(true);
		expect(commands.some((command) => command.id === "/providers")).toBe(true);
		expect(commands.find((command) => command.id === "/help")?.shortcut).toBeUndefined();
	});

	it("documents only the shortcuts that the input loop actually supports", () => {
		const help = formatHelpOutput();

		expect(help).toContain("/provider [name]");
		expect(help).toContain("/providers");
		expect(help).toContain("Tab   Complete slash command");
		expect(help).not.toContain("Copy selected");
		expect(help).not.toContain("Paste");
		expect(help).not.toContain("Swap characters");
	});
});
