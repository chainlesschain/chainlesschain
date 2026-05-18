/**
 * did-signer unit tests — pure crypto helpers, no DB / no network.
 *
 * Covers:
 *   - canonicalize: deterministic order, primitive types, nested-reject
 *   - signBytes / verifyBytes: round-trip, bad sig, tampered bytes, wrong pubkey
 *   - computeDIDFromPublicKey: matches DIDManager.generateDID format
 *   - signPayloadWithIdentity / verifyPayloadAgainstDid:
 *     end-to-end + DID-pubkey mismatch detection (the anti-impersonation core)
 */

import { describe, it, expect, vi } from "vitest";
import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";
import crypto from "crypto";

// did-signer doesn't require logger, but mock it anyway (matches the project
// pattern + insurance against future loading via DIDManager). Path is 2 deep
// (src/main/did/__tests__ → src/main/utils) — the 3-deep variant points
// outside src/main/ and silently pollutes vitest's mock registry.
vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const {
  canonicalize,
  signBytes,
  verifyBytes,
  computeDIDFromPublicKey,
  signPayloadWithIdentity,
  verifyPayloadAgainstDid,
} = require("../did-signer.js");

function makeIdentityFor(keyPair) {
  return {
    public_key_sign: naclUtil.encodeBase64(keyPair.publicKey),
    private_key_ref: JSON.stringify({
      sign: naclUtil.encodeBase64(keyPair.secretKey),
      encrypt: naclUtil.encodeBase64(new Uint8Array(32)),
    }),
  };
}

