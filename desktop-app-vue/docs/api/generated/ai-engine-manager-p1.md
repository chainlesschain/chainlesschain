# ai-engine-manager-p1

**Source**: `src/main/ai-engine/ai-engine-manager-p1.js`

**Generated**: 2026-02-17T10:13:18.284Z

---

## const

```javascript
const
```

* AI引擎主管理器 (P1集成版)
 * 在P0优化的基础上集成P1五大优化模块
 *
 * P0优化（已有）:
 * 1. 槽位填充 - 自动补全缺失参数
 * 2. 工具沙箱 - 超时保护、自动重试、结果校验
 * 3. 性能监控 - P50/P90/P95统计、瓶颈识别
 *
 * P1优化（新增）:
 * 1. 多意图识别 - 自动拆分复合任务
 * 2. 动态Few-shot学习 - 个性化意图识别
 * 3. 分层任务规划 - 三层任务分解
 * 4. 检查点校验 - 中间结果验证
 * 5. 自我修正循环 - 自动错误恢复
 *
 * 版本: v0.17.0
 * 更新: 2026-01-01

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

* 处理用户输入的核心方法（P1集成版）
   * @param {string} userInput - 用户输入的文本
   * @param {Object} context - 上下文信息（当前项目、文件等）
   * @param {Function} onStepUpdate - 步骤更新回调函数
   * @param {Function} askUserCallback - 询问用户回调函数 (question, options) => Promise<answer>
   * @returns {Promise<Object>} 执行结果

---

## async _executeTaskSteps(

```javascript
async _executeTaskSteps(
```

* 执行任务步骤（内部方法，包含检查点校验）
   * @private

---

## async getPerformanceReport(timeRange = 7 * 24 * 60 * 60 * 1000)

```javascript
async getPerformanceReport(timeRange = 7 * 24 * 60 * 60 * 1000)
```

* 获取性能报告
   * @param {number} timeRange - 时间范围（毫秒）
   * @returns {Promise<Object>} 性能报告

---

## async getP1OptimizationStats()

```javascript
async getP1OptimizationStats()
```

* 获取P1优化效果统计
   * @returns {Promise<Object>} P1优化统计数据

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

## getHierarchicalPlanner()

```javascript
getHierarchicalPlanner()
```

* 获取分层任务规划器
   * @returns {HierarchicalTaskPlanner}

---

## getTaskPlanner()

```javascript
getTaskPlanner()
```

* 获取任务规划器（兼容旧API）
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

## function getAIEngineManagerP1()

```javascript
function getAIEngineManagerP1()
```

* 获取AI引擎管理器P1版单例
 * @returns {AIEngineManagerP1}

---

