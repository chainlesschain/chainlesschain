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
