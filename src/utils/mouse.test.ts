import { describe, expect, it } from "vitest";
import {
	isMouseSequence,
	isMouseSequenceFragment,
	isMouseSequenceTail,
} from "./mouse.js";

describe("Mouse Sequence Filter Utility", () => {
	it("detects complete escape-prefixed SGR and X10 mouse sequences", () => {
		expect(isMouseSequence("\x1b[<35;72;37M")).toBe(true);
		expect(isMouseSequence("\x1b[<0;10;20m")).toBe(true);
		expect(isMouseSequence("\x1b[Mabc")).toBe(true);
	});

	it("never classifies ordinary source-code text as mouse protocol", () => {
		for (const input of [
			"<",
			"[",
			"<35;72;37M",
			"35;72;37M",
			"35;72;37m",
			"foo<Bar",
			"arr[0]",
			"M",
			"m",
			"/help",
		]) {
			expect(isMouseSequence(input)).toBe(false);
		}
	});

	it("buffers only escape-prefixed SGR fragments", () => {
		expect(isMouseSequenceFragment("\x1b[")).toBe(true);
		expect(isMouseSequenceFragment("\x1b[<")).toBe(true);
		expect(isMouseSequenceFragment("\x1b[<35")).toBe(true);
		expect(isMouseSequenceFragment("\x1b[<35;72")).toBe(true);

		for (const input of ["<", "[", "<35", "35;72", "37", "hello"]) {
			expect(isMouseSequenceFragment(input)).toBe(false);
		}
	});

	it("recognizes coordinate tails only for an already-confirmed mouse prefix", () => {
		expect(isMouseSequenceTail("37M")).toBe(true);
		expect(isMouseSequenceTail("37m")).toBe(true);
		expect(isMouseSequenceTail("35;72;37")).toBe(true);
		expect(isMouseSequenceTail("37")).toBe(false);
		expect(isMouseSequenceTail("hello")).toBe(false);
	});
});
