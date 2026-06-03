/**
 * usePqcMigrationStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Pure getters: activeKeys (status === 'active') / hybridKeys (hybrid_mode === 1) /
 *    completedMigrations (status === 'completed')
 *  - IPC actions (electronAPI.invoke mocked): fetchKeys (populate / error),
 *    generateKey (chains fetchKeys), fetchMigrationStatus (populate plans),
 *    executeMigration (chains fetchMigrationStatus + fetchKeys)
 *
 * NB: store captures `electronAPI` at MODULE LOAD
 * (`const electronAPI = window.electronAPI || window.electron?.ipcRenderer`),
 * so window.electronAPI must exist BEFORE import — set in vi.hoisted, and never
 * delete it here (only reset the mock fn between tests).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const { mockInvoke } = vi.hoisted(() => {
  const mockInvoke = vi.fn();
  (globalThis as any).window = (globalThis as any).window || {};
  (globalThis as any).window.electronAPI = { invoke: mockInvoke };
  return { mockInvoke };
});

import { usePqcMigrationStore } from "../pqcMigration";
import type { PQCKey, MigrationPlan } from "../pqcMigration";

function key(id: string, status: string, hybrid_mode = 0): PQCKey {
  return {
    id,
    algorithm: "kyber768",
    purpose: "kem",
    public_key: "pk",
    key_size: 1184,
    hybrid_mode,
    classical_algorithm: null,
    status,
    created_at: 1700000000000,
  };
}

function plan(id: string, status: string): MigrationPlan {
  return {
    id,
    plan_name: `P ${id}`,
    source_algorithm: "rsa",
    target_algorithm: "kyber768",
    total_keys: 10,
    migrated_keys: 0,
    status,
    started_at: null,
    completed_at: null,
    error_message: null,
  };
}

describe("usePqcMigrationStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockInvoke.mockReset().mockResolvedValue({ success: true });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  describe("Initial state", () => {
    it("starts empty", () => {
      const store = usePqcMigrationStore();
      expect(store.keys).toEqual([]);
      expect(store.migrationPlans).toEqual([]);
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("getters", () => {
    it("activeKeys / hybridKeys filter the key list", () => {
      const store = usePqcMigrationStore();
      store.keys = [
        key("a", "active", 1),
        key("b", "retired", 0),
        key("c", "active", 0),
      ];
      expect(store.activeKeys.map((k) => k.id)).toEqual(["a", "c"]);
      expect(store.hybridKeys.map((k) => k.id)).toEqual(["a"]);
    });

    it("completedMigrations filters status === 'completed'", () => {
      const store = usePqcMigrationStore();
      store.migrationPlans = [
        plan("a", "running"),
        plan("b", "completed"),
        plan("c", "completed"),
      ];
      expect(store.completedMigrations.map((p) => p.id)).toEqual(["b", "c"]);
    });
  });

  // -------------------------------------------------------------------------
  // IPC actions
  // -------------------------------------------------------------------------

  describe("IPC actions", () => {
    it("fetchKeys populates on success", async () => {
      const store = usePqcMigrationStore();
      mockInvoke.mockResolvedValue({
        success: true,
        keys: [key("a", "active"), key("b", "retired")],
      });
      await store.fetchKeys({ status: "active" });
      expect(mockInvoke).toHaveBeenCalledWith("pqc:list-keys", {
        status: "active",
      });
      expect(store.keys.map((k) => k.id)).toEqual(["a", "b"]);
      expect(store.loading).toBe(false);
    });

    it("fetchKeys records the error on failure", async () => {
      const store = usePqcMigrationStore();
      mockInvoke.mockResolvedValue({ success: false, error: "no svc" });
      await store.fetchKeys();
      expect(store.error).toBe("no svc");
    });

    it("generateKey chains fetchKeys on success", async () => {
      const store = usePqcMigrationStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true, keyId: "n" }) // generate
        .mockResolvedValueOnce({ success: true, keys: [key("n", "active")] }); // list
      await store.generateKey("kyber768", "kem", true, "x25519");
      expect(mockInvoke).toHaveBeenNthCalledWith(1, "pqc:generate-key", {
        algorithm: "kyber768",
        purpose: "kem",
        hybridMode: true,
        classicalAlgorithm: "x25519",
      });
      expect(mockInvoke).toHaveBeenNthCalledWith(2, "pqc:list-keys", undefined);
      expect(store.keys.map((k) => k.id)).toEqual(["n"]);
    });

    it("fetchMigrationStatus populates plans", async () => {
      const store = usePqcMigrationStore();
      mockInvoke.mockResolvedValue({
        success: true,
        plans: [plan("a", "running")],
      });
      await store.fetchMigrationStatus();
      expect(mockInvoke).toHaveBeenCalledWith("pqc:get-migration-status");
      expect(store.migrationPlans.map((p) => p.id)).toEqual(["a"]);
    });

    it("executeMigration chains fetchMigrationStatus + fetchKeys on success", async () => {
      const store = usePqcMigrationStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true }) // execute
        .mockResolvedValueOnce({
          success: true,
          plans: [plan("a", "completed")],
        }) // status
        .mockResolvedValueOnce({ success: true, keys: [key("k", "active")] }); // keys
      await store.executeMigration("plan1", "rsa", "kyber768");
      expect(mockInvoke).toHaveBeenNthCalledWith(1, "pqc:execute-migration", {
        planName: "plan1",
        sourceAlgorithm: "rsa",
        targetAlgorithm: "kyber768",
      });
      expect(mockInvoke).toHaveBeenNthCalledWith(2, "pqc:get-migration-status");
      expect(mockInvoke).toHaveBeenNthCalledWith(3, "pqc:list-keys", undefined);
      expect(store.migrationPlans.map((p) => p.id)).toEqual(["a"]);
      expect(store.keys.map((k) => k.id)).toEqual(["k"]);
    });
  });
});
