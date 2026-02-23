/**
 * ShamirSplit unit tests
 * Tests splitSecret / reconstructSecret using GF(256) M-of-N threshold scheme
 */

import { describe, it, expect } from "vitest";

const crypto = require("crypto");
const { splitSecret, reconstructSecret } = require("../shamir-split");

describe("splitSecret", () => {
  it('returns N shares with "index:hexData" format', () => {
    const secret = Buffer.from("hello world", "utf8");
    const shares = splitSecret(secret, 3, 2);
    expect(shares).toHaveLength(3);
    shares.forEach((s, i) => {
      expect(s).toMatch(/^\d+:[0-9a-f]+$/);
      const [idx] = s.split(":");
      expect(parseInt(idx)).toBe(i + 1);
    });
  });

  it("threshold < 2 → throws", () => {
    expect(() => splitSecret(Buffer.from("test"), 3, 1)).toThrow();
  });

  it("threshold > total → throws", () => {
    expect(() => splitSecret(Buffer.from("test"), 2, 3)).toThrow();
  });

  it("total > 255 → throws", () => {
    expect(() => splitSecret(Buffer.from("x"), 256, 2)).toThrow();
  });

  it("accepts string secret (auto-converts to Buffer)", () => {
    const shares = splitSecret("string secret", 3, 2);
    expect(shares).toHaveLength(3);
  });
});

describe("reconstructSecret", () => {
  it("2-of-3: reconstruct from shares [0, 1]", () => {
    const secret = Buffer.from("my secret data", "utf8");
    const shares = splitSecret(secret, 3, 2);
    const restored = reconstructSecret([shares[0], shares[1]]);
    expect(restored.equals(secret)).toBe(true);
  });

  it("2-of-3: reconstruct from shares [0, 2]", () => {
    const secret = Buffer.from("another secret", "utf8");
    const shares = splitSecret(secret, 3, 2);
    const restored = reconstructSecret([shares[0], shares[2]]);
    expect(restored.equals(secret)).toBe(true);
  });

  it("2-of-3: reconstruct from shares [1, 2]", () => {
    const secret = Buffer.from("third combo", "utf8");
    const shares = splitSecret(secret, 3, 2);
    const restored = reconstructSecret([shares[1], shares[2]]);
    expect(restored.equals(secret)).toBe(true);
  });

  it("3-of-5: reconstruct from exactly 3 non-consecutive shares", () => {
    const secret = crypto.randomBytes(32);
    const shares = splitSecret(secret, 5, 3);
    expect(shares).toHaveLength(5);
    const restored = reconstructSecret([shares[0], shares[2], shares[4]]);
    expect(restored.equals(secret)).toBe(true);
  });

  it("single-byte secret round-trip", () => {
    const secret = Buffer.from([0xab]);
    const shares = splitSecret(secret, 3, 2);
    const restored = reconstructSecret([shares[0], shares[1]]);
    expect(restored[0]).toBe(0xab);
  });

  it("32-byte random secret round-trip", () => {
    const secret = crypto.randomBytes(32);
    const shares = splitSecret(secret, 3, 2);
    const restored = reconstructSecret([shares[0], shares[2]]);
    expect(restored.equals(secret)).toBe(true);
  });

  it("fewer shares than threshold → throws", () => {
    const shares = splitSecret(Buffer.from("secret"), 3, 2);
    expect(() => reconstructSecret([shares[0]])).toThrow();
  });

  it("empty / null share array → throws", () => {
    expect(() => reconstructSecret([])).toThrow();
    expect(() => reconstructSecret(null)).toThrow();
  });

  it("all 3 shares reconstruct correctly too (2-of-3)", () => {
    const secret = Buffer.from("full share set", "utf8");
    const shares = splitSecret(secret, 3, 2);
    const restored = reconstructSecret(shares);
    expect(restored.equals(secret)).toBe(true);
  });

  it("different secrets produce different shares", () => {
    const s1 = splitSecret(Buffer.from("secret-A"), 3, 2);
    const s2 = splitSecret(Buffer.from("secret-B"), 3, 2);
    expect(s1[0]).not.toBe(s2[0]);
  });
});
