/**
 * core-settlement 签名/验签直接单测（此前仅被 ledger/escrow 间接覆盖）。
 *
 * signing.js 是「无有效签名伪造不了转账/增发」这一安全声明的实现核心。本文件直接
 * 钉住其契约：canonical 字节含 DOMAIN_PREFIX("SETTLE:") 与 ledgerId（域分隔 + 跨账本
 * 防重放）、字段顺序无关（JCS）、from==null 归一、签名往返、以及关键的篡改检测——
 * 改 amount/to/from/nonce/kind/ledgerId 任一字段都使既有签名失效，错误私钥伪造失败，
 * sig 非 64 字节 / 空 / Uint8Array 各分支。
 */

import { describe, it, expect } from "vitest";

const {
  DOMAIN_PREFIX,
  ALG,
  canonicalizeEntry,
  signEntry,
  verifyEntry,
} = require("../lib/signing.js");
const { makeMember } = require("./helpers/fixtures.js");

const alice = makeMember("did:cc:alice");
const bob = makeMember("did:cc:bob");

function transferCore(overrides = {}) {
  return {
    ledgerId: "fed-1",
    kind: "transfer",
    from: alice.did,
    to: bob.did,
    amount: 100,
    nonce: "n1",
    ...overrides,
  };
}

describe("canonicalizeEntry", () => {
  it("starts with the SETTLE domain prefix", () => {
    const bytes = canonicalizeEntry(transferCore());
    expect(DOMAIN_PREFIX.toString("utf-8")).toBe("SETTLE:");
    expect(bytes.subarray(0, DOMAIN_PREFIX.length).equals(DOMAIN_PREFIX)).toBe(true);
  });

  it("is deterministic and field-order independent (JCS)", () => {
    const a = canonicalizeEntry({
      ledgerId: "L", kind: "transfer", from: "x", to: "y", amount: 5, nonce: "z",
    });
    const b = canonicalizeEntry({
      nonce: "z", amount: 5, to: "y", from: "x", kind: "transfer", ledgerId: "L",
    });
    expect(a.equals(b)).toBe(true);
  });

  it("treats omitted from and explicit null from identically (mint/genesis)", () => {
    const withNull = canonicalizeEntry({
      ledgerId: "L", kind: "mint", from: null, to: "y", amount: 1, nonce: "g",
    });
    const omitted = canonicalizeEntry({
      ledgerId: "L", kind: "mint", to: "y", amount: 1, nonce: "g",
    });
    expect(withNull.equals(omitted)).toBe(true);
  });

  it("binds to ledgerId — different ledger yields different bytes", () => {
    const a = canonicalizeEntry(transferCore({ ledgerId: "fed-1" }));
    const b = canonicalizeEntry(transferCore({ ledgerId: "fed-2" }));
    expect(a.equals(b)).toBe(false);
  });

  it("throws on non-object input", () => {
    expect(() => canonicalizeEntry(null)).toThrow(TypeError);
    expect(() => canonicalizeEntry("nope")).toThrow(TypeError);
  });
});

describe("signEntry / verifyEntry round-trip", () => {
  it("a signature by the payer verifies with the payer's jwk", () => {
    const core = transferCore();
    const sig = signEntry(core, alice.secretKey);
    expect(sig.length).toBe(64);
    expect(verifyEntry(core, sig, alice.pubkeyJwk)).toBe(true);
  });

  it("accepts a Uint8Array signature (sql.js BLOB shape)", () => {
    const core = transferCore();
    const sig = signEntry(core, alice.secretKey);
    expect(verifyEntry(core, new Uint8Array(sig), alice.pubkeyJwk)).toBe(true);
  });
});

describe("tamper detection — no field may change after signing", () => {
  const core = transferCore();
  const sig = signEntry(core, alice.secretKey);

  it.each([
    ["amount", { amount: 101 }],
    ["to", { to: "did:cc:mallory" }],
    ["from", { from: bob.did }],
    ["nonce", { nonce: "n2" }],
    ["kind", { kind: "mint" }],
    ["ledgerId", { ledgerId: "fed-2" }],
  ])("rejects when %s is altered", (_field, override) => {
    expect(verifyEntry(transferCore(override), sig, alice.pubkeyJwk)).toBe(false);
  });
});

describe("forgery resistance", () => {
  it("a signature made with the wrong secret key fails against the payer jwk", () => {
    const core = transferCore();
    const forged = signEntry(core, bob.secretKey); // 用 bob 的私钥伪造 alice 的转账
    expect(verifyEntry(core, forged, alice.pubkeyJwk)).toBe(false);
  });

  it("a valid signature fails against a different member's jwk", () => {
    const core = transferCore();
    const sig = signEntry(core, alice.secretKey);
    expect(verifyEntry(core, sig, bob.pubkeyJwk)).toBe(false);
  });
});

describe("verifyEntry edge cases", () => {
  const core = transferCore();

  it("rejects a signature whose length is not 64 bytes", () => {
    expect(verifyEntry(core, Buffer.alloc(10), alice.pubkeyJwk)).toBe(false);
    expect(verifyEntry(core, Buffer.alloc(65), alice.pubkeyJwk)).toBe(false);
  });

  it("rejects null/empty signature without throwing", () => {
    expect(verifyEntry(core, null, alice.pubkeyJwk)).toBe(false);
    expect(verifyEntry(core, Buffer.alloc(0), alice.pubkeyJwk)).toBe(false);
  });

  it("exports the ed25519 algorithm identifier", () => {
    expect(typeof ALG).toBe("string");
    expect(ALG.length).toBeGreaterThan(0);
  });
});
