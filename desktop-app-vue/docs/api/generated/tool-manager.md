# tool-manager

**Source**: `src/main/skill-tool-system/tool-manager.js`

**Generated**: 2026-02-16T22:06:51.426Z

---

## const

```javascript
const
```

* 工具管理器 (ToolManager)
 * 负责工具的注册、管理、统计和与FunctionCaller的集成

---

## async initialize()

```javascript
async initialize()
```

* 初始化工具管理器

---

## async registerTool(toolData, handler)

```javascript
async registerTool(toolData, handler)
```

* 注册工具
   * @param {Object} toolData - 工具元数据
   * @param {Function} handler - 工具处理函数
   * @returns {Promise<string>} 工具ID

---

## async unregisterTool(toolId)

```javascript
async unregisterTool(toolId)
```

* 注销工具
   * @param {string} toolId - 工具ID

---

## async updateTool(toolId, updates)

```javascript
async updateTool(toolId, updates)
```

* 更新工具
   * @param {string} toolId - 工具ID
   * @param {Object} updates - 更新的字段

---

## async getTool(toolId)

```javascript
async getTool(toolId)
```

* 获取工具
   * @param {string} toolId - 工具ID
   * @returns {Promise<Object|null>} 工具对象

---

## async getToolByName(name)

```javascript
async getToolByName(name)
```

* 根据名称获取工具
   * @param {string} name - 工具名称
   * @returns {Promise<Object|null>} 工具对象

---

## async getAllTools(options =

```javascript
async getAllTools(options =
```

* 获取所有工具
   * @param {Object} options - 查询选项
   * @returns {Promise<Array>} 工具列表

---

## async getToolsByCategory(category)

```javascript
async getToolsByCategory(category)
```

* 根据分类获取工具
   * @param {string} category - 分类
   * @returns {Promise<Array>} 工具列表

---

## async getToolsBySkill(skillId)

```javascript
async getToolsBySkill(skillId)
```

* 根据技能获取工具
   * @param {string} skillId - 技能ID
   * @returns {Promise<Array>} 工具列表

---

## async getEnabledTools()

```javascript
async getEnabledTools()
```

* 获取启用的工具
   * @returns {Promise<Array>} 工具列表

---

## async enableTool(toolId)

```javascript
async enableTool(toolId)
```

* 启用工具
   * @param {string} toolId - 工具ID

---

## async disableTool(toolId)

```javascript
async disableTool(toolId)
```

* 禁用工具
   * @param {string} toolId - 工具ID

---

## async recordToolUsage(toolName, success, duration, errorType = null)

```javascript
async recordToolUsage(toolName, success, duration, errorType = null)
```

* 记录工具使用情况
   * @param {string} toolName - 工具名称（FunctionCaller中的key）
   * @param {boolean} success - 是否成功
   * @param {number} duration - 执行时长(ms)
   * @param {string} errorType - 错误类型

---

## async updateDailyStats(toolId, success, duration, errorType)

```javascript
async updateDailyStats(toolId, success, duration, errorType)
```

* 更新每日统计
   * @param {string} toolId - 工具ID
   * @param {boolean} success - 是否成功
   * @param {number} duration - 执行时长(ms)
   * @param {string} errorType - 错误类型

---

## async getToolStats(toolId = null, dateRange = null)

```javascript
async getToolStats(toolId = null, dateRange = null)
```

* 获取工具统计
   * @param {string} toolId - 工具ID (如果不提供，返回总体统计)
   * @param {Object} dateRange - 日期范围 {start, end}
   * @returns {Promise<Array|Object>} 统计数据

---

## validateParametersSchema(schema)

```javascript
validateParametersSchema(schema)
```

* 验证参数Schema
   * @param {Object|string} schema - JSON Schema
   * @returns {boolean} 是否有效

---

## async getToolDocPath(toolId)

```javascript
async getToolDocPath(toolId)
```

* 获取工具文档路径
   * @param {string} toolId - 工具ID
   * @returns {Promise<string|null>} 文档路径

---

## async loadBuiltInTools()

```javascript
async loadBuiltInTools()
```

* 加载内置工具
   * 将FunctionCaller中现有的工具注册到数据库

---

## inferCategory(toolName)

```javascript
inferCategory(toolName)
```

* 推断工具分类
   * @param {string} toolName - 工具名称
   * @returns {string} 分类

---

## async loadPluginTools()

```javascript
async loadPluginTools()
```

* 加载插件工具

---

## async loadAdditionalToolsV3()

```javascript
async loadAdditionalToolsV3()
```

* 加载Additional Tools V3 (专业领域工具)
   * 从数据库加载工具元数据，并将Handler注册到FunctionCaller

---

## async generateAllDocs()

```javascript
async generateAllDocs()
```

* 生成所有工具的文档

---

## async getToolDoc(toolId)

```javascript
async getToolDoc(toolId)
```

* 获取工具文档
   * @param {string} toolId - 工具ID
   * @returns {Promise<string>} 文档内容（Markdown格式）

---

## async regenerateDoc(toolId)

```javascript
async regenerateDoc(toolId)
```

* 重新生成工具文档
   * @param {string} toolId - 工具ID

---

## async recordExecution(toolName, success, duration)

```javascript
async recordExecution(toolName, success, duration)
```

* recordExecution 方法（别名，用于兼容 ToolRunner）
   * @param {string} toolName - 工具名称
   * @param {boolean} success - 是否成功
   * @param {number} duration - 执行时长(ms)

---

## async createTool(toolData, handler)

```javascript
async createTool(toolData, handler)
```

* createTool 方法（别名，用于兼容测试）
   * @param {Object} toolData - 工具元数据
   * @param {Function} handler - 工具处理函数
   * @returns {Promise<Object>} 创建结果

---

## async loadBuiltinTools()

```javascript
async loadBuiltinTools()
```

* loadBuiltinTools 方法（别名，用于兼容测试）
   * @returns {Promise<Object>} 加载结果

---

## async getToolCount()

```javascript
async getToolCount()
```

* getToolCount 方法（用于兼容测试）
   * @returns {Promise<Object>} 工具数量

---

## async getToolById(toolId)

```javascript
async getToolById(toolId)
```

* getToolById 方法（别名，用于兼容测试）
   * @param {string} toolId - 工具ID
   * @returns {Promise<Object>} 查询结果

---

## async deleteTool(toolId)

```javascript
async deleteTool(toolId)
```

* deleteTool 方法（别名，用于兼容测试）
   * @param {string} toolId - 工具ID
   * @returns {Promise<Object>} 删除结果

---

## async toggleToolEnabled(toolId, enabled)

```javascript
async toggleToolEnabled(toolId, enabled)
```

* toggleToolEnabled 方法（用于兼容测试）
   * @param {string} toolId - 工具ID
   * @param {boolean} enabled - 是否启用
   * @returns {Promise<Object>} 更新结果

---

