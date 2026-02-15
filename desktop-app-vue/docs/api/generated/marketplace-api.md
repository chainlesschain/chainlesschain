# marketplace-api

**Source**: `src/main/plugins/marketplace-api.js`

**Generated**: 2026-02-15T08:42:37.209Z

---

## const

```javascript
const
```

* 插件市场API客户端
 *
 * 负责与插件市场后端服务通信
 * 支持插件发现、下载、评分、评论等功能

---

## ensureCacheDir()

```javascript
ensureCacheDir()
```

* 确保缓存目录存在

---

## getCacheKey(endpoint, params =

```javascript
getCacheKey(endpoint, params =
```

* 获取缓存键

---

## getFromCache(key)

```javascript
getFromCache(key)
```

* 从缓存读取

---

## setCache(key, data)

```javascript
setCache(key, data)
```

* 写入缓存

---

## clearCache()

```javascript
clearCache()
```

* 清除缓存

---

## async listPlugins(options =

```javascript
async listPlugins(options =
```

* 获取插件列表

---

## async getPlugin(pluginId, useCache = true)

```javascript
async getPlugin(pluginId, useCache = true)
```

* 获取插件详情

---

## async downloadPlugin(pluginId, version = "latest")

```javascript
async downloadPlugin(pluginId, version = "latest")
```

* 下载插件

---

## async getPluginVersions(pluginId)

```javascript
async getPluginVersions(pluginId)
```

* 获取插件版本列表

---

## async checkUpdates(installedPlugins)

```javascript
async checkUpdates(installedPlugins)
```

* 检查插件更新

---

## async ratePlugin(pluginId, rating, comment = null)

```javascript
async ratePlugin(pluginId, rating, comment = null)
```

* 提交插件评分

---

## async getPluginReviews(pluginId, page = 1, pageSize = 10)

```javascript
async getPluginReviews(pluginId, page = 1, pageSize = 10)
```

* 获取插件评论

---

## async publishPlugin(pluginData, pluginFile)

```javascript
async publishPlugin(pluginData, pluginFile)
```

* 发布插件（开发者功能）

---

## async updatePlugin(pluginId, version, pluginFile, changelog)

```javascript
async updatePlugin(pluginId, version, pluginFile, changelog)
```

* 更新插件（开发者功能）

---

## async getCategories()

```javascript
async getCategories()
```

* 获取分类列表

---

## async searchPlugins(query, options =

```javascript
async searchPlugins(query, options =
```

* 搜索插件

---

## async getFeaturedPlugins(limit = 10)

```javascript
async getFeaturedPlugins(limit = 10)
```

* 获取推荐插件

---

## async reportPlugin(pluginId, reason, description)

```javascript
async reportPlugin(pluginId, reason, description)
```

* 报告插件问题

---

## async getPluginStats(pluginId)

```javascript
async getPluginStats(pluginId)
```

* 获取插件统计信息

---

