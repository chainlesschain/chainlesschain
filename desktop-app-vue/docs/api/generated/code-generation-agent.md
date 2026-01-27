# code-generation-agent

**Source**: `src\main\ai-engine\multi-agent\agents\code-generation-agent.js`

**Generated**: 2026-01-27T06:44:03.887Z

---

## const

```javascript
const
```

* 代码生成 Agent
 *
 * 专门负责代码生成、重构和审查任务。

---

## async execute(task)

```javascript
async execute(task)
```

* 执行代码相关任务
   * @param {Object} task - 任务对象
   * @returns {Promise<Object>} 执行结果

---

## async generateCode(input, context)

```javascript
async generateCode(input, context)
```

* 生成代码
   * @param {Object} input - 输入参数
   * @param {Object} context - 上下文

---

## async refactorCode(input, context)

```javascript
async refactorCode(input, context)
```

* 重构代码
   * @param {Object} input - 输入参数
   * @param {Object} context - 上下文

---

## async reviewCode(input, context)

```javascript
async reviewCode(input, context)
```

* 代码审查
   * @param {Object} input - 输入参数
   * @param {Object} context - 上下文

---

## async fixBug(input, context)

```javascript
async fixBug(input, context)
```

* 修复 Bug
   * @param {Object} input - 输入参数
   * @param {Object} context - 上下文

---

## async addFeature(input, context)

```javascript
async addFeature(input, context)
```

* 添加功能
   * @param {Object} input - 输入参数
   * @param {Object} context - 上下文

---

## async optimizeCode(input, context)

```javascript
async optimizeCode(input, context)
```

* 优化代码
   * @param {Object} input - 输入参数
   * @param {Object} context - 上下文

---

## async writeTests(input, context)

```javascript
async writeTests(input, context)
```

* 编写测试
   * @param {Object} input - 输入参数
   * @param {Object} context - 上下文

---

## _extractCodeBlocks(text)

```javascript
_extractCodeBlocks(text)
```

* 提取代码块
   * @private

---

## _parseReview(text)

```javascript
_parseReview(text)
```

* 解析审查结果
   * @private

---

