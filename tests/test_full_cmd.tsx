import React, { useState } from 'react';
import { render, Box, Text } from 'ink';

function CommandItemRow({ cmd }: any) {
    return (
        <Box flexDirection="column" paddingX={1} paddingY={0}>
            <Text>{cmd.label}</Text>
        </Box>
    );
}

const App = () => {
    const displayCommands = [
        { id: "/update", label: "/update", category: "session" },
        { id: "/model", label: "/model", category: "model" },
        { id: "/help", label: "/help", category: "help" },
    ];
    
    const orderedGroups = [
        ["session", displayCommands.filter((c) => c.category === "session")],
        ["core", displayCommands.filter((c) => c.category === "core")],
        ["mcp", displayCommands.filter((c) => c.category === "mcp")],
        ["git", displayCommands.filter((c) => c.category === "git")],
        ["system", displayCommands.filter((c) => c.category === "system")],
        ["tools", displayCommands.filter((c) => c.category === "tools")],
    ].filter(([, cmds]) => (cmds as any[]).length > 0);

    return (
        <Box flexDirection="column" width="100%" borderStyle="single">
            <Box paddingX={1} borderBottom={true} borderBottomStyle="single">
                <Text color="gray">{"> "}</Text>
                <Text color="gray">type a command...</Text>
            </Box>
            <Box flexDirection="column">
                {...orderedGroups.flatMap(([category, cmds], groupIndex) => [
                    <Text key={`cat-${groupIndex}-${category}`}>  {category.toString().toUpperCase()}  </Text>,
                    ...(cmds as any[]).map((cmd, cmdIndex) => {
                        return React.createElement(CommandItemRow, { key: `cmd-${category}-${cmdIndex}-${cmd.id}`, cmd });
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
