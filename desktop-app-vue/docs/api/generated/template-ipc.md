# template-ipc

**Source**: `src\main\template\template-ipc.js`

**Generated**: 2026-01-27T06:44:03.800Z

---

## const

```javascript
const
```

* 模板管理 IPC
 * 处理项目模板的 CRUD、渲染、统计等操作
 *
 * @module template-ipc
 * @description 项目模板管理模块，提供模板查询、创建、使用、评价等功能

---

## function registerTemplateIPC(

```javascript
function registerTemplateIPC(
```

* 注册模板管理相关的 IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.templateManager - 模板管理器实例

---

## ipcMain.handle('template:getAll', async (_event, filters =

```javascript
ipcMain.handle('template:getAll', async (_event, filters =
```

* 获取所有模板

---

## ipcMain.handle('template:getById', async (_event, templateId) =>

```javascript
ipcMain.handle('template:getById', async (_event, templateId) =>
```

* 根据ID获取模板

---

## ipcMain.handle('template:search', async (_event, keyword, filters =

```javascript
ipcMain.handle('template:search', async (_event, keyword, filters =
```

* 搜索模板

---

## ipcMain.handle('template:getStats', async (_event) =>

```javascript
ipcMain.handle('template:getStats', async (_event) =>
```

* 获取模板统计

---

## ipcMain.handle('template:getRecent', async (_event, userId, limit = 10) =>

```javascript
ipcMain.handle('template:getRecent', async (_event, userId, limit = 10) =>
```

* 获取用户最近使用的模板

---

## ipcMain.handle('template:getPopular', async (_event, limit = 20) =>

```javascript
ipcMain.handle('template:getPopular', async (_event, limit = 20) =>
```

* 获取热门模板

---

## ipcMain.handle('template:recommend', async (_event, userInput, projectType, userId, options =

```javascript
ipcMain.handle('template:recommend', async (_event, userInput, projectType, userId, options =
```

* 智能推荐模板
   * 基于用户输入、项目类型和历史使用情况推荐模板

---

## ipcMain.handle('template:create', async (_event, templateData) =>

```javascript
ipcMain.handle('template:create', async (_event, templateData) =>
```

* 创建模板

---

## ipcMain.handle('template:update', async (_event, templateId, updates) =>

```javascript
ipcMain.handle('template:update', async (_event, templateId, updates) =>
```

* 更新模板

---

## ipcMain.handle('template:delete', async (_event, templateId) =>

```javascript
ipcMain.handle('template:delete', async (_event, templateId) =>
```

* 删除模板

---

## ipcMain.handle('template:duplicate', async (_event, templateId, newName) =>

```javascript
ipcMain.handle('template:duplicate', async (_event, templateId, newName) =>
```

* 复制模板（用于基于现有模板创建新模板）

---

## ipcMain.handle('template:renderPrompt', async (_event, templateId, userVariables) =>

```javascript
ipcMain.handle('template:renderPrompt', async (_event, templateId, userVariables) =>
```

* 渲染模板提示词

---

## ipcMain.handle('template:render', async (_event, params) =>

```javascript
ipcMain.handle('template:render', async (_event, params) =>
```

* 渲染模板（通用）

---

## ipcMain.handle('template:validate', async (_event, params) =>

```javascript
ipcMain.handle('template:validate', async (_event, params) =>
```

* 验证模板

---

## ipcMain.handle('template:recordUsage', async (_event, templateId, userId, projectId, variablesUsed) =>

```javascript
ipcMain.handle('template:recordUsage', async (_event, templateId, userId, projectId, variablesUsed) =>
```

* 记录模板使用

---

## ipcMain.handle('template:rate', async (_event, templateId, userId, rating, review) =>

```javascript
ipcMain.handle('template:rate', async (_event, templateId, userId, rating, review) =>
```

* 提交模板评价

---

## ipcMain.handle('template:preview', async (_event, params) =>

```javascript
ipcMain.handle('template:preview', async (_event, params) =>
```

* 预览模板

---

## ipcMain.handle('template:loadTemplate', async (_event, templatePath) =>

```javascript
ipcMain.handle('template:loadTemplate', async (_event, templatePath) =>
```

* 加载模板文件

---

## ipcMain.handle('template:saveTemplate', async (_event, params) =>

```javascript
ipcMain.handle('template:saveTemplate', async (_event, params) =>
```

* 保存模板文件

---

## ipcMain.handle('template:extractVariables', async (_event, templateString) =>

```javascript
ipcMain.handle('template:extractVariables', async (_event, templateString) =>
```

* 提取模板变量

---

## ipcMain.handle('template:getDefaultVariables', async (_event, variableDefinitions) =>

```javascript
ipcMain.handle('template:getDefaultVariables', async (_event, variableDefinitions) =>
```

* 获取默认变量值

---

