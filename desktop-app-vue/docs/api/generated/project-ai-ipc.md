# project-ai-ipc

**Source**: `src/main/project/project-ai-ipc.js`

**Generated**: 2026-02-21T20:04:16.220Z

---

## const

```javascript
const
```

* Project AI IPC 处理器
 * 负责项目 AI 功能的前后端通信
 *
 * @module project-ai-ipc
 * @description 提供 AI 对话、任务规划、代码助手、内容处理等 IPC 接口

---

## let activeChatAbortController = null;

```javascript
let activeChatAbortController = null;
```

* 当前活跃的AI对话AbortController
 * 用于在主进程中取消正在进行的AI请求（因为AbortSignal无法通过IPC序列化）

---

## function extractPPTOutline(aiResponse)

```javascript
function extractPPTOutline(aiResponse)
```

* 从AI响应中提取PPT大纲
 * @param {string} aiResponse - AI响应文本
 * @returns {Object|null} PPT大纲对象，如果没有则返回null

---

## async function generatePPTFile(outline, projectPath, project)

```javascript
async function generatePPTFile(outline, projectPath, project)
```

* 生成PPT文件
 * @param {Object} outline - PPT大纲
 * @param {string} projectPath - 项目路径
 * @param {Object} project - 项目信息
 * @returns {Promise<Object>} 生成结果

---

## function extractWordRequest(userMessage, aiResponse)

```javascript
function extractWordRequest(userMessage, aiResponse)
```

* 检测Word文档生成请求
 * @param {string} userMessage - 用户消息
 * @param {string} aiResponse - AI响应文本
 * @returns {Object|null} Word请求信息，如果没有则返回null

---

## async function generateWordFile(wordRequest, projectPath, llmManager)

```javascript
async function generateWordFile(wordRequest, projectPath, llmManager)
```

* 生成Word文件
 * @param {Object} wordRequest - Word请求信息
 * @param {string} projectPath - 项目路径
 * @param {Object} llmManager - LLM管理器
 * @returns {Promise<Object>} 生成结果

---

## function registerProjectAIIPC(

```javascript
function registerProjectAIIPC(
```

* 注册所有 Project AI IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.database - 数据库管理器
 * @param {Object} dependencies.llmManager - LLM 管理器
 * @param {Object} dependencies.aiEngineManager - AI 引擎管理器
 * @param {Object} dependencies.chatSkillBridge - 聊天技能桥接器
 * @param {Object} dependencies.mainWindow - 主窗口实例
 * @param {Function} dependencies.scanAndRegisterProjectFiles - 扫描注册文件函数
 * @param {Object} [dependencies.mcpClientManager] - MCP 客户端管理器（可选，用于MCP工具调用）
 * @param {Object} [dependencies.mcpToolAdapter] - MCP 工具适配器（可选，用于MCP工具调用）

---

## ipcMain.handle("project:aiChat", async (_event, chatData) =>

```javascript
ipcMain.handle("project:aiChat", async (_event, chatData) =>
```

* 项目AI对话 - 支持文件操作
   * Channel: 'project:aiChat'

---

## ipcMain.handle("project:cancelAiChat", async () =>

```javascript
ipcMain.handle("project:cancelAiChat", async () =>
```

* 取消正在进行的AI对话请求
   * Channel: 'project:cancelAiChat'

---

## ipcMain.handle("project:scan-files", async (_event, projectId) =>

```javascript
ipcMain.handle("project:scan-files", async (_event, projectId) =>
```

* 扫描项目文件夹并添加到数据库
   * Channel: 'project:scan-files'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* AI智能拆解任务
   * Channel: 'project:decompose-task'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 执行任务计划
   * Channel: 'project:execute-task-plan'

---

## ipcMain.handle("project:get-task-plan", async (_event, taskPlanId) =>

```javascript
ipcMain.handle("project:get-task-plan", async (_event, taskPlanId) =>
```

* 获取任务计划
   * Channel: 'project:get-task-plan'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 获取项目的任务计划历史
   * Channel: 'project:get-task-plan-history'

---

## ipcMain.handle("project:cancel-task-plan", async (_event, taskPlanId) =>

```javascript
ipcMain.handle("project:cancel-task-plan", async (_event, taskPlanId) =>
```

* 取消任务计划
   * Channel: 'project:cancel-task-plan'

---

## ipcMain.handle("project:polishContent", async (_event, params) =>

```javascript
ipcMain.handle("project:polishContent", async (_event, params) =>
```

* AI内容润色
   * Channel: 'project:polishContent'

---

## ipcMain.handle("project:expandContent", async (_event, params) =>

```javascript
ipcMain.handle("project:expandContent", async (_event, params) =>
```

* AI内容扩写
   * Channel: 'project:expandContent'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 代码生成
   * Channel: 'project:code-generate'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 代码审查
   * Channel: 'project:code-review'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 代码重构
   * Channel: 'project:code-refactor'

---

## ipcMain.handle("project:code-explain", async (_event, code, language) =>

```javascript
ipcMain.handle("project:code-explain", async (_event, code, language) =>
```

* 代码解释
   * Channel: 'project:code-explain'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* Bug修复
   * Channel: 'project:code-fix-bug'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 生成测试代码
   * Channel: 'project:code-generate-tests'

---

## ipcMain.handle("project:code-optimize", async (_event, code, language) =>

```javascript
ipcMain.handle("project:code-optimize", async (_event, code, language) =>
```

* 代码优化
   * Channel: 'project:code-optimize'

---

## ipcMain.handle("project:aiChatStream", async (_event, chatData) =>

```javascript
ipcMain.handle("project:aiChatStream", async (_event, chatData) =>
```

* 项目AI对话（流式） - 支持文件操作和流式输出
   * Channel: 'project:aiChatStream'

---

## ipcMain.handle("project:understandIntent", async (_event, data) =>

```javascript
ipcMain.handle("project:understandIntent", async (_event, data) =>
```

* 理解用户意图 - 纠错 + 意图识别
   * Channel: 'project:understandIntent'

---

