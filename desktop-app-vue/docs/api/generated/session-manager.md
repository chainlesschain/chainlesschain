# session-manager

**Source**: `src\main\llm\session-manager.js`

**Generated**: 2026-01-27T06:44:03.846Z

---

## const

```javascript
const
```

* SessionManager - 会话上下文管理器
 *
 * 功能：
 * - 会话持久化（保存到 .chainlesschain/memory/sessions/）
 * - 智能上下文压缩（集成 PromptCompressor）
 * - 跨会话连续对话
 * - Token 使用优化（减少 30-40%）
 *
 * 基于 OpenClaude 最佳实践
 *
 * @module session-manager
 * @version 1.0.0
 * @since 2026-01-16

---

## class SessionManager extends EventEmitter

```javascript
class SessionManager extends EventEmitter
```

* SessionManager 类

---

## constructor(options =

```javascript
constructor(options =
```

* 创建会话管理器
   * @param {Object} options - 配置选项
   * @param {Object} options.database - 数据库实例
   * @param {Object} options.llmManager - LLM 管理器实例（用于智能总结）
   * @param {string} options.sessionsDir - 会话存储目录
   * @param {number} [options.maxHistoryMessages=10] - 最大历史消息数
   * @param {number} [options.compressionThreshold=10] - 触发压缩的消息数阈值
   * @param {boolean} [options.enableAutoSave=true] - 启用自动保存
   * @param {boolean} [options.enableCompression=true] - 启用智能压缩
   * @param {boolean} [options.enableAutoSummary=true] - 启用自动摘要生成
   * @param {number} [options.autoSummaryThreshold=5] - 触发自动摘要的消息数阈值
   * @param {number} [options.autoSummaryInterval=300000] - 后台自动摘要检查间隔（毫秒，默认5分钟）
   * @param {boolean} [options.enableBackgroundSummary=true] - 启用后台摘要生成

---

## async initialize()

```javascript
async initialize()
```

* 初始化（确保目录存在）

---

## destroy()

```javascript
destroy()
```

* 销毁实例（清理后台任务）

---

## async createSession(params)

```javascript
async createSession(params)
```

* 创建新会话
   * @param {Object} params
   * @param {string} params.conversationId - 对话 ID
   * @param {string} [params.title] - 会话标题
   * @param {Object} [params.metadata] - 会话元数据
   * @returns {Promise<Object>} 会话对象

---

## async loadSession(sessionId, options =

```javascript
async loadSession(sessionId, options =
```

* 加载会话
   * @param {string} sessionId - 会话 ID
   * @param {Object} options - 加载选项
   * @param {boolean} [options.fromCache=true] - 优先从缓存加载
   * @param {boolean} [options.fromFile=false] - 从文件加载
   * @returns {Promise<Object>} 会话对象

---

## async addMessage(sessionId, message, options =

```javascript
async addMessage(sessionId, message, options =
```

* 添加消息到会话
   * @param {string} sessionId - 会话 ID
   * @param {Object} message - 消息对象 {role, content}
   * @param {Object} options - 添加选项
   * @returns {Promise<Object>} 更新后的会话

---

## _shouldAutoGenerateSummary(session)

```javascript
_shouldAutoGenerateSummary(session)
```

* 检查是否应该自动生成摘要
   * @private

---

## _queueAutoSummary(sessionId)

```javascript
_queueAutoSummary(sessionId)
```

* 将会话加入自动摘要队列
   * @private

---

## async _processAutoSummaryQueue()

```javascript
async _processAutoSummaryQueue()
```

* 处理自动摘要队列
   * @private

---

## async _generateAutoSummary(sessionId)

```javascript
async _generateAutoSummary(sessionId)
```

* 生成自动摘要
   * @private

---

## async compressSession(sessionId)

```javascript
async compressSession(sessionId)
```

* 压缩会话历史
   * @param {string} sessionId - 会话 ID
   * @returns {Promise<Object>} 压缩结果

---

## async saveSession(sessionId)

```javascript
async saveSession(sessionId)
```

* 保存会话（到数据库和文件）
   * @param {string} sessionId - 会话 ID
   * @returns {Promise<void>}

---

## async saveSessionToFile(session)

```javascript
async saveSessionToFile(session)
```

