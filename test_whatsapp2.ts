export function formatForWhatsApp(markdown: string): string {
    let text = markdown;
    
    // Bold
	text = text.replace(/\*\*(.*?)\*\*/g, "*$1*");
	// Strikethrough
	text = text.replace(/~~(.*?)~~/g, "~$1~");
	// Headers
	text = text.replace(/^#+\s+(.*)$/gm, "*$1*");

    return text;
}
