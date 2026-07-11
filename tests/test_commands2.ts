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

console.log("All commands:");
commands.forEach((c, i) => console.log(`  ${i}: [${c.category}] ${c.id}`));
