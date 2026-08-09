import { describe, expect, it, vi } from "vitest";

const KnowledgeHandler = require("../knowledge-handler");

describe("KnowledgeHandler recently viewed contract", () => {
  it("uses deterministic fallback ordering and forwards pagination", async () => {
    const rows = [{ id: "note-b" }, { id: "note-a" }];
    const database = {
      all: vi.fn().mockResolvedValue(rows),
    };
    const handler = Object.create(KnowledgeHandler.prototype);
    handler.database = database;

    const result = await handler.getRecentlyViewed({ limit: 3, offset: 1 }, {});
    const [sql, parameters] = database.all.mock.calls[0];

    expect(sql.replace(/\s+/g, " ").trim()).toContain(
      "ORDER BY COALESCE(last_viewed_at, updated_at) DESC, created_at DESC, id DESC",
    );
    expect(parameters).toEqual([3, 1]);
    expect(result).toEqual({ notes: rows, total: rows.length });
  });
});
