"use strict";

const {
  estimateJsonBytes,
  safeProperty,
  truncateUtf8,
} = require("./rss-fetcher-boundaries.js");

function firstTruthy(...values) {
  return values.find(Boolean);
}

class RSSFeedNormalizer {
  constructor(limits) {
    this.limits = limits;
  }

  normalizeFeed(feed, feedUrl) {
    const now = new Date().toISOString();
    const imageValue = safeProperty(feed, "image", null);
    const normalizedFeed = {
      url: truncateUtf8(feedUrl, this.limits.maxUrlBytes),
      title: truncateUtf8(
        firstTruthy(safeProperty(feed, "title", ""), "Untitled Feed"),
        this.limits.maxTextBytes,
      ),
      description: truncateUtf8(
        firstTruthy(
          safeProperty(feed, "description", ""),
          safeProperty(feed, "subtitle", ""),
          "",
        ),
        this.limits.maxTextBytes,
      ),
      link: truncateUtf8(
        safeProperty(feed, "link", ""),
        this.limits.maxUrlBytes,
      ),
      language: truncateUtf8(
        firstTruthy(safeProperty(feed, "language", ""), "en"),
        this.limits.maxTextBytes,
      ),
      lastBuildDate: truncateUtf8(
        firstTruthy(
          safeProperty(feed, "lastBuildDate", ""),
          safeProperty(feed, "updated", ""),
          now,
        ),
        this.limits.maxTextBytes,
      ),
      pubDate: truncateUtf8(
        firstTruthy(
          safeProperty(feed, "pubDate", ""),
          safeProperty(feed, "updated", ""),
          now,
        ),
        this.limits.maxTextBytes,
      ),
      image: imageValue
        ? {
            url: truncateUtf8(
              safeProperty(imageValue, "url", ""),
              this.limits.maxUrlBytes,
            ),
            title: truncateUtf8(
              safeProperty(imageValue, "title", ""),
              this.limits.maxTextBytes,
            ),
            link: truncateUtf8(
              safeProperty(imageValue, "link", ""),
              this.limits.maxUrlBytes,
            ),
          }
        : null,
      items: [],
    };

    let retainedBytes = estimateJsonBytes(normalizedFeed);
    const rawItemsValue = safeProperty(feed, "items", []);
    const rawItems = Array.isArray(rawItemsValue)
      ? rawItemsValue.slice(0, this.limits.maxFeedItems)
      : [];
    for (const item of rawItems) {
      const normalizedItem = this.normalizeItem(item);
      const itemBytes = estimateJsonBytes(normalizedItem) + 1;
      if (retainedBytes + itemBytes > this.limits.maxFeedBytes) {
        break;
      }
      normalizedFeed.items.push(normalizedItem);
      retainedBytes += itemBytes;
    }

    return normalizedFeed;
  }

  normalizeItem(item) {
    const now = new Date().toISOString();
    const rawCategories = safeProperty(item, "categories", []);
    const categories = Array.isArray(rawCategories)
      ? rawCategories
          .slice(0, this.limits.maxCategories)
          .map((category) =>
            truncateUtf8(category, this.limits.maxCategoryBytes),
          )
      : [];
    return {
      id: truncateUtf8(
        firstTruthy(
          safeProperty(item, "guid", ""),
          safeProperty(item, "id", ""),
          safeProperty(item, "link", ""),
          "",
        ),
        this.limits.maxTextBytes,
      ),
      title: truncateUtf8(
        firstTruthy(safeProperty(item, "title", ""), "Untitled"),
        this.limits.maxTextBytes,
      ),
      link: truncateUtf8(
        safeProperty(item, "link", ""),
        this.limits.maxUrlBytes,
      ),
      description: truncateUtf8(
        firstTruthy(
          safeProperty(item, "contentSnippet", ""),
          safeProperty(item, "summary", ""),
          "",
        ),
        this.limits.maxTextBytes,
      ),
      content: truncateUtf8(
        firstTruthy(
          safeProperty(item, "contentEncoded", ""),
          safeProperty(item, "content", ""),
          safeProperty(item, "description", ""),
          "",
        ),
        this.limits.maxItemContentBytes,
      ),
      author: truncateUtf8(
        firstTruthy(
          safeProperty(item, "creator", ""),
          safeProperty(item, "author", ""),
          "",
        ),
        this.limits.maxTextBytes,
      ),
      pubDate: truncateUtf8(
        firstTruthy(
          safeProperty(item, "pubDate", ""),
          safeProperty(item, "isoDate", ""),
          now,
        ),
        this.limits.maxTextBytes,
      ),
      categories,
      enclosure: this.normalizeAttachment(
        safeProperty(item, "enclosure", null),
      ),
      media: this.normalizeAttachment(safeProperty(item, "media", null)),
    };
  }

  normalizeAttachment(value) {
    const firstValue = Array.isArray(value) ? value[0] : value;
    const attributes = safeProperty(firstValue, "$", firstValue);
    if (!attributes || typeof attributes !== "object") {
      return null;
    }
    const attachment = {
      url: truncateUtf8(
        safeProperty(attributes, "url", ""),
        this.limits.maxUrlBytes,
      ),
      type: truncateUtf8(
        safeProperty(attributes, "type", ""),
        this.limits.maxTextBytes,
      ),
      length: truncateUtf8(
        safeProperty(attributes, "length", ""),
        this.limits.maxTextBytes,
      ),
      medium: truncateUtf8(
        safeProperty(attributes, "medium", ""),
        this.limits.maxTextBytes,
      ),
    };
    return Object.values(attachment).some(Boolean) ? attachment : null;
  }
}

module.exports = RSSFeedNormalizer;
