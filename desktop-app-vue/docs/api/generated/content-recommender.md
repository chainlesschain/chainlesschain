# content-recommender

**Source**: `src/main/ai-engine/content-recommender.js`

**Generated**: 2026-02-21T20:04:16.286Z

---

## class ContentRecommender

```javascript
class ContentRecommender
```

* ContentRecommender - 基于内容的推荐算法
 * P2智能层Phase 4 - 推荐系统
 *
 * 功能:
 * - 工具特征提取
 * - 工具相似度计算
 * - 基于内容的推荐
 * - 工具链推荐
 *
 * Version: v0.24.0
 * Date: 2026-01-02

---

## setDatabase(db)

```javascript
setDatabase(db)
```

* 设置数据库连接

---

## async buildToolFeatures()

```javascript
async buildToolFeatures()
```

* 构建工具特征

---

## createFeatureVector(tool)

```javascript
createFeatureVector(tool)
```

* 创建工具特征向量

---

## calculateToolSimilarity(tool1, tool2)

```javascript
calculateToolSimilarity(tool1, tool2)
```

* 计算工具相似度 (余弦相似度)
   * @param {string} tool1 - 工具1
   * @param {string} tool2 - 工具2
   * @returns {number} 相似度 [0, 1]

---

## findSimilarTools(toolName)

```javascript
findSimilarTools(toolName)
```

* 查找相似工具
   * @param {string} toolName - 工具名称
   * @returns {Array} 相似工具列表 [{tool, similarity}]

---

## async buildToolChains()

```javascript
async buildToolChains()
```

* 构建工具链统计

---

## async recommendTools(userId, topK = 5)

```javascript
async recommendTools(userId, topK = 5)
```

* 基于内容推荐工具
   * @param {string} userId - 用户ID
   * @param {number} topK - 推荐数量
   * @returns {Array} 推荐列表

---

## async recommendNextTools(currentTool, topK = 3)

```javascript
async recommendNextTools(currentTool, topK = 3)
```

* 工具链推荐
   * @param {string} currentTool - 当前工具
   * @param {number} topK - 推荐数量
   * @returns {Array} 推荐列表

---

## generateReason(basedOnTools)

```javascript
generateReason(basedOnTools)
```

* 生成推荐理由

---

## getStats()

```javascript
getStats()
```

* 获取统计信息

---

