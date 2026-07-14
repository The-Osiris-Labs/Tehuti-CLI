/**
 * Detects actual terminal mouse reports without ever classifying ordinary source-code
 * punctuation as terminal control traffic. SGR reports always begin with ESC [ <.
 */
const COMPLETE_SGR = /^\x1b\[<\d+;\d+;\d+[Mm]$/;
const COMPLETE_X10 = /^\x1b\[M...$/;
const SGR_PREFIX = /^\x1b\[<\d*(?:;\d*){0,2}$/;
const COORD_FRAGMENT_TAIL = /^\d+[Mm]$/;
const COORD_FRAGMENT_START = /^\d+;\d+;\d+/;

export function isMouseSequence(k: string): boolean {
	return COMPLETE_SGR.test(k) || COMPLETE_X10.test(k);
}

/**
 * A fragment is bufferable only after an escape-prefixed SGR prefix was received.
 * Bare `<`, `[`, digits, and semicolons are always normal user text.
 */
export function isMouseSequenceFragment(k: string): boolean {
	return k === "\x1b[" || SGR_PREFIX.test(k);
}

/** Tail chunks are meaningful only while a confirmed escape-prefixed prefix is buffered. */
export function isMouseSequenceTail(k: string): boolean {
	return COORD_FRAGMENT_TAIL.test(k) || COORD_FRAGMENT_START.test(k);
}
