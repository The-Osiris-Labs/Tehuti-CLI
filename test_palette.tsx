import React, { useState } from "react";
import { render, Box, Text } from "ink";
import { CommandPalette, createCommands } from "./src/cli/ui/components/CommandPalette.js";

const TestApp = () => {
	const commands = createCommands({
		onCost: () => {},
		onModel: () => {},
		onClear: () => {},
		onExit: () => {},
		onHelp: () => {},
		onSessions: () => {},
		onModels: () => {},
	});

	return (
		<Box width={100} height={30} borderStyle="single">
			<CommandPalette
				commands={commands}
				onSelect={() => {}}
				onClose={() => {}}
				visible={true}
			/>
		</Box>
	);
};

render(<TestApp />);
