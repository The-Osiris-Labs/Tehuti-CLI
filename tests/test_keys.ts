import { createCommands } from '../src/cli/ui/components/CommandPalette.js';
const commands = createCommands({
    onCost: () => {},
    onModel: () => {},
    onClear: () => {},
    onExit: () => {},
    onHelp: () => {},
    onSessions: () => {},
    onModels: () => {},
    onSave: () => {},
    onLoad: () => {},
    onProvider: () => {},
    onProviders: () => {},
    onCompact: () => {},
    onStats: () => {},
    onExport: () => {},
});

const groupedDisplayCommands = {
    submenu: commands.filter((c) => c.category === "submenu"),
    recent: commands.filter((c) => c.category === "recent"),
    session: commands.filter((c) => c.category === "session"),
    model: commands.filter((c) => c.category === "model"),
    help: commands.filter((c) => c.category === "help"),
};

const orderedGroups = [
    ["submenu", groupedDisplayCommands.submenu],
    ["recent", groupedDisplayCommands.recent],
    ["session", groupedDisplayCommands.session],
    ["model", groupedDisplayCommands.model],
    ["help", groupedDisplayCommands.help],
].filter(([, cmds]) => (cmds as any[]).length > 0) as Array<[string, any[]]>;

const keys = [];
orderedGroups.flatMap(([category, cmds], groupIndex) => [
    keys.push(`cat-${groupIndex}-${category}`),
    ...cmds.map((cmd) => {
        const cmdIndex = commands.findIndex((c) => c.id === cmd.id);
        const key = `cmd-${category}-${cmdIndex}-${cmd.id}`;
        keys.push(key);
    }),
]);

const seen = new Set();
keys.forEach(k => {
    if (seen.has(k)) console.log(`DUPLICATE KEY: ${k}`);
    seen.add(k);
});
console.log(`Total keys: ${keys.length}`);
