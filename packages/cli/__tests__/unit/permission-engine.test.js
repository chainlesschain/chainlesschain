import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  ensurePermissionTables,
  getRoles,
  createRole,
  deleteRole,
  grantRole,
  revokeRole,
  grantPermission,
  revokePermission,
  getUserPermissions,
  checkPermission,
  getRoleGrants,
  listUserRoles,
  BUILT_IN_ROLES,
  PERMISSION_SCOPES,
} from "../../src/lib/permission-engine.js";

describe("Permission Engine", () => {
  let db;

  beforeEach(() => {
    db = new MockDatabase();
  });

  // ─── ensurePermissionTables ───────────────────────────────

  describe("ensurePermissionTables", () => {
    it("should create required tables", () => {
      ensurePermissionTables(db);
      expect(db.tables.has("rbac_roles")).toBe(true);
      expect(db.tables.has("rbac_grants")).toBe(true);
      expect(db.tables.has("rbac_direct_permissions")).toBe(true);
    });

    it("should seed built-in roles", () => {
      ensurePermissionTables(db);
      const roles = db.data.get("rbac_roles");
      expect(roles.length).toBeGreaterThanOrEqual(4);
    });

    it("should be idempotent", () => {
      ensurePermissionTables(db);
      ensurePermissionTables(db);
      // Should not duplicate built-in roles
      const roles = db.data.get("rbac_roles");
      const adminRoles = roles.filter((r) => r.name === "admin");
      expect(adminRoles).toHaveLength(1);
    });
  });

  // ─── BUILT_IN_ROLES ──────────────────────────────────────

  describe("BUILT_IN_ROLES", () => {
    it("should have admin, editor, viewer, agent roles", () => {
      expect(BUILT_IN_ROLES.admin).toBeDefined();
      expect(BUILT_IN_ROLES.editor).toBeDefined();
      expect(BUILT_IN_ROLES.viewer).toBeDefined();
      expect(BUILT_IN_ROLES.agent).toBeDefined();
    });

    it("admin should have wildcard permission", () => {
      expect(BUILT_IN_ROLES.admin.permissions).toContain("*");
    });
  });

  // ─── PERMISSION_SCOPES ───────────────────────────────────

  describe("PERMISSION_SCOPES", () => {
    it("should have at least 20 scopes", () => {
      expect(PERMISSION_SCOPES.length).toBeGreaterThanOrEqual(20);
    });

    it("should follow resource:action format", () => {
      for (const scope of PERMISSION_SCOPES) {
        expect(scope).toMatch(/^\w+:\w+$/);
      }
    });
  });

  // ─── getRoles ─────────────────────────────────────────────

  describe("getRoles", () => {
    it("should return built-in roles", () => {
      const roles = getRoles(db);
      expect(roles.length).toBeGreaterThanOrEqual(4);
      const names = roles.map((r) => r.name);
      expect(names).toContain("admin");
      expect(names).toContain("editor");
    });

    it("should parse permissions as arrays", () => {
      const roles = getRoles(db);
      const admin = roles.find((r) => r.name === "admin");
      expect(Array.isArray(admin.permissions)).toBe(true);
    });
  });

  // ─── createRole ───────────────────────────────────────────

  describe("createRole", () => {
    it("should create a custom role", () => {
      ensurePermissionTables(db);
      const role = createRole(db, "moderator", "Content moderator", [
        "note:read",
        "note:write",
      ]);
      expect(role.name).toBe("moderator");
      expect(role.permissions).toEqual(["note:read", "note:write"]);
      expect(role.isBuiltin).toBe(false);
    });

    it("should throw when overriding built-in role", () => {
      ensurePermissionTables(db);
      expect(() => createRole(db, "admin", "Override")).toThrow("built-in");
    });

    it("should throw for duplicate role", () => {
      ensurePermissionTables(db);
      createRole(db, "custom1", "First");
      expect(() => createRole(db, "custom1", "Duplicate")).toThrow(
        "already exists",
      );
    });
  });

  // ─── deleteRole ───────────────────────────────────────────

  describe("deleteRole", () => {
    it("should delete a custom role", () => {
      ensurePermissionTables(db);
      createRole(db, "temp", "Temporary");
      const ok = deleteRole(db, "temp");
      expect(ok).toBe(true);
    });

    it("should not delete built-in role", () => {
      ensurePermissionTables(db);
      expect(() => deleteRole(db, "admin")).toThrow("built-in");
    });

    it("should return false for non-existent role", () => {
      ensurePermissionTables(db);
      expect(deleteRole(db, "nonexistent")).toBe(false);
    });
  });

  // ─── grantRole ────────────────────────────────────────────

  describe("grantRole", () => {
    it("should grant a role to a user", () => {
      ensurePermissionTables(db);
      const grant = grantRole(db, "did:chainless:alice", "editor");
      expect(grant.id).toBeDefined();
      expect(grant.userDid).toBe("did:chainless:alice");
      expect(grant.roleName).toBe("editor");
    });

    it("should throw for non-existent role", () => {
      ensurePermissionTables(db);
      expect(() => grantRole(db, "did:chainless:alice", "nonexistent")).toThrow(
        "not found",
      );
    });

    it("should allow granting with expiration", () => {
      ensurePermissionTables(db);
      const grant = grantRole(
        db,
        "did:chainless:alice",
        "admin",
        null,
        "2030-01-01T00:00:00Z",
      );
      expect(grant.expiresAt).toBe("2030-01-01T00:00:00Z");
    });
  });

  // ─── revokeRole ───────────────────────────────────────────

  describe("revokeRole", () => {
    it("should revoke a granted role", () => {
      ensurePermissionTables(db);
      grantRole(db, "did:chainless:alice", "editor");
      const ok = revokeRole(db, "did:chainless:alice", "editor");
      expect(ok).toBe(true);
    });

    it("should return false when no grant exists", () => {
      ensurePermissionTables(db);
      expect(revokeRole(db, "did:chainless:nobody", "editor")).toBe(false);
    });
  });

  // ─── grantPermission / revokePermission ───────────────────

  describe("direct permissions", () => {
    it("should grant a direct permission", () => {
      ensurePermissionTables(db);
      const result = grantPermission(db, "did:chainless:bob", "note:read");
      expect(result.permission).toBe("note:read");
    });

    it("should revoke a direct permission", () => {
      ensurePermissionTables(db);
      grantPermission(db, "did:chainless:bob", "note:read");
      const ok = revokePermission(db, "did:chainless:bob", "note:read");
      expect(ok).toBe(true);
    });

    it("should return false when revoking non-existent permission", () => {
      ensurePermissionTables(db);
      expect(revokePermission(db, "did:chainless:bob", "nonexistent")).toBe(
        false,
      );
    });
  });

  // ─── getUserPermissions ───────────────────────────────────

  describe("getUserPermissions", () => {
    it("should return empty permissions for unknown user", () => {
      ensurePermissionTables(db);
      const perms = getUserPermissions(db, "did:chainless:unknown");
      expect(perms.roles).toHaveLength(0);
      expect(perms.effectivePermissions).toHaveLength(0);
      expect(perms.isAdmin).toBe(false);
    });

    it("should include role permissions", () => {
      ensurePermissionTables(db);
      grantRole(db, "did:chainless:alice", "viewer");
      const perms = getUserPermissions(db, "did:chainless:alice");
      expect(perms.roles).toContain("viewer");
      expect(perms.effectivePermissions).toContain("note:read");
    });

    it("should detect admin status", () => {
      ensurePermissionTables(db);
      grantRole(db, "did:chainless:alice", "admin");
      const perms = getUserPermissions(db, "did:chainless:alice");
      expect(perms.isAdmin).toBe(true);
    });

    it("should include direct permissions", () => {
      ensurePermissionTables(db);
      grantPermission(db, "did:chainless:bob", "config:write");
      const perms = getUserPermissions(db, "did:chainless:bob");
      expect(perms.directPermissions).toContain("config:write");
      expect(perms.effectivePermissions).toContain("config:write");
    });

    it("should merge role and direct permissions", () => {
      ensurePermissionTables(db);
      grantRole(db, "did:chainless:carol", "viewer");
      grantPermission(db, "did:chainless:carol", "config:write");
      const perms = getUserPermissions(db, "did:chainless:carol");
      expect(perms.effectivePermissions).toContain("note:read"); // from viewer
      expect(perms.effectivePermissions).toContain("config:write"); // direct
    });
  });

  // ─── checkPermission ──────────────────────────────────────

  describe("checkPermission", () => {
    it("should allow admin to do anything", () => {
      ensurePermissionTables(db);
      grantRole(db, "did:chainless:alice", "admin");
      expect(checkPermission(db, "did:chainless:alice", "anything:goes")).toBe(
        true,
      );
    });

    it("should allow granted permission", () => {
      ensurePermissionTables(db);
      grantRole(db, "did:chainless:bob", "viewer");
      expect(checkPermission(db, "did:chainless:bob", "note:read")).toBe(true);
    });

    it("should deny non-granted permission", () => {
      ensurePermissionTables(db);
      grantRole(db, "did:chainless:bob", "viewer");
      expect(checkPermission(db, "did:chainless:bob", "note:delete")).toBe(
        false,
      );
    });

    it("should check direct permissions", () => {
      ensurePermissionTables(db);
      grantPermission(db, "did:chainless:carol", "audit:read");
      expect(checkPermission(db, "did:chainless:carol", "audit:read")).toBe(
        true,
      );
      expect(checkPermission(db, "did:chainless:carol", "audit:write")).toBe(
        false,
      );
    });
  });

  // ─── getRoleGrants ────────────────────────────────────────

  describe("getRoleGrants", () => {
    it("should return grants for a role", () => {
      ensurePermissionTables(db);
      grantRole(db, "did:chainless:alice", "editor");
      grantRole(db, "did:chainless:bob", "editor");
      const grants = getRoleGrants(db, "editor");
      expect(grants).toHaveLength(2);
    });

    it("should return empty for role with no grants", () => {
      ensurePermissionTables(db);
      expect(getRoleGrants(db, "viewer")).toHaveLength(0);
    });
  });

  // ─── listUserRoles ────────────────────────────────────────

  describe("listUserRoles", () => {
    it("should list users with their roles", () => {
      ensurePermissionTables(db);
      grantRole(db, "did:chainless:alice", "admin");
      grantRole(db, "did:chainless:bob", "viewer");

      const users = listUserRoles(db);
      expect(users.length).toBeGreaterThanOrEqual(2);
    });

    it("should return empty when no grants exist", () => {
      ensurePermissionTables(db);
      expect(listUserRoles(db)).toHaveLength(0);
    });
  });
});
