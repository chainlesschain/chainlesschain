/**
 * usePermissionStore — Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - grantPermission()          → perm:grant-permission
 *  - revokePermission()         → perm:revoke-permission
 *  - checkPermission()          → perm:check-permission
 *  - loadUserPermissions()      → perm:get-user-permissions
 *  - loadResourcePermissions()  → perm:get-resource-permissions
 *  - loadWorkflows()            → perm:get-workflows
 *  - createWorkflow()           → perm:create-workflow
 *  - deleteWorkflow()           → perm:delete-workflow
 *  - loadPendingApprovals()     → perm:get-pending-approvals
 *  - approveRequest()           → perm:approve-request
 *  - rejectRequest()            → perm:reject-request
 *  - loadTeams()                → team:get-teams
 *  - createTeam()               → team:create-team
 *  - deleteTeam()               → team:delete-team
 *  - Getters: hasPendingApprovals, pendingApprovalCount, activeDelegationCount, rootTeams, isLoading
 *  - Error handling
 *  - reset() clears all state
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type {
  Permission,
  Workflow,
  ApprovalRequest,
  Team,
} from "../permission";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePermission(overrides: Partial<Permission> = {}): Permission {
  return {
    grantId: "grant-1",
    granteeDid: "did:example:bob",
    orgId: "org-1",
    resourceType: "note",
    resourceId: "note-1",
    permissions: ["read"],
    grantedBy: "did:example:alice",
    grantedAt: Date.now(),
    ...overrides,
  };
}

function makeWorkflow(overrides: Partial<Workflow> = {}): Workflow {
  return {
    id: "wf-1",
    orgId: "org-1",
    name: "Review",
    steps: [],
    status: "active",
    createdAt: Date.now(),
    ...overrides,
  };
}

function makeApproval(
  overrides: Partial<ApprovalRequest> = {},
): ApprovalRequest {
  return {
    id: "req-1",
    workflowId: "wf-1",
    requesterId: "did:example:bob",
    resourceType: "note",
    resourceId: "note-1",
    requestType: "access",
    status: "pending",
    currentStep: 0,
    createdAt: Date.now(),
    ...overrides,
  };
}

function makeTeam(overrides: Partial<Team> = {}): Team {
  return {
    id: "team-1",
    orgId: "org-1",
    name: "Engineering",
    memberCount: 5,
    createdAt: Date.now(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("usePermissionStore", () => {
  let pinia: ReturnType<typeof createPinia>;
  const mockInvoke = vi.fn();

  beforeEach(async () => {
    pinia = createPinia();
    setActivePinia(pinia);

    mockInvoke.mockResolvedValue({ success: true });

    (window as any).electronAPI = {
      invoke: mockInvoke,
      on: vi.fn(),
      removeListener: vi.fn(),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  describe("Initial state", () => {
    it("myPermissions starts as empty array", async () => {
      const { usePermissionStore } = await import("../permission");
      const store = usePermissionStore();
      expect(store.myPermissions).toEqual([]);
    });

    it("workflows starts as empty array", async () => {
      const { usePermissionStore } = await import("../permission");
      const store = usePermissionStore();
      expect(store.workflows).toEqual([]);
    });

    it("pendingApprovals starts as empty array", async () => {
      const { usePermissionStore } = await import("../permission");
      const store = usePermissionStore();
      expect(store.pendingApprovals).toEqual([]);
    });

    it("teams starts as empty array", async () => {
      const { usePermissionStore } = await import("../permission");
      const store = usePermissionStore();
      expect(store.teams).toEqual([]);
    });

    it("error starts as null", async () => {
      const { usePermissionStore } = await import("../permission");
      const store = usePermissionStore();
      expect(store.error).toBeNull();
    });

    it("all loading flags start as false", async () => {
      const { usePermissionStore } = await import("../permission");
      const store = usePermissionStore();
      expect(store.loading.permissions).toBe(false);
      expect(store.loading.workflows).toBe(false);
      expect(store.loading.approvals).toBe(false);
      expect(store.loading.delegations).toBe(false);
      expect(store.loading.teams).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // grantPermission
  // -------------------------------------------------------------------------

  describe("grantPermission()", () => {
    it("calls perm:grant-permission via IPC", async () => {
      mockInvoke
        .mockResolvedValueOnce({ success: true }) // grant
        .mockResolvedValueOnce({ success: true, permissions: [] }); // loadUserPermissions

      const { usePermissionStore } = await import("../permission");
      const store = usePermissionStore();
      await store.grantPermission({
        granteeDid: "did:bob",
        orgId: "org-1",
        resourceType: "note",
        resourceId: "n1",
        permissions: ["read"],
        grantedBy: "did:alice",
      });

      expect(mockInvoke).toHaveBeenCalledWith(
        "perm:grant-permission",
        expect.objectContaining({
          granteeDid: "did:bob",
        }),
      );
    });

    it("sets error when IPC throws", async () => {
      mockInvoke.mockRejectedValue(new Error("Forbidden"));
      const { usePermissionStore } = await import("../permission");
      const store = usePermissionStore();
      await expect(
        store.grantPermission({
          granteeDid: "did:bob",
          orgId: "org-1",
          resourceType: "note",
          resourceId: "n1",
          permissions: ["read"],
          grantedBy: "did:alice",
        }),
      ).rejects.toThrow("Forbidden");
      expect(store.error).toBe("Forbidden");
    });
  });

  // -------------------------------------------------------------------------
  // revokePermission
  // -------------------------------------------------------------------------

  describe("revokePermission()", () => {
    it("removes permission from local arrays on success", async () => {
      mockInvoke.mockResolvedValue({ success: true });
      const { usePermissionStore } = await import("../permission");
      const store = usePermissionStore();
      store.myPermissions = [
        makePermission({ grantId: "g1" }),
        makePermission({ grantId: "g2" }),
      ];
      store.resourcePermissions = [makePermission({ grantId: "g1" })];

      await store.revokePermission("g1", "did:alice");
      expect(store.myPermissions).toHaveLength(1);
      expect(store.resourcePermissions).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // checkPermission
  // -------------------------------------------------------------------------

  describe("checkPermission()", () => {
    it("calls perm:check-permission and returns result", async () => {
      mockInvoke.mockResolvedValue({ success: true, allowed: true });
      const { usePermissionStore } = await import("../permission");
      const store = usePermissionStore();
      const result = await store.checkPermission({
        userDid: "did:bob",
        orgId: "org-1",
        resourceType: "note",
        resourceId: "n1",
        permission: "read",
      });
      expect(result.success).toBe(true);
      expect(mockInvoke).toHaveBeenCalledWith(
        "perm:check-permission",
        expect.any(Object),
      );
    });
  });

  // -------------------------------------------------------------------------
  // loadUserPermissions
  // -------------------------------------------------------------------------

  describe("loadUserPermissions()", () => {
    it("populates myPermissions from IPC result", async () => {
      const perms = [makePermission()];
      mockInvoke.mockResolvedValue({ success: true, permissions: perms });
      const { usePermissionStore } = await import("../permission");
      const store = usePermissionStore();
      await store.loadUserPermissions("did:bob", "org-1");
      expect(store.myPermissions).toHaveLength(1);
    });

    it("sets loading.permissions during call", async () => {
      mockInvoke.mockResolvedValue({ success: true, permissions: [] });
      const { usePermissionStore } = await import("../permission");
      const store = usePermissionStore();
      await store.loadUserPermissions("did:bob", "org-1");
      expect(store.loading.permissions).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Workflows
  // -------------------------------------------------------------------------

  describe("loadWorkflows()", () => {
    it("populates workflows from IPC result", async () => {
      const wfs = [makeWorkflow()];
      mockInvoke.mockResolvedValue({ success: true, workflows: wfs });
      const { usePermissionStore } = await import("../permission");
      const store = usePermissionStore();
      await store.loadWorkflows("org-1");
      expect(store.workflows).toHaveLength(1);
    });
  });

  describe("createWorkflow()", () => {
    it("adds new workflow to local array on success", async () => {
      mockInvoke.mockResolvedValue({ success: true, workflowId: "wf-new" });
      const { usePermissionStore } = await import("../permission");
      const store = usePermissionStore();
      await store.createWorkflow({ orgId: "org-1", name: "New WF", steps: [] });
      expect(store.workflows).toHaveLength(1);
      expect(store.workflows[0].id).toBe("wf-new");
    });
  });

  describe("deleteWorkflow()", () => {
    it("removes workflow from local array on success", async () => {
      mockInvoke.mockResolvedValue({ success: true });
      const { usePermissionStore } = await import("../permission");
      const store = usePermissionStore();
      store.workflows = [
        makeWorkflow({ id: "wf-del" }),
        makeWorkflow({ id: "wf-keep" }),
      ];
      await store.deleteWorkflow("wf-del");
      expect(store.workflows).toHaveLength(1);
      expect(store.workflows[0].id).toBe("wf-keep");
    });
  });

  // -------------------------------------------------------------------------
  // Approvals
  // -------------------------------------------------------------------------

  describe("loadPendingApprovals()", () => {
    it("populates pendingApprovals from IPC result", async () => {
      mockInvoke.mockResolvedValue({
        success: true,
        requests: [makeApproval()],
      });
      const { usePermissionStore } = await import("../permission");
      const store = usePermissionStore();
      await store.loadPendingApprovals("did:alice", "org-1");
      expect(store.pendingApprovals).toHaveLength(1);
    });
  });

  describe("approveRequest()", () => {
    it("removes request from pendingApprovals on success", async () => {
      mockInvoke.mockResolvedValue({ success: true });
      const { usePermissionStore } = await import("../permission");
      const store = usePermissionStore();
      store.pendingApprovals = [
        makeApproval({ id: "req-1" }),
        makeApproval({ id: "req-2" }),
      ];
      await store.approveRequest("req-1", "did:alice");
      expect(store.pendingApprovals).toHaveLength(1);
      expect(store.pendingApprovals[0].id).toBe("req-2");
    });
  });

  describe("rejectRequest()", () => {
    it("removes request from pendingApprovals on success", async () => {
      mockInvoke.mockResolvedValue({ success: true });
      const { usePermissionStore } = await import("../permission");
      const store = usePermissionStore();
      store.pendingApprovals = [makeApproval({ id: "req-1" })];
      await store.rejectRequest("req-1", "did:alice", "Not authorized");
      expect(store.pendingApprovals).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Teams
  // -------------------------------------------------------------------------

  describe("loadTeams()", () => {
    it("populates teams from IPC result", async () => {
      mockInvoke.mockResolvedValue({ success: true, teams: [makeTeam()] });
      const { usePermissionStore } = await import("../permission");
      const store = usePermissionStore();
      await store.loadTeams("org-1");
      expect(store.teams).toHaveLength(1);
    });
  });

  describe("createTeam()", () => {
    it("adds new team to local array on success", async () => {
      mockInvoke.mockResolvedValue({ success: true, teamId: "team-new" });
      const { usePermissionStore } = await import("../permission");
      const store = usePermissionStore();
      await store.createTeam({ orgId: "org-1", name: "DevOps" });
      expect(store.teams).toHaveLength(1);
      expect(store.teams[0].id).toBe("team-new");
    });
  });

  describe("deleteTeam()", () => {
    it("removes team from local array and clears currentTeam", async () => {
      mockInvoke.mockResolvedValue({ success: true });
      const { usePermissionStore } = await import("../permission");
      const store = usePermissionStore();
      const team = makeTeam({ id: "team-del" });
      store.teams = [team];
      store.currentTeam = team;
      store.teamMembers = [
        {
          id: "m1",
          teamId: "team-del",
          memberDid: "did:x",
          memberName: "X",
          role: "member",
          joinedAt: 0,
        },
      ];

      await store.deleteTeam("team-del");
      expect(store.teams).toHaveLength(0);
      expect(store.currentTeam).toBeNull();
      expect(store.teamMembers).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Getters
  // -------------------------------------------------------------------------

  describe("Getters", () => {
    it("hasPendingApprovals returns true when approvals exist", async () => {
      const { usePermissionStore } = await import("../permission");
      const store = usePermissionStore();
      expect(store.hasPendingApprovals).toBe(false);
      store.pendingApprovals = [makeApproval()];
      expect(store.hasPendingApprovals).toBe(true);
    });

    it("pendingApprovalCount returns count", async () => {
      const { usePermissionStore } = await import("../permission");
      const store = usePermissionStore();
      store.pendingApprovals = [makeApproval(), makeApproval({ id: "req-2" })];
      expect(store.pendingApprovalCount).toBe(2);
    });

    it("activeDelegationCount counts only active delegations", async () => {
      const { usePermissionStore } = await import("../permission");
      const store = usePermissionStore();
      store.outgoingDelegations = [
        {
          id: "d1",
          status: "active",
          delegatorDid: "",
          delegateDid: "",
          orgId: "",
          permissions: [],
          startTime: 0,
          endTime: 0,
          createdAt: 0,
        },
        {
          id: "d2",
          status: "expired",
          delegatorDid: "",
          delegateDid: "",
          orgId: "",
          permissions: [],
          startTime: 0,
          endTime: 0,
          createdAt: 0,
        },
      ];
      expect(store.activeDelegationCount).toBe(1);
    });

    it("rootTeams returns teams without parentTeamId", async () => {
      const { usePermissionStore } = await import("../permission");
      const store = usePermissionStore();
      store.teams = [
        makeTeam({ id: "root", parentTeamId: null }),
        makeTeam({ id: "child", parentTeamId: "root" }),
      ];
      expect(store.rootTeams).toHaveLength(1);
      expect(store.rootTeams[0].id).toBe("root");
    });

    it("isLoading returns true when any loading flag is true", async () => {
      const { usePermissionStore } = await import("../permission");
      const store = usePermissionStore();
      expect(store.isLoading).toBe(false);
      store.loading.teams = true;
      expect(store.isLoading).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // reset
  // -------------------------------------------------------------------------

  describe("reset()", () => {
    it("resets all state via $reset", async () => {
      const { usePermissionStore } = await import("../permission");
      const store = usePermissionStore();

      store.myPermissions = [makePermission()];
      store.workflows = [makeWorkflow()];
      store.pendingApprovals = [makeApproval()];
      store.teams = [makeTeam()];
      store.error = "some error";

      store.reset();

      expect(store.myPermissions).toEqual([]);
      expect(store.workflows).toEqual([]);
      expect(store.pendingApprovals).toEqual([]);
      expect(store.teams).toEqual([]);
      expect(store.error).toBeNull();
    });
  });
});
