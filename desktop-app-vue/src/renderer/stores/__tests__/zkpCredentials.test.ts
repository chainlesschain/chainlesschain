/**
 * useZKPCredentialsStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Pure getters: activeCredentials / revokedCredentials (status filter)
 *  - IPC actions (electronAPI.invoke mocked): loadCredentials (populate / error),
 *    issueCredential (chains loadCredentials + returns data / throws),
 *    revokeCredential (chains loadCredentials), createPresentation (returns data),
 *    loadProofs (populate), generateIdentityProof (chains loadProofs), loadStats
 *    (merge two IPC result payloads), clearError
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

import { useZKPCredentialsStore } from "../zkpCredentials";
import type { ZKPCredential } from "../zkpCredentials";

function credential(id: string, status: string): ZKPCredential {
  return {
    id,
    type: "IdentityCredential",
    issuerDid: "did:issuer",
    subjectDid: "did:me",
    claims: {},
    disclosedClaims: [],
    proof: { scheme: "bbs+", signature: "s", nonce: "n", issuerPublicKey: "k" },
    proofScheme: "bbs+",
    revocationId: "r1",
    status,
    expiresAt: "2027-01-01",
    issuedAt: "2026-01-01",
    createdAt: "2026-01-01",
  };
}

describe("useZKPCredentialsStore", () => {
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
      const store = useZKPCredentialsStore();
      expect(store.credentials).toEqual([]);
      expect(store.proofs).toEqual([]);
      expect(store.stats).toBeNull();
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("getters", () => {
    it("activeCredentials / revokedCredentials split by status", () => {
      const store = useZKPCredentialsStore();
      store.credentials = [
        credential("a", "active"),
        credential("b", "revoked"),
        credential("c", "active"),
      ];
      expect(store.activeCredentials.map((c) => c.id)).toEqual(["a", "c"]);
      expect(store.revokedCredentials.map((c) => c.id)).toEqual(["b"]);
    });
  });

  // -------------------------------------------------------------------------
  // Credential actions
  // -------------------------------------------------------------------------

  describe("credential actions", () => {
    it("loadCredentials populates on success", async () => {
      const store = useZKPCredentialsStore();
      mockInvoke.mockResolvedValue({
        success: true,
        data: [credential("a", "active")],
      });
      await store.loadCredentials({ type: "IdentityCredential" });
      expect(mockInvoke).toHaveBeenCalledWith("zkp-vc:list-credentials", {
        filter: { type: "IdentityCredential" },
      });
      expect(store.credentials.map((c) => c.id)).toEqual(["a"]);
      expect(store.loading).toBe(false);
    });

    it("loadCredentials records the error on failure", async () => {
      const store = useZKPCredentialsStore();
      mockInvoke.mockResolvedValue({ success: false, error: "no svc" });
      await store.loadCredentials();
      expect(store.error).toBe("no svc");
    });

    it("issueCredential chains loadCredentials and returns data", async () => {
      const store = useZKPCredentialsStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true, data: { id: "new" } }) // issue
        .mockResolvedValueOnce({
          success: true,
          data: [credential("new", "active")],
        }); // list
      const data = await store.issueCredential("T", "did:i", "did:s", {
        age: 30,
      });
      expect(mockInvoke).toHaveBeenNthCalledWith(1, "zkp-vc:issue-credential", {
        type: "T",
        issuerDid: "did:i",
        subjectDid: "did:s",
        claims: { age: 30 },
      });
      expect(data).toEqual({ id: "new" });
      expect(store.credentials.map((c) => c.id)).toEqual(["new"]);
    });

    it("issueCredential throws on failure", async () => {
      const store = useZKPCredentialsStore();
      mockInvoke.mockResolvedValue({ success: false, error: "denied" });
      await expect(
        store.issueCredential("T", "did:i", "did:s", {}),
      ).rejects.toThrow("denied");
      expect(store.error).toBe("denied");
    });

    it("revokeCredential chains loadCredentials on success", async () => {
      const store = useZKPCredentialsStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true }) // revoke
        .mockResolvedValueOnce({ success: true, data: [] }); // list
      await store.revokeCredential("c1", "did:admin", "fraud");
      expect(mockInvoke).toHaveBeenNthCalledWith(
        1,
        "zkp-vc:revoke-credential",
        { credentialId: "c1", revokedBy: "did:admin", reason: "fraud" },
      );
      expect(mockInvoke).toHaveBeenNthCalledWith(2, "zkp-vc:list-credentials", {
        filter: {},
      });
    });

    it("createPresentation returns the result data", async () => {
      const store = useZKPCredentialsStore();
      mockInvoke.mockResolvedValue({ success: true, data: { vp: "..." } });
      const data = await store.createPresentation("c1", ["age"]);
      expect(mockInvoke).toHaveBeenCalledWith("zkp-vc:present-credential", {
        credentialId: "c1",
        disclosedClaimKeys: ["age"],
      });
      expect(data).toEqual({ vp: "..." });
    });
  });

  // -------------------------------------------------------------------------
  // Proof actions + stats
  // -------------------------------------------------------------------------

  describe("proof actions + stats", () => {
    it("loadProofs populates on success", async () => {
      const store = useZKPCredentialsStore();
      mockInvoke.mockResolvedValue({ success: true, data: [{ id: "p1" }] });
      await store.loadProofs();
      expect(mockInvoke).toHaveBeenCalledWith("zkp:list-proofs", {
        filter: {},
      });
      expect(store.proofs).toHaveLength(1);
    });

    it("generateIdentityProof chains loadProofs and returns data", async () => {
      const store = useZKPCredentialsStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true, data: { id: "proof1" } }) // generate
        .mockResolvedValueOnce({ success: true, data: [{ id: "proof1" }] }); // list
      const data = await store.generateIdentityProof("did:me", {
        over18: true,
      });
      expect(mockInvoke).toHaveBeenNthCalledWith(
        1,
        "zkp:generate-identity-proof",
        { proverDid: "did:me", claims: { over18: true } },
      );
      expect(data).toEqual({ id: "proof1" });
      expect(store.proofs).toHaveLength(1);
    });

    it("loadStats merges the proof + vc stat payloads", async () => {
      const store = useZKPCredentialsStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true, data: { totalProofs: 4 } }) // zkp:get-stats
        .mockResolvedValueOnce({
          success: true,
          data: { totalCredentials: 7 },
        }); // zkp-vc:get-stats
      await store.loadStats();
      expect(store.stats).toMatchObject({
        totalProofs: 4,
        totalCredentials: 7,
      });
    });
  });

  // -------------------------------------------------------------------------
  // clearError
  // -------------------------------------------------------------------------

  describe("clearError", () => {
    it("resets the error", () => {
      const store = useZKPCredentialsStore();
      store.error = "x";
      store.clearError();
      expect(store.error).toBeNull();
    });
  });
});
