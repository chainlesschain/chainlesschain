# 知识图谱可视化完善 - 功能文档

## 概述

本次更新为 ChainlessChain 知识图谱系统添加了多项高级功能，包括图分析算法、3D 可视化、智能实体提取和多格式导出。

## 新增功能

### 1. 图分析算法 (Graph Analytics)

#### 1.1 中心性分析

实现了四种中心性算法，用于识别图中的重要节点：

- **度中心性 (Degree Centrality)**: 衡量节点的连接数量
- **接近中心性 (Closeness Centrality)**: 衡量节点到其他节点的平均距离
- **中介中心性 (Betweenness Centrality)**: 衡量节点在最短路径上的重要性
- **PageRank**: Google 的网页排名算法，考虑链接的质量和数量

**使用方法**:
```javascript
// 在 Vue 组件中
const graphStore = useGraphStore();

// 计算度中心性
const centrality = await graphStore.calculateCentrality('degree');

// 计算 PageRank
const pageRank = await graphStore.calculateCentrality('pagerank');
```

**API**:
- IPC: `graph:calculate-centrality`
- 参数: `(nodes, edges, type)`
- 返回: `Map<nodeId, score>`

#### 1.2 社区检测

使用 Louvain 算法检测图中的社区结构，自动识别紧密连接的节点群组。

**使用方法**:
```javascript
const communities = await graphStore.detectCommunities();
// 返回: Map<nodeId, communityId>
```

**API**:
- IPC: `graph:detect-communities`
- 参数: `(nodes, edges)`
- 返回: `Map<nodeId, communityId>`

#### 1.3 节点聚类

使用 K-means 算法基于节点特征（度、聚类系数等）进行聚类。

**使用方法**:
```javascript
const clusters = await graphStore.clusterNodes(5); // k=5
// 返回: Map<nodeId, clusterId>
```

**API**:
- IPC: `graph:cluster-nodes`
- 参数: `(nodes, edges, k)`
- 返回: `Map<nodeId, clusterId>`

#### 1.4 关键节点识别

综合多个指标（度中心性、PageRank）识别最重要的节点。

**使用方法**:
```javascript
const keyNodes = await graphStore.findKeyNodes(10); // top 10
// 返回: Array<{id, title, score, degree, pageRank}>
```

**API**:
- IPC: `graph:find-key-nodes`
- 参数: `(nodes, edges, topN)`
- 返回: `Array<KeyNode>`

#### 1.5 图谱统计分析

计算图的各种统计指标：

- 节点数、边数
- 图密度
- 平均度、最大度、最小度
- 连通分量数量
- 平均聚类系数

**使用方法**:
```javascript
const stats = await graphStore.analyzeGraphStats();
// 返回: {nodeCount, edgeCount, density, avgDegree, ...}
```

**API**:
- IPC: `graph:analyze-stats`
- 参数: `(nodes, edges)`
- 返回: `GraphStats`

### 2. 3D 可视化 (3D Visualization)

基于 ECharts GL 的 3D 力导向图可视化。

**特性**:
- 3D 空间中的节点和边渲染
- 自动旋转功能
- 多视角切换（俯视、侧视、正视）
- 交互式缩放和旋转
- 节点点击和详情显示

**使用方法**:
```vue
<template>
  <GraphCanvas3D
    :nodes="nodes"
    :edges="edges"
    @node-click="handleNodeClick"
    @switch-to-2d="switchTo2D"
  />
</template>

<script setup>
import GraphCanvas3D from '@/components/graph/GraphCanvas3D.vue';
</script>
```

**组件位置**: `src/renderer/components/graph/GraphCanvas3D.vue`

**依赖**: 需要安装 `echarts-gl`
```bash
npm install echarts-gl
```

### 3. 智能实体提取 (Entity Extraction)

使用 NLP 技术从笔记内容中自动提取实体和关系。

#### 3.1 支持的实体类型

- **person**: 人名
- **organization**: 组织机构
- **location**: 地点
- **date**: 日期
- **time**: 时间
- **concept**: 概念
- **technology**: 技术
- **product**: 产品
- **event**: 事件

#### 3.2 支持的关系类型

- **mentions**: 提及
- **related_to**: 相关
- **part_of**: 部分
- **caused_by**: 因果
- **located_in**: 位于
- **works_for**: 工作于
- **created_by**: 创建者
- **uses**: 使用

#### 3.3 提取方法

