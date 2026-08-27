/**
 * RSS Feed Fetcher
 * 支持 RSS 2.0, Atom 1.0 等多种格式
 *
 * v0.20.0: 新增 RSS 订阅功能
 */

const { logger } = require("../utils/logger.js");
const Parser = require("rss-parser");
const { EventEmitter } = require("events");
const https = require("https");
const http = require("http");
const LRU = require("lru-cache");
const {
  DEFAULT_RSS_FETCHER_LIMITS,
  HARD_RSS_FETCHER_LIMITS,
  RSSFetcherBoundaryError,
  boundedPositiveInteger,
  clonePlainValue,
  createRSSFetcherLimits,
  estimateJsonBytes,
  safeProperty,
  truncateUtf8,
} = require("./rss-fetcher-boundaries.js");
const RSSFeedNormalizer = require("./rss-feed-normalizer.js");
const { fetchBoundedText } = require("./rss-bounded-text-fetcher.js");

class RSSFetcher extends EventEmitter {
  constructor(options = {}) {
    super();
    this.limits = createRSSFetcherLimits(options.limits || options);
    this.httpClient = options.httpClient || http;
    this.httpsClient = options.httpsClient || https;
    this.parser =
      options.parser ||
      new Parser({
        timeout: this.limits.requestTimeoutMs,
        maxRedirects: this.limits.maxRedirects,
        headers: {
          "User-Agent": "ChainlessChain/0.20.0 (RSS Reader)",
          Accept:
            "application/rss+xml, application/xml, text/xml, application/atom+xml",
        },
        customFields: {
          feed: ["subtitle", "updated", "language"],
          item: [
            ["media:content", "media"],
            ["content:encoded", "contentEncoded"],
            ["dc:creator", "creator"],
          ],
        },
      });

    // LRU 缓存同时受总字节和条目数约束。
    this.cache = new LRU({
      max: this.limits.maxCacheBytes,
      length: (feed, feedUrl) =>
        estimateJsonBytes(feed) + Buffer.byteLength(feedUrl, "utf8"),
      maxAge: 5 * 60 * 1000, // 5分钟过期
      updateAgeOnGet: true, // 访问时更新过期时间
    });
    this.maxRetries = this.limits.maxRetries;
    this.retryDelay = 1000; // 重试延迟（毫秒）
    this.activeFetches = 0;
    this.destroyed = false;
    this.lifecycleGeneration = 0;
    this.normalizer = new RSSFeedNormalizer(this.limits);
  }

  /**
   * 获取 RSS Feed
   * @param {string} feedUrl - RSS Feed URL
   * @param {object} options - 选项
   * @returns {Promise<object>} Feed 数据
   */
  async fetchFeed(feedUrl, options = {}) {
    if (this.destroyed) {
      throw new RSSFetcherBoundaryError(
        "CANCELED",
        "rss_fetch",
        "RSS fetcher has been destroyed",
      );
    }
    if (!this.isValidUrl(feedUrl)) {
      throw new RSSFetcherBoundaryError(
        "INVALID_ARGUMENT",
        "rss_url",
        "Invalid or oversized Feed URL",
        { limit: { maxUrlBytes: this.limits.maxUrlBytes } },
      );
    }
    if (this.activeFetches >= this.limits.maxConcurrentFetches) {
      throw new RSSFetcherBoundaryError(
        "OVERLOADED",
        "rss_fetch",
        "RSS fetch concurrency limit reached",
        {
          retryAfterMs: 250,
          limit: {
            maxConcurrentFetches: this.limits.maxConcurrentFetches,
          },
        },
      );
    }

    const lifecycleGeneration = this.lifecycleGeneration;
    this.activeFetches++;
    try {
      return await this._fetchFeedInternal(
        feedUrl,
        options,
        lifecycleGeneration,
      );
    } finally {
      this.activeFetches--;
    }
  }

