# document-agent

**Source**: `src/main/ai-engine/multi-agent/agents/document-agent.js`

**Generated**: 2026-02-21T20:04:16.289Z

---

## const

```javascript
const
```

* 文档处理 Agent
 *
 * 专门负责文档生成、编辑和格式转换任务。

---

## async execute(task)

```javascript
async execute(task)
```

* 执行文档任务
   * @param {Object} task - 任务对象
   * @returns {Promise<Object>} 执行结果

---

## async writeDocument(input, context)

```javascript
async writeDocument(input, context)
```

* 撰写文档
   * @param {Object} input - 输入参数
   * @param {Object} context - 上下文

---

## async editDocument(input, context)

```javascript
async editDocument(input, context)
```

* 编辑文档
   * @param {Object} input - 输入参数
   * @param {Object} context - 上下文

---

## async summarize(input, context)

```javascript
async summarize(input, context)
```

* 内容摘要
   * @param {Object} input - 输入参数
   * @param {Object} context - 上下文

---

## async translate(input, context)

```javascript
async translate(input, context)
```

* 翻译
   * @param {Object} input - 输入参数
   * @param {Object} context - 上下文

---

## async formatConvert(input, context)

```javascript
async formatConvert(input, context)
```

* 格式转换
   * @param {Object} input - 输入参数
   * @param {Object} context - 上下文

---

## async generateOutline(input, context)

```javascript
async generateOutline(input, context)
```

* 生成大纲
   * @param {Object} input - 输入参数
   * @param {Object} context - 上下文

---

## async proofread(input, context)

```javascript
async proofread(input, context)
```

* 校对
   * @param {Object} input - 输入参数
   * @param {Object} context - 上下文

---

## async extractInfo(input, context)

```javascript
async extractInfo(input, context)
```

* 信息提取
   * @param {Object} input - 输入参数
   * @param {Object} context - 上下文

---

## _countWords(text)

```javascript
_countWords(text)
```

* 统计字数
   * @private

---

## _getChangesSummary(original, edited)

```javascript
_getChangesSummary(original, edited)
```

* 获取变更摘要
   * @private

---

