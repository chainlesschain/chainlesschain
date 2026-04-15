# llm-ipc

**Source**: `src/main/llm/llm-ipc.js`

**Generated**: 2026-04-15T06:45:25.457Z

---

## const

```javascript
const
```

* LLM服务 IPC 处理器
 * 负责处理 LLM 相关的前后端通信
 *
 * @module llm-ipc
 * @description 提供 LLM 服务的所有 IPC 接口，包括聊天、查询、配置管理、智能选择等

---

## function detectTaskType(content)

```javascript
function detectTaskType(content)
```

* 🔥 检测任务类型（用于 Multi-Agent 路由）
 * @param {string} content - 用户消息内容
 * @returns {string} 任务类型

---

## function registerLLMIPC(

```javascript
function registerLLMIPC(
```

* 注册所有 LLM IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.llmManager - LLM 管理器
 * @param {Object} dependencies.mainWindow - 主窗口实例
 * @param {Object} [dependencies.ragManager] - RAG 管理器（可选，用于RAG增强）
 * @param {Object} [dependencies.promptTemplateManager] - 提示词模板管理器（可选）
 * @param {Object} [dependencies.llmSelector] - LLM 智能选择器（可选）
 * @param {Object} [dependencies.database] - 数据库实例（可选）
 * @param {Object} [dependencies.app] - App 实例（可选，用于更新 llmManager 引用）
 * @param {Object} [dependencies.tokenTracker] - Token 追踪器（可选）
 * @param {Object} [dependencies.promptCompressor] - Prompt 压缩器（可选）
 * @param {Object} [dependencies.responseCache] - 响应缓存（可选）
 * @param {Object} [dependencies.ipcMain] - IPC主进程对象（可选，用于测试注入）
 * @param {Object} [dependencies.mcpClientManager] - MCP 客户端管理器（可选，用于MCP工具调用）
 * @param {Object} [dependencies.mcpToolAdapter] - MCP 工具适配器（可选，用于MCP工具调用）
 * @param {Object} [dependencies.sessionManager] - 会话管理器（可选，用于自动会话追踪）
 * @param {Object} [dependencies.agentOrchestrator] - Agent 协调器（可选，用于Multi-Agent路由）
 * @param {Object} [dependencies.errorMonitor] - 错误监控器（可选，用于AI诊断）

---

## ipcMain.handle("llm:check-status", async () =>

```javascript
ipcMain.handle("llm:check-status", async () =>
```

* 检查 LLM 服务状态
   * Channel: 'llm:check-status'

---

## ipcMain.handle("llm:query", async (_event, prompt, options =

```javascript
ipcMain.handle("llm:query", async (_event, prompt, options =
```

* LLM 查询（简单文本）
   * Channel: 'llm:query'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* LLM 聊天对话（支持 messages 数组格式，保留完整对话历史，自动RAG增强）
   *
   * 🔥 v2.0 增强版：集成以下高级特性
   * - SessionManager: 自动会话追踪和压缩
   * - Manus Optimizations: Context Engineering + Tool Masking
   * - Multi-Agent: 复杂任务自动路由到专用Agent
   * - ErrorMonitor: AI诊断预检查
   *
   * Channel: 'llm:chat'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 使用提示词模板进行聊天
   * Channel: 'llm:chat-with-template'

---

## ipcMain.handle("llm:query-stream", async (_event, prompt, options =

```javascript
ipcMain.handle("llm:query-stream", async (_event, prompt, options =
```

* LLM 流式查询
   * Channel: 'llm:query-stream'

---

## ipcMain.handle("llm:get-config", async () =>

```javascript
ipcMain.handle("llm:get-config", async () =>
```

* 获取 LLM 配置
   * Channel: 'llm:get-config'

---

## ipcMain.handle("llm:set-config", async (_event, config) =>

```javascript
ipcMain.handle("llm:set-config", async (_event, config) =>
```

* 设置 LLM 配置
   * Channel: 'llm:set-config'

---

## ipcMain.handle("llm:list-models", async () =>

```javascript
ipcMain.handle("llm:list-models", async () =>
```

* 列出可用模型
   * Channel: 'llm:list-models'

---

## ipcMain.handle("llm:clear-context", async (_event, conversationId) =>

```javascript
ipcMain.handle("llm:clear-context", async (_event, conversationId) =>
```

* 清除对话上下文
   * Channel: 'llm:clear-context'

---

## ipcMain.handle("llm:embeddings", async (_event, text) =>

```javascript
ipcMain.handle("llm:embeddings", async (_event, text) =>
```

* 生成文本嵌入（Embeddings）
   * Channel: 'llm:embeddings'

---

## ipcMain.handle("llm:get-selector-info", async () =>

```javascript
ipcMain.handle("llm:get-selector-info", async () =>
```

* 获取 LLM 选择器信息
   * Channel: 'llm:get-selector-info'

---

## ipcMain.handle("llm:select-best", async (_event, options =

```javascript
ipcMain.handle("llm:select-best", async (_event, options =
```

* 智能选择最优 LLM
   * Channel: 'llm:select-best'

---

## ipcMain.handle("llm:generate-report", async (_event, taskType = "chat") =>

```javascript
ipcMain.handle("llm:generate-report", async (_event, taskType = "chat") =>
```

* 生成 LLM 选择报告
   * Channel: 'llm:generate-report'

---

## ipcMain.handle("llm:switch-provider", async (_event, provider) =>

```javascript
ipcMain.handle("llm:switch-provider", async (_event, provider) =>
```

* 切换 LLM 提供商
   * Channel: 'llm:switch-provider'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 创建流式输出控制器
   * Channel: 'llm:create-stream-controller'

---

## ipcMain.handle("llm:pause-stream", async (_event, controllerId) =>

