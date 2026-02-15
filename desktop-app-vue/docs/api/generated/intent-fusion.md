# intent-fusion

**Source**: `src/main/ai-engine/intent-fusion.js`

**Generated**: 2026-02-15T10:10:53.453Z

---

## const

```javascript
const
```

* 意图融合模块 (Intent Fusion)
 * P2优化核心模块之一
 *
 * 功能:
 * - 合并相似意图，减少冗余LLM调用
 * - 支持规则融合和LLM智能融合
 * - 自动识别融合机会
 *
 * 版本: v0.18.0
 * 创建: 2026-01-01

---

## class IntentFusion

```javascript
class IntentFusion
```

* 意图融合器类

---

## constructor(config =

```javascript
constructor(config =
```

* @param {Object} config - 融合配置

---

## setDatabase(db)

```javascript
setDatabase(db)
```

* 设置数据库实例
   * @param {DatabaseManager} db - 数据库管理器

---

## setLLM(llm)

```javascript
setLLM(llm)
```

* 设置LLM实例
   * @param {Object} llm - LLM服务

---

## async fuseIntents(intents, context =

```javascript
async fuseIntents(intents, context =
```

* 融合意图列表（主入口）
   * @param {Array<Object>} intents - 意图列表
   * @param {Object} context - 上下文
   * @returns {Promise<Array<Object>>} - 融合后的意图列表

---

## _tryRuleFusion(intents, context)

```javascript
_tryRuleFusion(intents, context)
```

* 尝试规则融合
   * @param {Array<Object>} intents - 意图窗口
   * @param {Object} context - 上下文
   * @returns {Object|null} - 融合结果 {intent, consumed, strategy}

---

## _fuseSameFileOperations(intents)

```javascript
_fuseSameFileOperations(intents)
```

* 策略1: 同文件操作合并
   * 例如: CREATE_FILE + WRITE_FILE -> CREATE_AND_WRITE_FILE

---

## _fuseSequenceOperations(intents)

```javascript
_fuseSequenceOperations(intents)
```

* 策略2: 顺序操作合并
   * 例如: GIT_ADD + GIT_COMMIT + GIT_PUSH -> GIT_COMMIT_AND_PUSH

---

## _fuseBatchOperations(intents)

```javascript
_fuseBatchOperations(intents)
```

* 策略3: 批量操作合并
   * 例如: 多个CREATE_FILE -> BATCH_CREATE_FILES

---

## _fuseDependencyOperations(intents)

```javascript
_fuseDependencyOperations(intents)
```

* 策略4: 依赖操作合并
   * 例如: IMPORT_CSV + VALIDATE_DATA -> IMPORT_AND_VALIDATE_CSV

---

## async _tryLLMFusion(intents, context)

```javascript
async _tryLLMFusion(intents, context)
```

* 尝试LLM融合（智能融合复杂场景）
   * @param {Array<Object>} intents - 意图窗口
   * @param {Object} context - 上下文
   * @returns {Promise<Object|null>} - 融合结果

---

## _buildLLMFusionPrompt(intents, context)

```javascript
_buildLLMFusionPrompt(intents, context)
```

* 构建LLM融合提示词

---

## _parseLLMFusionResponse(response)

```javascript
_parseLLMFusionResponse(response)
```

* 解析LLM融合响应

---

## async _recordFusion(

```javascript
async _recordFusion(
```

* 记录融合历史到数据库

---

## async getFusionStats(options =

```javascript
async getFusionStats(options =
```

* 获取融合统计
   * @param {Object} options - 过滤选项
   * @param {string} options.userId - 用户ID
   * @param {number} options.startTime - 开始时间(毫秒时间戳)
   * @param {number} options.endTime - 结束时间(毫秒时间戳)
   * @returns {Promise<Object>} - 统计数据

---

## _generateCacheKey(intents)

```javascript
_generateCacheKey(intents)
```

* 生成融合缓存键
   * @param {Array<Object>} intents - 意图窗口
   * @returns {string} - 缓存键

---

## _checkCache(intents)

```javascript
_checkCache(intents)
```

* 检查缓存
   * @param {Array<Object>} intents - 意图窗口
   * @returns {Object|null} - 缓存的融合结果

---

## _addToCache(intents, fusionResult)

```javascript
_addToCache(intents, fusionResult)
```

* 添加到缓存
   * @param {Array<Object>} intents - 意图窗口
   * @param {Object} fusionResult - 融合结果

---

## clearCache()

```javascript
clearCache()
```

* 清空缓存

---

## getPerformanceStats()

```javascript
getPerformanceStats()
```

* 获取性能统计
   * @returns {Object} - 性能统计数据

---

## resetPerformanceStats()

```javascript
resetPerformanceStats()
```

* 重置性能统计

---

