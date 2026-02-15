# session-manager-ipc

**Source**: `src/main/llm/session-manager-ipc.js`

**Generated**: 2026-02-15T07:37:13.821Z

---

## const

```javascript
const
```

* SessionManager IPC 处理器
 * 负责处理会话管理相关的前后端通信
 *
 * @module session-manager-ipc
 * @version 1.0.0
 * @since 2026-01-16

---

## function registerSessionManagerIPC(

```javascript
function registerSessionManagerIPC(
```

* 注册所有 SessionManager IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.sessionManager - SessionManager 实例
 * @param {Object} [dependencies.ipcMain] - IPC 主进程对象（可选，用于测试注入）

---

## ipcMain.handle("session:create", async (_event, params) =>

```javascript
ipcMain.handle("session:create", async (_event, params) =>
```

* 创建新会话
   * Channel: 'session:create'

---

## ipcMain.handle("session:load", async (_event, sessionId, options =

```javascript
ipcMain.handle("session:load", async (_event, sessionId, options =
```

* 加载会话
   * Channel: 'session:load'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 添加消息到会话
   * Channel: 'session:add-message'

---

## ipcMain.handle("session:compress", async (_event, sessionId) =>

```javascript
ipcMain.handle("session:compress", async (_event, sessionId) =>
```

* 压缩会话历史
   * Channel: 'session:compress'

---

## ipcMain.handle("session:save", async (_event, sessionId) =>

```javascript
ipcMain.handle("session:save", async (_event, sessionId) =>
```

* 保存会话
   * Channel: 'session:save'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 获取有效消息（用于 LLM 调用）
   * Channel: 'session:get-effective-messages'

---

## ipcMain.handle("session:delete", async (_event, sessionId) =>

```javascript
ipcMain.handle("session:delete", async (_event, sessionId) =>
```

* 删除会话
   * Channel: 'session:delete'

---

## ipcMain.handle("session:list", async (_event, options =

```javascript
ipcMain.handle("session:list", async (_event, options =
```

* 列出会话
   * Channel: 'session:list'

---

## ipcMain.handle("session:get-stats", async (_event, sessionId) =>

```javascript
ipcMain.handle("session:get-stats", async (_event, sessionId) =>
```

* 获取会话统计
   * Channel: 'session:get-stats'

---

## ipcMain.handle("session:cleanup-old", async (_event, daysToKeep = 30) =>

```javascript
ipcMain.handle("session:cleanup-old", async (_event, daysToKeep = 30) =>
```

* 清理旧会话
   * Channel: 'session:cleanup-old'

---

## ipcMain.handle("session:search", async (_event, query, options =

```javascript
ipcMain.handle("session:search", async (_event, query, options =
```

* 搜索会话
   * Channel: 'session:search'

---

## ipcMain.handle("session:add-tags", async (_event, sessionId, tags) =>

```javascript
ipcMain.handle("session:add-tags", async (_event, sessionId, tags) =>
```

* 添加标签
   * Channel: 'session:add-tags'

---

## ipcMain.handle("session:remove-tags", async (_event, sessionId, tags) =>

```javascript
ipcMain.handle("session:remove-tags", async (_event, sessionId, tags) =>
```

* 移除标签
   * Channel: 'session:remove-tags'

---

## ipcMain.handle("session:get-all-tags", async () =>

```javascript
ipcMain.handle("session:get-all-tags", async () =>
```

* 获取所有标签
   * Channel: 'session:get-all-tags'

---

## ipcMain.handle("session:find-by-tags", async (_event, tags, options =

```javascript
ipcMain.handle("session:find-by-tags", async (_event, tags, options =
```

* 按标签查找会话
   * Channel: 'session:find-by-tags'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 导出会话为 JSON
   * Channel: 'session:export-json'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 导出会话为 Markdown
   * Channel: 'session:export-markdown'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 从 JSON 导入会话
   * Channel: 'session:import-json'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 批量导出会话
   * Channel: 'session:export-multiple'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 生成会话摘要
   * Channel: 'session:generate-summary'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 批量生成摘要
   * Channel: 'session:generate-summaries-batch'

---

