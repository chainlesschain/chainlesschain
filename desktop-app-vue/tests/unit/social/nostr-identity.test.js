/**
 * NostrIdentity Unit Tests
 *
 * Covers:
 * - Constructor: initialized=false, _keyPairs is Map
 * - initialize(): sets initialized
 * - generateKeyPair(): returns {npub, nsec, publicKeyHex, privateKeyHex}, npub starts with 'npub1', nsec starts with 'nsec1'
 * - mapDIDToNostr(): stores mapping
 * - getNostrKeyForDID(): retrieves mapping
 * - getDIDForNpub(): reverse lookup
 * - listMappings(): returns all mappings
 * - Singleton: getNostrIdentity returns same instance
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

// ─── Mock crypto ──────────────────────────────────────────────────────────────
const fakePrivKeyHex = "aa".repeat(32);
const fakePubKeyHex = "bb".repeat(32);

vi.mock("crypto", () => {
  return {
    default: {
      randomBytes: (n) => {
        const hex = "aa".repeat(n);
        return {
          toString: () => hex,
        };
      },
      createECDH: () => ({
        setPrivateKey: vi.fn(),
        getPublicKey: () => "02" + "bb".repeat(32),
      }),
      createHash: () => ({
        update: () => ({
          digest: () => "cc".repeat(32),
        }),
      }),
    },
    randomBytes: (n) => {
      const hex = "aa".repeat(n);
      return {
        toString: () => hex,
      };
    },
    createECDH: () => ({
      setPrivateKey: vi.fn(),
      getPublicKey: () => "02" + "bb".repeat(32),
    }),
    createHash: () => ({
      update: () => ({
        digest: () => "cc".repeat(32),
      }),
    }),
  };
});

// ─── Module under test (ESM - dynamic import) ───────────────────────────────
let NostrIdentity, getNostrIdentity;

beforeEach(async () => {
  const mod = await import("../../../src/main/social/nostr-identity.js");
  NostrIdentity = mod.NostrIdentity;
  getNostrIdentity = mod.getNostrIdentity;
});

// ═══════════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe("NostrIdentity", () => {
  // ── Constructor ──────────────────────────────────────────────────────────────
  describe("constructor", () => {
    it("should set initialized to false", () => {
      const identity = new NostrIdentity(null);
      expect(identity.initialized).toBe(false);
    });

    it("should initialize _keyPairs as a Map", () => {
      const identity = new NostrIdentity(null);
      expect(identity._keyPairs).toBeInstanceOf(Map);
      expect(identity._keyPairs.size).toBe(0);
    });

    it("should store the database reference", () => {
      const database = { db: {} };
      const identity = new NostrIdentity(database);
      expect(identity.database).toBe(database);
    });
  });

  // ── initialize() ────────────────────────────────────────────────────────────
  describe("initialize()", () => {
    it("should set initialized to true", async () => {
      const identity = new NostrIdentity(null);
      await identity.initialize();
      expect(identity.initialized).toBe(true);
    });
  });

  // ── generateKeyPair() ──────────────────────────────────────────────────────
  describe("generateKeyPair()", () => {
    it("should return object with npub, nsec, publicKeyHex, privateKeyHex", async () => {
      const identity = new NostrIdentity(null);
      const keyPair = await identity.generateKeyPair();

      expect(keyPair).toHaveProperty("npub");
      expect(keyPair).toHaveProperty("nsec");
      expect(keyPair).toHaveProperty("publicKeyHex");
      expect(keyPair).toHaveProperty("privateKeyHex");
    });

    it("should have npub starting with 'npub1'", async () => {
      const identity = new NostrIdentity(null);
      const keyPair = await identity.generateKeyPair();
      expect(keyPair.npub.startsWith("npub1")).toBe(true);
    });

    it("should have nsec starting with 'nsec1'", async () => {
      const identity = new NostrIdentity(null);
      const keyPair = await identity.generateKeyPair();
      expect(keyPair.nsec.startsWith("nsec1")).toBe(true);
    });

    it("should return hex strings for keys", async () => {
      const identity = new NostrIdentity(null);
      const keyPair = await identity.generateKeyPair();
      expect(typeof keyPair.publicKeyHex).toBe("string");
      expect(typeof keyPair.privateKeyHex).toBe("string");
      expect(keyPair.publicKeyHex.length).toBeGreaterThan(0);
      expect(keyPair.privateKeyHex.length).toBeGreaterThan(0);
    });
  });

  // ── mapDIDToNostr() ────────────────────────────────────────────────────────
  describe("mapDIDToNostr()", () => {
    it("should store mapping in _keyPairs", async () => {
      const identity = new NostrIdentity(null);
      await identity.mapDIDToNostr({
        did: "did:example:123",
        npub: "npub1abc",
        nsec: "nsec1xyz",
      });
      expect(identity._keyPairs.has("did:example:123")).toBe(true);
    });

    it("should return success result", async () => {
      const identity = new NostrIdentity(null);
      const result = await identity.mapDIDToNostr({
        did: "did:example:456",
        npub: "npub1def",
      });
      expect(result.success).toBe(true);
      expect(result.did).toBe("did:example:456");
      expect(result.npub).toBe("npub1def");
    });

    it("should throw if did is missing", async () => {
      const identity = new NostrIdentity(null);
      await expect(
        identity.mapDIDToNostr({ npub: "npub1abc" }),
      ).rejects.toThrow("Both did and npub are required");
    });

    it("should throw if npub is missing", async () => {
      const identity = new NostrIdentity(null);
      await expect(
        identity.mapDIDToNostr({ did: "did:example:123" }),
      ).rejects.toThrow("Both did and npub are required");
    });
  });

  // ── getNostrKeyForDID() ────────────────────────────────────────────────────
  describe("getNostrKeyForDID()", () => {
    it("should return null for unmapped DID", async () => {
      const identity = new NostrIdentity(null);
      const result = await identity.getNostrKeyForDID("did:example:unknown");
      expect(result).toBeNull();
    });

    it("should return mapping for known DID", async () => {
      const identity = new NostrIdentity(null);
      await identity.mapDIDToNostr({
        did: "did:example:789",
        npub: "npub1ghi",
        nsec: "nsec1jkl",
      });

      const result = await identity.getNostrKeyForDID("did:example:789");
      expect(result).not.toBeNull();
      expect(result.did).toBe("did:example:789");
      expect(result.npub).toBe("npub1ghi");
      expect(result).toHaveProperty("publicKeyHex");
    });
  });

  // ── getDIDForNpub() ────────────────────────────────────────────────────────
  describe("getDIDForNpub()", () => {
    it("should return null for unknown npub", async () => {
      const identity = new NostrIdentity(null);
      const result = await identity.getDIDForNpub("npub1unknown");
      expect(result).toBeNull();
    });

    it("should return DID for known npub (reverse lookup)", async () => {
      const identity = new NostrIdentity(null);
      await identity.mapDIDToNostr({
        did: "did:example:reverse",
        npub: "npub1reverse",
      });

      const result = await identity.getDIDForNpub("npub1reverse");
      expect(result).not.toBeNull();
      expect(result.did).toBe("did:example:reverse");
      expect(result.npub).toBe("npub1reverse");
    });
  });

  // ── listMappings() ─────────────────────────────────────────────────────────
  describe("listMappings()", () => {
    it("should return empty array when no mappings", async () => {
      const identity = new NostrIdentity(null);
      const mappings = await identity.listMappings();
      expect(mappings).toEqual([]);
    });

    it("should return all mappings", async () => {
      const identity = new NostrIdentity(null);
      await identity.mapDIDToNostr({ did: "did:1", npub: "npub1a" });
      await identity.mapDIDToNostr({
        did: "did:2",
        npub: "npub1b",
        nsec: "nsec1c",
      });

      const mappings = await identity.listMappings();
      expect(mappings.length).toBe(2);
      expect(mappings[0]).toHaveProperty("did");
      expect(mappings[0]).toHaveProperty("npub");
      expect(mappings[0]).toHaveProperty("publicKeyHex");
      expect(mappings[0]).toHaveProperty("hasPrivateKey");
    });

    it("should indicate hasPrivateKey correctly", async () => {
      const identity = new NostrIdentity(null);
      await identity.mapDIDToNostr({ did: "did:nopriv", npub: "npub1np" });
      await identity.mapDIDToNostr({
        did: "did:haspriv",
        npub: "npub1hp",
        nsec: "nsec1hp",
      });

      const mappings = await identity.listMappings();
      const noPriv = mappings.find((m) => m.did === "did:nopriv");
      const hasPriv = mappings.find((m) => m.did === "did:haspriv");
      expect(noPriv.hasPrivateKey).toBe(false);
      expect(hasPriv.hasPrivateKey).toBe(true);
    });
  });

  // ── Singleton ───────────────────────────────────────────────────────────────
  describe("Singleton", () => {
    it("getNostrIdentity returns the same instance", () => {
      const a = getNostrIdentity(null);
      const b = getNostrIdentity(null);
      expect(a).toBe(b);
    });
  });
});
