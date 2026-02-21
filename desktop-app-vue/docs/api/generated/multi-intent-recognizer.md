# multi-intent-recognizer

**Source**: `src/main/ai-engine/multi-intent-recognizer.js`

**Generated**: 2026-02-21T20:04:16.281Z

---

## class MultiIntentRecognizer

```javascript
class MultiIntentRecognizer
```

* 多意图识别器
 *
 * 功能:
 * 1. 识别用户输入中的多个独立意图
 * 2. 自动拆分复合任务为独立子任务
 * 3. 建立任务依赖关系
 * 4. 确定任务优先级
 *
 * 示例:
 * 输入: "创建博客网站并部署到云端"
 * 输出: [
 *   { intent: 'CREATE_FILE', priority: 1, description: '创建博客网站' },
 *   { intent: 'DEPLOY_PROJECT', priority: 2, dependencies: [1], description: '部署到云端' }
 * ]
 *
 * 版本: v0.17.0-P1
 * 更新: 2026-01-01

---

## async classifyMultiple(text, context =

```javascript
async classifyMultiple(text, context =
```

* 识别多个意图
   * @param {string} text - 用户输入
   * @param {Object} context - 上下文信息
   * @returns {Object} 多意图识别结果

---

## detectMultipleIntents(text)

```javascript
detectMultipleIntents(text)
```

* 快速检测是否包含多个意图
   * @param {string} text - 用户输入
   * @returns {boolean}

---

## async llmBasedSplit(text, context)

```javascript
async llmBasedSplit(text, context)
```

* 使用LLM拆分多个意图
   * @param {string} text - 用户输入
   * @param {Object} context - 上下文
   * @returns {Array} 拆分后的意图列表

---

## ruleBasedSplit(text, context)

```javascript
ruleBasedSplit(text, context)
```

* 基于规则的意图拆分（降级策略）
   * @param {string} text - 用户输入
   * @param {Object} context - 上下文
   * @returns {Array} 拆分后的意图列表

---

## guessIntent(text)

```javascript
guessIntent(text)
```

* 简单的意图猜测（基于关键词）
   * @param {string} text - 文本
   * @returns {string} 意图类型

---

## extractEntities(text)

```javascript
extractEntities(text)
```

* 简单的实体提取
   * @param {string} text - 文本
   * @returns {Object} 实体对象

---

## async enrichIntents(intents, context)

```javascript
async enrichIntents(intents, context)
```

* 丰富意图信息（使用原有分类器）
   * @param {Array} intents - 基础意图列表
   * @param {Object} context - 上下文
   * @returns {Array} 丰富后的意图列表

---

## validateDependencies(intents)

```javascript
validateDependencies(intents)
```

* 验证依赖关系
   * @param {Array} intents - 意图列表
   * @returns {Array} 验证后的意图列表

---

## detectCyclicDependency(intents)

```javascript
detectCyclicDependency(intents)
```

* 检测循环依赖
   * @param {Array} intents - 意图列表
   * @returns {boolean} 是否存在循环依赖

---

## parseJSON(text)

```javascript
parseJSON(text)
```

* 解析JSON（容错处理）
   * @param {string} text - JSON字符串
   * @returns {Object} 解析后的对象

---

## getExecutionOrder(intents)

```javascript
getExecutionOrder(intents)
```

* 获取执行顺序（拓扑排序）
   * @param {Array} intents - 意图列表
   * @returns {Array} 排序后的意图列表

---

## generateSummary(intents)

```javascript
generateSummary(intents)
```

* 生成执行计划摘要
   * @param {Array} intents - 意图列表
   * @returns {string} 摘要文本

---

