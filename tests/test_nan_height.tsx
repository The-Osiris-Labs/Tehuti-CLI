import React from 'react';
import { render, Box, Text } from 'ink';

const App = () => {
    return (
        <Box flexDirection="column" borderStyle="single">
            <Text>Top</Text>
            <Box height={NaN} borderStyle="double">
                <Text>Inside NaN Box</Text>
            </Box>
            <Text>Bottom</Text>
        </Box>
    );
};

const instance = render(<App />);
setTimeout(() => {
    instance.unmount();
    process.exit(0);
}, 500);
