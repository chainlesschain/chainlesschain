/**
 * useWorkspaceStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Pure getters: defaultWorkspace / workspacesByType / activeWorkspaces /
 *    archivedWorkspaces / currentWorkspaceId / currentUserRole (identityStore-driven)
 *  - IPC actions (mocked window.ipc.invoke + window.electronAPI.organization):
 *    loadWorkspaces (auto-selects default) / updateWorkspace (local cache patch +
 *    currentWorkspace sync) / deleteWorkspace (archive flag + switch) / addMember
 *  - Failure + reset paths
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

// Configurable identity mock (hoisted so vi.mock factory can reference it).
const identity = vi.hoisted(() => ({ currentUserDID: null as string | null }));

vi.mock("ant-design-vue", () => ({
  message: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));
vi.mock("@/utils/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock("../identityStore", () => ({
  useIdentityStore: () => ({
    get currentUserDID() {
      return identity.currentUserDID;
    },
  }),
}));

import { useWorkspaceStore } from "../workspace";
import type { Workspace, WorkspaceMember } from "../workspace";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: "ws-1",
    name: "Workspace 1",
    org_id: "org-1",
    type: "development",
    is_default: 0,
    archived: 0,
    created_by: "did:test:creator",
    created_at: 1700000000000,
    updated_at: 1700000000000,
    ...overrides,
  };
}

function makeMember(overrides: Partial<WorkspaceMember> = {}): WorkspaceMember {
  return {
    id: "m-1",
    workspace_id: "ws-1",
    member_did: "did:test:user",
    role: "member",
    joined_at: 1700000000000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------

describe("useWorkspaceStore", () => {
  const mockInvoke = vi.fn();
  const mockGetMembers = vi.fn();
  const mockGetKnowledgeItems = vi.fn();

  beforeEach(() => {
    setActivePinia(createPinia());
    identity.currentUserDID = null;
    mockInvoke.mockReset().mockResolvedValue({ success: true });
    mockGetMembers
      .mockReset()
      .mockResolvedValue({ success: true, members: [] });
    mockGetKnowledgeItems
      .mockReset()
      .mockResolvedValue({ success: true, items: [] });
    (window as any).ipc = { invoke: mockInvoke };
    (window as any).electronAPI = {
      organization: {
        getMembers: mockGetMembers,
        getKnowledgeItems: mockGetKnowledgeItems,
      },
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  describe("Initial state", () => {
    it("starts empty with dialogs closed and loading false", () => {
      const store = useWorkspaceStore();
      expect(store.workspaces).toEqual([]);
      expect(store.currentWorkspace).toBeNull();
      expect(store.currentWorkspaceMembers).toEqual([]);
      expect(store.currentWorkspaceResources).toEqual([]);
      expect(store.loading).toBe(false);
      expect(store.createDialogVisible).toBe(false);
      expect(store.detailDialogVisible).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("getter: defaultWorkspace", () => {
    it("returns the workspace flagged is_default===1", () => {
      const store = useWorkspaceStore();
      store.workspaces = [
        makeWorkspace({ id: "a", is_default: 0 }),
        makeWorkspace({ id: "b", is_default: 1 }),
      ];
      expect(store.defaultWorkspace?.id).toBe("b");
    });

    it("is undefined when none flagged default", () => {
      const store = useWorkspaceStore();
      store.workspaces = [makeWorkspace({ id: "a", is_default: 0 })];
      expect(store.defaultWorkspace).toBeUndefined();
    });
  });

  describe("getter: workspacesByType", () => {
    it("groups by type and ignores unknown types", () => {
      const store = useWorkspaceStore();
      store.workspaces = [
        makeWorkspace({ id: "a", type: "development" }),
        makeWorkspace({ id: "b", type: "production" }),
        makeWorkspace({ id: "c", type: "development" }),
        makeWorkspace({ id: "d", type: "bogus" as any }),
      ];
      const g = store.workspacesByType;
      expect(g.development.map((w) => w.id)).toEqual(["a", "c"]);
      expect(g.production.map((w) => w.id)).toEqual(["b"]);
      expect(g.testing).toEqual([]);
      expect(g.default).toEqual([]);
    });
  });

  describe("getters: active / archived", () => {
    it("splits by archived flag", () => {
      const store = useWorkspaceStore();
      store.workspaces = [
        makeWorkspace({ id: "a", archived: 0 }),
        makeWorkspace({ id: "b", archived: 1 }),
        makeWorkspace({ id: "c", archived: 0 }),
      ];
      expect(store.activeWorkspaces.map((w) => w.id)).toEqual(["a", "c"]);
      expect(store.archivedWorkspaces.map((w) => w.id)).toEqual(["b"]);
    });
  });

  describe("getter: currentWorkspaceId", () => {
    it("is the current workspace id, or null", () => {
      const store = useWorkspaceStore();
      expect(store.currentWorkspaceId).toBeNull();
      store.currentWorkspace = makeWorkspace({ id: "ws-9" });
      expect(store.currentWorkspaceId).toBe("ws-9");
    });
  });

  describe("getter: currentUserRole", () => {
    it("null when no current workspace", () => {
      const store = useWorkspaceStore();
      store.currentWorkspaceMembers = [makeMember()];
      identity.currentUserDID = "did:test:user";
      expect(store.currentUserRole).toBeNull();
    });

    it("null when no members loaded", () => {
      const store = useWorkspaceStore();
      store.currentWorkspace = makeWorkspace();
      identity.currentUserDID = "did:test:user";
      expect(store.currentUserRole).toBeNull();
    });

    it("null when no current user DID", () => {
      const store = useWorkspaceStore();
      store.currentWorkspace = makeWorkspace();
      store.currentWorkspaceMembers = [
        makeMember({ member_did: "did:test:user" }),
      ];
      identity.currentUserDID = null;
      expect(store.currentUserRole).toBeNull();
    });

    it("null when current user is not a member", () => {
      const store = useWorkspaceStore();
      store.currentWorkspace = makeWorkspace();
      store.currentWorkspaceMembers = [makeMember({ member_did: "did:other" })];
      identity.currentUserDID = "did:test:user";
      expect(store.currentUserRole).toBeNull();
    });

    it("returns the matching member's role", () => {
      const store = useWorkspaceStore();
      store.currentWorkspace = makeWorkspace();
      store.currentWorkspaceMembers = [
        makeMember({ member_did: "did:other", role: "viewer" }),
        makeMember({ member_did: "did:test:user", role: "admin" }),
      ];
      identity.currentUserDID = "did:test:user";
      expect(store.currentUserRole).toBe("admin");
    });
  });

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  describe("loadWorkspaces", () => {
    it("sets workspaces and resets loading (no auto-select when current set)", async () => {
      const store = useWorkspaceStore();
      store.currentWorkspace = makeWorkspace({ id: "preset" }); // suppress auto-select
      const workspaces = [
        makeWorkspace({ id: "a" }),
        makeWorkspace({ id: "b" }),
      ];
      mockInvoke.mockResolvedValueOnce({ success: true, workspaces });
      await store.loadWorkspaces("org-1");
      expect(mockInvoke).toHaveBeenCalledWith("organization:workspace:list", {
        orgId: "org-1",
        includeArchived: false,
      });
      expect(store.workspaces).toEqual(workspaces);
      expect(store.loading).toBe(false);
    });

    it("auto-selects the default workspace when none is current", async () => {
      const store = useWorkspaceStore();
      const workspaces = [
        makeWorkspace({ id: "a", is_default: 0 }),
        makeWorkspace({ id: "b", is_default: 1 }),
      ];
      mockInvoke.mockResolvedValueOnce({ success: true, workspaces });
      await store.loadWorkspaces("org-1");
      expect(store.currentWorkspace?.id).toBe("b"); // default selected
    });

    it("on failure leaves workspaces empty and resets loading", async () => {
      const store = useWorkspaceStore();
      mockInvoke.mockResolvedValueOnce({ success: false, error: "nope" });
      await store.loadWorkspaces("org-1");
      expect(store.workspaces).toEqual([]);
      expect(store.loading).toBe(false);
    });
  });

  describe("updateWorkspace", () => {
    it("patches local cache + currentWorkspace on success", async () => {
      const store = useWorkspaceStore();
      const ws = makeWorkspace({ id: "ws-1", name: "Old" });
      store.workspaces = [ws];
      store.currentWorkspace = makeWorkspace({ id: "ws-1", name: "Old" });
      mockInvoke.mockResolvedValueOnce({ success: true });
      const ok = await store.updateWorkspace("ws-1", { name: "New" });
      expect(ok).toBe(true);
      expect(store.workspaces[0].name).toBe("New");
      expect(store.currentWorkspace?.name).toBe("New");
    });

    it("returns false on failure", async () => {
      const store = useWorkspaceStore();
      store.workspaces = [makeWorkspace({ id: "ws-1", name: "Old" })];
      mockInvoke.mockResolvedValueOnce({ success: false, error: "x" });
      const ok = await store.updateWorkspace("ws-1", { name: "New" });
      expect(ok).toBe(false);
      expect(store.workspaces[0].name).toBe("Old"); // unchanged
    });
  });

  describe("deleteWorkspace", () => {
    it("archives the workspace and switches away when it was current", async () => {
      const store = useWorkspaceStore();
      const def = makeWorkspace({ id: "def", is_default: 1 });
      const target = makeWorkspace({ id: "target", is_default: 0 });
      store.workspaces = [def, target];
      store.currentWorkspace = target;
      mockInvoke.mockResolvedValueOnce({ success: true });
      const ok = await store.deleteWorkspace("target");
      expect(ok).toBe(true);
      expect(store.workspaces.find((w) => w.id === "target")?.archived).toBe(1);
      // current was target → switched to default
      expect(store.currentWorkspace?.id).toBe("def");
    });
  });

  describe("addMember", () => {
    it("reloads members on success and returns true", async () => {
      const store = useWorkspaceStore();
      store.workspaces = [makeWorkspace({ id: "ws-1", org_id: "org-1" })];
      mockInvoke.mockResolvedValueOnce({ success: true }); // addMember IPC
      mockGetMembers.mockResolvedValueOnce({
        success: true,
        members: [makeMember()],
      });
      const ok = await store.addMember("ws-1", "did:test:user", "member");
      expect(ok).toBe(true);
      expect(store.currentWorkspaceMembers).toHaveLength(1);
    });

    it("returns false on failure", async () => {
      const store = useWorkspaceStore();
      mockInvoke.mockResolvedValueOnce({ success: false, error: "x" });
      expect(await store.addMember("ws-1", "did:x", "member")).toBe(false);
    });
  });

  describe("reset", () => {
    it("clears all state", () => {
      const store = useWorkspaceStore();
      store.workspaces = [makeWorkspace()];
      store.currentWorkspace = makeWorkspace();
      store.currentWorkspaceMembers = [makeMember()];
      store.loading = true;
      store.createDialogVisible = true;
      store.reset();
      expect(store.workspaces).toEqual([]);
      expect(store.currentWorkspace).toBeNull();
      expect(store.currentWorkspaceMembers).toEqual([]);
      expect(store.loading).toBe(false);
      expect(store.createDialogVisible).toBe(false);
    });
  });
});