* 保存会话到文件
   * @param {Object} session - 会话对象
   * @returns {Promise<void>}

---

## async loadSessionFromFile(sessionId)

```javascript
async loadSessionFromFile(sessionId)
```

* 从文件加载会话
   * @param {string} sessionId - 会话 ID
   * @returns {Promise<Object>}

---

## async getEffectiveMessages(sessionId)

```javascript
async getEffectiveMessages(sessionId)
```

* 获取会话的有效消息（用于 LLM 调用）
   * @param {string} sessionId - 会话 ID
   * @returns {Promise<Array>} 消息数组

---

## async deleteSession(sessionId)

```javascript
async deleteSession(sessionId)
```

* 删除会话
   * @param {string} sessionId - 会话 ID
   * @returns {Promise<void>}

---

## async listSessions(options =

```javascript
async listSessions(options =
```

* 列出所有会话
   * @param {Object} options - 查询选项
   * @param {string} [options.conversationId] - 按对话 ID 过滤
   * @param {number} [options.limit=50] - 最大返回数量
   * @returns {Promise<Array>} 会话列表

---

## async getSessionStats(sessionId)

```javascript
async getSessionStats(sessionId)
```

* 获取会话统计
   * @param {string} sessionId - 会话 ID
   * @returns {Promise<Object>} 统计信息

---

## async cleanupOldSessions(daysToKeep = 30)

```javascript
async cleanupOldSessions(daysToKeep = 30)
```

* 清理旧会话（超过指定天数）
   * @param {number} daysToKeep - 保留天数
   * @returns {Promise<number>} 删除的会话数

---

## async searchSessions(query, options =

```javascript
async searchSessions(query, options =
```

* 搜索会话（按标题和内容）
   * @param {string} query - 搜索关键词
   * @param {Object} options - 搜索选项
   * @param {boolean} [options.searchContent=true] - 是否搜索消息内容
   * @param {boolean} [options.searchTitle=true] - 是否搜索标题
   * @param {string[]} [options.tags] - 按标签过滤
   * @param {number} [options.limit=20] - 最大返回数量
   * @param {number} [options.offset=0] - 偏移量（分页）
   * @returns {Promise<Array>} 搜索结果

---

## _parseSessionRow(row)

```javascript
_parseSessionRow(row)
```

* 解析数据库行为会话对象
   * @private

---

## async addTags(sessionId, tags)

```javascript
async addTags(sessionId, tags)
```

* 添加标签到会话
   * @param {string} sessionId - 会话 ID
   * @param {string|string[]} tags - 标签（单个或数组）
   * @returns {Promise<Object>} 更新后的会话

---

## async removeTags(sessionId, tags)

```javascript
async removeTags(sessionId, tags)
```

* 从会话移除标签
   * @param {string} sessionId - 会话 ID
   * @param {string|string[]} tags - 要移除的标签
   * @returns {Promise<Object>} 更新后的会话

---

## async getAllTags()

```javascript
async getAllTags()
```

* 获取所有使用过的标签
   * @returns {Promise<Array>} 标签列表（带使用次数）

---

## async findSessionsByTags(tags, options =

```javascript
async findSessionsByTags(tags, options =
```

* 按标签查找会话
   * @param {string[]} tags - 标签数组
   * @param {Object} options - 查询选项
   * @param {string} [options.matchMode='any'] - 匹配模式：'any'(任意) 或 'all'(全部)
   * @param {number} [options.limit=50] - 最大返回数量
   * @returns {Promise<Array>} 会话列表

---

## async exportToJSON(sessionId, options =

```javascript
async exportToJSON(sessionId, options =
```

* 导出会话为 JSON
   * @param {string} sessionId - 会话 ID
   * @param {Object} options - 导出选项
   * @param {boolean} [options.includeMetadata=true] - 包含元数据
   * @param {boolean} [options.prettify=true] - 美化 JSON
   * @returns {Promise<string>} JSON 字符串

---

## async exportToMarkdown(sessionId, options =

```javascript
async exportToMarkdown(sessionId, options =
```

* 导出会话为 Markdown
   * @param {string} sessionId - 会话 ID
   * @param {Object} options - 导出选项
   * @param {boolean} [options.includeTimestamp=true] - 包含时间戳
   * @param {boolean} [options.includeMetadata=false] - 包含元数据
   * @returns {Promise<string>} Markdown 字符串

