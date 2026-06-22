/**
 * core-mtc verifier 直接单测（此前仅经 e2e/publisher-signature 间接覆盖）。
 *
 * verifier.verify 是 MTC 信封的纯验证函数（Merkle 包含证明 + landmark 校验），按
 * 数据格式 §11 返回 10 种错误码之一或 {ok:true}。这里逐一钉住每个错误码分支、
 * recoverable 标志，以及单叶树（size=1, index=0, 空 audit_path → root==leafHash）
 * 的成功路径。纯函数（除 cache.lookup），不触网络/不验签名。
 */

import { describe, it, expect } from "vitest";

const { verify } = require("../lib/verifier.js");
const { leafHash, encodeHashStr } = require("../lib/hash.js");
const { jcs } = require("../lib/jcs.js");

const LEAF = { did: "did:cc:x", v: 1 };
const LEAF_HASH = leafHash(jcs(LEAF));
// 单叶 Merkle 树：根 == 叶哈希
const ROOT = encodeHashStr(LEAF_HASH);
const NS = "mtc/v1/did/123456";

function treeHead(over = {}) {
  return {
    tree_size: 1,
    root_hash: ROOT,
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
    ...over,
  };
}

function cacheOf(th) {
  return { lookup: () => th };
}

function envelope(over = {}) {
  return {
    schema: "mtc-envelope/v1",
    namespace: NS,
    tree_head_id: "th-1",
    leaf: LEAF,
    inclusion_proof: { leaf_index: 0, tree_size: 1, audit_path: [] },
    ...over,
  };
}

const NOW = Date.now();

describe("verify — happy path", () => {
  it("accepts a valid single-leaf inclusion proof", () => {
    const r = verify(envelope(), cacheOf(treeHead()), { now: NOW });
    expect(r.ok).toBe(true);
    expect(r.leaf).toEqual(LEAF);
    expect(r.treeHead.tree_size).toBe(1);
  });

  it("defaults now to Date.now() when options omitted", () => {
    expect(verify(envelope(), cacheOf(treeHead())).ok).toBe(true);
  });
});

describe("verify — schema / namespace / tree_head guards", () => {
  it("UNKNOWN_SCHEMA for null / non-object / wrong schema", () => {
    expect(verify(null, cacheOf(treeHead())).code).toBe("UNKNOWN_SCHEMA");
    expect(verify("nope", cacheOf(treeHead())).code).toBe("UNKNOWN_SCHEMA");
    expect(verify(envelope({ schema: "x" }), cacheOf(treeHead())).code).toBe("UNKNOWN_SCHEMA");
  });

  it("BAD_NAMESPACE when namespace fails the pattern", () => {
    const r = verify(envelope({ namespace: "bad/ns" }), cacheOf(treeHead()));
    expect(r.code).toBe("BAD_NAMESPACE");
    expect(r.recoverable).toBe(false);
  });

  it("BAD_TREE_HEAD when tree_head_id is not a string", () => {
    expect(verify(envelope({ tree_head_id: 123 }), cacheOf(treeHead())).code).toBe("BAD_TREE_HEAD");
  });

  it("throws TypeError when cache has no lookup()", () => {
    expect(() => verify(envelope(), {})).toThrow(TypeError);
  });
});

describe("verify — landmark lookup", () => {
  it("LANDMARK_MISS (recoverable) when tree head not in cache", () => {
    const r = verify(envelope(), cacheOf(null), { now: NOW });
    expect(r.code).toBe("LANDMARK_MISS");
    expect(r.recoverable).toBe(true);
  });

  it("LANDMARK_EXPIRED when expires_at is in the past", () => {
    const past = new Date(NOW - 1000).toISOString();
    const r = verify(envelope(), cacheOf(treeHead({ expires_at: past })), { now: NOW });
    expect(r.code).toBe("LANDMARK_EXPIRED");
    expect(r.recoverable).toBe(false);
  });

  it("LANDMARK_EXPIRED when expires_at is unparseable", () => {
    const r = verify(envelope(), cacheOf(treeHead({ expires_at: "not-a-date" })), { now: NOW });
    expect(r.code).toBe("LANDMARK_EXPIRED");
  });
});

describe("verify — inclusion proof shape", () => {
  it("BAD_PROOF_INDEX when proof is missing or malformed", () => {
    expect(verify(envelope({ inclusion_proof: null }), cacheOf(treeHead())).code).toBe("BAD_PROOF_INDEX");
    expect(verify(envelope({ inclusion_proof: { leaf_index: "0", tree_size: 1, audit_path: [] } }),
      cacheOf(treeHead())).code).toBe("BAD_PROOF_INDEX");
  });

  it("PROOF_TREE_SIZE_MISMATCH (recoverable) when proof tree_size != tree head", () => {
    const r = verify(
      envelope({ inclusion_proof: { leaf_index: 0, tree_size: 2, audit_path: [] } }),
      cacheOf(treeHead({ tree_size: 1 })), { now: NOW });
    expect(r.code).toBe("PROOF_TREE_SIZE_MISMATCH");
    expect(r.recoverable).toBe(true);
  });

  it("BAD_PROOF_INDEX when leaf_index is out of range", () => {
    const r = verify(
      envelope({ inclusion_proof: { leaf_index: 1, tree_size: 1, audit_path: [] } }),
      cacheOf(treeHead()), { now: NOW });
    expect(r.code).toBe("BAD_PROOF_INDEX");
  });
});

describe("verify — leaf / proof / root", () => {
  it("BAD_LEAF when leaf is missing", () => {
    expect(verify(envelope({ leaf: null }), cacheOf(treeHead()), { now: NOW }).code).toBe("BAD_LEAF");
  });

  it("BAD_PROOF_LENGTH when an audit_path entry is undecodable", () => {
    const r = verify(
      envelope({ inclusion_proof: { leaf_index: 0, tree_size: 1, audit_path: ["!!not-a-hash!!"] } }),
      cacheOf(treeHead()), { now: NOW });
    expect(r.code).toBe("BAD_PROOF_LENGTH");
  });

  it("BAD_TREE_HEAD when stored root_hash is undecodable", () => {
    const r = verify(envelope(), cacheOf(treeHead({ root_hash: "!!bad!!" })), { now: NOW });
    expect(r.code).toBe("BAD_TREE_HEAD");
  });

  it("ROOT_MISMATCH when computed root differs from tree head root", () => {
    const otherRoot = encodeHashStr(leafHash(jcs({ did: "did:cc:other", v: 9 })));
    const r = verify(envelope(), cacheOf(treeHead({ root_hash: otherRoot })), { now: NOW });
    expect(r.code).toBe("ROOT_MISMATCH");
    expect(r.recoverable).toBe(false);
  });
});
