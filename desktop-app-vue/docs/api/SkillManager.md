# SkillManager API 文档

技能管理器 - 负责技能的CRUD操作、状态管理和统计

**文件路径**: `src/main/skill-tool-system/skill-manager.js`

## 类概述

```javascript
class SkillManager {
  db; // 
  toolManager; // 
  dependencies; // 
  skills; // 
  docGenerator; // 
  isInitialized; // 
}
```

## 构造函数

```javascript
new SkillManager()
```

## 方法

### 公开方法

#### `async initialize()`

---

#### `catch(error)`

初始化技能管理器

---

#### `async registerSkill(skillData)`

---

#### `if(!skillData.name)`

注册技能

**参数:**

- `skillData` (`Object`) - 技能元数据

**返回:** `Promise<string>` - 技能ID

---

#### `if(!skillData.category)`

注册技能

**参数:**

- `skillData` (`Object`) - 技能元数据

**返回:** `Promise<string>` - 技能ID

---

#### `catch(error)`

---

#### `async unregisterSkill(skillId)`

---

#### `if(!skill)`

注销技能

**参数:**

- `skillId` (`string`) - 技能ID

---

#### `catch(error)`

注销技能

**参数:**

- `skillId` (`string`) - 技能ID

---

#### `async updateSkill(skillId, updates)`

---

#### `if(!skill)`

更新技能

**参数:**

- `skillId` (`string`) - 技能ID
- `updates` (`Object`) - 更新的字段

---

#### `if(updatePairs.length === 0)`

---

#### `catch(error)`

---

#### `async getSkill(skillId)`

---

#### `if(skill)`

获取技能

**参数:**

- `skillId` (`string`) - 技能ID

**返回:** `Promise<Object|null>` - 技能对象

---

#### `catch(error)`

获取技能

**参数:**

- `skillId` (`string`) - 技能ID

**返回:** `Promise<Object|null>` - 技能对象

---

#### `async getAllSkills(options = {})`

---

#### `catch(error)`

获取所有技能

**参数:**

- `options` (`Object`) - 查询选项

**返回:** `Promise<Array>` - 技能列表

---

#### `async getSkillsByCategory(category)`

获取所有技能

**参数:**

- `options` (`Object`) - 查询选项

**返回:** `Promise<Array>` - 技能列表

---

#### `catch(error)`

根据分类获取技能

**参数:**

- `category` (`string`) - 分类

**返回:** `Promise<Object>` - 技能列表

---

#### `async getEnabledSkills()`

根据分类获取技能

**参数:**

- `category` (`string`) - 分类

**返回:** `Promise<Object>` - 技能列表

---

#### `async enableSkill(skillId)`

获取启用的技能

**返回:** `Promise<Array>` - 技能列表

---

#### `async disableSkill(skillId)`

获取启用的技能

**返回:** `Promise<Array>` - 技能列表

---

#### `async addToolToSkill(skillId, toolId, role = 'primary', priority = 0)`

启用技能

**参数:**

- `skillId` (`string`) - 技能ID

---

#### `if(!skill)`

添加工具到技能

**参数:**

- `skillId` (`string`) - 技能ID
- `toolId` (`string`) - 工具ID
- `role` (`string`) - 角色 (primary/secondary/optional)
- `priority` (`number`) - 优先级

---

#### `if(!tool)`

添加工具到技能

**参数:**

- `skillId` (`string`) - 技能ID
- `toolId` (`string`) - 工具ID
- `role` (`string`) - 角色 (primary/secondary/optional)
- `priority` (`number`) - 优先级

---

#### `catch(error)`

---

#### `async removeToolFromSkill(skillId, toolId)`

---

#### `catch(error)`

从技能中移除工具

**参数:**

- `skillId` (`string`) - 技能ID
- `toolId` (`string`) - 工具ID

---

#### `async getSkillTools(skillId)`

从技能中移除工具

**参数:**

- `skillId` (`string`) - 技能ID
- `toolId` (`string`) - 工具ID

---

#### `catch(error)`

获取技能包含的工具

**参数:**

- `skillId` (`string`) - 技能ID

**返回:** `Promise<Array>` - 工具列表

---

#### `async getSkillsByTool(toolId)`

---

#### `catch(error)`

获取使用某个工具的技能列表

**参数:**

- `toolId` (`string`) - 工具ID

**返回:** `Promise<Array>` - 技能列表

---

#### `async recordSkillUsage(skillId, success, duration)`

---

#### `if(!skill)`

记录技能使用情况

**参数:**

- `skillId` (`string`) - 技能ID
- `success` (`boolean`) - 是否成功
- `duration` (`number`) - 执行时长(秒)

---

#### `catch(error)`

---

#### `async updateDailyStats(skillId, success, duration)`

---

#### `if(stat)`

更新每日统计

**参数:**

- `skillId` (`string`) - 技能ID
- `success` (`boolean`) - 是否成功
- `duration` (`number`) - 执行时长(秒)

---

#### `catch(error)`

---

#### `async getSkillStats(skillId = null, dateRange = null)`

---

#### `if(!skillId)`

获取技能统计

**参数:**

- `skillId` (`string`) - 技能ID
- `dateRange` (`Object`) - 日期范围 {start, end}

