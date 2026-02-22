# project-core-ipc

**Source**: `src/main/project/project-core-ipc.js`

**Generated**: 2026-02-22T01:23:36.692Z

---

## const

```javascript
const
```

* Project Core IPC 处理器
 * 负责项目核心管理的前后端通信
 *
 * @module project-core-ipc
 * @description 提供项目的 CRUD、文件管理、同步恢复、监听器等核心 IPC 接口

---

## function registerProjectCoreIPC(

```javascript
function registerProjectCoreIPC(
```

* 注册所有 Project Core IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.database - 数据库管理器
 * @param {Object} dependencies.fileSyncManager - 文件同步管理器
 * @param {Function} dependencies.removeUndefinedValues - 清理 undefined 值的函数
 * @param {Function} dependencies._replaceUndefinedWithNull - 替换 undefined 为 null 的函数

---

## ipcMain.handle("project:get-all", async (_event, userId, options =

```javascript
ipcMain.handle("project:get-all", async (_event, userId, options =
```

* 获取所有项目（本地SQLite，支持分页）
   * Channel: 'project:get-all'

---

## ipcMain.handle("project:get", async (_event, projectId) =>

```javascript
ipcMain.handle("project:get", async (_event, projectId) =>
```

* 获取单个项目
   * Channel: 'project:get'

---

## ipcMain.handle("project:create", async (_event, createData) =>

```javascript
ipcMain.handle("project:create", async (_event, createData) =>
```

* 创建项目（调用后端）
   * Channel: 'project:create'

---

## ipcMain.handle("project:create-stream", async (event, createData) =>

```javascript
ipcMain.handle("project:create-stream", async (event, createData) =>
```

* 流式创建项目（SSE）
   * Channel: 'project:create-stream'

---

## ipcMain.handle("project:stream-cancel", () =>

```javascript
ipcMain.handle("project:stream-cancel", () =>
```

* 取消流式创建
   * Channel: 'project:stream-cancel'

---

## ipcMain.handle("project:create-quick", async (_event, createData) =>

```javascript
ipcMain.handle("project:create-quick", async (_event, createData) =>
```

* 快速创建项目（不使用AI）
   * Channel: 'project:create-quick'

---

## ipcMain.handle("project:save", async (_event, project) =>

```javascript
ipcMain.handle("project:save", async (_event, project) =>
```

* 保存项目到本地SQLite
   * Channel: 'project:save'

---

## ipcMain.handle("project:update", async (_event, projectId, updates) =>

```javascript
ipcMain.handle("project:update", async (_event, projectId, updates) =>
```

* 更新项目
   * Channel: 'project:update'

---

## ipcMain.handle("project:delete", async (_event, projectId) =>

```javascript
ipcMain.handle("project:delete", async (_event, projectId) =>
```

* 删除项目（本地 + 后端）
   * Channel: 'project:delete'

---

## ipcMain.handle("project:delete-local", async (_event, projectId) =>

```javascript
ipcMain.handle("project:delete-local", async (_event, projectId) =>
```

* 删除本地项目
   * Channel: 'project:delete-local'

---

## ipcMain.handle("project:fetch-from-backend", async (_event, projectId) =>

```javascript
ipcMain.handle("project:fetch-from-backend", async (_event, projectId) =>
```

* 从后端获取项目
   * Channel: 'project:fetch-from-backend'

---

## ipcMain.handle("project:fix-path", async (_event, projectId) =>

```javascript
ipcMain.handle("project:fix-path", async (_event, projectId) =>
```

* 修复项目路径（为没有 root_path 的项目设置路径）
   * Channel: 'project:fix-path'

---

## ipcMain.handle("project:repair-root-path", async (_event, projectId) =>

```javascript
ipcMain.handle("project:repair-root-path", async (_event, projectId) =>
```

* 修复项目的root_path（为document类型的项目创建目录并设置路径）
   * Channel: 'project:repair-root-path'

---

## ipcMain.handle("project:repair-all-root-paths", async (_event) =>

```javascript
ipcMain.handle("project:repair-all-root-paths", async (_event) =>
```

* 批量修复所有缺失root_path的document项目
   * Channel: 'project:repair-all-root-paths'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 获取项目文件列表（优化版本：使用缓存+分页）
   * Channel: 'project:get-files'

---

## ipcMain.handle("project:refresh-files", async (_event, projectId) =>

```javascript
ipcMain.handle("project:refresh-files", async (_event, projectId) =>
```

* 刷新项目文件缓存
   * Channel: 'project:refresh-files'

---

## ipcMain.handle("project:clear-file-cache", async (_event, projectId) =>

```javascript
ipcMain.handle("project:clear-file-cache", async (_event, projectId) =>
```

* 清理项目文件缓存
   * Channel: 'project:clear-file-cache'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 获取项目子目录文件列表（懒加载）
   * Channel: 'project:get-files-lazy'

---

## ipcMain.handle("project:get-file", async (_event, fileId) =>

```javascript
ipcMain.handle("project:get-file", async (_event, fileId) =>
```

* 获取单个文件
   * Channel: 'project:get-file'

---

## ipcMain.handle("project:save-files", async (_event, projectId, files) =>

```javascript
ipcMain.handle("project:save-files", async (_event, projectId, files) =>
```

* 保存项目文件
   * Channel: 'project:save-files'

---

## ipcMain.handle("project:update-file", async (_event, fileUpdate) =>

```javascript
ipcMain.handle("project:update-file", async (_event, fileUpdate) =>
```

* 更新文件（支持乐观锁）
   * Channel: 'project:update-file'

