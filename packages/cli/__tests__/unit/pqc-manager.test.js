import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  ensurePQCTables,
  listKeys,
  generateKey,
  getMigrationStatus,
  migrate,
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
});
