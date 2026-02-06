/**
 * Permission Engine Unit Tests
 *
 * Tests for the core RBAC permission evaluation engine.
 *
 * @module permission/__tests__/permission-engine.test
 */

const { describe, it, expect, beforeEach, vi } = require("vitest");
const { PermissionEngine } = require("../permission-engine.js");

// Mock logger
vi.mock("../../utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock uuid
vi.mock("uuid", () => ({
  v4: vi.fn(() => "test-uuid-123"),
}));

describe("PermissionEngine", () => {
  let engine;
  let mockDb;
  let mockDatabase;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Create mock database
    mockDb = {
      prepare: vi.fn(() => ({
        run: vi.fn(),
        get: vi.fn(),
        all: vi.fn(() => []),
      })),
    };

    mockDatabase = {
      getDatabase: vi.fn(() => mockDb),
    };

    engine = new PermissionEngine(mockDatabase);
  });

  // ========================================
  // Constructor Tests
  // ========================================

  describe("constructor", () => {
    it("should initialize with database reference", () => {
      expect(engine.database).toBe(mockDatabase);
    });

    it("should initialize empty permission cache", () => {
      expect(engine.permissionCache).toBeInstanceOf(Map);
      expect(engine.permissionCache.size).toBe(0);
    });

    it("should set default cache timeout to 60 seconds", () => {
      expect(engine.cacheTimeout).toBe(60000);
    });

    it("should extend EventEmitter", () => {
      expect(typeof engine.on).toBe("function");
      expect(typeof engine.emit).toBe("function");
    });
  });

  // ========================================
  // grantPermission Tests
  // ========================================

  describe("grantPermission", () => {
    it("should grant a permission successfully", async () => {
      const params = {
        orgId: "org-1",
        granteeType: "user",
        granteeId: "user-123",
        resourceType: "document",
        resourceId: "doc-456",
        permission: "read",
        grantedBy: "admin-789",
      };

      const result = await engine.grantPermission(params);

      expect(result.success).toBe(true);
      expect(result.grantId).toBe("test-uuid-123");
      expect(mockDb.prepare).toHaveBeenCalled();
    });

    it("should store permission with conditions", async () => {
      const params = {
        orgId: "org-1",
        granteeType: "user",
        granteeId: "user-123",
        resourceType: "document",
        resourceId: "doc-456",
        permission: "edit",
        conditions: { timeOfDay: "business_hours" },
        grantedBy: "admin-789",
      };

      const result = await engine.grantPermission(params);

      expect(result.success).toBe(true);
    });

    it("should store permission with expiration", async () => {
      const params = {
        orgId: "org-1",
        granteeType: "user",
        granteeId: "user-123",
        resourceType: "document",
        resourceId: "doc-456",
        permission: "read",
        expiresAt: Date.now() + 86400000, // 1 day
        grantedBy: "admin-789",
      };

      const result = await engine.grantPermission(params);

      expect(result.success).toBe(true);
    });

    it("should invalidate cache after granting permission", async () => {
      // Add something to cache first
      engine.permissionCache.set("user-123:test:key", {
        value: true,
        timestamp: Date.now(),
      });

      const params = {
        orgId: "org-1",
        granteeType: "user",
        granteeId: "user-123",
        resourceType: "document",
        resourceId: "doc-456",
        permission: "read",
        grantedBy: "admin-789",
      };

      await engine.grantPermission(params);

      expect(engine.permissionCache.has("user-123:test:key")).toBe(false);
    });

    it("should return error for duplicate permission", async () => {
      mockDb.prepare = vi.fn(() => ({
        run: vi.fn(() => {
          throw new Error("UNIQUE constraint failed");
        }),
      }));

      const params = {
        orgId: "org-1",
        granteeType: "user",
        granteeId: "user-123",
        resourceType: "document",
        resourceId: "doc-456",
        permission: "read",
        grantedBy: "admin-789",
      };

      const result = await engine.grantPermission(params);

      expect(result.success).toBe(false);
      expect(result.error).toBe("PERMISSION_EXISTS");
    });

    it("should throw error for other database errors", async () => {
      mockDb.prepare = vi.fn(() => ({
        run: vi.fn(() => {
          throw new Error("Database connection failed");
        }),
      }));

      const params = {
        orgId: "org-1",
        granteeType: "user",
        granteeId: "user-123",
        resourceType: "document",
        resourceId: "doc-456",
        permission: "read",
        grantedBy: "admin-789",
      };

      await expect(engine.grantPermission(params)).rejects.toThrow(
        "Database connection failed"
      );
    });

    it("should support role grantee type", async () => {
      const params = {
        orgId: "org-1",
        granteeType: "role",
        granteeId: "editor-role",
        resourceType: "document",
        resourceId: null, // All documents
        permission: "edit",
        grantedBy: "admin-789",
      };

      const result = await engine.grantPermission(params);

      expect(result.success).toBe(true);
    });

    it("should support team grantee type", async () => {
      const params = {
        orgId: "org-1",
        granteeType: "team",
        granteeId: "team-alpha",
        resourceType: "project",
        resourceId: "proj-1",
        permission: "manage",
        grantedBy: "admin-789",
      };

      const result = await engine.grantPermission(params);

      expect(result.success).toBe(true);
    });
  });

  // ========================================
  // revokePermission Tests
  // ========================================

  describe("revokePermission", () => {
    it("should revoke an existing permission", async () => {
      const mockGrant = {
        id: "grant-123",
        org_id: "org-1",
        grantee_id: "user-123",
        permission: "read",
      };

      mockDb.prepare = vi.fn(() => ({
        get: vi.fn(() => mockGrant),
        run: vi.fn(),
      }));

      const result = await engine.revokePermission("grant-123", "admin-789");

      expect(result.success).toBe(true);
    });

    it("should return error if grant not found", async () => {
      mockDb.prepare = vi.fn(() => ({
        get: vi.fn(() => null),
      }));

      const result = await engine.revokePermission("nonexistent", "admin-789");

      expect(result.success).toBe(false);
      expect(result.error).toBe("GRANT_NOT_FOUND");
    });

    it("should invalidate cache after revoking", async () => {
      const mockGrant = {
        id: "grant-123",
        org_id: "org-1",
        grantee_id: "user-123",
        permission: "read",
      };

      mockDb.prepare = vi.fn(() => ({
        get: vi.fn(() => mockGrant),
        run: vi.fn(),
      }));

      // Add to cache
      engine.permissionCache.set("user-123:cached", {
        value: true,
        timestamp: Date.now(),
      });

      await engine.revokePermission("grant-123", "admin-789");

      expect(engine.permissionCache.has("user-123:cached")).toBe(false);
    });
  });

  // ========================================
  // checkPermission Tests
  // ========================================

  describe("checkPermission", () => {
    it("should return cached result if available", async () => {
      const cacheKey = "user-123:org-1:document:doc-456:read";
      engine.permissionCache.set(cacheKey, {
        value: { success: true, hasPermission: true },
        timestamp: Date.now(),
      });

      const result = await engine.checkPermission({
        userDid: "user-123",
        orgId: "org-1",
        resourceType: "document",
        resourceId: "doc-456",
        permission: "read",
      });

      expect(result).toEqual({ success: true, hasPermission: true });
      expect(mockDb.prepare).not.toHaveBeenCalled();
    });

    it("should check direct user permission", async () => {
      mockDb.prepare = vi.fn(() => ({
        get: vi.fn(() => ({ 1: 1 })), // Permission found
        all: vi.fn(() => []),
      }));

      const result = await engine.checkPermission({
        userDid: "user-123",
        orgId: "org-1",
        resourceType: "document",
        resourceId: "doc-456",
        permission: "read",
      });

      expect(result.success).toBe(true);
      expect(result.hasPermission).toBe(true);
    });

    it("should check role-based permission when direct not found", async () => {
      let callCount = 0;
      mockDb.prepare = vi.fn(() => ({
        get: vi.fn(() => {
          callCount++;
          // First call (direct check) returns null, second (role check) returns found
          return callCount > 1 ? { 1: 1 } : null;
        }),
        all: vi.fn(() => [{ role: "editor" }]),
      }));

      const result = await engine.checkPermission({
        userDid: "user-123",
        orgId: "org-1",
        resourceType: "document",
        resourceId: "doc-456",
        permission: "edit",
      });

      expect(result.success).toBe(true);
    });

    it("should return false when no permission found", async () => {
      mockDb.prepare = vi.fn(() => ({
        get: vi.fn(() => null),
        all: vi.fn(() => []),
      }));

      const result = await engine.checkPermission({
        userDid: "user-123",
        orgId: "org-1",
        resourceType: "document",
        resourceId: "doc-456",
        permission: "admin",
      });

      expect(result.success).toBe(true);
      expect(result.hasPermission).toBe(false);
    });

    it("should cache the result", async () => {
      mockDb.prepare = vi.fn(() => ({
        get: vi.fn(() => ({ 1: 1 })),
        all: vi.fn(() => []),
      }));

      await engine.checkPermission({
        userDid: "user-123",
        orgId: "org-1",
        resourceType: "document",
        resourceId: "doc-456",
        permission: "read",
      });

      const cacheKey = "user-123:org-1:document:doc-456:read";
      expect(engine.permissionCache.has(cacheKey)).toBe(true);
    });

    it("should handle wildcard resource ID", async () => {
      mockDb.prepare = vi.fn(() => ({
        get: vi.fn(() => ({ 1: 1 })),
        all: vi.fn(() => []),
      }));

      const result = await engine.checkPermission({
        userDid: "user-123",
        orgId: "org-1",
        resourceType: "document",
        resourceId: null,
        permission: "list",
      });

      expect(result.success).toBe(true);
    });
  });

  // ========================================
  // getUserPermissions Tests
  // ========================================

  describe("getUserPermissions", () => {
    it("should return all permission types for a user", async () => {
      const mockDirectPerms = [
        {
          id: "perm-1",
          grantee_type: "user",
          grantee_id: "user-123",
          resource_type: "document",
          resource_id: "doc-1",
          permission: "read",
          conditions: null,
          expires_at: null,
          created_at: Date.now(),
        },
      ];

      mockDb.prepare = vi.fn(() => ({
        get: vi.fn(() => ({ role: "member" })),
        all: vi.fn(() => mockDirectPerms),
      }));

      const result = await engine.getUserPermissions("user-123", "org-1");

      expect(result.success).toBe(true);
      expect(result.permissions).toHaveProperty("direct");
      expect(result.permissions).toHaveProperty("role");
      expect(result.permissions).toHaveProperty("team");
      expect(result.permissions).toHaveProperty("delegated");
    });

    it("should format permissions correctly", async () => {
      const mockPerm = {
        id: "perm-1",
        grantee_type: "user",
        grantee_id: "user-123",
        resource_type: "document",
        resource_id: "doc-1",
        permission: "read",
        conditions: JSON.stringify({ ip: "192.168.1.0/24" }),
        expires_at: Date.now() + 86400000,
        created_at: Date.now(),
      };

      mockDb.prepare = vi.fn(() => ({
        get: vi.fn(() => null),
        all: vi.fn((_, type) => (type === "user" ? [mockPerm] : [])),
      }));

      const result = await engine.getUserPermissions("user-123", "org-1");

      expect(result.permissions.direct[0]).toHaveProperty("id", "perm-1");
      expect(result.permissions.direct[0]).toHaveProperty("permission", "read");
      expect(result.permissions.direct[0].conditions).toEqual({
        ip: "192.168.1.0/24",
      });
    });
  });

  // ========================================
  // getResourcePermissions Tests
  // ========================================

  describe("getResourcePermissions", () => {
    it("should return all grants for a resource", async () => {
      const mockGrants = [
        {
          id: "grant-1",
          grantee_type: "user",
          grantee_id: "user-1",
          resource_type: "document",
          resource_id: "doc-123",
          permission: "read",
          conditions: null,
          expires_at: null,
          created_at: Date.now(),
        },
        {
          id: "grant-2",
          grantee_type: "team",
          grantee_id: "team-1",
          resource_type: "document",
          resource_id: "doc-123",
          permission: "edit",
          conditions: null,
          expires_at: null,
          created_at: Date.now(),
        },
      ];

      mockDb.prepare = vi.fn(() => ({
        all: vi.fn(() => mockGrants),
      }));

      const result = await engine.getResourcePermissions(
        "org-1",
        "document",
        "doc-123"
      );

      expect(result.success).toBe(true);
      expect(result.grants).toHaveLength(2);
    });

    it("should include wildcard resource grants", async () => {
      mockDb.prepare = vi.fn(() => ({
        all: vi.fn(() => []),
      }));

      await engine.getResourcePermissions("org-1", "document", "doc-123");

      // Verify query includes both specific and null resource_id
      expect(mockDb.prepare).toHaveBeenCalled();
    });
  });

  // ========================================
  // bulkGrant Tests
  // ========================================

  describe("bulkGrant", () => {
    it("should grant multiple permissions", async () => {
      const grants = [
        {
          orgId: "org-1",
          granteeType: "user",
          granteeId: "user-1",
          resourceType: "document",
          resourceId: "doc-1",
          permission: "read",
        },
        {
          orgId: "org-1",
          granteeType: "user",
          granteeId: "user-2",
          resourceType: "document",
          resourceId: "doc-1",
          permission: "read",
        },
      ];

      mockDb.prepare = vi.fn(() => ({
        run: vi.fn(),
      }));

      const result = await engine.bulkGrant(grants, "admin-789");

      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(2);
    });

    it("should continue on individual grant errors", async () => {
      let callCount = 0;
      mockDb.prepare = vi.fn(() => ({
        run: vi.fn(() => {
          callCount++;
          if (callCount === 1) {
            throw new Error("UNIQUE constraint failed");
          }
        }),
      }));

      const grants = [
        {
          orgId: "org-1",
          granteeType: "user",
          granteeId: "user-1",
          resourceType: "document",
          resourceId: "doc-1",
          permission: "read",
        },
        {
          orgId: "org-1",
          granteeType: "user",
          granteeId: "user-2",
          resourceType: "document",
          resourceId: "doc-1",
          permission: "read",
        },
      ];

      const result = await engine.bulkGrant(grants, "admin-789");

      expect(result.results[0].success).toBe(false);
      expect(result.results[1].success).toBe(true);
    });
  });

  // ========================================
  // getEffectivePermissions Tests
  // ========================================

  describe("getEffectivePermissions", () => {
    it("should combine permissions from all sources", async () => {
      mockDb.prepare = vi.fn(() => ({
        get: vi.fn(() => ({ role: "editor" })),
        all: vi.fn(() => [
          {
            id: "p1",
            grantee_type: "user",
            grantee_id: "user-123",
            resource_type: "document",
            resource_id: "doc-1",
            permission: "read",
            conditions: null,
            expires_at: null,
            created_at: Date.now(),
          },
        ]),
      }));

      const result = await engine.getEffectivePermissions(
        "user-123",
        "org-1",
        "document",
        "doc-1"
      );

      expect(result.success).toBe(true);
      expect(Array.isArray(result.permissions)).toBe(true);
    });

    it("should deduplicate permissions", async () => {
      mockDb.prepare = vi.fn(() => ({
        get: vi.fn(() => ({ role: "editor" })),
        all: vi.fn(() => [
          {
            id: "p1",
            grantee_type: "user",
            resource_type: "document",
            resource_id: "doc-1",
            permission: "read",
            conditions: null,
            expires_at: null,
            created_at: Date.now(),
          },
          {
            id: "p2",
            grantee_type: "role",
            resource_type: "document",
            resource_id: "doc-1",
            permission: "read", // Same permission
            conditions: null,
            expires_at: null,
            created_at: Date.now(),
          },
        ]),
      }));

      const result = await engine.getEffectivePermissions(
        "user-123",
        "org-1",
        "document",
        "doc-1"
      );

      // Should have unique permissions only
      const uniquePerms = new Set(result.permissions);
      expect(uniquePerms.size).toBe(result.permissions.length);
    });
  });

  // ========================================
  // inheritPermissions Tests
  // ========================================

  describe("inheritPermissions", () => {
    it("should set up permission inheritance", async () => {
      const params = {
        orgId: "org-1",
        parentResourceType: "folder",
        parentResourceId: "folder-1",
        childResourceType: "document",
        childResourceId: "doc-1",
        inheritPermissions: ["read", "edit"],
      };

      const result = await engine.inheritPermissions(params);

      expect(result.success).toBe(true);
      expect(result.inheritanceId).toBe("test-uuid-123");
    });

    it("should allow inheriting all permissions (null)", async () => {
      const params = {
        orgId: "org-1",
        parentResourceType: "folder",
        parentResourceId: "folder-1",
        childResourceType: "document",
        childResourceId: "doc-1",
        inheritPermissions: null, // Inherit all
      };

      const result = await engine.inheritPermissions(params);

      expect(result.success).toBe(true);
    });
  });

  // ========================================
  // Cache Tests
  // ========================================

  describe("cache operations", () => {
    it("should return undefined for expired cache entries", () => {
      const key = "test-key";
      engine.permissionCache.set(key, {
        value: true,
        timestamp: Date.now() - 120000, // 2 minutes ago (expired)
      });

      const result = engine._getFromCache(key);

      expect(result).toBeUndefined();
    });

    it("should return value for valid cache entries", () => {
      const key = "test-key";
      engine.permissionCache.set(key, {
        value: { hasPermission: true },
        timestamp: Date.now(),
      });

      const result = engine._getFromCache(key);

      expect(result).toEqual({ hasPermission: true });
    });

    it("should invalidate all cache entries for a grantee", () => {
      engine.permissionCache.set("user-123:a", {
        value: true,
        timestamp: Date.now(),
      });
      engine.permissionCache.set("user-123:b", {
        value: true,
        timestamp: Date.now(),
      });
      engine.permissionCache.set("user-456:a", {
        value: true,
        timestamp: Date.now(),
      });

      engine._invalidateCache("user-123");

      expect(engine.permissionCache.has("user-123:a")).toBe(false);
      expect(engine.permissionCache.has("user-123:b")).toBe(false);
      expect(engine.permissionCache.has("user-456:a")).toBe(true);
    });
  });

  // ========================================
  // Audit Logging Tests
  // ========================================

  describe("audit logging", () => {
    it("should log permission grant to audit table", async () => {
      const runMock = vi.fn();
      mockDb.prepare = vi.fn(() => ({
        run: runMock,
      }));

      await engine._logPermissionAudit(
        "org-1",
        "admin-123",
        "grant",
        "read",
        { resourceType: "document", resourceId: "doc-1" }
      );

      expect(mockDb.prepare).toHaveBeenCalled();
      expect(runMock).toHaveBeenCalled();
    });

    it("should handle audit logging errors gracefully", async () => {
      mockDb.prepare = vi.fn(() => ({
        run: vi.fn(() => {
          throw new Error("Audit table not found");
        }),
      }));

      // Should not throw
      await expect(
        engine._logPermissionAudit("org-1", "admin-123", "grant", "read", {})
      ).resolves.not.toThrow();
    });
  });

  // ========================================
  // Format Grant Tests
  // ========================================

  describe("_formatGrant", () => {
    it("should format grant object correctly", () => {
      const grant = {
        id: "grant-123",
        grantee_type: "user",
        grantee_id: "user-456",
        resource_type: "document",
        resource_id: "doc-789",
        permission: "read",
        conditions: JSON.stringify({ ip: "192.168.1.0/24" }),
        expires_at: 1700000000000,
        created_at: 1699000000000,
      };

      const formatted = engine._formatGrant(grant);

      expect(formatted).toEqual({
        id: "grant-123",
        granteeType: "user",
        granteeId: "user-456",
        resourceType: "document",
        resourceId: "doc-789",
        permission: "read",
        conditions: { ip: "192.168.1.0/24" },
        expiresAt: 1700000000000,
        createdAt: 1699000000000,
      });
    });

    it("should handle null conditions", () => {
      const grant = {
        id: "grant-123",
        grantee_type: "user",
        grantee_id: "user-456",
        resource_type: "document",
        resource_id: null,
        permission: "read",
        conditions: null,
        expires_at: null,
        created_at: 1699000000000,
      };

      const formatted = engine._formatGrant(grant);

      expect(formatted.conditions).toBeNull();
      expect(formatted.resourceId).toBeNull();
      expect(formatted.expiresAt).toBeNull();
    });
  });
});
