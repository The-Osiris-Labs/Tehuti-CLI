let text = "Hello **bold** and *italic* and _italic2_";

// Using placeholder for bold to prevent italic regex from matching it
text = text.replace(/\*\*(.*?)\*\*/g, "__BOLD__$1__BOLD__");

// Match single * for italic
text = text.replace(/(?<!\*)\*(?!\*)(.*?)(?<!\*)\*(?!\*)/g, "_$1_");

text = text.replace(/__BOLD__(.*?)__BOLD__/g, "*$1*");

console.log(text);
