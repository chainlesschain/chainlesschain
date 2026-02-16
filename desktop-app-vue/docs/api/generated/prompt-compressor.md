# prompt-compressor

**Source**: `src/main/llm/prompt-compressor.js`

**Generated**: 2026-02-16T13:44:34.653Z

---

## const

```javascript
const
```

* Prompt 压缩器模块
 * 实现智能 Prompt 压缩策略，减少 Token 使用量
 *
 * 策略：
 * 1. 消息去重：移除重复或相似的消息
 * 2. 历史截断：保留最近的 N 条消息，截断旧消息
 * 3. 智能总结：对长历史使用 LLM 生成摘要
 *
 * 目标：压缩率 0.6-0.7 (节省 30-40% tokens)
 *
 * @module prompt-compressor

---

## function md5Hash(text)

```javascript
function md5Hash(text)
```

* 计算文本的 MD5 哈希
 * @param {string} text - 输入文本
 * @returns {string} MD5 哈希值

---

## function estimateTokens(text)

```javascript
function estimateTokens(text)
```

* 估算消息的 Token 数量（粗略估计）
 * 规则：英文 1 token ≈ 4 字符，中文 1 token ≈ 1-2 字符
 * @param {string} text - 文本内容
 * @returns {number} 估算的 Token 数

---

## function calculateSimilarity(str1, str2)

```javascript
function calculateSimilarity(str1, str2)
```

* 计算两个字符串的相似度（简化的 Jaccard 相似度）
 * @param {string} str1 - 字符串1
 * @param {string} str2 - 字符串2
 * @returns {number} 相似度 (0-1)

---

## constructor(options =

```javascript
constructor(options =
```

* 创建 Prompt 压缩器
   * @param {Object} options - 配置选项
   * @param {boolean} [options.enableDeduplication=true] - 启用消息去重
   * @param {boolean} [options.enableSummarization=false] - 启用智能总结（需要 LLM）
   * @param {boolean} [options.enableTruncation=true] - 启用历史截断
   * @param {number} [options.maxHistoryMessages=10] - 最大历史消息数
   * @param {number} [options.maxTotalTokens=4000] - 最大总 Token 数
   * @param {number} [options.similarityThreshold=0.9] - 相似度阈值（>= 此值视为重复）
   * @param {Object} [options.llmManager=null] - LLM 管理器（用于总结）

---

## async compress(messages, options =

```javascript
async compress(messages, options =
```

* 压缩消息数组
   * @param {Array} messages - 消息数组 [{role, content}, ...]
   * @param {Object} options - 压缩选项
   * @param {boolean} [options.preserveSystemMessage=true] - 保留 system 消息
   * @param {boolean} [options.preserveLastUserMessage=true] - 保留最后一条用户消息
   * @returns {Promise<Object>} 压缩结果 {messages, originalTokens, compressedTokens, compressionRatio, strategy}

---

## _deduplicateMessages(messages, options)

```javascript
_deduplicateMessages(messages, options)
```

* 消息去重（移除重复或高度相似的消息）
   * @private

---

## _truncateHistory(messages, options)

```javascript
_truncateHistory(messages, options)
```

* 历史截断（保留最近的消息）
   * @private

---

## async _summarizeHistory(messages, options)

```javascript
async _summarizeHistory(messages, options)
```

* 智能总结（使用 LLM 生成历史摘要）
   * @private

---

## getStats()

```javascript
getStats()
```

* 获取压缩统计信息
   * @returns {Object} 统计信息

---

## updateConfig(options)

```javascript
updateConfig(options)
```

* 更新配置
   * @param {Object} options - 新的配置选项

---

