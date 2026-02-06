/**
 * Permission Engine Unit Tests
 *
 * Tests for the core RBAC permission evaluation engine.
 *
 * @jest-environment node
 */

// Create mock database helper
function createMockDatabase(overrides = {}) {
  const defaultPrepare = () => ({
    run: () => {},
    get: () => null,
    all: () => [],
  });

  return {
    getDatabase: () => ({
      prepare: overrides.prepare || defaultPrepare,
    }),
  };
}

// Import after setting up mocks
const { PermissionEngine } = require("../permission-engine.js");

describe("PermissionEngine", () => {
  let engine;
  let mockDatabase;

  beforeEach(() => {
    mockDatabase = createMockDatabase();
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
      expect(result.grantId).toBeDefined();
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
        expiresAt: Date.now() + 86400000,
        grantedBy: "admin-789",
      };

      const result = await engine.grantPermission(params);

      expect(result.success).toBe(true);
    });

    it("should invalidate cache after granting permission", async () => {
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
      mockDatabase = createMockDatabase({
        prepare: () => ({
          run: () => {
            throw new Error("UNIQUE constraint failed");
          },
        }),
      });
      engine = new PermissionEngine(mockDatabase);

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
      mockDatabase = createMockDatabase({
        prepare: () => ({
          run: () => {
            throw new Error("Database connection failed");
          },
        }),
      });
      engine = new PermissionEngine(mockDatabase);

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
        resourceId: null,
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

      mockDatabase = createMockDatabase({
        prepare: () => ({
          get: () => mockGrant,
          run: () => {},
        }),
      });
      engine = new PermissionEngine(mockDatabase);

      const result = await engine.revokePermission("grant-123", "admin-789");

      expect(result.success).toBe(true);
    });

    it("should return error if grant not found", async () => {
      mockDatabase = createMockDatabase({
        prepare: () => ({
          get: () => null,
        }),
      });
      engine = new PermissionEngine(mockDatabase);

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

      mockDatabase = createMockDatabase({
        prepare: () => ({
          get: () => mockGrant,
          run: () => {},
        }),
      });
      engine = new PermissionEngine(mockDatabase);

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
    });

    it("should check direct user permission", async () => {
      mockDatabase = createMockDatabase({
        prepare: () => ({
          get: () => ({ 1: 1 }),
          all: () => [],
        }),
      });
      engine = new PermissionEngine(mockDatabase);

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

    it("should return false when no permission found", async () => {
      mockDatabase = createMockDatabase({
        prepare: () => ({
          get: () => null,
          all: () => [],
        }),
      });
      engine = new PermissionEngine(mockDatabase);

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
      mockDatabase = createMockDatabase({
        prepare: () => ({
          get: () => ({ 1: 1 }),
          all: () => [],
        }),
      });
      engine = new PermissionEngine(mockDatabase);

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

      mockDatabase = createMockDatabase({
        prepare: () => ({
          get: () => ({ role: "member" }),
          all: () => mockDirectPerms,
        }),
      });
      engine = new PermissionEngine(mockDatabase);

      const result = await engine.getUserPermissions("user-123", "org-1");

      expect(result.success).toBe(true);
      expect(result.permissions).toHaveProperty("direct");
      expect(result.permissions).toHaveProperty("role");
      expect(result.permissions).toHaveProperty("team");
      expect(result.permissions).toHaveProperty("delegated");
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

      mockDatabase = createMockDatabase({
        prepare: () => ({
          all: () => mockGrants,
        }),
      });
      engine = new PermissionEngine(mockDatabase);

      const result = await engine.getResourcePermissions(
        "org-1",
        "document",
        "doc-123"
      );

      expect(result.success).toBe(true);
      expect(result.grants).toHaveLength(2);
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

      const result = await engine.bulkGrant(grants, "admin-789");

      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(2);
    });
  });

  // ========================================
  // getEffectivePermissions Tests
  // ========================================

  describe("getEffectivePermissions", () => {
    it("should combine permissions from all sources", async () => {
      mockDatabase = createMockDatabase({
        prepare: () => ({
          get: () => ({ role: "editor" }),
          all: () => [
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
          ],
        }),
      });
      engine = new PermissionEngine(mockDatabase);

      const result = await engine.getEffectivePermissions(
        "user-123",
        "org-1",
        "document",
        "doc-1"
      );

      expect(result.success).toBe(true);
      expect(Array.isArray(result.permissions)).toBe(true);
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
      expect(result.inheritanceId).toBeDefined();
    });

    it("should allow inheriting all permissions (null)", async () => {
      const params = {
        orgId: "org-1",
        parentResourceType: "folder",
        parentResourceId: "folder-1",
        childResourceType: "document",
        childResourceId: "doc-1",
        inheritPermissions: null,
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
        timestamp: Date.now() - 120000,
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
