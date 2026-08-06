import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/session-manager.js", () => ({
  listSessions: vi.fn(() => []),
}));
vi.mock("../../src/harness/jsonl-session-store.js", () => ({
  listSessionAuthoritySummaries: vi.fn(() => []),
  listSessionEvidenceIds: vi.fn(() => []),
}));

const { listSessions } = await import("../../src/lib/session-manager.js");
const { listSessionAuthoritySummaries, listSessionEvidenceIds } =
  await import("../../src/harness/jsonl-session-store.js");
const { resolveMostRecentSessionId, listRecentSessions } =
  await import("../../src/lib/recent-session.js");

const fakeCtx = { db: { getDatabase: () => ({}) } };

describe("resolveMostRecentSessionId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listSessions.mockReturnValue([]);
    listSessionAuthoritySummaries.mockReturnValue([]);
    listSessionEvidenceIds.mockReturnValue([]);
  });

  it("returns null when no sessions exist", () => {
    expect(resolveMostRecentSessionId(fakeCtx)).toBeNull();
  });

  it("returns null with no ctx and no canonical authority", () => {
    expect(resolveMostRecentSessionId(null)).toBeNull();
  });

  it("picks the newest updated_at across both stores", () => {
    listSessions.mockReturnValue([
      { id: "db-old", updated_at: "2026-01-01T00:00:00Z" },
    ]);
    listSessionAuthoritySummaries.mockReturnValue([
      { id: "jsonl-new", updated_at: "2026-06-08T00:00:00Z" },
    ]);
    expect(resolveMostRecentSessionId(fakeCtx)).toBe("jsonl-new");
  });

  it("dedups by id (keeps single entry)", () => {
    listSessions.mockReturnValue([
      { id: "dup", updated_at: "2026-06-08T00:00:00Z" },
    ]);
    listSessionAuthoritySummaries.mockReturnValue([
      { id: "dup", updated_at: "2026-06-08T00:00:00Z" },
    ]);
    expect(resolveMostRecentSessionId(fakeCtx)).toBe("dup");
  });

  it("keeps an existing canonical session authoritative", () => {
    listSessions.mockReturnValue([
      { id: "db-only", updated_at: "2026-06-08T00:00:00Z" },
    ]);
    listSessionAuthoritySummaries.mockReturnValue([
      { id: "jsonl-x", updated_at: "2026-06-09T00:00:00Z" },
    ]);
    expect(resolveMostRecentSessionId(fakeCtx)).toBe("jsonl-x");
  });

  it("listRecentSessions returns full deduped newest-first list", () => {
    listSessions.mockReturnValue([
      { id: "a", updated_at: "2026-01-01T00:00:00Z" },
      { id: "dup", updated_at: "2026-03-01T00:00:00Z" },
    ]);
    listSessionAuthoritySummaries.mockReturnValue([
      { id: "dup", updated_at: "2026-03-01T00:00:00Z" },
      { id: "b", updated_at: "2026-06-08T00:00:00Z" },
    ]);
    const list = listRecentSessions(fakeCtx);
    expect(list.map((s) => s.id)).toEqual(["b", "dup", "a"]);
  });

  it("suppresses a legacy duplicate behind a damaged canonical witness", () => {
    listSessionEvidenceIds.mockReturnValue(["dup"]);
    listSessions.mockReturnValue([
      { id: "dup", updated_at: "2026-06-08T00:00:00Z", _store: "db" },
    ]);
    listSessionAuthoritySummaries.mockReturnValue([
      {
        id: "dup",
        updated_at: "2026-06-08T00:00:00Z",
        _store: "jsonl",
        _presence: "missing-transcript",
        _blocked: true,
      },
    ]);

    expect(listRecentSessions(fakeCtx)).toEqual([
      expect.objectContaining({
        id: "dup",
        _store: "jsonl",
        _blocked: true,
      }),
    ]);
  });

  it("survives a throwing db without crashing", () => {
    const badCtx = {
      db: {
        getDatabase: () => {
          throw new Error("db locked");
        },
      },
    };
    listSessionAuthoritySummaries.mockReturnValue([
      { id: "jsonl-ok", updated_at: "2026-06-08T00:00:00Z" },
    ]);
    expect(resolveMostRecentSessionId(badCtx)).toBe("jsonl-ok");
  });
});
