/**
 * Unit tests for the Settlement Escrow IPC handlers (settlement:*).
 *
 * Uses a fake settlementEscrow facade (vi.fn spies) + injected mock ipcMain —
 * no sql.js / real ledger needed. The real ledger/escrow mechanics are covered
 * by packages/core-settlement/__tests__/desktop-adapter.test.js; here we assert
 * the IPC layer: channel registration, input validation, the no-secret-over-IPC
 * signing path, and not-ready behavior.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const { registerSettlementEscrowIPC } = require("../settlement-escrow-ipc.js");

function createMockIpcMain() {
  const handlers = {};
  return {
    handlers,
    handle: vi.fn((channel, handler) => {
      handlers[channel] = handler;
    }),
  };
}

function createFakeEscrow() {
  return {
    balanceOf: vi.fn().mockReturnValue(500),
    getHold: vi.fn().mockReturnValue({ id: "h1", status: "held" }),
    registerMember: vi.fn(),
    grant: vi.fn().mockReturnValue({ ok: true, entryId: "e1" }),
    openHoldForTransaction: vi.fn().mockReturnValue({ ok: true, holdId: "h1" }),
    release: vi.fn().mockReturnValue({ ok: true }),
    refund: vi.fn().mockReturnValue({ ok: true }),
  };
}

// A decrypted desktop-style identity whose private_key_ref carries a valid
// 64-byte nacl secret (so naclIdentityToMember inside the handler succeeds).
function makeLocalIdentity(did) {
  const nacl = require("tweetnacl");
  const naclUtil = require("tweetnacl-util");
  const kp = nacl.sign.keyPair();
  return {
    did,
    public_key_sign: naclUtil.encodeBase64(kp.publicKey),
    private_key_ref: JSON.stringify({
      sign: naclUtil.encodeBase64(kp.secretKey),
    }),
  };
}

describe("Settlement Escrow IPC", () => {
  let ipcMain;
  let escrow;
  let localIdentity;
  let didManager;
  const LOCAL_DID = "did:chainlesschain:local";

  const call = (channel, ...args) => ipcMain.handlers[channel]({}, ...args);

  beforeEach(() => {
    vi.clearAllMocks();
    ipcMain = createMockIpcMain();
    escrow = createFakeEscrow();
    localIdentity = makeLocalIdentity(LOCAL_DID);
    didManager = { getCurrentIdentity: vi.fn(() => localIdentity) };
    registerSettlementEscrowIPC({
      settlementEscrow: escrow,
      didManager,
      ipcMain,
    });
  });

  it("registers all 7 settlement:* channels", () => {
    expect(Object.keys(ipcMain.handlers).sort()).toEqual(
      [
        "settlement:get-balance",
        "settlement:get-hold",
        "settlement:grant",
        "settlement:open-hold",
        "settlement:refund",
        "settlement:register-member",
        "settlement:release",
      ].sort(),
    );
  });

  describe("reads", () => {
    it("get-balance delegates to balanceOf", async () => {
      expect(await call("settlement:get-balance", LOCAL_DID)).toBe(500);
      expect(escrow.balanceOf).toHaveBeenCalledWith(LOCAL_DID);
    });

    it("get-balance rejects non-string did", async () => {
      await expect(call("settlement:get-balance", 123)).rejects.toThrow();
    });

    it("get-hold delegates to getHold", async () => {
      expect(await call("settlement:get-hold", "h1")).toEqual({
        id: "h1",
        status: "held",
      });
      expect(escrow.getHold).toHaveBeenCalledWith("h1");
    });
  });

  describe("grant", () => {
    it("delegates valid grant", async () => {
      const r = await call("settlement:grant", { to: LOCAL_DID, amount: 100 });
      expect(r).toEqual({ ok: true, entryId: "e1" });
      expect(escrow.grant).toHaveBeenCalledWith({
        to: LOCAL_DID,
        amount: 100,
        nonce: undefined,
      });
    });

    it("rejects non-positive amount", async () => {
      await expect(
        call("settlement:grant", { to: LOCAL_DID, amount: 0 }),
      ).rejects.toThrow(/amount/);
      await expect(
        call("settlement:grant", { to: LOCAL_DID, amount: -5 }),
      ).rejects.toThrow(/amount/);
      expect(escrow.grant).not.toHaveBeenCalled();
    });

    it("rejects missing recipient", async () => {
      await expect(call("settlement:grant", { amount: 100 })).rejects.toThrow();
    });
  });

  describe("register-member", () => {
    it("registers a public-key member", async () => {
      const member = {
        did: "did:x",
        alg: "Ed25519",
        pubkeyJwk: { kty: "OKP" },
      };
      expect(await call("settlement:register-member", member)).toEqual({
        ok: true,
      });
      expect(escrow.registerMember).toHaveBeenCalledWith(member);
    });

    it("rejects member without pubkeyJwk", async () => {
      await expect(
        call("settlement:register-member", { did: "did:x" }),
      ).rejects.toThrow();
    });
  });

  describe("open-hold (no secret over IPC)", () => {
    it("signs locally when buyer is the current identity", async () => {
      const r = await call("settlement:open-hold", {
        transactionId: "tx1",
        buyer: LOCAL_DID,
        seller: "did:chainlesschain:seller",
        amount: 200,
        proposalId: "p1",
      });
      expect(r).toEqual({ ok: true, holdId: "h1" });
      const arg = escrow.openHoldForTransaction.mock.calls[0][0];
      // handler derived a buyerSecretKey from the local identity (32-byte seed)
      expect(Buffer.isBuffer(arg.buyerSecretKey)).toBe(true);
      expect(arg.buyerSecretKey).toHaveLength(32);
      expect(arg.fund).toBeUndefined();
      expect(arg.buyer).toBe(LOCAL_DID);
    });

    it("passes a pre-signed fund through without touching didManager", async () => {
      const fund = { nonce: "n", alg: "Ed25519", sig: "deadbeef" };
      await call("settlement:open-hold", {
        transactionId: "tx2",
        buyer: "did:chainlesschain:remote-buyer",
        seller: "did:chainlesschain:seller",
        amount: 50,
        proposalId: "p2",
        fund,
      });
      const arg = escrow.openHoldForTransaction.mock.calls[0][0];
      expect(arg.fund).toBe(fund);
      expect(arg.buyerSecretKey).toBeUndefined();
      expect(didManager.getCurrentIdentity).not.toHaveBeenCalled();
    });

    it("rejects buyer != local identity when no fund is supplied", async () => {
      await expect(
        call("settlement:open-hold", {
          transactionId: "tx3",
          buyer: "did:chainlesschain:someone-else",
          seller: "did:chainlesschain:seller",
          amount: 10,
          proposalId: "p3",
        }),
      ).rejects.toThrow();
      expect(escrow.openHoldForTransaction).not.toHaveBeenCalled();
    });

    it("rejects non-positive amount", async () => {
      await expect(
        call("settlement:open-hold", {
          transactionId: "tx4",
          buyer: LOCAL_DID,
          seller: "did:s",
          amount: -1,
        }),
      ).rejects.toThrow(/amount/);
    });
  });

  describe("release / refund", () => {
    it("release delegates to escrow.release", async () => {
      expect(await call("settlement:release", "h1")).toEqual({ ok: true });
      expect(escrow.release).toHaveBeenCalledWith("h1");
    });

    it("refund delegates to escrow.refund", async () => {
      expect(await call("settlement:refund", "h1")).toEqual({ ok: true });
      expect(escrow.refund).toHaveBeenCalledWith("h1");
    });

    it("release rejects empty holdId", async () => {
      await expect(call("settlement:release", "")).rejects.toThrow();
    });
  });

  describe("not-ready facade (settlementEscrow = null)", () => {
    beforeEach(() => {
      ipcMain = createMockIpcMain();
      registerSettlementEscrowIPC({
        settlementEscrow: null,
        didManager,
        ipcMain,
      });
    });

    it("reads return null", async () => {
      expect(await call("settlement:get-balance", LOCAL_DID)).toBeNull();
      expect(await call("settlement:get-hold", "h1")).toBeNull();
    });

    it("mutations throw a clear not-ready error", async () => {
      await expect(call("settlement:release", "h1")).rejects.toThrow(
        /未初始化/,
      );
      await expect(
        call("settlement:grant", { to: LOCAL_DID, amount: 1 }),
      ).rejects.toThrow(/未初始化/);
    });
  });
});
