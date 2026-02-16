# hierarchical-task-planner

**Source**: `src/main/ai-engine/hierarchical-task-planner.js`

**Generated**: 2026-02-16T13:44:34.690Z

---

## class HierarchicalTaskPlanner

```javascript
class HierarchicalTaskPlanner
```

* 分层任务规划器
 *
 * 功能:
 * 1. 三层分解：业务逻辑层 → 技术任务层 → 工具调用层
 * 2. 可控粒度（coarse/medium/fine/auto）
 * 3. 估算执行时间
 * 4. 生成用户友好的执行计划
 *
 * 优势:
 * - 分层展示，用户更容易理解
 * - 可控粒度，适配不同场景
 * - 便于进度可视化
 *
 * 版本: v0.17.0-P1
 * 更新: 2026-01-01

---

## async plan(intent, context, options =

```javascript
async plan(intent, context, options =
```

* 分层规划
   * @param {Object} intent - 用户意图
   * @param {Object} context - 上下文
   * @param {Object} options - 选项
   * @returns {Object} 分层计划

---

## determineGranularity(requestedGranularity, intent, context)

```javascript
determineGranularity(requestedGranularity, intent, context)
```

* 确定实际粒度
   * @param {string} requestedGranularity - 请求的粒度
   * @param {Object} intent - 意图
   * @param {Object} context - 上下文
   * @returns {string} 实际粒度

---

## assessComplexity(intent, context)

```javascript
assessComplexity(intent, context)
```

* 评估任务复杂度（0-10分）
   * @param {Object} intent - 意图
   * @param {Object} context - 上下文
   * @returns {number} 复杂度分数

---

## async decomposeBusinessLogic(intent, context, granularity)

```javascript
async decomposeBusinessLogic(intent, context, granularity)
```

* 业务逻辑层分解
   * @param {Object} intent - 意图
   * @param {Object} context - 上下文
   * @param {string} granularity - 粒度
   * @returns {Array} 业务步骤数组

---

## ruleBasedBusinessDecompose(intent, maxSteps)

```javascript
ruleBasedBusinessDecompose(intent, maxSteps)
```

* 基于规则的业务分解（降级策略）
   * @param {Object} intent - 意图
   * @param {number} maxSteps - 最大步骤数
   * @returns {Array} 业务步骤

---

## async decomposeTechnical(businessSteps, context, granularity)

```javascript
async decomposeTechnical(businessSteps, context, granularity)
```

* 技术任务层分解
   * @param {Array} businessSteps - 业务步骤
   * @param {Object} context - 上下文
   * @param {string} granularity - 粒度
   * @returns {Array} 技术任务数组

---

## async decomposeSingleBusinessStep(businessStep, context, maxSubTasks)

```javascript
async decomposeSingleBusinessStep(businessStep, context, maxSubTasks)
```

* 分解单个业务步骤为技术任务
   * @param {string} businessStep - 业务步骤
   * @param {Object} context - 上下文
   * @param {number} maxSubTasks - 最大子任务数
   * @returns {Array} 技术任务

---

## ruleBasedTechnicalDecompose(businessStep, maxSubTasks)

```javascript
ruleBasedTechnicalDecompose(businessStep, maxSubTasks)
```

* 基于规则的技术分解
   * @param {string} businessStep - 业务步骤
   * @param {number} maxSubTasks - 最大子任务数
   * @returns {Array} 技术任务

---

## async decomposeToTools(technicalTasks, context, granularity)

```javascript
async decomposeToTools(technicalTasks, context, granularity)
```

* 工具调用层分解
   * @param {Array} technicalTasks - 技术任务
   * @param {Object} context - 上下文
   * @param {string} granularity - 粒度
   * @returns {Array} 工具调用数组

---

## async taskToTools(task, context)

```javascript
async taskToTools(task, context)
```

* 将技术任务转换为工具调用
   * @param {string} task - 技术任务
   * @param {Object} context - 上下文
   * @returns {Array} 工具调用

---

## ruleBasedToolMapping(task, context)

```javascript
ruleBasedToolMapping(task, context)
```

* 基于规则的工具映射
   * @param {string} task - 技术任务
   * @param {Object} context - 上下文
   * @returns {Array} 工具调用

---

## generatePlanSummary(plan)

```javascript
generatePlanSummary(plan)
```

* 生成计划摘要
   * @param {Object} plan - 完整计划
   * @returns {Object} 摘要信息

---

## estimateDuration(executionPlan)

```javascript
estimateDuration(executionPlan)
```

* 估算执行时间
   * @param {Array} executionPlan - 执行计划
   * @returns {number} 估算时间（秒）

---

## parseJSON(text)

```javascript
parseJSON(text)
```

* 解析JSON（容错）
   * @param {string} text - JSON字符串
   * @returns {any} 解析结果

---

## visualize(plan)

```javascript
visualize(plan)
```

* 生成可视化文本
   * @param {Object} plan - 计划
   * @returns {string} 可视化文本

---

