import { afterEach, describe, expect, it, vi } from "vitest";
const RSSIPCHandler = require("../../../src/main/api/rss-ipc.js");
const {
  RSSIPCBoundaryError,
} = require("../../../src/main/api/rss-ipc-boundaries.js");

function createHandler({
  prepare,
  limits = {},
  registerHandlers = false,
} = {}) {
  const ipcMain = {
    handle: vi.fn(),
    removeHandler: vi.fn(),
  };
  const rssFetcher = {
    destroy: vi.fn(),
    fetchFeed: vi.fn(),
    isValidUrl: vi.fn((value) => /^https?:\/\//.test(value)),
  };
  const notificationManager = {
    notifyNewArticles: vi.fn(),
    notifyRSSError: vi.fn(),
  };
  const database = {
    db: {
      prepare: vi.fn(
        prepare ||
          (() => ({
            all: vi.fn(() => []),
            get: vi.fn(),
            run: vi.fn(),
          })),
      ),
    },
  };
  const handler = new RSSIPCHandler(database, {
    ipcMain,
    rssFetcher,
    notificationManager,
    limits,
    registerHandlers,
  });
  return { database, handler, ipcMain, notificationManager, rssFetcher };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("RSS IPC resource boundaries", () => {
  it("applies bounded LIMIT/OFFSET windows to every collection query", async () => {
    const prepared = [];
    const { handler } = createHandler({
      limits: { maxFeedRows: 3, maxItemRows: 4, maxCategoryRows: 2 },
      prepare: (query) => {
        const statement = { query, all: vi.fn(() => []) };
        prepared.push(statement);
        return statement;
      },
    });

    await handler.getFeeds({ limit: Infinity, offset: 99 });
    await handler.getItems({ limit: 999, offset: 99 });
    await handler.getCategories({ limit: 999, offset: 99 });

    expect(prepared).toHaveLength(3);
    for (const statement of prepared) {
      expect(statement.query).toContain("LIMIT ? OFFSET ?");
    }
    expect(prepared[0].all).toHaveBeenCalledWith([3, 3]);
    expect(prepared[1].all).toHaveBeenCalledWith([4, 4]);
    expect(prepared[2].all).toHaveBeenCalledWith([2, 2]);
    handler.cleanup();
  });

  it("rejects dynamic SQL fields before preparing an update", async () => {
    const { database, handler } = createHandler();

    await expect(
      handler.updateFeed("feed-1", { "title = NULL --": "ignored" }),
    ).rejects.toMatchObject({
      code: "INVALID_ARGUMENT",
      scope: "rss_feed_update_field",
    });
    expect(database.db.prepare).not.toHaveBeenCalled();
    handler.cleanup();
  });

  it("caps fetch-all admission before retaining or executing the full table", async () => {
    const all = vi.fn(() => [{ id: "one" }, { id: "two" }, { id: "three" }]);
    const { handler } = createHandler({
      limits: { maxFetchAllFeeds: 2 },
      prepare: () => ({ all }),
    });
    handler.fetchFeed = vi.fn().mockResolvedValue({ success: true });

    const result = await handler.fetchAllFeeds();

    expect(all).toHaveBeenCalledWith([3]);
    expect(handler.fetchFeed).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      success: true,
      results: { success: 2, failed: 0, total: 2, truncated: true },
    });
    handler.cleanup();
  });

  it("bounds auto-sync timers and prevents overlapping fetches per feed", async () => {
    vi.useFakeTimers();
    const { handler } = createHandler({
      limits: { maxSyncIntervals: 1 },
      prepare: () => ({ get: vi.fn(() => ({ update_frequency: 60 })) }),
    });
    let releaseFetch;
    handler.fetchFeed = vi.fn(
      () =>
        new Promise((resolve) => {
          releaseFetch = resolve;
        }),
    );

    expect(handler.startAutoSync("feed-1")).toEqual({ success: true });
    expect(() => handler.startAutoSync("feed-2")).toThrow(RSSIPCBoundaryError);

    await vi.advanceTimersByTimeAsync(3 * 60 * 1000);
    expect(handler.fetchFeed).toHaveBeenCalledTimes(1);
    releaseFetch({ success: true });
    await Promise.resolve();
    handler.cleanup();
  });

  it("removes exactly registered IPC handlers and destroys owned state", () => {
    const { handler, ipcMain, rssFetcher } = createHandler({
      registerHandlers: true,
    });

    expect(ipcMain.handle).toHaveBeenCalledTimes(21);
    handler.registerHandlers();
    expect(ipcMain.handle).toHaveBeenCalledTimes(21);

    handler.cleanup();
    handler.cleanup();
    expect(ipcMain.removeHandler).toHaveBeenCalledTimes(21);
    expect(rssFetcher.destroy).toHaveBeenCalledTimes(1);
  });
});
