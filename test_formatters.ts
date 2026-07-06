import { formatForSlack, formatForDiscord, formatForTelegram, formatForWhatsApp } from "./src/messaging/formatters.js";

console.log("=== SLACK ===");
console.log(formatForSlack("Hello **bold** *italic*"));

console.log("=== DISCORD ===");
const longText = "a".repeat(1990) + "\n```js\nconsole.log('hello');\n" + "b".repeat(50) + "\n```";
const discordChunks = formatForDiscord(longText);
console.log("Discord chunks:", discordChunks.length);
console.log("Chunk 1 ends with:", discordChunks[0].slice(-20));
console.log("Chunk 2 starts with:", discordChunks[1].slice(0, 20));

console.log("=== TELEGRAM ===");
console.log(formatForTelegram("Hello <world> & **bold _italic_**"));

console.log("=== WHATSAPP ===");
console.log(formatForWhatsApp("Hello **bold** and *italic* and _italic2_"));
