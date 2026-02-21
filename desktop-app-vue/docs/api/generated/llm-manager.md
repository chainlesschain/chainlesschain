# llm-manager

**Source**: `src/main/llm/llm-manager.js`

**Generated**: 2026-02-21T20:04:16.240Z

---

## const

```javascript
const
```

* LLM 服务管理器
 *
 * 统一管理不同的LLM服务提供商
 *
 * 🔥 Manus 优化集成 (2026-01-17):
 * - Context Engineering: KV-Cache 友好的 Prompt 构建
 * - Tool Masking: 通过掩码控制工具可用性
 * - Task Tracking: 任务目标重述机制
 *
 * @see https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus

---

## const LLMProviders =

```javascript
const LLMProviders =
```

* LLM 提供商类型

---

## class LLMManager extends EventEmitter

```javascript
class LLMManager extends EventEmitter
```

* LLM管理器类

---

## async initialize()

```javascript
async initialize()
```

* 初始化管理器

---

## async createClient(provider)

```javascript
async createClient(provider)
```

* 创建客户端
   * @param {string} provider - 提供商类型

---

## async switchProvider(provider, config =

```javascript
async switchProvider(provider, config =
```

* 切换提供商
   * @param {string} provider - 提供商类型
   * @param {Object} config - 配置

---

## async checkStatus()

```javascript
async checkStatus()
```

* 检查服务状态

---

## async query(prompt, options =

```javascript
async query(prompt, options =
```

* 发送查询（非流式）
   * @param {string} prompt - 提示词
   * @param {Object} options - 选项

---

## async chat(messages, options =

```javascript
async chat(messages, options =
```

* 向后兼容：聊天对话（消息数组）
   * @param {Array} messages
   * @param {Object} options

---

## async chatStream(messages, onChunk, options =

```javascript
async chatStream(messages, onChunk, options =
```

* 向后兼容：聊天对话（流式）
   * @param {Array} messages
   * @param {Function} onChunk
   * @param {Object} options

---

## async chatWithMessages(messages, options =

```javascript
async chatWithMessages(messages, options =
```

* 聊天对话（支持完整messages数组，非流式）
   * @param {Array} messages - 消息数组 [{role: 'user'|'assistant'|'system', content: string}]
   * @param {Object} options - 选项

---

## async chatWithMessagesStream(messages, onChunk, options =

```javascript
async chatWithMessagesStream(messages, onChunk, options =
```

* 聊天对话（支持完整messages数组，流式）
   * @param {Array} messages - 消息数组
   * @param {Function} onChunk - 回调函数
   * @param {Object} options - 选项

---

## async queryStream(prompt, onChunk, options =

```javascript
async queryStream(prompt, onChunk, options =
```

* 发送查询（流式）
   * @param {string} prompt - 提示词
   * @param {Function} onChunk - 回调函数
   * @param {Object} options - 选项

---

## clearContext(conversationId)

```javascript
clearContext(conversationId)
```

* 清除会话上下文
   * @param {string} conversationId - 会话ID

---

## getContext(conversationId)

```javascript
getContext(conversationId)
```

* 获取会话上下文
   * @param {string} conversationId - 会话ID

---

## async embeddings(text)

```javascript
async embeddings(text)
```

* 生成嵌入向量
   * @param {string} text - 文本

---

## async listModels()

```javascript
async listModels()
```

* 列出可用模型

---

## selectVolcengineModel(scenario =

```javascript
selectVolcengineModel(scenario =
```

* 智能选择模型（仅限火山引擎）
   * @param {Object} scenario - 场景描述
   * @returns {Object} 推荐的模型配置

---

## selectModelByTask(taskType, options =

```javascript
selectModelByTask(taskType, options =
```

* 根据任务类型智能选择模型
   * @param {string} taskType - 任务类型（来自 TaskTypes）
   * @param {Object} options - 选项
   * @returns {Object} 推荐的模型配置

---

## estimateCost(modelId, inputTokens = 0, outputTokens = 0, imageCount = 0)

```javascript
estimateCost(modelId, inputTokens = 0, outputTokens = 0, imageCount = 0)
```

* 估算成本（仅限火山引擎）
   * @param {string} modelId - 模型ID
   * @param {number} inputTokens - 输入tokens
   * @param {number} outputTokens - 输出tokens
   * @param {number} imageCount - 图片数量
   * @returns {number} 预估成本（人民币）

---

## listVolcengineModels(filters =

```javascript
listVolcengineModels(filters =
```

* 列出火山引擎所有可用模型
   * @param {Object} filters - 过滤条件
   * @returns {Array} 模型列表

---

## async chatWithWebSearch(messages, options =

```javascript
async chatWithWebSearch(messages, options =
```

