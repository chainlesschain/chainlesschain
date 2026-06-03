import { describe, it, expect } from "vitest";

const {
  canonicalizeForSigning,
  computePayloadHash,
  signRaw,
  verifyOne,
  verifyThreshold,
  DOMAIN_PREFIX,
} = require("../lib/signing.js");
const { makeEd25519Member, makeSlhDsaMember } = require("./helpers/fixtures.js");

describe("canonicalizeForSigning", () => {
  const m0 = makeEd25519Member(0);
  const members = [{ did: m0.did, alg: m0.alg, pubkeyJwk: m0.pubkeyJwk }];

  const baseInput = {
    domain: "marketplace.purchase",
    payload: { orderId: "o-1", total: "1500" },
    nonce: "abc123",
    expiresAtMs: 1_700_000_000_000,
    m: 1,
    members,
  };

  it("returns Buffer with DOMAIN_PREFIX", () => {
    const out = canonicalizeForSigning(baseInput);
    expect(Buffer.isBuffer(out)).toBe(true);
    expect(out.subarray(0, DOMAIN_PREFIX.length).equals(DOMAIN_PREFIX)).toBe(true);
  });

  it("two equal inputs produce identical bytes (JCS determinism)", () => {
    const a = canonicalizeForSigning(baseInput);
    const b = canonicalizeForSigning({ ...baseInput });
    expect(a.equals(b)).toBe(true);
  });

  it("differing payload produces different bytes", () => {
    const a = canonicalizeForSigning(baseInput);
    const b = canonicalizeForSigning({
      ...baseInput,
      payload: { ...baseInput.payload, total: "2000" },
    });
    expect(a.equals(b)).toBe(false);
  });

  it("differing nonce produces different bytes (replay defense)", () => {
    const a = canonicalizeForSigning(baseInput);
    const b = canonicalizeForSigning({ ...baseInput, nonce: "different" });
    expect(a.equals(b)).toBe(false);
  });

  it("member key order doesn't affect canonicalization (JCS sorts keys)", () => {
    // JCS sorts object keys deterministically — payload field reordering must
    // not change output
    const a = canonicalizeForSigning(baseInput);
    const b = canonicalizeForSigning({
      ...baseInput,
      payload: { total: "1500", orderId: "o-1" }, // reordered
    });
    expect(a.equals(b)).toBe(true);
  });

  it("throws on null input", () => {
    expect(() => canonicalizeForSigning(null)).toThrow(TypeError);
  });
});

describe("computePayloadHash", () => {
  it("returns 32-byte sha256 buffer", () => {
    const m0 = makeEd25519Member(0);
    const hash = computePayloadHash({
      domain: "x",
      payload: { a: 1 },
      nonce: "n",
      expiresAtMs: 0,
      m: 1,
      members: [{ did: m0.did, alg: m0.alg, pubkeyJwk: m0.pubkeyJwk }],
    });
    expect(Buffer.isBuffer(hash)).toBe(true);
    expect(hash.length).toBe(32);
  });
});

describe("signRaw + verifyOne (Ed25519)", () => {
  const m = makeEd25519Member(0);
  const input = {
    domain: "x",
    payload: { a: 1 },
    nonce: "n",
    expiresAtMs: 0,
    m: 1,
    members: [{ did: m.did, alg: m.alg, pubkeyJwk: m.pubkeyJwk }],
  };

  it("signRaw + verifyOne roundtrip succeeds", () => {
    const signingInput = canonicalizeForSigning(input);
    const sig = signRaw(signingInput, m._secretKey, m.alg);
    expect(verifyOne(signingInput, sig, m.alg, m.pubkeyJwk)).toBe(true);
  });

  it("verifyOne fails with wrong message", () => {
    const signingInput = canonicalizeForSigning(input);
    const tampered = canonicalizeForSigning({ ...input, nonce: "other" });
    const sig = signRaw(signingInput, m._secretKey, m.alg);
    expect(verifyOne(tampered, sig, m.alg, m.pubkeyJwk)).toBe(false);
  });

  it("verifyOne fails with wrong pubkey", () => {
    const signingInput = canonicalizeForSigning(input);
    const sig = signRaw(signingInput, m._secretKey, m.alg);
    const other = makeEd25519Member(99);
    expect(verifyOne(signingInput, sig, m.alg, other.pubkeyJwk)).toBe(false);
  });

  it("signRaw throws on unsupported alg", () => {
    expect(() => signRaw(Buffer.from("hello"), m._secretKey, "RSA")).toThrow(RangeError);
  });

  it("verifyOne returns false on unsupported alg (not throw)", () => {
    expect(verifyOne(Buffer.from("x"), Buffer.from("y"), "RSA", {})).toBe(false);
  });
});

