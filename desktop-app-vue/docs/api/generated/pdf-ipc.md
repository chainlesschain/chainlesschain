# pdf-ipc

**Source**: `src/main/pdf/pdf-ipc.js`

**Generated**: 2026-02-15T07:37:13.804Z

---

## const

```javascript
const
```

* PDF 处理 IPC
 * 处理 Markdown/HTML/文本转 PDF，批量转换等操作
 *
 * @module pdf-ipc
 * @description PDF 处理模块，提供各种格式文件转 PDF 的功能

---

## function registerPDFIPC(

```javascript
function registerPDFIPC(
```

* 注册 PDF 处理相关的 IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Function} dependencies.getPDFEngine - 获取 PDF 引擎的函数

---

## ipcMain.handle("pdf:markdownToPDF", async (_event, params) =>

```javascript
ipcMain.handle("pdf:markdownToPDF", async (_event, params) =>
```

* Markdown 转 PDF

---

## ipcMain.handle("pdf:htmlFileToPDF", async (_event, params) =>

```javascript
ipcMain.handle("pdf:htmlFileToPDF", async (_event, params) =>
```

* HTML 文件转 PDF

---

## ipcMain.handle("pdf:textFileToPDF", async (_event, params) =>

```javascript
ipcMain.handle("pdf:textFileToPDF", async (_event, params) =>
```

* 文本文件转 PDF

---

## ipcMain.handle("pdf:batchConvert", async (_event, params) =>

```javascript
ipcMain.handle("pdf:batchConvert", async (_event, params) =>
```

* 批量转换 PDF

---

