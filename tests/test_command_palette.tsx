import React, { useEffect, useState } from 'react';
import { render } from 'ink';
import { CommandPalette } from '../src/cli/ui/components/CommandPalette.js';
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

const App = () => {
    return <CommandPalette
        visible={true}
        commands={commands}
        onSelect={() => process.exit(0)}
        onClose={() => process.exit(0)}
        initialQuery=""
    />;
};

const instance = render(<App />);
setTimeout(() => {
    instance.unmount();
    process.exit(0);
}, 1000);
