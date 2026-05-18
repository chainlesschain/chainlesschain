/**
 * Phase 0 — validate @noble/curves schnorr + @scure/base bech32
 * against official Nostr test vectors.
 */

import { describe, it, expect } from "vitest";

const {
  generatePrivateKey,
  getPublicKey,
  serializeEvent,
  getEventHash,
  signEvent,
  verifyEvent,
  npubEncode,
  npubDecode,
  nsecEncode,
  nsecDecode,
  noteEncode,
  noteDecode,
} = require("../lib/nostr-crypto.js");

describe("nostr-crypto: key generation", () => {
  it("generates 32-byte private key (64 hex chars)", () => {
    const priv = generatePrivateKey();
    expect(priv).toMatch(/^[0-9a-f]{64}$/);
  });

  it("derives deterministic 32-byte x-only pubkey from private key", () => {
    const priv = generatePrivateKey();
    const pub1 = getPublicKey(priv);
    const pub2 = getPublicKey(priv);
    expect(pub1).toMatch(/^[0-9a-f]{64}$/);
    expect(pub1).toBe(pub2);
  });

  it("different private keys yield different pubkeys", () => {
    const pub1 = getPublicKey(generatePrivateKey());
    const pub2 = getPublicKey(generatePrivateKey());
    expect(pub1).not.toBe(pub2);
  });
});

describe("nostr-crypto: NIP-01 canonical serialization", () => {
  it("produces compact JSON array with [0, pubkey, ts, kind, tags, content]", () => {
    const event = {
      pubkey: "a".repeat(64),
      created_at: 1700000000,
      kind: 1,
      tags: [["t", "nostr"]],
      content: "hello",
    };
    expect(serializeEvent(event)).toBe(
      `[0,"${"a".repeat(64)}",1700000000,1,[["t","nostr"]],"hello"]`,
    );
  });

  it("rejects ISO-string created_at (must be unix seconds)", () => {
    expect(() =>
      serializeEvent({
        pubkey: "a".repeat(64),
        created_at: "2026-01-01T00:00:00Z",
        kind: 1,
        tags: [],
        content: "",
      }),
    ).toThrow(/unix/i);
  });

  it("throws on missing required fields", () => {
    expect(() => serializeEvent(null)).toThrow();
    expect(() => serializeEvent({ pubkey: "x" })).toThrow();
  });

  it("getEventHash returns 32-byte sha256 hex of serialization", () => {
    const event = {
      pubkey: "a".repeat(64),
      created_at: 1700000000,
      kind: 1,
      tags: [],
      content: "test",
    };
    const hash = getEventHash(event);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("nostr-crypto: schnorr sign + verify round-trip", () => {
  it("signs and verifies a valid event", () => {
    const priv = generatePrivateKey();
    const pub = getPublicKey(priv);
    const draft = {
      pubkey: pub,
      created_at: 1700000000,
      kind: 1,
      tags: [],
      content: "hello nostr",
    };
    const signed = signEvent(draft, priv);
    expect(signed.id).toMatch(/^[0-9a-f]{64}$/);
    expect(signed.sig).toMatch(/^[0-9a-f]{128}$/);
    expect(verifyEvent(signed)).toBe(true);
  });

  it("rejects event with tampered content (id mismatch)", () => {
    const priv = generatePrivateKey();
    const pub = getPublicKey(priv);
    const signed = signEvent(
      { pubkey: pub, created_at: 1700000000, kind: 1, tags: [], content: "original" },
      priv,
    );
    const tampered = { ...signed, content: "tampered" };
    expect(verifyEvent(tampered)).toBe(false);
  });

  it("rejects event signed by different key", () => {
    const privA = generatePrivateKey();
    const privB = generatePrivateKey();
    const pubA = getPublicKey(privA);
    const signed = signEvent(
      { pubkey: pubA, created_at: 1700000000, kind: 1, tags: [], content: "x" },
      privB,
    );
    expect(verifyEvent(signed)).toBe(false);
  });

  it("rejects malformed event input", () => {
    expect(verifyEvent(null)).toBe(false);
    expect(verifyEvent({})).toBe(false);
    expect(verifyEvent({ id: "x", sig: "y", pubkey: "z" })).toBe(false);
  });

  it("sign does not mutate input draft", () => {
    const priv = generatePrivateKey();
    const pub = getPublicKey(priv);
    const draft = Object.freeze({
      pubkey: pub,
      created_at: 1700000000,
      kind: 1,
      tags: [],
      content: "x",
    });
    expect(() => signEvent(draft, priv)).not.toThrow();
  });
});

describe("nostr-crypto: NIP-19 bech32 encoding (official test vectors)", () => {
  const NPUB_HEX =
    "3bf0c63fcb93463407af97a5e5ee64fa883d107ef9e558472c4eb9aaaefa459d";
  const NPUB_BECH32 =
    "npub180cvv07tjdrrgpa0j7j7tmnyl2yr6yr7l8j4s3evf6u64th6gkwsyjh6w6";
  const NSEC_HEX =
    "67dea2ed018072d675f5415ecfaed7d2597555e202d85b3d65ea4e58d2d92ffa";
  const NSEC_BECH32 =
    "nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5";

  it("encodes npub matching NIP-19 official vector", () => {
    expect(npubEncode(NPUB_HEX)).toBe(NPUB_BECH32);
  });

  it("decodes npub matching NIP-19 official vector", () => {
    expect(npubDecode(NPUB_BECH32)).toBe(NPUB_HEX);
  });

  it("encodes nsec matching NIP-19 official vector", () => {
    expect(nsecEncode(NSEC_HEX)).toBe(NSEC_BECH32);
  });

  it("decodes nsec matching NIP-19 official vector", () => {
    expect(nsecDecode(NSEC_BECH32)).toBe(NSEC_HEX);
  });

  it("round-trips random key through npub", () => {
    const priv = generatePrivateKey();
    const pub = getPublicKey(priv);
    expect(npubDecode(npubEncode(pub))).toBe(pub);
  });

  it("round-trips note id", () => {
    const id = "a".repeat(64);
    expect(noteDecode(noteEncode(id))).toBe(id);
  });

  it("rejects npub decoded as nsec (prefix guard)", () => {
    const npub = npubEncode(NPUB_HEX);
    expect(() => nsecDecode(npub)).toThrow(/prefix/);
  });

  it("rejects bech32 string with invalid checksum", () => {
    const bad = NPUB_BECH32.slice(0, -1) + (NPUB_BECH32.slice(-1) === "6" ? "7" : "6");
    expect(() => npubDecode(bad)).toThrow();
  });
});

describe("nostr-crypto: end-to-end pubkey↔npub↔sign↔verify", () => {
  it("full workflow: generate → encode → sign → decode-peer-npub → verify", () => {
    const priv = generatePrivateKey();
    const pubHex = getPublicKey(priv);
    const npub = npubEncode(pubHex);
    const receivedPubHex = npubDecode(npub);
    expect(receivedPubHex).toBe(pubHex);
    const signed = signEvent(
      {
        pubkey: pubHex,
        created_at: Math.floor(Date.now() / 1000),
        kind: 1,
        tags: [["p", receivedPubHex]],
        content: "integration test",
      },
      priv,
    );
    expect(verifyEvent(signed)).toBe(true);
  });
});
