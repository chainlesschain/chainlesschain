/**
 * useSocialCollabStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Pure getters: totalDocumentCount / hasOpenDocument /
 *    remoteCollaboratorCount / hasPendingInvites / latestVersionNumber
 *    (Math.max + empty → 0)
 *  - IPC actions (ipcRenderer.invoke mocked): loadMyDocs (populate / error),
 *    createDocument (unshift + return / error→null), openDocument (set current +
 *    collaborators), closeDocument (clear + no-op guard), archiveDocument
 *    (remove + clear-current-if-match), acceptInvite (drop invite + reload),
 *    loadPendingInvites
 *
 * NB: socialCollab.ts captures `ipcRenderer` at MODULE LOAD
 * (`const ipcRenderer = window.electron?.ipcRenderer || window.electronAPI`),
 * so window.electron must exist BEFORE the import — set it in vi.hoisted, and
 * never delete it here (only reset the mock fn between tests).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const { mockInvoke } = vi.hoisted(() => {
  const mockInvoke = vi.fn();
  (globalThis as any).window = (globalThis as any).window || {};
  (globalThis as any).window.electron = { ipcRenderer: { invoke: mockInvoke } };
  return { mockInvoke };
});

import { useSocialCollabStore } from "../socialCollab";
import type { CollabDocument, CollabInvite, DocVersion } from "../socialCollab";

function doc(
  id: string,
  overrides: Partial<CollabDocument> = {},
): CollabDocument {
  return {
    id,
    title: `Doc ${id}`,
    contentType: "markdown",
    ownerDid: "did:me",
    visibility: "private",
    status: "active",
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    ...overrides,
  };
}

function invite(id: string): CollabInvite {
  return {
    id,
    docId: "d1",
    inviterDid: "did:x",
    inviteeDid: "did:me",
    permission: "editor",
    status: "pending",
    createdAt: 1700000000000,
  };
}

function version(versionNumber: number): DocVersion {
  return {
    id: `v${versionNumber}`,
    docId: "d1",
    versionNumber,
    description: "",
    creatorDid: "did:me",
    createdAt: 1700000000000,
    hasSnapshot: true,
  };
}

describe("useSocialCollabStore", () => {
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
      const store = useSocialCollabStore();
      expect(store.documents).toEqual([]);
      expect(store.sharedDocuments).toEqual([]);
      expect(store.currentDoc).toBeNull();
      expect(store.collaborators).toEqual([]);
      expect(store.remoteCursors).toEqual([]);
      expect(store.versions).toEqual([]);
      expect(store.pendingInvites).toEqual([]);
      expect(store.loading).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("getters", () => {
    it("totalDocumentCount sums owned + shared", () => {
      const store = useSocialCollabStore();
      store.documents = [doc("a"), doc("b")];
      store.sharedDocuments = [doc("c")];
      expect(store.totalDocumentCount).toBe(3);
    });

    it("hasOpenDocument reflects currentDoc", () => {
      const store = useSocialCollabStore();
      expect(store.hasOpenDocument).toBe(false);
      store.currentDoc = doc("a");
      expect(store.hasOpenDocument).toBe(true);
    });

    it("remoteCollaboratorCount + hasPendingInvites read their lists", () => {
      const store = useSocialCollabStore();
      expect(store.remoteCollaboratorCount).toBe(0);
      expect(store.hasPendingInvites).toBe(false);
      store.remoteCursors = [{ did: "x" } as any, { did: "y" } as any];
      store.pendingInvites = [invite("i1")];
      expect(store.remoteCollaboratorCount).toBe(2);
      expect(store.hasPendingInvites).toBe(true);
    });

    it("latestVersionNumber is the max, or 0 when empty", () => {
      const store = useSocialCollabStore();
      expect(store.latestVersionNumber).toBe(0);
      store.versions = [version(1), version(3), version(2)];
      expect(store.latestVersionNumber).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  // Document actions
  // -------------------------------------------------------------------------

  describe("document actions", () => {
    it("loadMyDocs populates documents on success", async () => {
      const store = useSocialCollabStore();
      mockInvoke.mockResolvedValue({
        success: true,
        documents: [doc("a"), doc("b")],
      });
      await store.loadMyDocs();
      expect(mockInvoke).toHaveBeenCalledWith("social-collab:get-my-docs", {});
      expect(store.documents.map((d) => d.id)).toEqual(["a", "b"]);
      expect(store.loading).toBe(false);
    });

    it("loadMyDocs records the error on failure", async () => {
      const store = useSocialCollabStore();
      mockInvoke.mockResolvedValue({ success: false, error: "nope" });
      await store.loadMyDocs();
      expect(store.error).toBe("nope");
    });

    it("createDocument prepends the new doc and returns it", async () => {
      const store = useSocialCollabStore();
      store.documents = [doc("old")];
      mockInvoke.mockResolvedValue({ success: true, document: doc("new") });
      const created = await store.createDocument({ title: "new" });
      expect(created?.id).toBe("new");
      expect(store.documents.map((d) => d.id)).toEqual(["new", "old"]);
    });

    it("createDocument returns null and records the error on failure", async () => {
      const store = useSocialCollabStore();
      mockInvoke.mockResolvedValue({ success: false, error: "denied" });
      const created = await store.createDocument({ title: "x" });
      expect(created).toBeNull();
      expect(store.error).toBe("denied");
    });

    it("openDocument sets currentDoc + collaborators", async () => {
      const store = useSocialCollabStore();
      mockInvoke
        .mockResolvedValueOnce({
          success: true,
          document: doc("d1"),
          collaborators: ["did:a", "did:b"],
        })
        .mockResolvedValueOnce({ success: true, versions: [] }); // loadVersions
      await store.openDocument("d1");
      expect(mockInvoke).toHaveBeenNthCalledWith(
        1,
        "social-collab:open-doc",
        "d1",
      );
      expect(store.currentDoc?.id).toBe("d1");
      expect(store.collaborators).toEqual(["did:a", "did:b"]);
    });

    it("closeDocument clears doc state and no-ops without a current doc", async () => {
      const store = useSocialCollabStore();
      // no current doc → no IPC
      await store.closeDocument();
      expect(mockInvoke).not.toHaveBeenCalled();
      // with a current doc → clears
      store.currentDoc = doc("d1");
      store.collaborators = ["x"];
      store.versions = [version(1)];
      await store.closeDocument();
      expect(mockInvoke).toHaveBeenCalledWith("social-collab:close-doc", "d1");
      expect(store.currentDoc).toBeNull();
      expect(store.collaborators).toEqual([]);
      expect(store.versions).toEqual([]);
    });

    it("archiveDocument removes the doc and clears current when it matches", async () => {
      const store = useSocialCollabStore();
      store.documents = [doc("d1"), doc("d2")];
      store.currentDoc = doc("d1");
      mockInvoke.mockResolvedValue({ success: true });
      await store.archiveDocument("d1");
      expect(mockInvoke).toHaveBeenCalledWith(
        "social-collab:archive-doc",
        "d1",
      );
      expect(store.documents.map((d) => d.id)).toEqual(["d2"]);
      expect(store.currentDoc).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Invite actions
  // -------------------------------------------------------------------------

  describe("invite actions", () => {
    it("loadPendingInvites populates the list", async () => {
      const store = useSocialCollabStore();
      mockInvoke.mockResolvedValue({
        success: true,
        invites: [invite("i1"), invite("i2")],
      });
      await store.loadPendingInvites();
      expect(mockInvoke).toHaveBeenCalledWith(
        "social-collab:get-pending-invites",
      );
      expect(store.pendingInvites.map((i) => i.id)).toEqual(["i1", "i2"]);
    });

    it("acceptInvite drops the invite and reloads shared docs", async () => {
      const store = useSocialCollabStore();
      store.pendingInvites = [invite("i1"), invite("i2")];
      mockInvoke
        .mockResolvedValueOnce({ success: true }) // accept-invite
        .mockResolvedValueOnce({ success: true, documents: [doc("s1")] }); // loadSharedDocs
      await store.acceptInvite("i1");
      expect(mockInvoke).toHaveBeenNthCalledWith(
        1,
        "social-collab:accept-invite",
        "i1",
      );
      expect(store.pendingInvites.map((i) => i.id)).toEqual(["i2"]);
      expect(store.sharedDocuments.map((d) => d.id)).toEqual(["s1"]);
    });
  });
});
