# office-skill

**Source**: `src/main/ai-engine/cowork/skills/office-skill.js`

**Generated**: 2026-02-21T22:45:05.337Z

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

## async readWord(_input, _context =

```javascript
async readWord(_input, _context =
```

* 读取 Word 文档
   * @param {Object} input - 输入数据
   * @param {Object} context - 上下文
   * @returns {Promise<Object>} 结果

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

## _groupByColumn(data, column)

```javascript
_groupByColumn(data, column)
```

* 按列分组
   * @private

---

