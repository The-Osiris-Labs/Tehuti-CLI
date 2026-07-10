import type { Platform } from "./types.js";

/**
 * Translates standard LLM Markdown into Slack mrkdwn format.
 * - Converts **bold** to *bold*
 * - Converts ~~strikethrough~~ to ~strikethrough~
 * - Converts [text](url) to <url|text>
 * - Converts # Headers to *Headers*
 */
export function formatForSlack(markdown: string): string {
	const codeBlocks: string[] = [];
	let text = markdown.replace(/```[a-zA-Z0-9-]*\n?([\s\S]*?)```/g, (_match, p1) => {
		codeBlocks.push(`\`\`\`${p1}\`\`\``);
		return `@@CODEBLOCK_${codeBlocks.length - 1}@@`;
	});

	const inlineCode: string[] = [];
	text = text.replace(/`(.*?)`/g, (_match, p1) => {
		inlineCode.push(`\`${p1}\``);
		return `@@INLINECODE_${inlineCode.length - 1}@@`;
	});

	// Protect URLs in Markdown links
	const urls: string[] = [];
	text = text.replace(/\[(.*?)\]\((.*?)\)/g, (_match, p1, p2) => {
		urls.push(p2);
		return `[${p1}](@@URL_${urls.length - 1}@@)`;
	});

	// Protect bare URLs
	const bareUrls: string[] = [];
	text = text.replace(
		/(https?:\/\/[^\s]+?)(?=[.,:;!?)]?(?:\s|$))/g,
		(match) => {
			if (match.includes("@@URL_")) return match;
			bareUrls.push(match);
			return `@@BAREURL_${bareUrls.length - 1}@@`;
		},
	);

	// Bold and Italic
	text = text.replace(/(?:\*\*|__)((?:(?!\n\n)[\s\S])+?)(?:\*\*|__)(?!\*|_)/g, "@@BOLD@@$1@@BOLD@@");
	text = text.replace(
		/(?<!\*)\*(?!\*)((?:(?!\n\n)[\s\S])+?)(?<!\*)\*(?!\*)/g,
		"_$1_",
	);
	text = text.replace(/@@BOLD@@([\s\S]+?)@@BOLD@@/g, "*$1*");
	// Strikethrough
	text = text.replace(/~~((?:(?!\n\n)[\s\S])+?)~~/g, "~$1~");
	// Headers
	text = text.replace(/^#+\s*(.*)$/gm, "*$1*");

	// Convert links
	text = text.replace(/\[(.*?)\]\(@@URL_(\d+)@@\)/g, (_match, p1, p2) => {
		const url = urls[parseInt(p2, 10)];
		return `<${url}|${p1}>`;
	});

	// Restore placeholders
	text = text.replace(
		/@@BAREURL_(\d+)@@/g,
		(_match, p1) => bareUrls[parseInt(p1, 10)],
	);
	text = text.replace(
		/@@INLINECODE_(\d+)@@/g,
		(_match, p1) => inlineCode[parseInt(p1, 10)],
	);
	text = text.replace(
		/@@CODEBLOCK_(\d+)@@/g,
		(_match, p1) => codeBlocks[parseInt(p1, 10)],
	);

	return text;
}