---

## ipcMain.handle("project:delete-file", async (_event, projectId, fileId) =>

```javascript
ipcMain.handle("project:delete-file", async (_event, projectId, fileId) =>
```

* 删除文件
   * Channel: 'project:delete-file'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 索引项目对话历史
   * Channel: 'project:indexConversations'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 启动文件监听
   * Channel: 'project:startWatcher'

---

## ipcMain.handle("project:stopWatcher", async (_event, projectId) =>

```javascript
ipcMain.handle("project:stopWatcher", async (_event, projectId) =>
```

* 停止文件监听
   * Channel: 'project:stopWatcher'

---

## ipcMain.handle("project:resolve-path", async (_event, relativePath) =>

```javascript
ipcMain.handle("project:resolve-path", async (_event, relativePath) =>
```

* 解析项目路径
   * Channel: 'project:resolve-path'

---

## ipcMain.handle("project:sync", async (_event, userId) =>

```javascript
ipcMain.handle("project:sync", async (_event, userId) =>
```

* 同步项目（支持防抖和锁）
   * Channel: 'project:sync'

---

## ipcMain.handle("project:sync-one", async (_event, projectId) =>

```javascript
ipcMain.handle("project:sync-one", async (_event, projectId) =>
```

* 同步单个项目（支持锁）
   * Channel: 'project:sync-one'

---

## ipcMain.handle("project:scan-recoverable", async () =>

```javascript
ipcMain.handle("project:scan-recoverable", async () =>
```

* 扫描可恢复的项目
   * Channel: 'project:scan-recoverable'

---

## ipcMain.handle("project:recover", async (_event, projectId) =>

```javascript
ipcMain.handle("project:recover", async (_event, projectId) =>
```

* 恢复单个项目
   * Channel: 'project:recover'

---

## ipcMain.handle("project:recover-batch", async (_event, projectIds) =>

```javascript
ipcMain.handle("project:recover-batch", async (_event, projectIds) =>
```

* 批量恢复项目
   * Channel: 'project:recover-batch'

---

## ipcMain.handle("project:auto-recover", async () =>

```javascript
ipcMain.handle("project:auto-recover", async () =>
```

* 自动恢复所有可恢复的项目
   * Channel: 'project:auto-recover'

---

## ipcMain.handle("project:recovery-stats", async () =>

```javascript
ipcMain.handle("project:recovery-stats", async () =>
```

* 获取恢复统计信息
   * Channel: 'project:recovery-stats'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 启动项目统计
   * Channel: 'project:stats:start'

---

## ipcMain.handle("project:stats:stop", async (_event, projectId) =>

```javascript
ipcMain.handle("project:stats:stop", async (_event, projectId) =>
```

* 停止项目统计
   * Channel: 'project:stats:stop'

---

## ipcMain.handle("project:stats:get", async (_event, projectId) =>

```javascript
ipcMain.handle("project:stats:get", async (_event, projectId) =>
```

* 获取项目统计
   * Channel: 'project:stats:get'

---

## ipcMain.handle("project:stats:update", async (_event, projectId) =>

```javascript
ipcMain.handle("project:stats:update", async (_event, projectId) =>
```

* 更新项目统计
   * Channel: 'project:stats:update'

---

## ipcMain.handle("template:get-all", async () =>

```javascript
ipcMain.handle("template:get-all", async () =>
```

* 获取所有模板（预置 + 自定义）
   * Channel: 'template:get-all'

---

## ipcMain.handle("template:get-by-id", async (_event, templateId) =>

```javascript
ipcMain.handle("template:get-by-id", async (_event, templateId) =>
```

* 根据ID获取模板
   * Channel: 'template:get-by-id'

---

## ipcMain.handle("template:get-by-category", async (_event, category) =>

```javascript
ipcMain.handle("template:get-by-category", async (_event, category) =>
```

* 根据分类获取模板
   * Channel: 'template:get-by-category'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 搜索模板
   * Channel: 'template-library:search'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 推荐模板（基于项目描述）
   * Channel: 'template-library:recommend'

---

## ipcMain.handle("template-library:preview", async (_event, templateId) =>

```javascript
ipcMain.handle("template-library:preview", async (_event, templateId) =>
```

* 获取模板预览（树形结构）
   * Channel: 'template-library:preview'

---

## ipcMain.handle("template:save-custom", async (_event, template) =>

```javascript
ipcMain.handle("template:save-custom", async (_event, template) =>
```

* 保存自定义模板
   * Channel: 'template:save-custom'

---

## ipcMain.handle("template:delete-custom", async (_event, templateId) =>

```javascript
ipcMain.handle("template:delete-custom", async (_event, templateId) =>
```

* 删除自定义模板
   * Channel: 'template:delete-custom'

---

## ipcMain.handle("template:export", async (_event, templateIds) =>

```javascript
ipcMain.handle("template:export", async (_event, templateIds) =>
```

* 导出模板
   * Channel: 'template:export'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 导入模板
   * Channel: 'template:import'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 从项目创建模板
   * Channel: 'template:create-from-project'

---

## ipcMain.handle("project-types:get-all", async () =>

```javascript
ipcMain.handle("project-types:get-all", async () =>
```

* 获取项目类型列表（与Android对齐的12种）
   * Channel: 'project-types:get-all'

---

## ipcMain.handle("project:create-from-template", async (_event, createData) =>

```javascript
ipcMain.handle("project:create-from-template", async (_event, createData) =>
```

* 从模板创建项目
   * Channel: 'project:create-from-template'

---