  async _fetchFeedInternal(feedUrl, options, lifecycleGeneration) {
    try {
      this._safeEmit("fetch-start", { feedUrl });

      // 检查 LRU 缓存
      if (!options.skipCache) {
        const cached = this.cache.get(feedUrl);
        if (cached) {
          const cachedResult = clonePlainValue(cached);
          logger.info(`[RSSFetcher] 使用 LRU 缓存数据: ${feedUrl}`);
          this._safeEmit("fetch-success", {
            feedUrl,
            feed: clonePlainValue(cachedResult),
            fromCache: true,
          });
          return cachedResult;
        }
      }

      // 使用重试机制获取 Feed
      const feed = await this.fetchWithRetry(
        feedUrl,
        boundedPositiveInteger(
          options.maxRetries,
          this.maxRetries,
          this.maxRetries,
        ),
      );
      if (
        this.destroyed ||
        lifecycleGeneration !== this.lifecycleGeneration
      ) {
        throw new RSSFetcherBoundaryError(
          "CANCELED",
          "rss_fetch_lifecycle",
          "RSS fetch was canceled by lifecycle teardown",
        );
      }

      // 标准化 Feed 数据
      const normalizedFeed = this.normalizeFeed(feed, feedUrl);

      this._cacheFeed(feedUrl, normalizedFeed);

      this._safeEmit("fetch-success", {
        feedUrl,
        feed: clonePlainValue(normalizedFeed),
        fromCache: false,
      });
      return clonePlainValue(normalizedFeed);
    } catch (error) {
      this._safeEmit("fetch-error", { feedUrl, error });
      const errorMessage = truncateUtf8(
        safeProperty(error, "message", error),
        this.limits.maxTextBytes,
      );
      logger.error(`[RSSFetcher] 获取 Feed 失败 (${feedUrl}):`, errorMessage);
      if (error instanceof RSSFetcherBoundaryError) {
        throw error;
      }
      throw new Error(`获取 Feed 失败: ${errorMessage}`, { cause: error });
    }
  }

  _cacheFeed(feedUrl, normalizedFeed) {
    this.cache.set(feedUrl, clonePlainValue(normalizedFeed));
    while (this.cache.itemCount > this.limits.maxCacheEntries) {
      this.cache.pop();
    }
  }

  _safeEmit(eventName, payload) {
    try {
      this.emit(eventName, payload);
    } catch (error) {
      logger.warn(`[RSSFetcher] ${eventName} listener failed:`, error);
    }
  }

  /**
   * 带重试机制的 Feed 获取
   * @param {string} feedUrl - RSS Feed URL
   * @param {number} maxRetries - 最大重试次数
   * @returns {Promise<object>} Feed 数据
   */
  async fetchWithRetry(feedUrl, maxRetries = 3) {
    const retryLimit = boundedPositiveInteger(
      maxRetries,
      this.maxRetries,
      this.maxRetries,
    );
    let lastError;

    for (let attempt = 0; attempt < retryLimit; attempt++) {
      try {
        const xml = await this._fetchText(
          feedUrl,
          this.limits.maxFeedResponseBytes,
          "rss_response",
        );
        const feed = await this.parser.parseString(xml);

        if (attempt > 0) {
          logger.info(
            `[RSSFetcher] 重试成功 (尝试 ${attempt + 1}/${retryLimit}): ${feedUrl}`,
          );
        }

        return feed;
      } catch (error) {
        lastError = error;

        if (
          error instanceof RSSFetcherBoundaryError &&
          (error.code === "OVERLOADED" || error.code === "INVALID_ARGUMENT")
        ) {
          throw error;
        }

        if (attempt < retryLimit - 1) {
          // 指数退避策略
          const delay = this.retryDelay * Math.pow(2, attempt);
          logger.info(
            `[RSSFetcher] 获取失败，${delay}ms 后重试 (尝试 ${attempt + 1}/${retryLimit}): ${feedUrl}`,
          );
          await this.sleep(delay);
        }
      }
    }

    // 所有重试都失败
    throw lastError;
  }

  /**
   * 延迟函数
   * @param {number} ms - 延迟毫秒数
   */
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 清除缓存
   * @param {string} feedUrl - 可选，指定要清除的 Feed URL，不指定则清除所有
   */
  clearCache(feedUrl = null) {
    if (feedUrl) {
      this.cache.del(feedUrl);
      logger.info(`[RSSFetcher] 已清除 LRU 缓存: ${feedUrl}`);
    } else {
      this.cache.reset();
      logger.info("[RSSFetcher] 已清除所有 LRU 缓存");
    }
  }

  /**
   * 获取缓存统计信息
   */
  getCacheStats() {
    const keys = this.cache.keys();
    const entries = [];

    for (const key of keys) {
      entries.push({
        url: key,
        hasValue: this.cache.has(key),
      });
    }

    return {
      size: this.cache.itemCount,
      maxSize: this.limits.maxCacheEntries,
      retainedBytes: this.cache.length,
      maxRetainedBytes: this.limits.maxCacheBytes,
      maxAge: this.cache.maxAge,
      entries,
    };
  }

  /**
   * 清理过期缓存（LRU 会自动处理，此方法用于手动触发）
   */
  pruneCache() {
    this.cache.prune();
    logger.info("[RSSFetcher] 已清理过期的 LRU 缓存条目");
  }

