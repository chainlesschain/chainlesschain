/**
 * orphan-detector 单元测试 — Phase 3c follow-up D7
 */

import { describe, it, expect, vi } from "vitest";

const { detectOrphans, deleteOrphans } = require("../orphan-detector");

// ── detectOrphans ───────────────────────────────────────────────────

describe("detectOrphans · diff against cursor.remoteFilenameMap", () => {
  it("empty list → no orphans", () => {
    const r = detectOrphans({
      cursor: { remoteFilenameMap: {} },
      listResult: [],
    });
    expect(r.orphans).toEqual([]);
    expect(r.knownCount).toBe(0);
    expect(r.totalRemote).toBe(0);
  });

  it("all-known → 0 orphans, knownCount = N", () => {
    const cursor = {
      remoteFilenameMap: { "id-1": "a.md", "id-2": "b.md", "id-3": "c.md" },
    };
    const listResult = [
      { filename: "a.md", etag: "e1", size: 10 },
      { filename: "b.md", etag: "e2", size: 20 },
      { filename: "c.md", etag: "e3", size: 30 },
    ];
    const r = detectOrphans({ cursor, listResult });
    expect(r.orphans).toEqual([]);
    expect(r.knownCount).toBe(3);
    expect(r.totalRemote).toBe(3);
  });

  it("all-orphan (empty cursor) → all in orphans", () => {
    const r = detectOrphans({
      cursor: {},
      listResult: [
        { filename: "x.md", etag: "e1" },
        { filename: "y.md", etag: "e2" },
      ],
    });
    expect(r.orphans).toHaveLength(2);
    expect(r.orphans[0].filename).toBe("x.md");
    expect(r.knownCount).toBe(0);
  });

  it("partial: known + orphan split", () => {
    const cursor = {
      remoteFilenameMap: { "id-1": "keep.md" },
    };
    const listResult = [
      { filename: "keep.md", etag: "e1", size: 10 },
      { filename: "ghost.md", etag: "e2", size: 20 },
      { filename: "another-ghost.md", etag: "e3", size: 30 },
    ];
    const r = detectOrphans({ cursor, listResult });
    expect(r.orphans).toHaveLength(2);
    expect(r.orphans.map((o) => o.filename).sort()).toEqual([
      "another-ghost.md",
      "ghost.md",
    ]);
    expect(r.knownCount).toBe(1);
    expect(r.totalRemote).toBe(3);
  });

  it("etag mismatch on a known file does NOT make it orphan (name-based diff)", () => {
    // 用户在网盘改了 keep.md 内容 → 新 etag e-NEW；本地 cursor 还是旧 etag。
    // 它依然在 remoteFilenameMap 里 → 不是 orphan，只是后续 sync 会 412 conflict。
    const cursor = {
      remoteFilenameMap: { "id-1": "keep.md" },
    };
    const listResult = [{ filename: "keep.md", etag: "e-NEW", size: 999 }];
    const r = detectOrphans({ cursor, listResult });
    expect(r.orphans).toEqual([]);
    expect(r.knownCount).toBe(1);
  });

  it("invalid listResult throws", () => {
    expect(() =>
      detectOrphans({ cursor: {}, listResult: "not array" }),
    ).toThrow(/listResult/);
  });

  it("non-string filename items are skipped (defensive)", () => {
    const r = detectOrphans({
      cursor: {},
      listResult: [
        { filename: "good.md" },
        { filename: null },
        null,
        undefined,
        { etag: "no filename" },
      ],
    });
    expect(r.orphans).toHaveLength(1);
    expect(r.orphans[0].filename).toBe("good.md");
  });
});

// ── deleteOrphans ───────────────────────────────────────────────────

function makeFakeClient(overrides = {}) {
  return {
    deleteFile: vi.fn(overrides.deleteFile ?? (async () => ({ ok: true }))),
    getEtag: vi.fn(overrides.getEtag ?? (async () => "refreshed-etag")),
  };
}

describe("deleteOrphans · batch delete with per-file outcome", () => {
  it("empty list → empty result, no client calls", async () => {
    const client = makeFakeClient();
    const r = await deleteOrphans({ client, orphans: [] });
    expect(r).toEqual({ deleted: [], skipped: [], failed: [] });
    expect(client.deleteFile).not.toHaveBeenCalled();
  });

  it("all-ok happy path", async () => {
    const client = makeFakeClient();
    const r = await deleteOrphans({
      client,
      orphans: [
        { filename: "a.md", etag: "e1" },
        { filename: "b.md", etag: "e2" },
      ],
    });
    expect(r.deleted).toEqual(["a.md", "b.md"]);
    expect(r.skipped).toEqual([]);
    expect(r.failed).toEqual([]);
    expect(client.deleteFile).toHaveBeenCalledTimes(2);
    expect(client.deleteFile).toHaveBeenCalledWith("a.md", "e1");
    expect(client.deleteFile).toHaveBeenCalledWith("b.md", "e2");
  });

  it("refreshes etag via getEtag when orphan.etag missing", async () => {
    const client = makeFakeClient();
    await deleteOrphans({
      client,
      orphans: [{ filename: "no-etag.md", etag: null }],
    });
    expect(client.getEtag).toHaveBeenCalledWith("no-etag.md");
    expect(client.deleteFile).toHaveBeenCalledWith(
      "no-etag.md",
      "refreshed-etag",
    );
  });

  it("412 conflict → skipped with status, not failed", async () => {
    const client = makeFakeClient({
      deleteFile: vi.fn(async (filename) => {
        if (filename === "modified.md") {
          return { ok: false, conflict: true, status: 412 };
        }
        return { ok: true };
      }),
    });
    const r = await deleteOrphans({
      client,
      orphans: [
        { filename: "modified.md", etag: "old-e" },
        { filename: "good.md", etag: "e" },
      ],
    });
    expect(r.deleted).toEqual(["good.md"]);
    expect(r.skipped).toHaveLength(1);
    expect(r.skipped[0].filename).toBe("modified.md");
    expect(r.skipped[0].status).toBe(412);
    expect(r.failed).toEqual([]);
  });

  it("hard error → failed list", async () => {
    const client = makeFakeClient({
      deleteFile: vi.fn(async (filename) => {
        if (filename === "broken.md") {
          return { ok: false, status: 500, error: "server error" };
        }
        return { ok: true };
      }),
    });
    const r = await deleteOrphans({
      client,
      orphans: [
        { filename: "broken.md", etag: "e" },
        { filename: "good.md", etag: "e" },
      ],
    });
    expect(r.deleted).toEqual(["good.md"]);
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0].filename).toBe("broken.md");
    expect(r.failed[0].status).toBe(500);
  });

  it("throw during deleteFile → captured to failed", async () => {
    const client = makeFakeClient({
      deleteFile: vi.fn(async () => {
        throw new Error("boom");
      }),
    });
    const r = await deleteOrphans({
      client,
      orphans: [{ filename: "x.md", etag: "e" }],
    });
    expect(r.failed).toHaveLength(1);
    expect(r.failed[0].error).toMatch(/boom/);
  });

  it("skips items with no filename (defensive)", async () => {
    const client = makeFakeClient();
    const r = await deleteOrphans({
      client,
      orphans: [
        { etag: "no-name" },
        { filename: "", etag: "empty" },
        { filename: "good.md", etag: "e" },
      ],
    });
    expect(r.deleted).toEqual(["good.md"]);
    expect(client.deleteFile).toHaveBeenCalledTimes(1);
  });

  it("invalid client throws", async () => {
    await expect(deleteOrphans({ client: {}, orphans: [] })).rejects.toThrow(
      /deleteFile/,
    );
  });
});
