export function formatForDiscord(markdown: string): string[] {
	const MAX_LEN = 2000;
	if (markdown.length <= MAX_LEN) {
		return [markdown];
	}

	const chunks: string[] = [];
	let remaining = markdown;
	let inCodeBlock = false;
	let codeLanguage = "";

	while (remaining.length > 0) {
		let prefix = "";
		if (inCodeBlock) {
			prefix = `\`\`\`${codeLanguage}\n`;
		}

		const maxTake = MAX_LEN - prefix.length - 4; // reserve 4 chars for "\n```"

		if (prefix.length + remaining.length <= MAX_LEN) {
			chunks.push(prefix + remaining);
			break;
		}

		let splitIndex = remaining.lastIndexOf("\n", maxTake);
		if (splitIndex === -1 || splitIndex === 0) {
			splitIndex = maxTake;
		}

		let chunkContent = remaining.substring(0, splitIndex);
		
		// Count ``` in chunkContent
		const codeBlockMatches = [...chunkContent.matchAll(/```([a-zA-Z0-9-]*)/g)];
		for (const match of codeBlockMatches) {
			inCodeBlock = !inCodeBlock;
			if (inCodeBlock) {
				codeLanguage = match[1] || "";
			} else {
				codeLanguage = "";
			}
		}

		let chunk = prefix + chunkContent;
		if (inCodeBlock) {
			// Check if chunk doesn't already end with a newline
			if (!chunk.endsWith("\n")) chunk += "\n";
			chunk += "```";
		}
		chunks.push(chunk);
        remaining = remaining.substring(splitIndex);
        if (remaining.startsWith("\n")) remaining = remaining.substring(1);
	}

	return chunks;
}

const longText = "a".repeat(1990) + "\n```js\nconsole.log('hello');\n" + "b".repeat(50) + "\n```";
console.log(formatForDiscord(longText));
