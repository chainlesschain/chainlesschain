# graph

**Source**: `src\renderer\stores\graph.js`

**Generated**: 2026-01-27T06:44:03.892Z

---

## async loadGraphData(options =

```javascript
async loadGraphData(options =
```

* 加载图谱数据

---

## async processNote(noteId, content, tags = [])

```javascript
async processNote(noteId, content, tags = [])
```

* 处理单个笔记的关系

---

## async processAllNotes(noteIds = null)

```javascript
async processAllNotes(noteIds = null)
```

* 批量处理所有笔记

---

## async getKnowledgeRelations(knowledgeId)

```javascript
async getKnowledgeRelations(knowledgeId)
```

* 获取笔记的所有关系

---

## async findRelatedNotes(sourceId, targetId, maxDepth = 3)

```javascript
async findRelatedNotes(sourceId, targetId, maxDepth = 3)
```

* 查找两个笔记之间的关联路径

---

## async findPotentialLinks(noteId, content)

```javascript
async findPotentialLinks(noteId, content)
```

* 查找潜在链接建议

---

## async addRelation(sourceId, targetId, type, weight = 1.0, metadata = null)

```javascript
async addRelation(sourceId, targetId, type, weight = 1.0, metadata = null)
```

* 添加关系

---

## async deleteRelations(noteId, types = [])

```javascript
async deleteRelations(noteId, types = [])
```

* 删除关系

---

## async buildTagRelations()

```javascript
async buildTagRelations()
```

* 重建标签关系

---

## async buildTemporalRelations(windowDays = 7)

```javascript
async buildTemporalRelations(windowDays = 7)
```

* 重建时间关系

---

## async extractSemanticRelations(noteId, content)

```javascript
async extractSemanticRelations(noteId, content)
```

* 提取语义关系（使用LLM）

---

## updateFilters(newFilters)

```javascript
updateFilters(newFilters)
```

* 更新筛选选项

---

## selectNode(nodeId)

```javascript
selectNode(nodeId)
```

* 选中节点

---

## hoverNode(nodeId)

```javascript
hoverNode(nodeId)
```

* 悬停节点

---

## clearSelection()

```javascript
clearSelection()
```

* 取消选中

---

## setLayout(layout)

```javascript
setLayout(layout)
```

* 切换布局

---

## async calculateCentrality(type = 'degree')

```javascript
async calculateCentrality(type = 'degree')
```

* 计算节点中心性

---

## async detectCommunities()

```javascript
async detectCommunities()
```

* 社区检测

---

## async clusterNodes(k = 5)

```javascript
async clusterNodes(k = 5)
```

* 节点聚类

---

## async findKeyNodes(topN = 10)

```javascript
async findKeyNodes(topN = 10)
```

* 查找关键节点

---

## async analyzeGraphStats()

```javascript
async analyzeGraphStats()
```

* 分析图谱统计

---

## async exportGraph(format)

```javascript
async exportGraph(format)
```

* 导出图谱

---

## reset()

```javascript
reset()
```

* 重置状态

---

