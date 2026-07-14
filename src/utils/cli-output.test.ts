import { describe, expect, it } from "vitest";
import { isMachineReadableOutput } from "./cli-output.js";

describe("isMachineReadableOutput", () => {
	it("recognizes provider JSON output regardless of option position", () => {
		expect(
			isMachineReadableOutput([
				"node",
				"tehuti",
				"providers",
				"--format",
				"json",
			]),
		).toBe(true);
		expect(
			isMachineReadableOutput([
				"node",
				"tehuti",
				"providers",
				"--detected",
				"--format",
				"json",
			]),
		).toBe(true);
		expect(
			isMachineReadableOutput([
				"node",
				"tehuti",
				"providers",
				"probe",
				"ollama-local",
				"--output",
				"json",
			]),
		).toBe(true);
	});

	it("does not suppress interactive or non-JSON startup output", () => {
		expect(isMachineReadableOutput(["node", "tehuti"])).toBe(false);
		expect(
			isMachineReadableOutput([
				"node",
				"tehuti",
				"providers",
				"--format",
				"text",
			]),
		).toBe(false);
		expect(isMachineReadableOutput(["node", "tehuti", "providers"])).toBe(
			false,
		);
	});
});
