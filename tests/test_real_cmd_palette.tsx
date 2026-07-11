import React, { useState } from 'react';
import { render, Box, Text } from 'ink';

const App = () => {
    const isLoading = false;
    const filteredCommands = [{ id: "foo", label: "foo cmd", category: "core", description: "foo desc" }];
    const orderedGroups = [["core", filteredCommands]];
    const DECORATIVE = { eye: "E" };
    return (
        <Box flexDirection="column" width="100%" borderStyle="single" borderColor="yellow" backgroundColor="black">
            <Box paddingX={1} borderBottom={true} borderBottomColor="yellow" borderBottomStyle="single">
                <Text color="gray">{"> "}</Text>
                <Text color="gray">type a command...</Text>
            </Box>
            {!isLoading && filteredCommands.length === 0
				? React.createElement(
						Box,
						{ paddingY: 1, flexDirection: "column" },
						React.createElement(
							Text,
							{ dimColor: true, color: "red" },
							`${DECORATIVE.eye} No match found.`,
						),
					)
				: !isLoading &&
						React.createElement(
							Box,
							{ flexDirection: "column" },
							...orderedGroups.flatMap(([category, cmds], groupIndex) => [
								React.createElement(
									Text,
									{
										key: `cat-${groupIndex}-${category}`,
										color: "gray",
										dimColor: true,
									},
									`  ${category.toUpperCase()}  `,
								),
								...(cmds as any[]).map((cmd, cmdIndex) => {
									return React.createElement(Text, { key: cmd.id }, cmd.label);
								}),
							]),
						)}
        </Box>
    );
};

const instance = render(<App />);
setTimeout(() => {
    instance.unmount();
    process.exit(0);
}, 500);
