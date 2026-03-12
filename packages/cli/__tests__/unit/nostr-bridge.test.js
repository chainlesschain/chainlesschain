import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  ensureNostrTables,
  listRelays,
  addRelay,
  publishEvent,
  getEvents,
  generateKeypair,
  mapDid,
  _resetState,
} from "../../src/lib/nostr-bridge.js";

describe("nostr-bridge", () => {
  let db;

  beforeEach(() => {
    db = new MockDatabase();
    _resetState();
    ensureNostrTables(db);
  });

  describe("ensureNostrTables", () => {
    it("creates nostr_relays and nostr_events tables", () => {
      expect(db.tables.has("nostr_relays")).toBe(true);
      expect(db.tables.has("nostr_events")).toBe(true);
    });

    it("is idempotent", () => {
      ensureNostrTables(db);
      expect(db.tables.has("nostr_relays")).toBe(true);
    });
  });

  describe("addRelay", () => {
    it("adds a relay", () => {
      const r = addRelay(db, "wss://relay.example.com");
      expect(r.id).toBeDefined();
      expect(r.url).toBe("wss://relay.example.com");
      expect(r.status).toBe("disconnected");
    });

    it("throws on missing URL", () => {
      expect(() => addRelay(db, "")).toThrow("Relay URL is required");
    });

    it("deduplicates by URL", () => {
      const r1 = addRelay(db, "wss://relay.example.com");
      const r2 = addRelay(db, "wss://relay.example.com");
      expect(r1.id).toBe(r2.id);
    });

    it("persists to database", () => {
      addRelay(db, "wss://relay.example.com");
      const rows = db.data.get("nostr_relays") || [];
      expect(rows.length).toBe(1);
    });
  });

  describe("listRelays", () => {
    it("returns empty initially", () => {
      expect(listRelays()).toEqual([]);
    });

    it("returns all relays", () => {
      addRelay(db, "wss://a.com");
      addRelay(db, "wss://b.com");
      expect(listRelays().length).toBe(2);
    });
  });

  describe("publishEvent", () => {
    it("publishes a text note", () => {
      const r = publishEvent(db, 1, "Hello Nostr", "pubkey123");
      expect(r.success).toBe(true);
      expect(r.event.id).toBeDefined();
      expect(r.event.kind).toBe(1);
      expect(r.event.content).toBe("Hello Nostr");
      expect(r.event.sig).toBeDefined();
    });

    it("throws on missing content", () => {
      expect(() => publishEvent(db, 1, null)).toThrow("Content is required");
    });

    it("counts sent to write-enabled relays", () => {
      addRelay(db, "wss://relay1.com");
      addRelay(db, "wss://relay2.com");
      const r = publishEvent(db, 1, "Test");
      expect(r.sentCount).toBe(2);
    });

    it("persists event to database", () => {
      publishEvent(db, 1, "Test");
      const rows = db.data.get("nostr_events") || [];
      expect(rows.length).toBe(1);
    });

    it("generates unique event IDs (SHA-256)", () => {
      const r1 = publishEvent(db, 1, "A");
      const r2 = publishEvent(db, 1, "B");
      expect(r1.event.id).not.toBe(r2.event.id);
      expect(r1.event.id.length).toBe(64);
    });
  });

  describe("getEvents", () => {
    it("returns empty initially", () => {
      expect(getEvents()).toEqual([]);
    });

    it("returns published events", () => {
      publishEvent(db, 1, "A");
      publishEvent(db, 1, "B");
      expect(getEvents().length).toBe(2);
    });

    it("filters by kind", () => {
      publishEvent(db, 1, "Note");
      publishEvent(db, 7, "Reaction");
      expect(getEvents({ kinds: [1] }).length).toBe(1);
    });

    it("respects limit", () => {
      for (let i = 0; i < 5; i++) publishEvent(db, 1, `msg${i}`);
      expect(getEvents({ limit: 3 }).length).toBe(3);
    });
  });

  describe("generateKeypair", () => {
    it("generates a keypair", () => {
      const kp = generateKeypair();
      expect(kp.publicKey).toBeDefined();
      expect(kp.privateKey).toBeDefined();
      expect(kp.publicKey.length).toBe(64);
      expect(kp.privateKey.length).toBe(64);
    });

    it("generates unique keypairs", () => {
      const kp1 = generateKeypair();
      const kp2 = generateKeypair();
      expect(kp1.publicKey).not.toBe(kp2.publicKey);
    });
  });

  describe("mapDid", () => {
    it("maps a DID to a pubkey", () => {
      const r = mapDid("did:example:alice", "pubkey123");
      expect(r.mapped).toBe(true);
      expect(r.did).toBe("did:example:alice");
      expect(r.nostrPubkey).toBe("pubkey123");
    });

    it("throws on missing DID", () => {
      expect(() => mapDid("", "pk")).toThrow("DID is required");
    });

    it("throws on missing pubkey", () => {
      expect(() => mapDid("did:x", "")).toThrow("Nostr pubkey is required");
    });
  });
});