**基于规则的提取** (不需要 LLM):
```javascript
const { entities } = await window.electronAPI.graph.extractEntities(text, false);
```

**基于 LLM 的提取** (更准确):
```javascript
const { entities, relations } = await window.electronAPI.graph.extractEntities(text, true);
```

#### 3.4 关键词提取

使用 TF-IDF 算法提取文本关键词：
```javascript
const keywords = await window.electronAPI.graph.extractKeywords(text, 10);
// 返回: Array<{word, frequency, score}>
```

#### 3.5 批量处理

批量处理多个笔记，提取实体和关系：
```javascript
const results = await window.electronAPI.graph.processNotesEntities(notes, true);
// 返回: Array<{noteId, entities, relations, keywords, wikiLinks, summary}>
```

#### 3.6 构建实体图

基于提取的实体构建知识图谱：
```javascript
const entityGraph = await window.electronAPI.graph.buildEntityGraph(processedNotes);
// 返回: {nodes, edges}
```

**API**:
- `graph:extract-entities` - 提取实体
- `graph:extract-keywords` - 提取关键词
- `graph:process-notes-entities` - 批量处理笔记
- `graph:build-entity-graph` - 构建实体图

### 4. 多格式导出 (Export)

支持将知识图谱导出为多种格式。

#### 4.1 支持的格式

1. **JSON** (.json)
   - 标准 JSON 格式
   - 包含节点和边的完整信息
   - 适合程序处理和数据交换

2. **GraphML** (.graphml)
   - Gephi 兼容格式
   - XML 格式，包含节点和边属性
   - 适合导入专业图分析工具

3. **GEXF** (.gexf)
   - Gephi 原生格式
   - 支持动态图和层次结构
   - 适合复杂图分析

4. **DOT** (.dot)
   - Graphviz 格式
   - 文本格式，易于编辑
   - 适合生成高质量图形

5. **CSV** (.csv)
   - 分别导出节点和边
   - 适合 Excel 和数据分析
   - 生成两个文件：`*_nodes.csv` 和 `*_edges.csv`

6. **HTML** (.html)
   - 交互式网页
   - 包含 ECharts 可视化
   - 可直接在浏览器中打开和分享

#### 4.2 使用方法

```javascript
const graphStore = useGraphStore();

// 导出为 JSON
const result = await graphStore.exportGraph('json');
console.log('导出到:', result.path);

// 导出为交互式 HTML
await graphStore.exportGraph('html');

// 导出为 GraphML (Gephi)
await graphStore.exportGraph('graphml');
```

**API**:
- IPC: `graph:export-graph`
- 参数: `(nodes, edges, format)`
- 返回: `{path, files?}`

#### 4.3 导出文件示例

**JSON 格式**:
```json
{
  "nodes": [
    {
      "id": "note-1",
      "title": "React 学习笔记",
      "type": "note",
      "created_at": "2025-01-12T10:00:00Z"
    }
  ],
  "edges": [
    {
      "source": "note-1",
      "target": "note-2",
      "type": "link",
      "weight": 1.0
    }
  ]
}
```

**GraphML 格式**:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<graphml xmlns="http://graphml.graphdrawing.org/xmlns">
  <key id="d0" for="node" attr.name="title" attr.type="string"/>
  <graph id="G" edgedefault="directed">
    <node id="note-1">
      <data key="d0">React 学习笔记</data>
    </node>
    <edge id="e0" source="note-1" target="note-2"/>
  </graph>
</graphml>
```

## 文件结构

```
desktop-app-vue/
├── src/
│   ├── main/
│   │   └── knowledge-graph/
│   │       ├── graph-analytics.js      # 图分析算法
│   │       ├── graph-export.js         # 导出功能
│   │       ├── entity-extraction.js    # 实体提取
│   │       └── graph-ipc.js            # IPC 处理器 (21个)
│   └── renderer/
│       ├── components/
│       │   └── graph/
│       │       ├── GraphCanvasOptimized.vue  # 2D 可视化
│       │       ├── GraphCanvas3D.vue         # 3D 可视化
│       │       └── GraphAnalyticsPanel.vue   # 分析面板
│       ├── pages/
│       │   └── KnowledgeGraphPage.vue        # 主页面
│       └── stores/
│           └── graph.js                      # Pinia store
```

## 性能优化

### 1. 图渲染优化

- **节点聚合**: 大图自动聚合低重要度节点
- **LOD (Level of Detail)**: 根据节点数量调整渲染详细度
- **渐进渲染**: 分批渲染大量节点，避免卡顿
- **FPS 监控**: 实时监控渲染性能

### 2. 算法优化

- **缓存**: 中心性计算结果缓存
- **并行处理**: 批量实体提取支持并行
- **增量更新**: 图数据增量更新，避免全量重建

### 3. 内存优化

- **按需加载**: 只加载可见区域的节点
- **数据压缩**: 大图数据压缩存储
- **垃圾回收**: 及时清理不用的数据

## 使用示例

### 完整工作流程

```javascript
import { useGraphStore } from '@/stores/graph';

