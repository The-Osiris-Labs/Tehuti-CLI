import React from 'react';
import { render } from 'ink';
import { ExpandableToolOutput } from './src/cli/ui/components/ExpandableToolOutput';

const App = () => {
    return (
        <ExpandableToolOutput
            toolName="bash"
            result={{ success: true, output: "(no output)" }}
            expanded={true}
            contentMaxWidth={90}
            terminalWidth={100}
            status="success"
            executionTimeMs={100}
        />
    );
};

render(<App />);
