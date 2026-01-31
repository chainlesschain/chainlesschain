# task-planner-enhanced

**Source**: `src\main\ai-engine\task-planner-enhanced.js`

**Generated**: 2026-01-27T06:44:03.876Z

---

## const

```javascript
const
```

* AI任务智能拆解系统（增强版）
 *
 * 核心功能：
 * 1. 使用LLM智能拆解用户需求为可执行的子任务
 * 2. 支持依赖关系解析和并行执行
 * 3. 实时执行和状态更新
 * 4. 与各种引擎集成（Web/Document/Data/PPT等）
 * 5. 持久化到数据库

---

## class QualityGateChecker

```javascript
class QualityGateChecker
```

* 质量门禁检查器
 * 在任务计划执行前进行并行质量检查

---

## async runAllGates(taskPlan)

```javascript
async runAllGates(taskPlan)
```

* 执行所有质量门禁检查（并行）

---

## async checkCyclicDependencies(taskPlan)

```javascript
async checkCyclicDependencies(taskPlan)
```

* 门禁1: 检测循环依赖

---

## async checkResourceFeasibility(taskPlan)

```javascript
async checkResourceFeasibility(taskPlan)
```

* 门禁2: 评估资源合理性

---

## async checkToolAvailability(taskPlan)

```javascript
async checkToolAvailability(taskPlan)
```

* 门禁3: 验证工具可用性

---

## async checkParameterCompleteness(taskPlan)

```javascript
async checkParameterCompleteness(taskPlan)
```

* 门禁4: 检查参数完整性

---

## getStats()

```javascript
getStats()
```

* 获取统计信息

---

## reset()

```javascript
reset()
```

* 重置统计

---

## loadEngine(engineName)

```javascript
loadEngine(engineName)
```

* 加载引擎

---

## async decomposeTask(userRequest, projectContext =

```javascript
async decomposeTask(userRequest, projectContext =
```

* 智能拆解任务
   * @param {string} userRequest - 用户需求描述
   * @param {Object} projectContext - 项目上下文
   * @returns {Promise<Object>} 任务计划

---

## async retrieveRAGContext(userRequest, projectContext)

```javascript
async retrieveRAGContext(userRequest, projectContext)
```

* 检索RAG上下文

---

## async buildDecomposePrompt(userRequest, projectContext, ragContext = null)

```javascript
async buildDecomposePrompt(userRequest, projectContext, ragContext = null)
```

* 构建任务拆解提示词

---

## normalizePlan(taskPlan, userRequest)

```javascript
normalizePlan(taskPlan, userRequest)
```

* 规范化任务计划

---

## cleanAndFixJSON(jsonText)

```javascript
cleanAndFixJSON(jsonText)
```

* 创建降级方案（当LLM失败时）

---

## cleanAndFixJSON(jsonText)

```javascript
cleanAndFixJSON(jsonText)
```

* ⚡ 优化2: JSON清理和修复
   * 尝试修复常见的JSON格式错误

---

## ruleBasedDecompose(userRequest, projectContext)

```javascript
ruleBasedDecompose(userRequest, projectContext)
```

* ⚡ 优化2: 基于规则的任务分解
   * 当所有LLM都失败时的最后降级方案

---

## async saveTaskPlan(projectId, taskPlan)

```javascript
async saveTaskPlan(projectId, taskPlan)
```

* 保存任务计划到数据库

---

## async updateTaskPlan(taskPlanId, updates)

```javascript
async updateTaskPlan(taskPlanId, updates)
```

* 更新任务计划状态

---

## async executeTaskPlan(taskPlan, projectContext, progressCallback)

```javascript
async executeTaskPlan(taskPlan, projectContext, progressCallback)
```

* 执行任务计划
   * @param {Object} taskPlan - 任务计划
   * @param {Object} projectContext - 项目上下文
   * @param {Function} progressCallback - 进度回调函数
   * @returns {Promise<Object>} 执行结果

---

## resolveExecutionOrder(subtasks)

```javascript
resolveExecutionOrder(subtasks)
```

* 解析执行顺序（基于依赖关系）
   * 使用拓扑排序算法

---

## async executeSubtask(subtask, projectContext, progressCallback)

```javascript
async executeSubtask(subtask, projectContext, progressCallback)
```

* 执行单个子任务

---

## async executeWebEngineTask(subtask, projectContext, progressCallback)

```javascript
async executeWebEngineTask(subtask, projectContext, progressCallback)
```

* 执行Web引擎任务

---

## async executeDocumentEngineTask(subtask, projectContext, progressCallback)

```javascript
async executeDocumentEngineTask(subtask, projectContext, progressCallback)
```

* 执行文档引擎任务

---

## async executeDataEngineTask(subtask, projectContext, progressCallback)

```javascript
async executeDataEngineTask(subtask, projectContext, progressCallback)
```

* 执行数据引擎任务

---

## async executePPTEngineTask(subtask, projectContext, progressCallback)

```javascript
async executePPTEngineTask(subtask, projectContext, progressCallback)
```

* 执行PPT引擎任务

---

## async executeWordEngineTask(subtask, projectContext, progressCallback)

```javascript
async executeWordEngineTask(subtask, projectContext, progressCallback)
```

* 执行Word引擎任务

---

## async executeCodeEngineTask(subtask, projectContext, progressCallback)

```javascript
async executeCodeEngineTask(subtask, projectContext, progressCallback)
```

* 执行代码引擎任务

---

## async executeImageEngineTask(subtask, projectContext, progressCallback)

```javascript
async executeImageEngineTask(subtask, projectContext, progressCallback)
```

* 执行图像引擎任务

---

## async executeGenericTask(subtask, projectContext, progressCallback)

```javascript
async executeGenericTask(subtask, projectContext, progressCallback)
```

* 执行通用任务（使用LLM）

---

## async getTaskPlanHistory(projectId, limit = 10)

```javascript
async getTaskPlanHistory(projectId, limit = 10)
```

* 获取项目的任务计划历史

---

## async getTaskPlan(taskPlanId)

```javascript
async getTaskPlan(taskPlanId)
```

* 获取单个任务计划

---

## async queryBackendAI(prompt, options =

```javascript
async queryBackendAI(prompt, options =
```

* 查询后端AI服务（降级方案）

---

## async cancelTaskPlan(taskPlanId)

```javascript
async cancelTaskPlan(taskPlanId)
```

* 取消任务计划

---

