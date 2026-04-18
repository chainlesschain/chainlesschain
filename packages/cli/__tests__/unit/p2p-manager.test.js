import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  ensureP2PTables,
  generatePeerId,
  generatePairingCode,
  registerPeer,
  getPeer,
  getAllPeers,
  updatePeerStatus,
  sendMessage,
  getInbox,
  markMessageRead,
  getMessageCount,
  pairDevice,
  confirmPairing,
  getPairedDevices,
  unpairDevice,
  deletePeer,
  P2PBridge,
} from "../../src/lib/p2p-manager.js";

describe("P2P Manager", () => {
  let db;

  beforeEach(() => {
    db = new MockDatabase();
  });

  // ─── ensureP2PTables ──────────────────────────────────

  describe("ensureP2PTables", () => {
    it("should create p2p tables", () => {
      ensureP2PTables(db);
      expect(db.tables.has("p2p_peers")).toBe(true);
      expect(db.tables.has("p2p_messages")).toBe(true);
      expect(db.tables.has("p2p_paired_devices")).toBe(true);
    });

    it("should be idempotent", () => {
      ensureP2PTables(db);
      ensureP2PTables(db);
      expect(db.tables.has("p2p_peers")).toBe(true);
    });
  });

  // ─── generatePeerId ───────────────────────────────────

  describe("generatePeerId", () => {
    it("should generate a peer ID", () => {
      const id = generatePeerId();
      expect(id).toMatch(/^peer-[0-9a-f]{32}$/);
    });

    it("should generate unique IDs", () => {
      const id1 = generatePeerId();
      const id2 = generatePeerId();
      expect(id1).not.toBe(id2);
    });
  });

  // ─── generatePairingCode ──────────────────────────────

  describe("generatePairingCode", () => {
    it("should generate a 6-digit code", () => {
      const code = generatePairingCode();
      expect(code).toMatch(/^\d{6}$/);
    });
  });

  // ─── registerPeer ─────────────────────────────────────

  describe("registerPeer", () => {
    it("should register a new peer", () => {
      const peer = registerPeer(
        db,
        "peer-abc123",
        "Alice",
        "did:test:1",
        "pubkey1",
        "desktop",
      );
      expect(peer.peerId).toBe("peer-abc123");
      expect(peer.displayName).toBe("Alice");
      expect(peer.status).toBe("online");
    });

    it("should default device type to cli", () => {
      const peer = registerPeer(db, "peer-abc123", "Alice");
      expect(peer.deviceType).toBe("cli");
    });
  });

  // ─── getPeer / getAllPeers ────────────────────────────

  describe("getPeer", () => {
    it("should find a peer by ID", () => {
      registerPeer(db, "peer-abc123", "Alice");
      const found = getPeer(db, "peer-abc123");
      expect(found).toBeDefined();
      expect(found.peer_id).toBe("peer-abc123");
    });

    it("should return null for non-existent peer", () => {
      ensureP2PTables(db);
      expect(getPeer(db, "peer-nonexistent")).toBeNull();
    });
  });

  describe("getAllPeers", () => {
    it("should return all peers", () => {
      registerPeer(db, "peer-1", "Alice");
      registerPeer(db, "peer-2", "Bob");
      const peers = getAllPeers(db);
      expect(peers).toHaveLength(2);
    });

    it("should return empty array when no peers", () => {
      ensureP2PTables(db);
      expect(getAllPeers(db)).toHaveLength(0);
    });
  });

  // ─── updatePeerStatus ─────────────────────────────────

  describe("updatePeerStatus", () => {
    it("should update peer status", () => {
      registerPeer(db, "peer-abc", "Alice");
      const ok = updatePeerStatus(db, "peer-abc", "offline");
      expect(ok).toBe(true);
    });

    it("should return false for non-existent peer", () => {
      ensureP2PTables(db);
      expect(updatePeerStatus(db, "peer-nope", "online")).toBe(false);
    });
  });

  // ─── sendMessage / getInbox ───────────────────────────

  describe("sendMessage", () => {
    it("should send a message", () => {
      registerPeer(db, "peer-a", "Alice");
      registerPeer(db, "peer-b", "Bob");
      const msg = sendMessage(db, "peer-a", "peer-b", "Hello Bob!");
      expect(msg.id).toMatch(/^msg-/);
      expect(msg.content).toBe("Hello Bob!");
    });

    it("should throw for non-existent recipient", () => {
      registerPeer(db, "peer-a", "Alice");
      expect(() => sendMessage(db, "peer-a", "peer-nonexistent", "Hi")).toThrow(
        "Peer not found",
      );
    });
  });

  describe("getInbox", () => {
    it("should get messages for a peer", () => {
      registerPeer(db, "peer-a", "Alice");
      registerPeer(db, "peer-b", "Bob");
      sendMessage(db, "peer-a", "peer-b", "Hello!");
      sendMessage(db, "peer-a", "peer-b", "How are you?");
      const inbox = getInbox(db, "peer-b");
      expect(inbox).toHaveLength(2);
    });

    it("should return empty for no messages", () => {
      ensureP2PTables(db);
      expect(getInbox(db, "peer-x")).toHaveLength(0);
    });
  });

  // ─── markMessageRead ──────────────────────────────────

  describe("markMessageRead", () => {
    it("should mark a message as read", () => {
      registerPeer(db, "peer-a", "Alice");
      registerPeer(db, "peer-b", "Bob");
      const msg = sendMessage(db, "peer-a", "peer-b", "Hello!");
      const ok = markMessageRead(db, msg.id);
      expect(ok).toBe(true);
    });
  });

  // ─── getMessageCount ──────────────────────────────────

  describe("getMessageCount", () => {
    it("should count messages", () => {
      registerPeer(db, "peer-a", "Alice");
      registerPeer(db, "peer-b", "Bob");
      sendMessage(db, "peer-a", "peer-b", "Hello!");
      const count = getMessageCount(db, "peer-b");
      expect(count.total).toBe(1);
      expect(count.unread).toBe(1);
    });

    it("should return zero for no messages", () => {
      ensureP2PTables(db);
      const count = getMessageCount(db, "peer-x");
      expect(count.total).toBe(0);
      expect(count.unread).toBe(0);
    });
  });

  // ─── Device pairing ───────────────────────────────────

  describe("pairDevice", () => {
    it("should create a device pairing", () => {
      const device = pairDevice(db, "My Phone", "mobile");
      expect(device.deviceId).toMatch(/^device-/);
      expect(device.deviceName).toBe("My Phone");
      expect(device.pairingCode).toMatch(/^\d{6}$/);
      expect(device.status).toBe("pending");
    });
  });

  describe("confirmPairing", () => {
    it("should confirm pairing with correct code", () => {
      const device = pairDevice(db, "My Phone", "mobile");
      const result = confirmPairing(db, device.deviceId, device.pairingCode);
      expect(result.success).toBe(true);
    });

    it("should reject wrong code", () => {
      const device = pairDevice(db, "My Phone", "mobile");
      const result = confirmPairing(db, device.deviceId, "000000");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid");
    });

    it("should fail for non-existent device", () => {
      ensureP2PTables(db);
      const result = confirmPairing(db, "device-nope", "123456");
      expect(result.success).toBe(false);
    });
  });

  describe("getPairedDevices", () => {
    it("should list paired devices", () => {
      pairDevice(db, "Phone", "mobile");
      pairDevice(db, "Tablet", "tablet");
      const devices = getPairedDevices(db);
      expect(devices).toHaveLength(2);
    });
  });

  describe("unpairDevice", () => {
    it("should unpair a device", () => {
      const device = pairDevice(db, "Phone", "mobile");
      const ok = unpairDevice(db, device.deviceId);
      expect(ok).toBe(true);
      expect(getPairedDevices(db)).toHaveLength(0);
    });

    it("should return false for non-existent device", () => {
      ensureP2PTables(db);
      expect(unpairDevice(db, "device-nope")).toBe(false);
    });
  });

  // ─── deletePeer ───────────────────────────────────────

  describe("deletePeer", () => {
    it("should delete a peer", () => {
      registerPeer(db, "peer-abc", "Alice");
      const ok = deletePeer(db, "peer-abc");
      expect(ok).toBe(true);
      expect(getPeer(db, "peer-abc")).toBeNull();
    });

    it("should return false for non-existent peer", () => {
      ensureP2PTables(db);
      expect(deletePeer(db, "peer-nope")).toBe(false);
    });
  });

  // ─── P2PBridge ────────────────────────────────────────

  describe("P2PBridge", () => {
    it("should create a bridge instance", () => {
      const bridge = new P2PBridge();
      expect(bridge.host).toBe("localhost");
      expect(bridge.port).toBe(9001);
      expect(bridge.connected).toBe(false);
    });

    it("should return status info", () => {
      const bridge = new P2PBridge({ host: "192.168.1.1", port: 8080 });
      const status = bridge.getStatus();
      expect(status.host).toBe("192.168.1.1");
      expect(status.port).toBe(8080);
      expect(status.connected).toBe(false);
    });

    it("should handle bridge check failure gracefully", async () => {
      const bridge = new P2PBridge({ port: 59999, timeout: 500 });
      const available = await bridge.checkBridge();
      expect(available).toBe(false);
    });
  });
});

