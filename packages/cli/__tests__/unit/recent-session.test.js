import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/lib/session-manager.js", () => ({
  listSessions: vi.fn(() => []),
}));
vi.mock("../../src/harness/jsonl-session-store.js", () => ({
  listJsonlSessions: vi.fn(() => []),
}));
vi.mock("../../src/lib/feature-flags.js", () => ({
  feature: vi.fn(() => true),
}));

const { listSessions } = await import("../../src/lib/session-manager.js");
const { listJsonlSessions } =
  await import("../../src/harness/jsonl-session-store.js");
const { feature } = await import("../../src/lib/feature-flags.js");
const { resolveMostRecentSessionId, listRecentSessions } =
  await import("../../src/lib/recent-session.js");

const fakeCtx = { db: { getDatabase: () => ({}) } };

describe("resolveMostRecentSessionId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    feature.mockReturnValue(true);
    listSessions.mockReturnValue([]);
    listJsonlSessions.mockReturnValue([]);
  });

  it("returns null when no sessions exist", () => {
    expect(resolveMostRecentSessionId(fakeCtx)).toBeNull();
  });

  it("returns null with no ctx and JSONL disabled", () => {
    feature.mockReturnValue(false);
    expect(resolveMostRecentSessionId(null)).toBeNull();
  });

  it("picks the newest updated_at across both stores", () => {
    listSessions.mockReturnValue([
      { id: "db-old", updated_at: "2026-01-01T00:00:00Z" },
    ]);
    listJsonlSessions.mockReturnValue([
      { id: "jsonl-new", updated_at: "2026-06-08T00:00:00Z" },
    ]);
    expect(resolveMostRecentSessionId(fakeCtx)).toBe("jsonl-new");
  });

  it("dedups by id (keeps single entry)", () => {
    listSessions.mockReturnValue([
      { id: "dup", updated_at: "2026-06-08T00:00:00Z" },
    ]);
    listJsonlSessions.mockReturnValue([
      { id: "dup", updated_at: "2026-06-08T00:00:00Z" },
    ]);
    expect(resolveMostRecentSessionId(fakeCtx)).toBe("dup");
  });

  it("skips JSONL store when feature flag is off", () => {
    feature.mockReturnValue(false);
    listSessions.mockReturnValue([
      { id: "db-only", updated_at: "2026-06-08T00:00:00Z" },
    ]);
    listJsonlSessions.mockReturnValue([
      { id: "jsonl-x", updated_at: "2026-06-09T00:00:00Z" },
    ]);
    expect(resolveMostRecentSessionId(fakeCtx)).toBe("db-only");
    expect(listJsonlSessions).not.toHaveBeenCalled();
  });

  it("listRecentSessions returns full deduped newest-first list", () => {
    listSessions.mockReturnValue([
      { id: "a", updated_at: "2026-01-01T00:00:00Z" },
      { id: "dup", updated_at: "2026-03-01T00:00:00Z" },
    ]);
    listJsonlSessions.mockReturnValue([
      { id: "dup", updated_at: "2026-03-01T00:00:00Z" },
      { id: "b", updated_at: "2026-06-08T00:00:00Z" },
    ]);
    const list = listRecentSessions(fakeCtx);
    expect(list.map((s) => s.id)).toEqual(["b", "dup", "a"]);
  });

  it("survives a throwing db without crashing", () => {
    const badCtx = {
      db: {
        getDatabase: () => {
          throw new Error("db locked");
        },
      },
    };
    listJsonlSessions.mockReturnValue([
      { id: "jsonl-ok", updated_at: "2026-06-08T00:00:00Z" },
    ]);
    expect(resolveMostRecentSessionId(badCtx)).toBe("jsonl-ok");
  });
});
