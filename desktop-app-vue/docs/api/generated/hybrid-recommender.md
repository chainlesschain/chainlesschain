# hybrid-recommender

**Source**: `src/main/ai-engine/hybrid-recommender.js`

**Generated**: 2026-02-21T22:45:05.327Z

---

## const

```javascript
const
```

* HybridRecommender - 混合推荐系统
 * P2智能层Phase 4 - 推荐系统
 *
 * 功能:
 * - 融合ML推荐、协同过滤、内容推荐
 * - 动态权重调整
 * - 多样性优化
 * - 增强推荐解释
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

## async recommend(task, userId)

```javascript
async recommend(task, userId)
```

* 混合推荐
   * @param {Object} task - 任务对象
   * @param {string} userId - 用户ID
   * @returns {Array} 推荐列表

---

## fuseRecommendations(mlRecs, cfRecs, cbRecs, weights)

```javascript
fuseRecommendations(mlRecs, cfRecs, cbRecs, weights)
```

* 融合推荐结果

---

## createFusedEntry(tool)

```javascript
createFusedEntry(tool)
```

* 创建融合条目

---

## calculateAdaptiveWeights(mlRecs, cfRecs, cbRecs)

```javascript
calculateAdaptiveWeights(mlRecs, cfRecs, cbRecs)
```

* 计算自适应权重

---

## optimizeDiversity(recommendations)

```javascript
optimizeDiversity(recommendations)
```

* 多样性优化

---

## getToolCategory(toolName)

```javascript
getToolCategory(toolName)
```

* 获取工具类别

---

## generateEnhancedExplanation(rec)

```javascript
generateEnhancedExplanation(rec)
```

* 生成增强推荐解释

---

## updateStats(recommendations)

```javascript
updateStats(recommendations)
```

* 更新统计信息

---

## getStats()

```javascript
getStats()
```

* 获取统计信息

---

## setWeights(weights)

```javascript
setWeights(weights)
```

* 调整权重

---

## async initialize()

```javascript
async initialize()
```

* 初始化推荐器

---

