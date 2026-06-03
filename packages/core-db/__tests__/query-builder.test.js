import { describe, it, expect } from "vitest";

const { QueryBuilder } = require("../lib/database/query-builder.js");

describe("QueryBuilder", () => {
  describe("SELECT", () => {
    it("builds basic SELECT", () => {
      const qb = new QueryBuilder(null);
      const { sql, params } = qb.table("notes").select().buildSQL();
      expect(sql).toBe("SELECT * FROM notes");
      expect(params).toEqual([]);
    });

    it("builds SELECT with specific columns", () => {
      const qb = new QueryBuilder(null);
      const { sql } = qb.table("notes").select("id", "title").buildSQL();
      expect(sql).toBe("SELECT id, title FROM notes");
    });

    it("builds SELECT with WHERE", () => {
      const qb = new QueryBuilder(null);
      const { sql, params } = qb
        .table("notes")
        .select()
        .where("status", "active")
        .buildSQL();
      expect(sql).toBe("SELECT * FROM notes WHERE status = ?");
      expect(params).toEqual(["active"]);
    });

    it("builds SELECT with multiple WHERE", () => {
      const qb = new QueryBuilder(null);
      const { sql, params } = qb
        .table("notes")
        .select()
        .where("status", "active")
        .where("user_id", 1)
        .buildSQL();
      expect(sql).toBe("SELECT * FROM notes WHERE status = ? AND user_id = ?");
      expect(params).toEqual(["active", 1]);
    });

    it("builds SELECT with OR WHERE", () => {
      const qb = new QueryBuilder(null);
      const { sql } = qb
        .table("notes")
        .select()
        .where("status", "active")
        .orWhere("status", "draft")
        .buildSQL();
      expect(sql).toBe("SELECT * FROM notes WHERE status = ? OR status = ?");
    });

    it("builds SELECT with ORDER BY", () => {
      const qb = new QueryBuilder(null);
      const { sql } = qb
        .table("notes")
        .select()
        .orderBy("created_at", "DESC")
        .buildSQL();
      expect(sql).toBe("SELECT * FROM notes ORDER BY created_at DESC");
    });

    it("builds SELECT with LIMIT and OFFSET", () => {
      const qb = new QueryBuilder(null);
      const { sql } = qb
        .table("notes")
        .select()
        .limit(10)
        .offset(20)
        .buildSQL();
      expect(sql).toBe("SELECT * FROM notes LIMIT 10 OFFSET 20");
    });

    it("builds SELECT with JOIN", () => {
      const qb = new QueryBuilder(null);
      const { sql } = qb
        .table("notes")
        .select()
        .join("users", "notes.user_id", "users.id")
        .buildSQL();
      expect(sql).toBe(
        "SELECT * FROM notes JOIN users ON notes.user_id = users.id",
      );
    });

    it("builds SELECT with LEFT JOIN", () => {
      const qb = new QueryBuilder(null);
      const { sql } = qb
        .table("notes")
        .select()
        .leftJoin("tags", "notes.tag_id", "tags.id")
        .buildSQL();
      expect(sql).toContain("LEFT JOIN");
    });

    it("builds SELECT with GROUP BY", () => {
      const qb = new QueryBuilder(null);
      const { sql } = qb.table("notes").select().groupBy("category").buildSQL();
      expect(sql).toBe("SELECT * FROM notes GROUP BY category");
    });

    it("builds COUNT query", () => {
      const qb = new QueryBuilder(null);
      const { sql } = qb.table("notes").count().buildSQL();
      expect(sql).toBe("SELECT COUNT(*) as count FROM notes");
    });

    it("builds WHERE IN", () => {
      const qb = new QueryBuilder(null);
      const { sql, params } = qb
        .table("notes")
        .select()
        .whereIn("id", [1, 2, 3])
        .buildSQL();
      expect(sql).toBe("SELECT * FROM notes WHERE id IN (?, ?, ?)");
      expect(params).toEqual([1, 2, 3]);
    });

    it("builds WHERE NULL", () => {
      const qb = new QueryBuilder(null);
      const { sql } = qb
        .table("notes")
        .select()
        .whereNull("deleted_at")
        .buildSQL();
      expect(sql).toBe("SELECT * FROM notes WHERE deleted_at IS NULL");
    });

    it("builds WHERE NOT NULL", () => {
      const qb = new QueryBuilder(null);
      const { sql } = qb
        .table("notes")
        .select()
        .whereNotNull("title")
        .buildSQL();
      expect(sql).toBe("SELECT * FROM notes WHERE title IS NOT NULL");
    });
  });

  describe("INSERT", () => {
    it("builds INSERT", () => {
      const qb = new QueryBuilder(null);
      const { sql, params } = qb
        .table("notes")
        .insert({ title: "Test", content: "Hello" })
        .buildSQL();
      expect(sql).toBe("INSERT INTO notes (title, content) VALUES (?, ?)");
      expect(params).toEqual(["Test", "Hello"]);
    });
  });

  describe("UPDATE", () => {
    it("builds UPDATE with WHERE", () => {
      const qb = new QueryBuilder(null);
      const { sql, params } = qb
        .table("notes")
        .update({ title: "Updated" })
        .where("id", 1)
        .buildSQL();
      expect(sql).toBe("UPDATE notes SET title = ? WHERE id = ?");
      expect(params).toEqual(["Updated", 1]);
    });
  });

  describe("DELETE", () => {
    it("builds DELETE with WHERE", () => {
      const qb = new QueryBuilder(null);
      const { sql, params } = qb
        .table("notes")
        .deleteFrom()
        .where("id", 1)
        .buildSQL();
      expect(sql).toBe("DELETE FROM notes WHERE id = ?");
      expect(params).toEqual([1]);
    });
  });

  describe("errors", () => {
    it("throws when table not specified", () => {
      const qb = new QueryBuilder(null);
      expect(() => qb.select().buildSQL()).toThrow("Table not specified");
    });

    it("throws when operation not specified", () => {
      const qb = new QueryBuilder(null);
      expect(() => qb.table("notes").buildSQL()).toThrow(
        "Operation not specified",
      );
    });
  });

  describe("static from", () => {
    it("creates QueryBuilder from db", () => {
      const qb = QueryBuilder.from({});
      expect(qb).toBeInstanceOf(QueryBuilder);
    });
  });
});
