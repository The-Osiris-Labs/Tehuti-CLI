import React from 'react';
import { render, Box, Text } from 'ink';

const App = () => (
  <Box borderStyle="single" borderTop={false} borderRight={false} borderBottom={false} borderLeft={true} borderColor="green" paddingLeft={1}>
    <Text>Hello with left border</Text>
  </Box>
);

render(<App />);
