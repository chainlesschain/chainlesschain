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
  // V2 surface
  KEY_MATURITY_V2,
  MIGRATION_LIFECYCLE_V2,
  PQC_DEFAULT_MAX_ACTIVE_KEYS_PER_OWNER,
  PQC_DEFAULT_MAX_PENDING_MIGRATIONS_PER_KEY,
  PQC_DEFAULT_KEY_IDLE_MS,
  PQC_DEFAULT_MIGRATION_STUCK_MS,
  getMaxActiveKeysPerOwnerV2,
  setMaxActiveKeysPerOwnerV2,
  getMaxPendingMigrationsPerKeyV2,
  setMaxPendingMigrationsPerKeyV2,
  getKeyIdleMsV2,
  setKeyIdleMsV2,
  getMigrationStuckMsV2,
  setMigrationStuckMsV2,
  registerKeyV2,
  getKeyV2,
  listKeysV2,
  setKeyStatusV2,
  activateKeyV2,
  deprecateKeyV2,
  archiveKeyV2,
  touchKeyV2,
  createMigrationV2,
  getMigrationV2,
  listMigrationsV2,
  startMigrationV2,
  completeMigrationV2,
  failMigrationV2,
  cancelMigrationV2,
  getActiveKeyCountV2,
  getPendingMigrationCountV2,
  autoDeprecateIdleKeysV2,
  autoFailStuckMigrationsV2,
  getPqcManagerStatsV2,
  _resetStatePqcManagerV2,
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

