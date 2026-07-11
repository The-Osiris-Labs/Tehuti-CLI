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
const counts = {};
commands.forEach(c => {
    counts[c.id] = (counts[c.id] || 0) + 1;
    if (counts[c.id] > 1) {
        console.log(`DUPLICATE: ${c.id}`);
    }
});
console.log(`Total commands: ${commands.length}`);
