/**
 * useEncryptionStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Pure getters: pqKeyCount / zkProofCount / hsmActiveKeys / isCompliant /
 *    activeMPCSessions
 *  - IPC actions (window.electronAPI.invoke mocked): generateKyberKeyPair (push
 *    on success), runPQAudit (set on success), error propagation, fetchModuleStats
 *    channel mapping
 *  - Pure actions: setActiveModule / clearError
 *
 * NB: this store calls (window as any).electronAPI?.invoke directly (no
 * createRetryableIPC), so we stub window.electronAPI per-test rather than vi.mock.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

import { useEncryptionStore } from "../encryption";
import type { HSMKey, MPCSession } from "../encryption";

const mockInvoke = vi.fn();

function hsmKey(keyId: string, status: string): HSMKey {
  return {
    keyId,
    alias: keyId,
    algorithm: "AES-256",
    backend: "softhsm",
    status,
  };
}

function mpcSession(sessionId: string, status: string): MPCSession {
  return { sessionId, status, participantCount: 3, threshold: 2 };
}

describe("useEncryptionStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockInvoke.mockReset();
    (window as any).electronAPI = { invoke: mockInvoke };
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete (window as any).electronAPI;
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  describe("Initial state", () => {
    it("starts empty with post-quantum active module", () => {
      const store = useEncryptionStore();
      expect(store.pqKeyPairs).toEqual([]);
      expect(store.pqAudit).toBeNull();
      expect(store.zkProofs).toEqual([]);
      expect(store.mpcSessions).toEqual([]);
      expect(store.hsmKeys).toEqual([]);
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
      expect(store.activeModule).toBe("post-quantum");
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("getters", () => {
    it("pqKeyCount + zkProofCount mirror collection lengths", () => {
      const store = useEncryptionStore();
      expect(store.pqKeyCount).toBe(0);
      expect(store.zkProofCount).toBe(0);
      store.pqKeyPairs = [{ id: "k1" } as any, { id: "k2" } as any];
      store.zkProofs = [{ proofId: "p1" } as any];
      expect(store.pqKeyCount).toBe(2);
      expect(store.zkProofCount).toBe(1);
    });

    it("hsmActiveKeys filters status === 'active'", () => {
      const store = useEncryptionStore();
      store.hsmKeys = [
        hsmKey("a", "active"),
        hsmKey("b", "revoked"),
        hsmKey("c", "active"),
      ];
      expect(store.hsmActiveKeys.map((k) => k.keyId)).toEqual(["a", "c"]);
    });

    it("isCompliant reads hsmCompliance.overallCompliant, defaulting false", () => {
      const store = useEncryptionStore();
      expect(store.isCompliant).toBe(false);
      store.hsmCompliance = { standards: [], overallCompliant: true };
      expect(store.isCompliant).toBe(true);
    });

    it("activeMPCSessions filters status === 'active'", () => {
      const store = useEncryptionStore();
      store.mpcSessions = [
        mpcSession("s1", "active"),
        mpcSession("s2", "closed"),
        mpcSession("s3", "active"),
      ];
      expect(store.activeMPCSessions.map((s) => s.sessionId)).toEqual([
        "s1",
        "s3",
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // IPC actions
  // -------------------------------------------------------------------------

  describe("IPC actions", () => {
    it("generateKyberKeyPair pushes the returned key pair on success", async () => {
      const store = useEncryptionStore();
      mockInvoke.mockResolvedValue({ success: true, data: { id: "kyber1" } });
      await store.generateKyberKeyPair(768);
      expect(mockInvoke).toHaveBeenCalledWith("pq:generate-kyber-keypair", 768);
      expect(store.pqKeyPairs.map((k) => k.id)).toEqual(["kyber1"]);
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });

    it("generateKyberKeyPair records the error and does not push on failure", async () => {
      const store = useEncryptionStore();
      mockInvoke.mockResolvedValue({ success: false, error: "boom" });
      await store.generateKyberKeyPair();
      expect(store.pqKeyPairs).toEqual([]);
      expect(store.error).toBe("boom");
      expect(store.loading).toBe(false);
    });

    it("runPQAudit stores the audit result on success", async () => {
      const store = useEncryptionStore();
      const audit = {
        totalKeys: 5,
        classicalKeys: 2,
        pqcKeys: 3,
        hybridKeys: 0,
        recommendations: [],
      };
      mockInvoke.mockResolvedValue({ success: true, data: audit });
      await store.runPQAudit();
      expect(mockInvoke).toHaveBeenCalledWith("pq:audit-scan");
      expect(store.pqAudit).toEqual(audit);
    });

    it("fetchModuleStats maps the module to its stats channel", async () => {
      const store = useEncryptionStore();
      mockInvoke.mockResolvedValue({ success: true, data: { n: 1 } });
      const stats = await store.fetchModuleStats("hsm");
      expect(mockInvoke).toHaveBeenCalledWith("hsm:get-stats");
      expect(stats).toEqual({ n: 1 });
    });

    it("fetchModuleStats returns null for an unknown module (no IPC call)", async () => {
      const store = useEncryptionStore();
      const stats = await store.fetchModuleStats("nope");
      expect(stats).toBeNull();
      expect(mockInvoke).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Pure actions
  // -------------------------------------------------------------------------

  describe("pure actions", () => {
    it("setActiveModule swaps the active module", () => {
      const store = useEncryptionStore();
      store.setActiveModule("hsm");
      expect(store.activeModule).toBe("hsm");
    });

    it("clearError resets the error", () => {
      const store = useEncryptionStore();
      store.error = "x";
      store.clearError();
      expect(store.error).toBeNull();
    });
  });
});
