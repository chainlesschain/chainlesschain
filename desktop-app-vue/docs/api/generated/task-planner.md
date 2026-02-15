# task-planner

**Source**: `src/main/ai-engine/task-planner.js`

**Generated**: 2026-02-15T10:10:53.451Z

---

## const

```javascript
const
```

* AI任务智能拆解系统
 * 负责将用户的复杂需求拆解为可执行的子任务
 * 参考: 系统设计文档 2.4.6节

---

## class TaskPlanner

```javascript
class TaskPlanner
```

* 任务规划器

---

## async initialize()

```javascript
async initialize()
```

* 初始化

---

## async decomposeTask(userRequest, projectContext)

```javascript
async decomposeTask(userRequest, projectContext)
```

* 拆解用户任务
   * @param {string} userRequest - 用户需求描述
   * @param {Object} projectContext - 项目上下文
   * @returns {Promise<Object>} 任务计划

---

## getSystemPrompt()

```javascript
getSystemPrompt()
```

* 获取系统提示词

---

## buildDecompositionPrompt(userRequest, projectContext, enhancedContext)

```javascript
buildDecompositionPrompt(userRequest, projectContext, enhancedContext)
```

* 构建任务拆解提示词

---

## validateAndEnhancePlan(taskPlan, projectContext)

```javascript
validateAndEnhancePlan(taskPlan, projectContext)
```

* 验证和增强任务计划

---

## recommendTool(taskDescription)

```javascript
recommendTool(taskDescription)
```

* 根据文件类型推荐工具引擎
   * @param {string} taskDescription - 任务描述
   * @returns {string} 推荐的工具引擎

---

## assessComplexity(taskDescription)

```javascript
assessComplexity(taskDescription)
```

* 评估任务复杂度
   * @param {string} taskDescription - 任务描述
   * @returns {Object} 复杂度评估

---

## quickDecompose(userRequest, projectContext)

```javascript
quickDecompose(userRequest, projectContext)
```

* 简单任务快速拆解（不调用LLM）
   * 用于一些明确的单步任务或LLM调用失败时的fallback

---

## getTaskTypeFromTool(tool)

```javascript
getTaskTypeFromTool(tool)
```

* 从工具名获取任务类型

---

## function getTaskPlanner()

```javascript
function getTaskPlanner()
```

* 获取任务规划器实例
 * @returns {TaskPlanner}

---

