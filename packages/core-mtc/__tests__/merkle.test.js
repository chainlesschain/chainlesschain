import { describe, it, expect } from "vitest";

const {
  mth,
  generateAuditPath,
  computeRootFromPath,
  MerkleTree,
} = require("../lib/merkle.js");
const { leafHash } = require("../lib/hash.js");

/**
 * Round-trip property tests:
 *   for every (n, i) where 0 ≤ i < n,
 *   computeRootFromPath(leafHash(d[i]), i, n, generateAuditPath(i, leaves)) === mth(d)
 *
 * This covers all tree shapes (balanced, non-balanced) and all leaf positions.
 */

function makeLeaves(n) {
  return Array.from({ length: n }, (_, i) =>
    Buffer.from(`leaf-${i}`, "utf-8"),
  );
}

describe("Merkle round-trip (any size, any index)", () => {
  // Cover boundary, power-of-2, and non-balanced sizes
  const sizes = [1, 2, 3, 4, 5, 7, 8, 9, 15, 16, 17, 32, 33, 100, 257];

  for (const n of sizes) {
    it(`size=${n}: every leaf's audit path verifies to root`, () => {
      const data = makeLeaves(n);
      const leafHashes = data.map((d) => leafHash(d));
      const expectedRoot = mth(data);
      // Pick a few representative indices to keep test time bounded
      const indices = [0, Math.floor(n / 2), n - 1];
      const seen = new Set();
      for (const i of indices) {
        if (seen.has(i)) continue;
        seen.add(i);
        const path = generateAuditPath(i, leafHashes);
        const computed = computeRootFromPath(leafHashes[i], i, n, path);
        expect(computed.equals(expectedRoot)).toBe(true);
      }
    });
  }

  it("8-leaf tree: every index round-trips", () => {
    const data = makeLeaves(8);
    const leafHashes = data.map((d) => leafHash(d));
    const expectedRoot = mth(data);
    for (let i = 0; i < 8; i++) {
      const path = generateAuditPath(i, leafHashes);
      const computed = computeRootFromPath(leafHashes[i], i, 8, path);
      expect(
        computed.equals(expectedRoot),
        `index ${i} failed`,
      ).toBe(true);
    }
  });

  it("13-leaf (non-balanced) tree: every index round-trips", () => {
    const data = makeLeaves(13);
    const leafHashes = data.map((d) => leafHash(d));
    const expectedRoot = mth(data);
    for (let i = 0; i < 13; i++) {
      const path = generateAuditPath(i, leafHashes);
      const computed = computeRootFromPath(leafHashes[i], i, 13, path);
      expect(
        computed.equals(expectedRoot),
        `index ${i} failed`,
      ).toBe(true);
    }
  });
});

describe("Audit path length", () => {
  it("equals ceil(log2(n)) for power-of-2 trees", () => {
    for (const n of [2, 4, 8, 16, 32, 64, 128, 256, 1024]) {
      const data = makeLeaves(n);
      const leafHashes = data.map((d) => leafHash(d));
      const path = generateAuditPath(0, leafHashes);
      expect(path.length).toBe(Math.log2(n));
    }
  });

  it("for non-balanced trees, length ≤ ceil(log2(n))", () => {
    for (const n of [3, 5, 9, 17, 33, 100, 257, 1000]) {
      const data = makeLeaves(n);
      const leafHashes = data.map((d) => leafHash(d));
      const expectedMax = Math.ceil(Math.log2(n));
      const tree = new MerkleTree(leafHashes);
      for (let i = 0; i < n; i++) {
        const path = tree.prove(i);
        expect(path.length).toBeLessThanOrEqual(expectedMax);
      }
    }
  });
});

