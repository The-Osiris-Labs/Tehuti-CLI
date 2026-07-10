import { marked } from "marked";
const tokens = marked.lexer(`
So:
- A
- B
- C
`);
console.log(JSON.stringify(tokens, null, 2));
