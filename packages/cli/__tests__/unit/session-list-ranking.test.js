import { describe, it, expect } from "vitest";
import { rankSessions } from "../../src/commands/session.js";

// Regression: `session list` merges DB sessions (SQLite datetime('now') →
// "YYYY-MM-DD HH:MM:SS", a space at index 10) with JSONL sessions (toISOString
// → "YYYY-MM-DDTHH:MM:SS.sssZ", a 'T' at index 10) and ranked them with a raw
// string compare. Both formats are UTC, but the compare resolves at index 10
// where 'T' (0x54) > ' ' (0x20), so every JSONL session sorted as newer than
// any same-date DB session regardless of the actual time — mis-ordering the
// list and pushing the user's most-recent DB chat out of the top-N slice.

describe("session list ranking (cross-store timestamp order)", () => {
  it("ranks a later DB session above an earlier JSONL session on the same date", () => {
    const ranked = rankSessions(
      [
        { id: "db-2359", _store: "db", updated_at: "2026-07-04 23:59:00" },
        {
          id: "jsonl-0001",
          _store: "jsonl",
          updated_at: "2026-07-04T00:01:00.000Z",
        },
      ],
      20,
    );
    // 23:59 UTC is more recent than 00:01 UTC → the DB session must rank first.
    expect(ranked.map((s) => s.id)).toEqual(["db-2359", "jsonl-0001"]);
  });

  it("keeps the most-recent DB session inside the top-N slice", () => {
    const ranked = rankSessions(
      [
        { id: "db-recent", _store: "db", updated_at: "2026-07-04 23:00:00" },
        { id: "j1", _store: "jsonl", updated_at: "2026-07-04T01:00:00.000Z" },
        { id: "j2", _store: "jsonl", updated_at: "2026-07-04T02:00:00.000Z" },
      ],
      2,
    );
    // db-recent (23:00) is the newest of the three; a limit of 2 must not drop it.
    expect(ranked.map((s) => s.id)).toContain("db-recent");
    expect(ranked[0].id).toBe("db-recent");
  });

  it("dedups by id preferring the JSONL copy regardless of timestamp", () => {
    const ranked = rankSessions(
      [
        {
          id: "same",
          _store: "db",
          updated_at: "2026-07-04 18:00:00",
          title: "db-copy",
        },
        {
          id: "same",
          _store: "jsonl",
          updated_at: "2026-07-04T09:00:00.000Z",
          title: "jsonl-copy",
        },
      ],
      20,
    );
    expect(ranked).toHaveLength(1);
    expect(ranked[0]._store).toBe("jsonl");
  });

  it("sorts a null/empty JSONL timestamp to the bottom without throwing", () => {
    const ranked = rankSessions(
      [
        { id: "empty", _store: "jsonl", updated_at: "" },
        { id: "db", _store: "db", updated_at: "2026-07-04 10:00:00" },
      ],
      20,
    );
    expect(ranked[0].id).toBe("db");
    expect(ranked[1].id).toBe("empty");
  });
});