describe("computeRootFromPath — invalid inputs", () => {
  it("rejects leafIndex >= treeSize with BAD_PROOF_INDEX", () => {
    const leaf = leafHash(Buffer.from("x"));
    expect(() => computeRootFromPath(leaf, 5, 5, [])).toThrowError(
      expect.objectContaining({ code: "BAD_PROOF_INDEX" }),
    );
  });

  it("rejects negative leafIndex", () => {
    const leaf = leafHash(Buffer.from("x"));
    expect(() => computeRootFromPath(leaf, -1, 5, [])).toThrowError(
      expect.objectContaining({ code: "BAD_PROOF_INDEX" }),
    );
  });

  it("rejects treeSize < 1", () => {
    const leaf = leafHash(Buffer.from("x"));
    expect(() => computeRootFromPath(leaf, 0, 0, [])).toThrowError(
      expect.objectContaining({ code: "BAD_TREE_SIZE" }),
    );
  });

  it("rejects audit path with wrong length (too short)", () => {
    const data = makeLeaves(8);
    const leafHashes = data.map((d) => leafHash(d));
    const path = generateAuditPath(0, leafHashes);
    expect(() =>
      computeRootFromPath(leafHashes[0], 0, 8, path.slice(0, -1)),
    ).toThrowError(expect.objectContaining({ code: "BAD_PROOF_LENGTH" }));
  });

  it("rejects audit path with wrong length (too long)", () => {
    const data = makeLeaves(8);
    const leafHashes = data.map((d) => leafHash(d));
    const path = generateAuditPath(0, leafHashes);
    const padded = [...path, leafHashes[0]];
    expect(() =>
      computeRootFromPath(leafHashes[0], 0, 8, padded),
    ).toThrowError(expect.objectContaining({ code: "BAD_PROOF_LENGTH" }));
  });

  it("rejects audit path with non-32-byte sibling", () => {
    const data = makeLeaves(2);
    const leafHashes = data.map((d) => leafHash(d));
    const badPath = [Buffer.alloc(16)];
    expect(() =>
      computeRootFromPath(leafHashes[0], 0, 2, badPath),
    ).toThrow(/32-byte/);
  });

  it("rejects single-leaf tree with non-empty audit path", () => {
    const leaf = leafHash(Buffer.from("x"));
    const dummy = Buffer.alloc(32);
    expect(() => computeRootFromPath(leaf, 0, 1, [dummy])).toThrowError(
      expect.objectContaining({ code: "BAD_PROOF_LENGTH" }),
    );
  });
});

describe("Tampering detection", () => {
  it("flipping any byte of the leaf changes the root", () => {
    const data = makeLeaves(8);
    const leafHashes = data.map((d) => leafHash(d));
    const path = generateAuditPath(3, leafHashes);
    const correct = computeRootFromPath(leafHashes[3], 3, 8, path);

    const tampered = Buffer.from(leafHashes[3]);
    tampered[0] ^= 0x01;
    const wrong = computeRootFromPath(tampered, 3, 8, path);
    expect(wrong.equals(correct)).toBe(false);
  });

  it("flipping any byte of an audit path entry changes the root", () => {
    const data = makeLeaves(8);
    const leafHashes = data.map((d) => leafHash(d));
    const path = generateAuditPath(3, leafHashes);
    const tamperedPath = path.map((p) => Buffer.from(p));
    tamperedPath[0][5] ^= 0xff;

    const correct = computeRootFromPath(leafHashes[3], 3, 8, path);
    const wrong = computeRootFromPath(leafHashes[3], 3, 8, tamperedPath);
    expect(wrong.equals(correct)).toBe(false);
  });

  it("swapping two siblings in the path changes the root", () => {
    const data = makeLeaves(8);
    const leafHashes = data.map((d) => leafHash(d));
    const path = generateAuditPath(3, leafHashes);
    const swapped = [path[1], path[0], ...path.slice(2)];

    const correct = computeRootFromPath(leafHashes[3], 3, 8, path);
    const wrong = computeRootFromPath(leafHashes[3], 3, 8, swapped);
    expect(wrong.equals(correct)).toBe(false);
  });

  it("changing leafIndex while keeping path/root intact fails verification", () => {
    const data = makeLeaves(8);
    const leafHashes = data.map((d) => leafHash(d));
    const expectedRoot = mth(data);
    const path = generateAuditPath(3, leafHashes);

    // index 3 verifies correctly
    expect(
      computeRootFromPath(leafHashes[3], 3, 8, path).equals(expectedRoot),
    ).toBe(true);
    // index 4 with same path fails
    const wrong = computeRootFromPath(leafHashes[4], 4, 8, path);
    expect(wrong.equals(expectedRoot)).toBe(false);
  });
});

describe("generateAuditPath — invalid inputs", () => {
  it("rejects empty leafHashes", () => {
    expect(() => generateAuditPath(0, [])).toThrow();
  });

  it("rejects leafIndex out of range", () => {
    const leafHashes = [leafHash(Buffer.from("a"))];
    expect(() => generateAuditPath(1, leafHashes)).toThrow();
    expect(() => generateAuditPath(-1, leafHashes)).toThrow();
  });
});