/**
 * Formats standard LLM Markdown for Discord.
 * Discord supports standard markdown, but has a 2000 character limit per message.
 * This function splits the message into chunks <= 2000 chars, ideally breaking at newlines.
 */
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

		// reserve 4 chars for "\n```" just in case we need to close a block
		const maxTake = MAX_LEN - prefix.length - 4;

		if (prefix.length + remaining.length <= MAX_LEN) {
			chunks.push(prefix + remaining);
			break;
		}

		// Find the last newline before the maxTake limit
		let splitIndex = remaining.lastIndexOf("\n", maxTake);
		if (splitIndex === -1 || splitIndex === 0) {
			// If no newline is found, try to split at a space
			splitIndex = remaining.lastIndexOf(" ", maxTake);
		}
		if (splitIndex === -1 || splitIndex === 0) {
			// If no space is found, split exactly at maxTake
			splitIndex = maxTake;
		}

		// Prevent splitting right on a backtick sequence
		while (
			splitIndex > 0 &&
			splitIndex < remaining.length &&
			remaining[splitIndex - 1] === "`" &&
			remaining[splitIndex] === "`"
		) {
			splitIndex--;
		}

		if (splitIndex <= 0) {
			splitIndex = maxTake;
		}

		// Prevent splitting a surrogate pair (multi-byte emoji)
		if (splitIndex > 0 && splitIndex < remaining.length) {
			const charCodeBefore = remaining.charCodeAt(splitIndex - 1);
			if (charCodeBefore >= 0xd800 && charCodeBefore <= 0xdbff) {
				// Make sure we break the loop if we keep shifting back
				if (splitIndex <= 1) {
					splitIndex = maxTake;
				} else {
				splitIndex--;
				}
			}
		}

		const chunkContent = remaining.substring(0, splitIndex);

		// Track code block state changes in this chunk
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
			if (!chunk.endsWith("\n")) chunk += "\n";
			chunk += "```";
		}
		chunks.push(chunk);

		remaining = remaining.substring(splitIndex);
		if (remaining.startsWith("\n")) remaining = remaining.substring(1);
	}

	return chunks;
}

/**
 * Translates standard LLM Markdown into Telegram HTML format.
 * Telegram supports basic HTML tags: <b>, <i>, <u>, <s>, <a href="url">, <code>, <pre>
 */
export function formatForTelegram(markdown: string): string {
	// First, escape HTML characters to prevent malformed tags
	let text = markdown
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;");

	const codeBlocks: string[] = [];
	text = text.replace(/```[a-zA-Z0-9-]*\n?([\s\S]*?)```/g, (_match, p1) => {
		codeBlocks.push(`<pre>${p1}</pre>`);
		return `@@CODEBLOCK_${codeBlocks.length - 1}@@`;
	});

	const inlineCode: string[] = [];
	text = text.replace(/`(.*?)`/g, (_match, p1) => {
		inlineCode.push(`<code>${p1}</code>`);
		return `@@INLINECODE_${inlineCode.length - 1}@@`;
	});

	const urls: string[] = [];
	text = text.replace(/\[(.*?)\]\((.*?)\)/g, (_match, p1, p2) => {
		urls.push(p2);
		return `[${p1}](@@URL_${urls.length - 1}@@)`;
	});

	const bareUrls: string[] = [];
	text = text.replace(
		/(https?:\/\/[^\s]+?)(?=[.,:;!?)]?(?:\s|$))/g,
		(match) => {
			if (match.includes("@@URL_")) return match;
			bareUrls.push(match);
			return `@@BAREURL_${bareUrls.length - 1}@@`;
		},
	);

	// Bold
	text = text.replace(/(?:\*\*|__)((?:(?!\n\n)[\s\S])+?)(?:\*\*|__)(?!\*|_)/g, "<b>$1</b>");

	// Italic (ignoring intra-word underscores to be safer)
	text = text.replace(/(?<!\w)_((?:(?!\n\n)[\s\S])+?)_(?!\w)/g, "<i>$1</i>");
	text = text.replace(
		/(?<!\*)\*(?!\*)((?:(?!\n\n)[\s\S])+?)(?<!\*)\*(?!\*)/g,
		"<i>$1</i>",
	);

	// Strikethrough
	text = text.replace(/~~((?:(?!\n\n)[\s\S])+?)~~/g, "<s>$1</s>");

	// Convert links
	text = text.replace(/\[(.*?)\]\(@@URL_(\d+)@@\)/g, (_match, p1, p2) => {
		const safeUrl = urls[parseInt(p2, 10)].replace(/"/g, "&quot;");
		return `<a href="${safeUrl}">${p1}</a>`;
	});

	// Restore placeholders
	text = text.replace(
		/@@BAREURL_(\d+)@@/g,
		(_match, p1) => bareUrls[parseInt(p1, 10)],
	);
	text = text.replace(
		/@@INLINECODE_(\d+)@@/g,
		(_match, p1) => inlineCode[parseInt(p1, 10)],
	);
	text = text.replace(
		/@@CODEBLOCK_(\d+)@@/g,
		(_match, p1) => codeBlocks[parseInt(p1, 10)],
	);

	return text;
}