**返回:** `Promise<Array>` - 统计数据

---

#### `forEach(skill => {
          if (skill.category)`

---

#### `if(dateRange)`

---

#### `catch(error)`

---

#### `async getSkillDocPath(skillId)`

---

#### `async getSuggestedSkills(intent)`

获取技能文档路径

**参数:**

- `skillId` (`string`) - 技能ID

**返回:** `Promise<string|null>` - 文档路径

---

#### `if(category)`

---

#### `catch(error)`

---

#### `async loadBuiltInSkills()`

---

#### `for(const skillDef of builtInSkills)`

加载内置技能

---

#### `if(existing)`

加载内置技能

---

#### `if(skillDef.tools && skillDef.tools.length > 0)`

---

#### `for(let i = 0; i < skillDef.tools.length; i++)`

---

#### `if(tool)`

---

#### `catch(error)`

---

#### `if(error.code !== 'MODULE_NOT_FOUND')`

---

#### `async loadPluginSkills()`

---

#### `for(const skill of pluginSkills)`

加载插件技能

---

#### `catch(error)`

加载插件技能

---

#### `async generateAllDocs()`

---

#### `for(const [skillId, skill] of this.skills)`

生成所有技能的文档

---

#### `catch(error)`

生成所有技能的文档

---

#### `async getSkillDoc(skillId)`

---

#### `if(!content)`

获取技能文档

**参数:**

- `skillId` (`string`) - 技能ID

**返回:** `Promise<string>` - 文档内容（Markdown格式）

---

#### `if(skill)`

获取技能文档

**参数:**

- `skillId` (`string`) - 技能ID

**返回:** `Promise<string>` - 文档内容（Markdown格式）

---

#### `catch(error)`

---

#### `async regenerateDoc(skillId)`

---

#### `if(!skill)`

重新生成技能文档

**参数:**

- `skillId` (`string`) - 技能ID

---

#### `catch(error)`

重新生成技能文档

**参数:**

- `skillId` (`string`) - 技能ID

---

#### `async recordExecution(skillId, success, duration)`

---

#### `async createSkill(skillData)`

recordExecution 方法（别名，用于兼容 SkillExecutor）

**参数:**

- `skillId` (`string`) - 技能ID
- `success` (`boolean`) - 是否成功
- `duration` (`number`) - 执行时长(ms)

---

#### `catch(error)`

createSkill 方法（别名，用于兼容测试）

**参数:**

- `skillData` (`Object`) - 技能数据

**返回:** `Promise<Object>` - 创建结果

---

#### `async deleteSkill(skillId)`

createSkill 方法（别名，用于兼容测试）

**参数:**

- `skillData` (`Object`) - 技能数据

**返回:** `Promise<Object>` - 创建结果

---

#### `if(!skill)`

deleteSkill 方法（别名，用于兼容测试）

**参数:**

- `skillId` (`string`) - 技能ID

**返回:** `Promise<Object>` - 删除结果

---

#### `catch(error)`

deleteSkill 方法（别名，用于兼容测试）

**参数:**

- `skillId` (`string`) - 技能ID

**返回:** `Promise<Object>` - 删除结果

---

#### `async toggleSkillEnabled(skillId, enabled)`

deleteSkill 方法（别名，用于兼容测试）

**参数:**

- `skillId` (`string`) - 技能ID

**返回:** `Promise<Object>` - 删除结果

---

#### `catch(error)`

toggleSkillEnabled 方法（用于兼容测试）

**参数:**

- `skillId` (`string`) - 技能ID
- `enabled` (`boolean`) - 是否启用

**返回:** `Promise<Object>` - 更新结果

---

#### `async getSkillById(skillId)`

toggleSkillEnabled 方法（用于兼容测试）

**参数:**

- `skillId` (`string`) - 技能ID
- `enabled` (`boolean`) - 是否启用

**返回:** `Promise<Object>` - 更新结果

---

#### `catch(error)`

getSkillById 方法（别名，用于兼容测试）

**参数:**

- `skillId` (`string`) - 技能ID

**返回:** `Promise<Object>` - 查询结果

---

#### `async getSkillCount()`

getSkillById 方法（别名，用于兼容测试）

**参数:**

- `skillId` (`string`) - 技能ID

**返回:** `Promise<Object>` - 查询结果

---

#### `catch(error)`

getSkillCount 方法（用于兼容测试）

**返回:** `Promise<Object>` - 技能数量

---

#### `if(enabled !== null)`

_getAllSkillsArray 内部方法，返回技能数组

**参数:**

- `options` (`Object`) - 查询选项

**返回:** `Promise<Array>` - 技能列表

---

#### `if(category !== null)`

---

#### `if(plugin_id !== null)`

---

#### `if(is_builtin !== null)`

---

#### `if(limit !== null)`

---

#### `catch(error)`

---


### 私有方法

#### `async _getAllSkillsArray(options = {})`

getSkillCount 方法（用于兼容测试）

**返回:** `Promise<Object>` - 技能数量

---


## 事件

如果该类继承自EventEmitter,可以监听以下事件:

(无)

## 示例

```javascript
const skillmanager = new SkillManager(/* 参数 */);

// 示例代码
// TODO: 添加实际使用示例
```

---

> 自动生成时间: 2026/1/4 04:33:57
