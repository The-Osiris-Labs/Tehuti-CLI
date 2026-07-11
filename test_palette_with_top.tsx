import React, { useState } from "react";
import { render, Box, Text } from "ink";
import { CommandPalette, createCommands } from "./src/cli/ui/components/CommandPalette.js";

const BrokenCommandPalette = (props: any) => {
	// Let's inject top={0} by modifying the source or just passing it if it accepts it.
	// We can't easily without editing the file.
	return <CommandPalette {...props} />;
};

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
			<BrokenCommandPalette
				commands={commands}
				onSelect={() => {}}
				onClose={() => {}}
				visible={true}
			/>
		</Box>
	);
};

render(<TestApp />);
