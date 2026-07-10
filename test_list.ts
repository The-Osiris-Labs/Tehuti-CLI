import { renderMarkdownToAnsi } from "./src/terminal/markdown.js";

const md = `
- Item 1
  - Subitem 1
  - Subitem 2
- Item 2
  \`\`\`js
  console.log("code in list");
  \`\`\`
`;

console.log(renderMarkdownToAnsi(md));
