const fs = require('fs');

// 1. Fix chat.ts width cap
let chatTs = fs.readFileSync('src/cli/commands/chat.ts', 'utf8');
chatTs = chatTs.replace(
  'const contentMaxWidth = Math.min(terminalWidth - 4, 120);',
  'const contentMaxWidth = Math.max(40, terminalWidth - 4);'
);
fs.writeFileSync('src/cli/commands/chat.ts', chatTs);
console.log('Patched chat.ts width cap');

// 2. Fix CommandPalette.tsx width and input
let cpTsx = fs.readFileSync('src/cli/ui/components/CommandPalette.tsx', 'utf8');

// Remove import InkTextInput
cpTsx = cpTsx.replace('import InkTextInput from "ink-text-input";\n', '');

// Update useInput
const oldUseInput = `			if (key.backspace || key.delete) {
				if (query.length === 0 && menuStack.length > 0) {
					// Pop stack on backspace if query is empty
					setMenuStack((prev) => prev.slice(0, -1));
					setError(null);
					return;
				}
			}`;

const newUseInput = `			if (key.backspace || key.delete) {
				if (query.length === 0 && menuStack.length > 0) {
					// Pop stack on backspace if query is empty
					setMenuStack((prev) => prev.slice(0, -1));
					setError(null);
					return;
				}
				if (query.length > 0) {
					setQuery((prev) => prev.slice(0, -1));
					return;
				}
			}

			// Handle normal character input
			if (
				char &&
				!key.ctrl &&
				!key.meta &&
				!char.startsWith("\\x1b") &&
				char !== "\\r" &&
				char !== "\\n" &&
				char !== "\\t"
			) {
				if (
					isMouseSequence(char) ||
					char === "[" ||
					char === "<" ||
					char === "[[ " ||
					/^(?:\\d+;)+\\d+[Mm]?$/.test(char) ||
					/(?:\\d+;\\d+(?:;\\d+)?[Mm])+/.test(char) ||
					char.includes("[<") ||
					char.includes("[M")
				) {
					return;
				}
				setQuery((prev) => prev + char);
			}`;
cpTsx = cpTsx.replace(oldUseInput, newUseInput);

// Replace InkTextInput rendering
const oldRender = `				: React.createElement(InkTextInput, {
						value: query,
						onChange: (val: string) => {
							const cleanVal = val.replace(/\\[<\\d+;\\d+;\\d+[Mm]/g, "");
							if (query === "" && (cleanVal === "j" || cleanVal === "k")) {
								return;
							}
							setQuery(cleanVal);
						},
						placeholder:
							menuStack.length > 0 ? "filter options..." : "type a command...",
						focus: visible,
					}),`;
const newRender = `				: React.createElement(
						Text,
						null,
						query.length === 0
							? React.createElement(Text, { color: "gray" }, menuStack.length > 0 ? "filter options..." : "type a command...")
							: React.createElement(Text, { color: "cyan" }, query),
						React.createElement(Text, { backgroundColor: "white", color: "black" }, " ")
					),`;
cpTsx = cpTsx.replace(oldRender, newRender);

// Change paletteWidth
cpTsx = cpTsx.replace(
  'const paletteWidth = Math.max(40, terminalWidth - 6);',
  'const paletteWidth = "100%";'
);
fs.writeFileSync('src/cli/ui/components/CommandPalette.tsx', cpTsx);
console.log('Patched CommandPalette.tsx');

// 3. Fix ConfigEditor width cap
let configEditorTsx = fs.readFileSync('src/cli/ui/components/ConfigEditor.tsx', 'utf8');
configEditorTsx = configEditorTsx.replace(
  'const editorWidth = Math.max(40, Math.min(100, terminalWidth - 4));',
  'const editorWidth = "100%";'
);
fs.writeFileSync('src/cli/ui/components/ConfigEditor.tsx', configEditorTsx);
console.log('Patched ConfigEditor.tsx');