describe("PQC Manager V2", () => {
  beforeEach(() => {
    _resetStatePqcManagerV2();
  });

  describe("frozen enums + defaults", () => {
    it("freezes maturity / lifecycle enums", () => {
      expect(Object.isFrozen(KEY_MATURITY_V2)).toBe(true);
      expect(Object.isFrozen(MIGRATION_LIFECYCLE_V2)).toBe(true);
    });
    it("exposes default constants", () => {
      expect(PQC_DEFAULT_MAX_ACTIVE_KEYS_PER_OWNER).toBe(16);
      expect(PQC_DEFAULT_MAX_PENDING_MIGRATIONS_PER_KEY).toBe(8);
      expect(PQC_DEFAULT_KEY_IDLE_MS).toBe(30 * 24 * 60 * 60 * 1000);
      expect(PQC_DEFAULT_MIGRATION_STUCK_MS).toBe(10 * 60 * 1000);
    });
    it("V2 has all 4 maturity states", () => {
      expect(Object.values(KEY_MATURITY_V2).sort()).toEqual([
        "active",
        "archived",
        "deprecated",
        "pending",
      ]);
    });
    it("V2 has all 5 lifecycle states", () => {
      expect(Object.values(MIGRATION_LIFECYCLE_V2).sort()).toEqual([
        "cancelled",
        "completed",
        "failed",
        "queued",
        "running",
      ]);
    });
  });

  describe("config getters/setters", () => {
    it("default config matches constants", () => {
      expect(getMaxActiveKeysPerOwnerV2()).toBe(16);
      expect(getMaxPendingMigrationsPerKeyV2()).toBe(8);
      expect(getKeyIdleMsV2()).toBe(30 * 24 * 60 * 60 * 1000);
      expect(getMigrationStuckMsV2()).toBe(10 * 60 * 1000);
    });
    it("setters store positive integers", () => {
      setMaxActiveKeysPerOwnerV2(32);
      setMaxPendingMigrationsPerKeyV2(20);
      setKeyIdleMsV2(60_000);
      setMigrationStuckMsV2(30_000);
      expect(getMaxActiveKeysPerOwnerV2()).toBe(32);
      expect(getMaxPendingMigrationsPerKeyV2()).toBe(20);
      expect(getKeyIdleMsV2()).toBe(60_000);
      expect(getMigrationStuckMsV2()).toBe(30_000);
    });
    it("setters floor non-integer", () => {
      setMaxActiveKeysPerOwnerV2(3.9);
      expect(getMaxActiveKeysPerOwnerV2()).toBe(3);
    });
    it("setters reject zero/negative/non-finite/non-number", () => {
      expect(() => setMaxActiveKeysPerOwnerV2(0)).toThrow();
      expect(() => setMaxActiveKeysPerOwnerV2(-1)).toThrow();
      expect(() => setMaxActiveKeysPerOwnerV2(Number.NaN)).toThrow();
      expect(() => setMaxActiveKeysPerOwnerV2(Infinity)).toThrow();
      expect(() => setMaxActiveKeysPerOwnerV2("8")).toThrow();
      expect(() => setMaxPendingMigrationsPerKeyV2(0)).toThrow();
      expect(() => setKeyIdleMsV2(-1)).toThrow();
      expect(() => setMigrationStuckMsV2(0)).toThrow();
    });
  });

  describe("registerKeyV2", () => {
    it("creates pending key with required fields", () => {
      const k = registerKeyV2("k1", { ownerId: "u1", algorithm: "ML-KEM-768" });
      expect(k.id).toBe("k1");
      expect(k.ownerId).toBe("u1");
      expect(k.algorithm).toBe("ML-KEM-768");
      expect(k.status).toBe(KEY_MATURITY_V2.PENDING);
      expect(k.purpose).toBe("general");
      expect(k.activatedAt).toBeNull();
      expect(k.archivedAt).toBeNull();
      expect(typeof k.createdAt).toBe("number");
    });
    it("preserves provided purpose", () => {
      const k = registerKeyV2("k2", {
        ownerId: "u1",
        algorithm: "ML-DSA-65",
        purpose: "signing",
      });
      expect(k.purpose).toBe("signing");
    });
    it("rejects duplicate id", () => {
      registerKeyV2("k1", { ownerId: "u1", algorithm: "ML-KEM-768" });
      expect(() =>
        registerKeyV2("k1", { ownerId: "u1", algorithm: "ML-KEM-768" }),
      ).toThrow(/already exists/);
    });
    it("rejects missing required fields", () => {
      expect(() => registerKeyV2("")).toThrow(/key id/);
      expect(() => registerKeyV2("k1", {})).toThrow(/ownerId/);
      expect(() => registerKeyV2("k1", { ownerId: "u1" })).toThrow(/algorithm/);
    });
    it("returns defensive metadata copy", () => {
      const meta = { tag: "x" };
      const k = registerKeyV2("k1", {
        ownerId: "u1",
        algorithm: "X",
        metadata: meta,
      });
      meta.tag = "mutated";
      expect(k.metadata.tag).toBe("x");
      const k2 = getKeyV2("k1");
      expect(k2.metadata.tag).toBe("x");
      k2.metadata.tag = "external";
      expect(getKeyV2("k1").metadata.tag).toBe("x");
    });
  });

  describe("key state machine", () => {
    beforeEach(() => {
      registerKeyV2("k1", { ownerId: "u1", algorithm: "ML-KEM-768" });
    });
    it("pending -> active stamps activatedAt", () => {
      const k = activateKeyV2("k1");
      expect(k.status).toBe(KEY_MATURITY_V2.ACTIVE);
      expect(typeof k.activatedAt).toBe("number");
    });
    it("active -> deprecated -> active preserves activatedAt", () => {
      const a = activateKeyV2("k1");
      const t0 = a.activatedAt;
      deprecateKeyV2("k1");
      const back = activateKeyV2("k1");
      expect(back.status).toBe(KEY_MATURITY_V2.ACTIVE);
      expect(back.activatedAt).toBe(t0);
    });
    it("archived terminal", () => {
      activateKeyV2("k1");
      const k = archiveKeyV2("k1");
      expect(k.status).toBe(KEY_MATURITY_V2.ARCHIVED);
      expect(typeof k.archivedAt).toBe("number");
      expect(() => activateKeyV2("k1")).toThrow(/terminal/);
    });
    it("archive stamps once", () => {
      activateKeyV2("k1");
      const k1 = archiveKeyV2("k1");
      expect(() => archiveKeyV2("k1")).toThrow();
      expect(getKeyV2("k1").archivedAt).toBe(k1.archivedAt);
    });
    it("rejects invalid pending -> deprecated", () => {
      expect(() => deprecateKeyV2("k1")).toThrow(/invalid/);
    });
    it("rejects unknown key", () => {
      expect(() => activateKeyV2("nope")).toThrow(/unknown/);
    });
  });

  describe("per-owner active-key cap", () => {
    it("rejects beyond cap on pending->active", () => {
      setMaxActiveKeysPerOwnerV2(2);
      registerKeyV2("a", { ownerId: "u1", algorithm: "X" });
      registerKeyV2("b", { ownerId: "u1", algorithm: "X" });
      registerKeyV2("c", { ownerId: "u1", algorithm: "X" });
      activateKeyV2("a");
      activateKeyV2("b");
      expect(() => activateKeyV2("c")).toThrow(/cap reached/);
    });
    it("recovery (deprecated->active) is exempt from cap", () => {
      setMaxActiveKeysPerOwnerV2(2);
      registerKeyV2("a", { ownerId: "u1", algorithm: "X" });
      registerKeyV2("b", { ownerId: "u1", algorithm: "X" });
      registerKeyV2("c", { ownerId: "u1", algorithm: "X" });
      activateKeyV2("a");
      activateKeyV2("b");
      deprecateKeyV2("a");
      activateKeyV2("c"); // a deprecated, c counts
      expect(() => activateKeyV2("a")).not.toThrow(); // recovery exempt → 3 active
      expect(getActiveKeyCountV2("u1")).toBe(3);
    });
    it("scoped per owner", () => {
      setMaxActiveKeysPerOwnerV2(1);
      registerKeyV2("a", { ownerId: "u1", algorithm: "X" });
      registerKeyV2("b", { ownerId: "u2", algorithm: "X" });
      activateKeyV2("a");
      expect(() => activateKeyV2("b")).not.toThrow();
    });
  });

  describe("listKeysV2", () => {
    beforeEach(() => {
      registerKeyV2("a", { ownerId: "u1", algorithm: "ML-KEM-768" });
      registerKeyV2("b", { ownerId: "u1", algorithm: "ML-DSA-65" });
      registerKeyV2("c", { ownerId: "u2", algorithm: "ML-KEM-768" });
      activateKeyV2("a");
    });
    it("filters by owner", () => {
      expect(listKeysV2({ ownerId: "u1" }).length).toBe(2);
      expect(listKeysV2({ ownerId: "u2" }).length).toBe(1);
    });
    it("filters by status", () => {
      expect(listKeysV2({ status: KEY_MATURITY_V2.ACTIVE }).length).toBe(1);
      expect(listKeysV2({ status: KEY_MATURITY_V2.PENDING }).length).toBe(2);
    });
    it("filters by algorithm", () => {
      expect(listKeysV2({ algorithm: "ML-KEM-768" }).length).toBe(2);
    });
  });

  describe("touchKeyV2", () => {
    it("bumps lastSeenAt", () => {
      const k0 = registerKeyV2("k1", { ownerId: "u1", algorithm: "X" });
      const before = k0.lastSeenAt;
      // ensure new tick
      const t1 = before + 100;
      const orig = Date.now;
      Date.now = () => t1;
      try {
        const k1 = touchKeyV2("k1");
        expect(k1.lastSeenAt).toBe(t1);
      } finally {
        Date.now = orig;
      }
    });
    it("rejects unknown key", () => {
      expect(() => touchKeyV2("nope")).toThrow(/unknown/);
    });
  });

  describe("createMigrationV2", () => {
    beforeEach(() => {
      registerKeyV2("k1", { ownerId: "u1", algorithm: "ML-KEM-768" });
    });
    it("creates queued migration with sourceAlgorithm from key", () => {
      const m = createMigrationV2("m1", {
        keyId: "k1",
        targetAlgorithm: "ML-KEM-1024",
      });
      expect(m.status).toBe(MIGRATION_LIFECYCLE_V2.QUEUED);
      expect(m.sourceAlgorithm).toBe("ML-KEM-768");
      expect(m.targetAlgorithm).toBe("ML-KEM-1024");
    });
    it("rejects duplicate id", () => {
      createMigrationV2("m1", { keyId: "k1", targetAlgorithm: "ML-KEM-1024" });
      expect(() =>
        createMigrationV2("m1", {
          keyId: "k1",
          targetAlgorithm: "ML-KEM-1024",
        }),
      ).toThrow(/already exists/);
    });
    it("rejects unknown key", () => {
      expect(() =>
        createMigrationV2("m1", { keyId: "nope", targetAlgorithm: "X" }),
      ).toThrow(/unknown key/);
    });
    it("per-key pending cap counts queued+running", () => {
      setMaxPendingMigrationsPerKeyV2(2);
      createMigrationV2("m1", { keyId: "k1", targetAlgorithm: "X" });
      createMigrationV2("m2", { keyId: "k1", targetAlgorithm: "X" });
      expect(() =>
        createMigrationV2("m3", { keyId: "k1", targetAlgorithm: "X" }),
      ).toThrow(/cap reached/);
      // start one — still counts as pending
      startMigrationV2("m1");
      expect(() =>
        createMigrationV2("m3", { keyId: "k1", targetAlgorithm: "X" }),
      ).toThrow(/cap reached/);
      // complete one — slot freed
      completeMigrationV2("m1");
      expect(() =>
        createMigrationV2("m3", { keyId: "k1", targetAlgorithm: "X" }),
      ).not.toThrow();
    });
    it("rejects missing required fields", () => {
      expect(() => createMigrationV2("m1", {})).toThrow(/keyId/);
      expect(() => createMigrationV2("m1", { keyId: "k1" })).toThrow(
        /targetAlgorithm/,
      );
    });
  });

  describe("migration state machine", () => {
    beforeEach(() => {
      registerKeyV2("k1", { ownerId: "u1", algorithm: "X" });
      createMigrationV2("m1", { keyId: "k1", targetAlgorithm: "Y" });
    });
    it("queued -> running stamps startedAt", () => {
      const m = startMigrationV2("m1");
      expect(m.status).toBe(MIGRATION_LIFECYCLE_V2.RUNNING);
      expect(typeof m.startedAt).toBe("number");
    });
    it("running -> completed stamps settledAt", () => {
      startMigrationV2("m1");
      const m = completeMigrationV2("m1");
      expect(m.status).toBe(MIGRATION_LIFECYCLE_V2.COMPLETED);
      expect(typeof m.settledAt).toBe("number");
    });
    it("running -> failed stamps settledAt", () => {
      startMigrationV2("m1");
      const m = failMigrationV2("m1");
      expect(m.status).toBe(MIGRATION_LIFECYCLE_V2.FAILED);
      expect(typeof m.settledAt).toBe("number");
    });
    it("queued -> cancelled and running -> cancelled both work", () => {
      const m = cancelMigrationV2("m1");
      expect(m.status).toBe(MIGRATION_LIFECYCLE_V2.CANCELLED);
      createMigrationV2("m2", { keyId: "k1", targetAlgorithm: "Y" });
      startMigrationV2("m2");
      expect(cancelMigrationV2("m2").status).toBe(
        MIGRATION_LIFECYCLE_V2.CANCELLED,
      );
    });
    it("rejects invalid queued -> completed", () => {
      expect(() => completeMigrationV2("m1")).toThrow(/invalid/);
    });
    it("rejects transition out of terminal", () => {
      cancelMigrationV2("m1");
      expect(() => startMigrationV2("m1")).toThrow(/terminal/);
    });
    it("rejects unknown migration", () => {
      expect(() => startMigrationV2("nope")).toThrow(/unknown/);
    });
  });

  describe("listMigrationsV2", () => {
    it("filters by key and status", () => {
      registerKeyV2("k1", { ownerId: "u1", algorithm: "X" });
      registerKeyV2("k2", { ownerId: "u1", algorithm: "X" });
      createMigrationV2("m1", { keyId: "k1", targetAlgorithm: "Y" });
      createMigrationV2("m2", { keyId: "k2", targetAlgorithm: "Y" });
      startMigrationV2("m1");
      expect(listMigrationsV2({ keyId: "k1" }).length).toBe(1);
      expect(
        listMigrationsV2({ status: MIGRATION_LIFECYCLE_V2.RUNNING }).length,
      ).toBe(1);
      expect(
        listMigrationsV2({ status: MIGRATION_LIFECYCLE_V2.QUEUED }).length,
      ).toBe(1);
    });
  });

  describe("auto-flip", () => {
    it("autoDeprecateIdleKeysV2 deprecates idle active keys", () => {
      registerKeyV2("k1", { ownerId: "u1", algorithm: "X" });
      activateKeyV2("k1");
      const flipped = autoDeprecateIdleKeysV2({
        now: Date.now() + getKeyIdleMsV2() + 1,
      });
      expect(flipped.length).toBe(1);
      expect(getKeyV2("k1").status).toBe(KEY_MATURITY_V2.DEPRECATED);
    });
    it("autoDeprecateIdleKeysV2 ignores non-active and recent active", () => {
      registerKeyV2("k1", { ownerId: "u1", algorithm: "X" });
      registerKeyV2("k2", { ownerId: "u1", algorithm: "X" });
      activateKeyV2("k2");
      const flipped = autoDeprecateIdleKeysV2({ now: Date.now() + 10 });
      expect(flipped.length).toBe(0);
    });
    it("autoFailStuckMigrationsV2 fails stuck running", () => {
      registerKeyV2("k1", { ownerId: "u1", algorithm: "X" });
      createMigrationV2("m1", { keyId: "k1", targetAlgorithm: "Y" });
      startMigrationV2("m1");
      const flipped = autoFailStuckMigrationsV2({
        now: Date.now() + getMigrationStuckMsV2() + 1,
      });
      expect(flipped.length).toBe(1);
      expect(getMigrationV2("m1").status).toBe(MIGRATION_LIFECYCLE_V2.FAILED);
    });
    it("autoFailStuckMigrationsV2 ignores queued", () => {
      registerKeyV2("k1", { ownerId: "u1", algorithm: "X" });
      createMigrationV2("m1", { keyId: "k1", targetAlgorithm: "Y" });
      const flipped = autoFailStuckMigrationsV2({
        now: Date.now() + getMigrationStuckMsV2() + 1,
      });
      expect(flipped.length).toBe(0);
    });
  });

  describe("getPqcManagerStatsV2", () => {
    it("zero state has all enum keys at 0", () => {
      const s = getPqcManagerStatsV2();
      expect(s.totalKeysV2).toBe(0);
      expect(s.totalMigrationsV2).toBe(0);
      for (const v of Object.values(KEY_MATURITY_V2)) {
        expect(s.keysByStatus[v]).toBe(0);
      }
      for (const v of Object.values(MIGRATION_LIFECYCLE_V2)) {
        expect(s.migrationsByStatus[v]).toBe(0);
      }
    });
    it("counts after operations", () => {
      registerKeyV2("k1", { ownerId: "u1", algorithm: "X" });
      registerKeyV2("k2", { ownerId: "u1", algorithm: "X" });
      activateKeyV2("k1");
      createMigrationV2("m1", { keyId: "k1", targetAlgorithm: "Y" });
      const s = getPqcManagerStatsV2();
      expect(s.totalKeysV2).toBe(2);
      expect(s.totalMigrationsV2).toBe(1);
      expect(s.keysByStatus.active).toBe(1);
      expect(s.keysByStatus.pending).toBe(1);
      expect(s.migrationsByStatus.queued).toBe(1);
    });
  });

  describe("counts", () => {
    it("getActiveKeyCountV2 scoped by owner", () => {
      registerKeyV2("a", { ownerId: "u1", algorithm: "X" });
      registerKeyV2("b", { ownerId: "u2", algorithm: "X" });
      activateKeyV2("a");
      activateKeyV2("b");
      expect(getActiveKeyCountV2()).toBe(2);
      expect(getActiveKeyCountV2("u1")).toBe(1);
      expect(getActiveKeyCountV2("u2")).toBe(1);
    });
    it("getPendingMigrationCountV2 counts queued+running", () => {
      registerKeyV2("k1", { ownerId: "u1", algorithm: "X" });
      createMigrationV2("m1", { keyId: "k1", targetAlgorithm: "Y" });
      createMigrationV2("m2", { keyId: "k1", targetAlgorithm: "Y" });
      startMigrationV2("m1");
      expect(getPendingMigrationCountV2()).toBe(2);
      expect(getPendingMigrationCountV2("k1")).toBe(2);
      completeMigrationV2("m1");
      expect(getPendingMigrationCountV2("k1")).toBe(1);
    });
  });

  describe("_resetStatePqcManagerV2", () => {
    it("clears state and restores defaults", () => {
      registerKeyV2("k1", { ownerId: "u1", algorithm: "X" });
      setMaxActiveKeysPerOwnerV2(99);
      _resetStatePqcManagerV2();
      expect(getKeyV2("k1")).toBeNull();
      expect(getMaxActiveKeysPerOwnerV2()).toBe(
        PQC_DEFAULT_MAX_ACTIVE_KEYS_PER_OWNER,
      );
    });
  });
});
