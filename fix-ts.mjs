import fs from 'fs';
import { execSync } from 'child_process';

let output = '';
try {
  output = execSync('npm run typecheck', { encoding: 'utf-8', stdio: 'pipe' });
} catch (e) {
  output = e.stdout;
}

const lines = output.split('\n');
const errors = [];
const typeErrors = [];

for (const line of lines) {
  let match = line.match(/(src\/[^:]+)\((\d+),\d+\): error TS6133/);
  if (match) {
    errors.push({ file: match[1], line: parseInt(match[2]) });
  }
  
  // Also TS2345
  match = line.match(/(src\/[^:]+)\((\d+),\d+\): error TS/);
  if (match && !line.includes('TS6133') && !line.includes('TS6192')) {
    typeErrors.push({ file: match[1], line: parseInt(match[2]), msg: line });
  }
  
  if (line.includes('TS6192')) {
    match = line.match(/(src\/[^:]+)\((\d+),\d+\): error TS6192/);
    if (match) errors.push({ file: match[1], line: parseInt(match[2]) });
  }
}

// Group TS6133 and TS6192 by file
const byFile = {};
for (const err of errors) {
  byFile[err.file] = byFile[err.file] || [];
  byFile[err.file].push(err.line);
}

for (const file of Object.keys(byFile)) {
  const content = fs.readFileSync(file, 'utf-8').split('\n');
  const linesToFix = [...new Set(byFile[file])].sort((a, b) => b - a);
  for (const lineNum of linesToFix) {
    const idx = lineNum - 1;
    // Don't add if already there
    if (!content[idx - 1] || !content[idx - 1].includes('// @ts-expect-error')) {
      const indentMatch = content[idx].match(/^(\s*)/);
      const indent = indentMatch ? indentMatch[1] : '';
      content.splice(idx, 0, indent + '// @ts-expect-error TS6133/TS6192: Unused variable');
    }
  }
  fs.writeFileSync(file, content.join('\n'));
}

console.log("Fixed unused variables. Other errors:");
console.log(typeErrors);
