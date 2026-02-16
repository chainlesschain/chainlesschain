# conversation-ipc

**Source**: `src/main/conversation/conversation-ipc.js`

**Generated**: 2026-02-16T13:44:34.671Z

---

## const

```javascript
const
```

* 对话 IPC 处理器
 * 负责处理所有对话相关的前后端通信
 *
 * @module conversation-ipc
 * @description 提供对话创建、查询、更新、删除等 IPC 接口

---

## function detectTaskType(content)

```javascript
function detectTaskType(content)
```

* 🔥 检测任务类型（用于 Multi-Agent 路由）
 * @param {string} content - 用户消息内容
 * @returns {string} 任务类型

---

## function registerConversationIPC(

```javascript
function registerConversationIPC(
```

* 注册所有对话 IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.database - 数据库实例
 * @param {Object} dependencies.llmManager - LLM管理器
 * @param {Object} dependencies.mainWindow - 主窗口实例
 * @param {Object} dependencies.ipcMain - IPC主进程对象（可选，用于测试注入）
 * @param {Object} [dependencies.sessionManager] - 会话管理器（可选，用于会话追踪）
 * @param {Object} [dependencies.agentOrchestrator] - Agent协调器（可选，用于Multi-Agent）
 * @param {Object} [dependencies.ragManager] - RAG管理器（可选，用于RAG增强）
 * @param {Object} [dependencies.promptCompressor] - Prompt压缩器（可选）
 * @param {Object} [dependencies.responseCache] - 响应缓存（可选）
 * @param {Object} [dependencies.tokenTracker] - Token追踪器（可选）
 * @param {Object} [dependencies.errorMonitor] - 错误监控器（可选）

---

## ipcMain.handle("conversation:get-by-project", async (_event, projectId) =>

```javascript
ipcMain.handle("conversation:get-by-project", async (_event, projectId) =>
```

* 根据项目ID获取对话
   * Channel: 'conversation:get-by-project'
   *
   * @param {string} projectId - 项目ID
   * @returns {Promise<Object>} { success: boolean, data?: Object[], error?: string }

---

## ipcMain.handle("conversation:get-recent", async (_event, options =

```javascript
ipcMain.handle("conversation:get-recent", async (_event, options =
```

* 获取最近对话
   * Channel: 'conversation:get-recent'
   *
   * @param {Object} options - 查询选项
   * @param {number} options.limit - 返回数量限制
   * @param {string} [options.projectId] - 可选的项目ID筛选
   * @returns {Promise<Object>} { success: boolean, conversations?: Object[], error?: string }

---

## ipcMain.handle("conversation:get-by-id", async (_event, conversationId) =>

```javascript
ipcMain.handle("conversation:get-by-id", async (_event, conversationId) =>
```

* 获取对话详情
   * Channel: 'conversation:get-by-id'
   *
   * @param {string} conversationId - 对话ID
   * @returns {Promise<Object>} { success: boolean, data?: Object, error?: string }

---

## ipcMain.handle("conversation:create", async (_event, conversationData) =>

```javascript
ipcMain.handle("conversation:create", async (_event, conversationData) =>
```

* 创建对话
   * Channel: 'conversation:create'
   *
   * @param {Object} conversationData - 对话数据
   * @returns {Promise<Object>} { success: boolean, data?: Object, error?: string }

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 更新对话
   * Channel: 'conversation:update'
   *
   * @param {string} conversationId - 对话ID
   * @param {Object} updates - 更新数据
   * @returns {Promise<Object>} { success: boolean, error?: string }

---

## ipcMain.handle("conversation:delete", async (_event, conversationId) =>

```javascript
ipcMain.handle("conversation:delete", async (_event, conversationId) =>
```

* 删除对话
   * Channel: 'conversation:delete'
   *
   * @param {string} conversationId - 对话ID
   * @returns {Promise<Object>} { success: boolean, error?: string }

---

## ipcMain.handle("conversation:create-message", async (_event, messageData) =>

```javascript
ipcMain.handle("conversation:create-message", async (_event, messageData) =>
```

* 创建消息
   * Channel: 'conversation:create-message'
   *
   * @param {Object} messageData - 消息数据
   * @returns {Promise<Object>} { success: boolean, data?: Object, error?: string }

---

## ipcMain.handle("conversation:update-message", async (_event, updateData) =>

```javascript
ipcMain.handle("conversation:update-message", async (_event, updateData) =>
```

