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

// ─── Real NIP-19 fixtures ─────────────────────────────────────────────────────
// mapDIDToNostr() now delegates to @chainlesschain/session-core/nostr-crypto
// which performs real bech32 decoding — fake "npub1abc" strings no longer
// pass. Use pre-generated valid keypairs so tests still exercise the mapping
// logic without needing network / randomness.
const FIXTURES = {
  A: {
    npub: "npub19uaqrkyrqq8523wzmu4japexwawx822uk8pm58kjyvfm8gymcmxqnmeela",
    nsec: "nsec18zw8tjmvwcwhe8cdu2kac0yjhfk6xk9pjmehse52lauff6tz9egsp90fau",
    pub: "2f3a01d883000f4545c2df2b2e8726775c63a95cb1c3ba1ed22313b3a09bc6cc",
  },
  B: {
    npub: "npub1srey00grsc04we76lsxde2ztrhze6vu65dvh559mlgmmmxv5j78ssyqzye",
    nsec: "nsec1fmpkk3hh8vzrwx5vge3807zf98mkk3vslmxr4e7lx6d5nrcr256sxq43y4",
    pub: "80f247bd03861f5767dafc0cdca84b1dc59d339aa3597a50bbfa37bd9994978f",
  },
  C: {
    npub: "npub1fsa57ptkxrt8yg9agmsplpzz0u5tlsr4azlhjgdgjrplqnwv9mdqrxmlze",
    nsec: "nsec1m2w9wxec0wrssf5xhqspu0e644em6wl38at5q29a6huz8v3fnt2q9cj8nr",
    pub: "4c3b4f057630d67220bd46e01f84427f28bfc075e8bf7921a890c3f04dcc2eda",
  },
  D: {
    npub: "npub1ztwxd926sts0wagfvu3l5rfwne90gamezd75wvsp5xwaugjxu43q5urmtv",
    nsec: "nsec1hqqfns0f58jl23qesc632xsvhq4r8hel96jvfkjrfy6qxjqvuugs0n62w5",
    pub: "12dc66955a82e0f775096723fa0d2e9e4af47779137d473201a19dde2246e562",
  },
  E: {
    npub: "npub1h5wzm9yn27jw0cvvvekdqqv5zt2y522zl0e860fec52q5jhttv6qjhrtmk",
    nsec: "nsec1nnnt2d0kwc98fkp50als7pn504yx3ccg5jf77utvljw6k3xa0twsgp6kkj",
    pub: "bd1c2d949357a4e7e18c666cd0019412d44a2942fbf27d3d39c5140a4aeb5b34",
  },
};

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
        npub: FIXTURES.A.npub,
        nsec: FIXTURES.A.nsec,
      });
      expect(identity._keyPairs.has("did:example:123")).toBe(true);
    });

    it("should return success result", async () => {
      const identity = new NostrIdentity(null);
      const result = await identity.mapDIDToNostr({
        did: "did:example:456",
        npub: FIXTURES.B.npub,
      });
      expect(result.success).toBe(true);
      expect(result.did).toBe("did:example:456");
      expect(result.npub).toBe(FIXTURES.B.npub);
    });

    it("should throw if did is missing", async () => {
      const identity = new NostrIdentity(null);
      await expect(
        identity.mapDIDToNostr({ npub: FIXTURES.A.npub }),
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
        npub: FIXTURES.C.npub,
        nsec: FIXTURES.C.nsec,
      });

      const result = await identity.getNostrKeyForDID("did:example:789");
      expect(result).not.toBeNull();
      expect(result.did).toBe("did:example:789");
      expect(result.npub).toBe(FIXTURES.C.npub);
      expect(result).toHaveProperty("publicKeyHex");
      expect(result.publicKeyHex).toBe(FIXTURES.C.pub);
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
        npub: FIXTURES.D.npub,
      });

      const result = await identity.getDIDForNpub(FIXTURES.D.npub);
      expect(result).not.toBeNull();
      expect(result.did).toBe("did:example:reverse");
      expect(result.npub).toBe(FIXTURES.D.npub);
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
      await identity.mapDIDToNostr({ did: "did:1", npub: FIXTURES.A.npub });
      await identity.mapDIDToNostr({
        did: "did:2",
        npub: FIXTURES.B.npub,
        nsec: FIXTURES.B.nsec,
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
      await identity.mapDIDToNostr({
        did: "did:nopriv",
        npub: FIXTURES.D.npub,
      });
      await identity.mapDIDToNostr({
        did: "did:haspriv",
        npub: FIXTURES.E.npub,
        nsec: FIXTURES.E.nsec,
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
