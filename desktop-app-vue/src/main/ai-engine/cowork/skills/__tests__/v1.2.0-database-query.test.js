/**
 * Unit tests for database-query skill handler (v1.2.0)
 * Pure logic handler - SQL generation/optimization
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const handler = require("../builtin/database-query/handler.js");

describe("database-query handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("execute() - generate action", () => {
    it("should generate SQL from natural language", async () => {
      const result = await handler.execute(
        { input: "generate Find all users who signed up this week" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("generate");
      expect(result.sql).toBeDefined();
    });

    it("should generate SELECT query", async () => {
      const result = await handler.execute(
        { input: "generate Get all active orders from orders table" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.sql.toUpperCase()).toContain("SELECT");
    });

    it("should generate INSERT for insert requests", async () => {
      const result = await handler.execute(
        { input: "generate Insert into users table a new record" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.sql.toUpperCase()).toContain("INSERT");
    });
  });

  describe("execute() - optimize action", () => {
    it("should detect SELECT * anti-pattern", async () => {
      const result = await handler.execute(
        { input: 'optimize SELECT * FROM users WHERE name LIKE "%john%"' },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("optimize");
      expect(result.suggestions.length).toBeGreaterThan(0);
      const text = result.suggestions.join(" ");
      expect(text).toMatch(/SELECT \*/);
    });

    it("should detect missing LIMIT", async () => {
      const result = await handler.execute(
        { input: "optimize SELECT id, name FROM users" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      const text = result.suggestions.join(" ").toLowerCase();
      expect(text).toMatch(/limit/);
    });

    it("should detect leading wildcard LIKE", async () => {
      const result = await handler.execute(
        {
          input:
            "optimize SELECT name FROM users WHERE email LIKE '%@gmail.com'",
        },
        {},
        {},
      );
      expect(result.success).toBe(true);
      const text = result.suggestions.join(" ").toLowerCase();
      expect(text).toMatch(/like|wildcard|index/);
    });

    it("should handle well-optimized query", async () => {
      const result = await handler.execute(
        { input: "optimize SELECT id, name FROM users WHERE id = 1 LIMIT 1" },
        {},
        {},
      );
      expect(result.success).toBe(true);
    });
  });

  describe("execute() - explain action", () => {
    it("should analyze a SQL query", async () => {
      const result = await handler.execute(
        {
          input:
            "explain SELECT u.name, COUNT(o.id) FROM users u JOIN orders o ON u.id = o.user_id GROUP BY u.name",
        },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("explain");
      expect(result.analysis).toBeDefined();
      expect(result.explainQuery).toBeDefined();
    });
  });

  describe("execute() - migrate action", () => {
    it("should generate migration with up and down SQL", async () => {
      const result = await handler.execute(
        { input: "migrate Add column email_verified to users table" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.action).toBe("migrate");
      expect(result.up).toBeDefined();
      expect(result.down).toBeDefined();
    });

    it("migration should include CREATE TABLE for new table", async () => {
      const result = await handler.execute(
        { input: "migrate Create table posts with title and body columns" },
        {},
        {},
      );
      expect(result.success).toBe(true);
      expect(result.up.toUpperCase()).toContain("CREATE TABLE");
      expect(result.down.toUpperCase()).toContain("DROP TABLE");
    });
  });

  describe("execute() - schema action", () => {
    it("should handle schema introspection without database", async () => {
      const result = await handler.execute({ input: "schema users" }, {}, {});
      expect(result.success).toBe(true);
      expect(result.action).toBe("schema");
    });
  });

  describe("execute() - default behavior", () => {
    it("should default to schema on empty input", async () => {
      const result = await handler.execute({ input: "" }, {}, {});
      expect(result.success).toBe(true);
      expect(result.action).toBe("schema");
    });

    it("should default to schema on missing input", async () => {
      const result = await handler.execute({}, {}, {});
      expect(result.success).toBe(true);
      expect(result.action).toBe("schema");
    });
  });
});
