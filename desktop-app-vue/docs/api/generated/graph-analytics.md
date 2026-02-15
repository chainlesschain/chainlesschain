# graph-analytics

**Source**: `src/main/knowledge-graph/graph-analytics.js`

**Generated**: 2026-02-15T08:42:37.232Z

---

## function calculateDegreeCentrality(nodes, edges)

```javascript
function calculateDegreeCentrality(nodes, edges)
```

* 知识图谱分析模块
 * 提供图分析算法：中心性分析、社区检测、聚类等

---

## function calculateDegreeCentrality(nodes, edges)

```javascript
function calculateDegreeCentrality(nodes, edges)
```

* 计算节点的度中心性（Degree Centrality）
 * 度中心性衡量节点的连接数量

---

## function calculateClosenessCentrality(nodes, edges)

```javascript
function calculateClosenessCentrality(nodes, edges)
```

* 计算节点的接近中心性（Closeness Centrality）
 * 接近中心性衡量节点到其他所有节点的平均距离

---

## function calculateBetweennessCentrality(nodes, edges)

```javascript
function calculateBetweennessCentrality(nodes, edges)
```

* 计算节点的中介中心性（Betweenness Centrality）
 * 中介中心性衡量节点在最短路径上出现的频率

---

## function calculatePageRank(

```javascript
function calculatePageRank(
```

* PageRank 算法
 * 衡量节点的重要性，考虑链接的质量和数量

---

## function detectCommunities(nodes, edges)

```javascript
function detectCommunities(nodes, edges)
```

* Louvain 社区检测算法
 * 检测图中的社区结构

---

## function calculateModularityGain(

```javascript
function calculateModularityGain(
```

* 计算模块度增益

---

## function clusterNodes(nodes, edges, k = 5, maxIterations = 100)

```javascript
function clusterNodes(nodes, edges, k = 5, maxIterations = 100)
```

* K-means 聚类算法（基于节点特征）

---

## function extractNodeFeatures(nodes, edges)

```javascript
function extractNodeFeatures(nodes, edges)
```

* 提取节点特征

---

## function euclideanDistance(feature1, feature2)

```javascript
function euclideanDistance(feature1, feature2)
```

* 计算欧几里得距离

---

## function calculateCentroid(features)

```javascript
function calculateCentroid(features)
```

* 计算质心

---

## function buildAdjacencyList(nodes, edges)

```javascript
function buildAdjacencyList(nodes, edges)
```

* 构建邻接表

---

## function bfs(startId, adjacency, nodes)

```javascript
function bfs(startId, adjacency, nodes)
```

* 广度优先搜索（BFS）

---

## function findKeyNodes(nodes, edges, topN = 10)

```javascript
function findKeyNodes(nodes, edges, topN = 10)
```

* 查找关键节点（综合多个指标）

---

## function analyzeGraphStats(nodes, edges)

```javascript
function analyzeGraphStats(nodes, edges)
```

* 分析图谱统计信息

---

## function findConnectedComponents(nodes, adjacency)

```javascript
function findConnectedComponents(nodes, adjacency)
```

* 查找连通分量

---