* 启用联网搜索的对话
   * @param {Array} messages - 消息数组
   * @param {Object} options - 选项
   * @returns {Promise<Object>} API响应

---

## async chatWithImageProcess(messages, options =

```javascript
async chatWithImageProcess(messages, options =
```

* 启用图像处理的对话
   * @param {Array} messages - 消息数组（需包含图像URL）
   * @param {Object} options - 选项
   * @returns {Promise<Object>} API响应

---

## async chatWithKnowledgeBase(messages, knowledgeBaseId, options =

```javascript
async chatWithKnowledgeBase(messages, knowledgeBaseId, options =
```

* 使用知识库增强的对话
   * @param {Array} messages - 消息数组
   * @param {string} knowledgeBaseId - 知识库ID
   * @param {Object} options - 选项
   * @returns {Promise<Object>} API响应

---

## async chatWithFunctionCalling(messages, functions, options =

```javascript
async chatWithFunctionCalling(messages, functions, options =
```

* Function Calling 对话
   * @param {Array} messages - 消息数组
   * @param {Array} functions - 可用函数列表
   * @param {Object} options - 选项
   * @returns {Promise<Object>} API响应

---

## async chatWithMultipleTools(messages, toolConfig =

```javascript
async chatWithMultipleTools(messages, toolConfig =
```

* 混合多种工具的对话（智能组合）
   * @param {Array} messages - 消息数组
   * @param {Object} toolConfig - 工具配置
   * @returns {Promise<Object>} API响应

---

## async _handleBudgetAlert(alert)

```javascript
async _handleBudgetAlert(alert)
```

* 处理预算告警事件（内部方法）
   * @private
   * @param {Object} alert - 告警详情

---

## async _switchToCheaperModel()

```javascript
async _switchToCheaperModel()
```

* 切换到更便宜的模型（内部方法）
   * @private

---

## async resumeService(userId = "default")

```javascript
async resumeService(userId = "default")
```

* 恢复被暂停的服务
   * @param {string} userId - 用户 ID

---

## async pauseService()

```javascript
async pauseService()
```

* 手动暂停服务

---

## async getBudgetConfig(userId = "default")

```javascript
async getBudgetConfig(userId = "default")
```

* 获取预算配置
   * @param {string} userId - 用户 ID
   * @returns {Promise<Object>}

---

## async saveBudgetConfig(userId = "default", config)

```javascript
async saveBudgetConfig(userId = "default", config)
```

* 保存预算配置
   * @param {string} userId - 用户 ID
   * @param {Object} config - 预算配置
   * @returns {Promise<Object>}

---

## async getUsageStats(options =

```javascript
async getUsageStats(options =
```

* 获取使用统计
   * @param {Object} options - 查询选项
   * @returns {Promise<Object>}

---

## async getTimeSeriesData(options =

```javascript
async getTimeSeriesData(options =
```

* 获取时间序列数据（用于图表）
   * @param {Object} options - 查询选项
   * @returns {Promise<Array>}

---

## async getCostBreakdown(options =

```javascript
async getCostBreakdown(options =
```

* 获取成本分解（按提供商/模型）
   * @param {Object} options - 查询选项
   * @returns {Promise<Object>}

---

## async exportCostReport(options =

```javascript
async exportCostReport(options =
```

* 导出成本报告
   * @param {Object} options - 导出选项
   * @returns {Promise<string>} CSV 文件路径

---

## calculateCostEstimate(

```javascript
calculateCostEstimate(
```

* 计算成本估算（支持多提供商）
   * @param {string} provider - 提供商
   * @param {string} model - 模型名称
   * @param {number} inputTokens - 输入 tokens
   * @param {number} outputTokens - 输出 tokens
   * @param {number} cachedTokens - 缓存 tokens
   * @returns {Object} 成本估算结果

---

## async canPerformOperation(estimatedTokens = 0)

```javascript
async canPerformOperation(estimatedTokens = 0)
```

* 检查是否可以执行操作（预算检查）
   * @param {number} estimatedTokens - 预估 token 数量
   * @returns {Promise<Object>} { allowed: boolean, reason?: string }

---

## async close()

```javascript
async close()
```

* 关闭管理器

---

## function getLLMManager(config =

```javascript
function getLLMManager(config =
```

* 获取LLM管理器单例
 * @param {Object} config - 配置对象（仅首次调用时生效）
 * @returns {LLMManager}

---

## LLMManager.prototype.generateTags = async function (

```javascript
LLMManager.prototype.generateTags = async function (
```

* 为LLMManager添加AI标签生成和摘要生成功能

---

## LLMManager.prototype.generateTagsFallback = function (

