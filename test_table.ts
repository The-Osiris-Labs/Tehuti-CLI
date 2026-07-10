import { renderMarkdownToAnsi } from "./src/terminal/markdown.ts";

const md = `
| Header 1 | Header 2 |
|----------|----------|
| **Bold** | \`code\` |
| Normal   | *Italic* |
`;

console.log(renderMarkdownToAnsi(md));
