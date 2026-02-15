# project-git-ipc

**Source**: `src/main/project/project-git-ipc.js`

**Generated**: 2026-02-15T10:10:53.388Z

---

## const

```javascript
const
```

* 项目 Git 集成 IPC
 * 处理项目的 Git 版本控制操作
 *
 * @module project-git-ipc
 * @description 项目 Git 模块，支持 Git 初始化、提交、推送、拉取、分支管理等

---

## function registerProjectGitIPC(

```javascript
function registerProjectGitIPC(
```

* 注册项目 Git 集成相关的 IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Function} dependencies.getProjectConfig - 获取项目配置
 * @param {Object} dependencies.GitAPI - Git API 实例
 * @param {Object} dependencies.gitManager - Git 管理器
 * @param {Object} dependencies.fileSyncManager - 文件同步管理器
 * @param {Object} dependencies.mainWindow - 主窗口实例
 * @param {Object} dependencies.ipcMain - IPC Main 实例（可选，用于测试）

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* Git 初始化
   * 在项目目录初始化 Git 仓库

---

## ipcMain.handle("project:git-status", async (_event, repoPath) =>

```javascript
ipcMain.handle("project:git-status", async (_event, repoPath) =>
```

* Git 状态查询
   * 获取仓库的当前状态（文件变更、暂存等）

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* Git 提交
   * 提交所有变更到本地仓库

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* Git 推送
   * 推送本地提交到远程仓库

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* Git 拉取
   * 从远程仓库拉取最新代码

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 获取提交历史
   * 分页获取 Git 提交记录

---

## ipcMain.handle("project:git-show-commit", async (_event, repoPath, sha) =>

```javascript
ipcMain.handle("project:git-show-commit", async (_event, repoPath, sha) =>
```

* 获取提交详情
   * 查看指定提交的详细信息和差异

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 获取差异
   * 比较两个提交之间的文件差异

---

## ipcMain.handle("project:git-branches", async (_event, repoPath) =>

```javascript
ipcMain.handle("project:git-branches", async (_event, repoPath) =>
```

* 获取分支列表
   * 列出所有本地和远程分支

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 创建分支
   * 从指定分支创建新分支

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 切换分支
   * 检出指定的分支

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 合并分支
   * 将源分支合并到目标分支

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 解决冲突
   * 自动或手动解决合并冲突

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 生成提交消息
   * 使用 AI 根据变更自动生成提交消息

---

