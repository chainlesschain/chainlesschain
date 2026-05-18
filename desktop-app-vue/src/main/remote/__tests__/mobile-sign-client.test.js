/**
 * MobileSignClient 单元测试（M5 D1）
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  MobileSignClient,
  SignError,
  SignDeniedError,
  SignTimeoutError,
  PAYLOAD_HASH_HEX_LEN,
} from "../handlers/mobile-sign-client";

const VALID_HASH = "a".repeat(PAYLOAD_HASH_HEX_LEN);

function fakeTransport(scriptedResponse) {
  return {
    send: vi.fn().mockResolvedValue(scriptedResponse),
  };
}

describe("MobileSignClient", () => {
  describe("constructor", () => {
    it("throws if transport is missing", () => {
      expect(() => new MobileSignClient({})).toThrow(/transport with send/);
    });

    it("throws if transport.send is not a function", () => {
      expect(() => new MobileSignClient({ transport: {} })).toThrow();
    });

    it("uses default timeout when not specified", () => {
      const c = new MobileSignClient({ transport: { send: vi.fn() } });
      expect(c.timeoutMs).toBe(60_000);
    });

    it("respects custom timeout", () => {
      const c = new MobileSignClient({
        transport: { send: vi.fn() },
        timeoutMs: 5000,
      });
      expect(c.timeoutMs).toBe(5000);
    });
  });

  describe("requestSignature — input validation", () => {
    let client;
    beforeEach(() => {
      client = new MobileSignClient({ transport: fakeTransport({}) });
    });

    it("rejects missing peerId", async () => {
      await expect(
        client.requestSignature({ payloadHash: VALID_HASH }),
      ).rejects.toThrow(/peerId/);
    });

    it("rejects wrong-length payloadHash", async () => {
      await expect(
        client.requestSignature({ peerId: "p1", payloadHash: "abc" }),
      ).rejects.toThrow(/64-char hex/);
    });

    it("rejects non-hex payloadHash", async () => {
      const badHash = "Z".repeat(PAYLOAD_HASH_HEX_LEN);
      await expect(
        client.requestSignature({ peerId: "p1", payloadHash: badHash }),
      ).rejects.toThrow(/valid hex/);
    });
  });

  describe("requestSignature — happy path", () => {
    it("returns did + signature + signedAt on approved response", async () => {
      const transport = fakeTransport({
        jsonrpc: "2.0",
        id: "sign-xxx",
        result: {
          approved: true,
          did: "did:key:zABC",
          signature: "base64sig==",
          signedAt: 1700000000000,
        },
      });
      const client = new MobileSignClient({ transport });

      const out = await client.requestSignature({
        peerId: "android-1",
        payloadHash: VALID_HASH,
        description: "Buy item X",
      });

      expect(out.did).toBe("did:key:zABC");
      expect(out.signature).toBe("base64sig==");
      expect(out.signedAt).toBe(1700000000000);
      expect(out.requestId).toMatch(/^sign-/);
    });

    it("sends jsonrpc envelope with sign.request method", async () => {
      const transport = fakeTransport({
        jsonrpc: "2.0",
        result: { approved: true, did: "did:key:z", signature: "s" },
      });
      const client = new MobileSignClient({ transport });

      await client.requestSignature({
        peerId: "p",
        payloadHash: VALID_HASH,
        requireStrongBox: true,
      });

      expect(transport.send).toHaveBeenCalledOnce();
      const [peerId, req] = transport.send.mock.calls[0];
      expect(peerId).toBe("p");
      expect(req.jsonrpc).toBe("2.0");
      expect(req.method).toBe("sign.request");
      expect(req.params.payloadHash).toBe(VALID_HASH);
      expect(req.params.requireStrongBox).toBe(true);
    });

    it("lowercases payloadHash before send", async () => {
      const transport = fakeTransport({
        result: { approved: true, did: "d", signature: "s" },
      });
      const client = new MobileSignClient({ transport });
      const upperHash = "F".repeat(PAYLOAD_HASH_HEX_LEN);

      await client.requestSignature({ peerId: "p", payloadHash: upperHash });

      expect(transport.send.mock.calls[0][1].params.payloadHash).toBe(
        upperHash.toLowerCase(),
      );
    });
  });

  describe("requestSignature — failure paths", () => {
    it("throws SignDeniedError on approved=false", async () => {
      const transport = fakeTransport({
        result: { approved: false, deniedReason: "user-cancel" },
      });
      const client = new MobileSignClient({ transport });

      const err = await client
        .requestSignature({ peerId: "p", payloadHash: VALID_HASH })
        .catch((e) => e);

      expect(err).toBeInstanceOf(SignDeniedError);
      expect(err.reason).toBe("user-cancel");
    });

    it("throws SignDeniedError with 'unknown' reason when missing", async () => {
      const transport = fakeTransport({ result: { approved: false } });
      const client = new MobileSignClient({ transport });

      const err = await client
        .requestSignature({ peerId: "p", payloadHash: VALID_HASH })
        .catch((e) => e);

      expect(err.reason).toBe("unknown");
    });

    it("throws SignError on response.error", async () => {
      const transport = fakeTransport({
        error: { code: -32000, message: "Internal error" },
      });
      const client = new MobileSignClient({ transport });

      await expect(
        client.requestSignature({ peerId: "p", payloadHash: VALID_HASH }),
      ).rejects.toThrow(SignError);
    });

    it("throws SignError on missing signature in approved response", async () => {
      const transport = fakeTransport({
        result: { approved: true, did: "d" }, // missing signature
      });
      const client = new MobileSignClient({ transport });

      await expect(
        client.requestSignature({ peerId: "p", payloadHash: VALID_HASH }),
      ).rejects.toThrow(/signature is missing/);
    });

    it("throws SignError on transport throw", async () => {
      const transport = {
        send: vi.fn().mockRejectedValue(new Error("network down")),
      };
      const client = new MobileSignClient({ transport });

      const err = await client
        .requestSignature({ peerId: "p", payloadHash: VALID_HASH })
        .catch((e) => e);

      expect(err).toBeInstanceOf(SignError);
      expect(err.message).toMatch(/Transport error.*network down/);
    });

    it("throws SignTimeoutError when transport never resolves", async () => {
      const transport = {
        // pending forever
        send: vi.fn().mockReturnValue(new Promise(() => {})),
      };
      const client = new MobileSignClient({ transport, timeoutMs: 50 });

      const err = await client
        .requestSignature({ peerId: "p", payloadHash: VALID_HASH })
        .catch((e) => e);

      expect(err).toBeInstanceOf(SignTimeoutError);
      expect(err.message).toMatch(/timed out after 50ms/);
    });
  });

  describe("hashPayload helper", () => {
    it("returns 64-char hex for string input", () => {
      const h = MobileSignClient.hashPayload("hello");
      expect(h).toHaveLength(PAYLOAD_HASH_HEX_LEN);
      expect(h).toMatch(/^[0-9a-f]+$/);
      // SHA-256("hello") = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
      expect(h).toBe(
        "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
      );
    });

    it("returns 64-char hex for Buffer input", () => {
      const h = MobileSignClient.hashPayload(Buffer.from([0, 1, 2, 3]));
      expect(h).toHaveLength(PAYLOAD_HASH_HEX_LEN);
    });
  });
});
