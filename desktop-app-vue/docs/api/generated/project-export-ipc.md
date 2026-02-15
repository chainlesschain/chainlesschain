# project-export-ipc

**Source**: `src/main/project/project-export-ipc.js`

**Generated**: 2026-02-15T10:10:53.388Z

---

## const

```javascript
const
```

* 项目导出分享 IPC
 * 处理项目导出、分享、文件导入导出等操作
 *
 * @module project-export-ipc
 * @description 项目导出分享模块，包括文档导出、PPT生成、分享功能、文件操作等

---

## function registerProjectExportIPC(

```javascript
function registerProjectExportIPC(
```

* 注册项目导出分享相关的 IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.database - 数据库实例
 * @param {Object} dependencies.llmManager - LLM 管理器
 * @param {Object} dependencies.mainWindow - 主窗口实例
 * @param {Function} dependencies.getDatabaseConnection - 获取数据库连接
 * @param {Function} dependencies.saveDatabase - 保存数据库
 * @param {Function} dependencies.getProjectConfig - 获取项目配置
 * @param {Function} dependencies.copyDirectory - 复制目录函数
 * @param {Function} dependencies.convertSlidesToOutline - 转换幻灯片为大纲
 * @param {Object} dependencies.ipcMain - IPC主进程对象（可选，用于测试注入）
 * @param {Object} dependencies.dialog - Dialog对象（可选，用于测试注入）

---

## ipcMain.handle("project:exportDocument", async (_event, params) =>

```javascript
ipcMain.handle("project:exportDocument", async (_event, params) =>
```

* 导出文档为不同格式
   * 支持导出为 PDF, Word, HTML 等格式

---

## ipcMain.handle("project:generatePPT", async (_event, params) =>

```javascript
ipcMain.handle("project:generatePPT", async (_event, params) =>
```

* 生成 PPT 演示文稿
   * 从 Markdown 内容生成 PowerPoint 文件

---

## ipcMain.handle("project:generatePodcastScript", async (_event, params) =>

```javascript
ipcMain.handle("project:generatePodcastScript", async (_event, params) =>
```

* 生成播客脚本
   * 将文章内容转换为适合播客朗读的口语化脚本

---

## ipcMain.handle("project:generateArticleImages", async (_event, params) =>

```javascript
ipcMain.handle("project:generateArticleImages", async (_event, params) =>
```

* 生成文章配图
   * 分析文章内容，提取适合配图的关键主题

---

## ipcMain.handle("project:shareProject", async (_event, params) =>

```javascript
ipcMain.handle("project:shareProject", async (_event, params) =>
```

* 创建或更新项目分享
   * 生成分享链接和 token

---

## ipcMain.handle("project:getShare", async (_event, projectId) =>

```javascript
ipcMain.handle("project:getShare", async (_event, projectId) =>
```

* 获取项目分享信息

---

## ipcMain.handle("project:deleteShare", async (_event, projectId) =>

```javascript
ipcMain.handle("project:deleteShare", async (_event, projectId) =>
```

* 删除项目分享

---

## ipcMain.handle("project:accessShare", async (_event, token) =>

```javascript
ipcMain.handle("project:accessShare", async (_event, token) =>
```

* 根据 token 访问分享项目

---

## ipcMain.handle("project:shareToWechat", async (_event, params) =>

```javascript
ipcMain.handle("project:shareToWechat", async (_event, params) =>
```

* 微信分享（生成二维码）

---

## ipcMain.handle("project:copyFile", async (_event, params) =>

```javascript
ipcMain.handle("project:copyFile", async (_event, params) =>
```

* 复制文件（项目内）

---

## ipcMain.handle("project:move-file", async (_event, params) =>

```javascript
ipcMain.handle("project:move-file", async (_event, params) =>
```

* 移动文件（项目内拖拽）

---

## ipcMain.handle("project:import-file", async (_event, params) =>

```javascript
ipcMain.handle("project:import-file", async (_event, params) =>
```

* 从外部导入文件到项目

---

## ipcMain.handle("project:export-file", async (_event, params) =>

```javascript
ipcMain.handle("project:export-file", async (_event, params) =>
```

* 导出文件到外部

---

## ipcMain.handle("project:export-files", async (_event, params) =>

```javascript
ipcMain.handle("project:export-files", async (_event, params) =>
```

* 批量导出文件到外部

---

## ipcMain.handle("project:select-export-directory", async (_event) =>

```javascript
ipcMain.handle("project:select-export-directory", async (_event) =>
```

* 选择导出目录对话框

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 选择导入文件对话框

---

## ipcMain.handle("project:import-files", async (_event, params) =>

```javascript
ipcMain.handle("project:import-files", async (_event, params) =>
```

* 批量导入文件到项目

---

