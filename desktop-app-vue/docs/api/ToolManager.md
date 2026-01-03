# ToolManager API 文档

工具管理器 - 负责工具的注册、执行和参数验证

**文件路径**: `src/main/skill-tool-system/tool-manager.js`

## 类概述

```javascript
class ToolManager {
  db; // 
  functionCaller; // 
  dependencies; // 
  tools; // 
  docGenerator; // 
  isInitialized; // 
}
```

## 构造函数

```javascript
new ToolManager()
```

## 方法

### 公开方法

#### `async initialize()`

---

#### `catch(error)`

---

#### `async registerTool(toolData, handler)`

---

#### `if(!toolData.name)`

注册工具

**参数:**

- `toolData` (`Object`) - 工具元数据
- `handler` (`Function`) - 工具处理函数

**返回:** `Promise<string>` - 工具ID

---

#### `if(toolData.parameters_schema)`

注册工具

**参数:**

- `toolData` (`Object`) - 工具元数据
- `handler` (`Function`) - 工具处理函数

**返回:** `Promise<string>` - 工具ID

---

#### `if(!isValid)`

---

#### `if(handler && this.functionCaller)`

---

#### `catch(error)`

---

#### `async unregisterTool(toolId)`

---

#### `if(!tool)`

注销工具

**参数:**

- `toolId` (`string`) - 工具ID

---

#### `catch(error)`

---

#### `async updateTool(toolId, updates)`

---

#### `if(!tool)`

更新工具

**参数:**

- `toolId` (`string`) - 工具ID
- `updates` (`Object`) - 更新的字段

---

#### `if(updatePairs.length === 0)`

---

#### `catch(error)`

---

#### `async getTool(toolId)`

---

#### `if(tool)`

获取工具

**参数:**

- `toolId` (`string`) - 工具ID

**返回:** `Promise<Object|null>` - 工具对象

---

#### `catch(error)`

获取工具

**参数:**

- `toolId` (`string`) - 工具ID

**返回:** `Promise<Object|null>` - 工具对象

---

#### `async getToolByName(name)`

---

#### `catch(error)`

根据名称获取工具

**参数:**

- `name` (`string`) - 工具名称

**返回:** `Promise<Object|null>` - 工具对象

---

#### `async getAllTools(options = {})`

根据名称获取工具

**参数:**

- `name` (`string`) - 工具名称

**返回:** `Promise<Object|null>` - 工具对象

---

#### `if(enabled !== null)`

获取所有工具

**参数:**

- `options` (`Object`) - 查询选项

**返回:** `Promise<Array>` - 工具列表

---

#### `if(category !== null)`

---

#### `if(plugin_id !== null)`

---

#### `if(is_builtin !== null)`

---

#### `if(deprecated !== null)`

---

#### `if(limit !== null)`

---

#### `catch(error)`

---

#### `async getToolsByCategory(category)`

---

#### `async getToolsBySkill(skillId)`

根据分类获取工具

**参数:**

- `category` (`string`) - 分类

**返回:** `Promise<Array>` - 工具列表

---

#### `catch(error)`

根据技能获取工具

**参数:**

- `skillId` (`string`) - 技能ID

**返回:** `Promise<Array>` - 工具列表

---

#### `async getEnabledTools()`

---

#### `async enableTool(toolId)`

获取启用的工具

**返回:** `Promise<Array>` - 工具列表

---

#### `async disableTool(toolId)`

获取启用的工具

**返回:** `Promise<Array>` - 工具列表

---

#### `async recordToolUsage(toolName, success, duration, errorType = null)`

启用工具

**参数:**

- `toolId` (`string`) - 工具ID

---

#### `if(!tool)`

记录工具使用情况

**参数:**

- `toolName` (`string`) - 工具名称（FunctionCaller中的key）
- `success` (`boolean`) - 是否成功
- `duration` (`number`) - 执行时长(ms)
- `errorType` (`string`) - 错误类型

---

#### `catch(error)`

---

#### `async updateDailyStats(toolId, success, duration, errorType)`

---

#### `if(stat)`

---

#### `catch(e)`

---

#### `if(!success && errorType)`

---

#### `if(!success && errorType)`

---

#### `catch(error)`

---

#### `async getToolStats(toolId = null, dateRange = null)`

---

#### `if(!toolId)`

获取工具统计

**参数:**

- `toolId` (`string`) - 工具ID (如果不提供，返回总体统计)
- `dateRange` (`Object`) - 日期范围 {start, end}

**返回:** `Promise<Array|Object>` - 统计数据

---

