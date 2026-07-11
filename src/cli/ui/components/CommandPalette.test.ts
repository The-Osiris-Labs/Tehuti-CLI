import { describe, expect, it, vi } from "vitest";
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
		expect(
			commands.find((command) => command.id === "/help")?.shortcut,
		).toBeUndefined();
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

		const loadCommand = commands.find((command) => command.id === "/load");
		const children = await loadCommand?.submenu?.();
		await children?.[0]?.action?.();

		expect(onLoad).toHaveBeenCalledWith(fullId);
	});

	it("documents only the shortcuts that the input loop actually supports", () => {
		const help = formatHelpOutput();
		expect(help).toContain("/provider");
		expect(help).toContain("`/` | Open palette");
		expect(help).not.toContain("Copy selected");
		expect(help).not.toContain("Paste");
		expect(help).not.toContain("Swap characters");
	});
});

describe("CommandPalette Selection State", () => {
	it("should verify selection index behavior on query change", () => {
		const commands = [
			{
				id: "cmd1",
				label: "Clear",
				description: "Clear chat",
				category: "session" as const,
			},
			{
				id: "cmd2",
				label: "Cost",
				description: "Show cost",
				category: "session" as const,
			},
			{
				id: "cmd3",
				label: "Help",
				description: "Show help",
				category: "help" as const,
			},
		];

		// Mock implementation to test selection index logic
		let query = "";
		const selectedIndex = 2; // user has scrolled to the 3rd command

		// Simulate user typing a filter "Cl"
		query = "Cl";
		const filtered = commands.filter((c) =>
			c.label.toLowerCase().includes(query.toLowerCase()),
		);

		// In the render pass, filtered has length 1.
		// However, selectedIndex is still 2 because useEffect hasn't run yet!
		expect(filtered.length).toBe(1);

		// If user presses Enter here, it falls back:
		const selectedBeforeEffect = filtered[selectedIndex] || filtered[0];
		expect(selectedBeforeEffect.id).toBe("cmd1"); // falls back to index 0, which is safe but ignores selection index

		// What if filtered has 3 elements, but we type "C" which matches both Clear and Cost?
		query = "C";
		const filtered2 = commands.filter((c) =>
			c.label.toLowerCase().includes(query.toLowerCase()),
		);
		expect(filtered2.length).toBe(2);

		// selectedIndex is still 2. Since filtered2 has length 2, filtered2[selectedIndex] (filtered2[2]) is undefined.
		// So it falls back to filtered2[0] ("cmd1").
		const selectedFallback = filtered2[selectedIndex] || filtered2[0];
		expect(selectedFallback.id).toBe("cmd1");
	});
});
