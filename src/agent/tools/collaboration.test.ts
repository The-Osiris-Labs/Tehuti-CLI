import { describe, expect, it } from "vitest";
import { collaborationTools } from "./collaboration.js";

describe("collaborationTools", () => {
	it("should export a single collaboration placeholder tool", () => {
		expect(collaborationTools).toHaveLength(1);
		expect(collaborationTools[0].name).toBe("collaboration");
	});

	it("should return a not-implemented message for the status action", async () => {
		const tool = collaborationTools[0];
		const result = await tool.execute({ action: "status" }, {} as never);

		expect(result.success).toBe(true);
		expect(result.output).toContain("not yet implemented");
	});
});
