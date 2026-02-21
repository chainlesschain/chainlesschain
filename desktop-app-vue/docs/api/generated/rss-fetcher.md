# rss-fetcher

**Source**: `src/main/api/rss-fetcher.js`

**Generated**: 2026-02-21T22:04:25.864Z

---

## const

```javascript
const
```

* RSS Feed Fetcher
 * 支持 RSS 2.0, Atom 1.0 等多种格式
 *
 * v0.20.0: 新增 RSS 订阅功能

---

## async fetchFeed(feedUrl, options =

```javascript
async fetchFeed(feedUrl, options =
```

* 获取 RSS Feed
   * @param {string} feedUrl - RSS Feed URL
   * @param {object} options - 选项
   * @returns {Promise<object>} Feed 数据

---

## async fetchWithRetry(feedUrl, maxRetries = 3)

```javascript
async fetchWithRetry(feedUrl, maxRetries = 3)
```

* 带重试机制的 Feed 获取
   * @param {string} feedUrl - RSS Feed URL
   * @param {number} maxRetries - 最大重试次数
   * @returns {Promise<object>} Feed 数据

---

## sleep(ms)

```javascript
sleep(ms)
```

* 延迟函数
   * @param {number} ms - 延迟毫秒数

---

## clearCache(feedUrl = null)

```javascript
clearCache(feedUrl = null)
```

* 清除缓存
   * @param {string} feedUrl - 可选，指定要清除的 Feed URL，不指定则清除所有

---

## getCacheStats()

```javascript
getCacheStats()
```

* 获取缓存统计信息

---

## pruneCache()

```javascript
pruneCache()
```

* 清理过期缓存（LRU 会自动处理，此方法用于手动触发）

---

## async fetchMultipleFeeds(feedUrls, options =

```javascript
async fetchMultipleFeeds(feedUrls, options =
```

* 批量获取多个 Feed（优化并发控制）
   * @param {Array<string>} feedUrls - Feed URL 列表
   * @param {object} options - 选项
   * @returns {Promise<object>} 结果统计

---

## async validateFeed(feedUrl)

```javascript
async validateFeed(feedUrl)
```

* 验证 Feed URL
   * @param {string} feedUrl - Feed URL
   * @returns {Promise<object>} 验证结果

---

## async discoverFeeds(websiteUrl)

```javascript
async discoverFeeds(websiteUrl)
```

* 发现网站的 RSS Feed
   * @param {string} websiteUrl - 网站 URL
   * @returns {Promise<Array>} 发现的 Feed 列表

---

## normalizeFeed(feed, feedUrl)

```javascript
normalizeFeed(feed, feedUrl)
```

* 标准化 Feed 数据

---

## normalizeItem(item)

```javascript
normalizeItem(item)
```

* 标准化 Feed Item

---

## isValidUrl(url)

```javascript
isValidUrl(url)
```

* 验证 URL 格式

---

## fetchHtml(url)

```javascript
fetchHtml(url)
```

* 获取网页 HTML

---

