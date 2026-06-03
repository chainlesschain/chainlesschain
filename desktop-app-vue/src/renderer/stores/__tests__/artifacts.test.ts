/**
 * useArtifactStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Pure getters: currentArtifact / all / byType (parametric)
 *  - actions: seedIfEmpty (idempotent), open (set current + history dedup/cap 20,
 *    unknown-id no-op), close, add, appendSignature (append / unknown no-op),
 *    signArtifact (stub fallback when no U-Key API), runAction ('sign' delegates)
 *
 * NB: in-memory store (no IPC for the core paths). signArtifact reads
 * window.electronAPI.ukey lazily; we leave it unset to exercise the stub path.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { useArtifactStore } from "../artifacts";

function art(id: string, type = "note"): any {
  return {
    id,
    type,
    version: 1,
    createdAt: 1700000000000,
    createdBy: "did:me",
    payload: {},
    signatures: [],
    permissions: {},
    lineage: [],
  };
}

describe("useArtifactStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  describe("Initial state", () => {
    it("starts empty", () => {
      const store = useArtifactStore();
      expect(store.byId).toEqual({});
      expect(store.currentId).toBeNull();
      expect(store.history).toEqual([]);
      expect(store.all).toEqual([]);
      expect(store.currentArtifact).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // seedIfEmpty
  // -------------------------------------------------------------------------

  describe("seedIfEmpty", () => {
    it("seeds the sample set once and is idempotent", () => {
      const store = useArtifactStore();
      store.seedIfEmpty();
      const count = store.all.length;
      expect(count).toBe(6);
      // second call is a no-op (no duplicates, lastSeed unchanged)
      const seededAt = store.lastSeed;
      store.seedIfEmpty();
      expect(store.all.length).toBe(count);
      expect(store.lastSeed).toBe(seededAt);
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("getters", () => {
    it("all returns the stored values", () => {
      const store = useArtifactStore();
      store.add(art("a"));
      store.add(art("b"));
      expect(store.all.map((a) => a.id).sort()).toEqual(["a", "b"]);
    });

    it("byType filters by artifact type", () => {
      const store = useArtifactStore();
      store.add(art("a", "note"));
      store.add(art("b", "tx"));
      store.add(art("c", "note"));
      expect(
        store
          .byType("note")
          .map((a) => a.id)
          .sort(),
      ).toEqual(["a", "c"]);
      expect(store.byType("vc")).toEqual([]);
    });

    it("currentArtifact follows currentId", () => {
      const store = useArtifactStore();
      store.add(art("a"));
      expect(store.currentArtifact).toBeNull();
      store.open("a");
      expect(store.currentArtifact?.id).toBe("a");
    });
  });

  // -------------------------------------------------------------------------
  // open / close
  // -------------------------------------------------------------------------

  describe("open / close", () => {
    it("open sets currentId and records de-duplicated history", () => {
      const store = useArtifactStore();
      store.add(art("a"));
      store.add(art("b"));
      store.open("a");
      store.open("b");
      store.open("a"); // re-open: moves to front, no dup
      expect(store.currentId).toBe("a");
      expect(store.history).toEqual(["a", "b"]);
    });

    it("open is a no-op for an unknown id", () => {
      const store = useArtifactStore();
      store.open("ghost");
      expect(store.currentId).toBeNull();
      expect(store.history).toEqual([]);
    });

    it("history is capped at 20 entries, newest first", () => {
      const store = useArtifactStore();
      for (let i = 0; i < 22; i++) store.add(art(`a${i}`));
      for (let i = 0; i < 22; i++) store.open(`a${i}`);
      expect(store.history).toHaveLength(20);
      expect(store.history[0]).toBe("a21");
      expect(store.history).not.toContain("a0");
    });

    it("close clears currentId", () => {
      const store = useArtifactStore();
      store.add(art("a"));
      store.open("a");
      store.close();
      expect(store.currentId).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // signatures
  // -------------------------------------------------------------------------

  describe("signatures", () => {
    it("appendSignature appends to the target and no-ops for unknown id", () => {
      const store = useArtifactStore();
      store.add(art("a"));
      const sig = {
        signer: "did:me",
        alg: "stub",
        signature: "S1",
        signedAt: 1,
        over: "payload",
      } as any;
      store.appendSignature("a", sig);
      expect(store.byId["a"].signatures).toHaveLength(1);
      store.appendSignature("ghost", sig); // no throw
      expect(store.byId["a"].signatures).toHaveLength(1);
    });

    it("signArtifact appends a stub signature when no U-Key API is present", async () => {
      const store = useArtifactStore();
      store.add(art("a"));
      await store.signArtifact("a");
      const sigs = store.byId["a"].signatures;
      expect(sigs).toHaveLength(1);
      expect(sigs[0].alg).toBe("stub");
      expect(sigs[0].signer).toBe("did:me");
    });

    it("runAction('sign') delegates to signArtifact", async () => {
      const store = useArtifactStore();
      store.add(art("a"));
      await store.runAction("a", "sign");
      expect(store.byId["a"].signatures).toHaveLength(1);
    });
  });
});
