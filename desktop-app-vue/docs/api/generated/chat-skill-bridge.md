# chat-skill-bridge

**Source**: `src/main/skill-tool-system/chat-skill-bridge.js`

**Generated**: 2026-02-17T10:13:18.194Z

---

## const

```javascript
const
```

* 对话-技能-工具桥接器
 * 打通AI对话与技能工具系统的调用链路
 *
 * 核心功能：
 * 1. 拦截AI响应，识别工具调用意图
 * 2. 自动匹配并调度合适的技能/工具
 * 3. 执行工具并返回结果给AI
 * 4. 支持多轮对话中的工具调用

---

## async interceptAndProcess(userMessage, aiResponse, context =

```javascript
async interceptAndProcess(userMessage, aiResponse, context =
```

* 拦截并处理AI响应
   * @param {string} userMessage - 用户消息
   * @param {string} aiResponse - AI响应
   * @param {Object} context - 上下文信息
   * @returns {Object} 处理结果

---

## detectToolCallIntent(userMessage, aiResponse)

```javascript
detectToolCallIntent(userMessage, aiResponse)
```

* 检测工具调用意图

---

## scoreUserIntent(message)

```javascript
scoreUserIntent(message)
```

* 评估用户意图分数

---

## detectJSONOperations(text)

```javascript
detectJSONOperations(text)
```

* 检测JSON操作块

---

## detectToolMentions(text)

```javascript
detectToolMentions(text)
```

* 检测工具名称提及

---

## detectFileOperationDescription(text)

```javascript
detectFileOperationDescription(text)
```

* 检测文件操作描述

---

## extractToolCalls(aiResponse, intent)

```javascript
extractToolCalls(aiResponse, intent)
```

* 提取工具调用

---

## extractFromJSON(text)

```javascript
extractFromJSON(text)
```

* 从JSON块提取工具调用

---

## mapOperationToToolCall(operation)

```javascript
mapOperationToToolCall(operation)
```

* 将操作映射到工具调用

---

## extractFromToolMentions(text, mentionedTools)

```javascript
extractFromToolMentions(text, mentionedTools)
```

* 从工具提及提取

---

## extractFromFileDescription(text)

```javascript
extractFromFileDescription(text)
```

* 从文件描述提取

---

## async executeToolCalls(toolCalls, context)

```javascript
async executeToolCalls(toolCalls, context)
```

* 执行工具调用

---

## buildEnhancedResponse(originalResponse, toolCalls, executionResults)

```javascript
buildEnhancedResponse(originalResponse, toolCalls, executionResults)
```

* 构建增强响应

---

## buildToolCallPatterns()

```javascript
buildToolCallPatterns()
```

* 构建工具调用模式

---

## async intelligentMode(userMessage, context)

```javascript
async intelligentMode(userMessage, context)
```

* 智能模式：使用AI调度器选择技能

---

## getStats()

```javascript
getStats()
```

* 获取统计信息

---

## _updateStats(type, data =

```javascript
_updateStats(type, data =
```

* 更新统计信息
   * @private

---

