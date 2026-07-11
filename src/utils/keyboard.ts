export function isEnterKey(char: string | undefined, key: any): boolean {
	if (!key) return false;

	// Normal Enter
	if (key.return) return true;

	const kAny = char as unknown as string;
	const keyAny = key as unknown as { code?: string };

	// Terminal modifyOtherKeys=2 and CSI sequences often encode Enter as `[13~` or `[27;5;13~`
	// Ink drops the ESC byte and leaves the rest in `char`.
	// For some combos, Ink decodes to `code="[13~"` with modifier flags.
	const isModifiedEnter =
		(keyAny.code === "[13~") ||
		kAny === "[13~" ||
		kAny === "[27;2;13~" ||
		kAny === "[27;3;13~" ||
		kAny === "[27;4;13~" ||
		kAny === "[27;5;13~" ||
		kAny === "[27;6;13~" ||
		kAny === "[27;7;13~" ||
		// Defensive matching if Ink didn't strip ESC
		kAny === "\x1b[13;2~" ||
		kAny === "\x1b[13;3~" ||
		kAny === "\x1b[13;4~" ||
		kAny === "\x1b[13;5~" ||
		kAny === "\x1b[13;6~" ||
		kAny === "\x1b[27;2;13~" ||
		kAny === "\x1b[27;3;13~" ||
		kAny === "\x1b[27;4;13~" ||
		kAny === "\x1b[27;5;13~" ||
		kAny === "\x1b[27;6;13~" ||
		kAny === "\x1b[27;7;13~";

	return !!isModifiedEnter;
}
