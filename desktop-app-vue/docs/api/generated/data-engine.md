# data-engine

**Source**: `src/main/engines/data-engine.js`

**Generated**: 2026-02-15T07:37:13.837Z

---

## const

```javascript
const
```

* 数据处理引擎
 * 负责Excel/CSV数据读写、数据分析和可视化

---

## async readCSV(filePath)

```javascript
async readCSV(filePath)
```

* 读取CSV数据
   * @param {string} filePath - CSV文件路径
   * @returns {Promise<Object>} 数据对象

---

## async readExcel(filePath)

```javascript
async readExcel(filePath)
```

* 读取Excel数据
   * @param {string} filePath - Excel文件路径
   * @returns {Promise<Object>} 数据对象

---

## async writeCSV(filePath, data)

```javascript
async writeCSV(filePath, data)
```

* 写入CSV数据
   * @param {string} filePath - CSV文件路径
   * @param {Object} data - 数据对象
   * @returns {Promise<Object>} 写入结果

---

## async writeExcel(filePath, data)

```javascript
async writeExcel(filePath, data)
```

* 写入Excel数据
   * @param {string} filePath - Excel文件路径
   * @param {Object} data - 数据对象
   * @returns {Promise<Object>} 写入结果

---

## analyzeData(data, options =

```javascript
analyzeData(data, options =
```

* 数据分析
   * @param {Object} data - 数据对象
   * @param {Object} options - 分析选项
   * @returns {Object} 分析结果

---

## async generateChart(data, options =

```javascript
async generateChart(data, options =
```

* 生成数据可视化图表
   * @param {Object} data - 数据对象
   * @param {Object} options - 图表选项
   * @returns {Promise<Object>} 图表HTML

---

## async generateReport(analysisResults, outputPath)

```javascript
async generateReport(analysisResults, outputPath)
```

* 生成分析报告
   * @param {Object} analysisResults - 分析结果
   * @param {string} outputPath - 输出路径
   * @returns {Promise<Object>} 报告结果

---

## parseCSVLine(line)

```javascript
parseCSVLine(line)
```

* 解析CSV行（支持双引号转义）
   * @private

---

## findNumericColumns(rows)

```javascript
findNumericColumns(rows)
```

* 找到数值列
   * @private

---

## sum(values)

```javascript
sum(values)
```

* 求和
   * @private

---

## mean(values)

```javascript
mean(values)
```

* 平均值
   * @private

---

## median(values)

```javascript
median(values)
```

* 中位数
   * @private

---

## standardDeviation(values)

```javascript
standardDeviation(values)
```

* 标准差（样本标准差）
   * @private

---

## generateChartHTML(chartType, data)

```javascript
generateChartHTML(chartType, data)
```

* 生成图表HTML
   * @private

---

## generateReportMarkdown(analysisResults)

```javascript
generateReportMarkdown(analysisResults)
```

* 生成报告Markdown
   * @private

---

## generateNutritionReportMarkdown(analysisResults, options =

```javascript
generateNutritionReportMarkdown(analysisResults, options =
```

* 生成营养分析报告Markdown
   * @private

---

## findNutritionColumns(headers)

```javascript
findNutritionColumns(headers)
```

* 查找营养相关列
   * @private

---

## async generateNutritionReportWithLLM(description, llmManager)

```javascript
async generateNutritionReportWithLLM(description, llmManager)
```

* 使用LLM生成营养分析报告
   * @private

---

## generateNutritionFallbackMarkdown(description)

```javascript
generateNutritionFallbackMarkdown(description)
```

* 生成营养分析兜底报告
   * @private

---

## async handleProjectTask(params)

```javascript
async handleProjectTask(params)
```

* 处理项目任务
   * @param {Object} params - 任务参数
   * @returns {Promise<Object>} 处理结果

---

## extractFileNameFromDescription(description)

```javascript
extractFileNameFromDescription(description)
```

* 从描述中提取文件名（带路径安全验证）
   * @private

---

## isPathSafe(filePath)

```javascript
isPathSafe(filePath)
```

* 验证路径安全性（防止路径遍历攻击）
   * @private

---

## async generateSampleDataWithLLM(description, llmManager)

```javascript
async generateSampleDataWithLLM(description, llmManager)
```

* 使用LLM生成示例数据
   * @private

---