  /**
   * 批量获取多个 Feed（优化并发控制）
   * @param {Array<string>} feedUrls - Feed URL 列表
   * @param {object} options - 选项
   * @returns {Promise<object>} 结果统计
   */
  async fetchMultipleFeeds(feedUrls, options = {}) {
    if (!Array.isArray(feedUrls)) {
      throw new RSSFetcherBoundaryError(
        "INVALID_ARGUMENT",
        "rss_batch",
        "Feed URLs must be an array",
      );
    }
    if (feedUrls.length > this.limits.maxBatchFeeds) {
      throw new RSSFetcherBoundaryError(
        "OVERLOADED",
        "rss_batch",
        "RSS batch admission limit reached",
        { limit: { maxBatchFeeds: this.limits.maxBatchFeeds } },
      );
    }
    for (const feedUrl of feedUrls) {
      if (!this.isValidUrl(feedUrl)) {
        throw new RSSFetcherBoundaryError(
          "INVALID_ARGUMENT",
          "rss_batch_url",
          "RSS batch contains an invalid or oversized URL",
          { limit: { maxUrlBytes: this.limits.maxUrlBytes } },
        );
      }
    }

    const concurrency = Math.min(
      boundedPositiveInteger(
        options.concurrency,
        5,
        this.limits.maxConcurrentFetches,
      ),
      this.limits.maxConcurrentFetches,
    );
    const results = {
      success: [],
      failed: [],
      total: feedUrls.length,
      dropped: 0,
      retainedBytes: 1024,
      maxRetainedBytes: this.limits.maxBatchRetainedBytes,
    };
    let processed = 0;
    const retainResult = (collection, entry) => {
      const entryBytes = estimateJsonBytes(entry) + 1;
      if (
        results.retainedBytes + entryBytes >
        this.limits.maxBatchRetainedBytes
      ) {
        return false;
      }
      collection.push(entry);
      results.retainedBytes += entryBytes;
      return true;
    };

    // 使用并发控制的工作队列
    const queue = [...feedUrls];
    const workers = [];

    const worker = async () => {
      while (queue.length > 0) {
        const feedUrl = queue.shift();
        if (!feedUrl) {
          break;
        }

        try {
          const feed = await this.fetchFeed(feedUrl, options);
          const resultEntry = { feedUrl, feed };
          const retained = retainResult(results.success, resultEntry);
          if (!retained) {
            const retainedFailure = retainResult(results.failed, {
              feedUrl,
              code: "OVERLOADED",
              error: "RSS batch retained-byte limit reached",
            });
            if (!retainedFailure) {
              results.dropped++;
            }
          }
          processed++;

          this._safeEmit("fetch-progress", {
            current: processed,
            total: results.total,
            status: retained ? "success" : "failed",
            feedUrl,
          });
        } catch (error) {
          const errorMessage = truncateUtf8(
            safeProperty(error, "message", error),
            this.limits.maxTextBytes,
          );
          const retainedFailure = retainResult(results.failed, {
            feedUrl,
            code: safeProperty(error, "code", "FETCH_FAILED"),
            error: errorMessage,
          });
          if (!retainedFailure) {
            results.dropped++;
          }
          processed++;

          this._safeEmit("fetch-progress", {
            current: processed,
            total: results.total,
            status: "failed",
            feedUrl,
            error: errorMessage,
          });
        }
      }
    };

    // 创建并发工作线程
    for (let i = 0; i < Math.min(concurrency, queue.length); i++) {
      workers.push(worker());
    }

    // 等待所有工作线程完成
    await Promise.all(workers);

    this._safeEmit("fetch-complete", clonePlainValue(results));
    return results;
  }

  /**
   * 验证 Feed URL
   * @param {string} feedUrl - Feed URL
   * @returns {Promise<object>} 验证结果
   */
  async validateFeed(feedUrl) {
    try {
      const feed = await this.fetchFeed(feedUrl);
      return {
        valid: true,
        title: feed.title,
        description: feed.description,
        itemCount: feed.items.length,
        lastUpdated: feed.lastBuildDate || feed.pubDate,
      };
    } catch (error) {
      return {
        valid: false,
        error: truncateUtf8(
          safeProperty(error, "message", error),
          this.limits.maxTextBytes,
        ),
      };
    }
  }