---

## async importFromJSON(jsonData, options =

```javascript
async importFromJSON(jsonData, options =
```

* 从 JSON 导入会话
   * @param {string} jsonData - JSON 字符串
   * @param {Object} options - 导入选项
   * @param {boolean} [options.generateNewId=true] - 生成新的会话 ID
   * @param {string} [options.conversationId] - 指定对话 ID
   * @returns {Promise<Object>} 导入的会话

---

## async exportMultiple(sessionIds, options =

```javascript
async exportMultiple(sessionIds, options =
```

* 批量导出会话
   * @param {string[]} sessionIds - 会话 ID 数组
   * @param {Object} options - 导出选项
   * @returns {Promise<string>} JSON 字符串

---

## async generateSummary(sessionId, options =

```javascript
async generateSummary(sessionId, options =
```

* 生成会话摘要
   * @param {string} sessionId - 会话 ID
   * @param {Object} options - 摘要选项
   * @param {boolean} [options.useLLM=true] - 使用 LLM 生成（需要 llmManager）
   * @param {number} [options.maxLength=200] - 摘要最大长度
   * @returns {Promise<string>} 会话摘要

---

## async generateSummariesBatch(options =

```javascript
async generateSummariesBatch(options =
```

* 批量生成摘要
   * @param {Object} options - 选项
   * @param {boolean} [options.overwrite=false] - 覆盖已有摘要
   * @param {number} [options.limit=50] - 最多处理数量
   * @returns {Promise<Object>} 处理结果

---

## async resumeSession(sessionId, options =

```javascript
async resumeSession(sessionId, options =
```

* 恢复会话（获取续接上下文）
   * @param {string} sessionId - 会话 ID
   * @param {Object} options - 选项
   * @param {boolean} [options.generateContextPrompt=true] - 生成上下文提示
   * @returns {Promise<Object>} 恢复结果

---

## _generateContextPrompt(session)

```javascript
_generateContextPrompt(session)
```

* 生成上下文提示
   * @private

---

## async getRecentSessions(count = 5)

```javascript
async getRecentSessions(count = 5)
```

* 获取最近的会话（用于快速续接）
   * @param {number} count - 数量
   * @returns {Promise<Array>} 最近的会话列表

---

## async saveAsTemplate(sessionId, templateInfo)

```javascript
async saveAsTemplate(sessionId, templateInfo)
```

* 保存会话为模板
   * @param {string} sessionId - 会话 ID
   * @param {Object} templateInfo - 模板信息
   * @param {string} templateInfo.name - 模板名称
   * @param {string} [templateInfo.description] - 模板描述
   * @param {string} [templateInfo.category] - 分类
   * @returns {Promise<Object>} 模板对象

---

## async _ensureTemplateTable()

```javascript
async _ensureTemplateTable()
```

* 确保模板表存在
   * @private

---

## async createFromTemplate(templateId, options =

```javascript
async createFromTemplate(templateId, options =
```

* 从模板创建会话
   * @param {string} templateId - 模板 ID
   * @param {Object} options - 选项
   * @param {string} [options.conversationId] - 对话 ID
   * @param {string} [options.title] - 会话标题
   * @returns {Promise<Object>} 新会话

---

## async listTemplates(options =

```javascript
async listTemplates(options =
```

* 列出所有模板
   * @param {Object} options - 查询选项
   * @param {string} [options.category] - 按分类过滤
   * @param {number} [options.limit=50] - 最大返回数量
   * @returns {Promise<Array>} 模板列表

---

## async deleteTemplate(templateId)

```javascript
async deleteTemplate(templateId)
```

* 删除模板
   * @param {string} templateId - 模板 ID
   * @returns {Promise<void>}

---

## async deleteMultiple(sessionIds)

```javascript
async deleteMultiple(sessionIds)
```

* 批量删除会话
   * @param {string[]} sessionIds - 会话 ID 数组
   * @returns {Promise<Object>} 删除结果

---

## async addTagsToMultiple(sessionIds, tags)

```javascript
async addTagsToMultiple(sessionIds, tags)
```