import {
  PEER_MATURITY_V2,
  MESSAGE_LIFECYCLE_V2,
  PEER_DEFAULT_MAX_ACTIVE_PER_NETWORK,
  PEER_DEFAULT_MAX_PENDING_MESSAGES_PER_PEER,
  PEER_DEFAULT_PEER_IDLE_MS,
  PEER_DEFAULT_MESSAGE_STUCK_MS,
  getMaxActivePeersPerNetworkV2,
  setMaxActivePeersPerNetworkV2,
  getMaxPendingMessagesPerPeerV2,
  setMaxPendingMessagesPerPeerV2,
  getPeerIdleMsV2,
  setPeerIdleMsV2,
  getMessageStuckMsV2,
  setMessageStuckMsV2,
  registerPeerV2,
  getPeerV2,
  listPeersV2,
  setPeerStatusV2,
  activatePeerV2,
  offlinePeerV2,
  archivePeerV2,
  touchPeerV2,
  createMessageV2,
  getMessageV2,
  listMessagesV2,
  setMessageStatusV2,
  startMessageV2,
  deliverMessageV2,
  failMessageV2,
  cancelMessageV2,
  getActivePeerCountV2,
  getPendingMessageCountV2,
  autoOfflineIdlePeersV2,
  autoFailStuckMessagesV2,
  getP2pManagerStatsV2,
  _resetStateP2pManagerV2,
} from "../../src/lib/p2p-manager.js";

