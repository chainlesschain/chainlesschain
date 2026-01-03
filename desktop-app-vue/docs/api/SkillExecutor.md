# SkillExecutor API 文档

技能执行器 - 负责执行技能和调度工具

**文件路径**: `src/main/skill-tool-system/skill-executor.js`

## 类概述

```javascript
class SkillExecutor {
  skillManager; // 
  toolManager; // 
  executionQueue; // 
  isProcessing; // 
  executionHistory; // 
  scheduledTasks; // 
}
```

## 构造函数

```javascript
new SkillExecutor()
```

## 方法

### 公开方法

#### `async executeSkill(skillId, params = {}, options = {})`

---

#### `if(!skill)`

执行技能

**参数:**

- `skillId` (`string`) - 技能ID
- `params` (`object`) - 执行参数
- `options` (`object`) - 执行选项

---

#### `if(!skill.enabled)`

执行技能

**参数:**

- `skillId` (`string`) - 技能ID
- `params` (`object`) - 执行参数
- `options` (`object`) - 执行选项

---

#### `if(options.sequential)`

---

#### `if(options.parallel)`

---

#### `catch(error)`

---

#### `async executeToolsSequentially(tools, params, executionId)`

---

#### `for(const tool of tools)`

顺序执行工具

---

#### `if(toolResult.success && toolResult.result)`

---

#### `if(!toolResult.success && tool.required)`

---

#### `catch(error)`

---

#### `if(tool.required)`

---

#### `async executeToolsInParallel(tools, params, executionId)`

---

#### `async executeToolsIntelligently(skill, tools, params, executionId)`

---

#### `for(const stage of executionPlan)`

智能执行工具（根据依赖关系和配置）

---

#### `catch(error)`

---

#### `forEach(result => {
        if (result.success && result.result)`

---

#### `prepareToolParams(tool, context)`

---

#### `if(!paramsSchema || !paramsSchema.properties)`

准备工具参数

---

#### `forEach(key => {
      if (context[key] !== undefined)`

准备工具参数

---

#### `analyzeToolDependencies(tools)`

准备工具参数

---

#### `buildExecutionPlan(dependencies)`

---

#### `if(firstStage.length > 0)`

构建执行计划（拓扑排序）

---

#### `while(hasChanges && processed.size < dependencies.size)`

构建执行计划（拓扑排序）

---

#### `if(allDepsProcessed)`

---

#### `if(nextStage.length > 0)`

---

#### `async executeBatch(tasks)`

---

#### `async createWorkflow(workflowDef)`

批量执行技能

---

#### `if(schedule)`

创建自动化工作流

---

#### `async executeWorkflow(workflow)`

创建自动化工作流

---

#### `for(const skillDef of workflow.skills)`

执行工作流

---

#### `if(result.success && result.result && result.result.context)`

---

#### `if(!result.success && skillDef.required)`

---

#### `getExecutionHistory(limit = 100)`

---

#### `getExecutionStats()`

获取执行历史

---

#### `generateExecutionId()`

---

#### `generateWorkflowId()`

生成执行ID

---

#### `scheduleWorkflow(workflow)`

生成执行ID

---

#### `if(!name || !schedule || !skillId)`

定时执行工作流

**参数:**

- `workflow` (`object`) - 工作流配置
- `workflow` (`string`) - .name - 工作流名称
- `workflow` (`string`) - .schedule - Cron表达式 (e.g., '0 0 * * *' for daily at midnight)
- `workflow` (`string`) - .skillId - 技能ID
- `workflow` (`object`) - .params - 执行参数
- `workflow` (`boolean`) - .enabled - 是否启用

**返回:** `string` - 任务ID

---

#### `if(!enabled)`

---

#### `catch(error)`

---

#### `stopWorkflow(taskId)`

---

#### `if(!scheduled)`

停止定时工作流

**参数:**

- `taskId` (`string`) - 任务ID

---

#### `if(scheduled.task)`

停止定时工作流

**参数:**

- `taskId` (`string`) - 任务ID

---

#### `getScheduledWorkflows()`

停止定时工作流

**参数:**

- `taskId` (`string`) - 任务ID

---

#### `cleanup()`

获取所有定时任务

**返回:** `Array` - 定时任务列表

---

#### `if(scheduled.task)`

获取所有定时任务

**返回:** `Array` - 定时任务列表

---


## 事件

如果该类继承自EventEmitter,可以监听以下事件:

- `execution:start` - (待补充说明)
- `execution:end` - (待补充说明)
- `execution:error` - (待补充说明)
- `workflow:success` - (待补充说明)
- `workflow:error` - (待补充说明)

## 示例

```javascript
const skillexecutor = new SkillExecutor(/* 参数 */);

// 示例代码
// TODO: 添加实际使用示例
```

---

> 自动生成时间: 2026/1/3 13:23:27