#### `forEach(tool => {
          // 统计分类
          if (tool.category)`

---

#### `if(tool.tool_type)`

---

#### `if(dateRange)`

---

#### `catch(error)`

---

#### `validateParametersSchema(schema)`

---

#### `if(typeof schemaObj !== 'object' || schemaObj === null)`

验证参数Schema

**参数:**

- `schema` (`Object|string`) - JSON Schema

**返回:** `boolean` - 是否有效

---

#### `if(!schemaObj.type)`

验证参数Schema

**参数:**

- `schema` (`Object|string`) - JSON Schema

**返回:** `boolean` - 是否有效

---

#### `if(schemaObj.type === 'object' && schemaObj.properties)`

---

#### `if(typeof schemaObj.properties !== 'object')`

---

#### `if(schemaObj.type === 'array' && schemaObj.items)`

---

#### `if(typeof schemaObj.items !== 'object')`

---

#### `catch(error)`

---

#### `async getToolDocPath(toolId)`

---

#### `async loadBuiltInTools()`

获取工具文档路径

**参数:**

- `toolId` (`string`) - 工具ID

**返回:** `Promise<string|null>` - 文档路径

---

#### `if(!this.functionCaller)`

获取工具文档路径

**参数:**

- `toolId` (`string`) - 工具ID

**返回:** `Promise<string|null>` - 文档路径

---

#### `for(const toolSchema of availableTools)`

加载内置工具

---

#### `if(existing)`

---

#### `catch(error)`

---

#### `inferCategory(toolName)`

---

#### `async loadPluginTools()`

---

#### `for(const tool of pluginTools)`

加载插件工具

---

#### `catch(error)`

加载插件工具

---

#### `async loadAdditionalToolsV3()`

---

#### `if(!this.functionCaller)`

加载Additional Tools V3 (专业领域工具)

---

#### `for(const tool of v3Tools)`

---

#### `if(typeof handler[methodName] !== 'function')`

---

#### `catch(error)`

---

#### `catch(error)`

---

#### `async generateAllDocs()`

---

#### `catch(error)`

生成所有工具的文档

---

#### `async getToolDoc(toolId)`

生成所有工具的文档

---

#### `if(!tool)`

获取工具文档

**参数:**

- `toolId` (`string`) - 工具ID

**返回:** `Promise<string>` - 文档内容（Markdown格式）

---

#### `if(!content)`

获取工具文档

**参数:**

- `toolId` (`string`) - 工具ID

**返回:** `Promise<string>` - 文档内容（Markdown格式）

---

#### `catch(error)`

---

#### `async regenerateDoc(toolId)`

---

#### `if(!tool)`

重新生成工具文档

**参数:**

- `toolId` (`string`) - 工具ID

---

#### `catch(error)`

重新生成工具文档

**参数:**

- `toolId` (`string`) - 工具ID

---

#### `async recordExecution(toolName, success, duration)`

重新生成工具文档

**参数:**

- `toolId` (`string`) - 工具ID

---

#### `async createTool(toolData, handler)`

recordExecution 方法（别名，用于兼容 ToolRunner）

**参数:**

- `toolName` (`string`) - 工具名称
- `success` (`boolean`) - 是否成功
- `duration` (`number`) - 执行时长(ms)

---

#### `catch(error)`

createTool 方法（别名，用于兼容测试）

**参数:**

- `toolData` (`Object`) - 工具元数据
- `handler` (`Function`) - 工具处理函数

**返回:** `Promise<Object>` - 创建结果

---

#### `async loadBuiltinTools()`

createTool 方法（别名，用于兼容测试）

**参数:**

- `toolData` (`Object`) - 工具元数据
- `handler` (`Function`) - 工具处理函数

**返回:** `Promise<Object>` - 创建结果

---

#### `catch(error)`

---

#### `async getToolCount()`

---

#### `catch(error)`

getToolCount 方法（用于兼容测试）

**返回:** `Promise<Object>` - 工具数量

---

#### `async getToolById(toolId)`

getToolCount 方法（用于兼容测试）

**返回:** `Promise<Object>` - 工具数量

---

#### `catch(error)`

getToolById 方法（别名，用于兼容测试）

**参数:**

- `toolId` (`string`) - 工具ID

**返回:** `Promise<Object>` - 查询结果

---

#### `async deleteTool(toolId)`

getToolById 方法（别名，用于兼容测试）

**参数:**

- `toolId` (`string`) - 工具ID

**返回:** `Promise<Object>` - 查询结果

---

#### `catch(error)`

deleteTool 方法（别名，用于兼容测试）

**参数:**

- `toolId` (`string`) - 工具ID

**返回:** `Promise<Object>` - 删除结果

---

#### `async toggleToolEnabled(toolId, enabled)`

deleteTool 方法（别名，用于兼容测试）

**参数:**

- `toolId` (`string`) - 工具ID

**返回:** `Promise<Object>` - 删除结果

---

#### `catch(error)`

toggleToolEnabled 方法（用于兼容测试）

**参数:**

- `toolId` (`string`) - 工具ID
- `enabled` (`boolean`) - 是否启用

**返回:** `Promise<Object>` - 更新结果

---


## 事件

如果该类继承自EventEmitter,可以监听以下事件:

(无)

## 示例

```javascript
const toolmanager = new ToolManager(/* 参数 */);

// 示例代码
// TODO: 添加实际使用示例
```

---

> 自动生成时间: 2026/1/4 04:33:57