const graphStore = useGraphStore();

// 1. 加载图谱数据
await graphStore.loadGraphData({
  relationTypes: ['link', 'tag', 'semantic'],
  limit: 500
});

// 2. 分析图谱
const stats = await graphStore.analyzeGraphStats();
console.log('图谱统计:', stats);

// 3. 查找关键节点
const keyNodes = await graphStore.findKeyNodes(10);
console.log('关键节点:', keyNodes);

// 4. 社区检测
const communities = await graphStore.detectCommunities();
console.log('社区数量:', new Set(communities.values()).size);

// 5. 导出图谱
await graphStore.exportGraph('html');
```

### 实体提取工作流程

```javascript
// 1. 获取所有笔记
const notes = await window.electronAPI.knowledge.getAllNotes();

// 2. 批量提取实体
const processedNotes = await window.electronAPI.graph.processNotesEntities(
  notes,
  true // 使用 LLM
);

// 3. 构建实体图
const entityGraph = await window.electronAPI.graph.buildEntityGraph(processedNotes);

// 4. 可视化实体图
graphStore.nodes = entityGraph.nodes;
graphStore.edges = entityGraph.edges;
```

## 配置选项

### 图分析配置

```javascript
// PageRank 配置
const pageRank = calculatePageRank(nodes, edges, {
  dampingFactor: 0.85,    // 阻尼系数
  maxIterations: 100,     // 最大迭代次数
  tolerance: 1e-6         // 收敛阈值
});

// K-means 聚类配置
const clusters = clusterNodes(nodes, edges, {
  k: 5,                   // 聚类数量
  maxIterations: 100      // 最大迭代次数
});
```

### 可视化配置

```javascript
// 2D 图配置
const graphConfig = {
  layout: 'force',        // force, circular, hierarchical
  enableClustering: true, // 启用节点聚合
  enableProgressive: true,// 启用渐进渲染
  lodConfig: {
    maxNodesForFull: 200,
    clusterThreshold: 1000
  }
};

// 3D 图配置
const graph3DConfig = {
  autoRotate: true,       // 自动旋转
  autoRotateSpeed: 10,    // 旋转速度
  distance: 300,          // 相机距离
  viewAngle: {
    alpha: 40,
    beta: 40
  }
};
```

## 故障排除

### 常见问题

1. **3D 可视化不显示**
   - 确保已安装 `echarts-gl`: `npm install echarts-gl`
   - 检查浏览器 WebGL 支持

2. **LLM 实体提取失败**
   - 检查 LLM 服务是否运行
   - 确认 API 密钥配置正确
   - 回退到基于规则的提取

3. **大图渲染卡顿**
   - 启用节点聚合
   - 减少显示的节点数量
   - 使用渐进渲染

4. **导出失败**
   - 检查文件写入权限
   - 确认磁盘空间充足
   - 查看控制台错误日志

## 未来计划

- [ ] 时间轴可视化（显示笔记的时间演化）
- [ ] 热力图可视化（显示关系强度分布）
- [ ] 更多图布局算法（树形、径向等）
- [ ] 图动画和过渡效果
- [ ] 协作功能（多人共享图谱）
- [ ] 移动端适配
- [ ] 更多 NLP 功能（情感分析、主题建模）

## 参考资料

- [ECharts 文档](https://echarts.apache.org/)
- [ECharts GL 文档](https://github.com/ecomfe/echarts-gl)
- [Gephi 文档](https://gephi.org/)
- [Graphviz 文档](https://graphviz.org/)
- [PageRank 算法](https://en.wikipedia.org/wiki/PageRank)
- [Louvain 算法](https://en.wikipedia.org/wiki/Louvain_method)

## 贡献

欢迎提交 Issue 和 Pull Request！

## 许可证

MIT License
