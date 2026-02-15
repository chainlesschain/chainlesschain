# rss-ipc

**Source**: `src/main/api/rss-ipc.js`

**Generated**: 2026-02-15T08:42:37.266Z

---

## const

```javascript
const
```

* RSS IPC Handlers
 * 处理 RSS 订阅相关的 IPC 通信
 *
 * v0.20.0: 新增 RSS 订阅功能

---

## async addFeed(feedUrl, options =

```javascript
async addFeed(feedUrl, options =
```

* 添加 RSS 订阅源

---

## async removeFeed(feedId)

```javascript
async removeFeed(feedId)
```

* 删除 RSS 订阅源

---

## async updateFeed(feedId, updates)

```javascript
async updateFeed(feedId, updates)
```

* 更新 RSS 订阅源

---

## async getFeeds(options =

```javascript
async getFeeds(options =
```

* 获取订阅源列表

---

## async getFeed(feedId)

```javascript
async getFeed(feedId)
```

* 获取单个订阅源

---

## async getItems(options =

```javascript
async getItems(options =
```

* 获取 RSS 文章列表

---

## async getItem(itemId)

```javascript
async getItem(itemId)
```

* 获取单篇文章

---

## async markAsRead(itemId)

```javascript
async markAsRead(itemId)
```

* 标记为已读

---

## async markAsUnread(itemId)

```javascript
async markAsUnread(itemId)
```

* 标记为未读

---

## async markAsStarred(itemId, starred = true)

```javascript
async markAsStarred(itemId, starred = true)
```

* 标记为收藏

---

## async archiveItem(itemId)

```javascript
async archiveItem(itemId)
```

* 归档文章

---

## async saveToKnowledge(itemId)

```javascript
async saveToKnowledge(itemId)
```

* 保存到知识库

---

## async fetchFeed(feedId)

```javascript
async fetchFeed(feedId)
```

* 获取 Feed 更新

---

## async fetchAllFeeds()

```javascript
async fetchAllFeeds()
```

* 获取所有 Feed 更新

---

## async saveFeedItems(feedId, items)

```javascript
async saveFeedItems(feedId, items)
```

* 保存 Feed 文章

---

## async addCategory(name, options =

```javascript
async addCategory(name, options =
```

* 添加分类

---

## async getCategories()

```javascript
async getCategories()
```

* 获取分类列表

---

## async assignCategory(feedId, categoryId)

```javascript
async assignCategory(feedId, categoryId)
```

* 分配分类

---

## async discoverFeeds(websiteUrl)

```javascript
async discoverFeeds(websiteUrl)
```

* 发现 Feed

---

## async validateFeed(feedUrl)

```javascript
async validateFeed(feedUrl)
```

* 验证 Feed

---

## startAutoSync(feedId)

```javascript
startAutoSync(feedId)
```

* 启动自动同步

---

## stopAutoSync(feedId)

```javascript
stopAutoSync(feedId)
```

* 停止自动同步

---

## cleanup()

```javascript
cleanup()
```

* 清理资源

---

