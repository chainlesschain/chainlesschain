# dynamic-few-shot-learner

**Source**: `src/main/ai-engine/dynamic-few-shot-learner.js`

**Generated**: 2026-02-16T13:44:34.694Z

---

## class DynamicFewShotLearner

```javascript
class DynamicFewShotLearner
```

* 动态Few-shot学习器
 *
 * 功能:
 * 1. 从用户历史中提取Few-shot示例
 * 2. 构建个性化的动态prompt
 * 3. 学习用户表达习惯
 * 4. 自适应调整示例数量和质量
 *
 * 优势:
 * - 个性化识别，准确率提升15-25%
 * - 自动学习用户表达习惯（"做个网页" vs "生成HTML文件"）
 * - 持续优化，越用越准
 *
 * 版本: v0.17.0-P1
 * 更新: 2026-01-01

---

## async getUserExamples(userId, intent = null, limit = null)

```javascript
async getUserExamples(userId, intent = null, limit = null)
```

* 从用户历史中提取Few-shot示例
   * @param {string} userId - 用户ID
   * @param {string} intent - 意图类型（可选，为null则获取所有意图）
   * @param {number} limit - 限制数量
   * @returns {Array} Few-shot示例数组

---

## async buildDynamicPrompt(text, userId, options =

```javascript
async buildDynamicPrompt(text, userId, options =
```

* 构建动态prompt
   * @param {string} text - 用户输入
   * @param {string} userId - 用户ID
   * @param {Object} options - 选项
   * @returns {string} 动态prompt

---

## async getGenericExamples(intent = null, limit = 3)

```javascript
async getGenericExamples(intent = null, limit = 3)
```

* 获取通用示例（用于补充用户示例不足的情况）
   * @param {string} intent - 意图类型
   * @param {number} limit - 限制数量
   * @returns {Array} 通用示例数组

---

## getHardcodedExamples(intent = null, limit = 3)

```javascript
getHardcodedExamples(intent = null, limit = 3)
```

* 获取硬编码的默认示例（最后的降级方案）
   * @param {string} intent - 意图类型
   * @param {number} limit - 限制数量
   * @returns {Array} 硬编码示例数组

---

## async recordRecognition(userId, userInput, result, success = true)

```javascript
async recordRecognition(userId, userInput, result, success = true)
```

* 记录识别结果（用于持续学习）
   * @param {string} userId - 用户ID
   * @param {string} userInput - 用户输入
   * @param {Object} result - 识别结果
   * @param {boolean} success - 是否成功
   * @returns {void}

---

## async getUserIntentPreference(userId, limit = 10)

```javascript
async getUserIntentPreference(userId, limit = 10)
```

* 获取用户意图偏好统计
   * @param {string} userId - 用户ID
   * @param {number} limit - 限制数量
   * @returns {Array} 意图偏好列表

---

## async adaptiveExampleCount(userId, baseCount = 3)

```javascript
async adaptiveExampleCount(userId, baseCount = 3)
```

* 自适应调整示例数量
   * @param {string} userId - 用户ID
   * @param {number} baseCount - 基础示例数
   * @returns {number} 调整后的示例数

---

## async cleanOldData(retentionDays = 90)

```javascript
async cleanOldData(retentionDays = 90)
```

* 清理旧数据
   * @param {number} retentionDays - 保留天数
   * @returns {number} 删除的记录数

---

## getFromCache(key)

```javascript
getFromCache(key)
```

* 从缓存获取
   * @param {string} key - 缓存键
   * @returns {Array|null} 缓存的示例数组

---

## setToCache(key, data)

```javascript
setToCache(key, data)
```

* 设置缓存
   * @param {string} key - 缓存键
   * @param {Array} data - 数据
   * @returns {void}

---

## clearUserCache(userId)

```javascript
clearUserCache(userId)
```

* 清除用户缓存
   * @param {string} userId - 用户ID
   * @returns {void}

---

## clearAllCache()

```javascript
clearAllCache()
```

* 清除所有缓存
   * @returns {void}

---

## getCacheStats()

```javascript
getCacheStats()
```

* 获取缓存统计
   * @returns {Object} 缓存统计信息

---

