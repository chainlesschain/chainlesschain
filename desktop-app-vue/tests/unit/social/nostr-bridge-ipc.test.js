/**
 * Nostr Bridge IPC Unit Tests
 *
 * Covers all 10 channels registered by registerNostrBridgeIPC:
 *  - Relay:    nostr:list-relays, nostr:add-relay
 *  - Events:   nostr:publish-event, nostr:get-events
 *  - Identity: nostr:generate-keypair, nostr:map-did
 *  - NIP-04:   nostr:publish-dm, nostr:decrypt-dm
 *  - NIP-09:   nostr:publish-deletion
 *  - NIP-25:   nostr:publish-reaction
 *
 * Uses injected ipcMain + ipcGuard stubs to avoid requiring Electron.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ─── Mock logger ──────────────────────────────────────────────────────────────
vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── Module under test ────────────────────────────────────────────────────────
let registerNostrBridgeIPC, unregisterNostrBridgeIPC, NOSTR_CHANNELS;

beforeEach(async () => {
  const mod = await import("../../../src/main/social/nostr-bridge-ipc.js");
  registerNostrBridgeIPC = mod.registerNostrBridgeIPC;
  unregisterNostrBridgeIPC = mod.unregisterNostrBridgeIPC;
  NOSTR_CHANNELS = mod.NOSTR_CHANNELS;
});

// ─── Helper: build a capture-only ipcMain stub ──────────────────────────────
function makeIpcMainStub() {
  const handlers = new Map();
  return {
    handlers,
    handle: vi.fn((channel, fn) => {
      handlers.set(channel, fn);
    }),
    removeHandler: vi.fn((channel) => {
      handlers.delete(channel);
    }),
  };
}

// ─── Helper: build an ipcGuard stub ─────────────────────────────────────────
function makeIpcGuardStub({ registered = false } = {}) {
  let isReg = registered;
  return {
    isModuleRegistered: vi.fn(() => isReg),
    registerModule: vi.fn(() => {
      isReg = true;
    }),
    unregisterModule: vi.fn(() => {
      isReg = false;
    }),
  };
}

// ─── Helper: build a nostrBridge stub with spies ────────────────────────────
function makeBridgeStub(overrides = {}) {
  return {
    listRelays: vi.fn(async () => ({ success: true, relays: [] })),
    addRelay: vi.fn(async (url) => ({ success: true, url })),
    publishEvent: vi.fn(async (p) => ({
      success: true,
      eventId: "evt-1",
      ...p,
    })),
    getEvents: vi.fn(async () => ({ success: true, events: [] })),
    publishDirectMessage: vi.fn(async (p) => ({
      success: true,
      eventId: "dm-1",
      recipient: p?.recipientPubkey,
    })),
    decryptDirectMessage: vi.fn(async () => "hello"),
    publishDeletion: vi.fn(async (p) => ({
      success: true,
      eventId: "del-1",
      deletedIds: p?.eventIds,
    })),
    publishReaction: vi.fn(async (p) => ({
      success: true,
      eventId: "react-1",
      target: p?.targetEventId,
    })),
    ...overrides,
  };
}

// ─── Helper: build a nostrIdentity stub ─────────────────────────────────────
function makeIdentityStub(overrides = {}) {
  return {
    generateKeyPair: vi.fn(async () => ({
      npub: "npub1xxx",
      nsec: "nsec1xxx",
      publicKeyHex: "aa",
      privateKeyHex: "bb",
    })),
    mapDIDToNostr: vi.fn(async ({ did, npub }) => ({
      success: true,
      did,
      npub,
    })),
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("nostr-bridge-ipc", () => {
  // ── Registration ───────────────────────────────────────────────────────────
  describe("registerNostrBridgeIPC", () => {
    it("registers all 10 channels", () => {
      const ipcMain = makeIpcMainStub();
      const ipcGuard = makeIpcGuardStub();
      const result = registerNostrBridgeIPC({
        nostrBridge: makeBridgeStub(),
        nostrIdentity: makeIdentityStub(),
        ipcMain,
        ipcGuard,
      });

      expect(result.handlerCount).toBe(10);
      expect(ipcMain.handle).toHaveBeenCalledTimes(10);
      for (const channel of NOSTR_CHANNELS) {
        expect(ipcMain.handlers.has(channel)).toBe(true);
      }
      expect(ipcGuard.registerModule).toHaveBeenCalledWith(
        "nostr-bridge-ipc",
        NOSTR_CHANNELS,
      );
    });

    it("re-registers cleanly if already registered (cleans up old handlers first)", () => {
      const ipcMain = makeIpcMainStub();
      const ipcGuard = makeIpcGuardStub({ registered: true });

      registerNostrBridgeIPC({
        nostrBridge: makeBridgeStub(),
        nostrIdentity: makeIdentityStub(),
        ipcMain,
        ipcGuard,
      });

      expect(ipcGuard.unregisterModule).toHaveBeenCalledWith(
        "nostr-bridge-ipc",
      );
      expect(ipcMain.removeHandler).toHaveBeenCalledTimes(
        NOSTR_CHANNELS.length,
      );
      expect(ipcMain.handle).toHaveBeenCalledTimes(NOSTR_CHANNELS.length);
    });
  });

  // ── Relay channels ─────────────────────────────────────────────────────────
  describe("nostr:list-relays", () => {
    it("delegates to bridge.listRelays", async () => {
      const bridge = makeBridgeStub();
      const ipcMain = makeIpcMainStub();
      registerNostrBridgeIPC({
        nostrBridge: bridge,
        nostrIdentity: makeIdentityStub(),
        ipcMain,
        ipcGuard: makeIpcGuardStub(),
      });
      const handler = ipcMain.handlers.get("nostr:list-relays");
      const out = await handler({});
      expect(bridge.listRelays).toHaveBeenCalled();
      expect(out.success).toBe(true);
    });

    it("returns {success:false,error} when bridge missing", async () => {
      const ipcMain = makeIpcMainStub();
      registerNostrBridgeIPC({
        nostrBridge: null,
        nostrIdentity: makeIdentityStub(),
        ipcMain,
        ipcGuard: makeIpcGuardStub(),
      });
      const out = await ipcMain.handlers.get("nostr:list-relays")({});
      expect(out.success).toBe(false);
      expect(out.error).toMatch(/未初始化/);
    });
  });

  describe("nostr:add-relay", () => {
    it("forwards url to bridge.addRelay", async () => {
      const bridge = makeBridgeStub();
      const ipcMain = makeIpcMainStub();
      registerNostrBridgeIPC({
        nostrBridge: bridge,
        nostrIdentity: makeIdentityStub(),
        ipcMain,
        ipcGuard: makeIpcGuardStub(),
      });
      const handler = ipcMain.handlers.get("nostr:add-relay");
      await handler({}, { url: "wss://relay.example" });
      expect(bridge.addRelay).toHaveBeenCalledWith("wss://relay.example");
    });
  });

  // ── Event channels ─────────────────────────────────────────────────────────
  describe("nostr:publish-event", () => {
    it("forwards params to bridge.publishEvent", async () => {
      const bridge = makeBridgeStub();
      const ipcMain = makeIpcMainStub();
      registerNostrBridgeIPC({
        nostrBridge: bridge,
        nostrIdentity: makeIdentityStub(),
        ipcMain,
        ipcGuard: makeIpcGuardStub(),
      });
      const params = { kind: 1, content: "hi", tags: [] };
      await ipcMain.handlers.get("nostr:publish-event")({}, params);
      expect(bridge.publishEvent).toHaveBeenCalledWith(params);
    });

    it("wraps bridge errors as {success:false,error}", async () => {
      const bridge = makeBridgeStub({
        publishEvent: vi.fn(async () => {
          throw new Error("boom");
        }),
      });
      const ipcMain = makeIpcMainStub();
      registerNostrBridgeIPC({
        nostrBridge: bridge,
        nostrIdentity: makeIdentityStub(),
        ipcMain,
        ipcGuard: makeIpcGuardStub(),
      });
      const out = await ipcMain.handlers.get("nostr:publish-event")({}, {});
      expect(out).toEqual({ success: false, error: "boom" });
    });
  });

  describe("nostr:get-events", () => {
    it("forwards filter params to bridge.getEvents", async () => {
      const bridge = makeBridgeStub();
      const ipcMain = makeIpcMainStub();
      registerNostrBridgeIPC({
        nostrBridge: bridge,
        nostrIdentity: makeIdentityStub(),
        ipcMain,
        ipcGuard: makeIpcGuardStub(),
      });
      const filter = { kinds: [1], limit: 50 };
      await ipcMain.handlers.get("nostr:get-events")({}, filter);
      expect(bridge.getEvents).toHaveBeenCalledWith(filter);
    });
  });

  // ── Identity channels ──────────────────────────────────────────────────────
  describe("nostr:generate-keypair", () => {
    it("delegates to identity.generateKeyPair", async () => {
      const identity = makeIdentityStub();
      const ipcMain = makeIpcMainStub();
      registerNostrBridgeIPC({
        nostrBridge: makeBridgeStub(),
        nostrIdentity: identity,
        ipcMain,
        ipcGuard: makeIpcGuardStub(),
      });
      const out = await ipcMain.handlers.get("nostr:generate-keypair")({});
      expect(identity.generateKeyPair).toHaveBeenCalled();
      expect(out).toHaveProperty("npub");
      expect(out).toHaveProperty("nsec");
    });

    it("returns error when identity missing", async () => {
      const ipcMain = makeIpcMainStub();
      registerNostrBridgeIPC({
        nostrBridge: makeBridgeStub(),
        nostrIdentity: null,
        ipcMain,
        ipcGuard: makeIpcGuardStub(),
      });
      const out = await ipcMain.handlers.get("nostr:generate-keypair")({});
      expect(out.success).toBe(false);
    });
  });

  describe("nostr:map-did", () => {
    it("forwards params to identity.mapDIDToNostr", async () => {
      const identity = makeIdentityStub();
      const ipcMain = makeIpcMainStub();
      registerNostrBridgeIPC({
        nostrBridge: makeBridgeStub(),
        nostrIdentity: identity,
        ipcMain,
        ipcGuard: makeIpcGuardStub(),
      });
      const params = { did: "did:example:1", npub: "npub1xxx" };
      const out = await ipcMain.handlers.get("nostr:map-did")({}, params);
      expect(identity.mapDIDToNostr).toHaveBeenCalledWith(params);
      expect(out.success).toBe(true);
    });
  });

  // ── NIP-04: publish-dm ─────────────────────────────────────────────────────
  describe("nostr:publish-dm (NIP-04)", () => {
    it("forwards params to bridge.publishDirectMessage", async () => {
      const bridge = makeBridgeStub();
      const ipcMain = makeIpcMainStub();
      registerNostrBridgeIPC({
        nostrBridge: bridge,
        nostrIdentity: makeIdentityStub(),
        ipcMain,
        ipcGuard: makeIpcGuardStub(),
      });
      const params = {
        senderPrivkey: "a".repeat(64),
        recipientPubkey: "b".repeat(64),
        plaintext: "secret",
      };
      const out = await ipcMain.handlers.get("nostr:publish-dm")({}, params);
      expect(bridge.publishDirectMessage).toHaveBeenCalledWith(params);
      expect(out.success).toBe(true);
      expect(out.recipient).toBe(params.recipientPubkey);
    });

    it("wraps crypto/network errors as {success:false,error}", async () => {
      const bridge = makeBridgeStub({
        publishDirectMessage: vi.fn(async () => {
          throw new Error("ECDH failed");
        }),
      });
      const ipcMain = makeIpcMainStub();
      registerNostrBridgeIPC({
        nostrBridge: bridge,
        nostrIdentity: makeIdentityStub(),
        ipcMain,
        ipcGuard: makeIpcGuardStub(),
      });
      const out = await ipcMain.handlers.get("nostr:publish-dm")({}, {});
      expect(out).toEqual({ success: false, error: "ECDH failed" });
    });

    it("returns error when bridge missing", async () => {
      const ipcMain = makeIpcMainStub();
      registerNostrBridgeIPC({
        nostrBridge: null,
        nostrIdentity: makeIdentityStub(),
        ipcMain,
        ipcGuard: makeIpcGuardStub(),
      });
      const out = await ipcMain.handlers.get("nostr:publish-dm")({}, {});
      expect(out.success).toBe(false);
      expect(out.error).toMatch(/未初始化/);
    });
  });

  // ── NIP-04: decrypt-dm ─────────────────────────────────────────────────────
  describe("nostr:decrypt-dm (NIP-04)", () => {
    it("returns {success:true,plaintext} on successful decrypt", async () => {
      const bridge = makeBridgeStub({
        decryptDirectMessage: vi.fn(async () => "the answer is 42"),
      });
      const ipcMain = makeIpcMainStub();
      registerNostrBridgeIPC({
        nostrBridge: bridge,
        nostrIdentity: makeIdentityStub(),
        ipcMain,
        ipcGuard: makeIpcGuardStub(),
      });
      const params = {
        recipientPrivkey: "a".repeat(64),
        senderPubkey: "b".repeat(64),
        ciphertext: "xxx?iv=yyy",
      };
      const out = await ipcMain.handlers.get("nostr:decrypt-dm")({}, params);
      expect(bridge.decryptDirectMessage).toHaveBeenCalledWith(params);
      expect(out).toEqual({ success: true, plaintext: "the answer is 42" });
    });

    it("wraps decrypt errors as {success:false,error}", async () => {
      const bridge = makeBridgeStub({
        decryptDirectMessage: vi.fn(async () => {
          throw new Error("bad-ciphertext");
        }),
      });
      const ipcMain = makeIpcMainStub();
      registerNostrBridgeIPC({
        nostrBridge: bridge,
        nostrIdentity: makeIdentityStub(),
        ipcMain,
        ipcGuard: makeIpcGuardStub(),
      });
      const out = await ipcMain.handlers.get("nostr:decrypt-dm")({}, {});
      expect(out).toEqual({ success: false, error: "bad-ciphertext" });
    });

    it("returns error when bridge missing", async () => {
      const ipcMain = makeIpcMainStub();
      registerNostrBridgeIPC({
        nostrBridge: null,
        nostrIdentity: makeIdentityStub(),
        ipcMain,
        ipcGuard: makeIpcGuardStub(),
      });
      const out = await ipcMain.handlers.get("nostr:decrypt-dm")({}, {});
      expect(out.success).toBe(false);
    });
  });

  // ── NIP-09: publish-deletion ───────────────────────────────────────────────
  describe("nostr:publish-deletion (NIP-09)", () => {
    it("forwards params to bridge.publishDeletion", async () => {
      const bridge = makeBridgeStub();
      const ipcMain = makeIpcMainStub();
      registerNostrBridgeIPC({
        nostrBridge: bridge,
        nostrIdentity: makeIdentityStub(),
        ipcMain,
        ipcGuard: makeIpcGuardStub(),
      });
      const params = {
        authorPrivkey: "a".repeat(64),
        eventIds: ["e1", "e2"],
        reason: "mistake",
      };
      const out = await ipcMain.handlers.get("nostr:publish-deletion")(
        {},
        params,
      );
      expect(bridge.publishDeletion).toHaveBeenCalledWith(params);
      expect(out.success).toBe(true);
      expect(out.deletedIds).toEqual(["e1", "e2"]);
    });

    it("wraps errors as {success:false,error}", async () => {
      const bridge = makeBridgeStub({
        publishDeletion: vi.fn(async () => {
          throw new Error("not-owner");
        }),
      });
      const ipcMain = makeIpcMainStub();
      registerNostrBridgeIPC({
        nostrBridge: bridge,
        nostrIdentity: makeIdentityStub(),
        ipcMain,
        ipcGuard: makeIpcGuardStub(),
      });
      const out = await ipcMain.handlers.get("nostr:publish-deletion")({}, {});
      expect(out).toEqual({ success: false, error: "not-owner" });
    });
  });

  // ── NIP-25: publish-reaction ───────────────────────────────────────────────
  describe("nostr:publish-reaction (NIP-25)", () => {
    it("forwards params to bridge.publishReaction", async () => {
      const bridge = makeBridgeStub();
      const ipcMain = makeIpcMainStub();
      registerNostrBridgeIPC({
        nostrBridge: bridge,
        nostrIdentity: makeIdentityStub(),
        ipcMain,
        ipcGuard: makeIpcGuardStub(),
      });
      const params = {
        authorPrivkey: "a".repeat(64),
        targetEventId: "target-evt",
        targetAuthorPubkey: "b".repeat(64),
        content: "+",
      };
      const out = await ipcMain.handlers.get("nostr:publish-reaction")(
        {},
        params,
      );
      expect(bridge.publishReaction).toHaveBeenCalledWith(params);
      expect(out.success).toBe(true);
      expect(out.target).toBe("target-evt");
    });

    it("wraps errors as {success:false,error}", async () => {
      const bridge = makeBridgeStub({
        publishReaction: vi.fn(async () => {
          throw new Error("invalid-symbol");
        }),
      });
      const ipcMain = makeIpcMainStub();
      registerNostrBridgeIPC({
        nostrBridge: bridge,
        nostrIdentity: makeIdentityStub(),
        ipcMain,
        ipcGuard: makeIpcGuardStub(),
      });
      const out = await ipcMain.handlers.get("nostr:publish-reaction")({}, {});
      expect(out).toEqual({ success: false, error: "invalid-symbol" });
    });

    it("returns error when bridge missing", async () => {
      const ipcMain = makeIpcMainStub();
      registerNostrBridgeIPC({
        nostrBridge: null,
        nostrIdentity: makeIdentityStub(),
        ipcMain,
        ipcGuard: makeIpcGuardStub(),
      });
      const out = await ipcMain.handlers.get("nostr:publish-reaction")({}, {});
      expect(out.success).toBe(false);
    });
  });

  // ── Unregister ─────────────────────────────────────────────────────────────
  describe("unregisterNostrBridgeIPC", () => {
    it("removes all 10 handlers and unregisters the module", () => {
      const ipcMain = makeIpcMainStub();
      const ipcGuard = makeIpcGuardStub();
      registerNostrBridgeIPC({
        nostrBridge: makeBridgeStub(),
        nostrIdentity: makeIdentityStub(),
        ipcMain,
        ipcGuard,
      });
      ipcMain.removeHandler.mockClear();
      ipcGuard.unregisterModule.mockClear();

      unregisterNostrBridgeIPC({ ipcMain, ipcGuard });

      expect(ipcMain.removeHandler).toHaveBeenCalledTimes(
        NOSTR_CHANNELS.length,
      );
      for (const channel of NOSTR_CHANNELS) {
        expect(ipcMain.handlers.has(channel)).toBe(false);
      }
      expect(ipcGuard.unregisterModule).toHaveBeenCalledWith(
        "nostr-bridge-ipc",
      );
    });
  });
});
