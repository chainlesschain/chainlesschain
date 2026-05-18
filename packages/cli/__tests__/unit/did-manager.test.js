import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  // V2 surface
  IDENTITY_MATURITY_V2,
  ISSUANCE_LIFECYCLE_V2,
  DID_DEFAULT_MAX_ACTIVE_IDENTITIES_PER_OWNER,
  DID_DEFAULT_MAX_PENDING_ISSUANCES_PER_IDENTITY,
  DID_DEFAULT_IDENTITY_IDLE_MS,
  DID_DEFAULT_ISSUANCE_STUCK_MS,
  getMaxActiveIdentitiesPerOwnerV2,
  setMaxActiveIdentitiesPerOwnerV2,
  getMaxPendingIssuancesPerIdentityV2,
  setMaxPendingIssuancesPerIdentityV2,
  getIdentityIdleMsV2,
  setIdentityIdleMsV2,
  getIssuanceStuckMsV2,
  setIssuanceStuckMsV2,
  registerIdentityV2,
  getIdentityV2,
  listIdentitiesV2,
  activateIdentityV2,
  suspendIdentityV2,
  revokeIdentityV2,
  touchIdentityV2,
  createIssuanceV2,
  getIssuanceV2,
  listIssuancesV2,
  startIssuanceV2,
  completeIssuanceV2,
  failIssuanceV2,
  cancelIssuanceV2,
  getActiveIdentityCountV2,
  getPendingIssuanceCountV2,
  autoSuspendIdleIdentitiesV2,
  autoFailStuckIssuancesV2,
  getDidManagerStatsV2,
  _resetStateDidManagerV2,
  ensureDIDTables,
  generateKeyPair,
  generateDID,
  createDIDDocument,
  createIdentity,
  getIdentity,
  getAllIdentities,
  getDefaultIdentity,
  setDefaultIdentity,
  deleteIdentity,
  signMessage,
  verifySignature,
  verifyWithDID,
  exportIdentity,
  resolveDID,
} from "../../src/lib/did-manager.js";