describe("did-signer", () => {
  describe("canonicalize", () => {
    it("sorts keys deterministically regardless of input order", () => {
      const a = canonicalize({ b: 2, a: 1, c: 3 });
      const b = canonicalize({ c: 3, a: 1, b: 2 });
      expect(naclUtil.encodeUTF8(a)).toBe(naclUtil.encodeUTF8(b));
      expect(naclUtil.encodeUTF8(a)).toBe('{"a":1,"b":2,"c":3}');
    });

    it("handles strings with quotes + UTF-8 + escapes", () => {
      const out = canonicalize({ msg: 'hello "world" 你好\nbye' });
      const text = naclUtil.encodeUTF8(out);
      expect(text).toBe('{"msg":"hello \\"world\\" 你好\\nbye"}');
    });

    it("handles null + boolean + integer + float + null inline", () => {
      const out = canonicalize({ a: null, b: true, c: false, d: 42, e: 3.14 });
      expect(naclUtil.encodeUTF8(out)).toBe(
        '{"a":null,"b":true,"c":false,"d":42,"e":3.14}',
      );
    });

    it("skips undefined values (matches JSON.stringify behavior)", () => {
      const out = canonicalize({ a: 1, b: undefined, c: 3 });
      expect(naclUtil.encodeUTF8(out)).toBe('{"a":1,"c":3}');
    });

    it("rejects nested objects (we don't sign nested shapes)", () => {
      expect(() => canonicalize({ a: { b: 1 } })).toThrow(/nested/);
      expect(() => canonicalize({ a: [1, 2] })).toThrow(/nested/);
    });

    it("rejects non-finite numbers", () => {
      expect(() => canonicalize({ a: NaN })).toThrow(/non-finite/);
      expect(() => canonicalize({ a: Infinity })).toThrow(/non-finite/);
    });

    it("rejects non-object input", () => {
      expect(() => canonicalize(null)).toThrow(/plain object/);
      expect(() => canonicalize("string")).toThrow(/plain object/);
      expect(() => canonicalize([1, 2])).toThrow(/plain object/);
    });
  });

  describe("computeDIDFromPublicKey", () => {
    it("returns did:chainlesschain:<40-hex> format matching generateDID", () => {
      const pk = new Uint8Array(32);
      for (let i = 0; i < 32; i++) {
        pk[i] = i;
      }
      const did = computeDIDFromPublicKey(pk);
      // Mirror of did-manager: sha256(pk).slice(0,20).toString('hex')
      const expectedHex = crypto
        .createHash("sha256")
        .update(Buffer.from(pk))
        .digest()
        .slice(0, 20)
        .toString("hex");
      expect(did).toBe("did:chainlesschain:" + expectedHex);
      expect(did).toMatch(/^did:chainlesschain:[0-9a-f]{40}$/);
    });

    it("rejects wrong-length public keys", () => {
      expect(() => computeDIDFromPublicKey(new Uint8Array(31))).toThrow(
        /32 bytes/,
      );
      expect(() => computeDIDFromPublicKey(new Uint8Array(33))).toThrow(
        /32 bytes/,
      );
      expect(() => computeDIDFromPublicKey(null)).toThrow(/32 bytes/);
    });

    it("accepts Buffer or Uint8Array", () => {
      const pk = nacl.sign.keyPair().publicKey;
      const fromU8 = computeDIDFromPublicKey(pk);
      const fromBuf = computeDIDFromPublicKey(Buffer.from(pk));
      expect(fromU8).toBe(fromBuf);
    });
  });

  describe("signBytes / verifyBytes", () => {
    it("round-trip: signed bytes verify with same pubkey", () => {
      const kp = nacl.sign.keyPair();
      const bytes = naclUtil.decodeUTF8('{"hello":"world"}');
      const sig = signBytes(bytes, kp.secretKey);
      expect(typeof sig).toBe("string");
      expect(verifyBytes(bytes, sig, kp.publicKey)).toBe(true);
    });

    it("verifyBytes returns false for tampered bytes", () => {
      const kp = nacl.sign.keyPair();
      const bytes = naclUtil.decodeUTF8("hello");
      const sig = signBytes(bytes, kp.secretKey);
      const tampered = naclUtil.decodeUTF8("hellp");
      expect(verifyBytes(tampered, sig, kp.publicKey)).toBe(false);
    });

    it("verifyBytes returns false for wrong public key", () => {
      const kpA = nacl.sign.keyPair();
      const kpB = nacl.sign.keyPair();
      const bytes = naclUtil.decodeUTF8("hello");
      const sig = signBytes(bytes, kpA.secretKey);
      expect(verifyBytes(bytes, sig, kpB.publicKey)).toBe(false);
    });

    it("verifyBytes returns false for malformed inputs (no throw)", () => {
      const kp = nacl.sign.keyPair();
      expect(verifyBytes(null, "abc", kp.publicKey)).toBe(false);
      expect(verifyBytes(naclUtil.decodeUTF8("x"), null, kp.publicKey)).toBe(
        false,
      );
      expect(
        verifyBytes(naclUtil.decodeUTF8("x"), "not-base64-!@#", kp.publicKey),
      ).toBe(false);
      expect(
        verifyBytes(naclUtil.decodeUTF8("x"), "abc", new Uint8Array(31)),
      ).toBe(false);
    });

    it("signBytes rejects bad input shapes", () => {
      const kp = nacl.sign.keyPair();
      expect(() => signBytes(new Uint8Array(0), kp.secretKey)).toThrow(
        /non-empty/,
      );
      expect(() =>
        signBytes(naclUtil.decodeUTF8("x"), new Uint8Array(63)),
      ).toThrow(/64 bytes/);
    });
  });

  describe("signPayloadWithIdentity + verifyPayloadAgainstDid (end-to-end)", () => {
    it("happy path: A signs, B verifies, payload + DID + pubkey all consistent", () => {
      const kp = nacl.sign.keyPair();
      const identity = makeIdentityFor(kp);
      const senderDid = computeDIDFromPublicKey(kp.publicKey);
      const payload = {
        id: "msg-1",
        channel_id: "ch-1",
        sender_did: senderDid,
        content: "hello world",
        message_type: "text",
        reply_to: null,
        created_at: 1700000000000,
      };

      const { sender_pubkey, signature } = signPayloadWithIdentity(
        payload,
        identity,
      );
      expect(sender_pubkey).toBe(identity.public_key_sign);
      expect(typeof signature).toBe("string");

      const result = verifyPayloadAgainstDid(
        payload,
        senderDid,
        sender_pubkey,
        signature,
      );
      expect(result).toEqual({ ok: true });
    });

    it("rejects when sender_did does not match sha256(pubkey) — impersonation attack", () => {
      const realKp = nacl.sign.keyPair();
      const attackerKp = nacl.sign.keyPair();
      const realDid = computeDIDFromPublicKey(realKp.publicKey);

      // Attacker tries to claim real user's DID but signs with own key
      const attackerIdentity = makeIdentityFor(attackerKp);
      const payload = {
        id: "msg-bad",
        channel_id: "ch-1",
        sender_did: realDid, // ← claims real user
        content: "i am alice",
        message_type: "text",
        reply_to: null,
        created_at: 1700000000000,
      };

      const { sender_pubkey, signature } = signPayloadWithIdentity(
        payload,
        attackerIdentity,
      );
      // Attacker ships own pubkey + own signature (best they can do):
      const result = verifyPayloadAgainstDid(
        payload,
        realDid,
        sender_pubkey,
        signature,
      );
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/sender_did mismatch/);
    });

    it("rejects when payload tampered after signing", () => {
      const kp = nacl.sign.keyPair();
      const identity = makeIdentityFor(kp);
      const senderDid = computeDIDFromPublicKey(kp.publicKey);
      const original = {
        id: "msg-2",
        channel_id: "ch-1",
        sender_did: senderDid,
        content: "approved",
        message_type: "text",
        reply_to: null,
        created_at: 1700000000000,
      };
      const { sender_pubkey, signature } = signPayloadWithIdentity(
        original,
        identity,
      );

      const tampered = { ...original, content: "rejected" };
      const result = verifyPayloadAgainstDid(
        tampered,
        senderDid,
        sender_pubkey,
        signature,
      );
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/Ed25519 signature verification failed/);
    });

    it("rejects on missing fields with descriptive reason", () => {
      const kp = nacl.sign.keyPair();
      const did = computeDIDFromPublicKey(kp.publicKey);
      expect(verifyPayloadAgainstDid({}, "", "abc", "def")).toMatchObject({
        ok: false,
        reason: /sender_did missing/,
      });
      expect(verifyPayloadAgainstDid({}, did, "", "def")).toMatchObject({
        ok: false,
        reason: /sender_pubkey missing/,
      });
      expect(verifyPayloadAgainstDid({}, did, "abc", "")).toMatchObject({
        ok: false,
        reason: /signature missing/,
      });
    });

    it("rejects malformed sender_pubkey (wrong length / non-base64)", () => {
      const kp = nacl.sign.keyPair();
      const did = computeDIDFromPublicKey(kp.publicKey);
      const shortPk = naclUtil.encodeBase64(new Uint8Array(31));
      expect(verifyPayloadAgainstDid({ a: 1 }, did, shortPk, "x").ok).toBe(
        false,
      );
    });

    it("signPayloadWithIdentity rejects malformed identity", () => {
      expect(() => signPayloadWithIdentity({ a: 1 }, null)).toThrow(/identity/);
      expect(() => signPayloadWithIdentity({ a: 1 }, {})).toThrow(/missing/);
      expect(() =>
        signPayloadWithIdentity(
          { a: 1 },
          { public_key_sign: "abc", private_key_ref: "{not json" },
        ),
      ).toThrow(/parseable JSON/);
      expect(() =>
        signPayloadWithIdentity(
          { a: 1 },
          { public_key_sign: "abc", private_key_ref: "{}" },
        ),
      ).toThrow(/private_key_ref\.sign missing/);
    });
  });

  describe("payload field-order stability", () => {
    it("signing the same logical payload twice with shuffled key order yields identical signature", () => {
      const kp = nacl.sign.keyPair();
      const identity = makeIdentityFor(kp);
      const senderDid = computeDIDFromPublicKey(kp.publicKey);

      const payloadA = {
        id: "msg-x",
        channel_id: "ch-x",
        sender_did: senderDid,
        content: "stable",
        message_type: "text",
        reply_to: null,
        created_at: 1700,
      };
      const payloadB = {
        created_at: 1700,
        reply_to: null,
        message_type: "text",
        content: "stable",
        sender_did: senderDid,
        channel_id: "ch-x",
        id: "msg-x",
      };
      const sigA = signPayloadWithIdentity(payloadA, identity).signature;
      const sigB = signPayloadWithIdentity(payloadB, identity).signature;
      expect(sigA).toBe(sigB);
    });
  });
});