```javascript
ipcMain.handle("llm:pause-stream", async (_event, controllerId) =>
```

* 暂停流式输出
   * Channel: 'llm:pause-stream'

---

## ipcMain.handle("llm:resume-stream", async (_event, controllerId) =>

```javascript
ipcMain.handle("llm:resume-stream", async (_event, controllerId) =>
```

* 恢复流式输出
   * Channel: 'llm:resume-stream'

---

## ipcMain.handle("llm:cancel-stream", async (_event, controllerId, reason) =>

```javascript
ipcMain.handle("llm:cancel-stream", async (_event, controllerId, reason) =>
```

* 取消流式输出
   * Channel: 'llm:cancel-stream'

---

## ipcMain.handle("llm:get-stream-stats", async (_event, controllerId) =>

```javascript
ipcMain.handle("llm:get-stream-stats", async (_event, controllerId) =>
```

* 获取流式输出统计信息
   * Channel: 'llm:get-stream-stats'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 销毁流式输出控制器
   * Channel: 'llm:destroy-stream-controller'

---

## ipcMain.handle("llm:get-usage-stats", async (_event, options =

```javascript
ipcMain.handle("llm:get-usage-stats", async (_event, options =
```

* 获取 Token 使用统计
   * Channel: 'llm:get-usage-stats'

---

## ipcMain.handle("llm:get-time-series", async (_event, options =

```javascript
ipcMain.handle("llm:get-time-series", async (_event, options =
```

* 获取时间序列数据
   * Channel: 'llm:get-time-series'

---

## ipcMain.handle("llm:get-cost-breakdown", async (_event, options =

```javascript
ipcMain.handle("llm:get-cost-breakdown", async (_event, options =
```

* 获取成本分解
   * Channel: 'llm:get-cost-breakdown'

---

## ipcMain.handle("llm:get-budget", async (_event, userId = "default") =>

```javascript
ipcMain.handle("llm:get-budget", async (_event, userId = "default") =>
```

* 获取预算配置
   * Channel: 'llm:get-budget'

---

## ipcMain.handle("llm:set-budget", async (_event, userId, config) =>

```javascript
ipcMain.handle("llm:set-budget", async (_event, userId, config) =>
```

* 设置预算配置
   * Channel: 'llm:set-budget'

---

## ipcMain.handle("llm:export-cost-report", async (_event, options =

```javascript
ipcMain.handle("llm:export-cost-report", async (_event, options =
```

* 导出成本报告
   * Channel: 'llm:export-cost-report'

---

## ipcMain.handle("llm:clear-cache", async (_event) =>

```javascript
ipcMain.handle("llm:clear-cache", async (_event) =>
```

* 清除响应缓存
   * Channel: 'llm:clear-cache'

---

## ipcMain.handle("llm:get-cache-stats", async (_event) =>

```javascript
ipcMain.handle("llm:get-cache-stats", async (_event) =>
```

* 获取缓存统计信息
   * Channel: 'llm:get-cache-stats'

---

## ipcMain.handle("llm:resume-service", async (_event, userId = "default") =>

```javascript
ipcMain.handle("llm:resume-service", async (_event, userId = "default") =>
```

* 恢复 LLM 服务（预算超限暂停后）
   * Channel: 'llm:resume-service'

---

## ipcMain.handle("llm:pause-service", async (_event) =>

```javascript
ipcMain.handle("llm:pause-service", async (_event) =>
```

* 暂停 LLM 服务（手动暂停）
   * Channel: 'llm:pause-service'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 计算成本估算
   * Channel: 'llm:calculate-cost-estimate'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 检查是否可以执行操作（预算检查）
   * Channel: 'llm:can-perform-operation'

---

## ipcMain.handle("llm:get-alert-history", async (_event, options =

```javascript
ipcMain.handle("llm:get-alert-history", async (_event, options =
```

* 获取告警历史
   * Channel: 'llm:get-alert-history'

---

## ipcMain.handle("llm:add-alert", async (_event, alert) =>

```javascript
ipcMain.handle("llm:add-alert", async (_event, alert) =>
```

* 添加告警到历史记录
   * Channel: 'llm:add-alert'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 忽略/处理告警
   * Channel: 'llm:dismiss-alert'

---

## ipcMain.handle("llm:clear-alert-history", async (_event, options =

```javascript
ipcMain.handle("llm:clear-alert-history", async (_event, options =
```

* 清除告警历史
   * Channel: 'llm:clear-alert-history'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 获取模型预算列表
   * Channel: 'llm:get-model-budgets'

---

## ipcMain.handle("llm:set-model-budget", async (_event, config) =>

```javascript
ipcMain.handle("llm:set-model-budget", async (_event, config) =>
```

* 设置模型预算
   * Channel: 'llm:set-model-budget'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 删除模型预算
   * Channel: 'llm:delete-model-budget'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 获取数据保留配置
   * Channel: 'llm:get-retention-config'

---

## ipcMain.handle("llm:set-retention-config", async (_event, config) =>

```javascript
ipcMain.handle("llm:set-retention-config", async (_event, config) =>
```

* 设置数据保留配置
   * Channel: 'llm:set-retention-config'

---

## ipcMain.handle("llm:cleanup-old-data", async (_event, userId = "default") =>

```javascript
ipcMain.handle("llm:cleanup-old-data", async (_event, userId = "default") =>
```

* 手动清理旧数据
   * Channel: 'llm:cleanup-old-data'

---

## ipcMain.handle("llm:generate-test-data", async (_event, options =

```javascript
ipcMain.handle("llm:generate-test-data", async (_event, options =
```

* 生成 LLM 测试数据（仅用于开发测试）
   * Channel: 'llm:generate-test-data'

---

