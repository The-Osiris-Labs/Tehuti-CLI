import { describe, expect, it } from "vitest";
import { computeHashline, findLineByHash } from "./fs.js";

describe("hashline edits", () => {
  it("should compute hashline from content", () => {
    const hash = computeHashline("hello world");
    expect(hash).toHaveLength(12);
    expect(/^[0-9a-f]+$/.test(hash)).toBe(true);
  });

  it("should find line by hash", () => {
    const content = "line1\nline2\nline3";
    const hash = computeHashline("line2");
    const lineNum = findLineByHash(content, hash);
    expect(lineNum).toBe(1); // 0-indexed
  });

  it("should return null for unknown hash", () => {
    const content = "line1\nline2";
    const lineNum = findLineByHash(content, "aaaaaaaaaaaa");
    expect(lineNum).toBeNull();
  });
});
