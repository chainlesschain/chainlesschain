# skill-tool-ipc

**Source**: `src/main/skill-tool-system/skill-tool-ipc.js`

**Generated**: 2026-02-21T20:04:16.206Z

---

## function registerSkillToolIPC(

```javascript
function registerSkillToolIPC(
```

* 技能和工具系统IPC接口
 * 为前端提供技能和工具管理的IPC handlers

---

## function registerSkillToolIPC(

```javascript
function registerSkillToolIPC(
```

* 注册所有技能和工具相关的IPC handlers
 * @param {Object} dependencies - 依赖对象
 * @param {Electron.IpcMain} dependencies.ipcMain - IPC主进程对象（可选，用于测试注入）
 * @param {SkillManager} dependencies.skillManager - 技能管理器
 * @param {ToolManager} dependencies.toolManager - 工具管理器

---

## const getAllSkillsHandler = async (event, options =

```javascript
const getAllSkillsHandler = async (event, options =
```

* 获取所有技能

---

## ipcMain.handle("skill:get-by-id", async (event, skillId) =>

```javascript
ipcMain.handle("skill:get-by-id", async (event, skillId) =>
```

* 根据ID获取技能

---

## ipcMain.handle("skill:get-by-category", async (event, category) =>

```javascript
ipcMain.handle("skill:get-by-category", async (event, category) =>
```

* 根据分类获取技能

---

## ipcMain.handle("skill:enable", async (event, skillId) =>

```javascript
ipcMain.handle("skill:enable", async (event, skillId) =>
```

* 启用技能

---

## ipcMain.handle("skill:disable", async (event, skillId) =>

```javascript
ipcMain.handle("skill:disable", async (event, skillId) =>
```

* 禁用技能

---

## ipcMain.handle("skill:update-config", async (event, skillId, config) =>

```javascript
ipcMain.handle("skill:update-config", async (event, skillId, config) =>
```

* 更新技能配置

---

## ipcMain.handle("skill:update", async (event, skillId, updates) =>

```javascript
ipcMain.handle("skill:update", async (event, skillId, updates) =>
```

* 更新技能信息

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 获取技能统计

---

## ipcMain.handle("skill:get-tools", async (event, skillId) =>

```javascript
ipcMain.handle("skill:get-tools", async (event, skillId) =>
```

* 获取技能包含的工具

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 添加工具到技能

---

## ipcMain.handle("skill:remove-tool", async (event, skillId, toolId) =>

```javascript
ipcMain.handle("skill:remove-tool", async (event, skillId, toolId) =>
```

* 从技能移除工具

---

## ipcMain.handle("skill:get-doc", async (event, skillId) =>

```javascript
ipcMain.handle("skill:get-doc", async (event, skillId) =>
```

* 获取技能文档

---

## const getAllToolsHandler = async (event, options =

```javascript
const getAllToolsHandler = async (event, options =
```

* 获取所有工具

---

## ipcMain.handle("tool:get-by-id", async (event, toolId) =>

```javascript
ipcMain.handle("tool:get-by-id", async (event, toolId) =>
```

* 根据ID获取工具

---

## ipcMain.handle("tool:get-by-category", async (event, category) =>

```javascript
ipcMain.handle("tool:get-by-category", async (event, category) =>
```

* 根据分类获取工具

---

## ipcMain.handle("tool:get-by-skill", async (event, skillId) =>

```javascript
ipcMain.handle("tool:get-by-skill", async (event, skillId) =>
```

* 根据技能获取工具

---

## ipcMain.handle("tool:enable", async (event, toolId) =>

```javascript
ipcMain.handle("tool:enable", async (event, toolId) =>
```

* 启用工具

---

## ipcMain.handle("tool:disable", async (event, toolId) =>

```javascript
ipcMain.handle("tool:disable", async (event, toolId) =>
```

* 禁用工具

---

## ipcMain.handle("tool:update-config", async (event, toolId, config) =>

