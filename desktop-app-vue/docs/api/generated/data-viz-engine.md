# data-viz-engine

**Source**: `src/main/engines/data-viz-engine.js`

**Generated**: 2026-02-21T22:04:25.838Z

---

## const

```javascript
const
```

* 数据可视化引擎
 * 负责将数据转换为可视化图表
 * 使用ECharts库实现

---

## async generateChartConfig(data, chartConfig =

```javascript
async generateChartConfig(data, chartConfig =
```

* 生成图表配置
   * @param {Object} data - 数据
   * @param {Object} chartConfig - 图表配置
   * @returns {Promise<Object>} ECharts配置

---

## processData(data, config)

```javascript
processData(data, config)
```

* 处理数据
   * @param {Array|Object} data - 原始数据
   * @param {Object} config - 配置
   * @returns {Object} 处理后的数据

---

## processSeriesData(data, dataMapping)

```javascript
processSeriesData(data, dataMapping)
```

* 处理系列数据（折线图、柱状图）

---

## processPieData(data, dataMapping)

```javascript
processPieData(data, dataMapping)
```

* 处理饼图数据

---

## processScatterData(data, dataMapping)

```javascript
processScatterData(data, dataMapping)
```

* 处理散点图数据

---

## processRadarData(data, dataMapping)

```javascript
processRadarData(data, dataMapping)
```

* 处理雷达图数据

---

## processFunnelData(data, dataMapping)

```javascript
processFunnelData(data, dataMapping)
```

* 处理漏斗图数据

---

## async generateChartHTML(chartOption, outputPath)

```javascript
async generateChartHTML(chartOption, outputPath)
```

* 生成图表HTML文件
   * @param {Object} chartOption - ECharts配置
   * @param {string} outputPath - 输出路径
   * @returns {Promise<Object>} 生成结果

---

## async generateChartFromCSV(csvPath, chartConfig)

```javascript
async generateChartFromCSV(csvPath, chartConfig)
```

* 从CSV数据生成图表
   * @param {string} csvPath - CSV文件路径
   * @param {Object} chartConfig - 图表配置
   * @returns {Promise<Object>} 生成结果

---

## parseCSV(csvContent)

```javascript
parseCSV(csvContent)
```

* 解析CSV
   * @param {string} csvContent - CSV内容
   * @returns {Array} 数据数组

---

## getChartTypes()

```javascript
getChartTypes()
```

* 获取图表类型列表

---

## getColorThemes()

```javascript
getColorThemes()
```

* 获取颜色主题列表

---

