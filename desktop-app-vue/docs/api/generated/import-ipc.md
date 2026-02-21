# import-ipc

**Source**: `src/main/import/import-ipc.js`

**Generated**: 2026-02-21T20:04:16.245Z

---

## const

```javascript
const
```

* 文件导入 IPC 处理器
 * 负责处理所有文件导入相关的前后端通信
 *
 * @module import-ipc
 * @description 提供文件选择、导入、格式检查等 IPC 接口

---

## function registerImportIPC(

```javascript
function registerImportIPC(
```

* 注册所有文件导入 IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.fileImporter - 文件导入器实例
 * @param {Object} dependencies.mainWindow - 主窗口实例
 * @param {Object} dependencies.database - 数据库管理器
 * @param {Object} [dependencies.ragManager] - RAG 管理器（用于索引同步）
 * @param {Object} [dependencies.ipcMain] - IPC主进程对象（可选，用于测试注入）
 * @param {Object} [dependencies.dialog] - Dialog对象（可选，用于测试注入）
 * @param {Object} [dependencies.ipcGuard] - IPC guard模块（可选，用于测试注入）

---

## ipcMain.handle("import:select-files", async () =>

```javascript
ipcMain.handle("import:select-files", async () =>
```

* 选择要导入的文件
   * Channel: 'import:select-files'

---

## ipcMain.handle("import:import-file", async (_event, filePath, options) =>

```javascript
ipcMain.handle("import:import-file", async (_event, filePath, options) =>
```

* 导入单个文件
   * Channel: 'import:import-file'
   *
   * @param {string} filePath - 文件路径
   * @param {Object} options - 导入选项
   * @returns {Promise<Object>} 导入结果

---

## ipcMain.handle("import:import-files", async (_event, filePaths, options) =>

```javascript
ipcMain.handle("import:import-files", async (_event, filePaths, options) =>
```

* 批量导入文件
   * Channel: 'import:import-files'
   *
   * @param {string[]} filePaths - 文件路径数组
   * @param {Object} options - 导入选项
   * @returns {Promise<Object>} 导入结果统计

---

## ipcMain.handle("import:get-supported-formats", async () =>

```javascript
ipcMain.handle("import:get-supported-formats", async () =>
```

* 获取支持的文件格式列表
   * Channel: 'import:get-supported-formats'
   *
   * @returns {Promise<string[]>} 支持的文件扩展名列表

---

## ipcMain.handle("import:check-file", async (_event, filePath) =>

```javascript
ipcMain.handle("import:check-file", async (_event, filePath) =>
```

* 检查文件是否支持导入
   * Channel: 'import:check-file'
   *
   * @param {string} filePath - 文件路径
   * @returns {Promise<Object>} 检查结果 { isSupported, fileType }

---