/**
 * Translates standard LLM Markdown into WhatsApp text markup format.
 * - Converts **bold** to *bold*
 * - Converts ~~strikethrough~~ to ~strikethrough~
 * - WhatsApp doesn't support named hyperlinks, so we extract the URL: text (url)
 * - Converts # Headers to *Headers*
 */
export function formatForWhatsApp(markdown: string): string {
	const codeBlocks: string[] = [];
	let text = markdown.replace(/```[a-zA-Z0-9-]*\n?([\s\S]*?)```/g, (_match, p1) => {
		codeBlocks.push(`\`\`\`${p1}\`\`\``);
		return `@@CODEBLOCK_${codeBlocks.length - 1}@@`;
	});

	const inlineCode: string[] = [];
	text = text.replace(/`(.*?)`/g, (_match, p1) => {
		inlineCode.push(`\`${p1}\``);
		return `@@INLINECODE_${inlineCode.length - 1}@@`;
	});

	const urls: string[] = [];
	text = text.replace(/\[(.*?)\]\((.*?)\)/g, (_match, p1, p2) => {
		urls.push(p2);
		return `[${p1}](@@URL_${urls.length - 1}@@)`;
	});

	const bareUrls: string[] = [];
	text = text.replace(
		/(https?:\/\/[^\s]+?)(?=[.,:;!?)]?(?:\s|$))/g,
		(match) => {
			if (match.includes("@@URL_")) return match;
			bareUrls.push(match);
			return `@@BAREURL_${bareUrls.length - 1}@@`;
		},
	);

	// Bold and Italic
	text = text.replace(/(?:\*\*|__)((?:(?!\n\n)[\s\S])+?)(?:\*\*|__)(?!\*|_)/g, "@@BOLD@@$1@@BOLD@@");
	text = text.replace(
		/(?<!\*)\*(?!\*)((?:(?!\n\n)[\s\S])+?)(?<!\*)\*(?!\*)/g,
		"_$1_",
	);
	text = text.replace(/@@BOLD@@([\s\S]+?)@@BOLD@@/g, "*$1*");
	// Strikethrough
	text = text.replace(/~~((?:(?!\n\n)[\s\S])+?)~~/g, "~$1~");
	// Headers
	text = text.replace(/^#+\s*(.*)$/gm, "*$1*");

	// Convert links
	text = text.replace(/\[(.*?)\]\(@@URL_(\d+)@@\)/g, (_match, p1, p2) => {
		return `${p1} (${urls[parseInt(p2, 10)]})`;
	});

	// Restore placeholders
	text = text.replace(
		/@@BAREURL_(\d+)@@/g,
		(_match, p1) => bareUrls[parseInt(p1, 10)],
	);
	text = text.replace(
		/@@INLINECODE_(\d+)@@/g,
		(_match, p1) => inlineCode[parseInt(p1, 10)],
	);
	text = text.replace(
		/@@CODEBLOCK_(\d+)@@/g,
		(_match, p1) => codeBlocks[parseInt(p1, 10)],
	);

	return text;
}

/**
 * Main dispatcher function to format a markdown message for a specific platform.
 */
export function formatMessage(
	platform: Platform,
	markdown: string,
): string | string[] {
	// Strip the internal [Timestamp: HH:MM:SS] prefix before sending to external platforms
	const cleanedMarkdown = markdown.replace(
		/^\[Timestamp: \d{2}:\d{2}:\d{2}\]\n?/,
		"",
	);

	switch (platform) {
		case "slack":
			return formatForSlack(cleanedMarkdown);
		case "discord":
			return formatForDiscord(cleanedMarkdown);
		case "telegram":
			return formatForTelegram(cleanedMarkdown);
		case "whatsapp":
			return formatForWhatsApp(cleanedMarkdown);
		default:
			return cleanedMarkdown;
	}
}
