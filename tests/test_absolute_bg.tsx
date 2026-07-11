import React from 'react';
import { render, Box, Text } from 'ink';

const App = () => {
    return (
        <Box flexDirection="column" width={80} height={20}>
            {/* Background text */}
            {Array.from({ length: 15 }).map((_, i) => (
                <Text key={i}>BACKGROUND TEXT THAT SHOULD BE COVERED BY THE ABSOLUTE BOX</Text>
            ))}

            <Box position="absolute" width={40} height={10} backgroundColor="black" borderStyle="single" borderColor="red">
                <Text color="green">I am an absolute box</Text>
            </Box>
        </Box>
    );
};

const instance = render(<App />);
setTimeout(() => {
    instance.unmount();
    process.exit(0);
}, 500);
