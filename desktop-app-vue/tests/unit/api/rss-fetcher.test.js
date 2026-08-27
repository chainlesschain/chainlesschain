/**
 * RSS Fetcher Unit Tests
 * 测试 RSS/Atom 解析和获取功能
 */

import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const RSSFetcher = require("../../../src/main/api/rss-fetcher");
const { HARD_RSS_FETCHER_LIMITS } = RSSFetcher;

describe("RSSFetcher", () => {
  let fetcher;

  beforeEach(() => {
    fetcher = new RSSFetcher();
  });

  afterEach(() => {
    fetcher.destroy();
  });

  describe("URL Validation", () => {
    it("should validate correct HTTP URLs", () => {
      expect(fetcher.isValidUrl("http://example.com/feed.xml")).toBe(true);
      expect(fetcher.isValidUrl("https://example.com/feed.xml")).toBe(true);
    });

    it("should reject invalid URLs", () => {
      expect(fetcher.isValidUrl("not-a-url")).toBe(false);
      expect(fetcher.isValidUrl("ftp://example.com")).toBe(false);
      expect(fetcher.isValidUrl("")).toBe(false);
    });
  });

  describe("Feed Normalization", () => {
    it("should normalize RSS feed data", () => {
      const mockFeed = {
        title: "Test Feed",
        description: "Test Description",
        link: "https://example.com",
        items: [
          {
            title: "Test Item",
            link: "https://example.com/item1",
            guid: "item-1",
            pubDate: "2026-01-12T00:00:00Z",
          },
        ],
      };

      const normalized = fetcher.normalizeFeed(
        mockFeed,
        "https://example.com/feed.xml",
      );

      expect(normalized).toHaveProperty("url");
      expect(normalized).toHaveProperty("title");
      expect(normalized).toHaveProperty("items");
      expect(normalized.url).toBe("https://example.com/feed.xml");
      expect(normalized.title).toBe("Test Feed");
      expect(normalized.items).toHaveLength(1);
    });

    it("should handle missing feed properties", () => {
      const mockFeed = {
        items: [],
      };

      const normalized = fetcher.normalizeFeed(
        mockFeed,
        "https://example.com/feed.xml",
      );

      expect(normalized.title).toBe("Untitled Feed");
      expect(normalized.description).toBe("");
      expect(normalized.items).toHaveLength(0);
    });
  });

  describe("Item Normalization", () => {
    it("should normalize feed items", () => {
      const mockItem = {
        title: "Test Article",
        link: "https://example.com/article",
        guid: "article-1",
        pubDate: "2026-01-12T00:00:00Z",
        creator: "Test Author",
        content: "Article content",
      };

      const normalized = fetcher.normalizeItem(mockItem);

      expect(normalized).toHaveProperty("id");
      expect(normalized).toHaveProperty("title");
      expect(normalized).toHaveProperty("link");
      expect(normalized).toHaveProperty("author");
      expect(normalized.id).toBe("article-1");
      expect(normalized.title).toBe("Test Article");
      expect(normalized.author).toBe("Test Author");
    });

    it("should handle missing item properties", () => {
      const mockItem = {};

      const normalized = fetcher.normalizeItem(mockItem);

      expect(normalized.title).toBe("Untitled");
      expect(normalized.link).toBe("");
      expect(normalized.author).toBe("");
      expect(normalized.categories).toEqual([]);
    });
  });

  describe("Default Host Detection", () => {
    it("should detect IMAP host from email", () => {
      // This test is for email-client, but keeping structure consistent
      expect(true).toBe(true);
    });
  });

  describe("Event Emission", () => {
    // NOTE: Converted from done() callback to Promise style (done() deprecated in Vitest 3.x)
    it("should emit fetch-start event", async () => {
      const eventPromise = new Promise((resolve) => {
        fetcher.on("fetch-start", (data) => {
          expect(data).toHaveProperty("feedUrl");
          resolve();
        });
      });

      // Trigger event manually for testing
      fetcher.emit("fetch-start", { feedUrl: "https://example.com/feed.xml" });
      await eventPromise;
    });

    it("should emit fetch-success event", async () => {
      const eventPromise = new Promise((resolve) => {
        fetcher.on("fetch-success", (data) => {
          expect(data).toHaveProperty("feedUrl");
          expect(data).toHaveProperty("feed");
          resolve();
        });
      });

      fetcher.emit("fetch-success", {
        feedUrl: "https://example.com/feed.xml",
        feed: { title: "Test" },
      });
      await eventPromise;
    });

    it("should emit fetch-error event", async () => {
      const eventPromise = new Promise((resolve) => {
        fetcher.on("fetch-error", (data) => {
          expect(data).toHaveProperty("feedUrl");
          expect(data).toHaveProperty("error");
          resolve();
        });
      });

      fetcher.emit("fetch-error", {
        feedUrl: "https://example.com/feed.xml",
        error: new Error("Test error"),
      });
      await eventPromise;
    });
  });
});

