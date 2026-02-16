# skill-recommender

**Source**: `src/main/skill-tool-system/skill-recommender.js`

**Generated**: 2026-02-16T13:44:34.615Z

---

## class SkillRecommender

```javascript
class SkillRecommender
```

* 技能推荐引擎
 * 基于用户意图和使用频率智能推荐技能

---

## async recommendSkills(userInput, options =

```javascript
async recommendSkills(userInput, options =
```

* 根据用户输入推荐技能
   * @param {string} userInput - 用户输入文本
   * @param {object} options - 推荐选项
   * @returns {Array} 推荐的技能列表

---

## analyzeIntent(userInput)

```javascript
analyzeIntent(userInput)
```

* 分析用户输入的意图
   * @param {string} userInput - 用户输入
   * @returns {Array} 意图列表及其置信度

---

## async calculateSkillScore(skill, intents, userInput, includeUsageStats)

```javascript
async calculateSkillScore(skill, intents, userInput, includeUsageStats)
```

* 计算技能的相关度分数
   * @param {object} skill - 技能对象
   * @param {Array} intents - 意图列表
   * @param {string} userInput - 原始用户输入
   * @param {boolean} includeUsageStats - 是否包含使用统计
   * @returns {number} 相关度分数 (0-1)

---

## calculateIntentScore(skill, intents)

```javascript
calculateIntentScore(skill, intents)
```

* 计算意图匹配分数

---

## calculateTextSimilarity(skill, userInput)

```javascript
calculateTextSimilarity(skill, userInput)
```

* 计算文本相似度分数

---

## calculateUsageScore(skill)

```javascript
calculateUsageScore(skill)
```

* 计算使用频率分数

---

## generateReason(skill, intents, score)

```javascript
generateReason(skill, intents, score)
```

* 生成推荐理由

---

## async getPopularSkills(limit = 10)

```javascript
async getPopularSkills(limit = 10)
```

* 获取热门技能
   * @param {number} limit - 返回数量
   * @returns {Array} 热门技能列表

---

## async getRelatedSkills(skillId, limit = 5)

```javascript
async getRelatedSkills(skillId, limit = 5)
```

* 获取推荐的相关技能
   * @param {string} skillId - 技能ID
   * @param {number} limit - 返回数量
   * @returns {Array} 相关技能列表

---

## calculatePopularityScore(skill)

```javascript
calculatePopularityScore(skill)
```

* 计算热门度分数

---

## async searchSkills(query, options =

```javascript
async searchSkills(query, options =
```

* 搜索技能
   * @param {string} query - 搜索关键词
   * @param {object} options - 搜索选项
   * @returns {Array} 搜索结果

---

## clearCache()

```javascript
clearCache()
```

* 清除缓存

---

## getStats()

```javascript
getStats()
```

* 获取推荐统计

---

