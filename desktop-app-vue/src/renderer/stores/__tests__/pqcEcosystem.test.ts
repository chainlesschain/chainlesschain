/**
 * usePQCEcosystemStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - IPC actions (electronAPI.invoke mocked): fetchCoverage (set coverage /
 *    error), migrateSubsystem (chains fetchCoverage), updateFirmwarePQC (forward
 *    version), verifyMigration (pass-through)
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

import { usePQCEcosystemStore } from "../pqcEcosystem";

describe("usePQCEcosystemStore", () => {
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
      const store = usePQCEcosystemStore();
      expect(store.coverage).toBeNull();
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // IPC actions
  // -------------------------------------------------------------------------

  describe("IPC actions", () => {
    it("fetchCoverage stores the coverage on success", async () => {
      const store = usePQCEcosystemStore();
      mockInvoke.mockResolvedValue({
        success: true,
        coverage: { migrated: 8, total: 10 },
      });
      await store.fetchCoverage();
      expect(mockInvoke).toHaveBeenCalledWith("pqc-ecosystem:get-coverage");
      expect(store.coverage).toEqual({ migrated: 8, total: 10 });
      expect(store.loading).toBe(false);
    });

    it("fetchCoverage records the error envelope on rejection", async () => {
      const store = usePQCEcosystemStore();
      mockInvoke.mockRejectedValue(new Error("offline"));
      const result = await store.fetchCoverage();
      expect(result).toEqual({ success: false, error: "offline" });
      expect(store.error).toBe("offline");
      expect(store.coverage).toBeNull();
    });

    it("migrateSubsystem chains fetchCoverage on success", async () => {
      const store = usePQCEcosystemStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true }) // migrate
        .mockResolvedValueOnce({
          success: true,
          coverage: { migrated: 9, total: 10 },
        }); // coverage
      await store.migrateSubsystem({ name: "storage" });
      expect(mockInvoke).toHaveBeenNthCalledWith(
        1,
        "pqc-ecosystem:migrate-subsystem",
        { name: "storage" },
      );
      expect(mockInvoke).toHaveBeenNthCalledWith(
        2,
        "pqc-ecosystem:get-coverage",
      );
      expect(store.coverage).toMatchObject({ migrated: 9 });
    });

    it("updateFirmwarePQC forwards the version", async () => {
      const store = usePQCEcosystemStore();
      mockInvoke.mockResolvedValue({ success: true });
      await store.updateFirmwarePQC("2.0.0");
      expect(mockInvoke).toHaveBeenCalledWith(
        "pqc-ecosystem:update-firmware-pqc",
        "2.0.0",
      );
    });

    it("verifyMigration passes the result through", async () => {
      const store = usePQCEcosystemStore();
      mockInvoke.mockResolvedValue({ success: true, verified: true });
      const result = await store.verifyMigration();
      expect(mockInvoke).toHaveBeenCalledWith("pqc-ecosystem:verify-migration");
      expect(result).toEqual({ success: true, verified: true });
    });
  });
});
