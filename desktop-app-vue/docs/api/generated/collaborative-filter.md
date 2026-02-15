# collaborative-filter

**Source**: `src/main/ai-engine/collaborative-filter.js`

**Generated**: 2026-02-15T07:37:13.872Z

---

## class CollaborativeFilter

```javascript
class CollaborativeFilter
```

* CollaborativeFilter - 协同过滤推荐算法
 * P2智能层Phase 4 - 推荐系统
 *
 * 功能:
 * - 用户-工具矩阵构建
 * - 用户相似度计算 (余弦相似度)
 * - 基于相似用户的工具推荐
 * - 评分预测
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

## async buildUserToolMatrix()

```javascript
async buildUserToolMatrix()
```

* 构建用户-工具矩阵
   * @returns {Map<userId, Map<toolName, rating>>}

---

## calculateUserSimilarity(userId1, userId2)

```javascript
calculateUserSimilarity(userId1, userId2)
```

* 计算两个用户的相似度 (余弦相似度)
   * @param {string} userId1 - 用户1
   * @param {string} userId2 - 用户2
   * @returns {number} 相似度 [0, 1]

---

## async findSimilarUsers(userId)

```javascript
async findSimilarUsers(userId)
```

* 查找相似用户
   * @param {string} userId - 目标用户
   * @returns {Array} 相似用户列表 [{userId, similarity}]

---

## async recommendTools(userId, topK = 5)

```javascript
async recommendTools(userId, topK = 5)
```

* 基于协同过滤推荐工具
   * @param {string} userId - 目标用户
   * @param {number} topK - 推荐数量
   * @returns {Array} 推荐列表 [{tool, score, reason}]

---

## async predictRating(userId, toolName)

```javascript
async predictRating(userId, toolName)
```

* 预测用户对工具的评分
   * @param {string} userId - 用户ID
   * @param {string} toolName - 工具名称
   * @returns {number} 预测评分 [1, 5]

---

## generateReason(similarUsers)

```javascript
generateReason(similarUsers)
```

* 生成推荐理由

---

## getMatrixStats()

```javascript
getMatrixStats()
```

* 获取用户-工具矩阵统计

---

## getStats()

```javascript
getStats()
```

* 获取统计信息

---

## clearCache()

```javascript
clearCache()
```

* 清除缓存

---

## async refreshMatrix()

```javascript
async refreshMatrix()
```

* 刷新矩阵

---

