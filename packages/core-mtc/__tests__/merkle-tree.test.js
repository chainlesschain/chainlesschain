import { describe, it, expect } from "vitest";

const {
  MerkleTree,
  mth,
  computeRootFromPath,
} = require("../lib/merkle.js");
const { leafHash } = require("../lib/hash.js");

function makeLeaves(n) {
  return Array.from({ length: n }, (_, i) =>
    Buffer.from(`leaf-${i}`, "utf-8"),
  );
}

describe("MerkleTree class", () => {
  it("rejects empty leaf list", () => {
    expect(() => new MerkleTree([])).toThrow();
  });

  it("rejects non-32-byte leaf", () => {
    expect(() => new MerkleTree([Buffer.alloc(16)])).toThrow();
  });

  it("size returns leaf count", () => {
    const data = makeLeaves(7);
    const tree = new MerkleTree(data.map(leafHash));
    expect(tree.size).toBe(7);
  });

  it("root() agrees with mth()", () => {
    const data = makeLeaves(13);
    const tree = new MerkleTree(data.map(leafHash));
    expect(tree.root().equals(mth(data))).toBe(true);
  });

  it("prove(i) + computeRootFromPath round-trip for every leaf, sizes 1..50", () => {
    for (let n = 1; n <= 50; n++) {
      const data = makeLeaves(n);
      const leafHashes = data.map(leafHash);
      const tree = new MerkleTree(leafHashes);
      const root = tree.root();
      for (let i = 0; i < n; i++) {
        const path = tree.prove(i);
        const computed = computeRootFromPath(leafHashes[i], i, n, path);
        expect(computed.equals(root)).toBe(true);
      }
    }
  });

  it("memo reuses subtree hashes — second prove() doesn't redo nodeHash work", () => {
    const data = makeLeaves(64);
    const tree = new MerkleTree(data.map(leafHash));
    tree.root(); // primes the memo
    const memoSizeBefore = tree._memo.size;
    for (let i = 0; i < 64; i++) tree.prove(i);
    // Generating all 64 paths should not grow the memo beyond what root() built
    expect(tree._memo.size).toBe(memoSizeBefore);
  });
});

describe("MerkleTree performance — large trees finish quickly", () => {
  it("size=8192: full root + all paths under 2 seconds", () => {
    const data = makeLeaves(8192);
    const leafHashes = data.map(leafHash);
    const start = Date.now();
    const tree = new MerkleTree(leafHashes);
    const root = tree.root();
    for (let i = 0; i < 8192; i++) {
      const path = tree.prove(i);
      // Light assertion to avoid optimizer skipping the call
      if (path.length === 0) throw new Error("unexpected empty path");
    }
    const elapsed = Date.now() - start;
    expect(root.length).toBe(32);
    expect(elapsed).toBeLessThan(2000);
  }, 10000); // 10s test timeout (vs 2s assertion ceiling)

  it("size=1024: single prove() under 5ms post-build", () => {
    const data = makeLeaves(1024);
    const leafHashes = data.map(leafHash);
    const tree = new MerkleTree(leafHashes);
    tree.root(); // build memo
    const start = Date.now();
    tree.prove(500);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(5);
  });
});

describe("MerkleTree determinism", () => {
  it("two trees over same input produce identical roots", () => {
    const data = makeLeaves(100);
    const lh = data.map(leafHash);
    const t1 = new MerkleTree(lh);
    const t2 = new MerkleTree([...lh]);
    expect(t1.root().equals(t2.root())).toBe(true);
  });

  it("changing one leaf changes the root", () => {
    const data = makeLeaves(100);
    const lh1 = data.map(leafHash);
    const lh2 = [...lh1];
    lh2[42] = leafHash(Buffer.from("different"));
    const r1 = new MerkleTree(lh1).root();
    const r2 = new MerkleTree(lh2).root();
    expect(r1.equals(r2)).toBe(false);
  });

  it("reordering leaves changes the root (order matters)", () => {
    const data = makeLeaves(8);
    const lh1 = data.map(leafHash);
    const lh2 = [lh1[1], lh1[0], ...lh1.slice(2)];
    const r1 = new MerkleTree(lh1).root();
    const r2 = new MerkleTree(lh2).root();
    expect(r1.equals(r2)).toBe(false);
  });
});
