import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";
import {
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
