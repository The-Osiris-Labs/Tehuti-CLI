import { describe, expect, it } from "vitest";
import {
	isMouseSequence,
	isMouseSequenceFragment,
	isMouseSequenceTail,
} from "./mouse.js";

describe("Mouse Sequence Filter Utility", () => {
	it("should detect complete SGR mouse sequences", () => {
		expect(isMouseSequence("\x1b[<35;72;37M")).toBe(true);
		expect(isMouseSequence("\x1b[<0;10;20m")).toBe(true);
	});

	it("should detect standard X10 mouse sequences", () => {
		expect(isMouseSequence("\x1b[Mabc")).toBe(true);
	});

	it("should detect split or fragmented mouse coordinates", () => {
		expect(isMouseSequence("<35;72;37M")).toBe(true);
		expect(isMouseSequence("35;72;37M")).toBe(true);
		expect(isMouseSequence("35;72;37m")).toBe(true);
	});

	it("should detect split SGR fragments produced by chunked stdin reads", () => {
		expect(isMouseSequence("<")).toBe(true);
		expect(isMouseSequence("<35")).toBe(true);
		expect(isMouseSequence("35;72")).toBe(true);
		expect(isMouseSequence("35;72;37")).toBe(true);
		expect(isMouseSequence("37M")).toBe(true);
		expect(isMouseSequence("37m")).toBe(true);
	});

	it("should not falsely match normal text keys or words", () => {
		expect(isMouseSequence("hello")).toBe(false);
		expect(isMouseSequence("a")).toBe(false);
		expect(isMouseSequence("/help")).toBe(false);
		expect(isMouseSequence("<hello>")).toBe(false);
		expect(isMouseSequence("35")).toBe(false);
		expect(isMouseSequence("")).toBe(false);
	});

	it("should catch bare M/m tails from split SGR releases", () => {
		expect(isMouseSequence("M")).toBe(true);
		expect(isMouseSequence("m")).toBe(true);
	});

	it("isMouseSequenceFragment flags partials that should be buffered", () => {
		expect(isMouseSequenceFragment("<")).toBe(true);
		expect(isMouseSequenceFragment("<35")).toBe(true);
		expect(isMouseSequenceFragment("35;72")).toBe(true);
		expect(isMouseSequenceFragment("37")).toBe(false);
		expect(isMouseSequenceFragment("hello")).toBe(false);
	});

	it("isMouseSequenceTail flags a chunk that completes a buffered fragment", () => {
		expect(isMouseSequenceTail("37M")).toBe(true);
		expect(isMouseSequenceTail("37m")).toBe(true);
		expect(isMouseSequenceTail("35;72;37")).toBe(true);
		expect(isMouseSequenceTail("37")).toBe(false);
		expect(isMouseSequenceTail("hello")).toBe(false);
	});
});
