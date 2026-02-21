# git-ipc

**Source**: `src/main/git/git-ipc.js`

**Generated**: 2026-02-21T20:04:16.249Z

---

## const

```javascript
const
```

* Git IPC 处理器
 * 负责处理 Git 版本控制相关的前后端通信
 *
 * @module git-ipc
 * @description 提供 Git 同步、冲突解决、配置管理、Markdown 导出、AI 提交信息生成等 IPC 接口

---

## function registerGitIPC(

```javascript
function registerGitIPC(
```

* 注册所有 Git IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} [dependencies.gitManager] - Git 管理器
 * @param {Object} [dependencies.markdownExporter] - Markdown 导出器
 * @param {Function} dependencies.getGitConfig - 获取 Git 配置函数
 * @param {Object} [dependencies.llmManager] - LLM 管理器（用于 AI 提交信息生成）
 * @param {Object} [dependencies.gitHotReload] - Git 热重载管理器
 * @param {Object} [dependencies.mainWindow] - 主窗口对象（用于发送事件）

---

## ipcMain.handle("git:status", async () =>

```javascript
ipcMain.handle("git:status", async () =>
```

* 获取 Git 状态
   * Channel: 'git:status'

---

## ipcMain.handle("git:sync", async () =>

```javascript
ipcMain.handle("git:sync", async () =>
```

* 同步 Git（导出 + 自动同步）
   * Channel: 'git:sync'

---

## ipcMain.handle("git:push", async () =>

```javascript
ipcMain.handle("git:push", async () =>
```

* 推送到远程仓库
   * Channel: 'git:push'

---

## ipcMain.handle("git:pull", async () =>

```javascript
ipcMain.handle("git:pull", async () =>
```

* 从远程仓库拉取
   * Channel: 'git:pull'

---

## ipcMain.handle("git:clone", async (_event, url, targetPath, auth) =>

```javascript
ipcMain.handle("git:clone", async (_event, url, targetPath, auth) =>
```

* 克隆远程仓库
   * Channel: 'git:clone'

---

## ipcMain.handle("git:get-log", async (_event, depth = 10) =>

```javascript
ipcMain.handle("git:get-log", async (_event, depth = 10) =>
```

* 获取 Git 日志
   * Channel: 'git:get-log'

---

## ipcMain.handle("git:get-conflicts", async () =>

```javascript
ipcMain.handle("git:get-conflicts", async () =>
```

* 获取冲突文件列表
   * Channel: 'git:get-conflicts'

---

## ipcMain.handle("git:get-conflict-content", async (_event, filepath) =>

```javascript
ipcMain.handle("git:get-conflict-content", async (_event, filepath) =>
```

* 获取冲突文件内容
   * Channel: 'git:get-conflict-content'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 解决冲突
   * Channel: 'git:resolve-conflict'

---

## ipcMain.handle("git:abort-merge", async () =>

```javascript
ipcMain.handle("git:abort-merge", async () =>
```

* 中止合并
   * Channel: 'git:abort-merge'

---

## ipcMain.handle("git:complete-merge", async (_event, message) =>

```javascript
ipcMain.handle("git:complete-merge", async (_event, message) =>
```

* 完成合并
   * Channel: 'git:complete-merge'

---

## ipcMain.handle("git:get-config", async () =>

```javascript
ipcMain.handle("git:get-config", async () =>
```

* 获取 Git 配置
   * Channel: 'git:get-config'

---

## ipcMain.handle("git:get-sync-status", async () =>

```javascript
ipcMain.handle("git:get-sync-status", async () =>
```

* 获取同步状态
   * Channel: 'git:get-sync-status'

---

## ipcMain.handle("git:set-config", async (_event, config) =>

```javascript
ipcMain.handle("git:set-config", async (_event, config) =>
```

* 设置 Git 配置
   * Channel: 'git:set-config'

---

## ipcMain.handle("git:set-remote", async (_event, url) =>

```javascript
ipcMain.handle("git:set-remote", async (_event, url) =>
```

* 设置远程仓库 URL
   * Channel: 'git:set-remote'

---

## ipcMain.handle("git:set-auth", async (_event, auth) =>

```javascript
ipcMain.handle("git:set-auth", async (_event, auth) =>
```

* 设置认证信息
   * Channel: 'git:set-auth'

---

## ipcMain.handle("git:export-markdown", async () =>

```javascript
ipcMain.handle("git:export-markdown", async () =>
```

* 导出所有数据为 Markdown
   * Channel: 'git:export-markdown'

---

## ipcMain.handle("git:generateCommitMessage", async (_event, projectPath) =>

```javascript
ipcMain.handle("git:generateCommitMessage", async (_event, projectPath) =>
```

* AI 生成提交信息
   * Channel: 'git:generateCommitMessage'

---

## ipcMain.handle("git:hot-reload:start", async () =>

```javascript
ipcMain.handle("git:hot-reload:start", async () =>
```

* 启动 Git 热重载
   * Channel: 'git:hot-reload:start'

---

## ipcMain.handle("git:hot-reload:stop", async () =>

```javascript
ipcMain.handle("git:hot-reload:stop", async () =>
```

* 停止 Git 热重载
   * Channel: 'git:hot-reload:stop'

---

## ipcMain.handle("git:hot-reload:status", async () =>

```javascript
ipcMain.handle("git:hot-reload:status", async () =>
```

* 获取 Git 热重载状态
   * Channel: 'git:hot-reload:status'

---

## ipcMain.handle("git:hot-reload:refresh", async () =>

```javascript
ipcMain.handle("git:hot-reload:refresh", async () =>
```

* 手动刷新 Git 状态
   * Channel: 'git:hot-reload:refresh'

---

## ipcMain.handle("git:hot-reload:configure", async (_event, config) =>

```javascript
ipcMain.handle("git:hot-reload:configure", async (_event, config) =>
```

* 设置 Git 热重载配置
   * Channel: 'git:hot-reload:configure'

---

