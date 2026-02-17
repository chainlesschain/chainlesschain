# ai-engine-manager-optimized

**Source**: `src/main/ai-engine/ai-engine-manager-optimized.js`

**Generated**: 2026-02-17T10:13:18.284Z

---

## const

```javascript
const
```

* AI引擎主管理器 (优化版)
 * 集成了槽位填充、工具沙箱、性能监控三大优化模块
 *
 * 核心改进:
 * 1. 意图识别后自动进行槽位填充
 * 2. 所有工具调用都通过沙箱执行
 * 3. 全流程性能监控和瓶颈分析

---

## async initialize(options =

```javascript
async initialize(options =
```

* 初始化AI引擎管理器
   * 注入依赖项并初始化所有模块

---

## async processUserInput(

```javascript
async processUserInput(
```

* 处理用户输入的核心方法（优化版）
   * @param {string} userInput - 用户输入的文本
   * @param {Object} context - 上下文信息（当前项目、文件等）
   * @param {Function} onStepUpdate - 步骤更新回调函数
   * @param {Function} askUserCallback - 询问用户回调函数 (question, options) => Promise<answer>
   * @returns {Promise<Object>} 执行结果

---

## async getPerformanceReport(timeRange = 7 * 24 * 60 * 60 * 1000)

```javascript
async getPerformanceReport(timeRange = 7 * 24 * 60 * 60 * 1000)
```

* 获取性能报告
   * @param {number} timeRange - 时间范围（毫秒）
   * @returns {Promise<Object>} 性能报告

---

## async getSessionPerformance(sessionId = null)

```javascript
async getSessionPerformance(sessionId = null)
```

* 获取会话性能详情
   * @param {string} sessionId - 会话ID（可选，默认当前会话）
   * @returns {Promise<Object>} 会话性能数据

---

## setUserId(userId)

```javascript
setUserId(userId)
```

* 设置用户ID
   * @param {string} userId - 用户ID

---

## async cleanOldPerformanceData(keepDays = 30)

```javascript
async cleanOldPerformanceData(keepDays = 30)
```

* 清理旧的性能数据
   * @param {number} keepDays - 保留天数

---

## getTaskPlanner()

```javascript
getTaskPlanner()
```

* 获取增强版任务规划器
   * @returns {TaskPlannerEnhanced}

---

## registerTool(name, implementation, schema =

```javascript
registerTool(name, implementation, schema =
```

* 注册自定义工具
   * @param {string} name - 工具名称
   * @param {Function} implementation - 工具实现函数
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

## function getAIEngineManagerOptimized()

```javascript
function getAIEngineManagerOptimized()
```

* 获取AI引擎管理器优化版单例
 * @returns {AIEngineManagerOptimized}

---

