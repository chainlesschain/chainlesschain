# graph-exporter

**Source**: `src/main/knowledge-graph/graph-exporter.js`

**Generated**: 2026-02-21T22:45:05.289Z

---

## const fs = require('fs');

```javascript
const fs = require('fs');
```

* 知识图谱导出工具
 *
 * 支持多种格式导出：SVG, PNG, GraphML, GEXF, JSON

---

## loadGraph(nodes, edges)

```javascript
loadGraph(nodes, edges)
```

* 加载图数据

---

## exportToGraphML()

```javascript
exportToGraphML()
```

* 导出为GraphML格式
   * GraphML是标准的图数据交换格式

---

## exportToGEXF()

```javascript
exportToGEXF()
```

* 导出为GEXF格式
   * GEXF是Gephi使用的图格式

---

## exportToJSON()

```javascript
exportToJSON()
```

* 导出为JSON格式

---

## exportToCSV()

```javascript
exportToCSV()
```

* 导出为CSV格式（边列表）

---

## exportToDOT()

```javascript
exportToDOT()
```

* 导出为DOT格式（Graphviz）

---

## exportToCytoscape()

```javascript
exportToCytoscape()
```

* 导出为Cytoscape.js格式

---

## async saveToFile(filePath, format = 'graphml')

```javascript
async saveToFile(filePath, format = 'graphml')
```

* 保存到文件

---

## async exportImage(canvas, format = 'png', quality = 0.95)

```javascript
async exportImage(canvas, format = 'png', quality = 0.95)
```

* 导出图像（需要在渲染进程中调用）

---

## exportSVG(chartInstance)

```javascript
exportSVG(chartInstance)
```

* 导出SVG（从ECharts实例）

---

## escapeXml(str)

```javascript
escapeXml(str)
```

* 辅助方法：转义XML

---

## escapeDOT(str)

```javascript
escapeDOT(str)
```

* 辅助方法：转义DOT

---

## getNodeColor(type)

```javascript
getNodeColor(type)
```

* 辅助方法：获取节点颜色

---

## getEdgeColor(type)

```javascript
getEdgeColor(type)
```

* 辅助方法：获取边颜色

---

## static getSupportedFormats()

```javascript
static getSupportedFormats()
```

* 获取支持的格式列表

---

