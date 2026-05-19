"use strict";

import { describe, it, expect } from "vitest";

const { newId, timestampFromId } = require("../lib/ids");

describe("ids", () => {
  it("newId returns a 36-char UUID v7 string", () => {
    const id = newId();
    expect(typeof id).toBe("string");
    expect(id.length).toBe(36);
    expect(id.charAt(14)).toBe("7"); // version nibble
  });

  it("newId generates unique IDs", () => {
    const ids = new Set();
    for (let i = 0; i < 1000; i++) ids.add(newId());
    expect(ids.size).toBe(1000);
  });

  it("newId generates time-ordered IDs (sortable by string compare)", async () => {
    const a = newId();
    // Wait > 1ms so the embedded timestamp definitely advances.
    await new Promise((r) => setTimeout(r, 5));
    const b = newId();
    expect(a < b).toBe(true);
  });

  it("timestampFromId returns a recent unix ms timestamp for v7 IDs", () => {
    const now = Date.now();
    const id = newId();
    const ts = timestampFromId(id);
    expect(ts).not.toBeNull();
    // Embedded timestamp should be within 2s of now (allow CI jitter).
    expect(Math.abs(ts - now)).toBeLessThan(2000);
  });

  it("timestampFromId returns null for non-v7 input", () => {
    // A canonical v4 UUID has version nibble "4"
    const v4 = "550e8400-e29b-41d4-a716-446655440000";
    expect(timestampFromId(v4)).toBeNull();
    expect(timestampFromId("not-a-uuid")).toBeNull();
    expect(timestampFromId(undefined)).toBeNull();
  });
});
