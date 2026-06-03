import { describe, it, expect } from "vitest";

const {
  mth,
  mthFromLeafHashes,
  generateAuditPath,
  computeRootFromPath,
  largestPow2LessThan,
} = require("../lib/merkle.js");
const { leafHash, nodeHash } = require("../lib/hash.js");

/**
 * RFC 6962 §2.1 — Merkle Tree Hash standard test vectors.
 * These must match the reference values bit-exactly; any deviation
 * indicates a fundamental implementation bug.
 */

describe("RFC 6962 — empty tree", () => {
  it("MTH({}) = SHA-256(empty)", () => {
    const root = mth([]);
    expect(root.toString("hex")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});

describe("RFC 6962 — single-leaf tree", () => {
  it("MTH({\"\"}) = leafHash(empty) = SHA-256(0x00)", () => {
    const root = mth([Buffer.alloc(0)]);
    expect(root.toString("hex")).toBe(
      "6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d",
    );
  });

  it("audit path is empty for single-leaf tree", () => {
    const leaves = [leafHash(Buffer.alloc(0))];
    const path = generateAuditPath(0, leaves);
    expect(path).toEqual([]);
  });

  it("computeRootFromPath returns leaf for treeSize=1", () => {
    const leaf = leafHash(Buffer.from("anything"));
    const root = computeRootFromPath(leaf, 0, 1, []);
    expect(root.equals(leaf)).toBe(true);
  });
});

describe("RFC 6962 — two-leaf tree (both empty)", () => {
  it("MTH({'', ''}) = nodeHash(leafHash(''), leafHash(''))", () => {
    const root = mth([Buffer.alloc(0), Buffer.alloc(0)]);
    const lh = leafHash(Buffer.alloc(0));
    const expected = nodeHash(lh, lh);
    expect(root.equals(expected)).toBe(true);
  });

  it("audit path for index 0 = [leafHash('')]", () => {
    const leaves = [leafHash(Buffer.alloc(0)), leafHash(Buffer.alloc(0))];
    const path = generateAuditPath(0, leaves);
    expect(path.length).toBe(1);
    expect(path[0].equals(leaves[1])).toBe(true);
  });

  it("audit path for index 1 = [leafHash('')]", () => {
    const leaves = [leafHash(Buffer.alloc(0)), leafHash(Buffer.alloc(0))];
    const path = generateAuditPath(1, leaves);
    expect(path.length).toBe(1);
    expect(path[0].equals(leaves[0])).toBe(true);
  });
});

describe("RFC 6962 — split point k (largestPow2LessThan)", () => {
  it("matches RFC 6962 §2.1 split rule for representative sizes", () => {
    // From RFC: "k is the largest power of two smaller than n"
    expect(largestPow2LessThan(2)).toBe(1);
    expect(largestPow2LessThan(3)).toBe(2);
    expect(largestPow2LessThan(4)).toBe(2); // strictly less than 4
    expect(largestPow2LessThan(5)).toBe(4);
    expect(largestPow2LessThan(7)).toBe(4);
    expect(largestPow2LessThan(8)).toBe(4);
    expect(largestPow2LessThan(9)).toBe(8);
    expect(largestPow2LessThan(15)).toBe(8);
    expect(largestPow2LessThan(16)).toBe(8);
  });

  it("rejects n < 2", () => {
    expect(() => largestPow2LessThan(1)).toThrow();
    expect(() => largestPow2LessThan(0)).toThrow();
    expect(() => largestPow2LessThan(-1)).toThrow();
  });
});

describe("RFC 6962 — non-balanced trees (n not a power of 2)", () => {
  it("3-leaf tree: MTH({a,b,c}) = nodeHash(MTH({a,b}), leafHash(c))", () => {
    const a = Buffer.from("a");
    const b = Buffer.from("b");
    const c = Buffer.from("c");
    const root = mth([a, b, c]);
    const expected = nodeHash(
      nodeHash(leafHash(a), leafHash(b)),
      leafHash(c),
    );
    expect(root.equals(expected)).toBe(true);
  });

  it("5-leaf tree splits as (4, 1) — left subtree size = largest pow 2 < 5 = 4", () => {
    const leaves = [
      Buffer.from("a"),
      Buffer.from("b"),
      Buffer.from("c"),
      Buffer.from("d"),
      Buffer.from("e"),
    ];
    const root = mth(leaves);
    // Left = MTH({a,b,c,d}); Right = MTH({e}) = leafHash(e)
    const lh = leaves.map((l) => leafHash(l));
    const left = mthFromLeafHashes(lh.slice(0, 4));
    const right = mthFromLeafHashes(lh.slice(4));
    const expected = nodeHash(left, right);
    expect(root.equals(expected)).toBe(true);
  });

  it("7-leaf tree splits as (4, 3)", () => {
    const leaves = Array.from({ length: 7 }, (_, i) => Buffer.from([i]));
    const root = mth(leaves);
    const lh = leaves.map((l) => leafHash(l));
    const left = mthFromLeafHashes(lh.slice(0, 4));
    const right = mthFromLeafHashes(lh.slice(4));
    const expected = nodeHash(left, right);
    expect(root.equals(expected)).toBe(true);
  });
});
