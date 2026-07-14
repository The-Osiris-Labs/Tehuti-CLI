import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, STREAM_RULE_SCHEMA, TEHUTI_CONFIG_SCHEMA } from "./schema.js";

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

describe("TehutiConfig schema", () => {
  it("should validate default config", () => {
    const result = TEHUTI_CONFIG_SCHEMA.safeParse(DEFAULT_CONFIG);
    expect(result.success).toBe(true);
  });

  it("should reject invalid provider", () => {
    const result = TEHUTI_CONFIG_SCHEMA.safeParse({
      ...DEFAULT_CONFIG,
      provider: "",
    });
    expect(result.success).toBe(false);
  });

  it("should accept valid performance config", () => {
    const result = TEHUTI_CONFIG_SCHEMA.safeParse({
      ...DEFAULT_CONFIG,
      performance: {
        maxParallelTools: 10,
        prefetchQueueSize: 20,
      },
    });
    expect(result.success).toBe(true);
  });

  it("should reject empty model name", () => {
    const result = TEHUTI_CONFIG_SCHEMA.safeParse({
      ...DEFAULT_CONFIG,
      model: "",
    });
    expect(result.success).toBe(false);
  });

  it("should reject negative temperature", () => {
    const result = TEHUTI_CONFIG_SCHEMA.safeParse({
      ...DEFAULT_CONFIG,
      temperature: -1,
    });
    expect(result.success).toBe(false);
  });

  it("should reject temperature above 2", () => {
    const result = TEHUTI_CONFIG_SCHEMA.safeParse({
      ...DEFAULT_CONFIG,
      temperature: 3,
    });
    expect(result.success).toBe(false);
  });

  it("should reject non-positive maxTokens", () => {
    const result = TEHUTI_CONFIG_SCHEMA.safeParse({
      ...DEFAULT_CONFIG,
      maxTokens: 0,
    });
    expect(result.success).toBe(false);
  });

  it("should reject invalid $schema URL", () => {
    const result = TEHUTI_CONFIG_SCHEMA.safeParse({
      ...DEFAULT_CONFIG,
      $schema: "not-a-url",
    });
    expect(result.success).toBe(false);
  });

  it("should accept valid $schema URL", () => {
    const result = TEHUTI_CONFIG_SCHEMA.safeParse({
      ...DEFAULT_CONFIG,
      $schema: "https://example.com/schema.json",
    });
    expect(result.success).toBe(true);
  });

  it("should reject invalid model selection mode", () => {
    const result = TEHUTI_CONFIG_SCHEMA.safeParse({
      ...DEFAULT_CONFIG,
      modelSelection: "invalid",
    });
    expect(result.success).toBe(false);
  });

  it("should accept all valid model selection modes", () => {
    for (const mode of ["auto", "manual", "cost-optimized", "speed-optimized"]) {
      const result = TEHUTI_CONFIG_SCHEMA.safeParse({
        ...DEFAULT_CONFIG,
        modelSelection: mode,
      });
      expect(result.success).toBe(true);
    }
  });

  it("should reject requestTimeout below 5000ms", () => {
    const result = TEHUTI_CONFIG_SCHEMA.safeParse({
      ...DEFAULT_CONFIG,
      requestTimeout: 1000,
    });
    expect(result.success).toBe(false);
  });

  it("should reject maxRetries above 10", () => {
    const result = TEHUTI_CONFIG_SCHEMA.safeParse({
      ...DEFAULT_CONFIG,
      maxRetries: 11,
    });
    expect(result.success).toBe(false);
  });

  it("should accept minimal config with defaults", () => {
    const result = TEHUTI_CONFIG_SCHEMA.safeParse({});
    expect(result.success).toBe(true);
  });
});
