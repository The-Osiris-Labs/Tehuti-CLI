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
  let text = markdown.replace(/```([\s\S]*?)```/g, (match, p1) => {
    codeBlocks.push(`\`\`\`${p1}\`\`\``);
    return `__CODEBLOCK_${codeBlocks.length - 1}__`;
  });

  const inlineCode: string[] = [];
  text = text.replace(/`(.*?)`/g, (match, p1) => {
    inlineCode.push(`\`${p1}\``);
    return `__INLINECODE_${inlineCode.length - 1}__`;
  });

  // Extract Links
  const links: string[] = [];
  text = text.replace(/\[(.*?)\]\((.*?)\)/g, (match, p1, p2) => {
    links.push(`<${p2}|${p1}>`);
    return `__LINK_${links.length - 1}__`;
  });

  // Bold
  text = text.replace(/\*\*(.*?)\*\*/g, "*$1*");
  // Strikethrough
  text = text.replace(/~~(.*?)~~/g, "~$1~");
  // Headers
  text = text.replace(/^#+\s+(.*)$/gm, "*$1*");

  // Restore placeholders
  text = text.replace(/__LINK_(\d+)__/g, (match, p1) => links[parseInt(p1, 10)]);
  text = text.replace(/__INLINECODE_(\d+)__/g, (match, p1) => inlineCode[parseInt(p1, 10)]);
  text = text.replace(/__CODEBLOCK_(\d+)__/g, (match, p1) => codeBlocks[parseInt(p1, 10)]);

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
  let current = markdown;

  while (current.length > 0) {
    if (current.length <= MAX_LEN) {
      chunks.push(current);
      break;
    }

    // Find the last newline before the MAX_LEN limit
    let splitIndex = current.lastIndexOf("
", MAX_LEN);
    if (splitIndex === -1) {
      // If no newline is found, split exactly at MAX_LEN
      splitIndex = MAX_LEN;
    }

    chunks.push(current.substring(0, splitIndex));
    current = current.substring(splitIndex).trimStart();
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
  text = text.replace(/```([\s\S]*?)```/g, (match, p1) => {
    codeBlocks.push(`<pre>${p1}</pre>`);
    return `__CODEBLOCK_${codeBlocks.length - 1}__`;
  });

  const inlineCode: string[] = [];
  text = text.replace(/`(.*?)`/g, (match, p1) => {
    inlineCode.push(`<code>${p1}</code>`);
    return `__INLINECODE_${inlineCode.length - 1}__`;
  });

  const links: string[] = [];
  text = text.replace(/\[(.*?)\]\((.*?)\)/g, (match, p1, p2) => {
    links.push(`<a href="${p2}">${p1}</a>`);
    return `__LINK_${links.length - 1}__`;
  });

  // Bold
  text = text.replace(/\*\*(.*?)\*\*/g, "<b>$1</b>");
  
  // Italic (ignoring intra-word underscores to be safer)
  text = text.replace(/(?<!\w)_(.*?)_(?!\w)/g, "<i>$1</i>");
  text = text.replace(/(?<!\*)\*(?!\*)(.*?)(?<!\*)\*(?!\*)/g, "<i>$1</i>");
  
  // Strikethrough
  text = text.replace(/~~(.*?)~~/g, "<s>$1</s>");

  // Restore placeholders
  text = text.replace(/__LINK_(\d+)__/g, (match, p1) => links[parseInt(p1, 10)]);
  text = text.replace(/__INLINECODE_(\d+)__/g, (match, p1) => inlineCode[parseInt(p1, 10)]);
  text = text.replace(/__CODEBLOCK_(\d+)__/g, (match, p1) => codeBlocks[parseInt(p1, 10)]);

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
  let text = markdown.replace(/```([\s\S]*?)```/g, (match, p1) => {
    codeBlocks.push(`\`\`\`${p1}\`\`\``);
    return `__CODEBLOCK_${codeBlocks.length - 1}__`;
  });

  const inlineCode: string[] = [];
  text = text.replace(/`(.*?)`/g, (match, p1) => {
    inlineCode.push(`\`${p1}\``);
    return `__INLINECODE_${inlineCode.length - 1}__`;
  });

  const links: string[] = [];
  text = text.replace(/\[(.*?)\]\((.*?)\)/g, (match, p1, p2) => {
    links.push(`${p1} (${p2})`);
    return `__LINK_${links.length - 1}__`;
  });

  // Bold
  text = text.replace(/\*\*(.*?)\*\*/g, "*$1*");
  // Strikethrough
  text = text.replace(/~~(.*?)~~/g, "~$1~");
  // Headers
  text = text.replace(/^#+\s+(.*)$/gm, "*$1*");

  // Restore placeholders
  text = text.replace(/__LINK_(\d+)__/g, (match, p1) => links[parseInt(p1, 10)]);
  text = text.replace(/__INLINECODE_(\d+)__/g, (match, p1) => inlineCode[parseInt(p1, 10)]);
  text = text.replace(/__CODEBLOCK_(\d+)__/g, (match, p1) => codeBlocks[parseInt(p1, 10)]);

  return text;
}

/**
 * Main dispatcher function to format a markdown message for a specific platform.
 */
export function formatMessage(
  platform: Platform,
  markdown: string,
): string | string[] {
  switch (platform) {
    case "slack":
      return formatForSlack(markdown);
    case "discord":
      return formatForDiscord(markdown);
    case "telegram":
      return formatForTelegram(markdown);
    case "whatsapp":
      return formatForWhatsApp(markdown);
    default:
      return markdown;
  }
}
