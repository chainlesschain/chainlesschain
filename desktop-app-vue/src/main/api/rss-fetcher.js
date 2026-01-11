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

      // 解析 Feed
      const feed = await this.parser.parseURL(feedUrl);

      // 标准化 Feed 数据
      const normalizedFeed = this.normalizeFeed(feed, feedUrl);

      this.emit('fetch-success', { feedUrl, feed: normalizedFeed });
      return normalizedFeed;
    } catch (error) {
      this.emit('fetch-error', { feedUrl, error });
      console.error(`[RSSFetcher] 获取 Feed 失败 (${feedUrl}):`, error.message);
      throw new Error(`获取 Feed 失败: ${error.message}`);
    }
  }

  /**
   * 批量获取多个 Feed
   * @param {Array<string>} feedUrls - Feed URL 列表
   * @returns {Promise<object>} 结果统计
   */
  async fetchMultipleFeeds(feedUrls, options = {}) {
    const results = {
      success: [],
      failed: [],
      total: feedUrls.length,
    };

    for (const feedUrl of feedUrls) {
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
