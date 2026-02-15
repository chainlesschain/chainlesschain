# prompt-template-ipc

**Source**: `src/main/prompt-template/prompt-template-ipc.js`

**Generated**: 2026-02-15T08:42:37.202Z

---

## function registerPromptTemplateIPC(

```javascript
function registerPromptTemplateIPC(
```

* 提示词模板 IPC
 * 处理提示词模板的 CRUD、搜索、分类、导入导出等操作
 *
 * @module prompt-template-ipc
 * @description 提示词模板管理模块，提供模板的创建、查询、填充、导入导出等功能

---

## function registerPromptTemplateIPC(

```javascript
function registerPromptTemplateIPC(
```

* 注册提示词模板相关的 IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.promptTemplateManager - 提示词模板管理器实例
 * @param {Object} dependencies.ipcMain - IPC主进程对象（可选，用于测试注入）

---

## ipcMain.handle("prompt-template:get-all", async (_event, filters) =>

```javascript
ipcMain.handle("prompt-template:get-all", async (_event, filters) =>
```

* 获取所有模板

---

## ipcMain.handle("prompt-template:get", async (_event, id) =>

```javascript
ipcMain.handle("prompt-template:get", async (_event, id) =>
```

* 根据ID获取模板

---

## ipcMain.handle("prompt-template:search", async (_event, query) =>

```javascript
ipcMain.handle("prompt-template:search", async (_event, query) =>
```

* 搜索模板

---

## ipcMain.handle("prompt-template:create", async (_event, templateData) =>

```javascript
ipcMain.handle("prompt-template:create", async (_event, templateData) =>
```

* 创建模板

---

## ipcMain.handle("prompt-template:update", async (_event, id, updates) =>

```javascript
ipcMain.handle("prompt-template:update", async (_event, id, updates) =>
```

* 更新模板

---

## ipcMain.handle("prompt-template:delete", async (_event, id) =>

```javascript
ipcMain.handle("prompt-template:delete", async (_event, id) =>
```

* 删除模板

---

## ipcMain.handle("prompt-template:fill", async (_event, id, values) =>

```javascript
ipcMain.handle("prompt-template:fill", async (_event, id, values) =>
```

* 填充模板

---

## ipcMain.handle("prompt-template:get-categories", async () =>

```javascript
ipcMain.handle("prompt-template:get-categories", async () =>
```

* 获取分类列表

---

## ipcMain.handle("prompt-template:get-statistics", async () =>

```javascript
ipcMain.handle("prompt-template:get-statistics", async () =>
```

* 获取统计信息

---

## ipcMain.handle("prompt-template:export", async (_event, id) =>

```javascript
ipcMain.handle("prompt-template:export", async (_event, id) =>
```

* 导出模板

---

## ipcMain.handle("prompt-template:import", async (_event, importData) =>

```javascript
ipcMain.handle("prompt-template:import", async (_event, importData) =>
```

* 导入模板

---

