import { describe, it, expect } from "vitest";

const SqlSecurity = require("../lib/database/sql-security.js");

describe("SqlSecurity", () => {
  describe("validateOrder", () => {
    it("accepts ASC/DESC", () => {
      expect(SqlSecurity.validateOrder("ASC")).toBe("ASC");
      expect(SqlSecurity.validateOrder("desc")).toBe("DESC");
    });

    it("rejects invalid order", () => {
      expect(() => SqlSecurity.validateOrder("RANDOM")).toThrow();
    });
  });

  describe("validateTableName", () => {
    it("accepts valid table names", () => {
      expect(SqlSecurity.validateTableName("notes")).toBe("notes");
      expect(SqlSecurity.validateTableName("user_profiles")).toBe(
        "user_profiles",
      );
    });

    it("rejects invalid characters", () => {
      expect(() =>
        SqlSecurity.validateTableName("notes; DROP TABLE"),
      ).toThrow();
      expect(() => SqlSecurity.validateTableName("123start")).toThrow();
    });

    it("rejects tables not in whitelist", () => {
      expect(() => SqlSecurity.validateTableName("notes", ["users"])).toThrow();
    });
  });

  describe("validateColumnName", () => {
    it("accepts valid column names", () => {
      expect(SqlSecurity.validateColumnName("id")).toBe("id");
      expect(SqlSecurity.validateColumnName("created_at")).toBe("created_at");
    });

    it("rejects invalid names", () => {
      expect(() => SqlSecurity.validateColumnName("col-name")).toThrow();
    });
  });

  describe("validateLimit", () => {
    it("accepts valid limits", () => {
      expect(SqlSecurity.validateLimit(10)).toBe(10);
      expect(SqlSecurity.validateLimit(0)).toBe(0);
    });

    it("caps at maxLimit", () => {
      expect(SqlSecurity.validateLimit(2000, 1000)).toBe(1000);
    });

    it("rejects negative values", () => {
      expect(() => SqlSecurity.validateLimit(-1)).toThrow();
    });
  });

  describe("containsSqlInjectionPattern", () => {
    it("detects common injection patterns", () => {
      expect(
        SqlSecurity.containsSqlInjectionPattern("'; DROP TABLE notes; --"),
      ).toBe(true);
      expect(SqlSecurity.containsSqlInjectionPattern("' OR '1'='1")).toBe(true);
      expect(
        SqlSecurity.containsSqlInjectionPattern("UNION SELECT * FROM users"),
      ).toBe(true);
    });

    it("allows safe input", () => {
      expect(
        SqlSecurity.containsSqlInjectionPattern("normal search term"),
      ).toBe(false);
      expect(SqlSecurity.containsSqlInjectionPattern("hello world")).toBe(
        false,
      );
    });

    it("handles null/undefined", () => {
      expect(SqlSecurity.containsSqlInjectionPattern(null)).toBe(false);
      expect(SqlSecurity.containsSqlInjectionPattern(undefined)).toBe(false);
    });
  });

  describe("buildLikePattern", () => {
    it("wraps in wildcards", () => {
      expect(SqlSecurity.buildLikePattern("test")).toBe("%test%");
    });

    it("escapes special characters", () => {
      expect(SqlSecurity.buildLikePattern("50%")).toBe("%50\\%%");
      expect(SqlSecurity.buildLikePattern("under_score")).toBe(
        "%under\\_score%",
      );
    });

    it("returns wildcard for empty input", () => {
      expect(SqlSecurity.buildLikePattern("")).toBe("%");
      expect(SqlSecurity.buildLikePattern(null)).toBe("%");
    });
  });

  describe("buildSafeWhereClause", () => {
    it("builds WHERE from filters", () => {
      const { whereClause, params } = SqlSecurity.buildSafeWhereClause(
        { status: "active", user_id: 1 },
        ["status", "user_id"],
      );
      expect(whereClause).toBe("WHERE status = ? AND user_id = ?");
      expect(params).toEqual(["active", 1]);
    });

    it("skips fields not in whitelist", () => {
      const { whereClause, params } = SqlSecurity.buildSafeWhereClause(
        { status: "active", evil: "malicious" },
        ["status"],
      );
      expect(whereClause).toBe("WHERE status = ?");
      expect(params).toEqual(["active"]);
    });

    it("handles NULL values", () => {
      const { whereClause } = SqlSecurity.buildSafeWhereClause(
        { deleted_at: null },
        ["deleted_at"],
      );
      expect(whereClause).toBe("WHERE deleted_at IS NULL");
    });

    it("handles array values (IN)", () => {
      const { whereClause, params } = SqlSecurity.buildSafeWhereClause(
        { status: ["active", "draft"] },
        ["status"],
      );
      expect(whereClause).toBe("WHERE status IN (?, ?)");
      expect(params).toEqual(["active", "draft"]);
    });

    it("returns empty for null filters", () => {
      const { whereClause, params } = SqlSecurity.buildSafeWhereClause(
        null,
        [],
      );
      expect(whereClause).toBe("");
      expect(params).toEqual([]);
    });
  });

  describe("getAllowedTables", () => {
    it("returns array of table names", () => {
      const tables = SqlSecurity.getAllowedTables();
      expect(Array.isArray(tables)).toBe(true);
      expect(tables).toContain("notes");
      expect(tables).toContain("projects");
    });
  });
});
