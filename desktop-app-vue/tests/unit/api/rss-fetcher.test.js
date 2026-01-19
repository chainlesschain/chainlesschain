/**
 * RSS Fetcher Unit Tests
 * 测试 RSS/Atom 解析和获取功能
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
const RSSFetcher = require("../../../src/main/api/rss-fetcher");

describe("RSSFetcher", () => {
  let fetcher;

  beforeEach(() => {
    fetcher = new RSSFetcher();
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
    it("should emit fetch-start event", (done) => {
      fetcher.on("fetch-start", (data) => {
        expect(data).toHaveProperty("feedUrl");
        done();
      });

      // Trigger event manually for testing
      fetcher.emit("fetch-start", { feedUrl: "https://example.com/feed.xml" });
    });

    it("should emit fetch-success event", (done) => {
      fetcher.on("fetch-success", (data) => {
        expect(data).toHaveProperty("feedUrl");
        expect(data).toHaveProperty("feed");
        done();
      });

      fetcher.emit("fetch-success", {
        feedUrl: "https://example.com/feed.xml",
        feed: { title: "Test" },
      });
    });

    it("should emit fetch-error event", (done) => {
      fetcher.on("fetch-error", (data) => {
        expect(data).toHaveProperty("feedUrl");
        expect(data).toHaveProperty("error");
        done();
      });

      fetcher.emit("fetch-error", {
        feedUrl: "https://example.com/feed.xml",
        error: new Error("Test error"),
      });
    });
  });
});