describe("DID Manager", () => {
  let db;

  beforeEach(() => {
    db = new MockDatabase();
  });

  // ─── ensureDIDTables ─────────────────────────────────────

  describe("ensureDIDTables", () => {
    it("should create did_identities table", () => {
      ensureDIDTables(db);
      expect(db.tables.has("did_identities")).toBe(true);
    });

    it("should be idempotent", () => {
      ensureDIDTables(db);
      ensureDIDTables(db);
      expect(db.tables.has("did_identities")).toBe(true);
    });
  });

  // ─── generateKeyPair ─────────────────────────────────────

  describe("generateKeyPair", () => {
    it("should generate a keypair with public and secret keys", () => {
      const keys = generateKeyPair();
      expect(keys.publicKey).toBeDefined();
      expect(keys.secretKey).toBeDefined();
      expect(typeof keys.publicKey).toBe("string");
      expect(typeof keys.secretKey).toBe("string");
    });

    it("should generate different keys each time", () => {
      const keys1 = generateKeyPair();
      const keys2 = generateKeyPair();
      expect(keys1.publicKey).not.toBe(keys2.publicKey);
      expect(keys1.secretKey).not.toBe(keys2.secretKey);
    });

    it("should generate hex-encoded keys", () => {
      const keys = generateKeyPair();
      expect(keys.publicKey).toMatch(/^[0-9a-f]+$/i);
      expect(keys.secretKey).toMatch(/^[0-9a-f]+$/i);
    });
  });

  // ─── generateDID ──────────────────────────────────────────

  describe("generateDID", () => {
    it("should generate a DID string", () => {
      const keys = generateKeyPair();
      const did = generateDID(keys.publicKey);
      expect(did).toMatch(/^did:chainless:/);
    });

    it("should generate consistent DID for same key", () => {
      const keys = generateKeyPair();
      const did1 = generateDID(keys.publicKey);
      const did2 = generateDID(keys.publicKey);
      expect(did1).toBe(did2);
    });

    it("should generate different DIDs for different keys", () => {
      const keys1 = generateKeyPair();
      const keys2 = generateKeyPair();
      expect(generateDID(keys1.publicKey)).not.toBe(
        generateDID(keys2.publicKey),
      );
    });
  });

  // ─── createDIDDocument ────────────────────────────────────

  describe("createDIDDocument", () => {
    it("should create a valid DID document", () => {
      const doc = createDIDDocument(
        "did:chainless:test123",
        "pubkey123",
        "Alice",
      );
      expect(doc["@context"]).toContain("https://www.w3.org/ns/did/v1");
      expect(doc.id).toBe("did:chainless:test123");
      expect(doc.controller).toBe("did:chainless:test123");
      expect(doc.verificationMethod).toHaveLength(1);
      expect(doc.verificationMethod[0].publicKeyHex).toBe("pubkey123");
      expect(doc.authentication).toHaveLength(1);
    });

    it("should include profile service when displayName is provided", () => {
      const doc = createDIDDocument("did:chainless:test", "pubkey", "Bob");
      expect(doc.service).toHaveLength(1);
      expect(doc.service[0].type).toBe("ProfileService");
    });

    it("should have empty service when no displayName", () => {
      const doc = createDIDDocument("did:chainless:test", "pubkey", null);
      expect(doc.service).toHaveLength(0);
    });
  });

  // ─── createIdentity ──────────────────────────────────────

  describe("createIdentity", () => {
    it("should create an identity with DID", () => {
      const identity = createIdentity(db, "Alice");
      expect(identity.did).toMatch(/^did:chainless:/);
      expect(identity.displayName).toBe("Alice");
      expect(identity.publicKey).toBeDefined();
      expect(identity.document).toBeDefined();
    });

    it("should set first identity as default", () => {
      const identity = createIdentity(db, "First");
      expect(identity.isDefault).toBe(true);
    });

    it("should not set subsequent identities as default", () => {
      createIdentity(db, "First");
      const second = createIdentity(db, "Second");
      expect(second.isDefault).toBe(false);
    });

    it("should create identity without name", () => {
      const identity = createIdentity(db);
      expect(identity.did).toMatch(/^did:chainless:/);
      expect(identity.displayName).toBeUndefined();
    });
  });

  // ─── getIdentity ─────────────────────────────────────────

  describe("getIdentity", () => {
    it("should find identity by full DID", () => {
      const created = createIdentity(db, "Alice");
      const found = getIdentity(db, created.did);
      expect(found).toBeDefined();
      expect(found.did).toBe(created.did);
    });

    it("should find identity by prefix", () => {
      const created = createIdentity(db, "Alice");
      const prefix = created.did.slice(0, 20);
      const found = getIdentity(db, prefix);
      expect(found).toBeDefined();
    });

    it("should return null for non-existent DID", () => {
      ensureDIDTables(db);
      const found = getIdentity(db, "did:chainless:nonexistent");
      expect(found).toBeNull();
    });
  });

  // ─── getAllIdentities ─────────────────────────────────────

  describe("getAllIdentities", () => {
    it("should return all identities", () => {
      createIdentity(db, "Alice");
      createIdentity(db, "Bob");
      const all = getAllIdentities(db);
      expect(all).toHaveLength(2);
    });

    it("should return empty array when no identities", () => {
      ensureDIDTables(db);
      expect(getAllIdentities(db)).toHaveLength(0);
    });
  });

  // ─── setDefaultIdentity ───────────────────────────────────

  describe("setDefaultIdentity", () => {
    it("should set a different identity as default", () => {
      const first = createIdentity(db, "First");
      const second = createIdentity(db, "Second");

      const ok = setDefaultIdentity(db, second.did);
      expect(ok).toBe(true);

      const updated = getIdentity(db, second.did);
      expect(updated.is_default).toBe(1);
    });

    it("should return false for non-existent DID", () => {
      ensureDIDTables(db);
      expect(setDefaultIdentity(db, "did:chainless:nope")).toBe(false);
    });
  });

  // ─── deleteIdentity ───────────────────────────────────────

  describe("deleteIdentity", () => {
    it("should delete an identity", () => {
      const created = createIdentity(db, "Alice");
      const ok = deleteIdentity(db, created.did);
      expect(ok).toBe(true);
      expect(getIdentity(db, created.did)).toBeNull();
    });

    it("should return false for non-existent DID", () => {
      ensureDIDTables(db);
      expect(deleteIdentity(db, "did:chainless:nope")).toBe(false);
    });
  });

  // ─── signMessage / verifySignature ────────────────────────

  describe("signing and verification", () => {
    it("should sign and verify a message", () => {
      const identity = createIdentity(db, "Signer");
      const message = "Hello, World!";
      const signature = signMessage(db, identity.did, message);

      expect(signature).toBeDefined();
      expect(typeof signature).toBe("string");

      const valid = verifyWithDID(db, identity.did, message, signature);
      expect(valid).toBe(true);
    });

    it("should fail verification with wrong message", () => {
      const identity = createIdentity(db, "Signer");
      const signature = signMessage(db, identity.did, "Original");
      const valid = verifyWithDID(db, identity.did, "Tampered", signature);
      expect(valid).toBe(false);
    });

    it("should fail with invalid signature", () => {
      const identity = createIdentity(db, "Signer");
      const valid = verifySignature(identity.publicKey, "msg", "invalid");
      expect(valid).toBe(false);
    });

    it("should throw for non-existent DID when signing", () => {
      ensureDIDTables(db);
      expect(() => signMessage(db, "did:chainless:nope", "msg")).toThrow(
        "Identity not found",
      );
    });
  });

  // ─── exportIdentity ──────────────────────────────────────

  describe("exportIdentity", () => {
    it("should export public data only", () => {
      const identity = createIdentity(db, "Alice");
      const exported = exportIdentity(db, identity.did);

      expect(exported.did).toBe(identity.did);
      expect(exported.publicKey).toBeDefined();
      expect(exported.document).toBeDefined();
      // Should NOT include secret key
      expect(exported.secretKey).toBeUndefined();
      expect(exported.secret_key).toBeUndefined();
    });

    it("should return null for non-existent DID", () => {
      ensureDIDTables(db);
      expect(exportIdentity(db, "did:chainless:nope")).toBeNull();
    });
  });

  // ─── resolveDID ──────────────────────────────────────────

  describe("resolveDID", () => {
    it("should resolve a DID to its document", () => {
      const identity = createIdentity(db, "Alice");
      const doc = resolveDID(db, identity.did);

      expect(doc).toBeDefined();
      expect(doc.id).toBe(identity.did);
      expect(doc["@context"]).toBeDefined();
    });

    it("should return null for non-existent DID", () => {
      ensureDIDTables(db);
      expect(resolveDID(db, "did:chainless:nope")).toBeNull();
    });
  });
});

