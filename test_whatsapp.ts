export function formatForWhatsApp(markdown: string): string {
    let text = markdown;
    
    // Bold: **text** -> *text*
    text = text.replace(/\*\*(.*?)\*\*/g, "*$1*");
    
    // Italic: *text* -> _text_ (but wait, how do we not match *bold* which was just created?)
    // If we replace ** first, it becomes *. Then we replace * with _. 
    // This will turn the newly bolded text into italic!
    return text;
}
console.log(formatForWhatsApp("Hello **bold** and *italic*"));
