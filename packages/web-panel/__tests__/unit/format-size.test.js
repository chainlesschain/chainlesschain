import { describe, it, expect } from "vitest";
import { formatSize } from "../../src/utils/format-size.js";

describe("formatSize", () => {
  it("formats common sizes across units", () => {
    expect(formatSize(0)).toBe("0 B");
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(1536)).toBe("1.5 KB");
    expect(formatSize(1024 * 1024)).toBe("1.0 MB");
    expect(formatSize(1024 ** 3)).toBe("1.0 GB");
    expect(formatSize(1024 ** 4)).toBe("1.0 TB");
  });

  it("returns '-' for null / undefined / NaN / non-numeric / negative", () => {
    expect(formatSize(null)).toBe("-");
    expect(formatSize(undefined)).toBe("-");
    expect(formatSize(NaN)).toBe("-");
    expect(formatSize("abc")).toBe("-");
    expect(formatSize(-100)).toBe("-"); // old impl → "NaN undefined"
  });

  it("clamps very large values to the largest unit instead of 'undefined'", () => {
    expect(formatSize(1024 ** 5)).toBe("1.0 PB"); // old impl → "1.0 undefined"
    expect(formatSize(1024 ** 8)).toMatch(/ EB$/); // beyond EB → clamped to EB
  });

  it("accepts numeric strings", () => {
    expect(formatSize("2048")).toBe("2.0 KB");
  });
});
