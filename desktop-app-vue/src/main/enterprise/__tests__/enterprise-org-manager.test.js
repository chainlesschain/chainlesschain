/**
 * EnterpriseOrgManager Unit Tests
 *
 * Covers:
 * - initialize() stores dependency refs
 * - createDepartment() inserts into DB and returns dept object
 * - createDepartment() handles UNIQUE constraint error
 * - getDepartments() queries DB for departments
 * - getOrgHierarchy() builds tree from flat list
 * - moveDepartment() validates circular reference
 * - moveDepartment() rejects circular reference
 * - moveDepartment() rejects moving dept to itself
 * - getOrgDashboardStats() returns member/team/dept counts
 * - requestMemberJoin() without workflow: adds member directly
 * - requestMemberJoin() with workflow: submits approval request
 * - requestMemberJoin() skips already-existing member
 * - bulkMemberImport() processes multiple members
 * - bulkMemberImport() handles partial failures gracefully
 * - _buildTree() correctly builds nested hierarchy from flat array
 * - deleteDepartment() with children returns error
 * - deleteDepartment() returns error when dept not found
 * - updateDepartment() updates name/description
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("uuid", () => ({ v4: vi.fn(() => "test-uuid-1234") }));

const { EnterpriseOrgManager } = require("../enterprise-org-manager.js");

// Helper: build a mock db.prepare() that returns a statement-like object
function makeMockDb(overrides = {}) {
  const makeStmt = (rowOrRows) => ({
    run: vi.fn(() => ({ changes: 1 })),
    get: vi.fn(() =>
      rowOrRows !== undefined && !Array.isArray(rowOrRows) ? rowOrRows : null,
    ),
    all: vi.fn(() => (Array.isArray(rowOrRows) ? rowOrRows : [])),
  });

  const db = {
    _stmtOverrides: overrides,
    prepare: vi.fn(function (sql) {
      // Allow per-SQL overrides
      for (const [key, result] of Object.entries(this._stmtOverrides)) {
        if (sql.includes(key)) {
          return {
            run: vi.fn(() => ({ changes: 1 })),
            get: vi.fn(() => (!Array.isArray(result) ? result : null)),
            all: vi.fn(() => (Array.isArray(result) ? result : [])),
          };
        }
      }
      return makeStmt(null);
    }),
    run: vi.fn(),
    get: vi.fn(),
    all: vi.fn(() => []),
  };
  return db;
}

describe("EnterpriseOrgManager", () => {
  let manager;
  let mockDb;
  let mockDbWrapper;
  let mockTeamManager;
  let mockApprovalManager;
  let mockOrgManager;

  beforeEach(() => {
    mockDb = makeMockDb();
    mockDbWrapper = { getDatabase: vi.fn(() => mockDb) };
    mockTeamManager = {
      addMember: vi.fn().mockResolvedValue({ id: "member-id" }),
    };
    mockApprovalManager = {
      submitApproval: vi
        .fn()
        .mockResolvedValue({ requestId: "approval-req-1" }),
    };
    mockOrgManager = {
      getOrganization: vi
        .fn()
        .mockResolvedValue({ id: "org-1", name: "Test Org" }),
      addMember: vi.fn().mockResolvedValue({ id: "member-direct-id" }),
    };

    manager = new EnterpriseOrgManager();
    manager.initialize({
      database: mockDbWrapper,
      teamManager: mockTeamManager,
      approvalManager: mockApprovalManager,
      organizationManager: mockOrgManager,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ----------------------------------------------------------------
  // initialize()
  // ----------------------------------------------------------------

  describe("initialize()", () => {
    it("stores all dependency references", () => {
      expect(manager.database).toBe(mockDbWrapper);
      expect(manager.teamManager).toBe(mockTeamManager);
      expect(manager.approvalManager).toBe(mockApprovalManager);
      expect(manager.organizationManager).toBe(mockOrgManager);
      expect(manager.initialized).toBe(true);
    });

    it("throws when methods are called before initialize()", () => {
      const uninitializedManager = new EnterpriseOrgManager();
      expect(() => uninitializedManager._ensureInitialized()).toThrow(
        "EnterpriseOrgManager is not initialized",
      );
    });
  });

  // ----------------------------------------------------------------
  // createDepartment()
  // ----------------------------------------------------------------

  describe("createDepartment()", () => {
    it("inserts into DB via prepare().run() and returns dept object", async () => {
      const dept = await manager.createDepartment("org-1", {
        name: "Engineering",
        description: "Eng dept",
      });

      expect(mockDbWrapper.getDatabase).toHaveBeenCalled();
      expect(mockDb.prepare).toHaveBeenCalled();
      // uuid.v4() is bound at CJS require time; assert shape instead of mock value
      expect(dept.id).toEqual(expect.any(String));
      expect(dept.id.length).toBeGreaterThan(0);
      expect(dept.name).toBe("Engineering");
      expect(dept.description).toBe("Eng dept");
      expect(dept.orgId).toBe("org-1");
      expect(dept.teamType).toBe("department");
    });

    it("adds lead as team member when leadDid is provided", async () => {
      await manager.createDepartment("org-1", {
        name: "Design",
        leadDid: "did:lead:123",
        leadName: "Lead Designer",
      });

      expect(mockTeamManager.addMember).toHaveBeenCalledWith(
        expect.any(String), // dept id (uuid bound at require time, not interceptable)
        "did:lead:123",
        "Lead Designer",
        "lead",
      );
    });

    it("does not call teamManager.addMember when no leadDid", async () => {
      await manager.createDepartment("org-1", { name: "HR" });
      expect(mockTeamManager.addMember).not.toHaveBeenCalled();
    });

    it("memberCount is 1 when leadDid is specified", async () => {
      const dept = await manager.createDepartment("org-1", {
        name: "Ops",
        leadDid: "did:lead:456",
        leadName: "Ops Lead",
      });
      expect(dept.memberCount).toBe(1);
    });

    it("memberCount is 0 when no leadDid", async () => {
      const dept = await manager.createDepartment("org-1", { name: "Finance" });
      expect(dept.memberCount).toBe(0);
    });

    it("emits department-created event", async () => {
      const listener = vi.fn();
      manager.on("department-created", listener);

      await manager.createDepartment("org-1", { name: "Marketing" });

      expect(listener).toHaveBeenCalledOnce();
      expect(listener.mock.calls[0][0].name).toBe("Marketing");
    });

    it("wraps UNIQUE constraint error with friendly message", async () => {
      const mockStmt = {
        run: vi.fn(() => {
          throw new Error("UNIQUE constraint failed: org_teams.name");
        }),
        get: vi.fn(),
        all: vi.fn(() => []),
      };
      mockDb.prepare = vi.fn(() => mockStmt);

      await expect(
        manager.createDepartment("org-1", { name: "Duplicate Dept" }),
      ).rejects.toThrow("already exists");
    });
  });

  // ----------------------------------------------------------------
  // updateDepartment()
  // ----------------------------------------------------------------

  describe("updateDepartment()", () => {
    it("builds UPDATE SQL with provided fields and executes it", async () => {
      const result = await manager.updateDepartment("dept-1", {
        name: "Updated Name",
        description: "Updated description",
      });

      expect(result).toEqual({ success: true });
      expect(mockDb.prepare).toHaveBeenCalled();
    });

    it("returns { success: true } immediately when no fields provided", async () => {
      const result = await manager.updateDepartment("dept-1", {});
      expect(result).toEqual({ success: true });
    });

    it("emits department-updated event", async () => {
      const listener = vi.fn();
      manager.on("department-updated", listener);

      await manager.updateDepartment("dept-99", { name: "New Name" });

      expect(listener).toHaveBeenCalledOnce();
    });
  });

  // ----------------------------------------------------------------
  // deleteDepartment()
  // ----------------------------------------------------------------

  describe("deleteDepartment()", () => {
    it("returns DEPARTMENT_NOT_FOUND when dept does not exist", async () => {
      // dept get returns null
      const db = makeMockDb({ "org_teams WHERE id": null });
      mockDbWrapper.getDatabase = vi.fn(() => db);

      const result = await manager.deleteDepartment("nonexistent-id");
      expect(result.success).toBe(false);
      expect(result.error).toBe("DEPARTMENT_NOT_FOUND");
    });

    it("returns HAS_CHILDREN when dept has child teams", async () => {
      // First prepare() returns the dept, second returns child count > 0
      let callCount = 0;
      mockDb.prepare = vi.fn(() => {
        callCount++;
        if (callCount === 1) {
          return {
            run: vi.fn(),
            get: vi.fn(() => ({ id: "dept-1", name: "Dept" })),
            all: vi.fn(() => []),
          };
        }
        return {
          run: vi.fn(),
          get: vi.fn(() => ({ count: 2 })),
          all: vi.fn(() => []),
        };
      });

      const result = await manager.deleteDepartment("dept-1");
      expect(result.success).toBe(false);
      expect(result.error).toBe("HAS_CHILDREN");
    });

    it("deletes dept and returns success when no children", async () => {
      let callCount = 0;
      mockDb.prepare = vi.fn(() => {
        callCount++;
        if (callCount === 1) {
          return {
            run: vi.fn(),
            get: vi.fn(() => ({ id: "dept-1", name: "Dept" })),
            all: vi.fn(() => []),
          };
        }
        // count = 0, no children
        return {
          run: vi.fn(() => ({ changes: 1 })),
          get: vi.fn(() => ({ count: 0 })),
          all: vi.fn(() => []),
        };
      });

      const result = await manager.deleteDepartment("dept-1");
      expect(result.success).toBe(true);
    });

    it("emits department-deleted event on success", async () => {
      const listener = vi.fn();
      manager.on("department-deleted", listener);

      let callCount = 0;
      mockDb.prepare = vi.fn(() => {
        callCount++;
        if (callCount === 1) {
          return {
            run: vi.fn(),
            get: vi.fn(() => ({ id: "dept-1" })),
            all: vi.fn(() => []),
          };
        }
        return {
          run: vi.fn(() => ({ changes: 1 })),
          get: vi.fn(() => ({ count: 0 })),
          all: vi.fn(() => []),
        };
      });

      await manager.deleteDepartment("dept-1");
      expect(listener).toHaveBeenCalledOnce();
    });
  });

  // ----------------------------------------------------------------
  // getDepartments()
  // ----------------------------------------------------------------

  describe("getDepartments()", () => {
    it("queries DB and returns mapped department rows", async () => {
      const fakeRows = [
        {
          id: "d1",
          org_id: "org-1",
          name: "Sales",
          description: "Sales dept",
          parent_team_id: null,
          lead_did: null,
          lead_name: null,
          settings: '{"team_type":"department"}',
          created_at: 1000,
          updated_at: 1000,
        },
      ];

      // prepare for getDepartments query
      let callCount = 0;
      mockDb.prepare = vi.fn(() => {
        callCount++;
        if (callCount === 1) {
          return { run: vi.fn(), get: vi.fn(), all: vi.fn(() => fakeRows) };
        }
        // member count query
        return {
          run: vi.fn(),
          get: vi.fn(() => ({ count: 3 })),
          all: vi.fn(() => []),
        };
      });

      const departments = await manager.getDepartments("org-1");

      expect(Array.isArray(departments)).toBe(true);
      expect(departments.length).toBe(1);
      expect(departments[0].name).toBe("Sales");
      expect(departments[0].teamType).toBe("department");
    });
  });

  // ----------------------------------------------------------------
  // getOrgHierarchy()
  // ----------------------------------------------------------------

  describe("getOrgHierarchy()", () => {
    it("returns { org, hierarchy } with nested tree", async () => {
      const fakeTeams = [
        {
          id: "root-dept",
          org_id: "org-1",
          name: "Root",
          description: "",
          parent_team_id: null,
          lead_did: null,
          lead_name: null,
          settings: '{"team_type":"department"}',
          created_at: 1000,
          updated_at: 1000,
        },
        {
          id: "child-dept",
          org_id: "org-1",
          name: "Child",
          description: "",
          parent_team_id: "root-dept",
          lead_did: null,
          lead_name: null,
          settings: '{"team_type":"department"}',
          created_at: 1000,
          updated_at: 1000,
        },
      ];

      let callCount = 0;
      mockDb.prepare = vi.fn(() => {
        callCount++;
        if (callCount === 1) {
          return { run: vi.fn(), get: vi.fn(), all: vi.fn(() => fakeTeams) };
        }
        return {
          run: vi.fn(),
          get: vi.fn(() => ({ count: 0 })),
          all: vi.fn(() => []),
        };
      });

      const { org, hierarchy } = await manager.getOrgHierarchy("org-1");

      expect(org).toBeDefined();
      expect(Array.isArray(hierarchy)).toBe(true);
      // root dept should be at top level
      expect(hierarchy.length).toBe(1);
      expect(hierarchy[0].name).toBe("Root");
      // child should be nested
      expect(hierarchy[0].children.length).toBe(1);
      expect(hierarchy[0].children[0].name).toBe("Child");
    });
  });

  // ----------------------------------------------------------------
  // _buildTree()
  // ----------------------------------------------------------------

  describe("_buildTree()", () => {
    it("returns root-level items when parentId is null", () => {
      const items = [
        { id: "a", parentDeptId: null },
        { id: "b", parentDeptId: "a" },
        { id: "c", parentDeptId: null },
      ];
      const tree = manager._buildTree(items, null);
      expect(tree.length).toBe(2);
      expect(tree.map((t) => t.id)).toContain("a");
      expect(tree.map((t) => t.id)).toContain("c");
    });

    it("nests children under their parent", () => {
      const items = [
        { id: "parent", parentDeptId: null },
        { id: "child1", parentDeptId: "parent" },
        { id: "child2", parentDeptId: "parent" },
      ];
      const tree = manager._buildTree(items, null);
      const parent = tree.find((t) => t.id === "parent");
      expect(parent.children.length).toBe(2);
    });

    it("produces empty children array for leaf nodes", () => {
      const items = [{ id: "leaf", parentDeptId: null }];
      const tree = manager._buildTree(items, null);
      expect(tree[0].children).toEqual([]);
    });
  });

  // ----------------------------------------------------------------
  // moveDepartment()
  // ----------------------------------------------------------------

  describe("moveDepartment()", () => {
    it("returns DEPARTMENT_NOT_FOUND when dept does not exist", async () => {
      mockDb.prepare = vi.fn(() => ({
        run: vi.fn(),
        get: vi.fn(() => null),
        all: vi.fn(() => []),
      }));

      const result = await manager.moveDepartment("nonexistent", "parent-1");
      expect(result.success).toBe(false);
      expect(result.error).toBe("DEPARTMENT_NOT_FOUND");
    });

    it("rejects when moving dept to itself", async () => {
      mockDb.prepare = vi.fn(() => ({
        run: vi.fn(),
        get: vi.fn(() => ({ id: "dept-1", name: "Dept" })),
        all: vi.fn(() => []),
      }));

      const result = await manager.moveDepartment("dept-1", "dept-1");
      expect(result.success).toBe(false);
      expect(result.error).toBe("CIRCULAR_REFERENCE");
    });

    it("detects circular reference when ancestor is the dept itself", async () => {
      // Simulate: dept-1 -> dept-2, moving dept-2 under dept-1's child would
      // create a cycle. We fake: newParentId = dept-2, dept-2's parent is dept-1.
      let callCount = 0;
      mockDb.prepare = vi.fn(() => {
        callCount++;
        if (callCount === 1) {
          // dept exists
          return {
            run: vi.fn(),
            get: vi.fn(() => ({ id: "dept-1" })),
            all: vi.fn(() => []),
          };
        }
        // Walk up: newParentId (dept-2) -> parent_team_id = dept-1 (same as deptId)
        return {
          run: vi.fn(),
          get: vi.fn(() => ({ parent_team_id: "dept-1" })),
          all: vi.fn(() => []),
        };
      });

      const result = await manager.moveDepartment("dept-1", "dept-2");
      expect(result.success).toBe(false);
      expect(result.error).toBe("CIRCULAR_REFERENCE");
    });

    it("updates parent and returns success on valid move", async () => {
      let callCount = 0;
      mockDb.prepare = vi.fn(() => {
        callCount++;
        if (callCount === 1) {
          return {
            run: vi.fn(),
            get: vi.fn(() => ({ id: "dept-1" })),
            all: vi.fn(() => []),
          };
        }
        // new parent has no ancestry linking back to dept-1
        return {
          run: vi.fn(() => ({ changes: 1 })),
          get: vi.fn(() => ({ parent_team_id: null })),
          all: vi.fn(() => []),
        };
      });

      const result = await manager.moveDepartment("dept-1", "unrelated-parent");
      expect(result.success).toBe(true);
    });
  });

  // ----------------------------------------------------------------
  // getOrgDashboardStats()
  // ----------------------------------------------------------------

  describe("getOrgDashboardStats()", () => {
    it("returns memberCount, teamCount, departmentCount, pendingApprovals", async () => {
      let callCount = 0;
      mockDb.prepare = vi.fn(() => {
        callCount++;
        const counts = [10, 5, 3, 2]; // member, team, dept, approvals
        const count = counts[callCount - 1] ?? 0;
        return {
          run: vi.fn(),
          get: vi.fn(() => ({ count })),
          all: vi.fn(() => []),
        };
      });

      const stats = await manager.getOrgDashboardStats("org-1");

      expect(typeof stats.memberCount).toBe("number");
      expect(typeof stats.teamCount).toBe("number");
      expect(typeof stats.departmentCount).toBe("number");
      expect(typeof stats.pendingApprovals).toBe("number");
      expect(Array.isArray(stats.recentActivity)).toBe(true);
    });

    it("handles missing organization_activity_log table gracefully", async () => {
      let callCount = 0;
      mockDb.prepare = vi.fn(() => {
        callCount++;
        if (callCount <= 4) {
          return {
            run: vi.fn(),
            get: vi.fn(() => ({ count: 0 })),
            all: vi.fn(() => []),
          };
        }
        // activity log table query throws
        return {
          run: vi.fn(),
          get: vi.fn(() => {
            throw new Error("no such table: organization_activity_log");
          }),
          all: vi.fn(() => {
            throw new Error("no such table: organization_activity_log");
          }),
        };
      });

      const stats = await manager.getOrgDashboardStats("org-1");
      expect(stats.recentActivity).toEqual([]);
    });
  });

  // ----------------------------------------------------------------
  // requestMemberJoin()
  // ----------------------------------------------------------------

  describe("requestMemberJoin()", () => {
    it("skips when member already exists in organization", async () => {
      mockDb.prepare = vi.fn(() => ({
        run: vi.fn(),
        get: vi.fn(() => ({ id: "existing-member" })),
        all: vi.fn(() => []),
      }));

      const result = await manager.requestMemberJoin(
        "org-1",
        "did:existing",
        "member",
        "did:requester",
      );
      expect(result.skipped).toBe(true);
      expect(result.reason).toBe("ALREADY_MEMBER");
    });

    it("adds member directly when no approval workflow exists", async () => {
      let callCount = 0;
      mockDb.prepare = vi.fn(() => {
        callCount++;
        if (callCount === 1) {
          // existing member check: not found
          return { run: vi.fn(), get: vi.fn(() => null), all: vi.fn(() => []) };
        }
        // workflow check: not found
        return { run: vi.fn(), get: vi.fn(() => null), all: vi.fn(() => []) };
      });

      const result = await manager.requestMemberJoin(
        "org-1",
        "did:new",
        "member",
        "did:requester",
      );

      expect(mockOrgManager.addMember).toHaveBeenCalled();
      expect(result.needsApproval).toBe(false);
      expect(result.memberId).toBe("did:new");
    });

    it("submits approval when workflow exists", async () => {
      let callCount = 0;
      mockDb.prepare = vi.fn(() => {
        callCount++;
        if (callCount === 1) {
          return { run: vi.fn(), get: vi.fn(() => null), all: vi.fn(() => []) };
        }
        // workflow found
        return {
          run: vi.fn(),
          get: vi.fn(() => ({
            id: "wf-1",
            org_id: "org-1",
            trigger_resource_type: "member",
          })),
          all: vi.fn(() => []),
        };
      });

      const result = await manager.requestMemberJoin(
        "org-1",
        "did:approvalNeeded",
        "admin",
        "did:boss",
      );

      expect(mockApprovalManager.submitApproval).toHaveBeenCalled();
      expect(result.needsApproval).toBe(true);
      expect(result.requestId).toBe("approval-req-1");
    });
  });

  // ----------------------------------------------------------------
  // bulkMemberImport()
  // ----------------------------------------------------------------

  describe("bulkMemberImport()", () => {
    it("processes multiple members and returns import counts", async () => {
      // All members will go through requestMemberJoin path
      mockDb.prepare = vi.fn(() => ({
        run: vi.fn(),
        get: vi.fn(() => null), // not existing, no workflow
        all: vi.fn(() => []),
      }));

      const members = [
        { did: "did:user1", name: "User One", role: "member" },
        { did: "did:user2", name: "User Two", role: "admin" },
      ];

      const result = await manager.bulkMemberImport("org-1", members);

      expect(
        result.imported.length + result.skipped.length + result.failed.length,
      ).toBe(2);
      expect(Array.isArray(result.imported)).toBe(true);
      expect(Array.isArray(result.failed)).toBe(true);
      expect(Array.isArray(result.skipped)).toBe(true);
    });

    it("marks member with missing DID as failed", async () => {
      const members = [{ name: "No DID User", role: "member" }]; // no did field

      const result = await manager.bulkMemberImport("org-1", members);

      expect(result.failed.length).toBe(1);
      expect(result.failed[0].error).toBe("Missing DID");
    });

    it("handles partial failure gracefully — continues after individual error", async () => {
      let callCount = 0;
      mockDb.prepare = vi.fn(() => {
        callCount++;
        if (callCount <= 2) {
          return { run: vi.fn(), get: vi.fn(() => null), all: vi.fn(() => []) };
        }
        // Third member causes DB error
        return {
          run: vi.fn(() => {
            throw new Error("DB write error");
          }),
          get: vi.fn(() => {
            throw new Error("DB read error");
          }),
          all: vi.fn(() => []),
        };
      });

      mockOrgManager.addMember
        .mockResolvedValueOnce({ id: "m1" })
        .mockRejectedValueOnce(new Error("Failed to add"));

      const members = [
        { did: "did:success", name: "Success", role: "member" },
        { did: "did:fail", name: "Fail", role: "member" },
      ];

      // Should not throw even if individual member fails
      const result = await manager.bulkMemberImport("org-1", members);
      expect(result).toBeDefined();
      expect(typeof result.imported).toBe("object");
    });

    it("adds member to team when teamId specified and no approval needed", async () => {
      mockDb.prepare = vi.fn(() => ({
        run: vi.fn(),
        get: vi.fn(() => null),
        all: vi.fn(() => []),
      }));

      const members = [
        {
          did: "did:withteam",
          name: "Team Member",
          role: "member",
          teamId: "team-42",
        },
      ];

      await manager.bulkMemberImport("org-1", members);

      expect(mockTeamManager.addMember).toHaveBeenCalledWith(
        "team-42",
        "did:withteam",
        "Team Member",
        "member",
      );
    });
  });
});
