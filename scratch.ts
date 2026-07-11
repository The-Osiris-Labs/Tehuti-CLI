import { computeMessageLines } from "./src/terminal/output.js";

const msg = {
    role: "assistant",
    content: [
        { type: "text", content: "Hello" },
        { type: "reasoning", content: "Thinking process details\nsecond line of thoughts" },
    ],
};

console.log(computeMessageLines(msg, 80));
