"use strict";

const { sha256, leafHash, nodeHash } = require("./hash.js");

/**
 * Largest power of 2 strictly less than n.
 * Per RFC 6962 §2.1: split point k for trees with n > 1.
 */
function largestPow2LessThan(n) {
  if (!Number.isInteger(n) || n < 2) {
    throw new RangeError("largestPow2LessThan: n must be integer ≥ 2");
  }
  let k = 1;
  while (k * 2 < n) k *= 2;
  return k;
}

/**
 * MerkleTree — RFC 6962 tree built once, reused for many proofs.
 *
 * Build is O(n) hash ops (tracks subtree roots in a memo);
 * prove(i) is O(log n) using cached subtree roots.
 */
class MerkleTree {
  /**
   * @param {Buffer[]} leafHashes - already-hashed leaves (leafHash output)
   */
  constructor(leafHashes) {
    if (!Array.isArray(leafHashes) || leafHashes.length === 0) {
      throw new RangeError("MerkleTree: leafHashes must be non-empty array");
    }
    for (const h of leafHashes) {
      if (!Buffer.isBuffer(h) || h.length !== 32) {
        throw new TypeError("MerkleTree: each leaf hash must be 32-byte Buffer");
      }
    }
    this._leaves = leafHashes;
    this._memo = new Map();
  }

  get size() {
    return this._leaves.length;
  }

  root() {
    return this._mthRange(0, this._leaves.length);
  }

  /**
   * Generate audit path for leafIndex.
   * Path order: deepest sibling first, topmost sibling last.
   */
  prove(leafIndex) {
    if (
      !Number.isInteger(leafIndex) ||
      leafIndex < 0 ||
      leafIndex >= this._leaves.length
    ) {
      throw new RangeError("prove: leafIndex out of range");
    }
    const path = [];
    this._collectPath(leafIndex, 0, this._leaves.length, path);
    return path;
  }

  _mthRange(start, end) {
    const key = (start << 22) | end; // packed key (works for n up to 4M)
    const cached = this._memo.get(key);
    if (cached) return cached;
    const len = end - start;
    let result;
    if (len === 1) {
      result = this._leaves[start];
    } else {
      const k = largestPow2LessThan(len);
      const left = this._mthRange(start, start + k);
      const right = this._mthRange(start + k, end);
      result = nodeHash(left, right);
    }
    this._memo.set(key, result);
    return result;
  }

  _collectPath(m, start, end, path) {
    const len = end - start;
    if (len <= 1) return;
    const k = largestPow2LessThan(len);
    const offset = m - start;
    if (offset < k) {
      // leaf is in left subtree
      this._collectPath(m, start, start + k, path);
      path.push(this._mthRange(start + k, end));
    } else {
      // leaf is in right subtree
      this._collectPath(m, start + k, end, path);
      path.push(this._mthRange(start, start + k));
    }
  }
}

/**
 * Compute MTH from raw leaf bytes (applies leafHash internally).
 */
function mth(rawLeaves) {
  if (!Array.isArray(rawLeaves)) {
    throw new TypeError("mth: input must be Array");
  }
  if (rawLeaves.length === 0) {
    return sha256(Buffer.alloc(0));
  }
  return new MerkleTree(rawLeaves.map((b) => leafHash(b))).root();
}

/**
 * Compute MTH from already-hashed leaves.
 */
function mthFromLeafHashes(leafHashes) {
  if (!Array.isArray(leafHashes)) {
    throw new TypeError("mthFromLeafHashes: input must be Array");
  }
  if (leafHashes.length === 0) {
    return sha256(Buffer.alloc(0));
  }
  return new MerkleTree(leafHashes).root();
}

/**
 * Generate audit path for one leaf. Convenience wrapper.
 * For batch operations on the same tree, prefer building one MerkleTree
 * and calling prove() multiple times.
 */
function generateAuditPath(leafIndex, leafHashes) {
  return new MerkleTree(leafHashes).prove(leafIndex);
}

/**
 * Compute root hash from a leaf hash + audit path.
 * Pure function: zero network, zero state.
 */
function computeRootFromPath(leaf, leafIndex, treeSize, auditPath) {
  if (!Buffer.isBuffer(leaf) || leaf.length !== 32) {
    throw new TypeError("computeRootFromPath: leaf must be 32-byte Buffer");
  }
  if (!Number.isInteger(treeSize) || treeSize < 1) {
    const e = new Error("BAD_TREE_SIZE");
    e.code = "BAD_TREE_SIZE";
    throw e;
  }
  if (
    !Number.isInteger(leafIndex) ||
    leafIndex < 0 ||
    leafIndex >= treeSize
  ) {
    const e = new Error("BAD_PROOF_INDEX");
    e.code = "BAD_PROOF_INDEX";
    throw e;
  }
  if (!Array.isArray(auditPath)) {
    throw new TypeError("computeRootFromPath: auditPath must be Array");
  }

  if (treeSize === 1) {
    if (auditPath.length !== 0) {
      const e = new Error("BAD_PROOF_LENGTH");
      e.code = "BAD_PROOF_LENGTH";
      throw e;
    }
    return leaf;
  }

  // Determine left/right at each split, top-down
  const splits = [];
  let m = leafIndex;
  let n = treeSize;
  while (n > 1) {
    const k = largestPow2LessThan(n);
    if (m < k) {
      splits.push("L");
      n = k;
    } else {
      splits.push("R");
      m = m - k;
      n = n - k;
    }
  }

  if (auditPath.length !== splits.length) {
    const e = new Error("BAD_PROOF_LENGTH");
    e.code = "BAD_PROOF_LENGTH";
    e.expected = splits.length;
    e.actual = auditPath.length;
    throw e;
  }

  let acc = leaf;
  for (let i = 0; i < auditPath.length; i++) {
    const sibling = auditPath[i];
    if (!Buffer.isBuffer(sibling) || sibling.length !== 32) {
      throw new TypeError(
        `computeRootFromPath: auditPath[${i}] must be 32-byte Buffer`,
      );
    }
    const splitSide = splits[splits.length - 1 - i];
    if (splitSide === "L") {
      acc = nodeHash(acc, sibling);
    } else {
      acc = nodeHash(sibling, acc);
    }
  }
  return acc;
}

module.exports = {
  largestPow2LessThan,
  MerkleTree,
  mth,
  mthFromLeafHashes,
  generateAuditPath,
  computeRootFromPath,
};
