# followupIntentHelper

**Source**: `src\renderer\utils\followupIntentHelper.js`

**Generated**: 2026-01-27T06:44:03.899Z

---

## export function findExecutingTask(messages)

```javascript
export function findExecutingTask(messages)
```

* 后续输入意图处理助手
 * 简化的工具函数，用于在 ChatPanel.vue 中集成后续输入意图分类

---

## export function findExecutingTask(messages)

```javascript
export function findExecutingTask(messages)
```

* 检查是否有正在执行的任务
 * @param {Array} messages - 消息数组
 * @returns {Object|null} 正在执行的任务计划消息

---

## export function buildClassificationContext(taskMessage, messages = [])

```javascript
export function buildClassificationContext(taskMessage, messages = [])
```

* 构建意图分类的上下文
 * @param {Object} taskMessage - 任务计划消息
 * @param {Array} messages - 完整消息列表
 * @returns {Object} 上下文对象

---

## export function createIntentSystemMessage(intent, userInput, options =

```javascript
export function createIntentSystemMessage(intent, userInput, options =
```

* 根据意图生成系统消息
 * @param {string} intent - 意图类型
 * @param {string} userInput - 用户输入
 * @param {Object} options - 额外选项
 * @returns {Object} 系统消息对象

---

## export function mergeRequirements(originalRequirement, newRequirement)

```javascript
export function mergeRequirements(originalRequirement, newRequirement)
```

* 合并原需求和新需求
 * @param {string} originalRequirement - 原始需求
 * @param {string} newRequirement - 新需求
 * @returns {string} 合并后的需求

---

## export function addClarificationToTaskPlan(taskPlan, clarification)

```javascript
export function addClarificationToTaskPlan(taskPlan, clarification)
```

* 更新任务计划的补充信息
 * @param {Object} taskPlan - 任务计划对象
 * @param {string} clarification - 补充说明
 * @returns {Object} 更新后的任务计划

---

## export function getIntentDescription(intent)

```javascript
export function getIntentDescription(intent)
```

* 获取意图的中文描述
 * @param {string} intent - 意图类型
 * @returns {string} 中文描述

---

## export function needsUserConfirmation(classifyResult, threshold = 0.6)

```javascript
export function needsUserConfirmation(classifyResult, threshold = 0.6)
```

* 判断是否需要用户确认
 * @param {Object} classifyResult - 分类结果
 * @param {number} threshold - 置信度阈值（默认 0.6）
 * @returns {boolean} 是否需要确认

---

## export function createConfirmationDialogConfig(classifyResult, userInput)

```javascript
export function createConfirmationDialogConfig(classifyResult, userInput)
```

* 生成意图确认对话框配置
 * @param {Object} classifyResult - 分类结果
 * @param {string} userInput - 用户输入
 * @returns {Object} 对话框配置

---

## export function handleClassificationError(error, userInput)

```javascript
export function handleClassificationError(error, userInput)
```

* 处理意图分类错误
 * @param {Error} error - 错误对象
 * @param {string} userInput - 用户输入
 * @returns {Object} 降级结果

---

## export function formatIntentLog(classifyResult, userInput)

```javascript
export function formatIntentLog(classifyResult, userInput)
```

* 格式化意图日志
 * @param {Object} classifyResult - 分类结果
 * @param {string} userInput - 用户输入
 * @returns {string} 格式化的日志字符串

---

## export async function batchTestIntents(testInputs)

```javascript
export async function batchTestIntents(testInputs)
```

* 批量测试意图分类（调试用）
 * @param {Array} testInputs - 测试输入数组
 * @returns {Promise<Array>} 测试结果数组

---

## if (typeof window !== 'undefined')

```javascript
if (typeof window !== 'undefined')
```

* 调试模式：在控制台测试意图分类
 * 使用方法: 在浏览器控制台运行 window.testFollowupIntent('继续')

---

