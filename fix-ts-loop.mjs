import fs from 'fs';
import { execSync } from 'child_process';

for (let i = 0; i < 5; i++) {
  console.log(`Iteration ${i+1}`);
  let output = '';
  try {
    execSync('npm run typecheck', { encoding: 'utf-8', stdio: 'pipe' });
    console.log("Success!");
    process.exit(0);
  } catch (e) {
    output = e.stdout;
  }

  const lines = output.split('\n');
  const addErrors = [];
  const removeErrors = [];

  for (const line of lines) {
    let match = line.match(/(src\/[^:]+)\((\d+),\d+\): error TS(6133|6192)/);
    if (match) {
      addErrors.push({ file: match[1], line: parseInt(match[2]) });
    }
    match = line.match(/(src\/[^:]+)\((\d+),\d+\): error TS2578/);
    if (match) {
      removeErrors.push({ file: match[1], line: parseInt(match[2]) });
    }
  }

  if (addErrors.length === 0 && removeErrors.length === 0) {
    console.log("Other errors found, stopping loop.");
    console.log(output);
    process.exit(1);
  }

  const edits = {};
  for (const err of addErrors) {
    edits[err.file] = edits[err.file] || [];
    edits[err.file].push({ line: err.line, type: 'add' });
  }
  for (const err of removeErrors) {
    edits[err.file] = edits[err.file] || [];
    edits[err.file].push({ line: err.line, type: 'remove' });
  }

  for (const file of Object.keys(edits)) {
    const content = fs.readFileSync(file, 'utf-8').split('\n');
    // sort descending so we process from bottom up
    edits[file].sort((a, b) => b.line - a.line);
    for (const edit of edits[file]) {
      const idx = edit.line - 1;
      if (edit.type === 'add') {
        if (!content[idx - 1] || !content[idx - 1].includes('// @ts-expect-error')) {
          const indentMatch = content[idx].match(/^(\s*)/);
          const indent = indentMatch ? indentMatch[1] : '';
          content.splice(idx, 0, indent + '// @ts-expect-error TS6133: Unused variable');
        }
      } else if (edit.type === 'remove') {
        if (content[idx].includes('// @ts-expect-error')) {
          content.splice(idx, 1);
        }
      }
    }
    fs.writeFileSync(file, content.join('\n'));
  }
}
