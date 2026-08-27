import { describe, expect, it } from "vitest";

const {
  DEFAULT_IPFS_BOUNDARIES,
  HARD_IPFS_BOUNDARIES,
  IPFSBoundaryError,
  resolveIPFSBoundaries,
  createOverloadedError,
} = require("../ipfs-boundaries.js");

describe("IPFS boundaries", () => {
  it("returns frozen defaults", () => {
    const boundaries = resolveIPFSBoundaries();
    expect(boundaries).toEqual(DEFAULT_IPFS_BOUNDARIES);
    expect(Object.isFrozen(boundaries)).toBe(true);
    expect(boundaries.maxIpcContentBytes).toBeLessThan(
      boundaries.maxContentBytes,
    );
  });

  it("accepts bounded overrides without mutating defaults", () => {
    const boundaries = resolveIPFSBoundaries({
      maxContentBytes: 1024,
      maxIpcContentBytes: 512,
      maxConcurrentReads: 2,
    });
    expect(boundaries.maxContentBytes).toBe(1024);
    expect(boundaries.maxIpcContentBytes).toBe(512);
    expect(boundaries.maxConcurrentReads).toBe(2);
    expect(DEFAULT_IPFS_BOUNDARIES.maxContentBytes).not.toBe(1024);
  });

  it("rejects invalid and above-hard-limit configuration", () => {
    expect(() => resolveIPFSBoundaries({ maxConcurrentReads: 0 })).toThrow(
      IPFSBoundaryError,
    );
    expect(() =>
      resolveIPFSBoundaries({
        maxContentBytes: HARD_IPFS_BOUNDARIES.maxContentBytes + 1,
      }),
    ).toThrow(/hard limit/);
    expect(() =>
      resolveIPFSBoundaries({
        maxContentBytes: 10,
        maxIpcContentBytes: 11,
      }),
    ).toThrow(/cannot exceed/);
    expect(() =>
      resolveIPFSBoundaries({ listLimit: 10, maxListLimit: 5 }),
    ).toThrow(/listLimit/);
  });

  it("creates a structured retryable overload error", () => {
    const boundaries = resolveIPFSBoundaries({ retryAfterMs: 250 });
    const error = createOverloadedError(boundaries, "test capacity");
    expect(error).toMatchObject({
      code: "OVERLOADED",
      reason: "test capacity",
      retryAfterMs: 250,
    });
  });
});
