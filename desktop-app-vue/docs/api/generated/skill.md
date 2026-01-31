# skill

**Source**: `src\renderer\stores\skill.js`

**Generated**: 2026-01-27T06:44:03.890Z

---

## import

```javascript
import
```

* 技能管理 Store

---

## enabledSkills: (state) =>

```javascript
enabledSkills: (state) =>
```

* 启用的技能列表

---

## disabledSkills: (state) =>

```javascript
disabledSkills: (state) =>
```

* 禁用的技能列表

---

## filteredSkills: (state) =>

```javascript
filteredSkills: (state) =>
```

* 按分类筛选的技能

---

## skillsByCategory: (state) =>

```javascript
skillsByCategory: (state) =>
```

* 按分类分组的技能

---

## totalCount: (state) => state.skills.length,

```javascript
totalCount: (state) => state.skills.length,
```

* 技能总数统计

---

## enabledCount: (state) => state.skills.filter((s) => s.enabled === 1).length,

```javascript
enabledCount: (state) => state.skills.filter((s) => s.enabled === 1).length,
```

* 启用技能数量

---

## _safeParseJSON(value, defaultValue = null)

```javascript
_safeParseJSON(value, defaultValue = null)
```

* 安全解析 JSON 字符串
     * @param {string|any} value - 要解析的值
     * @param {any} defaultValue - 解析失败时的默认值
     * @returns {any} 解析后的值或默认值

---

## async fetchAll(options =

```javascript
async fetchAll(options =
```

* 获取所有技能

---

## async fetchById(skillId)

```javascript
async fetchById(skillId)
```

* 根据ID获取技能

---

## async fetchByCategory(category)

```javascript
async fetchByCategory(category)
```

* 根据分类获取技能

---

## async enable(skillId)

```javascript
async enable(skillId)
```

* 启用技能

---

## async disable(skillId)

```javascript
async disable(skillId)
```

* 禁用技能

---

## async updateConfig(skillId, config)

```javascript
async updateConfig(skillId, config)
```

* 更新技能配置

---

## async update(skillId, updates)

```javascript
async update(skillId, updates)
```

* 更新技能信息

---

## async fetchStats(skillId, dateRange = null)

```javascript
async fetchStats(skillId, dateRange = null)
```

* 获取技能统计

---

## async fetchTools(skillId)

```javascript
async fetchTools(skillId)
```

* 获取技能包含的工具

---

## async addTool(skillId, toolId, role = "primary")

```javascript
async addTool(skillId, toolId, role = "primary")
```

* 添加工具到技能

---

## async removeTool(skillId, toolId)

```javascript
async removeTool(skillId, toolId)
```

* 从技能移除工具

---

## async fetchDoc(skillId)

```javascript
async fetchDoc(skillId)
```

* 获取技能文档

---

## setCategoryFilter(category)

```javascript
setCategoryFilter(category)
```

* 设置分类筛选

---

## setSearchKeyword(keyword)

```javascript
setSearchKeyword(keyword)
```

* 设置搜索关键词

---

## setCurrentSkill(skill)

```javascript
setCurrentSkill(skill)
```

* 设置当前技能

---

## clearCurrentSkill()

```javascript
clearCurrentSkill()
```

* 清除当前技能

---

