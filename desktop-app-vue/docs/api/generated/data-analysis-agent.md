# data-analysis-agent

**Source**: `src/main/ai-engine/multi-agent/agents/data-analysis-agent.js`

**Generated**: 2026-02-15T08:42:37.279Z

---

## const

```javascript
const
```

* 数据分析 Agent
 *
 * 专门负责数据分析、可视化和转换任务。

---

## async execute(task)

```javascript
async execute(task)
```

* 执行数据分析任务
   * @param {Object} task - 任务对象
   * @returns {Promise<Object>} 执行结果

---

## async analyzeData(input, context)

```javascript
async analyzeData(input, context)
```

* 数据分析
   * @param {Object} input - 输入参数
   * @param {Object} context - 上下文

---

## async visualizeData(input, context)

```javascript
async visualizeData(input, context)
```

* 数据可视化建议
   * @param {Object} input - 输入参数
   * @param {Object} context - 上下文

---

## async transformData(input, context)

```javascript
async transformData(input, context)
```

* 数据转换
   * @param {Object} input - 输入参数
   * @param {Object} context - 上下文

---

## async aggregateData(input, context)

```javascript
async aggregateData(input, context)
```

* 数据聚合
   * @param {Object} input - 输入参数
   * @param {Object} context - 上下文

---

## async calculateStatistics(input, context)

```javascript
async calculateStatistics(input, context)
```

* 统计计算
   * @param {Object} input - 输入参数
   * @param {Object} context - 上下文

---

## async predictTrend(input, context)

```javascript
async predictTrend(input, context)
```

* 趋势预测
   * @param {Object} input - 输入参数
   * @param {Object} context - 上下文

---

## async cleanData(input, context)

```javascript
async cleanData(input, context)
```

* 数据清洗
   * @param {Object} input - 输入参数
   * @param {Object} context - 上下文

---

## async exportData(input, context)

```javascript
async exportData(input, context)
```

* 数据导出
   * @param {Object} input - 输入参数
   * @param {Object} context - 上下文

---

## _getDataPreview(data, maxLength = 2000)

```javascript
_getDataPreview(data, maxLength = 2000)
```

* 获取数据预览
   * @private

---

## _calculateBasicStats(numbers)

```javascript
_calculateBasicStats(numbers)
```

* 计算基本统计
   * @private

---

## _basicClean(data, rules)

```javascript
_basicClean(data, rules)
```

* 基本数据清洗
   * @private

---

## _toCSV(data, options =

```javascript
_toCSV(data, options =
```

* 转换为 CSV
   * @private

---

## _toMarkdownTable(data)

```javascript
_toMarkdownTable(data)
```

* 转换为 Markdown 表格
   * @private

---

## _tryParseJSON(str)

```javascript
_tryParseJSON(str)
```

* 尝试解析 JSON
   * @private

---

## _tryExecuteTransform(data, response)

```javascript
_tryExecuteTransform(data, response)
```

* 尝试执行转换
   * @private

---

