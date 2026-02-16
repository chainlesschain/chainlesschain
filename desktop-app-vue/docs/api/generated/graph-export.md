# graph-export

**Source**: `src/main/knowledge-graph/graph-export.js`

**Generated**: 2026-02-16T22:06:51.476Z

---

## const

```javascript
const
```

* 知识图谱导出模块
 * 支持多种格式导出：PNG, SVG, JSON, GraphML, GEXF, DOT

---

## function exportToJSON(nodes, edges)

```javascript
function exportToJSON(nodes, edges)
```

* 导出为 JSON 格式

---

## function exportToGraphML(nodes, edges)

```javascript
function exportToGraphML(nodes, edges)
```

* 导出为 GraphML 格式（Gephi 兼容）

---

## function exportToGEXF(nodes, edges)

```javascript
function exportToGEXF(nodes, edges)
```

* 导出为 GEXF 格式（Gephi 原生格式）

---

## function exportToDOT(nodes, edges)

```javascript
function exportToDOT(nodes, edges)
```

* 导出为 DOT 格式（Graphviz）

---

## function exportToCSV(nodes, edges)

```javascript
function exportToCSV(nodes, edges)
```

* 导出为 CSV 格式（节点和边分别导出）

---

## function exportToHTML(nodes, edges)

```javascript
function exportToHTML(nodes, edges)
```

* 导出为交互式 HTML

---

## async function saveExportFile(

```javascript
async function saveExportFile(
```

* 保存导出文件

---

## function escapeXml(str)

```javascript
function escapeXml(str)
```

* 转义 XML 特殊字符

---

## function escapeDot(str)

```javascript
function escapeDot(str)
```

* 转义 DOT 特殊字符

---

## function escapeCsv(str)

```javascript
function escapeCsv(str)
```

* 转义 CSV 特殊字符

---

## async function exportGraph(nodes, edges, format)

```javascript
async function exportGraph(nodes, edges, format)
```

* 导出图谱（主函数）

---

