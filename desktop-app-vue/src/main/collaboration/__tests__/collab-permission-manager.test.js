/**
 * PermissionManager Unit Tests
 *
 * Tests for the collaboration permission manager that handles:
 * - Role-based permission checking (owner, admin, editor, member, viewer)
 * - Folder and knowledge item permissions
 * - Permission presets (public-read, team-edit, admin-only, private)
 * - Permission validation and updating
 * - Effective permissions calculation
 * - Accessible resources querying
 * - Bulk permission updates
 * - Permission inheritance
 * - Permission summary/distribution analysis
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

function createMockDatabase() {
  const prepResult = {
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(null),
    run: vi.fn(),
  };
  return {
    getDatabase: vi.fn().mockReturnValue({
      exec: vi.fn(),
      prepare: vi.fn().mockReturnValue(prepResult),
      _prep: prepResult,
    }),
    saveToFile: vi.fn(),
    _prep: prepResult,
  };
}

const PermissionManager = require("../permission-manager.js");

describe("PermissionManager", () => {
  let manager;
  let mockDb;
  let prepResult;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = createMockDatabase();
    prepResult = mockDb._prep;
    manager = new PermissionManager(mockDb);
  });

  afterEach(() => {
    manager.destroy();
  });

  // =============================================
  // Constructor
  // =============================================

  describe("constructor", () => {
    it("should initialize with database and role hierarchy", () => {
      expect(manager.database).toBe(mockDb);
      expect(manager.roleHierarchy).toBeDefined();
      expect(manager.roleHierarchy.owner).toContain("manage");
      expect(manager.roleHierarchy.viewer).toEqual(["view"]);
    });

    it("should define default folder permissions", () => {
      expect(manager.defaultFolderPermissions.view).toContain("member");
      expect(manager.defaultFolderPermissions.manage).toEqual(["owner"]);
    });

    it("should define default knowledge permissions", () => {
      expect(manager.defaultKnowledgePermissions.comment).toContain("member");
      expect(manager.defaultKnowledgePermissions.edit).toContain("editor");
    });

    it("should extend EventEmitter", () => {
      expect(typeof manager.on).toBe("function");
      expect(typeof manager.emit).toBe("function");
    });
  });

  // =============================================
  // getUserRole
  // =============================================

  describe("getUserRole", () => {
    it("should return user role from database", async () => {
      prepResult.get.mockReturnValue({ role: "editor" });

      const role = await manager.getUserRole("org-1", "did:user:1");

      expect(role).toBe("editor");
    });

    it("should return null if user not found in org", async () => {
      prepResult.get.mockReturnValue(null);

      const role = await manager.getUserRole("org-1", "did:user:unknown");

      expect(role).toBeNull();
    });

    it("should return null on database error", async () => {
      mockDb.getDatabase.mockImplementation(() => {
        throw new Error("DB error");
      });

      const role = await manager.getUserRole("org-1", "did:user:1");

      expect(role).toBeNull();
    });
  });

  // =============================================
  // checkPermission
  // =============================================

  describe("checkPermission", () => {
    it("should return false when user has no role in org", async () => {
      prepResult.get.mockReturnValue(null);

      const result = await manager.checkPermission(
        "org-1",
        "did:user:1",
        "folder",
        "f1",
        "edit",
      );

      expect(result).toBe(false);
    });

    it("should return true for owner regardless of action", async () => {
      prepResult.get.mockReturnValue({ role: "owner" });

      const result = await manager.checkPermission(
        "org-1",
        "did:user:1",
        "folder",
        "f1",
        "manage",
      );

      expect(result).toBe(true);
    });

    it("should check folder permissions for editor role", async () => {
      // First get: getUserRole returns editor
      // Second get: getFolderPermissions returns custom permissions
      prepResult.get
        .mockReturnValueOnce({ role: "editor" })
        .mockReturnValueOnce({
          permissions: JSON.stringify({ edit: ["editor", "admin", "owner"] }),
        });

      const result = await manager.checkPermission(
        "org-1",
        "did:user:1",
        "folder",
        "f1",
        "edit",
      );

      expect(result).toBe(true);
    });

    it("should deny permission when role is not in allowed list", async () => {
      prepResult.get
        .mockReturnValueOnce({ role: "viewer" })
        .mockReturnValueOnce({
          permissions: JSON.stringify({ edit: ["editor", "admin", "owner"] }),
        });

      const result = await manager.checkPermission(
        "org-1",
        "did:user:1",
        "folder",
        "f1",
        "edit",
      );

      expect(result).toBe(false);
    });

    it("should check knowledge permissions", async () => {
      prepResult.get
        .mockReturnValueOnce({ role: "member" })
        .mockReturnValueOnce({
          permissions: JSON.stringify({
            view: ["member", "editor", "admin", "owner"],
          }),
        });

      const result = await manager.checkPermission(
        "org-1",
        "did:user:1",
        "knowledge",
        "k1",
        "view",
      );

      expect(result).toBe(true);
    });

    it("should return false for unknown resource type", async () => {
      prepResult.get.mockReturnValue({ role: "admin" });

      const result = await manager.checkPermission(
        "org-1",
        "did:user:1",
        "unknown_type",
        "x1",
        "view",
      );

      expect(result).toBe(false);
    });

    it("should return false on error", async () => {
      mockDb.getDatabase.mockImplementation(() => {
        throw new Error("DB error");
      });

      const result = await manager.checkPermission(
        "org-1",
        "did:user:1",
        "folder",
        "f1",
        "view",
      );

      expect(result).toBe(false);
    });
  });

  // =============================================
  // getFolderPermissions / getKnowledgePermissions
  // =============================================

  describe("getFolderPermissions", () => {
    it("should return parsed permissions from database", async () => {
      const perms = { view: ["member"], edit: ["admin", "owner"] };
      prepResult.get.mockReturnValue({ permissions: JSON.stringify(perms) });

      const result = await manager.getFolderPermissions("folder-1");

      expect(result).toEqual(perms);
    });

    it("should return defaults when folder not found", async () => {
      prepResult.get.mockReturnValue(null);

      const result = await manager.getFolderPermissions("nonexistent");

      expect(result).toEqual(manager.defaultFolderPermissions);
    });

    it("should return defaults on error", async () => {
      mockDb.getDatabase.mockImplementation(() => {
        throw new Error("DB error");
      });

      const result = await manager.getFolderPermissions("folder-1");

      expect(result).toEqual(manager.defaultFolderPermissions);
    });
  });

  describe("getKnowledgePermissions", () => {
    it("should return parsed permissions from database", async () => {
      const perms = { view: ["member"], edit: ["editor"] };
      prepResult.get.mockReturnValue({ permissions: JSON.stringify(perms) });

      const result = await manager.getKnowledgePermissions("k-1");

      expect(result).toEqual(perms);
    });

    it("should return defaults when not found", async () => {
      prepResult.get.mockReturnValue(null);

      const result = await manager.getKnowledgePermissions("nonexistent");

      expect(result).toEqual(manager.defaultKnowledgePermissions);
    });
  });

  // =============================================
  // validatePermissions
  // =============================================

  describe("validatePermissions", () => {
    it("should keep only valid actions and roles", () => {
      const input = {
        view: ["member", "invalid_role", "admin"],
        edit: ["editor"],
        invalid_action: ["owner"],
        manage: ["owner"],
      };

      const result = manager.validatePermissions(input);

      expect(result.view).toEqual(["member", "admin"]);
      expect(result.edit).toEqual(["editor"]);
      expect(result.manage).toEqual(["owner"]);
      expect(result.invalid_action).toBeUndefined();
    });

    it("should handle empty permissions", () => {
      const result = manager.validatePermissions({});
      expect(Object.keys(result)).toHaveLength(0);
    });

    it("should filter out all invalid roles", () => {
      const result = manager.validatePermissions({
        view: ["hacker", "superuser"],
      });
      expect(result.view).toEqual([]);
    });
  });

  // =============================================
  // updateFolderPermissions
  // =============================================

  describe("updateFolderPermissions", () => {
    it("should update permissions when user has manage permission", async () => {
      // checkPermission: getUserRole returns owner
      prepResult.get.mockReturnValue({ role: "owner" });

      const newPerms = {
        view: ["member", "editor", "admin", "owner"],
        edit: ["admin", "owner"],
      };
      const result = await manager.updateFolderPermissions(
        "org-1",
        "f1",
        "did:user:1",
        newPerms,
      );

      expect(result.view).toEqual(["member", "editor", "admin", "owner"]);
      expect(prepResult.run).toHaveBeenCalled();
    });

    it("should emit permissions-updated event", async () => {
      prepResult.get.mockReturnValue({ role: "owner" });
      const eventSpy = vi.fn();
      manager.on("permissions-updated", eventSpy);

      await manager.updateFolderPermissions("org-1", "f1", "did:user:1", {
        view: ["member"],
      });

      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "folder",
          id: "f1",
          updatedBy: "did:user:1",
        }),
      );
    });

    it("should throw when user lacks manage permission", async () => {
      // getUserRole returns 'member', checkPermission for 'manage' will fail
      prepResult.get
        .mockReturnValueOnce({ role: "member" }) // getUserRole in checkPermission
        .mockReturnValueOnce({
          permissions: JSON.stringify({ manage: ["owner"] }),
        }); // getFolderPermissions

      await expect(
        manager.updateFolderPermissions("org-1", "f1", "did:user:1", {
          view: ["member"],
        }),
      ).rejects.toThrow("No permission to manage folder permissions");
    });
  });

  // =============================================
  // updateKnowledgePermissions
  // =============================================

  describe("updateKnowledgePermissions", () => {
    it("should update permissions when user is admin", async () => {
      prepResult.get.mockReturnValue({ role: "admin" });

      const newPerms = { view: ["member"], edit: ["editor", "admin"] };
      const result = await manager.updateKnowledgePermissions(
        "org-1",
        "k1",
        "did:user:1",
        newPerms,
      );

      expect(result.view).toEqual(["member"]);
    });

    it("should throw when user is not owner or admin", async () => {
      prepResult.get.mockReturnValue({ role: "editor" });

      await expect(
        manager.updateKnowledgePermissions("org-1", "k1", "did:user:1", {
          view: ["member"],
        }),
      ).rejects.toThrow("No permission to manage knowledge permissions");
    });
  });

  // =============================================
  // getEffectivePermissions
  // =============================================

  describe("getEffectivePermissions", () => {
    it("should return all permissions for owner", async () => {
      prepResult.get.mockReturnValue({ role: "owner" });

      const result = await manager.getEffectivePermissions(
        "org-1",
        "did:user:1",
        "folder",
        "f1",
      );

      expect(result).toEqual(manager.roleHierarchy.owner);
    });

    it("should return matching permissions for editor", async () => {
      prepResult.get
        .mockReturnValueOnce({ role: "editor" })
        .mockReturnValueOnce({
          permissions: JSON.stringify({
            view: ["member", "editor", "admin", "owner"],
            edit: ["editor", "admin", "owner"],
            delete: ["admin", "owner"],
          }),
        });

      const result = await manager.getEffectivePermissions(
        "org-1",
        "did:user:1",
        "folder",
        "f1",
      );

      expect(result).toContain("view");
      expect(result).toContain("edit");
      expect(result).not.toContain("delete");
    });

    it("should return empty array when user has no role", async () => {
      prepResult.get.mockReturnValue(null);

      const result = await manager.getEffectivePermissions(
        "org-1",
        "did:unknown",
        "folder",
        "f1",
      );

      expect(result).toEqual([]);
    });

    it("should return empty array for unknown resource type", async () => {
      prepResult.get.mockReturnValue({ role: "admin" });

      const result = await manager.getEffectivePermissions(
        "org-1",
        "did:user:1",
        "invalid",
        "x1",
      );

      expect(result).toEqual([]);
    });
  });

  // =============================================
  // getPermissionPreset
  // =============================================

  describe("getPermissionPreset", () => {
    it("should return public-read preset", () => {
      const preset = manager.getPermissionPreset("public-read");
      expect(preset.view).toContain("viewer");
      expect(preset.edit).toEqual(["admin", "owner"]);
    });

    it("should return team-edit preset", () => {
      const preset = manager.getPermissionPreset("team-edit");
      expect(preset.edit).toContain("editor");
    });

    it("should return admin-only preset", () => {
      const preset = manager.getPermissionPreset("admin-only");
      expect(preset.view).toEqual(["admin", "owner"]);
    });

    it("should return private preset", () => {
      const preset = manager.getPermissionPreset("private");
      expect(preset.view).toEqual(["owner"]);
      expect(preset.edit).toEqual(["owner"]);
    });

    it("should return default folder permissions for unknown preset", () => {
      const preset = manager.getPermissionPreset("nonexistent");
      expect(preset).toEqual(manager.defaultFolderPermissions);
    });
  });

  // =============================================
  // canAccessFolder / canAccessKnowledge
  // =============================================

  describe("canAccessFolder", () => {
    it("should delegate to checkPermission with view action", async () => {
      prepResult.get.mockReturnValue({ role: "owner" });

      const result = await manager.canAccessFolder("org-1", "did:user:1", "f1");

      expect(result).toBe(true);
    });
  });

  describe("canAccessKnowledge", () => {
    it("should delegate to checkPermission with view action", async () => {
      prepResult.get.mockReturnValue({ role: "owner" });

      const result = await manager.canAccessKnowledge(
        "org-1",
        "did:user:1",
        "k1",
      );

      expect(result).toBe(true);
    });
  });

  // =============================================
  // bulkUpdatePermissions
  // =============================================

  describe("bulkUpdatePermissions", () => {
    it("should process multiple updates and return results", async () => {
      // Owner can update everything
      prepResult.get.mockReturnValue({ role: "owner" });

      const updates = [
        { type: "folder", id: "f1", permissions: { view: ["member"] } },
        { type: "knowledge", id: "k1", permissions: { view: ["editor"] } },
      ];

      const results = await manager.bulkUpdatePermissions(
        "org-1",
        "did:user:1",
        updates,
      );

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(true);
    });

    it("should report individual failures", async () => {
      // First update: owner, second: editor (no manage permission)
      prepResult.get
        .mockReturnValueOnce({ role: "owner" }) // first folder update - checkPermission
        .mockReturnValueOnce({ role: "editor" }); // second knowledge update - getUserRole

      const updates = [
        { type: "folder", id: "f1", permissions: { view: ["member"] } },
        { type: "knowledge", id: "k1", permissions: { view: ["editor"] } },
      ];

      const results = await manager.bulkUpdatePermissions(
        "org-1",
        "did:user:1",
        updates,
      );

      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
      expect(results[1].error).toBeDefined();
    });
  });

  // =============================================
  // inheritFolderPermissions
  // =============================================

  describe("inheritFolderPermissions", () => {
    it("should copy parent folder permissions to child", async () => {
      const parentPerms = { view: ["member"], edit: ["admin", "owner"] };
      prepResult.get.mockReturnValue({
        permissions: JSON.stringify(parentPerms),
      });

      const result = await manager.inheritFolderPermissions(
        "child-1",
        "parent-1",
      );

      expect(result).toEqual(parentPerms);
      expect(prepResult.run).toHaveBeenCalled();
    });

    it("should use defaults when parent has no custom permissions", async () => {
      prepResult.get.mockReturnValue(null);

      const result = await manager.inheritFolderPermissions(
        "child-1",
        "parent-1",
      );

      expect(result).toEqual(manager.defaultFolderPermissions);
    });
  });

  // =============================================
  // getPermissionSummary
  // =============================================

  describe("getPermissionSummary", () => {
    it("should return summary with counts", async () => {
      prepResult.all
        .mockReturnValueOnce([
          { permissions: JSON.stringify({ view: ["member"] }) },
        ]) // folders
        .mockReturnValueOnce([
          { permissions: JSON.stringify({ view: ["admin", "owner"] }) },
        ]) // knowledge
        .mockReturnValueOnce([
          { role: "owner", count: 1 },
          { role: "admin", count: 3 },
          { role: "member", count: 10 },
        ]); // members

      const result = await manager.getPermissionSummary("org-1");

      expect(result.totalFolders).toBe(1);
      expect(result.totalKnowledge).toBe(1);
      expect(result.membersByRole.owner).toBe(1);
      expect(result.membersByRole.admin).toBe(3);
      expect(result.membersByRole.member).toBe(10);
      expect(result.permissionDistribution).toBeDefined();
    });

    it("should return null on error", async () => {
      mockDb.getDatabase.mockImplementation(() => {
        throw new Error("DB error");
      });

      const result = await manager.getPermissionSummary("org-1");

      expect(result).toBeNull();
    });
  });

  // =============================================
  // _analyzePermissionDistribution
  // =============================================

  describe("_analyzePermissionDistribution", () => {
    it("should categorize resources by access level", () => {
      const folders = [
        { permissions: JSON.stringify({ view: ["viewer", "member"] }) },
        { permissions: JSON.stringify({ view: ["admin", "owner"] }) },
      ];
      const knowledge = [{ permissions: JSON.stringify({ view: ["owner"] }) }];

      const result = manager._analyzePermissionDistribution(folders, knowledge);

      expect(result.public).toBe(1); // viewer/member in view
      expect(result.restricted).toBe(1); // admin/editor in view
      expect(result.private).toBe(1); // only owner in view
    });

    it("should handle empty arrays", () => {
      const result = manager._analyzePermissionDistribution([], []);

      expect(result.public).toBe(0);
      expect(result.restricted).toBe(0);
      expect(result.private).toBe(0);
    });
  });

  // =============================================
  // destroy
  // =============================================

  describe("destroy", () => {
    it("should remove all event listeners", () => {
      manager.on("test", vi.fn());
      expect(manager.listenerCount("test")).toBe(1);

      manager.destroy();

      expect(manager.listenerCount("test")).toBe(0);
    });
  });
});