* 批量添加标签
   * @param {string[]} sessionIds - 会话 ID 数组
   * @param {string[]} tags - 要添加的标签
   * @returns {Promise<Object>} 处理结果

---

## async getGlobalStats()

```javascript
async getGlobalStats()
```

* 获取全局统计信息
   * @returns {Promise<Object>} 统计信息

---

## async updateTitle(sessionId, title)

```javascript
async updateTitle(sessionId, title)
```

* 更新会话标题
   * @param {string} sessionId - 会话 ID
   * @param {string} title - 新标题
   * @returns {Promise<Object>} 更新后的会话

---

## async duplicateSession(sessionId, options =

```javascript
async duplicateSession(sessionId, options =
```

* 复制会话
   * @param {string} sessionId - 源会话 ID
   * @param {Object} options - 复制选项
   * @param {string} [options.titleSuffix=' - 副本'] - 标题后缀
   * @param {boolean} [options.includeMessages=true] - 包含消息
   * @param {boolean} [options.includeTags=true] - 包含标签
   * @param {boolean} [options.resetMetadata=true] - 重置元数据（压缩计数、Token节省等）
   * @returns {Promise<Object>} 复制后的新会话

---

## async renameTag(oldTag, newTag)

```javascript
async renameTag(oldTag, newTag)
```

* 重命名标签
   * @param {string} oldTag - 原标签名
   * @param {string} newTag - 新标签名
   * @returns {Promise<Object>} 更新结果

---

## async mergeTags(sourceTags, targetTag)

```javascript
async mergeTags(sourceTags, targetTag)
```

* 合并标签
   * @param {string[]} sourceTags - 源标签（将被删除）
   * @param {string} targetTag - 目标标签
   * @returns {Promise<Object>} 合并结果

---

## async deleteTag(tag)

```javascript
async deleteTag(tag)
```

* 删除标签
   * @param {string} tag - 要删除的标签
   * @returns {Promise<Object>} 删除结果

---

## async deleteTags(tags)

```javascript
async deleteTags(tags)
```

* 批量删除标签
   * @param {string[]} tags - 要删除的标签数组
   * @returns {Promise<Object>} 删除结果

---

## async getTagDetails(tag, options =

```javascript
async getTagDetails(tag, options =
```

* 获取标签详细信息（包含关联会话列表）
   * @param {string} tag - 标签名
   * @param {Object} options - 查询选项
   * @param {number} [options.limit=50] - 最大会话数量
   * @returns {Promise<Object>} 标签信息

---

## startBackgroundSummaryGenerator()

```javascript
startBackgroundSummaryGenerator()
```

* 启动后台摘要生成器
   * 定期检查没有摘要的会话并自动生成

---

## stopBackgroundSummaryGenerator()

```javascript
stopBackgroundSummaryGenerator()
```

* 停止后台摘要生成器

---

## async _runBackgroundSummaryGeneration()

```javascript
async _runBackgroundSummaryGeneration()
```

* 运行后台摘要生成
   * @private

---

## async getSessionsWithoutSummary(options =

```javascript
async getSessionsWithoutSummary(options =
```

* 获取没有摘要的会话列表
   * @param {Object} options - 查询选项
   * @param {number} [options.limit=50] - 最大返回数量
   * @param {number} [options.minMessages=5] - 最小消息数
   * @returns {Promise<Array>} 会话列表

---

## getAutoSummaryConfig()

```javascript
getAutoSummaryConfig()
```

* 获取自动摘要配置
   * @returns {Object} 配置信息

---

## updateAutoSummaryConfig(config =

```javascript
updateAutoSummaryConfig(config =
```

* 更新自动摘要配置
   * @param {Object} config - 新配置
   * @returns {Object} 更新后的配置

---

## async triggerBulkSummaryGeneration(options =

```javascript
async triggerBulkSummaryGeneration(options =
```

* 手动触发所有会话的摘要生成
   * @param {Object} options - 选项
   * @param {boolean} [options.overwrite=false] - 是否覆盖已有摘要
   * @param {number} [options.limit=100] - 最大处理数量
   * @returns {Promise<Object>} 处理结果

---

## async getAutoSummaryStats()

```javascript
async getAutoSummaryStats()
```

* 获取自动摘要统计
   * @returns {Promise<Object>} 统计信息

---

