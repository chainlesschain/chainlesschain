import { describe, it, expect } from "vitest";

const {
  sha256,
  leafHash,
  nodeHash,
  encodeHashStr,
  decodeHashStr,
} = require("../lib/hash.js");

describe("sha256", () => {
  it("matches FIPS 180-4 known vector for empty input", () => {
    // SHA-256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
    const out = sha256(Buffer.alloc(0));
    expect(out.toString("hex")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("matches NIST vector for 'abc'", () => {
    // SHA-256("abc") = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
    const out = sha256(Buffer.from("abc", "utf-8"));
    expect(out.toString("hex")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("leafHash (RFC 6962 §2.1)", () => {
  it("leaf hash of empty data = SHA-256(0x00)", () => {
    // Well-known: leafHash("") = 6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d
    const out = leafHash(Buffer.alloc(0));
    expect(out.toString("hex")).toBe(
      "6e340b9cffb37a989ca544e6bb780a2c78901d3fb33738768511a30617afa01d",
    );
  });

  it("rejects non-Buffer input", () => {
    expect(() => leafHash("hello")).toThrow(/Buffer/);
  });

  it("output is always 32 bytes", () => {
    const out = leafHash(Buffer.from("anything"));
    expect(out.length).toBe(32);
  });
});

describe("nodeHash (RFC 6962 §2.1)", () => {
  it("rejects inputs that are not 32 bytes", () => {
    expect(() => nodeHash(Buffer.alloc(0), Buffer.alloc(32))).toThrow(/32/);
    expect(() => nodeHash(Buffer.alloc(32), Buffer.alloc(31))).toThrow(/32/);
  });

  it("output is always 32 bytes", () => {
    const left = Buffer.alloc(32, 0xaa);
    const right = Buffer.alloc(32, 0xbb);
    expect(nodeHash(left, right).length).toBe(32);
  });

  it("differs from concat-without-prefix (domain separation)", () => {
    const left = Buffer.alloc(32, 0xaa);
    const right = Buffer.alloc(32, 0xbb);
    const withPrefix = nodeHash(left, right);
    const withoutPrefix = sha256(Buffer.concat([left, right]));
    expect(withPrefix.equals(withoutPrefix)).toBe(false);
  });

  it("differs from leafHash output for the same bytes (cross-domain attack mitigation)", () => {
    const left = Buffer.alloc(32, 0x00);
    const right = Buffer.alloc(32, 0x00);
    const node = nodeHash(left, right);
    const concatenated = Buffer.concat([left, right]);
    const leaf = leafHash(concatenated);
    expect(node.equals(leaf)).toBe(false);
  });
});

describe("encodeHashStr / decodeHashStr", () => {
  it("round-trips a 32-byte buffer", () => {
    const buf = sha256(Buffer.from("hello"));
    const s = encodeHashStr(buf);
    expect(s).toMatch(/^sha256:/);
    const decoded = decodeHashStr(s);
    expect(decoded.equals(buf)).toBe(true);
  });

  it("uses base64url without padding", () => {
    const buf = Buffer.alloc(32, 0xff);
    const s = encodeHashStr(buf);
    expect(s).not.toMatch(/=/);
    expect(s).not.toMatch(/\+/);
    expect(s).not.toMatch(/\//);
  });

  it("rejects strings without sha256: prefix", () => {
    expect(() => decodeHashStr("xyz")).toThrow(/sha256:/);
  });

  it("rejects payload that doesn't decode to 32 bytes", () => {
    expect(() => decodeHashStr("sha256:abc")).toThrow(/32 bytes/);
  });

  it("rejects non-32-byte Buffer in encode", () => {
    expect(() => encodeHashStr(Buffer.alloc(16))).toThrow(/32-byte/);
  });
});
