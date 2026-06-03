# office-skill

**Source**: `src/main/ai-engine/cowork/skills/office-skill.js`

---

## const

```javascript
const
```

* OfficeSkill - Office 文档处理技能
 *
 * 支持 Excel (.xlsx)、Word (.docx)、PowerPoint (.pptx) 等 Office 文档的创建和处理。
 *
 * @module ai-engine/cowork/skills/office-skill

---

## class OfficeSkill extends BaseSkill

```javascript
class OfficeSkill extends BaseSkill
```

* OfficeSkill 类

---

## canHandle(task)

```javascript
canHandle(task)
```

* 判断是否能处理任务（重写父类方法）
   * @param {Object} task - 任务对象
   * @returns {number} 匹配分数 (0-100)

---

## async execute(task, context =

```javascript
async execute(task, context =
```

* 执行技能
   * @param {Object} task - 任务对象
   * @param {Object} context - 执行上下文
   * @returns {Promise<any>} 执行结果

---

## async createExcel(input, context =

```javascript
async createExcel(input, context =
```

* 创建 Excel 文件
   * @param {Object} input - 输入数据
   * @param {Object} context - 上下文
   * @returns {Promise<Object>} 结果

---

## async _createExcelSheet(workbook, sheetData, _options)

```javascript
async _createExcelSheet(workbook, sheetData, _options)
```

* 创建 Excel 工作表
   * @private

---

## async readExcel(input, _context =

```javascript
async readExcel(input, _context =
```

* 读取 Excel 文件
   * @param {Object} input - 输入数据
   * @param {Object} context - 上下文
   * @returns {Promise<Object>} 结果

---

## async createWord(input, _context =

```javascript
async createWord(input, _context =
```

* 创建 Word 文档
   * @param {Object} input - 输入数据
   * @param {Object} context - 上下文
   * @returns {Promise<Object>} 结果

---

## async readWord(input, _context =

```javascript
async readWord(input, _context =
```

* 读取 Word 文档
   * @param {Object} input - 输入数据 { filePath, format? }
   * @param {Object} context - 上下文
   * @returns {Promise<Object>} 结果 { success, filePath, text, html?, warnings }

---

## async createPowerPoint(input, _context =

```javascript
async createPowerPoint(input, _context =
```

* 创建 PowerPoint 演示文稿
   * @param {Object} input - 输入数据
   * @param {Object} context - 上下文
   * @returns {Promise<Object>} 结果

---

## _addChartToSlide(slide, chartData)

```javascript
_addChartToSlide(slide, chartData)
```

* 添加图表到幻灯片
   * @private

---

## async performDataAnalysis(input, context =

```javascript
async performDataAnalysis(input, context =
```

* 执行数据分析
   * @param {Object} input - 输入数据
   * @param {Object} context - 上下文
   * @returns {Promise<Object>} 结果

---

## _calculateSummary(data)

```javascript
_calculateSummary(data)
```

* 计算摘要
   * @private

---

## _calculateStatistics(data)

```javascript
_calculateStatistics(data)
```

* 计算统计信息
   * @private

---

## _groupByColumn(data, column, aggregateColumn, aggregateFunction)

```javascript
_groupByColumn(data, column, aggregateColumn, aggregateFunction)
```

* 按列分组（可选聚合）
   *
   * - 不传 aggregateColumn/aggregateFunction 时：返回 `{ key: [rows...] }`（向后兼容）。
   * - 同时传入聚合列与聚合函数时：返回 `{ key: aggregatedValue }`，
   *   支持 sum / avg(average) / count / min / max。
   *
   * @param {Array<Object>} data - 数据行
   * @param {string} column - 分组列
   * @param {string} [aggregateColumn] - 聚合列
   * @param {string} [aggregateFunction] - 聚合函数（sum/avg/average/count/min/max）
   * @private

---

## _aggregate(values, fn)

```javascript
_aggregate(values, fn)
```

* 对一组数值应用聚合函数。空集合返回 null；未知函数返回 null（不静默假装成功）。
   * @param {number[]} values
   * @param {string} fn - sum/avg/average/count/min/max
   * @returns {number|null}
   * @private

---

