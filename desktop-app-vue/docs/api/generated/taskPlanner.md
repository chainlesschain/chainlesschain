# taskPlanner

**Source**: `src\renderer\utils\taskPlanner.js`

**Generated**: 2026-01-27T06:44:03.894Z

---

## export const PlanningState =

```javascript
export const PlanningState =
```

* 对话式任务规划助手
 * 类似Claude Code的plan模式，通过对话收集信息并制定详细计划

---

## export const PlanningState =

```javascript
export const PlanningState =
```

* 规划状态

---

## export class PlanningSession

```javascript
export class PlanningSession
```

* 任务规划会话

---

## setState(newState)

```javascript
setState(newState)
```

* 更新状态

---

## addCollectedInfo(key, value)

```javascript
addCollectedInfo(key, value)
```

* 添加已收集的信息

---

## addQuestion(question, key, required = true)

```javascript
addQuestion(question, key, required = true)
```

* 添加采访问题

---

## recordAnswer(questionIndex, answer)

```javascript
recordAnswer(questionIndex, answer)
```

* 记录答案

---

## hasMoreQuestions()

```javascript
hasMoreQuestions()
```

* 是否还有未回答的问题

---

## getNextQuestion()

```javascript
getNextQuestion()
```

* 获取下一个问题

---

## setPlan(plan)

```javascript
setPlan(plan)
```

* 设置任务计划

---

## export class TaskPlanner

```javascript
export class TaskPlanner
```

* 任务规划器

---

## static async analyzeRequirements(userInput, projectType, llmService)

```javascript
static async analyzeRequirements(userInput, projectType, llmService)
```

* 分析需求完整性
   * @param {string} userInput - 用户输入
   * @param {string} projectType - 项目类型
   * @param {Object} llmService - LLM服务
   * @returns {Promise<Object>} 分析结果

---

## static async generatePlan(session, llmService)

```javascript
static async generatePlan(session, llmService)
```

* 生成任务计划
   * @param {PlanningSession} session - 规划会话
   * @param {Object} llmService - LLM服务
   * @returns {Promise<Object>} 任务计划

---

## static formatPlanAsMarkdown(plan)

```javascript
static formatPlanAsMarkdown(plan)
```

* 格式化计划为Markdown
   * @param {Object} plan - 任务计划
   * @returns {string} Markdown格式的计划

---

