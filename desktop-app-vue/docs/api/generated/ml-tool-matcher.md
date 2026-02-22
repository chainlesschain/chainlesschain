# ml-tool-matcher

**Source**: `src/main/ai-engine/ml-tool-matcher.js`

**Generated**: 2026-02-22T01:23:36.763Z

---

## const

```javascript
const
```

* MLToolMatcher - ML工具匹配器
 * P2智能层Phase 3 - 智能工具推荐
 *
 * 功能:
 * - 基于特征的工具推荐
 * - 多因子评分机制
 * - Top-K推荐
 * - 置信度计算
 * - 推荐解释生成
 *
 * Version: v0.23.0
 * Date: 2026-01-02

---

## setDatabase(db)

```javascript
setDatabase(db)
```

* 设置数据库连接

---

## setToolRegistry(toolRegistry)

```javascript
setToolRegistry(toolRegistry)
```

* 设置工具注册表

---

## async recommendTools(task, userId)

```javascript
async recommendTools(task, userId)
```

* 推荐工具
   * @param {Object} task - 任务对象
   * @param {string} userId - 用户ID
   * @returns {Array} 推荐工具列表

---

## getCandidateTools(features)

```javascript
getCandidateTools(features)
```

* 获取候选工具

---

## async scoreTools(candidates, features, userId)

```javascript
async scoreTools(candidates, features, userId)
```

* 为工具评分

---

## async calculateToolScore(tool, features, userId)

```javascript
async calculateToolScore(tool, features, userId)
```

* 计算工具评分

---

## calculateTextMatchScore(tool, textFeatures)

```javascript
calculateTextMatchScore(tool, textFeatures)
```

* 文本匹配评分

---

## calculatePreferenceScore(tool, userFeatures)

```javascript
calculatePreferenceScore(tool, userFeatures)
```

* 用户偏好评分

---

## async calculateHistoricalSuccessScore(toolName, userId, features)

```javascript
async calculateHistoricalSuccessScore(toolName, userId, features)
```

* 历史成功率评分

---

## calculateRecencyScore(tool, userFeatures)

```javascript
calculateRecencyScore(tool, userFeatures)
```

* 最近使用评分

---

## scoreToConfidence(score)

```javascript
scoreToConfidence(score)
```

* 评分转置信度

---

## generateExplanation(recommendation, features)

```javascript
generateExplanation(recommendation, features)
```

* 生成推荐解释

---

## async logRecommendation(userId, task, recommendations)

```javascript
async logRecommendation(userId, task, recommendations)
```

* 记录推荐

---

## async feedbackRecommendation(recommendationId, feedback)

```javascript
async feedbackRecommendation(recommendationId, feedback)
```

* 反馈推荐结果

---

## getStats()

```javascript
getStats()
```

* 获取统计信息

---

## async recommendBatch(tasks, userId)

```javascript
async recommendBatch(tasks, userId)
```

* 批量推荐

---

