# file-ipc

**Source**: `src\main\file\file-ipc.js`

**Generated**: 2026-01-27T06:44:03.858Z

---

## const

```javascript
const
```

* 文件操作 IPC
 * 处理文件的基础操作（读写、复制、移动、删除等）
 *
 * @module file-ipc
 * @description 文件操作模块，提供完整的文件系统操作功能

---

## function registerFileIPC(

```javascript
function registerFileIPC(
```

* 注册文件操作相关的 IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.database - 数据库实例
 * @param {Object} dependencies.mainWindow - 主窗口实例
 * @param {Function} dependencies.getProjectConfig - 获取项目配置函数
 * @param {Object} dependencies.ipcMain - IPC主进程对象（可选，用于测试注入）
 * @param {Object} dependencies.dialog - Dialog对象（可选，用于测试注入）
 * @param {Object} dependencies.shell - Shell对象（可选，用于测试注入）
 * @param {Object} dependencies.clipboard - Clipboard对象（可选，用于测试注入）

---

## ipcMain.handle('file:read-content', async (_event, filePath) =>

```javascript
ipcMain.handle('file:read-content', async (_event, filePath) =>
```

* 读取文件内容（文本文件）

---

## ipcMain.handle('file:write-content', async (_event, filePath, content) =>

```javascript
ipcMain.handle('file:write-content', async (_event, filePath, content) =>
```

* 写入文件内容（文本文件）

---

## ipcMain.handle('file:read-binary', async (_event, filePath) =>

```javascript
ipcMain.handle('file:read-binary', async (_event, filePath) =>
```

* 读取二进制文件内容（图片等）

---

## ipcMain.handle('file:revealInExplorer', async (_event,

```javascript
ipcMain.handle('file:revealInExplorer', async (_event,
```

* 在文件管理器中显示文件

---

## ipcMain.handle('file:copyItem', async (_event,

```javascript
ipcMain.handle('file:copyItem', async (_event,
```

* 复制文件/文件夹

---

## ipcMain.handle('file:moveItem', async (_event,

```javascript
ipcMain.handle('file:moveItem', async (_event,
```

* 移动文件/文件夹（用于剪切粘贴）

---

## ipcMain.handle('file:deleteItem', async (_event,

```javascript
ipcMain.handle('file:deleteItem', async (_event,
```

* 删除文件/文件夹

---

## ipcMain.handle('file:renameItem', async (_event,

```javascript
ipcMain.handle('file:renameItem', async (_event,
```

* 重命名文件/文件夹

---

## ipcMain.handle('file:createFile', async (_event,

```javascript
ipcMain.handle('file:createFile', async (_event,
```

* 创建新文件

---

## ipcMain.handle('file:createFolder', async (_event,

```javascript
ipcMain.handle('file:createFolder', async (_event,
```

* 创建新文件夹

---

## ipcMain.handle('file:openWithDefault', async (_event,

```javascript
ipcMain.handle('file:openWithDefault', async (_event,
```

* 使用默认程序打开文件

---

## ipcMain.handle('file:copyToSystemClipboard', async (_event,

```javascript
ipcMain.handle('file:copyToSystemClipboard', async (_event,
```

* 复制文件到系统剪贴板

---

## ipcMain.handle('file:cutToSystemClipboard', async (_event,

```javascript
ipcMain.handle('file:cutToSystemClipboard', async (_event,
```

* 剪切文件到系统剪贴板

---

## ipcMain.handle('file:pasteFromSystemClipboard', async () =>

```javascript
ipcMain.handle('file:pasteFromSystemClipboard', async () =>
```

* 从系统剪贴板粘贴

---

## ipcMain.handle('file:importFromSystemClipboard', async (_event,

```javascript
ipcMain.handle('file:importFromSystemClipboard', async (_event,
```

* 从系统剪贴板导入文件到项目

---

## ipcMain.handle('file:openWith', async (_event,

```javascript
ipcMain.handle('file:openWith', async (_event,
```

* 使用指定程序打开文件

---

## ipcMain.handle('file:openWithProgram', async (_event,

```javascript
ipcMain.handle('file:openWithProgram', async (_event,
```

* 使用指定程序路径打开文件

---

