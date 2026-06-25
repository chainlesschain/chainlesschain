/**
 * KnowledgeSyncHandler.handleListNotes — ORDER BY SQL injection guard.
 *
 * Bug: sortBy/sortOrder came from the peer's message and were interpolated
 * straight into `ORDER BY ${sortBy} ${sortOrder}` (ORDER BY can't be a bound
 * parameter). A malicious peer could inject SQL via ORDER BY (e.g. a blind
 * `ORDER BY (CASE WHEN <subquery> THEN ...)` to exfiltrate data). Fix validates
 * sortBy against a column allowlist and sortOrder to ASC/DESC, falling back to
 * safe defaults.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../../../src/main/utils/logger.js", () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const KnowledgeSyncHandler = require("../../../src/main/p2p/knowledge-sync-handler.js");

function makeHandler() {
  let capturedQuery = null;
  const db = {
    all: vi.fn(async (q) => {
      capturedQuery = q;
      return [];
    }),
    get: vi.fn(async () => ({ total: 0 })),
  };
  const h = new KnowledgeSyncHandler(db, {}, {});
  h.sendToMobile = vi.fn(async () => {});
  return { h, getQuery: () => capturedQuery };
}

describe("KnowledgeSyncHandler.handleListNotes ORDER BY injection", () => {
  it("rejects malicious sortBy/sortOrder, falling back to safe defaults", async () => {
    const { h, getQuery } = makeHandler();
    await h.handleListNotes("peer1", {
      requestId: "r1",
      params: {
        sortBy: "id; DROP TABLE notes--",
        sortOrder: "ASC (SELECT 1)",
      },
    });
    const q = getQuery();
    expect(q).toContain("ORDER BY updated_at DESC"); // safe default
    expect(q).not.toMatch(/DROP TABLE/i);
    expect(q).not.toMatch(/SELECT 1/i);
  });

  it("allows an allowlisted sortBy and normalizes sortOrder", async () => {
    const { h, getQuery } = makeHandler();
    await h.handleListNotes("peer1", {
      requestId: "r2",
      params: { sortBy: "created_at", sortOrder: "asc" },
    });
    expect(getQuery()).toContain("ORDER BY created_at ASC");
  });
});