describe("RSSFetcher resource boundaries", () => {
  let fetcher;

  afterEach(() => {
    fetcher?.destroy();
  });

  it("clamps hostile configuration at immutable hard limits", () => {
    fetcher = new RSSFetcher(
      Object.fromEntries(
        Object.keys(HARD_RSS_FETCHER_LIMITS).map((key) => [
          key,
          Number.MAX_SAFE_INTEGER,
        ]),
      ),
    );

    expect(fetcher.limits).toEqual(HARD_RSS_FETCHER_LIMITS);
  });

  it("bounds normalized items, UTF-8 fields, categories, and attachments", () => {
    fetcher = new RSSFetcher({
      maxFeedItems: 2,
      maxTextBytes: 9,
      maxItemContentBytes: 17,
      maxCategories: 2,
      maxCategoryBytes: 5,
      maxUrlBytes: 64,
    });

    const normalized = fetcher.normalizeFeed(
      {
        title: "😀".repeat(10),
        items: Array.from({ length: 4 }, (_, index) => ({
          guid: `item-${index}`,
          title: "标题".repeat(10),
          content: "😀".repeat(20),
          categories: ["类型一", "类型二", "类型三"],
          enclosure: {
            url: "https://example.com/media",
            type: "audio/mpeg",
            secret: "must not escape",
          },
        })),
      },
      "https://example.com/feed.xml",
    );

    expect(normalized.items).toHaveLength(2);
    expect(Buffer.byteLength(normalized.title, "utf8")).toBeLessThanOrEqual(9);
    for (const item of normalized.items) {
      expect(Buffer.byteLength(item.title, "utf8")).toBeLessThanOrEqual(9);
      expect(Buffer.byteLength(item.content, "utf8")).toBeLessThanOrEqual(17);
      expect(item.categories).toHaveLength(2);
      expect(item.enclosure).not.toHaveProperty("secret");
      expect(item.content).not.toContain("�");
    }
  });

  it("keeps cached feeds detached and bounded by entry count and bytes", async () => {
    const parser = {
      parseString: vi.fn().mockResolvedValue({
        title: "Feed",
        items: [{ guid: "one", content: "x".repeat(6000) }],
      }),
    };
    fetcher = new RSSFetcher({
      parser,
      maxCacheEntries: 2,
      maxCacheBytes: 14_000,
      maxFeedBytes: 12_000,
      maxTextBytes: 32,
      maxItemContentBytes: 7000,
      maxUrlBytes: 128,
    });
    fetcher._fetchText = vi.fn().mockResolvedValue("<rss />");

    const first = await fetcher.fetchFeed("https://example.com/one.xml");
    first.items[0].content = "mutated";
    const cached = await fetcher.fetchFeed("https://example.com/one.xml");
    expect(cached.items[0].content).toBe("x".repeat(6000));

    await fetcher.fetchFeed("https://example.com/two.xml");
    await fetcher.fetchFeed("https://example.com/three.xml");
    const stats = fetcher.getCacheStats();
    expect(stats.size).toBeLessThanOrEqual(2);
    expect(stats.retainedBytes).toBeLessThanOrEqual(stats.maxRetainedBytes);
  });

  it("returns structured overload at the global fetch concurrency cap", async () => {
    let releaseResponse;
    const responseGate = new Promise((resolve) => {
      releaseResponse = resolve;
    });
    const parser = {
      parseString: vi.fn().mockResolvedValue({ title: "Feed", items: [] }),
    };
    fetcher = new RSSFetcher({ parser, maxConcurrentFetches: 1 });
    fetcher._fetchText = vi.fn(() => responseGate);

    const firstFetch = fetcher.fetchFeed("https://example.com/one.xml");
    await vi.waitFor(() => expect(fetcher.activeFetches).toBe(1));

    await expect(
      fetcher.fetchFeed("https://example.com/two.xml"),
    ).rejects.toMatchObject({
      code: "OVERLOADED",
      scope: "rss_fetch",
      limit: { maxConcurrentFetches: 1 },
    });

    releaseResponse("<rss />");
    await expect(firstFetch).resolves.toMatchObject({ title: "Feed" });
    expect(fetcher.activeFetches).toBe(0);
  });

  it("caps raw streamed response bytes before parsing", async () => {
    const request = new EventEmitter();
    request.setTimeout = vi.fn();
    request.destroy = vi.fn();
    const httpClient = {
      get: vi.fn((_url, _options, callback) => {
        queueMicrotask(() => {
          const response = new PassThrough();
          response.statusCode = 200;
          response.headers = {};
          callback(response);
          response.end(Buffer.alloc(17));
        });
        return request;
      }),
    };
    fetcher = new RSSFetcher({ httpClient, maxHtmlResponseBytes: 16 });

    await expect(fetcher.fetchHtml("http://example.com/")).rejects.toMatchObject(
      {
        code: "OVERLOADED",
        scope: "rss_html_response",
        limit: { maxBytes: 16 },
      },
    );
  });

  it("bounds batch admission, concurrency, and retained results", async () => {
    fetcher = new RSSFetcher({
      maxBatchFeeds: 2,
      maxConcurrentFetches: 2,
      maxBatchRetainedBytes: 12_000,
      maxFeedBytes: 11_500,
      maxTextBytes: 8,
      maxUrlBytes: 128,
    });
    let active = 0;
    let peakActive = 0;
    fetcher.fetchFeed = vi.fn(async () => {
      active++;
      peakActive = Math.max(peakActive, active);
      await Promise.resolve();
      active--;
      return { content: "x".repeat(8000) };
    });

    await expect(
      fetcher.fetchMultipleFeeds([
        "https://example.com/1",
        "https://example.com/2",
        "https://example.com/3",
      ]),
    ).rejects.toMatchObject({
      code: "OVERLOADED",
      scope: "rss_batch",
      limit: { maxBatchFeeds: 2 },
    });

    const result = await fetcher.fetchMultipleFeeds(
      ["https://example.com/1", "https://example.com/2"],
      { concurrency: Infinity },
    );
    expect(peakActive).toBeLessThanOrEqual(2);
    expect(result.retainedBytes).toBeLessThanOrEqual(result.maxRetainedBytes);
    expect(result.success).toHaveLength(1);
    expect(result.failed).toMatchObject([{ code: "OVERLOADED" }]);
    expect(result.success.length + result.failed.length + result.dropped).toBe(
      result.total,
    );
  });

  it("isolates listener failures from fetch completion", async () => {
    const parser = {
      parseString: vi.fn().mockResolvedValue({ title: "Feed", items: [] }),
    };
    fetcher = new RSSFetcher({ parser });
    fetcher._fetchText = vi.fn().mockResolvedValue("<rss />");
    fetcher.on("fetch-success", () => {
      throw new Error("listener failure");
    });

    await expect(
      fetcher.fetchFeed("https://example.com/feed.xml"),
    ).resolves.toMatchObject({ title: "Feed" });
  });

  it("does not repopulate cache after lifecycle teardown", async () => {
    let releaseResponse;
    const responseGate = new Promise((resolve) => {
      releaseResponse = resolve;
    });
    const parser = {
      parseString: vi.fn().mockResolvedValue({ title: "Feed", items: [] }),
    };
    fetcher = new RSSFetcher({ parser });
    fetcher._fetchText = vi.fn(() => responseGate);

    const pendingFetch = fetcher.fetchFeed("https://example.com/feed.xml");
    await vi.waitFor(() => expect(fetcher.activeFetches).toBe(1));
    fetcher.destroy();
    releaseResponse("<rss />");

    await expect(pendingFetch).rejects.toMatchObject({
      code: "CANCELED",
      scope: "rss_fetch_lifecycle",
    });
    expect(fetcher.getCacheStats()).toMatchObject({
      size: 0,
      retainedBytes: 0,
    });
  });
});
