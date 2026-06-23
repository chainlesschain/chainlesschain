import { describe, it, expect } from "vitest";
import { selectNotesForList } from "../../src/commands/note.js";

/**
 * Fake better-sqlite3-style db. Rows are pre-sorted newest-first (as the real
 * `ORDER BY created_at DESC` would return them). The fake honors the `AND
 * category = ?` clause and the `LIMIT ?` clause if present in the SQL, applying
 * params in the same push order as selectNotesForList — so a test that passes
 * here also fails against the old "SQL LIMIT before in-memory tag filter" code.
 */
function makeFakeDb(rows) {
  let lastSql = "";
  return {
    lastSql: () => lastSql,
    prepare(sql) {
      lastSql = sql;
      return {
        all(...params) {
          let result = rows.slice();
          let pi = 0;
          if (/AND category = \?/.test(sql)) {
            const cat = params[pi++];
            result = result.filter((r) => r.category === cat);
          }
          if (/LIMIT \?/.test(sql)) {
            result = result.slice(0, params[pi++]);
          }
          return result;
        },
      };
    },
  };
}

function note(id, tags, category = "general") {
  return {
    id,
    title: `t${id}`,
    tags: JSON.stringify(tags),
    category,
    created_at: `2026-01-${id}`,
  };
}

describe("selectNotesForList — limit applies after tag filter", () => {
  it("returns up to N matching notes even when matches aren't among the N most-recent", () => {
    // 20 most-recent are all 'personal'; older 10 are 'work'.
    const rows = [];
    for (let i = 30; i >= 21; i--) rows.push(note(i, ["work"]));
    for (let i = 20; i >= 1; i--) rows.push(note(i, ["personal"]));
    // rows are newest-first only loosely; what matters is the regression shape:
    // the 'work' notes sit beyond a LIMIT-20 window of 'personal' notes.
    const newestFirst = [
      ...Array.from({ length: 20 }, (_, k) => note(20 - k, ["personal"])),
      ...Array.from({ length: 10 }, (_, k) => note(30 - k, ["work"])),
    ];
    const db = makeFakeDb(newestFirst);

    const got = selectNotesForList(db, { tag: "work", limit: 5 });

    expect(got).toHaveLength(5); // old code would return 0 (no 'work' in first 20)
    expect(got.every((n) => JSON.parse(n.tags).includes("work"))).toBe(true);
    expect(db.lastSql()).not.toMatch(/LIMIT/); // tag path must not push SQL LIMIT
  });

  it("caps tag results at the limit when more matches exist", () => {
    const rows = Array.from({ length: 50 }, (_, k) => note(k + 1, ["work"]));
    const got = selectNotesForList(makeFakeDb(rows), { tag: "work", limit: 7 });
    expect(got).toHaveLength(7);
  });

  it("returns all matches when fewer than the limit exist", () => {
    const rows = [note(3, ["work"]), note(2, ["personal"]), note(1, ["work"])];
    const got = selectNotesForList(makeFakeDb(rows), {
      tag: "work",
      limit: 20,
    });
    expect(got).toHaveLength(2);
  });

  it("uses SQL LIMIT when there is no tag filter", () => {
    const rows = Array.from({ length: 30 }, (_, k) => note(k + 1, ["x"]));
    const db = makeFakeDb(rows);
    const got = selectNotesForList(db, { limit: 10 });
    expect(got).toHaveLength(10);
    expect(db.lastSql()).toMatch(/LIMIT \?/);
  });

  it("composes a SQL category filter with the in-memory tag filter", () => {
    const rows = [
      note(4, ["work"], "alpha"),
      note(3, ["work"], "beta"),
      note(2, ["work"], "alpha"),
      note(1, ["personal"], "alpha"),
    ];
    const got = selectNotesForList(makeFakeDb(rows), {
      category: "alpha",
      tag: "work",
      limit: 20,
    });
    // alpha ∩ work = notes 4 and 2
    expect(got.map((n) => n.id).sort()).toEqual([2, 4]);
  });

  it("skips notes with malformed tags JSON without throwing", () => {
    const rows = [
      {
        id: 2,
        title: "t2",
        tags: "not-json",
        category: "g",
        created_at: "2026-01-02",
      },
      note(1, ["work"]),
    ];
    const got = selectNotesForList(makeFakeDb(rows), {
      tag: "work",
      limit: 20,
    });
    expect(got.map((n) => n.id)).toEqual([1]);
  });
});
