import { describe, it, expect, beforeEach } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";
import {
  ensureSCIMTables,
  listUsers,
  createUser,
  getUser,
  deleteUser,
  listConnectors,
  addConnector,
  syncProvision,
  getStatus,
  _resetState,
} from "../../src/lib/scim-manager.js";

describe("scim-manager", () => {
  let db;

  beforeEach(() => {
    db = new MockDatabase();
    _resetState();
    ensureSCIMTables(db);
  });

  describe("ensureSCIMTables", () => {
    it("creates scim_resources and scim_sync_log tables", () => {
      expect(db.tables.has("scim_resources")).toBe(true);
      expect(db.tables.has("scim_sync_log")).toBe(true);
    });

    it("is idempotent", () => {
      ensureSCIMTables(db);
      expect(db.tables.has("scim_resources")).toBe(true);
    });
  });

  describe("createUser", () => {
    it("creates a user", () => {
      const u = createUser(db, "alice", "Alice Smith", "alice@example.com");
      expect(u.id).toBeDefined();
      expect(u.userName).toBe("alice");
      expect(u.displayName).toBe("Alice Smith");
      expect(u.email).toBe("alice@example.com");
      expect(u.active).toBe(true);
    });

    it("throws on missing username", () => {
      expect(() => createUser(db, "")).toThrow("Username is required");
    });

    it("throws on duplicate username", () => {
      createUser(db, "alice");
      expect(() => createUser(db, "alice")).toThrow("User already exists");
    });

    it("defaults display name to username", () => {
      const u = createUser(db, "bob");
      expect(u.displayName).toBe("bob");
    });

    it("persists to database", () => {
      createUser(db, "alice");
      const rows = db.data.get("scim_resources") || [];
      expect(rows.length).toBe(1);
    });
  });

  describe("getUser", () => {
    it("returns null for unknown user", () => {
      expect(getUser("nonexistent")).toBeNull();
    });

    it("returns user by ID", () => {
      const u = createUser(db, "alice");
      const found = getUser(u.id);
      expect(found.userName).toBe("alice");
    });
  });

  describe("deleteUser", () => {
    it("deletes a user", () => {
      const u = createUser(db, "alice");
      const result = deleteUser(db, u.id);
      expect(result.success).toBe(true);
      expect(getUser(u.id)).toBeNull();
    });

    it("throws on unknown user", () => {
      expect(() => deleteUser(db, "nonexistent")).toThrow("User not found");
    });
  });

  describe("listUsers", () => {
    it("returns empty initially", () => {
      const r = listUsers();
      expect(r.totalResults).toBe(0);
      expect(r.resources).toEqual([]);
    });

    it("lists all users", () => {
      createUser(db, "alice");
      createUser(db, "bob");
      const r = listUsers();
      expect(r.totalResults).toBe(2);
    });

    it("respects limit", () => {
      for (let i = 0; i < 5; i++) createUser(db, `user${i}`);
      const r = listUsers({ limit: 3 });
      expect(r.resources.length).toBe(3);
      expect(r.totalResults).toBe(5);
    });
  });

  describe("addConnector / listConnectors", () => {
    it("returns empty initially", () => {
      expect(listConnectors()).toEqual([]);
    });

    it("adds a connector", () => {
      const c = addConnector(db, "Okta", "okta", { apiKey: "xxx" });
      expect(c.id).toBeDefined();
      expect(c.name).toBe("Okta");
      expect(c.provider).toBe("okta");
      expect(c.status).toBe("active");
    });

    it("throws on missing name", () => {
      expect(() => addConnector(db, "")).toThrow("Connector name is required");
    });

    it("lists connectors", () => {
      addConnector(db, "Okta", "okta");
      addConnector(db, "Azure AD", "azure");
      expect(listConnectors().length).toBe(2);
    });
  });

  describe("syncProvision", () => {
    it("syncs via connector", () => {
      const c = addConnector(db, "Okta", "okta");
      const r = syncProvision(db, c.id);
      expect(r.success).toBe(true);
      expect(r.connector).toBe("Okta");
    });

    it("throws on unknown connector", () => {
      expect(() => syncProvision(db, "nonexistent")).toThrow(
        "Connector not found",
      );
    });

    it("logs sync operation", () => {
      const c = addConnector(db, "Okta", "okta");
      syncProvision(db, c.id);
      const rows = db.data.get("scim_sync_log") || [];
      expect(rows.length).toBe(1);
    });
  });

  describe("getStatus", () => {
    it("returns zeros initially", () => {
      const s = getStatus();
      expect(s.users).toBe(0);
      expect(s.connectors).toBe(0);
      expect(s.syncOperations).toBe(0);
      expect(s.lastSync).toBeNull();
    });

    it("reflects current state", () => {
      createUser(db, "alice");
      const c = addConnector(db, "Okta", "okta");
      syncProvision(db, c.id);
      const s = getStatus();
      expect(s.users).toBe(1);
      expect(s.connectors).toBe(1);
      expect(s.syncOperations).toBe(1);
      expect(s.lastSync).toBeDefined();
    });
  });
});
