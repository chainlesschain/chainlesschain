# ai-engine-manager

**Source**: `src/main/ai-engine/ai-engine-manager.js`

**Generated**: 2026-02-15T08:42:37.276Z

---

## const

```javascript
const
```

* AI引擎主管理器
 * 负责协调意图识别、任务规划和Function Calling

---

## async initialize()

```javascript
async initialize()
```

* 初始化AI引擎管理器
   * 注入依赖项并初始化增强版任务规划器

---

## async initializeWorkflowOptimizations()

```javascript
async initializeWorkflowOptimizations()
```

* 初始化工作流优化模块
   * @private

---

## _loadWorkflowConfig()

```javascript
_loadWorkflowConfig()
```

* 加载工作流配置
   * @private

---

## getTaskPlanner()

```javascript
getTaskPlanner()
```

* 获取增强版任务规划器
   * @returns {TaskPlannerEnhanced}

---

## getWorkflowStats()

```javascript
getWorkflowStats()
```

* 获取工作流优化统计
   * @returns {Object}

---

## async processUserInput(userInput, context =

```javascript
async processUserInput(userInput, context =
```

* 处理用户输入的核心方法
   * @param {string} userInput - 用户输入的文本
   * @param {Object} context - 上下文信息（当前项目、文件等）
   * @param {Function} onStepUpdate - 步骤更新回调函数
   * @returns {Promise<Object>} 执行结果

---

## getExecutionHistory(limit = 10)

```javascript
getExecutionHistory(limit = 10)
```

* 获取执行历史
   * @param {number} limit - 返回的最大记录数
   * @returns {Array} 执行历史记录

---

## clearHistory()

```javascript
clearHistory()
```

* 清除执行历史

---

## registerTool(name, handler, schema)

```javascript
registerTool(name, handler, schema)
```

* 注册自定义工具
   * @param {string} name - 工具名称
   * @param {Function} handler - 工具处理函数
   * @param {Object} schema - 工具参数schema

---

## unregisterTool(name)

```javascript
unregisterTool(name)
```

* 注销工具
   * @param {string} name - 工具名称

---

## getAvailableTools()

```javascript
getAvailableTools()
```

* 获取所有可用工具
   * @returns {Array} 工具列表

---

## function getAIEngineManager()

```javascript
function getAIEngineManager()
```

* 获取AI引擎管理器单例
 * @returns {AIEngineManager}

---

