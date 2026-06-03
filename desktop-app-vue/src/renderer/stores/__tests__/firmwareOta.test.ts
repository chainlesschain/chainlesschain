/**
 * useFirmwareOtaStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Pure getters: hasUpdate (length > 0) / criticalUpdates (is_critical === 1) /
 *    isUpdating (currentUpdate !== null)
 *  - IPC actions (electronAPI.invoke mocked): checkUpdates (wrap availableUpdate /
 *    error), fetchVersions (populate), startUpdate (chains fetchHistory, clears
 *    currentUpdate in finally), fetchHistory (populate)
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

import { useFirmwareOtaStore } from "../firmwareOta";
import type { FirmwareVersion, FirmwareUpdate } from "../firmwareOta";

function version(id: string, is_critical = 0): FirmwareVersion {
  return {
    id,
    version: `1.0.${id}`,
    channel: "stable",
    release_notes: "",
    file_size: 1000,
    checksum: "sha",
    download_url: "https://dl",
    is_critical,
    released_at: 1700000000000,
  };
}

function update(id: string): FirmwareUpdate {
  return {
    id,
    version_id: "v1",
    version: "1.0.1",
    status: "running",
    progress: 0,
    started_at: null,
    completed_at: null,
    error_message: null,
  };
}

describe("useFirmwareOtaStore", () => {
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
      const store = useFirmwareOtaStore();
      expect(store.availableUpdates).toEqual([]);
      expect(store.updateHistory).toEqual([]);
      expect(store.currentUpdate).toBeNull();
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("getters", () => {
    it("hasUpdate + criticalUpdates derive from availableUpdates", () => {
      const store = useFirmwareOtaStore();
      expect(store.hasUpdate).toBe(false);
      store.availableUpdates = [version("a", 1), version("b", 0)];
      expect(store.hasUpdate).toBe(true);
      expect(store.criticalUpdates.map((u) => u.id)).toEqual(["a"]);
    });

    it("isUpdating reflects currentUpdate", () => {
      const store = useFirmwareOtaStore();
      expect(store.isUpdating).toBe(false);
      store.currentUpdate = update("u1");
      expect(store.isUpdating).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // IPC actions
  // -------------------------------------------------------------------------

  describe("IPC actions", () => {
    it("checkUpdates wraps a single availableUpdate into the list", async () => {
      const store = useFirmwareOtaStore();
      mockInvoke.mockResolvedValue({
        success: true,
        availableUpdate: version("a", 1),
      });
      await store.checkUpdates("1.0.0", "stable");
      expect(mockInvoke).toHaveBeenCalledWith("firmware:check-updates", {
        currentVersion: "1.0.0",
        channel: "stable",
      });
      expect(store.availableUpdates.map((u) => u.id)).toEqual(["a"]);
      expect(store.loading).toBe(false);
    });

    it("checkUpdates records the error on failure", async () => {
      const store = useFirmwareOtaStore();
      mockInvoke.mockResolvedValue({ success: false, error: "no svc" });
      await store.checkUpdates();
      expect(store.error).toBe("no svc");
    });

    it("fetchVersions populates the version list", async () => {
      const store = useFirmwareOtaStore();
      mockInvoke.mockResolvedValue({
        success: true,
        versions: [version("a"), version("b")],
      });
      await store.fetchVersions("stable", 10);
      expect(mockInvoke).toHaveBeenCalledWith("firmware:list-versions", {
        channel: "stable",
        limit: 10,
      });
      expect(store.availableUpdates.map((u) => u.id)).toEqual(["a", "b"]);
    });

    it("startUpdate chains fetchHistory and clears currentUpdate afterwards", async () => {
      const store = useFirmwareOtaStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true, update: update("u1") }) // start
        .mockResolvedValueOnce({ success: true, history: [update("u1")] }); // history
      await store.startUpdate("v1", true);
      expect(mockInvoke).toHaveBeenNthCalledWith(1, "firmware:start-update", {
        versionId: "v1",
        allowRollback: true,
      });
      expect(mockInvoke).toHaveBeenNthCalledWith(2, "firmware:get-history", {
        limit: undefined,
      });
      expect(store.updateHistory).toHaveLength(1);
      // finally block resets currentUpdate to null
      expect(store.currentUpdate).toBeNull();
      expect(store.loading).toBe(false);
    });

    it("fetchHistory populates update history", async () => {
      const store = useFirmwareOtaStore();
      mockInvoke.mockResolvedValue({
        success: true,
        history: [update("a"), update("b")],
      });
      await store.fetchHistory(5);
      expect(mockInvoke).toHaveBeenCalledWith("firmware:get-history", {
        limit: 5,
      });
      expect(store.updateHistory).toHaveLength(2);
    });
  });
});
