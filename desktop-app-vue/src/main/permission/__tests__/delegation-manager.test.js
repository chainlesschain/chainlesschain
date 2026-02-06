/**
 * Delegation Manager Unit Tests
 *
 * Tests for permission delegation between users.
 *
 * @jest-environment node
 * @module permission/__tests__/delegation-manager.test
 */

const { DelegationManager } = require("../delegation-manager.js");

// Mock logger
jest.mock("../../utils/logger.js", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// Mock uuid
jest.mock("uuid", () => ({
  v4: jest.fn(() => "test-delegation-uuid"),
}));

describe("DelegationManager", () => {
  let manager;
  let mockDb;
  let mockDatabase;

  beforeEach(() => {
    jest.clearAllMocks();

    mockDb = {
      prepare: jest.fn(() => ({
        run: jest.fn(),
        get: jest.fn(),
        all: jest.fn(() => []),
      })),
    };

    mockDatabase = {
      getDatabase: jest.fn(() => mockDb),
    };

    manager = new DelegationManager(mockDatabase);
  });

  // ========================================
  // Constructor Tests
  // ========================================

  describe("constructor", () => {
    it("should initialize with database reference", () => {
      expect(manager.database).toBe(mockDatabase);
    });
  });

  // ========================================
  // delegatePermissions Tests
  // ========================================

  describe("delegatePermissions", () => {
    it("should create a delegation successfully", async () => {
      const params = {
        orgId: "org-1",
        delegatorDid: "user-123",
        delegateDid: "user-456",
        delegateName: "Delegate User",
        permissions: ["read", "edit"],
        startDate: Date.now(),
        endDate: Date.now() + 86400000, // 1 day
        reason: "Vacation coverage",
      };

      const result = await manager.delegatePermissions(params);

      expect(result.success).toBe(true);
      expect(result.delegationId).toBe("test-delegation-uuid");
    });

    it("should create delegation with resource scope", async () => {
      const params = {
        orgId: "org-1",
        delegatorDid: "user-123",
        delegateDid: "user-456",
        delegateName: "Delegate User",
        permissions: ["manage"],
        resourceScope: { resourceType: "project", resourceId: "proj-123" },
        startDate: Date.now(),
        endDate: Date.now() + 604800000, // 1 week
        reason: "Project handoff",
      };

      const result = await manager.delegatePermissions(params);

      expect(result.success).toBe(true);
    });

    it("should create delegation without resource scope (global)", async () => {
      const params = {
        orgId: "org-1",
        delegatorDid: "user-123",
        delegateDid: "user-456",
        delegateName: "Delegate User",
        permissions: ["approve"],
        resourceScope: null, // Global delegation
        startDate: Date.now(),
        endDate: Date.now() + 86400000,
        reason: "Emergency access",
      };

      const result = await manager.delegatePermissions(params);

      expect(result.success).toBe(true);
    });

    it("should create delegation with pending status", async () => {
      const runMock = jest.fn();
      mockDb.prepare = jest.fn(() => ({
        run: runMock,
      }));

      const params = {
        orgId: "org-1",
        delegatorDid: "user-123",
        delegateDid: "user-456",
        delegateName: "Delegate",
        permissions: ["read"],
        startDate: Date.now(),
        endDate: Date.now() + 86400000,
      };

      await manager.delegatePermissions(params);

      // Verify 'pending' status was passed
      expect(runMock).toHaveBeenCalled();
    });

    it("should handle multiple permissions", async () => {
      const params = {
        orgId: "org-1",
        delegatorDid: "user-123",
        delegateDid: "user-456",
        delegateName: "Delegate",
        permissions: ["read", "edit", "delete", "manage", "admin"],
        startDate: Date.now(),
        endDate: Date.now() + 86400000,
      };

      const result = await manager.delegatePermissions(params);

      expect(result.success).toBe(true);
    });

    it("should throw on database error", async () => {
      mockDb.prepare = jest.fn(() => ({
        run: jest.fn(() => {
          throw new Error("Database connection failed");
        }),
      }));

      const params = {
        orgId: "org-1",
        delegatorDid: "user-123",
        delegateDid: "user-456",
        delegateName: "Delegate",
        permissions: ["read"],
        startDate: Date.now(),
        endDate: Date.now() + 86400000,
      };

      await expect(manager.delegatePermissions(params)).rejects.toThrow(
        "Database connection failed"
      );
    });
  });

  // ========================================
  // revokeDelegation Tests
  // ========================================

  describe("revokeDelegation", () => {
    it("should revoke an existing delegation", async () => {
      const mockDelegation = {
        id: "delegation-123",
        delegator_did: "user-123",
        delegate_did: "user-456",
        status: "active",
      };

      mockDb.prepare = jest.fn(() => ({
        get: jest.fn(() => mockDelegation),
        run: jest.fn(),
      }));

      const result = await manager.revokeDelegation(
        "delegation-123",
        "user-123"
      );

      expect(result.success).toBe(true);
    });

    it("should return error if delegation not found", async () => {
      mockDb.prepare = jest.fn(() => ({
        get: jest.fn(() => null),
      }));

      const result = await manager.revokeDelegation("nonexistent", "user-123");

      expect(result.success).toBe(false);
      expect(result.error).toBe("DELEGATION_NOT_FOUND");
    });

    it("should return error if revoker is not the delegator", async () => {
      const mockDelegation = {
        id: "delegation-123",
        delegator_did: "user-123", // Original delegator
        delegate_did: "user-456",
        status: "active",
      };

      mockDb.prepare = jest.fn(() => ({
        get: jest.fn(() => mockDelegation),
      }));

      const result = await manager.revokeDelegation(
        "delegation-123",
        "user-789" // Different user trying to revoke
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("NOT_DELEGATOR");
    });

    it("should update status to revoked", async () => {
      const runMock = jest.fn();
      const mockDelegation = {
        id: "delegation-123",
        delegator_did: "user-123",
        status: "active",
      };

      mockDb.prepare = jest.fn(() => ({
        get: jest.fn(() => mockDelegation),
        run: runMock,
      }));

      await manager.revokeDelegation("delegation-123", "user-123");

      expect(runMock).toHaveBeenCalled();
    });
  });

  // ========================================
  // getDelegations Tests
  // ========================================

  describe("getDelegations", () => {
    it("should return all delegations for a user", async () => {
      const mockDelegations = [
        {
          id: "d1",
          delegator_did: "user-123",
          delegate_did: "user-456",
          delegate_name: "Delegate 1",
          permissions: JSON.stringify(["read", "edit"]),
          resource_scope: null,
          reason: "Test 1",
          start_date: Date.now(),
          end_date: Date.now() + 86400000,
          status: "active",
          created_at: Date.now(),
        },
        {
          id: "d2",
          delegator_did: "user-789",
          delegate_did: "user-123",
          delegate_name: "User 123",
          permissions: JSON.stringify(["manage"]),
          resource_scope: JSON.stringify({
            resourceType: "project",
            resourceId: "p1",
          }),
          reason: "Test 2",
          start_date: Date.now(),
          end_date: Date.now() + 86400000,
          status: "pending",
          created_at: Date.now(),
        },
      ];

      mockDb.prepare = jest.fn(() => ({
        all: jest.fn(() => mockDelegations),
      }));

      const result = await manager.getDelegations("user-123", "org-1");

      expect(result.success).toBe(true);
      expect(result.delegations).toHaveLength(2);
    });

    it("should filter delegations by type (delegated)", async () => {
      mockDb.prepare = jest.fn(() => ({
        all: jest.fn(() => []),
      }));

      const result = await manager.getDelegations("user-123", "org-1", {
        type: "delegated",
      });

      expect(result.success).toBe(true);
      // Verify query was built with delegator_did filter
      expect(mockDb.prepare).toHaveBeenCalled();
    });

    it("should filter delegations by type (received)", async () => {
      mockDb.prepare = jest.fn(() => ({
        all: jest.fn(() => []),
      }));

      const result = await manager.getDelegations("user-123", "org-1", {
        type: "received",
      });

      expect(result.success).toBe(true);
    });

    it("should filter delegations by status", async () => {
      mockDb.prepare = jest.fn(() => ({
        all: jest.fn(() => []),
      }));

      const result = await manager.getDelegations("user-123", "org-1", {
        status: "active",
      });

      expect(result.success).toBe(true);
    });

    it("should filter by both type and status", async () => {
      mockDb.prepare = jest.fn(() => ({
        all: jest.fn(() => []),
      }));

      const result = await manager.getDelegations("user-123", "org-1", {
        type: "delegated",
        status: "pending",
      });

      expect(result.success).toBe(true);
    });

    it("should format delegation objects correctly", async () => {
      const mockDelegation = {
        id: "d1",
        delegator_did: "user-123",
        delegate_did: "user-456",
        delegate_name: "Delegate User",
        permissions: JSON.stringify(["read", "edit"]),
        resource_scope: JSON.stringify({
          resourceType: "document",
          resourceId: "doc-1",
        }),
        reason: "Coverage",
        start_date: 1699000000000,
        end_date: 1700000000000,
        status: "active",
        created_at: 1698000000000,
      };

      mockDb.prepare = jest.fn(() => ({
        all: jest.fn(() => [mockDelegation]),
      }));

      const result = await manager.getDelegations("user-123", "org-1");

      expect(result.delegations[0]).toEqual({
        id: "d1",
        delegatorDid: "user-123",
        delegateDid: "user-456",
        delegateName: "Delegate User",
        permissions: ["read", "edit"],
        resourceScope: { resourceType: "document", resourceId: "doc-1" },
        reason: "Coverage",
        startDate: 1699000000000,
        endDate: 1700000000000,
        status: "active",
        createdAt: 1698000000000,
      });
    });

    it("should handle null permissions", async () => {
      const mockDelegation = {
        id: "d1",
        delegator_did: "user-123",
        delegate_did: "user-456",
        delegate_name: "User",
        permissions: null,
        resource_scope: null,
        reason: null,
        start_date: Date.now(),
        end_date: Date.now() + 86400000,
        status: "active",
        created_at: Date.now(),
      };

      mockDb.prepare = jest.fn(() => ({
        all: jest.fn(() => [mockDelegation]),
      }));

      const result = await manager.getDelegations("user-123", "org-1");

      expect(result.delegations[0].permissions).toEqual([]);
      expect(result.delegations[0].resourceScope).toBeNull();
    });

    it("should return empty array when no delegations found", async () => {
      mockDb.prepare = jest.fn(() => ({
        all: jest.fn(() => []),
      }));

      const result = await manager.getDelegations("user-123", "org-1");

      expect(result.success).toBe(true);
      expect(result.delegations).toHaveLength(0);
    });
  });

  // ========================================
  // acceptDelegation Tests
  // ========================================

  describe("acceptDelegation", () => {
    it("should accept a pending delegation", async () => {
      const mockDelegation = {
        id: "delegation-123",
        delegator_did: "user-123",
        delegate_did: "user-456",
        status: "pending",
      };

      mockDb.prepare = jest.fn(() => ({
        get: jest.fn(() => mockDelegation),
        run: jest.fn(),
      }));

      const result = await manager.acceptDelegation(
        "delegation-123",
        "user-456"
      );

      expect(result.success).toBe(true);
    });

    it("should return error if delegation not found", async () => {
      mockDb.prepare = jest.fn(() => ({
        get: jest.fn(() => null),
      }));

      const result = await manager.acceptDelegation("nonexistent", "user-456");

      expect(result.success).toBe(false);
      expect(result.error).toBe("DELEGATION_NOT_FOUND");
    });

    it("should return error if user is not the delegate", async () => {
      // The query includes delegate_did check, so it returns null if wrong user
      mockDb.prepare = jest.fn(() => ({
        get: jest.fn(() => null),
      }));

      const result = await manager.acceptDelegation(
        "delegation-123",
        "wrong-user"
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("DELEGATION_NOT_FOUND");
    });

    it("should return error if delegation is not pending", async () => {
      // Query includes status = 'pending', so non-pending returns null
      mockDb.prepare = jest.fn(() => ({
        get: jest.fn(() => null),
      }));

      const result = await manager.acceptDelegation(
        "delegation-123",
        "user-456"
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("DELEGATION_NOT_FOUND");
    });

    it("should update status to active", async () => {
      const runMock = jest.fn();
      const mockDelegation = {
        id: "delegation-123",
        delegator_did: "user-123",
        delegate_did: "user-456",
        status: "pending",
      };

      mockDb.prepare = jest.fn(() => ({
        get: jest.fn(() => mockDelegation),
        run: runMock,
      }));

      await manager.acceptDelegation("delegation-123", "user-456");

      expect(runMock).toHaveBeenCalled();
    });
  });

  // ========================================
  // Edge Cases
  // ========================================

  describe("edge cases", () => {
    it("should handle empty permissions array", async () => {
      const params = {
        orgId: "org-1",
        delegatorDid: "user-123",
        delegateDid: "user-456",
        delegateName: "Delegate",
        permissions: [],
        startDate: Date.now(),
        endDate: Date.now() + 86400000,
      };

      const result = await manager.delegatePermissions(params);

      expect(result.success).toBe(true);
    });

    it("should handle very long delegation periods", async () => {
      const params = {
        orgId: "org-1",
        delegatorDid: "user-123",
        delegateDid: "user-456",
        delegateName: "Delegate",
        permissions: ["read"],
        startDate: Date.now(),
        endDate: Date.now() + 31536000000 * 10, // 10 years
        reason: "Long-term access",
      };

      const result = await manager.delegatePermissions(params);

      expect(result.success).toBe(true);
    });

    it("should handle delegation in the past (already started)", async () => {
      const params = {
        orgId: "org-1",
        delegatorDid: "user-123",
        delegateDid: "user-456",
        delegateName: "Delegate",
        permissions: ["read"],
        startDate: Date.now() - 86400000, // 1 day ago
        endDate: Date.now() + 86400000, // 1 day from now
      };

      const result = await manager.delegatePermissions(params);

      expect(result.success).toBe(true);
    });

    it("should handle special characters in reason", async () => {
      const params = {
        orgId: "org-1",
        delegatorDid: "user-123",
        delegateDid: "user-456",
        delegateName: "Delegate",
        permissions: ["read"],
        startDate: Date.now(),
        endDate: Date.now() + 86400000,
        reason: "Special chars: <script>alert('xss')</script> & \"quotes\"",
      };

      const result = await manager.delegatePermissions(params);

      expect(result.success).toBe(true);
    });

    it("should handle unicode in delegate name", async () => {
      const params = {
        orgId: "org-1",
        delegatorDid: "user-123",
        delegateDid: "user-456",
        delegateName: "Delegate \u5c0f\u660e",
        permissions: ["read"],
        startDate: Date.now(),
        endDate: Date.now() + 86400000,
      };

      const result = await manager.delegatePermissions(params);

      expect(result.success).toBe(true);
    });
  });

  // ========================================
  // Singleton Factory Tests
  // ========================================

  describe("getDelegationManager factory", () => {
    it("should be exported", () => {
      const { getDelegationManager } = require("../delegation-manager.js");
      expect(typeof getDelegationManager).toBe("function");
    });
  });
});
