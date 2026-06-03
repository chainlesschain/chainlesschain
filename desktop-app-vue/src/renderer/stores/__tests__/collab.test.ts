/**
 * useCollabStore — Pinia store unit tests (CRDT/Yjs collaboration)
 *
 * Covers the pure surface:
 *  - Initial state shape
 *  - Getters: hasUnresolvedConflicts / isDocumentLocked (full lock) /
 *    myLockedSections (map to {start,end}) / onlineCollaboratorCount /
 *    isLoading / isConnected / isYjsReady (connected AND synced) /
 *    activeCollaboratorCount
 *  - Pure actions: setCollaborators / updateCursorPosition / setYjsSynced / reset
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

import { useCollabStore } from "../collab";
import type { Collaborator, Lock } from "../collab";

function collaborator(did: string, isOnline: boolean): Collaborator {
  return { did, name: did, isOnline };
}

function lock(overrides: Partial<Lock> = {}): Lock {
  return {
    id: "l1",
    knowledgeId: "k1",
    userDid: "did:me",
    lockType: "section",
    acquiredAt: 1700000000000,
    ...overrides,
  };
}

describe("useCollabStore", () => {
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
    it("starts disconnected with no collaborators or locks", () => {
      const store = useCollabStore();
      expect(store.collaborators).toEqual([]);
      expect(store.locks).toEqual([]);
      expect(store.pendingConflicts).toEqual([]);
      expect(store.connectionStatus).toBe("disconnected");
      expect(store.yjsConnected).toBe(false);
      expect(store.yjsSynced).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("getters", () => {
    it("hasUnresolvedConflicts reflects pendingConflicts", () => {
      const store = useCollabStore();
      expect(store.hasUnresolvedConflicts).toBe(false);
      store.pendingConflicts = [{ id: "c1" } as any];
      expect(store.hasUnresolvedConflicts).toBe(true);
    });

    it("isDocumentLocked is true only when a full lock exists", () => {
      const store = useCollabStore();
      store.locks = [
        lock({ lockType: "section" }),
        lock({ lockType: "paragraph" }),
      ];
      expect(store.isDocumentLocked).toBe(false);
      store.locks = [...store.locks, lock({ lockType: "full" })];
      expect(store.isDocumentLocked).toBe(true);
    });

    it("myLockedSections maps myLocks to {start,end}", () => {
      const store = useCollabStore();
      store.myLocks = [
        lock({ sectionStart: 0, sectionEnd: 10 }),
        lock({ sectionStart: 20, sectionEnd: 30 }),
      ];
      expect(store.myLockedSections).toEqual([
        { start: 0, end: 10 },
        { start: 20, end: 30 },
      ]);
    });

    it("onlineCollaboratorCount counts isOnline", () => {
      const store = useCollabStore();
      store.collaborators = [
        collaborator("a", true),
        collaborator("b", false),
        collaborator("c", true),
      ];
      expect(store.onlineCollaboratorCount).toBe(2);
    });

    it("isLoading reflects any loading flag", () => {
      const store = useCollabStore();
      expect(store.isLoading).toBe(false);
      store.loading.document = true;
      expect(store.isLoading).toBe(true);
    });

    it("isConnected mirrors connectionStatus === 'connected'", () => {
      const store = useCollabStore();
      expect(store.isConnected).toBe(false);
      store.connectionStatus = "connecting";
      expect(store.isConnected).toBe(false);
      store.connectionStatus = "connected";
      expect(store.isConnected).toBe(true);
    });

    it("isYjsReady requires connected AND synced", () => {
      const store = useCollabStore();
      expect(store.isYjsReady).toBe(false);
      store.yjsConnected = true;
      expect(store.isYjsReady).toBe(false); // not synced
      store.yjsSynced = true;
      expect(store.isYjsReady).toBe(true);
    });

    it("activeCollaboratorCount mirrors activeCollaborators length", () => {
      const store = useCollabStore();
      store.activeCollaborators = [{ did: "a" } as any, { did: "b" } as any];
      expect(store.activeCollaboratorCount).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // Pure actions
  // -------------------------------------------------------------------------

  describe("pure actions", () => {
    it("setCollaborators replaces the list", () => {
      const store = useCollabStore();
      store.setCollaborators([collaborator("a", true)]);
      expect(store.collaborators.map((c) => c.did)).toEqual(["a"]);
    });

    it("updateCursorPosition records a position keyed by user did", () => {
      const store = useCollabStore();
      store.updateCursorPosition("did:a", { line: 3, column: 5 });
      expect(store.cursorPositions["did:a"]).toEqual({ line: 3, column: 5 });
    });

    it("setYjsSynced flips the synced flag", () => {
      const store = useCollabStore();
      store.setYjsSynced(true);
      expect(store.yjsSynced).toBe(true);
    });

    it("reset restores initial state", () => {
      const store = useCollabStore();
      store.collaborators = [collaborator("a", true)];
      store.connectionStatus = "connected";
      store.yjsSynced = true;
      store.reset();
      expect(store.collaborators).toEqual([]);
      expect(store.connectionStatus).toBe("disconnected");
      expect(store.yjsSynced).toBe(false);
    });
  });
});