* 更新消息
   * Channel: 'conversation:update-message'
   *
   * @param {Object} updateData - 更新数据
   * @param {string} updateData.id - 消息ID
   * @param {string} [updateData.content] - 消息内容
   * @param {Object} [updateData.metadata] - 元数据
   * @returns {Promise<Object>} { success: boolean, error?: string }

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 获取对话的所有消息
   * Channel: 'conversation:get-messages'
   *
   * @param {string} conversationId - 对话ID
   * @param {Object} options - 查询选项 (offset, limit)
   * @returns {Promise<Object>} { success: boolean, data?: Object[], total?: number, error?: string }

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 搜索消息
   * Channel: 'conversation:search-messages'
   *
   * @param {Object} searchOptions - 搜索选项
   * @param {string} searchOptions.query - 搜索关键词
   * @param {string} [searchOptions.conversationId] - 对话ID（可选）
   * @param {string} [searchOptions.role] - 消息角色（可选）
   * @param {number} [searchOptions.limit] - 返回结果数量限制
   * @param {number} [searchOptions.offset] - 偏移量
   * @param {string} [searchOptions.order] - 排序方式
   * @returns {Promise<Object>} { success: boolean, data?: Object, error?: string }

---

## ipcMain.handle("conversation:chat-stream", async (_event, chatData) =>

```javascript
ipcMain.handle("conversation:chat-stream", async (_event, chatData) =>
```

* 流式AI对话 - 🔥 v2.0 增强版
   * Channel: 'conversation:chat-stream'
   *
   * 整合以下高级特性：
   * - SessionManager: 自动会话追踪和压缩
   * - Manus Optimizations: Context Engineering + Tool Masking
   * - Multi-Agent: 复杂任务自动路由到专用Agent
   * - RAG: 知识库检索增强
   * - Prompt Compression: 长对话自动压缩
   * - ErrorMonitor: AI诊断预检查
   *
   * @param {Object} chatData - 对话数据
   * @param {string} chatData.conversationId - 对话ID
   * @param {string} chatData.userMessage - 用户消息
   * @param {Array} chatData.conversationHistory - 对话历史（可选）
   * @param {Object} chatData.options - LLM选项（可选）
   * @param {boolean} chatData.enableRAG - 启用RAG增强（默认true）
   * @param {boolean} chatData.enableCompression - 启用压缩（默认true）
   * @param {boolean} chatData.enableSessionTracking - 启用会话追踪（默认true）
   * @param {boolean} chatData.enableManusOptimization - 启用Manus优化（默认true）
   * @param {boolean} chatData.enableMultiAgent - 启用Multi-Agent（默认true）
   * @returns {Promise<Object>} { success: boolean, messageId: string, error?: string }

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 暂停流式输出
   * Channel: 'conversation:stream-pause'
   *
   * @param {string} conversationId - 对话ID
   * @returns {Promise<Object>} { success: boolean, status?: string, error?: string }

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 恢复流式输出
   * Channel: 'conversation:stream-resume'
   *
   * @param {string} conversationId - 对话ID
   * @returns {Promise<Object>} { success: boolean, status?: string, error?: string }

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 取消流式输出
   * Channel: 'conversation:stream-cancel'
   *
   * @param {string} conversationId - 对话ID
   * @param {string} reason - 取消原因（可选）
   * @returns {Promise<Object>} { success: boolean, status?: string, reason?: string, error?: string }

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 获取流式输出统计信息
   * Channel: 'conversation:stream-stats'
   *
   * @param {string} conversationId - 对话ID
   * @returns {Promise<Object>} { success: boolean, stats?: Object, error?: string }

---

## ipcMain.handle("conversation:stream-list", async (_event) =>

```javascript
ipcMain.handle("conversation:stream-list", async (_event) =>
```

* 获取所有活动的流式会话
   * Channel: 'conversation:stream-list'
   *
   * @returns {Promise<Object>} { success: boolean, sessions?: Array, error?: string }

---

## ipcMain.handle("conversation:stream-cleanup", async (_event) =>

```javascript
ipcMain.handle("conversation:stream-cleanup", async (_event) =>
```

* 清理已完成的流式会话
   * Channel: 'conversation:stream-cleanup'
   *
   * @returns {Promise<Object>} { success: boolean, cleanedCount?: number, error?: string }

---

## ipcMain.handle("conversation:stream-manager-stats", async (_event) =>

```javascript
ipcMain.handle("conversation:stream-manager-stats", async (_event) =>
```

* 获取StreamController管理器状态
   * Channel: 'conversation:stream-manager-stats'
   *
   * @returns {Promise<Object>} { success: boolean, stats?: Object, error?: string }

---

