# document-ipc

**Source**: `src/main/document/document-ipc.js`

**Generated**: 2026-02-21T20:04:16.254Z

---

## const

```javascript
const
```

* 文档处理 IPC
 * 处理 PPT 导出等文档操作
 *
 * @module document-ipc
 * @description 文档处理模块，提供 PPT 导出等功能

---

## function registerDocumentIPC(

```javascript
function registerDocumentIPC(
```

* 注册文档处理相关的 IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Function} dependencies.convertSlidesToOutline - 转换幻灯片为大纲的函数

---

## ipcMain.handle("ppt:export", async (_event, params) =>

```javascript
ipcMain.handle("ppt:export", async (_event, params) =>
```

* 导出 PPT

---

