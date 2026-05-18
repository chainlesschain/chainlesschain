# tool

**Source**: `src\renderer\stores\tool.js`

**Generated**: 2026-01-27T06:44:03.889Z

---

## import

```javascript
import
```

* 工具管理 Store

---

## enabledTools: (state) =>

```javascript
enabledTools: (state) =>
```

* 启用的工具列表

---

## disabledTools: (state) =>

```javascript
disabledTools: (state) =>
```

* 禁用的工具列表

---

## filteredTools: (state) =>

```javascript
filteredTools: (state) =>
```

* 筛选后的工具列表

---

## toolsByCategory: (state) =>

```javascript
toolsByCategory: (state) =>
```

* 按分类分组的工具

---

## totalCount: (state) => state.tools.length,

```javascript
totalCount: (state) => state.tools.length,
```

* 工具总数

---

## enabledCount: (state) => state.tools.filter(t => t.enabled === 1).length,

```javascript
enabledCount: (state) => state.tools.filter(t => t.enabled === 1).length,
```

* 启用工具数量

---

## builtinCount: (state) => state.tools.filter(t => t.is_builtin === 1).length,

```javascript
builtinCount: (state) => state.tools.filter(t => t.is_builtin === 1).length,
```

* 内置工具数量

---

## pluginCount: (state) => state.tools.filter(t => t.plugin_id).length,

```javascript
pluginCount: (state) => state.tools.filter(t => t.plugin_id).length,
```

* 插件工具数量

---

## async fetchAll(options =

```javascript
async fetchAll(options =
```

* 获取所有工具

---

## async fetchById(toolId)

```javascript
async fetchById(toolId)
```

* 根据ID获取工具

---

## async fetchByCategory(category)

```javascript
async fetchByCategory(category)
```

* 根据分类获取工具

---

## async fetchBySkill(skillId)

```javascript
async fetchBySkill(skillId)
```

* 根据技能获取工具

---

## async enable(toolId)

```javascript
async enable(toolId)
```

* 启用工具

---

## async disable(toolId)

```javascript
async disable(toolId)
```

* 禁用工具

---

## async updateConfig(toolId, config)

```javascript
async updateConfig(toolId, config)
```

* 更新工具配置

---

## async updateSchema(toolId, schema)

```javascript
async updateSchema(toolId, schema)
```

* 更新工具Schema

---

## async update(toolId, updates)

```javascript
async update(toolId, updates)
```

* 更新工具

---

## async fetchStats(toolId, dateRange = null)

```javascript
async fetchStats(toolId, dateRange = null)
```

* 获取工具统计

---

## async fetchDoc(toolId)

```javascript
async fetchDoc(toolId)
```

* 获取工具文档

---

## async test(toolId, params =

```javascript
async test(toolId, params =
```

* 测试工具

---

## setCategoryFilter(category)

```javascript
setCategoryFilter(category)
```

* 设置分类筛选

---

## setStatusFilter(status)

```javascript
setStatusFilter(status)
```

* 设置状态筛选

---

## setSearchKeyword(keyword)

```javascript
setSearchKeyword(keyword)
```

* 设置搜索关键词

---

## setCurrentTool(tool)

```javascript
setCurrentTool(tool)
```

* 设置当前工具

---

## clearCurrentTool()

```javascript
clearCurrentTool()
```

* 清除当前工具

---

