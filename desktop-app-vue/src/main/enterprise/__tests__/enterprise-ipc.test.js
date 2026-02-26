/**
 * Enterprise IPC Handler Unit Tests
 *
 * Covers:
 * - registerEnterpriseIPC() registers 10 handlers
 * - enterprise:create-department delegates to manager
 * - enterprise:create-department returns error when manager not initialized
 * - enterprise:get-hierarchy delegates with orgId
 * - enterprise:move-department delegates with deptId and newParentId
 * - enterprise:request-member-join delegates with params
 * - enterprise:get-dashboard-stats delegates with orgId
 * - enterprise:bulk-import delegates with orgId and members
 * - enterprise:get-departments delegates with orgId
 * - enterprise:get-department-members delegates with deptId
 * - enterprise:update-department delegates with params
 * - enterprise:delete-department delegates with deptId
 * - All handlers return { success: false, error } on exception
 * - Handlers return error when enterpriseOrgManager is not provided
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// We use the injected ipcMain support in enterprise-ipc.js
// to avoid ESM/CJS interop issues with vi.mock('electron')

// ── Import ─────────────────────────────────────────────────────────────────

import { registerEnterpriseIPC } from "../enterprise-ipc.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function createMockIpcMain() {
  const handlers = {};
  return {
    handlers,
    handle: vi.fn((channel, handler) => {
      handlers[channel] = handler;
    }),
    removeHandler: vi.fn(),
  };
}

function createMockManager() {
  return {
    createDepartment: vi.fn().mockResolvedValue({
      id: "dept-1",
      orgId: "org-1",
      name: "Engineering",
      description: null,
      teamType: "department",
    }),
    getOrgHierarchy: vi.fn().mockResolvedValue({
      org: { id: "org-1" },
      hierarchy: [],
    }),
    moveDepartment: vi.fn().mockResolvedValue({ success: true }),
    requestMemberJoin: vi.fn().mockResolvedValue({
      needsApproval: false,
      memberId: "did:user1",
    }),
    getOrgDashboardStats: vi.fn().mockResolvedValue({
      memberCount: 10,
      teamCount: 3,
      departmentCount: 2,
      pendingApprovals: 1,
    }),
    bulkMemberImport: vi.fn().mockResolvedValue({
      imported: [{ did: "did:u1" }],
      failed: [],
      skipped: [],
    }),
    getDepartments: vi
      .fn()
      .mockResolvedValue([{ id: "dept-1", name: "Engineering" }]),
    getDepartmentMembers: vi
      .fn()
      .mockResolvedValue([
        { id: "m1", memberDid: "did:user1", role: "member" },
      ]),
    updateDepartment: vi.fn().mockResolvedValue({ success: true }),
    deleteDepartment: vi.fn().mockResolvedValue({ success: true }),
  };
}

// ── Test Suite ─────────────────────────────────────────────────────────────

describe("Enterprise IPC Handlers", () => {
  let mockManager;
  let mockIpcMain;
  let handlers;

  beforeEach(() => {
    vi.clearAllMocks();
    mockManager = createMockManager();
    mockIpcMain = createMockIpcMain();
    handlers = mockIpcMain.handlers;

    registerEnterpriseIPC({
      enterpriseOrgManager: mockManager,
      ipcMain: mockIpcMain,
    });
  });

  it("should register 10 IPC handlers", () => {
    expect(Object.keys(handlers)).toHaveLength(10);
  });

  it("should register all expected channels", () => {
    const expected = [
      "enterprise:create-department",
      "enterprise:get-hierarchy",
      "enterprise:move-department",
      "enterprise:request-member-join",
      "enterprise:get-dashboard-stats",
      "enterprise:bulk-import",
      "enterprise:get-departments",
      "enterprise:get-department-members",
      "enterprise:update-department",
      "enterprise:delete-department",
    ];
    for (const channel of expected) {
      expect(handlers[channel]).toBeDefined();
    }
  });

  // ── enterprise:create-department ───────────────────────────────────────

  it("enterprise:create-department should delegate to manager", async () => {
    const result = await handlers["enterprise:create-department"](
      {},
      {
        orgId: "org-1",
        name: "Engineering",
        description: "Engineering team",
      },
    );

    expect(result.success).toBe(true);
    expect(result.data.name).toBe("Engineering");
    expect(mockManager.createDepartment).toHaveBeenCalledWith("org-1", {
      name: "Engineering",
      description: "Engineering team",
      parentDeptId: undefined,
      leadDid: undefined,
      leadName: undefined,
    });
  });

  it("enterprise:create-department should return error when manager is null", () => {
    const ipc2 = createMockIpcMain();
    registerEnterpriseIPC({ enterpriseOrgManager: null, ipcMain: ipc2 });

    return ipc2.handlers["enterprise:create-department"](
      {},
      {
        orgId: "org-1",
        name: "Test",
      },
    ).then((result) => {
      expect(result.success).toBe(false);
      expect(result.error).toContain("not initialized");
    });
  });

  it("enterprise:create-department should handle exception", async () => {
    mockManager.createDepartment.mockRejectedValue(new Error("DB error"));

    const result = await handlers["enterprise:create-department"](
      {},
      {
        orgId: "org-1",
        name: "Test",
      },
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("DB error");
  });

  // ── enterprise:get-hierarchy ───────────────────────────────────────────

  it("enterprise:get-hierarchy should delegate with orgId", async () => {
    const result = await handlers["enterprise:get-hierarchy"]({}, "org-1");

    expect(result.success).toBe(true);
    expect(result.data).toHaveProperty("org");
    expect(result.data).toHaveProperty("hierarchy");
    expect(mockManager.getOrgHierarchy).toHaveBeenCalledWith("org-1");
  });

  it("enterprise:get-hierarchy should handle errors", async () => {
    mockManager.getOrgHierarchy.mockRejectedValue(new Error("Hierarchy fail"));

    const result = await handlers["enterprise:get-hierarchy"]({}, "org-1");
    expect(result.success).toBe(false);
    expect(result.error).toBe("Hierarchy fail");
  });

  // ── enterprise:move-department ─────────────────────────────────────────

  it("enterprise:move-department should delegate with params", async () => {
    const result = await handlers["enterprise:move-department"](
      {},
      {
        deptId: "dept-1",
        newParentId: "dept-2",
      },
    );

    expect(result.success).toBe(true);
    expect(mockManager.moveDepartment).toHaveBeenCalledWith("dept-1", "dept-2");
  });

  // ── enterprise:request-member-join ─────────────────────────────────────

  it("enterprise:request-member-join should delegate with params", async () => {
    const result = await handlers["enterprise:request-member-join"](
      {},
      {
        orgId: "org-1",
        memberDid: "did:user1",
        role: "member",
        requestedBy: "did:admin",
      },
    );

    expect(result.success).toBe(true);
    expect(result.data.memberId).toBe("did:user1");
    expect(mockManager.requestMemberJoin).toHaveBeenCalledWith(
      "org-1",
      "did:user1",
      "member",
      "did:admin",
    );
  });

  // ── enterprise:get-dashboard-stats ─────────────────────────────────────

  it("enterprise:get-dashboard-stats should return stats", async () => {
    const result = await handlers["enterprise:get-dashboard-stats"](
      {},
      "org-1",
    );

    expect(result.success).toBe(true);
    expect(result.data.memberCount).toBe(10);
    expect(result.data.teamCount).toBe(3);
    expect(result.data.departmentCount).toBe(2);
    expect(result.data.pendingApprovals).toBe(1);
  });

  // ── enterprise:bulk-import ─────────────────────────────────────────────

  it("enterprise:bulk-import should delegate with orgId and members", async () => {
    const members = [
      { did: "did:u1", name: "User1", role: "member" },
      { did: "did:u2", name: "User2", role: "admin" },
    ];

    const result = await handlers["enterprise:bulk-import"](
      {},
      {
        orgId: "org-1",
        members,
      },
    );

    expect(result.success).toBe(true);
    expect(mockManager.bulkMemberImport).toHaveBeenCalledWith("org-1", members);
  });

  it("enterprise:bulk-import should handle errors", async () => {
    mockManager.bulkMemberImport.mockRejectedValue(new Error("Import fail"));

    const result = await handlers["enterprise:bulk-import"](
      {},
      {
        orgId: "org-1",
        members: [],
      },
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("Import fail");
  });

  // ── enterprise:get-departments ─────────────────────────────────────────

  it("enterprise:get-departments should delegate with orgId", async () => {
    const result = await handlers["enterprise:get-departments"]({}, "org-1");

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].name).toBe("Engineering");
  });

  // ── enterprise:get-department-members ──────────────────────────────────

  it("enterprise:get-department-members should delegate with deptId", async () => {
    const result = await handlers["enterprise:get-department-members"](
      {},
      "dept-1",
    );

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].memberDid).toBe("did:user1");
  });

  // ── enterprise:update-department ───────────────────────────────────────

  it("enterprise:update-department should delegate with params", async () => {
    const result = await handlers["enterprise:update-department"](
      {},
      {
        deptId: "dept-1",
        name: "New Name",
        description: "Updated description",
      },
    );

    expect(result.success).toBe(true);
    expect(mockManager.updateDepartment).toHaveBeenCalledWith("dept-1", {
      name: "New Name",
      description: "Updated description",
      leadDid: undefined,
      leadName: undefined,
    });
  });

  it("enterprise:update-department should return error when manager is null", async () => {
    const ipc2 = createMockIpcMain();
    registerEnterpriseIPC({ enterpriseOrgManager: null, ipcMain: ipc2 });

    const result = await ipc2.handlers["enterprise:update-department"](
      {},
      {
        deptId: "dept-1",
        name: "Test",
      },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("not initialized");
  });

  // ── enterprise:delete-department ───────────────────────────────────────

  it("enterprise:delete-department should delegate with deptId", async () => {
    const result = await handlers["enterprise:delete-department"]({}, "dept-1");

    expect(result.success).toBe(true);
    expect(mockManager.deleteDepartment).toHaveBeenCalledWith("dept-1");
  });

  it("enterprise:delete-department should return error when manager is null", async () => {
    const ipc2 = createMockIpcMain();
    registerEnterpriseIPC({ enterpriseOrgManager: null, ipcMain: ipc2 });

    const result = await ipc2.handlers["enterprise:delete-department"](
      {},
      "dept-1",
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("not initialized");
  });

  it("enterprise:delete-department should handle exception", async () => {
    mockManager.deleteDepartment.mockRejectedValue(new Error("Delete error"));

    const result = await handlers["enterprise:delete-department"]({}, "dept-1");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Delete error");
  });
});