## ipcMain.handle("session:get-auto-summary-config", async () =>

```javascript
ipcMain.handle("session:get-auto-summary-config", async () =>
```

* 获取自动摘要配置
   * Channel: 'session:get-auto-summary-config'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 更新自动摘要配置
   * Channel: 'session:update-auto-summary-config'

---

## ipcMain.handle("session:start-background-summary", async () =>

```javascript
ipcMain.handle("session:start-background-summary", async () =>
```

* 启动后台摘要生成器
   * Channel: 'session:start-background-summary'

---

## ipcMain.handle("session:stop-background-summary", async () =>

```javascript
ipcMain.handle("session:stop-background-summary", async () =>
```

* 停止后台摘要生成器
   * Channel: 'session:stop-background-summary'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 获取没有摘要的会话列表
   * Channel: 'session:get-without-summary'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 触发批量摘要生成
   * Channel: 'session:trigger-bulk-summary'

---

## ipcMain.handle("session:get-auto-summary-stats", async () =>

```javascript
ipcMain.handle("session:get-auto-summary-stats", async () =>
```

* 获取自动摘要统计
   * Channel: 'session:get-auto-summary-stats'

---

## ipcMain.handle("session:resume", async (_event, sessionId, options =

```javascript
ipcMain.handle("session:resume", async (_event, sessionId, options =
```

* 恢复会话
   * Channel: 'session:resume'

---

## ipcMain.handle("session:get-recent", async (_event, count = 5) =>

```javascript
ipcMain.handle("session:get-recent", async (_event, count = 5) =>
```

* 获取最近的会话
   * Channel: 'session:get-recent'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 保存为模板
   * Channel: 'session:save-as-template'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 从模板创建会话
   * Channel: 'session:create-from-template'

---

## ipcMain.handle("session:list-templates", async (_event, options =

```javascript
ipcMain.handle("session:list-templates", async (_event, options =
```

* 列出模板
   * Channel: 'session:list-templates'

---

## ipcMain.handle("session:delete-template", async (_event, templateId) =>

```javascript
ipcMain.handle("session:delete-template", async (_event, templateId) =>
```

* 删除模板
   * Channel: 'session:delete-template'

---

## ipcMain.handle("session:delete-multiple", async (_event, sessionIds) =>

```javascript
ipcMain.handle("session:delete-multiple", async (_event, sessionIds) =>
```

* 批量删除会话
   * Channel: 'session:delete-multiple'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 批量添加标签
   * Channel: 'session:add-tags-multiple'

---

## ipcMain.handle("session:get-global-stats", async () =>

```javascript
ipcMain.handle("session:get-global-stats", async () =>
```

* 获取全局统计
   * Channel: 'session:get-global-stats'

---

## ipcMain.handle("session:update-title", async (_event, sessionId, title) =>

```javascript
ipcMain.handle("session:update-title", async (_event, sessionId, title) =>
```

* 更新会话标题
   * Channel: 'session:update-title'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 复制会话
   * Channel: 'session:duplicate'

---

## ipcMain.handle("session:rename-tag", async (_event, oldTag, newTag) =>

```javascript
ipcMain.handle("session:rename-tag", async (_event, oldTag, newTag) =>
```

* 重命名标签
   * Channel: 'session:rename-tag'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 合并标签
   * Channel: 'session:merge-tags'

---

## ipcMain.handle("session:delete-tag", async (_event, tag) =>

```javascript
ipcMain.handle("session:delete-tag", async (_event, tag) =>
```

* 删除标签
   * Channel: 'session:delete-tag'

---

## ipcMain.handle("session:delete-tags", async (_event, tags) =>

```javascript
ipcMain.handle("session:delete-tags", async (_event, tags) =>
```

* 批量删除标签
   * Channel: 'session:delete-tags'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 获取标签详情
   * Channel: 'session:get-tag-details'

---

## function updateSessionManager(newSessionManager)

```javascript
function updateSessionManager(newSessionManager)
```

* 更新 SessionManager 引用
   * 用于热重载或重新初始化
   * @param {SessionManager} newSessionManager - 新的 SessionManager 实例

---

