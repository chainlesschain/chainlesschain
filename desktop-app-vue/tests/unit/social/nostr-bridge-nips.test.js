/**
 * NostrBridge NIP Extension Tests
 *
 * Covers NIP-04 / NIP-09 / NIP-25 helpers layered on top of publishEvent().
 * Uses real Node crypto (secp256k1 ECDH + AES-256-CBC) — this file
 * intentionally does NOT mock "crypto" so encryption round-trips work.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import crypto from "crypto";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("uuid", () => ({ v4: () => "nip-test-uuid" }));

// Deterministic DB stub — records statements but ignores side-effects.
function makeDb() {
  const run = vi.fn();
  const all = vi.fn(() => []);
  const get = vi.fn(() => null);
  return {
    db: {
      exec: vi.fn(),
      prepare: vi.fn(() => ({ run, all, get })),
    },
    _run: run,
  };
}

/**
 * Generate a real secp256k1 x-only keypair for NIP-04 testing.
 */
function generateKeypair() {
  const priv = crypto.randomBytes(32);
  const ecdh = crypto.createECDH("secp256k1");
  ecdh.setPrivateKey(priv);
  const compressed = ecdh.getPublicKey(null, "compressed");
  // x-only pubkey (drop 0x02/0x03 prefix)
  const xOnly = compressed.slice(1);
  return {
    privKeyHex: priv.toString("hex"),
    pubKeyHex: xOnly.toString("hex"),
  };
}

let NostrBridge, EVENT_KINDS;

beforeEach(async () => {
  const mod = await import("../../../src/main/social/nostr-bridge.js");
  NostrBridge = mod.NostrBridge;
  EVENT_KINDS = mod.EVENT_KINDS;
});

describe("NostrBridge NIP-04 (Encrypted DM)", () => {
  it("round-trips a plaintext message between two parties", async () => {
    const alice = generateKeypair();
    const bob = generateKeypair();
    const bridge = new NostrBridge(makeDb());

    const { event } = await bridge.publishDirectMessage({
      senderPrivkey: alice.privKeyHex,
      senderPubkey: alice.pubKeyHex,
      recipientPubkey: bob.pubKeyHex,
      plaintext: "hello bob, this is alice",
    });

    expect(event.kind).toBe(EVENT_KINDS.ENCRYPTED_DM);
    expect(event.pubkey).toBe(alice.pubKeyHex);
    expect(event.tags).toEqual([["p", bob.pubKeyHex]]);
    expect(event.content).toMatch(/^[A-Za-z0-9+/=]+\?iv=[A-Za-z0-9+/=]+$/);

    const recovered = await bridge.decryptDirectMessage({
      event,
      recipientPrivkey: bob.privKeyHex,
    });
    expect(recovered).toBe("hello bob, this is alice");
  });

  it("produces a fresh IV per message (same plaintext encrypts differently)", async () => {
    const alice = generateKeypair();
    const bob = generateKeypair();
    const bridge = new NostrBridge(makeDb());

    const r1 = await bridge.publishDirectMessage({
      senderPrivkey: alice.privKeyHex,
      senderPubkey: alice.pubKeyHex,
      recipientPubkey: bob.pubKeyHex,
      plaintext: "same text",
    });
    const r2 = await bridge.publishDirectMessage({
      senderPrivkey: alice.privKeyHex,
      senderPubkey: alice.pubKeyHex,
      recipientPubkey: bob.pubKeyHex,
      plaintext: "same text",
    });

    expect(r1.event.content).not.toBe(r2.event.content);
  });

  it("handles UTF-8 / emoji / multi-line content", async () => {
    const alice = generateKeypair();
    const bob = generateKeypair();
    const bridge = new NostrBridge(makeDb());

    const plaintext = "你好 Bob 👋\n换行测试\t制表符";
    const { event } = await bridge.publishDirectMessage({
      senderPrivkey: alice.privKeyHex,
      senderPubkey: alice.pubKeyHex,
      recipientPubkey: bob.pubKeyHex,
      plaintext,
    });
    const out = await bridge.decryptDirectMessage({
      event,
      recipientPrivkey: bob.privKeyHex,
    });
    expect(out).toBe(plaintext);
  });

  it("the wrong recipient cannot recover the plaintext", async () => {
    // Note: NIP-04 uses AES-256-CBC without authentication, so decryption
    // with a wrong key may not throw — it yields garbage instead. We assert
    // that the recovered content, whether via throw or corrupt bytes, is
    // never the original plaintext.
    const alice = generateKeypair();
    const bob = generateKeypair();
    const eve = generateKeypair();
    const bridge = new NostrBridge(makeDb());

    const plaintext = "only for bob";
    const { event } = await bridge.publishDirectMessage({
      senderPrivkey: alice.privKeyHex,
      senderPubkey: alice.pubKeyHex,
      recipientPubkey: bob.pubKeyHex,
      plaintext,
    });

    let eveResult = null;
    try {
      eveResult = await bridge.decryptDirectMessage({
        event,
        recipientPrivkey: eve.privKeyHex,
      });
    } catch {
      eveResult = null; // decryption threw — also an acceptable outcome
    }
    expect(eveResult).not.toBe(plaintext);
  });

  it("throws when required fields are missing", async () => {
    const bridge = new NostrBridge(makeDb());
    await expect(
      bridge.publishDirectMessage({
        senderPubkey: "a",
        recipientPubkey: "b",
        plaintext: "x",
      }),
    ).rejects.toThrow(/required/);

    await expect(
      bridge.publishDirectMessage({
        senderPrivkey: "a".repeat(64),
        senderPubkey: "a",
        recipientPubkey: "b",
      }),
    ).rejects.toThrow(/plaintext/);
  });

  it("decryptDirectMessage rejects non-kind-4 events", async () => {
    const bob = generateKeypair();
    const bridge = new NostrBridge(makeDb());
    await expect(
      bridge.decryptDirectMessage({
        event: { kind: 1, pubkey: "deadbeef".repeat(8), content: "x?iv=y" },
        recipientPrivkey: bob.privKeyHex,
      }),
    ).rejects.toThrow(/kind=4/);
  });

  it("decryptDirectMessage rejects malformed content (missing ?iv=)", async () => {
    const bob = generateKeypair();
    const bridge = new NostrBridge(makeDb());
    await expect(
      bridge.decryptDirectMessage({
        event: {
          kind: EVENT_KINDS.ENCRYPTED_DM,
          pubkey: "deadbeef".repeat(8),
          content: "no-iv-separator",
        },
        recipientPrivkey: bob.privKeyHex,
      }),
    ).rejects.toThrow(/NIP-04 content format/);
  });

  it("_computeSharedSecret is symmetric for both parties", () => {
    const alice = generateKeypair();
    const bob = generateKeypair();
    const bridge = new NostrBridge(makeDb());

    const s1 = bridge._computeSharedSecret(alice.privKeyHex, bob.pubKeyHex);
    const s2 = bridge._computeSharedSecret(bob.privKeyHex, alice.pubKeyHex);

    expect(s1.length).toBe(32);
    expect(s1.equals(s2)).toBe(true);
  });
});