describe("verifyThreshold", () => {
  it("2-of-3: 2 valid sigs → reached=true", () => {
    const members = [makeEd25519Member(0), makeEd25519Member(1), makeEd25519Member(2)];
    const memberSet = members.map((m) => ({ did: m.did, alg: m.alg, pubkeyJwk: m.pubkeyJwk }));
    const input = {
      domain: "x",
      payload: { a: 1 },
      nonce: "n",
      expiresAtMs: 0,
      m: 2,
      members: memberSet,
    };
    const signingInput = canonicalizeForSigning(input);
    const sigs = [
      { signerDid: members[0].did, sig: signRaw(signingInput, members[0]._secretKey, "Ed25519"), alg: "Ed25519" },
      { signerDid: members[1].did, sig: signRaw(signingInput, members[1]._secretKey, "Ed25519"), alg: "Ed25519" },
    ];
    const result = verifyThreshold(signingInput, sigs, { m: 2, members: memberSet });
    expect(result.reached).toBe(true);
    expect(result.validCount).toBe(2);
    expect(result.validSigners).toEqual([members[0].did, members[1].did].sort());
  });

  it("2-of-3: only 1 valid sig → reached=false", () => {
    const members = [makeEd25519Member(0), makeEd25519Member(1), makeEd25519Member(2)];
    const memberSet = members.map((m) => ({ did: m.did, alg: m.alg, pubkeyJwk: m.pubkeyJwk }));
    const input = {
      domain: "x",
      payload: { a: 1 },
      nonce: "n",
      expiresAtMs: 0,
      m: 2,
      members: memberSet,
    };
    const signingInput = canonicalizeForSigning(input);
    const sigs = [
      { signerDid: members[0].did, sig: signRaw(signingInput, members[0]._secretKey, "Ed25519"), alg: "Ed25519" },
    ];
    const result = verifyThreshold(signingInput, sigs, { m: 2, members: memberSet });
    expect(result.reached).toBe(false);
    expect(result.validCount).toBe(1);
  });

  it("rejects sigs from non-members", () => {
    const members = [makeEd25519Member(0), makeEd25519Member(1)];
    const memberSet = members.map((m) => ({ did: m.did, alg: m.alg, pubkeyJwk: m.pubkeyJwk }));
    const intruder = makeEd25519Member(99);
    const input = {
      domain: "x",
      payload: { a: 1 },
      nonce: "n",
      expiresAtMs: 0,
      m: 1,
      members: memberSet,
    };
    const signingInput = canonicalizeForSigning(input);
    const sigs = [
      { signerDid: intruder.did, sig: signRaw(signingInput, intruder._secretKey, "Ed25519"), alg: "Ed25519" },
    ];
    const result = verifyThreshold(signingInput, sigs, { m: 1, members: memberSet });
    expect(result.reached).toBe(false);
    expect(result.validCount).toBe(0);
  });

  it("dedupes duplicate sigs from same signer", () => {
    const m0 = makeEd25519Member(0);
    const memberSet = [{ did: m0.did, alg: m0.alg, pubkeyJwk: m0.pubkeyJwk }];
    const input = {
      domain: "x",
      payload: { a: 1 },
      nonce: "n",
      expiresAtMs: 0,
      m: 2, // m=2 但只有 1 个 member（unreachable）
      members: memberSet,
    };
    const signingInput = canonicalizeForSigning(input);
    const sig = signRaw(signingInput, m0._secretKey, "Ed25519");
    const result = verifyThreshold(
      signingInput,
      [
        { signerDid: m0.did, sig, alg: "Ed25519" },
        { signerDid: m0.did, sig, alg: "Ed25519" }, // dup
      ],
      { m: 2, members: memberSet },
    );
    expect(result.validCount).toBe(1);
    expect(result.reached).toBe(false);
  });

  it("validSigners is sorted (defense against sig-order replay)", () => {
    const members = [makeEd25519Member(2), makeEd25519Member(0), makeEd25519Member(1)];
    const memberSet = members.map((m) => ({ did: m.did, alg: m.alg, pubkeyJwk: m.pubkeyJwk }));
    const input = {
      domain: "x",
      payload: { a: 1 },
      nonce: "n",
      expiresAtMs: 0,
      m: 3,
      members: memberSet,
    };
    const signingInput = canonicalizeForSigning(input);
    const sigs = members.map((m) => ({
      signerDid: m.did,
      sig: signRaw(signingInput, m._secretKey, "Ed25519"),
      alg: "Ed25519",
    }));
    const result = verifyThreshold(signingInput, sigs, { m: 3, members: memberSet });
    const sorted = [...result.validSigners].sort();
    expect(result.validSigners).toEqual(sorted);
  });

  it("requirePqc=true: 2 Ed25519 sigs but no PQC → reached=false", () => {
    const members = [makeEd25519Member(0), makeEd25519Member(1), makeSlhDsaMember(2)];
    const memberSet = members.map((m) => ({ did: m.did, alg: m.alg, pubkeyJwk: m.pubkeyJwk }));
    const input = {
      domain: "x",
      payload: { a: 1 },
      nonce: "n",
      expiresAtMs: 0,
      m: 2,
      members: memberSet,
    };
    const signingInput = canonicalizeForSigning(input);
    const sigs = [
      { signerDid: members[0].did, sig: signRaw(signingInput, members[0]._secretKey, "Ed25519"), alg: "Ed25519" },
      { signerDid: members[1].did, sig: signRaw(signingInput, members[1]._secretKey, "Ed25519"), alg: "Ed25519" },
    ];
    const result = verifyThreshold(signingInput, sigs, {
      m: 2,
      members: memberSet,
      requirePqc: true,
    });
    expect(result.validCount).toBe(2);
    expect(result.reached).toBe(false);
    expect(result.pqcSatisfied).toBe(false);
  });

  it("requirePqc=true: 1 Ed25519 + 1 PQC sig → reached=true (m=2)", () => {
    const members = [makeEd25519Member(0), makeSlhDsaMember(1)];
    const memberSet = members.map((m) => ({ did: m.did, alg: m.alg, pubkeyJwk: m.pubkeyJwk }));
    const input = {
      domain: "x",
      payload: { a: 1 },
      nonce: "n",
      expiresAtMs: 0,
      m: 2,
      members: memberSet,
    };
    const signingInput = canonicalizeForSigning(input);
    const sigs = [
      { signerDid: members[0].did, sig: signRaw(signingInput, members[0]._secretKey, "Ed25519"), alg: "Ed25519" },
      { signerDid: members[1].did, sig: signRaw(signingInput, members[1]._secretKey, "SLH-DSA-SHA2-128F"), alg: "SLH-DSA-SHA2-128F" },
    ];
    const result = verifyThreshold(signingInput, sigs, {
      m: 2,
      members: memberSet,
      requirePqc: true,
    });
    expect(result.reached).toBe(true);
    expect(result.pqcSatisfied).toBe(true);
  });
});
