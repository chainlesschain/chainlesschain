/**
 * RSS Feed Fetcher
 * 支持 RSS 2.0, Atom 1.0 等多种格式
 *
 * v0.20.0: 新增 RSS 订阅功能
 */

const Parser = require('rss-parser');
const { EventEmitter } = require('events');
const https = require('https');
const http = require('http');
const LRU = require('lru-cache');

class RSSFetcher extends EventEmitter {
  constructor() {
    super();
    this.parser = new Parser({
      timeout: 30000, // 30秒超时
      headers: {
        'User-Agent': 'ChainlessChain/0.20.0 (RSS Reader)',
        'Accept': 'application/rss+xml, application/xml, text/xml, application/atom+xml',
      },
      customFields: {
        feed: ['subtitle', 'updated', 'language'],
        item: [
          ['media:content', 'media'],
          ['content:encoded', 'contentEncoded'],
          ['dc:creator', 'creator'],
        ],
      },
    });

    // LRU 缓存（最多100个Feed，5分钟过期）
    this.cache = new LRU({
      max: 100, // 最多缓存 100 个 Feed
      maxAge: 5 * 60 * 1000, // 5分钟过期
      updateAgeOnGet: true, // 访问时更新过期时间
    });
    this.maxRetries = 3; // 最大重试次数
    this.retryDelay = 1000; // 重试延迟（毫秒）
  }

  /**
   * 获取 RSS Feed
   * @param {string} feedUrl - RSS Feed URL
   * @param {object} options - 选项
   * @returns {Promise<object>} Feed 数据
   */
  async fetchFeed(feedUrl, options = {}) {
    try {
      this.emit('fetch-start', { feedUrl });

      // 验证 URL
      if (!this.isValidUrl(feedUrl)) {
        throw new Error('无效的 Feed URL');
      }

      // 检查 LRU 缓存
      if (!options.skipCache) {
        const cached = this.cache.get(feedUrl);
        if (cached) {
          console.log(`[RSSFetcher] 使用 LRU 缓存数据: ${feedUrl}`);
          this.emit('fetch-success', { feedUrl, feed: cached, fromCache: true });
          return cached;
        }
      }

      // 使用重试机制获取 Feed
      const feed = await this.fetchWithRetry(feedUrl, options.maxRetries || this.maxRetries);

      // 标准化 Feed 数据
      const normalizedFeed = this.normalizeFeed(feed, feedUrl);

      // 更新 LRU 缓存（自动处理过期和容量限制）
      this.cache.set(feedUrl, normalizedFeed);

      this.emit('fetch-success', { feedUrl, feed: normalizedFeed, fromCache: false });
      return normalizedFeed;
    } catch (error) {
      this.emit('fetch-error', { feedUrl, error });
      console.error(`[RSSFetcher] 获取 Feed 失败 (${feedUrl}):`, error.message);
      throw new Error(`获取 Feed 失败: ${error.message}`);
    }
  }