describe("NostrBridge NIP-09 (Event Deletion)", () => {
  it("publishes a kind=5 event with one e-tag per eventId", async () => {
    const bridge = new NostrBridge(makeDb());
    const { event } = await bridge.publishDeletion({
      eventIds: ["eventA", "eventB", "eventC"],
      reason: "spam",
      pubkey: "abcd".repeat(16),
    });

    expect(event.kind).toBe(EVENT_KINDS.DELETE);
    expect(event.content).toBe("spam");
    expect(event.tags).toEqual([
      ["e", "eventA"],
      ["e", "eventB"],
      ["e", "eventC"],
    ]);
  });

  it("defaults reason to empty string when omitted", async () => {
    const bridge = new NostrBridge(makeDb());
    const { event } = await bridge.publishDeletion({
      eventIds: ["evt1"],
      pubkey: "ff".repeat(32),
    });
    expect(event.content).toBe("");
  });

  it("throws when eventIds is missing / empty / not an array", async () => {
    const bridge = new NostrBridge(makeDb());
    await expect(bridge.publishDeletion({ eventIds: [] })).rejects.toThrow(
      /non-empty/,
    );
    await expect(
      bridge.publishDeletion({ eventIds: "not-array" }),
    ).rejects.toThrow(/non-empty/);
    await expect(bridge.publishDeletion({})).rejects.toThrow(/non-empty/);
  });
});

describe("NostrBridge NIP-25 (Reactions)", () => {
  it("publishes a kind=7 like (+) with e and p tags", async () => {
    const bridge = new NostrBridge(makeDb());
    const { event } = await bridge.publishReaction({
      targetEventId: "targetEvt",
      targetPubkey: "targetAuthor",
      pubkey: "reactorPubkey",
    });

    expect(event.kind).toBe(EVENT_KINDS.REACTION);
    expect(event.content).toBe("+");
    expect(event.tags).toEqual([
      ["e", "targetEvt"],
      ["p", "targetAuthor"],
    ]);
    expect(event.pubkey).toBe("reactorPubkey");
  });

  it("accepts custom emoji / shortcode content", async () => {
    const bridge = new NostrBridge(makeDb());
    const { event: heart } = await bridge.publishReaction({
      targetEventId: "e1",
      targetPubkey: "a1",
      content: "❤️",
      pubkey: "me",
    });
    const { event: rocket } = await bridge.publishReaction({
      targetEventId: "e1",
      targetPubkey: "a1",
      content: ":rocket:",
      pubkey: "me",
    });

    expect(heart.content).toBe("❤️");
    expect(rocket.content).toBe(":rocket:");
  });

  it("accepts dislike (-) content", async () => {
    const bridge = new NostrBridge(makeDb());
    const { event } = await bridge.publishReaction({
      targetEventId: "e1",
      targetPubkey: "a1",
      content: "-",
      pubkey: "me",
    });
    expect(event.content).toBe("-");
  });

  it("throws when targetEventId or targetPubkey is missing", async () => {
    const bridge = new NostrBridge(makeDb());
    await expect(
      bridge.publishReaction({ targetPubkey: "a1", pubkey: "me" }),
    ).rejects.toThrow(/required/);
    await expect(
      bridge.publishReaction({ targetEventId: "e1", pubkey: "me" }),
    ).rejects.toThrow(/required/);
  });
});
