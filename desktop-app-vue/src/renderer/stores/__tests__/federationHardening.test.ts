/**
 * useFederationHardeningStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Pure getters: openCircuits (state === 'open') / healthyNodes
 *    (status?.healthChecks?.healthy || 0)
 *  - IPC actions (electronAPI.invoke mocked): fetchStatus (set status / error),
 *    fetchCircuitBreakers (populate), resetCircuit (chains fetchCircuitBreakers),
 *    runHealthCheck (chains fetchStatus)
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

import { useFederationHardeningStore } from "../federationHardening";

describe("useFederationHardeningStore", () => {
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
      const store = useFederationHardeningStore();
      expect(store.status).toBeNull();
      expect(store.circuitBreakers).toEqual([]);
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("getters", () => {
    it("openCircuits filters state === 'open'", () => {
      const store = useFederationHardeningStore();
      store.circuitBreakers = [
        { id: "a", state: "open" },
        { id: "b", state: "closed" },
        { id: "c", state: "open" },
      ];
      expect(store.openCircuits.map((b: any) => b.id)).toEqual(["a", "c"]);
    });

    it("healthyNodes reads nested status, defaulting to 0", () => {
      const store = useFederationHardeningStore();
      expect(store.healthyNodes).toBe(0);
      store.status = { healthChecks: { healthy: 7 } };
      expect(store.healthyNodes).toBe(7);
    });
  });

  // -------------------------------------------------------------------------
  // IPC actions
  // -------------------------------------------------------------------------

  describe("IPC actions", () => {
    it("fetchStatus stores the status on success", async () => {
      const store = useFederationHardeningStore();
      mockInvoke.mockResolvedValue({
        success: true,
        status: { healthChecks: { healthy: 3 } },
      });
      await store.fetchStatus();
      expect(mockInvoke).toHaveBeenCalledWith(
        "federation-hardening:get-status",
      );
      expect(store.status).toEqual({ healthChecks: { healthy: 3 } });
      expect(store.loading).toBe(false);
    });

    it("fetchStatus records the error on failure", async () => {
      const store = useFederationHardeningStore();
      mockInvoke.mockResolvedValue({ success: false, error: "no svc" });
      await store.fetchStatus();
      expect(store.error).toBe("no svc");
    });

    it("fetchCircuitBreakers populates on success", async () => {
      const store = useFederationHardeningStore();
      mockInvoke.mockResolvedValue({
        success: true,
        breakers: [{ id: "a", state: "open" }],
      });
      await store.fetchCircuitBreakers();
      expect(mockInvoke).toHaveBeenCalledWith(
        "federation-hardening:get-circuit-breakers",
      );
      expect(store.circuitBreakers).toHaveLength(1);
    });

    it("resetCircuit chains fetchCircuitBreakers on success", async () => {
      const store = useFederationHardeningStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true }) // reset
        .mockResolvedValueOnce({
          success: true,
          breakers: [{ id: "a", state: "closed" }],
        }); // get
      await store.resetCircuit("node-1");
      expect(mockInvoke).toHaveBeenNthCalledWith(
        1,
        "federation-hardening:reset-circuit",
        "node-1",
      );
      expect(mockInvoke).toHaveBeenNthCalledWith(
        2,
        "federation-hardening:get-circuit-breakers",
      );
      expect(store.circuitBreakers[0].state).toBe("closed");
    });

    it("runHealthCheck chains fetchStatus on success", async () => {
      const store = useFederationHardeningStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true }) // run
        .mockResolvedValueOnce({
          success: true,
          status: { healthChecks: { healthy: 5 } },
        }); // get-status
      await store.runHealthCheck("node-1");
      expect(mockInvoke).toHaveBeenNthCalledWith(
        1,
        "federation-hardening:run-health-check",
        "node-1",
      );
      expect(mockInvoke).toHaveBeenNthCalledWith(
        2,
        "federation-hardening:get-status",
      );
      expect(store.healthyNodes).toBe(5);
    });
  });
});