  /**
   * 发现网站的 RSS Feed
   * @param {string} websiteUrl - 网站 URL
   * @returns {Promise<Array>} 发现的 Feed 列表
   */
  async discoverFeeds(websiteUrl) {
    try {
      if (!this.isValidUrl(websiteUrl)) {
        throw new RSSFetcherBoundaryError(
          "INVALID_ARGUMENT",
          "rss_discovery_url",
          "Invalid or oversized discovery URL",
          { limit: { maxUrlBytes: this.limits.maxUrlBytes } },
        );
      }
      const html = await this.fetchHtml(websiteUrl);
      const feeds = [];
      const discoveredUrls = new Set();

      // 查找 <link> 标签中的 RSS/Atom Feed
      const linkRegex =
        /<link[^>]*(?:type=["']application\/(?:rss|atom)\+xml["']|rel=["']alternate["'])[^>]*>/gi;
      const matches = (html.match(linkRegex) || []).slice(
        0,
        this.limits.maxDiscoveredFeeds,
      );

      for (const match of matches) {
        const hrefMatch = match.match(/href=["']([^"']+)["']/i);
        const titleMatch = match.match(/title=["']([^"']+)["']/i);
        const typeMatch = match.match(/type=["']([^"']+)["']/i);

        if (hrefMatch) {
          let feedUrl = hrefMatch[1];

          // 处理相对 URL
          if (!/^https?:/i.test(feedUrl)) {
            feedUrl = new URL(feedUrl, websiteUrl).href;
          }

          if (!this.isValidUrl(feedUrl) || discoveredUrls.has(feedUrl)) {
            continue;
          }
          discoveredUrls.add(feedUrl);
          feeds.push({
            url: feedUrl,
            title: truncateUtf8(
              titleMatch ? titleMatch[1] : "RSS Feed",
              this.limits.maxTextBytes,
            ),
            type: truncateUtf8(
              typeMatch ? typeMatch[1] : "application/rss+xml",
              this.limits.maxTextBytes,
            ),
          });
        }
      }

      // 尝试常见的 Feed URL
      if (feeds.length === 0) {
        const commonPaths = [
          "/feed",
          "/rss",
          "/atom.xml",
          "/rss.xml",
          "/feed.xml",
        ];
        const baseUrl = new URL(websiteUrl);

        for (const path of commonPaths) {
          const feedUrl = `${baseUrl.origin}${path}`;
          try {
            const validation = await this.validateFeed(feedUrl);
            if (validation.valid) {
              feeds.push({
                url: feedUrl,
                title: validation.title || "RSS Feed",
                type: "application/rss+xml",
              });
            }
          } catch (error) {
            // 忽略错误，继续尝试下一个
          }
        }
      }

      return feeds;
    } catch (error) {
      if (error instanceof RSSFetcherBoundaryError) {
        throw error;
      }
      const errorMessage = truncateUtf8(
        safeProperty(error, "message", error),
        this.limits.maxTextBytes,
      );
      logger.error(
        `[RSSFetcher] 发现 Feed 失败 (${websiteUrl}):`,
        errorMessage,
      );
      throw new Error(`发现 Feed 失败: ${errorMessage}`, { cause: error });
    }
  }

  /**
   * 标准化 Feed 数据
   */
  normalizeFeed(feed, feedUrl) {
    return this.normalizer.normalizeFeed(feed, feedUrl);
  }

  /**
   * 标准化 Feed Item
   */
  normalizeItem(item) {
    return this.normalizer.normalizeItem(item);
  }

  _normalizeAttachment(value) {
    return this.normalizer.normalizeAttachment(value);
  }

  /**
   * 验证 URL 格式
   */
  isValidUrl(url) {
    if (
      typeof url !== "string" ||
      Buffer.byteLength(url, "utf8") > this.limits.maxUrlBytes
    ) {
      return false;
    }
    try {
      const parsed = new URL(url);
      return (
        (parsed.protocol === "http:" || parsed.protocol === "https:") &&
        !parsed.username &&
        !parsed.password
      );
    } catch (error) {
      return false;
    }
  }

  /**
   * 获取网页 HTML
   */
  fetchHtml(url) {
    return this._fetchText(
      url,
      this.limits.maxHtmlResponseBytes,
      "rss_html_response",
    );
  }

  _fetchText(url, maxBytes, scope, redirectCount = 0) {
    return fetchBoundedText({
      url,
      maxBytes,
      scope,
      redirectCount,
      limits: this.limits,
      httpClient: this.httpClient,
      httpsClient: this.httpsClient,
      isValidUrl: (candidate) => this.isValidUrl(candidate),
    });
  }

  destroy() {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.lifecycleGeneration++;
    this.cache.reset();
    this.removeAllListeners();
  }
}

module.exports = RSSFetcher;
module.exports.RSSFetcher = RSSFetcher;
module.exports.RSSFetcherBoundaryError = RSSFetcherBoundaryError;
module.exports.DEFAULT_RSS_FETCHER_LIMITS = DEFAULT_RSS_FETCHER_LIMITS;
module.exports.HARD_RSS_FETCHER_LIMITS = HARD_RSS_FETCHER_LIMITS;
module.exports.createRSSFetcherLimits = createRSSFetcherLimits;
