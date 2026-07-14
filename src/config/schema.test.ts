import { describe, expect, it } from "vitest";
import { STREAM_RULE_SCHEMA } from "./schema.js";

describe("stream rules schema", () => {
  it("should validate a valid stream rule", () => {
    const result = STREAM_RULE_SCHEMA.parse({
      pattern: "cannot (help|assist)",
      remediation: "You can help.",
    });
    expect(result.pattern).toBe("cannot (help|assist)");
    expect(result.enabled).toBe(true);
  });

  it("should reject missing remediation", () => {
    expect(() => STREAM_RULE_SCHEMA.parse({ pattern: "test" })).toThrow();
  });
});
