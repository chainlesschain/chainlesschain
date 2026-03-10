import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

function createMockDB() {
  const prep = {
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(null),
    run: vi.fn().mockReturnValue({ changes: 1 }),
  };
  return { exec: vi.fn(), prepare: vi.fn().mockReturnValue(prep), _prep: prep };
}

const { QueryBuilder } = require("../query-builder");

describe("QueryBuilder", () => {
  let db;

  beforeEach(() => {
    db = createMockDB();
    vi.clearAllMocks();
  });

  describe("static from", () => {
    it("should create a new QueryBuilder instance", () => {
      const qb = QueryBuilder.from(db);
      expect(qb).toBeInstanceOf(QueryBuilder);
      expect(qb.db).toBe(db);
    });
  });

  describe("SELECT queries", () => {
    it("should build basic SELECT *", () => {
      const { sql, params } = QueryBuilder.from(db)
        .table("users")
        .select()
        .buildSQL();
      expect(sql).toBe("SELECT * FROM users");
      expect(params).toEqual([]);
    });

    it("should build SELECT with specific columns", () => {
      const { sql } = QueryBuilder.from(db)
        .table("users")
        .select("id", "name")
        .buildSQL();
      expect(sql).toBe("SELECT id, name FROM users");
    });

    it("should build SELECT with WHERE clause", () => {
      const { sql, params } = QueryBuilder.from(db)
        .table("users")
        .select()
        .where("status", "active")
        .buildSQL();
      expect(sql).toBe("SELECT * FROM users WHERE status = ?");
      expect(params).toEqual(["active"]);
    });

    it("should build SELECT with WHERE and custom operator", () => {
      const { sql, params } = QueryBuilder.from(db)
        .table("users")
        .select()
        .where("age", ">", 18)
        .buildSQL();
      expect(sql).toBe("SELECT * FROM users WHERE age > ?");
      expect(params).toEqual([18]);
    });

    it("should build SELECT with multiple WHERE (AND)", () => {
      const { sql, params } = QueryBuilder.from(db)
        .table("users")
        .select()
        .where("status", "active")
        .where("role", "admin")
        .buildSQL();
      expect(sql).toBe("SELECT * FROM users WHERE status = ? AND role = ?");
      expect(params).toEqual(["active", "admin"]);
    });

    it("should build SELECT with orWhere", () => {
      const { sql } = QueryBuilder.from(db)
        .table("users")
        .select()
        .where("status", "active")
        .orWhere("role", "admin")
        .buildSQL();
      expect(sql).toBe("SELECT * FROM users WHERE status = ? OR role = ?");
    });

    it("should build SELECT with whereIn", () => {
      const { sql, params } = QueryBuilder.from(db)
        .table("users")
        .select()
        .whereIn("id", [1, 2, 3])
        .buildSQL();
      expect(sql).toBe("SELECT * FROM users WHERE id IN (?, ?, ?)");
      expect(params).toEqual([1, 2, 3]);
    });

    it("should build SELECT with whereNull and whereNotNull", () => {
      const { sql } = QueryBuilder.from(db)
        .table("users")
        .select()
        .whereNull("deleted_at")
        .whereNotNull("email")
        .buildSQL();
      expect(sql).toContain("deleted_at IS NULL");
      expect(sql).toContain("email IS NOT NULL");
    });

    it("should build SELECT with ORDER BY", () => {
      const { sql } = QueryBuilder.from(db)
        .table("users")
        .select()
        .orderBy("name")
        .orderBy("created_at", "DESC")
        .buildSQL();
      expect(sql).toBe(
        "SELECT * FROM users ORDER BY name ASC, created_at DESC",
      );
    });

    it("should build SELECT with LIMIT and OFFSET", () => {
      const { sql } = QueryBuilder.from(db)
        .table("users")
        .select()
        .limit(10)
        .offset(20)
        .buildSQL();
      expect(sql).toBe("SELECT * FROM users LIMIT 10 OFFSET 20");
    });

    it("should build SELECT with JOIN", () => {
      const { sql } = QueryBuilder.from(db)
        .table("users")
        .select("users.id", "profiles.bio")
        .join("profiles", "users.id", "profiles.user_id")
        .buildSQL();
      expect(sql).toContain("JOIN profiles ON users.id = profiles.user_id");
    });

    it("should build SELECT with LEFT JOIN", () => {
      const { sql } = QueryBuilder.from(db)
        .table("users")
        .select()
        .leftJoin("orders", "users.id", "orders.user_id")
        .buildSQL();
      expect(sql).toContain("LEFT JOIN orders ON users.id = orders.user_id");
    });

    it("should build SELECT with GROUP BY", () => {
      const { sql } = QueryBuilder.from(db)
        .table("orders")
        .select("status", "COUNT(*) as cnt")
        .groupBy("status")
        .buildSQL();
      expect(sql).toContain("GROUP BY status");
    });

    it("should build COUNT query", () => {
      const { sql } = QueryBuilder.from(db).table("users").count().buildSQL();
      expect(sql).toBe("SELECT COUNT(*) as count FROM users");
    });
  });

  describe("INSERT queries", () => {
    it("should build INSERT with data", () => {
      const { sql, params } = QueryBuilder.from(db)
        .table("users")
        .insert({ name: "Alice", email: "a@b.com" })
        .buildSQL();
      expect(sql).toBe("INSERT INTO users (name, email) VALUES (?, ?)");
      expect(params).toEqual(["Alice", "a@b.com"]);
    });
  });

  describe("UPDATE queries", () => {
    it("should build UPDATE with SET and WHERE", () => {
      const { sql, params } = QueryBuilder.from(db)
        .table("users")
        .update({ name: "Bob" })
        .where("id", 1)
        .buildSQL();
      expect(sql).toBe("UPDATE users SET name = ? WHERE id = ?");
      expect(params).toEqual(["Bob", 1]);
    });
  });

  describe("DELETE queries", () => {
    it("should build DELETE with WHERE", () => {
      const { sql, params } = QueryBuilder.from(db)
        .table("users")
        .deleteFrom()
        .where("id", 5)
        .buildSQL();
      expect(sql).toBe("DELETE FROM users WHERE id = ?");
      expect(params).toEqual([5]);
    });
  });

  describe("buildSQL errors", () => {
    it("should throw when table not specified", () => {
      expect(() => QueryBuilder.from(db).select().buildSQL()).toThrow(
        "Table not specified",
      );
    });

    it("should throw when operation not specified", () => {
      expect(() => QueryBuilder.from(db).table("users").buildSQL()).toThrow(
        "Operation not specified",
      );
    });
  });

  describe("execute", () => {
    it("should call stmt.all for SELECT", () => {
      db._prep.all.mockReturnValue([{ id: 1, name: "Alice" }]);
      const result = QueryBuilder.from(db).table("users").select().execute();
      expect(db.prepare).toHaveBeenCalled();
      expect(result).toEqual([{ id: 1, name: "Alice" }]);
    });

    it("should call stmt.run for INSERT", () => {
      db._prep.run.mockReturnValue({ changes: 1 });
      const result = QueryBuilder.from(db)
        .table("users")
        .insert({ name: "A" })
        .execute();
      expect(result).toEqual({ changes: 1 });
    });

    it("should pass params to stmt.all for SELECT with WHERE", () => {
      QueryBuilder.from(db).table("users").select().where("id", 1).execute();
      expect(db._prep.all).toHaveBeenCalledWith(1);
    });
  });

  describe("first", () => {
    it("should set limit to 1 and call stmt.get", () => {
      db._prep.get.mockReturnValue({ id: 1 });
      const result = QueryBuilder.from(db).table("users").select().first();
      expect(result).toEqual({ id: 1 });
    });

    it("should return null when no match", () => {
      const result = QueryBuilder.from(db).table("users").select().first();
      expect(result).toBeNull();
    });
  });
});
