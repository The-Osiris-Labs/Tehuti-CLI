import React, { useState } from 'react';
import { render, Box, Text } from 'ink';

const App = () => {
    const orderedGroups = [
        ["core", [ { id: "test", label: "test cmd", description: "test desc" } ]]
    ];
    return (
        <Box flexDirection="column" width="100%" borderStyle="single">
            <Box paddingX={1} borderBottom={true} borderBottomStyle="single">
                <Text>Input area</Text>
            </Box>
            <Box flexDirection="column">
                {orderedGroups.flatMap(([cat, cmds]) => [
                    <Text key={cat}>{cat}</Text>,
                    ...(cmds as any[]).map(c => <Text key={c.id}>{c.label}</Text>)
                ])}
            </Box>
        </Box>
    );
};

const instance = render(<App />);
setTimeout(() => {
    instance.unmount();
    process.exit(0);
}, 500);
