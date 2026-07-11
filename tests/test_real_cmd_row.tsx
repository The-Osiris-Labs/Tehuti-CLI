import React, { useState, useRef } from 'react';
import { render, Box, Text } from 'ink';

function CommandItemRow({ cmd }: any) {
    const ref = useRef<any>(null);
    return React.createElement(
        Box,
        { ref, flexDirection: "column", paddingX: 1, paddingY: 0 },
        React.createElement(Text, null, cmd.label)
    );
}

const App = () => {
    const filteredCommands = [{ id: "foo", label: "foo cmd", category: "core" }];
    const orderedGroups = [["core", filteredCommands]];
    return (
        <Box flexDirection="column" width="100%" borderStyle="single">
            <Box paddingX={1} borderBottom={true} borderBottomStyle="single">
                <Text color="gray">{"> "}</Text>
                <Text color="gray">type a command...</Text>
            </Box>
            <Box flexDirection="column">
                {orderedGroups.flatMap(([category, cmds], groupIndex) => [
                    <Text key={category}>{category}</Text>,
                    ...(cmds as any[]).map((cmd) => {
                        return React.createElement(CommandItemRow, { key: cmd.id, cmd });
                    }),
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
