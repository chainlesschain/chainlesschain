# skill-executor

**Source**: `src\main\skill-tool-system\skill-executor.js`

**Generated**: 2026-01-27T06:44:03.814Z

---

## const

```javascript
const
```

* 技能执行器
 * 负责执行技能并调度相关工具

---

## async executeSkill(skillId, params =

```javascript
async executeSkill(skillId, params =
```

* 执行技能
   * @param {string} skillId - 技能ID
   * @param {object} params - 执行参数
   * @param {object} options - 执行选项

---

## async executeToolsSequentially(tools, params, executionId)

```javascript
async executeToolsSequentially(tools, params, executionId)
```

* 顺序执行工具

---

## async executeToolsInParallel(tools, params, executionId)

```javascript
async executeToolsInParallel(tools, params, executionId)
```

* 并行执行工具

---

## async executeToolsIntelligently(skill, tools, params, executionId)

```javascript
async executeToolsIntelligently(skill, tools, params, executionId)
```

* 智能执行工具（根据依赖关系和配置）

---

## prepareToolParams(tool, context)

```javascript
prepareToolParams(tool, context)
```

* 准备工具参数

---

## analyzeToolDependencies(tools)

```javascript
analyzeToolDependencies(tools)
```

* 分析工具依赖关系

---

## buildExecutionPlan(dependencies)

```javascript
buildExecutionPlan(dependencies)
```

* 构建执行计划（拓扑排序）

---

## async executeBatch(tasks)

```javascript
async executeBatch(tasks)
```

* 批量执行技能

---

## async createWorkflow(workflowDef)

```javascript
async createWorkflow(workflowDef)
```

* 创建自动化工作流

---

## async executeWorkflow(workflow)

```javascript
async executeWorkflow(workflow)
```

* 执行工作流

---

## getExecutionHistory(limit = 100)

```javascript
getExecutionHistory(limit = 100)
```

* 获取执行历史

---

## getExecutionStats()

```javascript
getExecutionStats()
```

* 获取执行统计

---

## generateExecutionId()

```javascript
generateExecutionId()
```

* 生成执行ID

---

## generateWorkflowId()

```javascript
generateWorkflowId()
```

* 生成工作流ID

---

## scheduleWorkflow(workflow)

```javascript
scheduleWorkflow(workflow)
```

* 定时执行工作流
   * @param {object} workflow - 工作流配置
   * @param {string} workflow.name - 工作流名称
   * @param {string} workflow.schedule - Cron表达式 (e.g., '0 0 * * *' for daily at midnight)
   * @param {string} workflow.skillId - 技能ID
   * @param {object} workflow.params - 执行参数
   * @param {boolean} workflow.enabled - 是否启用
   * @returns {string} 任务ID

---

## stopWorkflow(taskId)

```javascript
stopWorkflow(taskId)
```

* 停止定时工作流
   * @param {string} taskId - 任务ID

---

## getScheduledWorkflows()

```javascript
getScheduledWorkflows()
```

* 获取所有定时任务
   * @returns {Array} 定时任务列表

---

## cleanup()

```javascript
cleanup()
```

* 清理所有定时任务

---