  /**
   * 带重试机制的 Feed 获取
   * @param {string} feedUrl - RSS Feed URL
   * @param {number} maxRetries - 最大重试次数
   * @returns {Promise<object>} Feed 数据
   */
  async fetchWithRetry(feedUrl, maxRetries = 3) {
    let lastError;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // 解析 Feed
        const feed = await this.parser.parseURL(feedUrl);

        if (attempt > 0) {
          console.log(`[RSSFetcher] 重试成功 (尝试 ${attempt + 1}/${maxRetries}): ${feedUrl}`);
        }

        return feed;
      } catch (error) {
        lastError = error;

        if (attempt < maxRetries - 1) {
          // 指数退避策略
          const delay = this.retryDelay * Math.pow(2, attempt);
          console.log(`[RSSFetcher] 获取失败，${delay}ms 后重试 (尝试 ${attempt + 1}/${maxRetries}): ${feedUrl}`);
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
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 清除缓存
   * @param {string} feedUrl - 可选，指定要清除的 Feed URL，不指定则清除所有
   */
  clearCache(feedUrl = null) {
    if (feedUrl) {
      this.cache.delete(feedUrl);
      console.log(`[RSSFetcher] 已清除 LRU 缓存: ${feedUrl}`);
    } else {
      this.cache.reset();
      console.log('[RSSFetcher] 已清除所有 LRU 缓存');
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
      size: this.cache.length,
      maxSize: this.cache.max,
      maxAge: this.cache.maxAge,
      entries,
    };
  }

  /**
   * 清理过期缓存（LRU 会自动处理，此方法用于手动触发）
   */
  pruneCache() {
    this.cache.prune();
    console.log('[RSSFetcher] 已清理过期的 LRU 缓存条目');
  }

  /**
   * 批量获取多个 Feed（优化并发控制）
   * @param {Array<string>} feedUrls - Feed URL 列表
   * @param {object} options - 选项
   * @returns {Promise<object>} 结果统计
   */
  async fetchMultipleFeeds(feedUrls, options = {}) {
    const concurrency = options.concurrency || 5; // 默认并发数为5
    const results = {
      success: [],
      failed: [],
      total: feedUrls.length,
    };

    // 使用并发控制的工作队列
    const queue = [...feedUrls];
    const workers = [];

    const worker = async () => {
      while (queue.length > 0) {
        const feedUrl = queue.shift();
        if (!feedUrl) {break;}

        try {
          const feed = await this.fetchFeed(feedUrl, options);
          results.success.push({ feedUrl, feed });

          this.emit('fetch-progress', {
            current: results.success.length + results.failed.length,
            total: results.total,
            status: 'success',
            feedUrl,
          });
        } catch (error) {
          results.failed.push({ feedUrl, error: error.message });

          this.emit('fetch-progress', {
            current: results.success.length + results.failed.length,
            total: results.total,
            status: 'failed',
            feedUrl,
            error: error.message,
          });
        }
      }
    };

    // 创建并发工作线程
    for (let i = 0; i < Math.min(concurrency, feedUrls.length); i++) {
      workers.push(worker());
    }

    // 等待所有工作线程完成
    await Promise.all(workers);

    this.emit('fetch-complete', results);
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
        error: error.message,
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
      const html = await this.fetchHtml(websiteUrl);
      const feeds = [];

      // 查找 <link> 标签中的 RSS/Atom Feed
      const linkRegex = /<link[^>]*(?:type=["']application\/(?:rss|atom)\+xml["']|rel=["']alternate["'])[^>]*>/gi;
      const matches = html.match(linkRegex) || [];

      for (const match of matches) {
        const hrefMatch = match.match(/href=["']([^"']+)["']/i);
        const titleMatch = match.match(/title=["']([^"']+)["']/i);
        const typeMatch = match.match(/type=["']([^"']+)["']/i);

        if (hrefMatch) {
          let feedUrl = hrefMatch[1];

          // 处理相对 URL
          if (!feedUrl.startsWith('http')) {
            const baseUrl = new URL(websiteUrl);
            feedUrl = new URL(feedUrl, baseUrl.origin).href;
          }

          feeds.push({
            url: feedUrl,
            title: titleMatch ? titleMatch[1] : 'RSS Feed',
            type: typeMatch ? typeMatch[1] : 'application/rss+xml',
          });
        }
      }

      // 尝试常见的 Feed URL
      if (feeds.length === 0) {
        const commonPaths = ['/feed', '/rss', '/atom.xml', '/rss.xml', '/feed.xml'];
        const baseUrl = new URL(websiteUrl);

        for (const path of commonPaths) {
          const feedUrl = `${baseUrl.origin}${path}`;
          try {
            const validation = await this.validateFeed(feedUrl);
            if (validation.valid) {
              feeds.push({
                url: feedUrl,
                title: validation.title || 'RSS Feed',
                type: 'application/rss+xml',
              });
            }
          } catch (error) {
            // 忽略错误，继续尝试下一个
          }
        }
      }

      return feeds;
    } catch (error) {
      console.error(`[RSSFetcher] 发现 Feed 失败 (${websiteUrl}):`, error.message);
      throw new Error(`发现 Feed 失败: ${error.message}`);
    }
  }

  /**
   * 标准化 Feed 数据
   */
  normalizeFeed(feed, feedUrl) {
    return {
      url: feedUrl,
      title: feed.title || 'Untitled Feed',
      description: feed.description || feed.subtitle || '',
      link: feed.link || '',
      language: feed.language || 'en',
      lastBuildDate: feed.lastBuildDate || feed.updated || new Date().toISOString(),
      pubDate: feed.pubDate || feed.updated || new Date().toISOString(),
      image: feed.image ? {
        url: feed.image.url,
        title: feed.image.title,
        link: feed.image.link,
      } : null,
      items: (feed.items || []).map(item => this.normalizeItem(item)),
    };
  }

  /**
   * 标准化 Feed Item
   */
  normalizeItem(item) {
    return {
      id: item.guid || item.id || item.link,
      title: item.title || 'Untitled',
      link: item.link || '',
      description: item.contentSnippet || item.summary || '',
      content: item.contentEncoded || item.content || item.description || '',
      author: item.creator || item.author || '',
      pubDate: item.pubDate || item.isoDate || new Date().toISOString(),
      categories: item.categories || [],
      enclosure: item.enclosure || null,
      media: item.media || null,
    };
  }

  /**
   * 验证 URL 格式
   */
  isValidUrl(url) {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch (error) {
      return false;
    }
  }

  /**
   * 获取网页 HTML
   */
  fetchHtml(url) {
    return new Promise((resolve, reject) => {
      const client = url.startsWith('https') ? https : http;

      client.get(url, {
        headers: {
          'User-Agent': 'ChainlessChain/0.20.0 (RSS Reader)',
        },
      }, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}`));
          return;
        }

        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve(data));
      }).on('error', reject);
    });
  }
}

module.exports = RSSFetcher;
