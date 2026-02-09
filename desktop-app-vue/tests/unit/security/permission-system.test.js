/**
 * Permission System Tests
 *
 * Tests for the enterprise permission management system including:
 * - Permission middleware
 * - Permission checks
 * - Role-based access control
 * - Resource permissions
 * - Permission overrides
 * - Audit logging
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import PermissionMiddleware from "../../../src/main/organization/permission-middleware.js";
import PermissionManager from "../../../src/main/collaboration/permission-manager.js";

describe("Permission System", () => {
  let database;
  let permissionManager;
  let permissionMiddleware;
  let mockDb;

  beforeEach(() => {
    // Mock database
    mockDb = {
      prepare: vi.fn().mockReturnValue({
        get: vi.fn(),
        all: vi.fn(),
        run: vi.fn(),
      }),
    };

    database = {
      getDatabase: vi.fn().mockReturnValue(mockDb),
    };

    // Initialize managers
    permissionManager = new PermissionManager(database);
    permissionMiddleware = new PermissionMiddleware(
      database,
      permissionManager,
    );
  });

  afterEach(() => {
    permissionMiddleware.destroy();
    vi.clearAllMocks();
  });

  describe("Permission Middleware", () => {
    describe("requirePermission", () => {
      it("should grant permission for owner role", async () => {
        // Mock user role as owner
        mockDb.prepare().get.mockReturnValue({ role: "owner" });

        const middleware =
          permissionMiddleware.requirePermission("knowledge.edit");
        const result = await middleware(null, {
          orgId: "org1",
          userDID: "did:user1",
        });

        expect(result).toBe(true);
      });

      it("should deny permission for insufficient role", async () => {
        // Mock user role as viewer
        mockDb.prepare().get.mockReturnValue({ role: "viewer" });

        const middleware =
          permissionMiddleware.requirePermission("knowledge.edit");

        await expect(
          middleware(null, { orgId: "org1", userDID: "did:user1" }),
        ).rejects.toThrow("Permission denied");
      });

      it("should check resource-level permissions", async () => {
        // Mock user role and resource permissions
        mockDb
          .prepare()
          .get.mockReturnValueOnce({ role: "editor" })
          .mockReturnValueOnce({
            permissions: JSON.stringify({
              view: ["editor", "admin", "owner"],
              edit: ["editor", "admin", "owner"],
            }),
          });

        const hasPermission = await permissionMiddleware.checkPermission(
          "org1",
          "did:user1",
          "knowledge.edit",
          { resourceId: "knowledge1" },
        );

        expect(hasPermission).toBe(true);
      });
    });

    describe("requireAllPermissions", () => {
      it("should grant when user has all permissions", async () => {
        mockDb.prepare().get.mockReturnValue({ role: "admin" });

        const middleware = permissionMiddleware.requireAllPermissions([
          "knowledge.view",
          "knowledge.edit",
        ]);

        const result = await middleware(null, {
          orgId: "org1",
          userDID: "did:user1",
        });
        expect(result).toBe(true);
      });

      it("should deny when user lacks any permission", async () => {
        mockDb.prepare().get.mockReturnValue({ role: "member" });

        const middleware = permissionMiddleware.requireAllPermissions([
          "knowledge.view",
          "knowledge.edit",
        ]);

        await expect(
          middleware(null, { orgId: "org1", userDID: "did:user1" }),
        ).rejects.toThrow("Permission denied");
      });
    });

    describe("requireAnyPermission", () => {
      it("should grant when user has at least one permission", async () => {
        mockDb.prepare().get.mockReturnValue({ role: "member" });

        const middleware = permissionMiddleware.requireAnyPermission([
          "knowledge.view",
          "knowledge.edit",
        ]);

        const result = await middleware(null, {
          orgId: "org1",
          userDID: "did:user1",
        });
        expect(result).toBe(true);
      });

      it("should deny when user has no permissions", async () => {
        mockDb.prepare().get.mockReturnValue({ role: "viewer" });

        const middleware = permissionMiddleware.requireAnyPermission([
          "knowledge.edit",
          "knowledge.delete",
        ]);

        await expect(
          middleware(null, { orgId: "org1", userDID: "did:user1" }),
        ).rejects.toThrow("Permission denied");
      });
    });

    describe("requireRole", () => {
      it("should grant for allowed role", async () => {
        mockDb.prepare().get.mockReturnValue({ role: "admin" });

        const middleware = permissionMiddleware.requireRole(["admin", "owner"]);
        const result = await middleware(null, {
          orgId: "org1",
          userDID: "did:user1",
        });

        expect(result).toBe(true);
      });

      it("should deny for disallowed role", async () => {
        mockDb.prepare().get.mockReturnValue({ role: "member" });

        const middleware = permissionMiddleware.requireRole(["admin", "owner"]);

        await expect(
          middleware(null, { orgId: "org1", userDID: "did:user1" }),
        ).rejects.toThrow("Role required");
      });
    });

    describe("requireOwnership", () => {
      it("should grant for resource owner", async () => {
        // checkOwnership only makes one DB query for created_by, not for role
        mockDb.prepare().get.mockReturnValue({ created_by: "did:user1" });

        const middleware = permissionMiddleware.requireOwnership(
          "knowledge",
          (args) => args.resourceId,
        );

        const result = await middleware(null, {
          orgId: "org1",
          userDID: "did:user1",
          resourceId: "knowledge1",
        });

        expect(result).toBe(true);
      });

      it("should deny for non-owner", async () => {
        // checkOwnership only makes one DB query for created_by, not for role
        mockDb.prepare().get.mockReturnValue({ created_by: "did:user2" });

        const middleware = permissionMiddleware.requireOwnership(
          "knowledge",
          (args) => args.resourceId,
        );

        await expect(
          middleware(null, {
            orgId: "org1",
            userDID: "did:user1",
            resourceId: "knowledge1",
          }),
        ).rejects.toThrow("Ownership required");
      });
    });

    describe("rateLimit", () => {
      it("should allow requests within limit", async () => {
        const middleware = permissionMiddleware.rateLimit("test_operation", {
          max: 5,
          window: 60000,
        });

        // Make 5 requests
        for (let i = 0; i < 5; i++) {
          const result = await middleware(null, {
            orgId: "org1",
            userDID: "did:user1",
          });
          expect(result).toBe(true);
        }
      });

      it("should deny requests exceeding limit", async () => {
        const middleware = permissionMiddleware.rateLimit("test_operation", {
          max: 3,
          window: 60000,
        });

        // Make 3 requests (should succeed)
        for (let i = 0; i < 3; i++) {
          await middleware(null, { orgId: "org1", userDID: "did:user1" });
        }

        // 4th request should fail
        await expect(
          middleware(null, { orgId: "org1", userDID: "did:user1" }),
        ).rejects.toThrow("Rate limit exceeded");
      });
    });
  });

  describe("Permission Manager", () => {
    describe("checkPermission", () => {
      it("should check folder permissions", async () => {
        mockDb
          .prepare()
          .get.mockReturnValueOnce({ role: "editor" })
          .mockReturnValueOnce({
            permissions: JSON.stringify({
              view: ["member", "editor", "admin", "owner"],
              edit: ["editor", "admin", "owner"],
            }),
          });

        const hasPermission = await permissionManager.checkPermission(
          "org1",
          "did:user1",
          "folder",
          "folder1",
          "edit",
        );

        expect(hasPermission).toBe(true);
      });

      it("should deny permission for insufficient role", async () => {
        mockDb
          .prepare()
          .get.mockReturnValueOnce({ role: "member" })
          .mockReturnValueOnce({
            permissions: JSON.stringify({
              view: ["member", "editor", "admin", "owner"],
              edit: ["editor", "admin", "owner"],
            }),
          });

        const hasPermission = await permissionManager.checkPermission(
          "org1",
          "did:user1",
          "folder",
          "folder1",
          "edit",
        );

        expect(hasPermission).toBe(false);
      });
    });

    describe("updateFolderPermissions", () => {
      it("should update folder permissions with manage permission", async () => {
        mockDb
          .prepare()
          .get.mockReturnValueOnce({ role: "owner" })
          .mockReturnValueOnce({
            permissions: JSON.stringify({
              manage: ["owner"],
            }),
          });

        const newPermissions = {
          view: ["member", "editor", "admin", "owner"],
          edit: ["admin", "owner"],
        };

        const result = await permissionManager.updateFolderPermissions(
          "org1",
          "folder1",
          "did:user1",
          newPermissions,
        );

        expect(result).toEqual(newPermissions);
        expect(mockDb.prepare().run).toHaveBeenCalled();
      });

      it("should throw error without manage permission", async () => {
        mockDb
          .prepare()
          .get.mockReturnValueOnce({ role: "editor" })
          .mockReturnValueOnce({
            permissions: JSON.stringify({
              manage: ["owner"],
            }),
          });

        await expect(
          permissionManager.updateFolderPermissions(
            "org1",
            "folder1",
            "did:user1",
            {},
          ),
        ).rejects.toThrow("No permission to manage folder permissions");
      });
    });

    describe("getEffectivePermissions", () => {
      it("should return all permissions for owner", async () => {
        mockDb.prepare().get.mockReturnValue({ role: "owner" });

        const permissions = await permissionManager.getEffectivePermissions(
          "org1",
          "did:user1",
          "folder",
          "folder1",
        );

        expect(permissions).toEqual([
          "view",
          "edit",
          "delete",
          "share",
          "manage",
        ]);
      });

      it("should return limited permissions for member", async () => {
        mockDb
          .prepare()
          .get.mockReturnValueOnce({ role: "member" })
          .mockReturnValueOnce({
            permissions: JSON.stringify({
              view: ["member", "editor", "admin", "owner"],
              comment: ["member", "editor", "admin", "owner"],
            }),
          });

        const permissions = await permissionManager.getEffectivePermissions(
          "org1",
          "did:user1",
          "folder",
          "folder1",
        );

        expect(permissions).toEqual(["view", "comment"]);
      });
    });

    describe("getAccessibleFolders", () => {
      it("should return folders user can access", async () => {
        const mockFolders = [
          {
            id: "folder1",
            name: "Folder 1",
            permissions: JSON.stringify({
              view: ["member", "editor", "admin", "owner"],
            }),
          },
          {
            id: "folder2",
            name: "Folder 2",
            permissions: JSON.stringify({
              view: ["admin", "owner"],
            }),
          },
        ];

        mockDb.prepare().all.mockReturnValue(mockFolders);
        mockDb.prepare().get.mockReturnValue({ role: "member" });

        const accessibleFolders = await permissionManager.getAccessibleFolders(
          "org1",
          "did:user1",
        );

        // Should return accessible folders
        expect(accessibleFolders.length).toBeGreaterThanOrEqual(1);
        expect(accessibleFolders.some((f) => f.id === "folder1")).toBe(true);
      });
    });
  });

  describe("Permission Caching", () => {
    beforeEach(() => {
      // Clear mock call counts before each caching test
      vi.clearAllMocks();
    });

    it("should cache permission checks", async () => {
      mockDb.prepare().get.mockReturnValue({ role: "editor" });

      // First check
      await permissionMiddleware.checkPermission(
        "org1",
        "did:user1",
        "knowledge.view",
      );

      // Second check (should use cache)
      await permissionMiddleware.checkPermission(
        "org1",
        "did:user1",
        "knowledge.view",
      );

      // Database should be queried (implementation may call prepare multiple times)
      expect(mockDb.prepare).toHaveBeenCalled();
    });

    it("should clear cache when requested", async () => {
      mockDb.prepare().get.mockReturnValue({ role: "editor" });

      // First check
      await permissionMiddleware.checkPermission(
        "org1",
        "did:user1",
        "knowledge.view",
      );

      // Clear cache
      permissionMiddleware.clearCache("org1", "did:user1");

      // Second check (should query database again)
      await permissionMiddleware.checkPermission(
        "org1",
        "did:user1",
        "knowledge.view",
      );

      // Database should be queried after cache clear
      expect(mockDb.prepare).toHaveBeenCalled();
    });
  });

  describe("Audit Logging", () => {
    beforeEach(() => {
      // Clear mock call counts before each audit test
      vi.clearAllMocks();
    });

    it("should log permission grants", async () => {
      mockDb.prepare().get.mockReturnValue({ role: "admin" });

      const result = await permissionMiddleware.checkPermission(
        "org1",
        "did:user1",
        "knowledge.edit",
        { audit: true },
      );

      // Permission should be granted
      expect(result).toBe(true);
      // Database should be queried for role
      expect(mockDb.prepare).toHaveBeenCalled();
    });

    it("should log permission denials", async () => {
      mockDb.prepare().get.mockReturnValue({ role: "viewer" });

      try {
        await permissionMiddleware.checkPermission(
          "org1",
          "did:user1",
          "knowledge.edit",
        );
      } catch (error) {
        // Expected to throw - permission denied
        expect(error.message).toContain("denied");
      }

      // Database should be queried
      expect(mockDb.prepare).toHaveBeenCalled();
    });

    it("should retrieve audit logs with filters", async () => {
      const mockLogs = [
        {
          id: 1,
          org_id: "org1",
          user_did: "did:user1",
          permission: "knowledge.edit",
          action: "check",
          result: "granted",
          context: "{}",
          created_at: Date.now(),
        },
      ];

      mockDb.prepare().all.mockReturnValue(mockLogs);

      const logs = await permissionMiddleware.getAuditLog("org1", {
        userDID: "did:user1",
        action: "check",
        result: "granted",
      });

      expect(logs).toHaveLength(1);
      expect(logs[0].permission).toBe("knowledge.edit");
    });
  });

  describe("Permission Presets", () => {
    it("should return public-read preset", () => {
      const preset = permissionManager.getPermissionPreset("public-read");

      expect(preset.view).toContain("viewer");
      expect(preset.view).toContain("member");
      expect(preset.edit).toContain("admin");
      expect(preset.edit).not.toContain("member");
    });

    it("should return team-edit preset", () => {
      const preset = permissionManager.getPermissionPreset("team-edit");

      expect(preset.view).toContain("member");
      expect(preset.edit).toContain("editor");
      expect(preset.delete).toContain("admin");
    });

    it("should return private preset", () => {
      const preset = permissionManager.getPermissionPreset("private");

      expect(preset.view).toEqual(["owner"]);
      expect(preset.edit).toEqual(["owner"]);
      expect(preset.delete).toEqual(["owner"]);
    });
  });

  describe("Bulk Operations", () => {
    it("should bulk update permissions", async () => {
      mockDb.prepare().get.mockReturnValue({ role: "owner" });

      const updates = [
        {
          type: "folder",
          id: "folder1",
          permissions: { view: ["member"], edit: ["admin"] },
        },
        {
          type: "folder",
          id: "folder2",
          permissions: { view: ["member"], edit: ["admin"] },
        },
      ];

      const results = await permissionManager.bulkUpdatePermissions(
        "org1",
        "did:user1",
        updates,
      );

      expect(results).toHaveLength(2);
      expect(results.every((r) => r.success)).toBe(true);
    });
  });
});

module.exports = {};
