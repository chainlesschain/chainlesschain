# token-tracker

**Source**: `src/main/llm/token-tracker.js`

**Generated**: 2026-02-22T01:23:36.713Z

---

## const

```javascript
const
```

* TokenTracker - LLM Token 追踪和成本管理核心模块
 *
 * 功能:
 * - 记录每次 LLM API 调用的 token 使用和成本
 * - 多提供商定价数据 (OpenAI, Anthropic, DeepSeek, Volcengine, Ollama)
 * - 预算管理和告警
 * - 统计查询和报告导出

---

## const PRICING_DATA =

```javascript
const PRICING_DATA =
```

* LLM 提供商定价数据 (按百万 tokens 计费, USD)
 *
 * 数据来源:
 * - OpenAI: https://openai.com/pricing (2026-01)
 * - Anthropic: https://www.anthropic.com/pricing (2026-01)
 * - DeepSeek: https://platform.deepseek.com/pricing (2026-01)
 * - Volcengine: volcengine-models.js

---

## class TokenTracker extends EventEmitter

```javascript
class TokenTracker extends EventEmitter
```

* TokenTracker 类

---

## constructor(database, options =

```javascript
constructor(database, options =
```

* 构造函数
   * @param {Object} database - 数据库管理器实例
   * @param {Object} options - 配置选项
   * @param {boolean} options.enableCostTracking - 启用成本追踪 (默认: true)
   * @param {boolean} options.enableBudgetAlerts - 启用预算告警 (默认: true)
   * @param {number} options.exchangeRate - 美元到人民币汇率 (默认: 7.2)

---

## loadVolcenginePricing()

```javascript
loadVolcenginePricing()
```

* 从 volcengine-models.js 加载定价数据

---

## async recordUsage(params)

```javascript
async recordUsage(params)
```

* 记录单次 LLM API 调用
   * @param {Object} params - 使用参数
   * @param {string} params.conversationId - 对话 ID
   * @param {string} params.messageId - 消息 ID
   * @param {string} params.provider - 提供商 (ollama/openai/anthropic/deepseek/volcengine/custom)
   * @param {string} params.model - 模型名称
   * @param {number} params.inputTokens - 输入 tokens
   * @param {number} params.outputTokens - 输出 tokens
   * @param {number} params.cachedTokens - 缓存 tokens (Anthropic Prompt Caching)
   * @param {boolean} params.wasCached - 是否来自响应缓存
   * @param {boolean} params.wasCompressed - 是否使用了 Prompt 压缩
   * @param {number} params.compressionRatio - 压缩率 (0-1)
   * @param {number} params.responseTime - 响应时间 (毫秒)
   * @param {string} params.endpoint - API 端点
   * @param {string} params.userId - 用户 ID (默认: 'default')

---

## calculateCost(

```javascript
calculateCost(
```

* 计算成本
   * @param {string} provider - 提供商
   * @param {string} model - 模型名称
   * @param {number} inputTokens - 输入 tokens
   * @param {number} outputTokens - 输出 tokens
   * @param {number} cachedTokens - 缓存 tokens (Anthropic)
   * @returns {Object} { costUsd, costCny, pricing }

---

## updateConversationStats(

```javascript
updateConversationStats(
```

* 更新对话统计
   * @param {string} conversationId
   * @param {number} inputTokens
   * @param {number} outputTokens
   * @param {number} costUsd
   * @param {number} costCny

---

## async updateBudgetSpend(userId, costUsd)

```javascript
async updateBudgetSpend(userId, costUsd)
```

* 更新预算支出
   * @param {string} userId
   * @param {number} costUsd

---

## async checkBudgetAlerts(userId)

```javascript
async checkBudgetAlerts(userId)
```

* 检查预算告警
   * @param {string} userId

---

## async getBudgetConfig(userId = "default")

```javascript
async getBudgetConfig(userId = "default")
```

* 获取预算配置
   * @param {string} userId
   * @returns {Promise<Object|null>}

---

## async saveBudgetConfig(userId, config)

```javascript
async saveBudgetConfig(userId, config)
```

* 保存预算配置
   * @param {string} userId
   * @param {Object} config

---

## async getUsageStats(options =

```javascript
async getUsageStats(options =
```

* 获取使用统计
   * @param {Object} options
   * @param {number} options.startDate - 开始时间戳
   * @param {number} options.endDate - 结束时间戳
   * @param {string} options.provider - 提供商过滤
   * @param {string} options.groupBy - 分组方式 (day/week/month)
   * @returns {Promise<Object>}

---

## async getTimeSeriesData(options =

```javascript
async getTimeSeriesData(options =
```

* 获取时间序列数据 (用于图表)
   * @param {Object} options
   * @param {number} options.startDate
   * @param {number} options.endDate
   * @param {string} options.interval - 时间间隔 (hour/day/week)
   * @returns {Promise<Array>}

---

## async getCostBreakdown(options =

```javascript
async getCostBreakdown(options =
```

* 获取成本分解 (按提供商/模型)
   * @param {Object} options
   * @returns {Promise<Object>}

---

## async exportCostReport(options =

```javascript
async exportCostReport(options =
```

* 导出成本报告 (CSV)
   * @param {Object} options
   * @returns {Promise<string>} CSV 文件路径

---

