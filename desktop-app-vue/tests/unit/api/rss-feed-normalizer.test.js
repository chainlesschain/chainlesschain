import { describe, expect, it } from "vitest";

const RSSFeedNormalizer = require("../../../src/main/api/rss-feed-normalizer.js");
const {
  createRSSFetcherLimits,
  estimateJsonBytes,
} = require("../../../src/main/api/rss-fetcher-boundaries.js");

describe("RSS feed normalizer contract", () => {
  it("caps the complete normalized feed and stops before its byte budget", () => {
    const limits = createRSSFetcherLimits({
      maxFeedBytes: 9000,
      maxFeedItems: 100,
      maxItemContentBytes: 1000,
      maxTextBytes: 8,
      maxUrlBytes: 64,
    });
    const normalizer = new RSSFeedNormalizer(limits);
    const normalized = normalizer.normalizeFeed(
      {
        title: "😀".repeat(20),
        items: Array.from({ length: 100 }, (_, index) => ({
          guid: String(index),
          content: "x".repeat(1000),
        })),
      },
      "https://example.com/feed.xml",
    );

    expect(estimateJsonBytes(normalized)).toBeLessThanOrEqual(
      limits.maxFeedBytes,
    );
    expect(normalized.items.length).toBeLessThan(100);
    expect(normalized.title).not.toContain("�");
  });

  it("projects only bounded attachment fields", () => {
    const limits = createRSSFetcherLimits({
      maxTextBytes: 8,
      maxUrlBytes: 32,
    });
    const normalizer = new RSSFeedNormalizer(limits);

    expect(
      normalizer.normalizeAttachment({
        url: "https://example.com/very/long/media/path",
        type: "audio/mpeg-extra",
        secret: "not retained",
      }),
    ).toEqual({
      url: expect.any(String),
      type: "audio/mp",
      length: "",
      medium: "",
    });
  });
});
