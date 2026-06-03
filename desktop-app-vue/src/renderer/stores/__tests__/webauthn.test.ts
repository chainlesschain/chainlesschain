/**
 * useWebAuthnStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Pure getters: activePasskeys (status === 'active') / passkeysByRp (parametric)
 *  - IPC actions (electronAPI.invoke mocked): loadPasskeys (populate / error),
 *    registerPasskey (returns begin data / throws), completeRegistration (chains
 *    loadPasskeys), deletePasskey (chains loadPasskeys), loadStats (set stats),
 *    clearError
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

import { useWebAuthnStore } from "../webauthn";
import type { Passkey } from "../webauthn";

function passkey(id: string, rpId: string, status: string): Passkey {
  return {
    id,
    credentialId: `cred-${id}`,
    rpId,
    userId: "u1",
    publicKey: "pk",
    algorithm: -7,
    signCount: 0,
    transports: [],
    status,
    createdAt: "2026-01-01",
  };
}

describe("useWebAuthnStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockInvoke.mockReset().mockResolvedValue({ success: true, data: [] });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  describe("Initial state", () => {
    it("starts empty", () => {
      const store = useWebAuthnStore();
      expect(store.passkeys).toEqual([]);
      expect(store.stats).toBeNull();
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("getters", () => {
    it("activePasskeys filters status === 'active'", () => {
      const store = useWebAuthnStore();
      store.passkeys = [
        passkey("a", "rp1", "active"),
        passkey("b", "rp1", "revoked"),
        passkey("c", "rp2", "active"),
      ];
      expect(store.activePasskeys.map((p) => p.id)).toEqual(["a", "c"]);
    });

    it("passkeysByRp filters by rpId", () => {
      const store = useWebAuthnStore();
      store.passkeys = [
        passkey("a", "rp1", "active"),
        passkey("b", "rp2", "active"),
        passkey("c", "rp1", "active"),
      ];
      expect(store.passkeysByRp("rp1").map((p) => p.id)).toEqual(["a", "c"]);
      expect(store.passkeysByRp("rpX")).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // IPC actions
  // -------------------------------------------------------------------------

  describe("IPC actions", () => {
    it("loadPasskeys populates on success", async () => {
      const store = useWebAuthnStore();
      mockInvoke.mockResolvedValue({
        success: true,
        data: [passkey("a", "rp1", "active")],
      });
      await store.loadPasskeys();
      expect(mockInvoke).toHaveBeenCalledWith("webauthn:list-passkeys", {});
      expect(store.passkeys.map((p) => p.id)).toEqual(["a"]);
      expect(store.loading).toBe(false);
    });

    it("loadPasskeys records the error on failure", async () => {
      const store = useWebAuthnStore();
      mockInvoke.mockResolvedValue({ success: false, error: "no svc" });
      await store.loadPasskeys();
      expect(store.error).toBe("no svc");
    });

    it("registerPasskey returns begin data and throws on failure", async () => {
      const store = useWebAuthnStore();
      mockInvoke.mockResolvedValue({
        success: true,
        data: { ceremonyId: "c1", challenge: "x" },
      });
      const data = await store.registerPasskey("rp1", "RP", "u1", "user");
      expect(mockInvoke).toHaveBeenCalledWith("webauthn:register-begin", {
        rpId: "rp1",
        rpName: "RP",
        userId: "u1",
        userName: "user",
      });
      expect(data).toEqual({ ceremonyId: "c1", challenge: "x" });

      mockInvoke.mockResolvedValue({ success: false, error: "denied" });
      await expect(
        store.registerPasskey("rp1", "RP", "u1", "user"),
      ).rejects.toThrow("denied");
    });

    it("completeRegistration chains loadPasskeys on success", async () => {
      const store = useWebAuthnStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true, data: { id: "p1" } }) // complete
        .mockResolvedValueOnce({
          success: true,
          data: [passkey("p1", "rp1", "active")],
        }); // list
      await store.completeRegistration("c1", { foo: 1 });
      expect(mockInvoke).toHaveBeenNthCalledWith(
        1,
        "webauthn:register-complete",
        { ceremonyId: "c1", attestationResponse: { foo: 1 } },
      );
      expect(mockInvoke).toHaveBeenNthCalledWith(
        2,
        "webauthn:list-passkeys",
        {},
      );
      expect(store.passkeys.map((p) => p.id)).toEqual(["p1"]);
    });

    it("deletePasskey chains loadPasskeys on success", async () => {
      const store = useWebAuthnStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true }) // delete
        .mockResolvedValueOnce({ success: true, data: [] }); // list
      await store.deletePasskey("cred-a");
      expect(mockInvoke).toHaveBeenNthCalledWith(1, "webauthn:delete-passkey", {
        credentialId: "cred-a",
      });
      expect(mockInvoke).toHaveBeenNthCalledWith(
        2,
        "webauthn:list-passkeys",
        {},
      );
    });

    it("loadStats stores stats on success", async () => {
      const store = useWebAuthnStore();
      mockInvoke.mockResolvedValue({
        success: true,
        data: { totalPasskeys: 2, activePasskeys: 1 },
      });
      await store.loadStats();
      expect(mockInvoke).toHaveBeenCalledWith("webauthn:get-stats", {});
      expect(store.stats?.totalPasskeys).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // clearError
  // -------------------------------------------------------------------------

  describe("clearError", () => {
    it("resets the error", () => {
      const store = useWebAuthnStore();
      store.error = "x";
      store.clearError();
      expect(store.error).toBeNull();
    });
  });
});
