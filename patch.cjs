const fs = require('fs');

// 1. Update markdown-mapper.tsx
let mmTsx = fs.readFileSync('src/cli/ui/markdown-mapper.tsx', 'utf8');

mmTsx = mmTsx.replace(
  'const codeWidth = maxWidth ? Math.min(maxWidth - 4, 100) : 100;',
  'const codeWidth = maxWidth ? Math.max(10, maxWidth - 4) : 100;'
);

mmTsx = mmTsx.replace(
  'const underlineLength = maxWidth ? Math.min(maxWidth - 4, 80) : 80;',
  'const underlineLength = maxWidth ? Math.max(10, maxWidth - 4) : 80;'
);

mmTsx = mmTsx.replace(
  'const lineLen = maxWidth ? Math.min(maxWidth - 4, 50) : 50;',
  'const lineLen = maxWidth ? Math.max(10, maxWidth - 4) : 50;'
);

fs.writeFileSync('src/cli/ui/markdown-mapper.tsx', mmTsx);
console.log('Patched markdown-mapper.tsx');

// 2. Update ConfigEditor.tsx
let ceTsx = fs.readFileSync('src/cli/ui/components/ConfigEditor.tsx', 'utf8');

// Remove TextInput import
ceTsx = ceTsx.replace('import TextInput from "ink-text-input";\n', '');

// Update TextInput render
const oldRender = `					<Box borderStyle="single" borderColor={CORAL} paddingX={1}>
						<TextInput
							value={editValue}
							onChange={(val: string) => {
								const cleanVal = val.replace(/\\[<\\d+;\\d+;\\d+[Mm]/g, "");
								onEditValueChange(cleanVal);
							}}
							onSubmit={onEditCommit}
							focus={isEditing}
						/>
					</Box>`;
const newRender = `					<Box borderStyle="single" borderColor={CORAL} paddingX={1}>
						{isEditing ? (
							<Text>
								{editValue.length === 0 ? (
									<Text color="gray">type a value...</Text>
								) : (
									<Text color={CORAL}>{editValue}</Text>
								)}
								<Text backgroundColor="white" color="black"> </Text>
							</Text>
						) : null}
					</Box>`;
ceTsx = ceTsx.replace(oldRender, newRender);

// Update useInput to handle typing
const oldUseInput = `			if (key.return) {
				commitFieldEdit();
			} else if (key.escape) {
				setEditingField(null);
				setEditValue("");
				setValidationError(null);
			}
		} else {`;
const newUseInput = `			if (key.return) {
				commitFieldEdit();
			} else if (key.escape) {
				setEditingField(null);
				setEditValue("");
				setValidationError(null);
			} else if (key.backspace || key.delete) {
				if (editValue.length > 0) {
					setEditValue((prev) => prev.slice(0, -1));
				}
			} else if (
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
				setEditValue((prev) => prev + char);
			}
		} else {`;
ceTsx = ceTsx.replace(oldUseInput, newUseInput);

fs.writeFileSync('src/cli/ui/components/ConfigEditor.tsx', ceTsx);
console.log('Patched ConfigEditor.tsx');
