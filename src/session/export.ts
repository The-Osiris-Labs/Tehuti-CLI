import type { ContentBlock, StandardMessage } from "../api/base-client.js";

/**
 * Render a single `ContentBlock` to a readable string.
 *
 * Text blocks are emitted verbatim. Image blocks emit a placeholder that
 * keeps the markdown parseable without embedding the (potentially very large)
 * base64 payload.
 */
function renderContentBlock(block: ContentBlock): string {
	switch (block.type) {
		case "text":
			return block.text;
		case "image_url":
			return `![image](${block.image_url.url})`;
	}
}

/**
 * Produce a human-readable markdown string from an array of `StandardMessage`
 * entries.  The output is designed to be readable both rendered and raw,
 * suitable for pasting into chat or sharing as a `.md` file.
 */
export function exportToMarkdown(messages: StandardMessage[]): string {
	const lines: string[] = [];
	lines.push("# Tehuti Session Export\n");
	lines.push(`Exported: ${new Date().toISOString()}\n`);
	lines.push("---\n");

	for (const msg of messages) {
		const role =
			msg.role.charAt(0).toUpperCase() + msg.role.slice(1);

		// Normalise content to a plain string.
		let content: string;
		if (typeof msg.content === "string") {
			content = msg.content;
		} else if (Array.isArray(msg.content)) {
			content = msg.content.map(renderContentBlock).join("\n");
		} else {
			content = JSON.stringify(msg.content);
		}

		lines.push(`## ${role}\n`);
		lines.push(`${content}\n`);

		if (msg.tool_calls) {
			for (const tc of msg.tool_calls) {
				lines.push(`### Tool Call: ${tc.function.name}\n`);
				lines.push("```json");
				lines.push(tc.function.arguments);
				lines.push("```\n");
			}
		}

		lines.push("---\n");
	}

	return lines.join("\n");
}

/**
 * Produce a pretty-printed JSON string from an array of `StandardMessage`
 * entries.  This is a thin wrapper around `JSON.stringify` kept for API
 * symmetry with `exportToMarkdown`.
 */
export function exportToJSON(messages: StandardMessage[]): string {
	return JSON.stringify(messages, null, 2);
}
