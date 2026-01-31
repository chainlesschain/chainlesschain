# graph-optimizer

**Source**: `src\renderer\utils\graph-optimizer.js`

**Generated**: 2026-01-27T06:44:03.899Z

---

## class GraphPerformanceOptimizer

```javascript
class GraphPerformanceOptimizer
```

* 知识图谱渲染性能优化模块
 * 优化大规模图谱的渲染性能

---

## optimizeNodes(nodes, edges)

```javascript
optimizeNodes(nodes, edges)
```

* 优化节点数据
   * 根据节点数量选择合适的渲染策略

---

## enhanceNodes(nodes)

```javascript
enhanceNodes(nodes)
```

* 增强节点（全量渲染）

---

## simplifyNodes(nodes)

```javascript
simplifyNodes(nodes)
```

* 简化节点（简化渲染）

---

## clusterNodes(nodes, edges)

```javascript
clusterNodes(nodes, edges)
```

* 聚合节点（聚合渲染）

---

## simplifyEdges(edges)

```javascript
simplifyEdges(edges)
```

* 简化边

---

## clusterEdges(edges)

```javascript
clusterEdges(edges)
```

* 聚合边

---

## async progressiveRender(nodes, edges, renderCallback)

```javascript
async progressiveRender(nodes, edges, renderCallback)
```

* 渐进式渲染

---

## getCachedLayout(graphId, nodes, edges)

```javascript
getCachedLayout(graphId, nodes, edges)
```

* 布局缓存

---

## cacheLayout(graphId, nodes, edges, layout)

```javascript
cacheLayout(graphId, nodes, edges, layout)
```

* 保存布局到缓存

---

## generateCacheKey(graphId, nodes, edges)

```javascript
generateCacheKey(graphId, nodes, edges)
```

* 生成缓存键

---

## shouldUseWebGL(nodeCount)

```javascript
shouldUseWebGL(nodeCount)
```

* WebGL渲染优化

---

## getWebGLConfig()

```javascript
getWebGLConfig()
```

* 获取WebGL配置

---

## cullNodes(nodes, viewport)

```javascript
cullNodes(nodes, viewport)
```

* 视口裁剪
   * 只渲染可见区域的节点

---

## calculateNodeSize(node)

```javascript
calculateNodeSize(node)
```

* 计算节点大小

---

## getNodeColor(node)

```javascript
getNodeColor(node)
```

* 获取节点颜色

---

## getClusterColor(index)

```javascript
getClusterColor(index)
```

* 获取聚合节点颜色

---

## detectCommunities(nodes, edges)

```javascript
detectCommunities(nodes, edges)
```

* 社区检测（简化版Louvain算法）

---

## getNodeCluster(nodeId)

```javascript
getNodeCluster(nodeId)
```

* 获取节点所属社区

---

## hashCode(str)

```javascript
hashCode(str)
```

* 字符串哈希

---

## updateFPS()

```javascript
updateFPS()
```

* FPS监控

---

## recordRenderTime(time)

```javascript
recordRenderTime(time)
```

* 记录渲染时间

---

## emitProgress(progress)

```javascript
emitProgress(progress)
```

* 发送进度事件

---

## getMetrics()

```javascript
getMetrics()
```

* 获取性能指标

---

## clearCache()

```javascript
clearCache()
```

* 清理缓存

---

