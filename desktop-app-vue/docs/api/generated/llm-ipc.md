# llm-ipc

**Source**: `src/main/llm/llm-ipc.js`

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

## const

```javascript
const
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

