# followup-intent-classifier

**Source**: `src/main/ai-engine/followup-intent-classifier.js`

**Generated**: 2026-02-17T10:13:18.279Z

---

## const

```javascript
const
```

* 后续输入意图分类器
 * Follow-up Intent Classifier
 *
 * 功能：判断用户在任务执行过程中的后续输入意图
 * - CONTINUE_EXECUTION: 继续执行当前任务（催促、确认）
 * - MODIFY_REQUIREMENT: 修改需求（追加功能、改变参数）
 * - CLARIFICATION: 补充说明（提供细节信息）
 * - CANCEL_TASK: 取消任务

---

## async classify(userInput, context =

```javascript
async classify(userInput, context =
```

* 分类用户的后续输入
   * @param {string} userInput - 用户输入
   * @param {Object} context - 上下文信息
   * @param {Object} context.currentTask - 当前正在执行的任务
   * @param {Array} context.conversationHistory - 对话历史
   * @param {Object} context.taskPlan - 当前任务计划
   * @returns {Promise<Object>} 分类结果

---

## _ruleBasedClassify(userInput)

```javascript
_ruleBasedClassify(userInput)
```

* 规则引擎分类

---

## async _llmBasedClassify(userInput, context)

```javascript
async _llmBasedClassify(userInput, context)
```

* LLM 深度分析

---

## _parseJSON(text)

```javascript
_parseJSON(text)
```

* 解析 JSON（容错处理）

---

## async classifyBatch(inputs, context =

```javascript
async classifyBatch(inputs, context =
```

* 批量分类（优化性能）

---

## getStats()

```javascript
getStats()
```

* 获取统计信息

---

