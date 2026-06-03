import { describe, it, expect } from "vitest";

const {
  validatePolicy,
  normalizePolicy,
  SUPPORTED_ALGS,
  DEFAULT_EXPIRY_MS,
} = require("../lib/policy.js");
const { makeEd25519Member, makeSlhDsaMember } = require("./helpers/fixtures.js");

describe("policy validation", () => {
  const okMembers = [
    makeEd25519Member(0),
    makeEd25519Member(1),
  ].map((m) => ({ did: m.did, alg: m.alg, pubkeyJwk: m.pubkeyJwk }));

  it("accepts valid 2-of-3 policy", () => {
    const policy = {
      domain: "marketplace.purchase",
      m: 2,
      n: 3,
      members: [
        ...okMembers,
        (() => {
          const m = makeEd25519Member(2);
          return { did: m.did, alg: m.alg, pubkeyJwk: m.pubkeyJwk };
        })(),
      ],
    };
    expect(() => validatePolicy(policy)).not.toThrow();
  });

  it("rejects m=0", () => {
    expect(() =>
      validatePolicy({ domain: "x", m: 0, n: 1, members: [okMembers[0]] }),
    ).toThrow(RangeError);
  });

  it("rejects m > n", () => {
    expect(() =>
      validatePolicy({ domain: "x", m: 3, n: 2, members: okMembers }),
    ).toThrow(RangeError);
  });

  it("rejects empty domain", () => {
    expect(() =>
      validatePolicy({ domain: "", m: 1, n: 1, members: [okMembers[0]] }),
    ).toThrow(TypeError);
  });

  it("rejects duplicate did in members", () => {
    expect(() =>
      validatePolicy({
        domain: "x",
        m: 1,
        n: 2,
        members: [okMembers[0], okMembers[0]],
      }),
    ).toThrow(RangeError);
  });

  it("rejects member with unknown alg", () => {
    expect(() =>
      validatePolicy({
        domain: "x",
        m: 1,
        n: 1,
        members: [{ ...okMembers[0], alg: "RSA-2048" }],
      }),
    ).toThrow(RangeError);
  });

  it("rejects n mismatch", () => {
    expect(() =>
      validatePolicy({ domain: "x", m: 1, n: 3, members: [okMembers[0]] }),
    ).toThrow(RangeError);
  });

  it("rejects requirePqc=true without SLH-DSA member", () => {
    expect(() =>
      validatePolicy({
        domain: "x",
        m: 1,
        n: 1,
        members: [okMembers[0]],
        requirePqc: true,
      }),
    ).toThrow(RangeError);
  });

  it("accepts requirePqc=true with at least one SLH-DSA member", () => {
    const pqc = makeSlhDsaMember(0);
    expect(() =>
      validatePolicy({
        domain: "x",
        m: 1,
        n: 2,
        members: [
          okMembers[0],
          { did: pqc.did, alg: pqc.alg, pubkeyJwk: pqc.pubkeyJwk },
        ],
        requirePqc: true,
      }),
    ).not.toThrow();
  });

  it("rejects non-positive defaultExpiryMs", () => {
    expect(() =>
      validatePolicy({
        domain: "x",
        m: 1,
        n: 1,
        members: [okMembers[0]],
        defaultExpiryMs: 0,
      }),
    ).toThrow(RangeError);
    expect(() =>
      validatePolicy({
        domain: "x",
        m: 1,
        n: 1,
        members: [okMembers[0]],
        defaultExpiryMs: -10,
      }),
    ).toThrow(RangeError);
  });
});

describe("policy normalize", () => {
  it("fills defaults — algorithms + defaultExpiryMs + requirePqc", () => {
    const m1 = makeEd25519Member(0);
    const out = normalizePolicy({
      domain: "x",
      m: 1,
      n: 1,
      members: [{ did: m1.did, alg: m1.alg, pubkeyJwk: m1.pubkeyJwk }],
    });
    expect(out.algorithms).toEqual(["Ed25519"]);
    expect(out.defaultExpiryMs).toBe(DEFAULT_EXPIRY_MS);
    expect(out.requirePqc).toBe(false);
  });

  it("preserves provided algorithms", () => {
    const m1 = makeEd25519Member(0);
    const out = normalizePolicy({
      domain: "x",
      m: 1,
      n: 1,
      members: [{ did: m1.did, alg: m1.alg, pubkeyJwk: m1.pubkeyJwk }],
      algorithms: ["Ed25519"],
    });
    expect(out.algorithms).toEqual(["Ed25519"]);
  });

  it("doesn't mutate input", () => {
    const m1 = makeEd25519Member(0);
    const input = {
      domain: "x",
      m: 1,
      n: 1,
      members: [{ did: m1.did, alg: m1.alg, pubkeyJwk: m1.pubkeyJwk }],
    };
    const before = JSON.stringify(input);
    normalizePolicy(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe("policy constants", () => {
  it("SUPPORTED_ALGS contains both Ed25519 and SLH-DSA-SHA2-128F", () => {
    expect(SUPPORTED_ALGS).toContain("Ed25519");
    expect(SUPPORTED_ALGS).toContain("SLH-DSA-SHA2-128F");
  });

  it("DEFAULT_EXPIRY_MS is 24h", () => {
    expect(DEFAULT_EXPIRY_MS).toBe(24 * 60 * 60 * 1000);
  });
});
