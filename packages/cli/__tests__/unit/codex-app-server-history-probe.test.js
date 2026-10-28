import { describe, expect, it, vi } from "vitest";
import { collectHistoryPages } from "../../scripts/codex-app-server-history-probe.mjs";

describe("bounded Codex history pagination", () => {
  it("passes opaque cursors back with the original filters and keeps chronological identities", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        data: [{ id: "old", createdAt: 10 }],
        nextCursor: "opaque+/==",
      })
      .mockResolvedValueOnce({
        data: [{ id: "new", createdAt: 10 }],
        nextCursor: null,
      });
    const result = await collectHistoryPages(request, "thread/turns/list", {
      threadId: "main",
      limit: 1,
      sortDirection: "asc",
    });
    expect(result.data).toEqual([
      { id: "old", createdAt: 10 },
      { id: "new", createdAt: 10 },
    ]);
    expect(request.mock.calls).toEqual([
      [
        "thread/turns/list",
        { threadId: "main", limit: 1, sortDirection: "asc" },
      ],
      [
        "thread/turns/list",
        {
          threadId: "main",
          limit: 1,
          sortDirection: "asc",
          cursor: "opaque+/==",
        },
      ],
    ]);
    expect(result.pages).toHaveLength(2);
  });
  it("accepts an empty terminal page", async () => {
    await expect(
      collectHistoryPages(
        async () => ({ data: [], nextCursor: null }),
        "thread/list",
        {},
      ),
    ).resolves.toEqual({ data: [], pages: [{ ids: [], nextCursor: null }] });
  });
  it.each([
    {},
    { data: null, nextCursor: null },
    { data: [], nextCursor: undefined },
    { data: [], nextCursor: "" },
    { data: [], nextCursor: 1 },
    { data: [{}], nextCursor: null },
  ])("rejects malformed history response %j", async (response) => {
    await expect(
      collectHistoryPages(async () => response, "thread/list", {}),
    ).rejects.toThrow();
  });
  it("refuses repeated identities even when a cursor advances", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ data: [{ id: "same" }], nextCursor: "next" })
      .mockResolvedValueOnce({ data: [{ id: "same" }], nextCursor: null });
    await expect(
      collectHistoryPages(request, "thread/list", {}),
    ).rejects.toThrow(/duplicate history identity/);
  });
  it("refuses a repeated cursor and never issues a third request", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ data: [{ id: "a" }], nextCursor: "same" })
      .mockResolvedValueOnce({ data: [{ id: "b" }], nextCursor: "same" });
    await expect(
      collectHistoryPages(request, "thread/list", {}),
    ).rejects.toThrow(/repeated history cursor/);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it("refuses an empty page that claims more results", async () => {
    await expect(
      collectHistoryPages(
        async () => ({ data: [], nextCursor: "next" }),
        "thread/list",
        {},
      ),
    ).rejects.toThrow(/empty nonterminal/);
  });
  it("bounds a server that keeps issuing fresh cursors", async () => {
    const request = vi.fn(async () => ({
      data: [{ id: String(request.mock.calls.length) }],
      nextCursor: String(request.mock.calls.length),
    }));
    await expect(
      collectHistoryPages(request, "thread/list", {}, 2),
    ).rejects.toThrow(/exceeded its bound/);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it.each([0, -1, 33, 1.5])(
    "rejects an invalid page bound %s before an RPC",
    async (limit) => {
      const request = vi.fn();
      await expect(
        collectHistoryPages(request, "thread/list", {}, limit),
      ).rejects.toThrow();
      expect(request).not.toHaveBeenCalled();
    },
  );
});
