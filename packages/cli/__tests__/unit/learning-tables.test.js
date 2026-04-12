/**
 * Unit tests for learning-tables.js — DB schema creation
 */
import { describe, it, expect } from "vitest";
import { MockDatabase } from "../helpers/mock-db.js";
import { ensureLearningTables } from "../../src/lib/learning/learning-tables.js";

describe("learning-tables", () => {
  it("creates all 3 tables", () => {
    const db = new MockDatabase();
    ensureLearningTables(db);

    expect(db.tables.has("learning_trajectories")).toBe(true);
    expect(db.tables.has("learning_trajectory_tags")).toBe(true);
    expect(db.tables.has("skill_improvement_log")).toBe(true);
  });

  it("is idempotent (can be called twice)", () => {
    const db = new MockDatabase();
    ensureLearningTables(db);
    ensureLearningTables(db); // second call should not throw
    expect(db.tables.has("learning_trajectories")).toBe(true);
  });

  it("allows insert into learning_trajectories", () => {
    const db = new MockDatabase();
    ensureLearningTables(db);

    const result = db
      .prepare(
        `INSERT INTO learning_trajectories (id, session_id, user_intent, tool_chain, tool_count, complexity_level)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run("t1", "s1", "test", "[]", 0, "simple");
    expect(result.changes).toBe(1);

    const row = db
      .prepare("SELECT * FROM learning_trajectories WHERE id = ?")
      .get("t1");
    expect(row.session_id).toBe("s1");
  });

  it("allows insert into learning_trajectory_tags", () => {
    const db = new MockDatabase();
    ensureLearningTables(db);

    db.prepare(
      `INSERT INTO learning_trajectories (id, session_id, user_intent, tool_chain, tool_count, complexity_level)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run("t1", "s1", "test", "[]", 0, "simple");

    const result = db
      .prepare(
        "INSERT OR IGNORE INTO learning_trajectory_tags (trajectory_id, tag) VALUES (?, ?)",
      )
      .run("t1", "build");
    expect(result.changes).toBe(1);
  });

  it("allows insert into skill_improvement_log", () => {
    const db = new MockDatabase();
    ensureLearningTables(db);

    const result = db
      .prepare(
        "INSERT INTO skill_improvement_log (skill_name, trigger_type, detail) VALUES (?, ?, ?)",
      )
      .run("deploy-app", "error_repair", "fixed npm path");
    expect(result.changes).toBe(1);

    const row = db
      .prepare("SELECT * FROM skill_improvement_log WHERE skill_name = ?")
      .get("deploy-app");
    expect(row.trigger_type).toBe("error_repair");
    expect(row.detail).toBe("fixed npm path");
  });
});
