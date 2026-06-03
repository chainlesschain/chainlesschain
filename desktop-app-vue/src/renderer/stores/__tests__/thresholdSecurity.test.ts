/**
 * useThresholdSecurityStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Pure getters: activeBindings (status === 'active') / keyCount
 *  - IPC actions (electronAPI.invoke mocked): setupKeys (set currentSetup +
 *    chains loadKeys / error), sign (return / error), bindBiometric (chains
 *    loadBindings), verifyBiometric (return), loadKeys (populate), loadBindings
 *    (populate)
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

import { useThresholdSecurityStore } from "../thresholdSecurity";
import type { ThresholdKey, BiometricBinding } from "../thresholdSecurity";

function key(key_id: string): ThresholdKey {
  return {
    key_id,
    public_key: "pk",
    share_count: 3,
    created_at: 1700000000000,
  };
}

function binding(id: string, status: string): BiometricBinding {
  return {
    id,
    key_id: "k1",
    biometric_type: "fingerprint",
    status,
    bound_at: 1700000000000,
    expires_at: null,
    last_verified_at: null,
    verification_count: 0,
  };
}

describe("useThresholdSecurityStore", () => {
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
      const store = useThresholdSecurityStore();
      expect(store.keys).toEqual([]);
      expect(store.bindings).toEqual([]);
      expect(store.currentSetup).toBeNull();
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("getters", () => {
    it("activeBindings filters status === 'active'; keyCount counts keys", () => {
      const store = useThresholdSecurityStore();
      store.bindings = [
        binding("a", "active"),
        binding("b", "revoked"),
        binding("c", "active"),
      ];
      store.keys = [key("k1"), key("k2")];
      expect(store.activeBindings.map((b) => b.id)).toEqual(["a", "c"]);
      expect(store.keyCount).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // IPC actions
  // -------------------------------------------------------------------------

  describe("IPC actions", () => {
    it("setupKeys stores the result and chains loadKeys", async () => {
      const store = useThresholdSecurityStore();
      const setup = {
        success: true,
        keyId: "k1",
        publicKey: "pk",
        shares: [],
        threshold: 2,
        total: 3,
      };
      mockInvoke
        .mockResolvedValueOnce(setup) // setup
        .mockResolvedValueOnce({ success: true, keys: [key("k1")] }); // list
      await store.setupKeys("k1", ["ukey", "biometric"]);
      expect(mockInvoke).toHaveBeenNthCalledWith(
        1,
        "threshold-security:setup-keys",
        { keyId: "k1", sources: ["ukey", "biometric"] },
      );
      expect(mockInvoke).toHaveBeenNthCalledWith(
        2,
        "threshold-security:setup-keys",
        { action: "list" },
      );
      expect(store.currentSetup).toMatchObject({ keyId: "k1" });
      expect(store.keys.map((k) => k.key_id)).toEqual(["k1"]);
    });

    it("setupKeys records the error on failure", async () => {
      const store = useThresholdSecurityStore();
      mockInvoke.mockResolvedValue({ success: false, error: "bad shares" });
      await store.setupKeys("k1");
      expect(store.error).toBe("bad shares");
      expect(store.currentSetup).toBeNull();
    });

    it("sign returns the result and records errors", async () => {
      const store = useThresholdSecurityStore();
      mockInvoke.mockResolvedValue({ success: true, signature: "sig" });
      const ok = await store.sign("k1", "data", ["ukey", "biometric"]);
      expect(mockInvoke).toHaveBeenCalledWith("threshold-security:sign", {
        keyId: "k1",
        data: "data",
        shareSources: ["ukey", "biometric"],
      });
      expect(ok).toEqual({ success: true, signature: "sig" });

      mockInvoke.mockResolvedValue({ success: false, error: "denied" });
      await store.sign("k1", "d", []);
      expect(store.error).toBe("denied");
    });

    it("bindBiometric chains loadBindings on success", async () => {
      const store = useThresholdSecurityStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true }) // bind
        .mockResolvedValueOnce({
          success: true,
          bindings: [binding("b1", "active")],
        }); // list
      await store.bindBiometric("k1", "fingerprint", "tmpl", 30);
      expect(mockInvoke).toHaveBeenNthCalledWith(
        1,
        "threshold-security:bind-biometric",
        {
          keyId: "k1",
          biometricType: "fingerprint",
          templateData: "tmpl",
          expiresInDays: 30,
        },
      );
      expect(mockInvoke).toHaveBeenNthCalledWith(
        2,
        "threshold-security:bind-biometric",
        { action: "list", keyId: "k1" },
      );
      expect(store.bindings.map((b) => b.id)).toEqual(["b1"]);
    });

    it("verifyBiometric returns the result", async () => {
      const store = useThresholdSecurityStore();
      mockInvoke.mockResolvedValue({ success: true, verified: true });
      const result = await store.verifyBiometric("k1", "fingerprint", "tmpl");
      expect(mockInvoke).toHaveBeenCalledWith(
        "threshold-security:verify-biometric",
        { keyId: "k1", biometricType: "fingerprint", templateData: "tmpl" },
      );
      expect(result).toEqual({ success: true, verified: true });
    });

    it("loadKeys + loadBindings populate their slices", async () => {
      const store = useThresholdSecurityStore();
      mockInvoke.mockResolvedValueOnce({ success: true, keys: [key("k1")] });
      await store.loadKeys();
      expect(store.keys.map((k) => k.key_id)).toEqual(["k1"]);

      mockInvoke.mockResolvedValueOnce({
        success: true,
        bindings: [binding("b1", "active")],
      });
      await store.loadBindings("k1");
      expect(store.bindings.map((b) => b.id)).toEqual(["b1"]);
    });
  });
});