```javascript
ipcMain.handle("tool:update-config", async (event, toolId, config) =>
```

* 更新工具配置

---

## ipcMain.handle("tool:update-schema", async (event, toolId, schema) =>

```javascript
ipcMain.handle("tool:update-schema", async (event, toolId, schema) =>
```

* 更新工具Schema

---

## ipcMain.handle("tool:update", async (event, toolId, updates) =>

```javascript
ipcMain.handle("tool:update", async (event, toolId, updates) =>
```

* 更新工具

---

## ipcMain.handle("tool:get-stats", async (event, toolId, dateRange = null) =>

```javascript
ipcMain.handle("tool:get-stats", async (event, toolId, dateRange = null) =>
```

* 获取工具统计

---

## ipcMain.handle("tool:get-doc", async (event, toolId) =>

```javascript
ipcMain.handle("tool:get-doc", async (event, toolId) =>
```

* 获取工具文档

---

## ipcMain.handle("tool:test", async (event, toolId, params =

```javascript
ipcMain.handle("tool:test", async (event, toolId, params =
```

* 测试工具

---

## ipcMain.handle("skill-tool:get-dependency-graph", async (event) =>

```javascript
ipcMain.handle("skill-tool:get-dependency-graph", async (event) =>
```

* 获取技能-工具依赖关系图

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 获取使用分析

---

## ipcMain.handle("skill-tool:get-category-stats", async (event) =>

```javascript
ipcMain.handle("skill-tool:get-category-stats", async (event) =>
```

* 获取分类统计

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 获取Additional Tools V3统计仪表板数据（支持筛选）
   * @param {Object} filters - 筛选条件
   * @param {Array} filters.dateRange - 时间范围 [startDate, endDate]
   * @param {Array} filters.categories - 分类筛选
   * @param {String} filters.searchKeyword - 搜索关键词

---

## ipcMain.handle("tool:get-additional-v3-overview", async (event) =>

```javascript
ipcMain.handle("tool:get-additional-v3-overview", async (event) =>
```

* 获取Additional Tools V3概览数据

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 获取Additional Tools V3工具排行榜

---

## ipcMain.handle("tool:get-additional-v3-category-stats", async (event) =>

```javascript
ipcMain.handle("tool:get-additional-v3-category-stats", async (event) =>
```

* 获取Additional Tools V3分类统计

---

## ipcMain.handle("tool:get-additional-v3-recent", async (event, limit = 20) =>

```javascript
ipcMain.handle("tool:get-additional-v3-recent", async (event, limit = 20) =>
```

* 获取Additional Tools V3最近使用

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 获取Additional Tools V3每日统计

---

## ipcMain.handle("tool:get-additional-v3-performance", async (event) =>

```javascript
ipcMain.handle("tool:get-additional-v3-performance", async (event) =>
```

* 获取Additional Tools V3性能指标

---

## ipcMain.handle("skill:recommend", async (event, userInput, options =

```javascript
ipcMain.handle("skill:recommend", async (event, userInput, options =
```

* 推荐技能

---

## ipcMain.handle("skill:get-popular", async (event, limit = 10) =>

```javascript
ipcMain.handle("skill:get-popular", async (event, limit = 10) =>
```

* 获取热门技能

---

## ipcMain.handle("skill:get-related", async (event, skillId, limit = 5) =>

```javascript
ipcMain.handle("skill:get-related", async (event, skillId, limit = 5) =>
```

* 获取相关技能

---

## ipcMain.handle("skill:search", async (event, query, options =

```javascript
ipcMain.handle("skill:search", async (event, query, options =
```

* 搜索技能

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 导出技能配置

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 导出工具配置

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 导出到文件

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 从文件导入配置

---

## ipcMain.handle("config:import", async (event, data, options =

```javascript
ipcMain.handle("config:import", async (event, data, options =
```

* 导入配置

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 创建配置模板

---

