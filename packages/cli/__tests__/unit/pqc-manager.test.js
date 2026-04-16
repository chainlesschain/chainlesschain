import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  ensurePQCTables,
  listKeys,
  generateKey,
  getMigrationStatus,
  migrate,
  listAlgorithms,
  algorithmSpec,
  _resetState,
} from "../../src/lib/pqc-manager.js";

describe("pqc-manager", () => {
  let db;

  beforeEach(() => {
    db = new MockDatabase();
    _resetState();
    ensurePQCTables(db);
  });

  describe("ensurePQCTables", () => {
    it("creates pqc_keys and pqc_migration_status tables", () => {
      expect(db.tables.has("pqc_keys")).toBe(true);
      expect(db.tables.has("pqc_migration_status")).toBe(true);
    });

    it("is idempotent", () => {
      ensurePQCTables(db);
      expect(db.tables.has("pqc_keys")).toBe(true);
    });
  });

  describe("generateKey", () => {
    it("generates a ML-KEM-768 key", () => {
      const k = generateKey(db, "ML-KEM-768", "encryption");
      expect(k.id).toBeDefined();
      expect(k.algorithm).toBe("ML-KEM-768");
      expect(k.purpose).toBe("encryption");
      expect(k.keySize).toBe(768);
      expect(k.hybridMode).toBe(false);
      expect(k.publicKey).toBeDefined();
    });

    it("generates a ML-KEM-1024 key with larger size", () => {
      const k = generateKey(db, "ML-KEM-1024", "encryption");
      expect(k.keySize).toBe(1024);
    });

    it("generates hybrid key with classical algorithm", () => {
      const k = generateKey(db, "HYBRID-X25519-ML-KEM", "key_exchange");
      expect(k.hybridMode).toBe(true);
      expect(k.classicalAlgorithm).toBe("X25519");
    });

    it("detects Ed25519 classical algorithm for DSA hybrid", () => {
      const k = generateKey(db, "HYBRID-ED25519-ML-DSA", "signing");
      expect(k.hybridMode).toBe(true);
      expect(k.classicalAlgorithm).toBe("Ed25519");
    });

    it("throws on missing algorithm", () => {
      expect(() => generateKey(db, "")).toThrow("Algorithm is required");
    });

    it("throws on invalid algorithm", () => {
      expect(() => generateKey(db, "RSA-2048")).toThrow("Invalid algorithm");
    });

    it("persists to database", () => {
      generateKey(db, "ML-DSA-65", "signing");
      const rows = db.data.get("pqc_keys") || [];
      expect(rows.length).toBe(1);
    });

    it("generates unique IDs", () => {
      const k1 = generateKey(db, "ML-KEM-768");
      const k2 = generateKey(db, "ML-KEM-768");
      expect(k1.id).not.toBe(k2.id);
    });
  });

  describe("listKeys", () => {
    it("returns empty initially", () => {
      expect(listKeys()).toEqual([]);
    });

    it("returns all keys", () => {
      generateKey(db, "ML-KEM-768");
      generateKey(db, "ML-DSA-65");
      expect(listKeys().length).toBe(2);
    });

    it("filters by algorithm", () => {
      generateKey(db, "ML-KEM-768");
      generateKey(db, "ML-DSA-65");
      expect(listKeys({ algorithm: "ML-KEM-768" }).length).toBe(1);
    });
  });

  describe("migrate", () => {
    it("executes a migration plan", () => {
      generateKey(db, "ML-KEM-768");
      generateKey(db, "ML-KEM-768");
      const plan = migrate(db, "upgrade-plan", "ML-KEM-768", "ML-KEM-1024");
      expect(plan.planName).toBe("upgrade-plan");
      expect(plan.sourceAlgorithm).toBe("ML-KEM-768");
      expect(plan.targetAlgorithm).toBe("ML-KEM-1024");
      expect(plan.totalKeys).toBe(2);
      expect(plan.migratedKeys).toBe(2);
      expect(plan.status).toBe("completed");
    });

    it("throws on missing plan name", () => {
      expect(() => migrate(db, "", null, "ML-KEM-1024")).toThrow(
        "Plan name is required",
      );
    });

    it("throws on missing target algorithm", () => {
      expect(() => migrate(db, "plan", null, "")).toThrow(
        "Target algorithm is required",
      );
    });

    it("persists to database", () => {
      migrate(db, "plan", null, "ML-KEM-1024");
      const rows = db.data.get("pqc_migration_status") || [];
      expect(rows.length).toBe(1);
    });
  });

  describe("getMigrationStatus", () => {
    it("returns empty initially", () => {
      expect(getMigrationStatus()).toEqual([]);
    });

    it("returns migration plans", () => {
      migrate(db, "plan-1", null, "ML-KEM-1024");
      migrate(db, "plan-2", "ML-KEM-768", "ML-DSA-87");
      expect(getMigrationStatus().length).toBe(2);
    });
  });

  describe("SLH-DSA (FIPS 205)", () => {
    it("accepts all six SLH-DSA parameter sets", () => {
      const variants = [
        "SLH-DSA-128s",
        "SLH-DSA-128f",
        "SLH-DSA-192s",
        "SLH-DSA-192f",
        "SLH-DSA-256s",
        "SLH-DSA-256f",
      ];
      for (const v of variants) {
        const k = generateKey(db, v, "signing");
        expect(k.algorithm).toBe(v);
        expect(k.family).toBe("slh-dsa");
      }
    });

    it("derives keySize from security label (128/192/256)", () => {
      expect(generateKey(db, "SLH-DSA-128s").keySize).toBe(128);
      expect(generateKey(db, "SLH-DSA-192f").keySize).toBe(192);
      expect(generateKey(db, "SLH-DSA-256s").keySize).toBe(256);
    });

    it("matches FIPS 205 public-key byte lengths (32/48/64)", () => {
      // publicKey stored as hex → 2 hex chars per byte
      expect(generateKey(db, "SLH-DSA-128s").publicKey.length).toBe(32 * 2);
      expect(generateKey(db, "SLH-DSA-192s").publicKey.length).toBe(48 * 2);
      expect(generateKey(db, "SLH-DSA-256f").publicKey.length).toBe(64 * 2);
    });

    it("exposes signature byte length (s variants < f variants)", () => {
      const k128s = generateKey(db, "SLH-DSA-128s");
      const k128f = generateKey(db, "SLH-DSA-128f");
      expect(k128s.signatureBytes).toBe(7856);
      expect(k128f.signatureBytes).toBe(17088);
      expect(k128s.signatureBytes).toBeLessThan(k128f.signatureBytes);
    });

    it("defaults purpose to signing for SLH-DSA", () => {
      const k = generateKey(db, "SLH-DSA-128s"); // no purpose arg
      expect(k.purpose).toBe("signing");
    });

    it("supports hybrid Ed25519+SLH-DSA", () => {
      const k = generateKey(db, "HYBRID-ED25519-SLH-DSA", "signing");
      expect(k.hybridMode).toBe(true);
      expect(k.classicalAlgorithm).toBe("Ed25519");
      expect(k.family).toBe("hybrid");
    });

    it("is migratable from ML-DSA to SLH-DSA", () => {
      generateKey(db, "ML-DSA-65", "signing");
      generateKey(db, "ML-DSA-65", "signing");
      const plan = migrate(db, "mldsa-to-slhdsa", "ML-DSA-65", "SLH-DSA-256s");
      expect(plan.targetAlgorithm).toBe("SLH-DSA-256s");
      expect(plan.totalKeys).toBe(2);
      expect(plan.status).toBe("completed");
    });

    it("defaults key-exchange purpose for ML-KEM and signing for ML-DSA", () => {
      expect(generateKey(db, "ML-KEM-768").purpose).toBe("key_exchange");
      expect(generateKey(db, "ML-DSA-65").purpose).toBe("signing");
    });
  });

  describe("listAlgorithms", () => {
    it("returns all 13 supported algorithms", () => {
      const all = listAlgorithms();
      expect(all.length).toBe(13);
    });

    it("filters by family slh-dsa → 6 entries", () => {
      const slh = listAlgorithms({ family: "slh-dsa" });
      expect(slh.length).toBe(6);
      expect(slh.every((a) => a.algorithm.startsWith("SLH-DSA-"))).toBe(true);
    });

    it("filters by family hybrid → 3 entries (X25519+ML-KEM, Ed25519+ML-DSA, Ed25519+SLH-DSA)", () => {
      const hybrid = listAlgorithms({ family: "hybrid" });
      expect(hybrid.length).toBe(3);
    });

    it("each entry carries keySize, publicKeyBytes, signatureBytes, family", () => {
      for (const a of listAlgorithms()) {
        expect(a.algorithm).toBeTypeOf("string");
        expect(a.keySize).toBeTypeOf("number");
        expect(a.publicKeyBytes).toBeTypeOf("number");
        expect(a.family).toBeTypeOf("string");
        // signatureBytes is null for KEM rows (ML-KEM-*, HYBRID-X25519-ML-KEM)
        expect(
          a.signatureBytes === null || typeof a.signatureBytes === "number",
        ).toBe(true);
      }
    });
  });

  describe("algorithmSpec", () => {
    it("returns full spec for known algorithm", () => {
      const spec = algorithmSpec("SLH-DSA-128f");
      expect(spec.keySize).toBe(128);
      expect(spec.publicKeyBytes).toBe(32);
      expect(spec.signatureBytes).toBe(17088);
      expect(spec.family).toBe("slh-dsa");
    });

    it("returns null for unknown algorithm", () => {
      expect(algorithmSpec("RSA-2048")).toBe(null);
    });
  });
});
