# messageTypes

**Source**: `src\renderer\utils\messageTypes.js`

**Generated**: 2026-01-27T06:44:03.896Z

---

## export const MessageType =

```javascript
export const MessageType =
```

* ChatPanel 消息类型定义
 * 用于在对话列表中展示不同类型的交互

---

## export function createUserMessage(content, conversationId = null)

```javascript
export function createUserMessage(content, conversationId = null)
```

* 创建用户消息

---

## export function createAssistantMessage(content, conversationId = null, metadata =

```javascript
export function createAssistantMessage(content, conversationId = null, metadata =
```

* 创建助手消息

---

## export function createSystemMessage(content, metadata =

```javascript
export function createSystemMessage(content, metadata =
```

* 创建系统消息

---

## export function createIntentSystemMessage(intent, userInput, options =

```javascript
export function createIntentSystemMessage(intent, userInput, options =
```

* 创建后续输入意图系统消息
 * @param {string} intent - 意图类型 (CONTINUE_EXECUTION, MODIFY_REQUIREMENT, CLARIFICATION, CANCEL_TASK)
 * @param {string} userInput - 用户输入
 * @param {Object} options - 额外选项
 * @param {string} options.reason - 判断理由
 * @param {string} options.extractedInfo - 提取的关键信息
 * @returns {Object} 系统消息对象

---

## export function createIntentRecognitionMessage(intentResult)

```javascript
export function createIntentRecognitionMessage(intentResult)
```

* 创建意图识别消息

---

## export function createTaskAnalysisMessage(status = 'analyzing')

```javascript
export function createTaskAnalysisMessage(status = 'analyzing')
```

* 创建任务分析消息

---

## export function createInterviewMessage(questions, currentIndex = 0)

```javascript
export function createInterviewMessage(questions, currentIndex = 0)
```

* 创建采访问题消息

---

## export function createTaskPlanMessage(plan)

```javascript
export function createTaskPlanMessage(plan)
```

* 创建任务计划消息

---

## export function createProgressMessage(taskName, progress = 0)

```javascript
export function createProgressMessage(taskName, progress = 0)
```

* 创建进度消息

---

## export function createErrorMessage(error)

```javascript
export function createErrorMessage(error)
```

* 创建错误消息

---

## export function createIntentConfirmationMessage(originalInput, understanding)

```javascript
export function createIntentConfirmationMessage(originalInput, understanding)
```

* 创建意图确认消息
 * @param {string} originalInput - 用户原始输入
 * @param {Object} understanding - AI理解结果
 * @param {string} understanding.correctedInput - 纠错后的输入
 * @param {string} understanding.intent - 理解的意图
 * @param {Array} understanding.keyPoints - 关键要点

---