```javascript
LLMManager.prototype.generateTagsFallback = function (
```

* Fallback标签生成（简单关键词提取）

---

## LLMManager.prototype.generateSummary = async function (

```javascript
LLMManager.prototype.generateSummary = async function (
```

* 生成内容摘要

---

## LLMManager.prototype.generateSummaryFallback = function (

```javascript
LLMManager.prototype.generateSummaryFallback = function (
```

* Fallback摘要生成（简单截取）

---

## LLMManager.prototype.buildOptimizedPrompt = function (options)

```javascript
LLMManager.prototype.buildOptimizedPrompt = function (options)
```

* 构建优化后的 Prompt（KV-Cache 友好）
 *
 * @param {Object} options - 构建选项
 * @param {string} options.systemPrompt - 系统提示词
 * @param {Array} options.messages - 对话历史
 * @param {Array} options.tools - 工具定义（可选）
 * @returns {Object} 优化后的消息和元数据

---

## LLMManager.prototype.chatWithOptimizedPrompt = async function (

```javascript
LLMManager.prototype.chatWithOptimizedPrompt = async function (
```

* 使用优化后的 Prompt 进行对话
 *
 * @param {Array} messages - 消息数组
 * @param {Object} options - 选项
 * @param {string} options.systemPrompt - 系统提示词
 * @param {Array} options.tools - 工具定义
 * @returns {Promise<Object>} 对话结果

---

## LLMManager.prototype.startTask = function (task)

```javascript
LLMManager.prototype.startTask = function (task)
```

* 开始任务追踪（Manus todo.md 机制）
 *
 * @param {Object} task - 任务信息
 * @param {string} task.objective - 任务目标
 * @param {Array} task.steps - 任务步骤
 * @returns {Object} 任务信息

---

## LLMManager.prototype.updateTaskProgress = function (stepIndex, status)

```javascript
LLMManager.prototype.updateTaskProgress = function (stepIndex, status)
```

* 更新任务进度
 *
 * @param {number} stepIndex - 当前步骤索引
 * @param {string} status - 状态

---

## LLMManager.prototype.completeCurrentStep = function ()

```javascript
LLMManager.prototype.completeCurrentStep = function ()
```

* 完成当前步骤

---

## LLMManager.prototype.completeTask = function ()

```javascript
LLMManager.prototype.completeTask = function ()
```

* 完成任务

---

## LLMManager.prototype.cancelTask = function ()

```javascript
LLMManager.prototype.cancelTask = function ()
```

* 取消任务

---

## LLMManager.prototype.getCurrentTask = function ()

```javascript
LLMManager.prototype.getCurrentTask = function ()
```

* 获取当前任务
 * @returns {Object|null} 当前任务

---

## LLMManager.prototype.recordError = function (error)

```javascript
LLMManager.prototype.recordError = function (error)
```

* 记录错误（供模型学习）
 * @param {Object} error - 错误信息

---

## LLMManager.prototype.setToolAvailable = function (toolName, available)

```javascript
LLMManager.prototype.setToolAvailable = function (toolName, available)
```

* 设置工具可用性
 * @param {string} toolName - 工具名称
 * @param {boolean} available - 是否可用

---

## LLMManager.prototype.setToolsByPrefix = function (prefix, available)

```javascript
LLMManager.prototype.setToolsByPrefix = function (prefix, available)
```

* 按前缀设置工具可用性
 * @param {string} prefix - 工具前缀
 * @param {boolean} available - 是否可用

---

## LLMManager.prototype.validateToolCall = function (toolName)

```javascript
LLMManager.prototype.validateToolCall = function (toolName)
```

* 验证工具调用
 * @param {string} toolName - 工具名称
 * @returns {Object} 验证结果

---

## LLMManager.prototype.configureTaskPhases = function (config)

```javascript
LLMManager.prototype.configureTaskPhases = function (config)
```

* 配置任务阶段状态机
 * @param {Object} config - 状态机配置（可选）

---

## LLMManager.prototype.transitionToPhase = function (phase)

```javascript
LLMManager.prototype.transitionToPhase = function (phase)
```

* 切换到指定阶段
 * @param {string} phase - 阶段名称
 * @returns {boolean} 是否成功

---

## LLMManager.prototype.getManusStats = function ()

```javascript
LLMManager.prototype.getManusStats = function ()
```

* 获取 Manus 优化统计
 * @returns {Object} 统计数据

---

## LLMManager.prototype.compressContent = function (content, type)

```javascript
LLMManager.prototype.compressContent = function (content, type)
```

* 压缩内容（可恢复压缩）
 * @param {any} content - 原始内容
 * @param {string} type - 内容类型
 * @returns {Object} 压缩后的引用

---

