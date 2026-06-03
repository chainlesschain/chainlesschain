/**
 * useEvoMapFederationStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Pure getter: onlineHubs (status === 'online')
 *  - IPC actions (electronAPI.invoke mocked): fetchHubs (populate), syncGenes
 *    (pass-through), fetchPressureReport (set report), getLineage (forward
 *    geneId), rejection → { success: false, error } envelope
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

import { useEvoMapFederationStore } from "../evoMapFederation";

describe("useEvoMapFederationStore", () => {
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
      const store = useEvoMapFederationStore();
      expect(store.hubs).toEqual([]);
      expect(store.pressureReport).toBeNull();
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Getter
  // -------------------------------------------------------------------------

  describe("onlineHubs", () => {
    it("filters hubs with status === 'online'", () => {
      const store = useEvoMapFederationStore();
      store.hubs = [
        { id: "a", status: "online" },
        { id: "b", status: "offline" },
        { id: "c", status: "online" },
      ];
      expect(store.onlineHubs.map((h: any) => h.id)).toEqual(["a", "c"]);
    });
  });

  // -------------------------------------------------------------------------
  // IPC actions
  // -------------------------------------------------------------------------

  describe("IPC actions", () => {
    it("fetchHubs populates on success", async () => {
      const store = useEvoMapFederationStore();
      mockInvoke.mockResolvedValue({
        success: true,
        hubs: [{ id: "a" }, { id: "b" }],
      });
      await store.fetchHubs({ region: "eu" });
      expect(mockInvoke).toHaveBeenCalledWith("evomap-federation:list-hubs", {
        region: "eu",
      });
      expect(store.hubs).toHaveLength(2);
      expect(store.loading).toBe(false);
    });

    it("syncGenes passes the result through", async () => {
      const store = useEvoMapFederationStore();
      mockInvoke.mockResolvedValue({ success: true, synced: 4 });
      const result = await store.syncGenes({ hubId: "h1" });
      expect(mockInvoke).toHaveBeenCalledWith("evomap-federation:sync-genes", {
        hubId: "h1",
      });
      expect(result).toEqual({ success: true, synced: 4 });
    });

    it("fetchPressureReport stores the report on success", async () => {
      const store = useEvoMapFederationStore();
      mockInvoke.mockResolvedValue({
        success: true,
        report: { pressure: 0.7 },
      });
      await store.fetchPressureReport();
      expect(mockInvoke).toHaveBeenCalledWith(
        "evomap-federation:get-pressure-report",
      );
      expect(store.pressureReport).toEqual({ pressure: 0.7 });
    });

    it("getLineage forwards the gene id", async () => {
      const store = useEvoMapFederationStore();
      mockInvoke.mockResolvedValue({ success: true, lineage: [] });
      await store.getLineage("gene-1");
      expect(mockInvoke).toHaveBeenCalledWith(
        "evomap-federation:get-lineage",
        "gene-1",
      );
    });

    it("returns a { success: false, error } envelope when IPC rejects", async () => {
      const store = useEvoMapFederationStore();
      mockInvoke.mockRejectedValue(new Error("offline"));
      const result = await store.fetchHubs();
      expect(result).toEqual({ success: false, error: "offline" });
      expect(store.hubs).toEqual([]);
      expect(store.loading).toBe(false);
    });
  });
});