describe("DID Manager V2", () => {
  beforeEach(() => {
    _resetStateDidManagerV2();
  });

  describe("frozen enums + defaults", () => {
    it("freezes enums", () => {
      expect(Object.isFrozen(IDENTITY_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(ISSUANCE_LIFECYCLE_V2)).toBe(true);
    });
    it("exposes default constants", () => {
      expect(DID_DEFAULT_MAX_ACTIVE_IDENTITIES_PER_OWNER).toBe(8);
      expect(DID_DEFAULT_MAX_PENDING_ISSUANCES_PER_IDENTITY).toBe(12);
      expect(DID_DEFAULT_IDENTITY_IDLE_MS).toBe(90 * 24 * 60 * 60 * 1000);
      expect(DID_DEFAULT_ISSUANCE_STUCK_MS).toBe(5 * 60 * 1000);
    });
    it("4 maturity states", () => {
      expect(Object.values(IDENTITY_MATURITY_V2).sort()).toEqual([
        "active",
        "pending",
        "revoked",
        "suspended",
      ]);
    });
    it("5 lifecycle states", () => {
      expect(Object.values(ISSUANCE_LIFECYCLE_V2).sort()).toEqual([
        "cancelled",
        "failed",
        "issued",
        "issuing",
        "queued",
      ]);
    });
  });

  describe("config getters/setters", () => {
    it("default", () => {
      expect(getMaxActiveIdentitiesPerOwnerV2()).toBe(8);
      expect(getMaxPendingIssuancesPerIdentityV2()).toBe(12);
      expect(getIdentityIdleMsV2()).toBe(90 * 24 * 60 * 60 * 1000);
      expect(getIssuanceStuckMsV2()).toBe(5 * 60 * 1000);
    });
    it("setters store positive int", () => {
      setMaxActiveIdentitiesPerOwnerV2(10);
      setMaxPendingIssuancesPerIdentityV2(5);
      setIdentityIdleMsV2(60_000);
      setIssuanceStuckMsV2(30_000);
      expect(getMaxActiveIdentitiesPerOwnerV2()).toBe(10);
      expect(getMaxPendingIssuancesPerIdentityV2()).toBe(5);
      expect(getIdentityIdleMsV2()).toBe(60_000);
      expect(getIssuanceStuckMsV2()).toBe(30_000);
    });
    it("setters floor non-int", () => {
      setMaxActiveIdentitiesPerOwnerV2(3.7);
      expect(getMaxActiveIdentitiesPerOwnerV2()).toBe(3);
    });
    it("setters reject 0/negative/non-finite/non-number", () => {
      expect(() => setMaxActiveIdentitiesPerOwnerV2(0)).toThrow();
      expect(() => setMaxActiveIdentitiesPerOwnerV2(-1)).toThrow();
      expect(() => setMaxActiveIdentitiesPerOwnerV2(Number.NaN)).toThrow();
      expect(() => setMaxActiveIdentitiesPerOwnerV2(Infinity)).toThrow();
      expect(() => setMaxActiveIdentitiesPerOwnerV2("8")).toThrow();
      expect(() => setIssuanceStuckMsV2(0)).toThrow();
    });
  });

  describe("registerIdentityV2", () => {
    it("creates pending identity", () => {
      const i = registerIdentityV2("u1-id1", {
        ownerId: "u1",
        didMethod: "key",
      });
      expect(i.status).toBe(IDENTITY_MATURITY_V2.PENDING);
      expect(i.didMethod).toBe("key");
      expect(i.displayName).toBe("u1-id1");
      expect(i.activatedAt).toBeNull();
    });
    it("preserves displayName", () => {
      const i = registerIdentityV2("u1-id1", {
        ownerId: "u1",
        didMethod: "web",
        displayName: "Alice",
      });
      expect(i.displayName).toBe("Alice");
    });
    it("rejects duplicate", () => {
      registerIdentityV2("a", { ownerId: "u1", didMethod: "key" });
      expect(() =>
        registerIdentityV2("a", { ownerId: "u1", didMethod: "key" }),
      ).toThrow(/already exists/);
    });
    it("rejects missing fields", () => {
      expect(() => registerIdentityV2("")).toThrow(/identity id/);
      expect(() => registerIdentityV2("a", {})).toThrow(/ownerId/);
      expect(() => registerIdentityV2("a", { ownerId: "u1" })).toThrow(
        /didMethod/,
      );
    });
    it("defensive metadata copy", () => {
      const meta = { tag: "x" };
      registerIdentityV2("a", {
        ownerId: "u1",
        didMethod: "key",
        metadata: meta,
      });
      meta.tag = "y";
      expect(getIdentityV2("a").metadata.tag).toBe("x");
      const cp = getIdentityV2("a");
      cp.metadata.tag = "z";
      expect(getIdentityV2("a").metadata.tag).toBe("x");
    });
  });

  describe("identity state machine", () => {
    beforeEach(() => {
      registerIdentityV2("a", { ownerId: "u1", didMethod: "key" });
    });
    it("pending -> active stamps activatedAt", () => {
      const i = activateIdentityV2("a");
      expect(i.status).toBe(IDENTITY_MATURITY_V2.ACTIVE);
      expect(typeof i.activatedAt).toBe("number");
    });
    it("active -> suspended -> active preserves activatedAt", () => {
      const a = activateIdentityV2("a");
      const t = a.activatedAt;
      suspendIdentityV2("a");
      const back = activateIdentityV2("a");
      expect(back.activatedAt).toBe(t);
    });
    it("revoked terminal stamps revokedAt once", () => {
      activateIdentityV2("a");
      const r = revokeIdentityV2("a");
      expect(typeof r.revokedAt).toBe("number");
      expect(() => activateIdentityV2("a")).toThrow(/terminal/);
    });
    it("rejects pending -> suspended", () => {
      expect(() => suspendIdentityV2("a")).toThrow(/invalid/);
    });
    it("rejects unknown identity", () => {
      expect(() => activateIdentityV2("nope")).toThrow(/unknown/);
    });
  });

  describe("per-owner active-identity cap", () => {
    it("rejects beyond cap on pending->active", () => {
      setMaxActiveIdentitiesPerOwnerV2(2);
      registerIdentityV2("a", { ownerId: "u", didMethod: "k" });
      registerIdentityV2("b", { ownerId: "u", didMethod: "k" });
      registerIdentityV2("c", { ownerId: "u", didMethod: "k" });
      activateIdentityV2("a");
      activateIdentityV2("b");
      expect(() => activateIdentityV2("c")).toThrow(/cap reached/);
    });
    it("recovery exempt", () => {
      setMaxActiveIdentitiesPerOwnerV2(2);
      registerIdentityV2("a", { ownerId: "u", didMethod: "k" });
      registerIdentityV2("b", { ownerId: "u", didMethod: "k" });
      registerIdentityV2("c", { ownerId: "u", didMethod: "k" });
      activateIdentityV2("a");
      activateIdentityV2("b");
      suspendIdentityV2("a");
      activateIdentityV2("c");
      expect(() => activateIdentityV2("a")).not.toThrow();
      expect(getActiveIdentityCountV2("u")).toBe(3);
    });
    it("scoped per owner", () => {
      setMaxActiveIdentitiesPerOwnerV2(1);
      registerIdentityV2("a", { ownerId: "u1", didMethod: "k" });
      registerIdentityV2("b", { ownerId: "u2", didMethod: "k" });
      activateIdentityV2("a");
      expect(() => activateIdentityV2("b")).not.toThrow();
    });
  });

  describe("listIdentitiesV2", () => {
    beforeEach(() => {
      registerIdentityV2("a", { ownerId: "u1", didMethod: "key" });
      registerIdentityV2("b", { ownerId: "u1", didMethod: "web" });
      registerIdentityV2("c", { ownerId: "u2", didMethod: "key" });
      activateIdentityV2("a");
    });
    it("filters by owner/status/method", () => {
      expect(listIdentitiesV2({ ownerId: "u1" }).length).toBe(2);
      expect(
        listIdentitiesV2({ status: IDENTITY_MATURITY_V2.ACTIVE }).length,
      ).toBe(1);
      expect(listIdentitiesV2({ didMethod: "key" }).length).toBe(2);
    });
  });

  describe("touchIdentityV2", () => {
    it("bumps lastSeenAt", () => {
      const i0 = registerIdentityV2("a", { ownerId: "u", didMethod: "k" });
      const orig = Date.now;
      Date.now = () => i0.lastSeenAt + 100;
      try {
        const i1 = touchIdentityV2("a");
        expect(i1.lastSeenAt).toBe(i0.lastSeenAt + 100);
      } finally {
        Date.now = orig;
      }
    });
    it("rejects unknown", () => {
      expect(() => touchIdentityV2("nope")).toThrow(/unknown/);
    });
  });

  describe("createIssuanceV2", () => {
    beforeEach(() => {
      registerIdentityV2("id1", { ownerId: "u", didMethod: "k" });
    });
    it("creates queued issuance", () => {
      const j = createIssuanceV2("j1", {
        identityId: "id1",
        credentialType: "vc-email",
      });
      expect(j.status).toBe(ISSUANCE_LIFECYCLE_V2.QUEUED);
      expect(j.credentialType).toBe("vc-email");
    });
    it("rejects duplicate", () => {
      createIssuanceV2("j1", { identityId: "id1", credentialType: "x" });
      expect(() =>
        createIssuanceV2("j1", { identityId: "id1", credentialType: "x" }),
      ).toThrow(/already exists/);
    });
    it("rejects unknown identity", () => {
      expect(() =>
        createIssuanceV2("j1", { identityId: "nope", credentialType: "x" }),
      ).toThrow(/unknown identity/);
    });
    it("per-identity pending cap counts queued+issuing", () => {
      setMaxPendingIssuancesPerIdentityV2(2);
      createIssuanceV2("j1", { identityId: "id1", credentialType: "x" });
      createIssuanceV2("j2", { identityId: "id1", credentialType: "x" });
      expect(() =>
        createIssuanceV2("j3", { identityId: "id1", credentialType: "x" }),
      ).toThrow(/cap reached/);
      startIssuanceV2("j1");
      expect(() =>
        createIssuanceV2("j3", { identityId: "id1", credentialType: "x" }),
      ).toThrow(/cap reached/);
      completeIssuanceV2("j1");
      expect(() =>
        createIssuanceV2("j3", { identityId: "id1", credentialType: "x" }),
      ).not.toThrow();
    });
    it("rejects missing fields", () => {
      expect(() => createIssuanceV2("j1", {})).toThrow(/identityId/);
      expect(() => createIssuanceV2("j1", { identityId: "id1" })).toThrow(
        /credentialType/,
      );
    });
  });

  describe("issuance state machine", () => {
    beforeEach(() => {
      registerIdentityV2("id1", { ownerId: "u", didMethod: "k" });
      createIssuanceV2("j1", { identityId: "id1", credentialType: "x" });
    });
    it("queued -> issuing stamps startedAt", () => {
      const j = startIssuanceV2("j1");
      expect(j.status).toBe(ISSUANCE_LIFECYCLE_V2.ISSUING);
      expect(typeof j.startedAt).toBe("number");
    });
    it("issuing -> issued/failed stamp settledAt", () => {
      startIssuanceV2("j1");
      const j = completeIssuanceV2("j1");
      expect(j.status).toBe(ISSUANCE_LIFECYCLE_V2.ISSUED);
      expect(typeof j.settledAt).toBe("number");
      createIssuanceV2("j2", { identityId: "id1", credentialType: "x" });
      startIssuanceV2("j2");
      const j2 = failIssuanceV2("j2");
      expect(j2.status).toBe(ISSUANCE_LIFECYCLE_V2.FAILED);
    });
    it("queued|issuing -> cancelled", () => {
      const j = cancelIssuanceV2("j1");
      expect(j.status).toBe(ISSUANCE_LIFECYCLE_V2.CANCELLED);
      createIssuanceV2("j2", { identityId: "id1", credentialType: "x" });
      startIssuanceV2("j2");
      expect(cancelIssuanceV2("j2").status).toBe(
        ISSUANCE_LIFECYCLE_V2.CANCELLED,
      );
    });
    it("rejects invalid transitions / terminal", () => {
      expect(() => completeIssuanceV2("j1")).toThrow(/invalid/);
      cancelIssuanceV2("j1");
      expect(() => startIssuanceV2("j1")).toThrow(/terminal/);
    });
  });

  describe("listIssuancesV2", () => {
    it("filters by identity/status", () => {
      registerIdentityV2("id1", { ownerId: "u", didMethod: "k" });
      registerIdentityV2("id2", { ownerId: "u", didMethod: "k" });
      createIssuanceV2("j1", { identityId: "id1", credentialType: "x" });
      createIssuanceV2("j2", { identityId: "id2", credentialType: "x" });
      startIssuanceV2("j1");
      expect(listIssuancesV2({ identityId: "id1" }).length).toBe(1);
      expect(
        listIssuancesV2({ status: ISSUANCE_LIFECYCLE_V2.ISSUING }).length,
      ).toBe(1);
      expect(
        listIssuancesV2({ status: ISSUANCE_LIFECYCLE_V2.QUEUED }).length,
      ).toBe(1);
    });
  });

  describe("auto-flip", () => {
    it("autoSuspendIdleIdentitiesV2 suspends idle active", () => {
      registerIdentityV2("a", { ownerId: "u", didMethod: "k" });
      activateIdentityV2("a");
      const flipped = autoSuspendIdleIdentitiesV2({
        now: Date.now() + getIdentityIdleMsV2() + 1,
      });
      expect(flipped.length).toBe(1);
      expect(getIdentityV2("a").status).toBe(IDENTITY_MATURITY_V2.SUSPENDED);
    });
    it("autoSuspendIdleIdentitiesV2 ignores non-active and recent", () => {
      registerIdentityV2("a", { ownerId: "u", didMethod: "k" });
      registerIdentityV2("b", { ownerId: "u", didMethod: "k" });
      activateIdentityV2("b");
      expect(autoSuspendIdleIdentitiesV2({ now: Date.now() + 10 }).length).toBe(
        0,
      );
    });
    it("autoFailStuckIssuancesV2 fails stuck issuing", () => {
      registerIdentityV2("id1", { ownerId: "u", didMethod: "k" });
      createIssuanceV2("j1", { identityId: "id1", credentialType: "x" });
      startIssuanceV2("j1");
      const flipped = autoFailStuckIssuancesV2({
        now: Date.now() + getIssuanceStuckMsV2() + 1,
      });
      expect(flipped.length).toBe(1);
      expect(getIssuanceV2("j1").status).toBe(ISSUANCE_LIFECYCLE_V2.FAILED);
    });
    it("autoFailStuckIssuancesV2 ignores queued", () => {
      registerIdentityV2("id1", { ownerId: "u", didMethod: "k" });
      createIssuanceV2("j1", { identityId: "id1", credentialType: "x" });
      expect(
        autoFailStuckIssuancesV2({
          now: Date.now() + getIssuanceStuckMsV2() + 1,
        }).length,
      ).toBe(0);
    });
  });

  describe("getDidManagerStatsV2", () => {
    it("zero state has all keys at 0", () => {
      const s = getDidManagerStatsV2();
      expect(s.totalIdentitiesV2).toBe(0);
      expect(s.totalIssuancesV2).toBe(0);
      for (const v of Object.values(IDENTITY_MATURITY_V2))
        expect(s.identitiesByStatus[v]).toBe(0);
      for (const v of Object.values(ISSUANCE_LIFECYCLE_V2))
        expect(s.issuancesByStatus[v]).toBe(0);
    });
    it("counts after operations", () => {
      registerIdentityV2("a", { ownerId: "u", didMethod: "k" });
      activateIdentityV2("a");
      createIssuanceV2("j1", { identityId: "a", credentialType: "x" });
      const s = getDidManagerStatsV2();
      expect(s.totalIdentitiesV2).toBe(1);
      expect(s.totalIssuancesV2).toBe(1);
      expect(s.identitiesByStatus.active).toBe(1);
      expect(s.issuancesByStatus.queued).toBe(1);
    });
  });

  describe("counts", () => {
    it("getActiveIdentityCountV2 scoped", () => {
      registerIdentityV2("a", { ownerId: "u1", didMethod: "k" });
      registerIdentityV2("b", { ownerId: "u2", didMethod: "k" });
      activateIdentityV2("a");
      activateIdentityV2("b");
      expect(getActiveIdentityCountV2()).toBe(2);
      expect(getActiveIdentityCountV2("u1")).toBe(1);
    });
    it("getPendingIssuanceCountV2 counts queued+issuing", () => {
      registerIdentityV2("id1", { ownerId: "u", didMethod: "k" });
      createIssuanceV2("j1", { identityId: "id1", credentialType: "x" });
      createIssuanceV2("j2", { identityId: "id1", credentialType: "x" });
      startIssuanceV2("j1");
      expect(getPendingIssuanceCountV2("id1")).toBe(2);
      completeIssuanceV2("j1");
      expect(getPendingIssuanceCountV2("id1")).toBe(1);
    });
  });

  describe("_resetStateDidManagerV2", () => {
    it("clears + restores defaults", () => {
      registerIdentityV2("a", { ownerId: "u", didMethod: "k" });
      setMaxActiveIdentitiesPerOwnerV2(99);
      _resetStateDidManagerV2();
      expect(getIdentityV2("a")).toBeNull();
      expect(getMaxActiveIdentitiesPerOwnerV2()).toBe(
        DID_DEFAULT_MAX_ACTIVE_IDENTITIES_PER_OWNER,
      );
    });
  });
});