describe("P2P Manager V2", () => {
  beforeEach(() => _resetStateP2pManagerV2());

  describe("frozen enums + defaults", () => {
    it("freezes PEER_MATURITY_V2", () => {
      expect(Object.isFrozen(PEER_MATURITY_V2)).toBe(true);
      expect(Object.values(PEER_MATURITY_V2).sort()).toEqual([
        "active",
        "archived",
        "offline",
        "pending",
      ]);
    });
    it("freezes MESSAGE_LIFECYCLE_V2", () => {
      expect(Object.isFrozen(MESSAGE_LIFECYCLE_V2)).toBe(true);
      expect(Object.values(MESSAGE_LIFECYCLE_V2).sort()).toEqual([
        "cancelled",
        "delivered",
        "failed",
        "queued",
        "sending",
      ]);
    });
    it("exposes defaults", () => {
      expect(PEER_DEFAULT_MAX_ACTIVE_PER_NETWORK).toBe(100);
      expect(PEER_DEFAULT_MAX_PENDING_MESSAGES_PER_PEER).toBe(50);
      expect(PEER_DEFAULT_PEER_IDLE_MS).toBe(10 * 60 * 1000);
      expect(PEER_DEFAULT_MESSAGE_STUCK_MS).toBe(60 * 1000);
    });
  });

  describe("config getters/setters", () => {
    it("returns defaults", () => {
      expect(getMaxActivePeersPerNetworkV2()).toBe(100);
      expect(getMaxPendingMessagesPerPeerV2()).toBe(50);
    });
    it("setters accept positives + floor non-integer", () => {
      setMaxActivePeersPerNetworkV2(2.7);
      setMaxPendingMessagesPerPeerV2(3);
      setPeerIdleMsV2(5_000);
      setMessageStuckMsV2(2_000);
      expect(getMaxActivePeersPerNetworkV2()).toBe(2);
      expect(getMaxPendingMessagesPerPeerV2()).toBe(3);
      expect(getPeerIdleMsV2()).toBe(5_000);
      expect(getMessageStuckMsV2()).toBe(2_000);
    });
    it("rejects bad values", () => {
      expect(() => setMaxActivePeersPerNetworkV2(0)).toThrow();
      expect(() => setMaxPendingMessagesPerPeerV2(-1)).toThrow();
      expect(() => setPeerIdleMsV2(NaN)).toThrow();
      expect(() => setMessageStuckMsV2("x")).toThrow();
    });
  });

  describe("registerPeerV2", () => {
    it("registers PENDING with required fields", () => {
      const p = registerPeerV2("p1", {
        networkId: "n1",
        deviceName: "Phone",
        deviceType: "mobile",
      });
      expect(p.status).toBe("pending");
      expect(p.networkId).toBe("n1");
      expect(p.deviceName).toBe("Phone");
      expect(p.deviceType).toBe("mobile");
      expect(p.activatedAt).toBeNull();
    });
    it("defaults deviceName to id, deviceType to desktop", () => {
      const p = registerPeerV2("p1", { networkId: "n1" });
      expect(p.deviceName).toBe("p1");
      expect(p.deviceType).toBe("desktop");
    });
    it("rejects duplicate id", () => {
      registerPeerV2("p1", { networkId: "n1" });
      expect(() => registerPeerV2("p1", { networkId: "n1" })).toThrow(
        /already exists/,
      );
    });
    it("rejects missing required", () => {
      expect(() => registerPeerV2("p1")).toThrow(/networkId/);
      expect(() => registerPeerV2("", { networkId: "n1" })).toThrow(/peer id/);
    });
    it("metadata copied defensively", () => {
      const meta = { v: 1 };
      registerPeerV2("p1", { networkId: "n1", metadata: meta });
      meta.v = 99;
      expect(getPeerV2("p1").metadata.v).toBe(1);
    });
  });

  describe("peer state machine", () => {
    beforeEach(() => {
      registerPeerV2("p1", { networkId: "n1" });
    });
    it("pending→active stamps activatedAt", () => {
      const p = activatePeerV2("p1");
      expect(p.status).toBe("active");
      expect(p.activatedAt).toBeGreaterThan(0);
    });
    it("active→offline→active preserves activatedAt", () => {
      const p1 = activatePeerV2("p1");
      const ts = p1.activatedAt;
      offlinePeerV2("p1");
      const p3 = activatePeerV2("p1");
      expect(p3.activatedAt).toBe(ts);
    });
    it("archived terminal", () => {
      activatePeerV2("p1");
      archivePeerV2("p1");
      expect(() => activatePeerV2("p1")).toThrow(/invalid peer transition/);
    });
    it("archivedAt stamped on first terminal", () => {
      activatePeerV2("p1");
      const p = archivePeerV2("p1");
      expect(p.archivedAt).toBeGreaterThan(0);
    });
    it("rejects pending→offline", () => {
      expect(() => offlinePeerV2("p1")).toThrow(/invalid peer transition/);
    });
    it("rejects unknown peer", () => {
      expect(() => activatePeerV2("nope")).toThrow(/not found/);
    });
  });

  describe("per-network active-peer cap", () => {
    it("rejects pending→active beyond cap", () => {
      setMaxActivePeersPerNetworkV2(2);
      registerPeerV2("p1", { networkId: "n1" });
      registerPeerV2("p2", { networkId: "n1" });
      registerPeerV2("p3", { networkId: "n1" });
      activatePeerV2("p1");
      activatePeerV2("p2");
      expect(() => activatePeerV2("p3")).toThrow(/active-peer cap/);
    });
    it("recovery is exempt from cap", () => {
      setMaxActivePeersPerNetworkV2(1);
      registerPeerV2("p1", { networkId: "n1" });
      registerPeerV2("p2", { networkId: "n1" });
      activatePeerV2("p1");
      offlinePeerV2("p1");
      activatePeerV2("p2");
      const p = activatePeerV2("p1");
      expect(p.status).toBe("active");
    });
    it("scoped by network", () => {
      setMaxActivePeersPerNetworkV2(1);
      registerPeerV2("p1", { networkId: "n1" });
      registerPeerV2("p2", { networkId: "n2" });
      activatePeerV2("p1");
      const p = activatePeerV2("p2");
      expect(p.status).toBe("active");
    });
  });

  describe("listPeersV2", () => {
    it("filters by network/status/deviceType", () => {
      registerPeerV2("p1", { networkId: "n1", deviceType: "mobile" });
      registerPeerV2("p2", { networkId: "n1", deviceType: "desktop" });
      registerPeerV2("p3", { networkId: "n2", deviceType: "mobile" });
      activatePeerV2("p1");
      expect(listPeersV2({ networkId: "n1" })).toHaveLength(2);
      expect(listPeersV2({ deviceType: "mobile" })).toHaveLength(2);
      expect(listPeersV2({ status: "active" })).toHaveLength(1);
    });
  });

  describe("touchPeerV2", () => {
    it("updates lastSeenAt", async () => {
      registerPeerV2("p1", { networkId: "n1" });
      const before = getPeerV2("p1").lastSeenAt;
      await new Promise((r) => setTimeout(r, 5));
      const p = touchPeerV2("p1");
      expect(p.lastSeenAt).toBeGreaterThan(before);
    });
    it("throws on unknown id", () => {
      expect(() => touchPeerV2("nope")).toThrow(/not found/);
    });
  });

  describe("createMessageV2", () => {
    beforeEach(() => {
      registerPeerV2("p1", { networkId: "n1" });
    });
    it("creates QUEUED with required fields", () => {
      const m = createMessageV2("m1", { peerId: "p1", kind: "image" });
      expect(m.status).toBe("queued");
      expect(m.peerId).toBe("p1");
      expect(m.kind).toBe("image");
      expect(m.startedAt).toBeNull();
    });
    it("defaults kind to text", () => {
      const m = createMessageV2("m1", { peerId: "p1" });
      expect(m.kind).toBe("text");
    });
    it("rejects duplicate id", () => {
      createMessageV2("m1", { peerId: "p1" });
      expect(() => createMessageV2("m1", { peerId: "p1" })).toThrow(
        /already exists/,
      );
    });
    it("rejects unknown peer", () => {
      expect(() => createMessageV2("m1", { peerId: "ghost" })).toThrow(
        /not found/,
      );
    });
    it("enforces per-peer pending cap (counts queued+sending)", () => {
      setMaxPendingMessagesPerPeerV2(2);
      createMessageV2("m1", { peerId: "p1" });
      createMessageV2("m2", { peerId: "p1" });
      expect(() => createMessageV2("m3", { peerId: "p1" })).toThrow(
        /pending-message cap/,
      );
      startMessageV2("m1");
      expect(() => createMessageV2("m3", { peerId: "p1" })).toThrow(
        /pending-message cap/,
      );
      deliverMessageV2("m1");
      const m3 = createMessageV2("m3", { peerId: "p1" });
      expect(m3.status).toBe("queued");
    });
  });

  describe("message state machine", () => {
    beforeEach(() => {
      registerPeerV2("p1", { networkId: "n1" });
      createMessageV2("m1", { peerId: "p1" });
    });
    it("queued→sending stamps startedAt", () => {
      const m = startMessageV2("m1");
      expect(m.status).toBe("sending");
      expect(m.startedAt).toBeGreaterThan(0);
    });
    it("sending→delivered stamps settledAt", () => {
      startMessageV2("m1");
      const m = deliverMessageV2("m1");
      expect(m.settledAt).toBeGreaterThan(0);
    });
    it("sending→failed stamps settledAt", () => {
      startMessageV2("m1");
      const m = failMessageV2("m1");
      expect(m.settledAt).toBeGreaterThan(0);
    });
    it("queued and sending both → cancelled", () => {
      cancelMessageV2("m1");
      expect(getMessageV2("m1").status).toBe("cancelled");
      createMessageV2("m2", { peerId: "p1" });
      startMessageV2("m2");
      cancelMessageV2("m2");
      expect(getMessageV2("m2").status).toBe("cancelled");
    });
    it("rejects invalid transitions", () => {
      expect(() => deliverMessageV2("m1")).toThrow(
        /invalid message transition/,
      );
    });
  });

  describe("listMessagesV2", () => {
    it("filters by peer and status", () => {
      registerPeerV2("p1", { networkId: "n1" });
      registerPeerV2("p2", { networkId: "n1" });
      createMessageV2("m1", { peerId: "p1" });
      createMessageV2("m2", { peerId: "p1" });
      createMessageV2("m3", { peerId: "p2" });
      startMessageV2("m1");
      expect(listMessagesV2({ peerId: "p1" })).toHaveLength(2);
      expect(listMessagesV2({ status: "queued" })).toHaveLength(2);
    });
  });

  describe("autoOfflineIdlePeersV2", () => {
    it("flips active peers past idle threshold", () => {
      setPeerIdleMsV2(1000);
      registerPeerV2("p1", { networkId: "n1" });
      activatePeerV2("p1");
      const r = autoOfflineIdlePeersV2({ now: Date.now() + 5_000 });
      expect(r.count).toBe(1);
      expect(getPeerV2("p1").status).toBe("offline");
    });
  });

  describe("autoFailStuckMessagesV2", () => {
    it("flips sending messages past stuck threshold", () => {
      setMessageStuckMsV2(1000);
      registerPeerV2("p1", { networkId: "n1" });
      createMessageV2("m1", { peerId: "p1" });
      startMessageV2("m1");
      const r = autoFailStuckMessagesV2({ now: Date.now() + 5_000 });
      expect(r.count).toBe(1);
      expect(getMessageV2("m1").status).toBe("failed");
    });
    it("ignores queued messages", () => {
      registerPeerV2("p1", { networkId: "n1" });
      createMessageV2("m1", { peerId: "p1" });
      const r = autoFailStuckMessagesV2({ now: Date.now() + 1e9 });
      expect(r.count).toBe(0);
    });
  });

  describe("getP2pManagerStatsV2", () => {
    it("zero state has all keys", () => {
      const s = getP2pManagerStatsV2();
      expect(s.peersByStatus).toEqual({
        pending: 0,
        active: 0,
        offline: 0,
        archived: 0,
      });
      expect(s.messagesByStatus).toEqual({
        queued: 0,
        sending: 0,
        delivered: 0,
        failed: 0,
        cancelled: 0,
      });
    });
    it("counts after operations", () => {
      registerPeerV2("p1", { networkId: "n1" });
      activatePeerV2("p1");
      createMessageV2("m1", { peerId: "p1" });
      startMessageV2("m1");
      const s = getP2pManagerStatsV2();
      expect(s.peersByStatus.active).toBe(1);
      expect(s.messagesByStatus.sending).toBe(1);
    });
  });

  describe("counts", () => {
    it("getActivePeerCountV2 scoped by network", () => {
      registerPeerV2("p1", { networkId: "n1" });
      registerPeerV2("p2", { networkId: "n2" });
      activatePeerV2("p1");
      activatePeerV2("p2");
      expect(getActivePeerCountV2("n1")).toBe(1);
      expect(getActivePeerCountV2("nope")).toBe(0);
    });
    it("getPendingMessageCountV2 counts queued+sending", () => {
      registerPeerV2("p1", { networkId: "n1" });
      createMessageV2("m1", { peerId: "p1" });
      createMessageV2("m2", { peerId: "p1" });
      startMessageV2("m1");
      expect(getPendingMessageCountV2("p1")).toBe(2);
      deliverMessageV2("m1");
      expect(getPendingMessageCountV2("p1")).toBe(1);
    });
  });

  describe("_resetStateP2pManagerV2", () => {
    it("clears state and restores defaults", () => {
      setMaxActivePeersPerNetworkV2(99);
      registerPeerV2("p1", { networkId: "n1" });
      _resetStateP2pManagerV2();
      expect(getMaxActivePeersPerNetworkV2()).toBe(100);
      expect(getPeerV2("p1")).toBeNull();
    });
  });
});
