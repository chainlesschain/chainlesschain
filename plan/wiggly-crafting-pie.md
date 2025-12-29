# 知识图谱可视化实现计划

## 目标概述

为ChainlessChain知识库系统添加交互式知识图谱可视化功能，支持4种关系类型展示和丰富的交互操作。

**核心需求：**
- 关系类型：链接引用、标签分类、AI语义关系、时间序列
- 可视化：ECharts关系图
- 交互：拖拽缩放、详情查看、路径高亮、搜索过滤

## 一、数据库设计（database.js）

### 1.1 新增关系表

```sql
-- 笔记关系表
CREATE TABLE IF NOT EXISTS knowledge_relations (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  relation_type TEXT NOT NULL CHECK(relation_type IN ('link', 'tag', 'semantic', 'temporal')),
  weight REAL DEFAULT 1.0,
  metadata TEXT,  -- JSON格式，存储额外信息
  created_at INTEGER NOT NULL,
  FOREIGN KEY (source_id) REFERENCES knowledge_items(id) ON DELETE CASCADE,
  FOREIGN KEY (target_id) REFERENCES knowledge_items(id) ON DELETE CASCADE,
  UNIQUE(source_id, target_id, relation_type)
);

-- 索引优化
CREATE INDEX IF NOT EXISTS idx_kr_source ON knowledge_relations(source_id);
CREATE INDEX IF NOT EXISTS idx_kr_target ON knowledge_relations(target_id);
CREATE INDEX IF NOT EXISTS idx_kr_type ON knowledge_relations(relation_type);
CREATE INDEX IF NOT EXISTS idx_kr_weight ON knowledge_relations(weight DESC);
```

**字段说明：**
- `relation_type`:
  - `link`: 链接引用（[[wikilink]]或markdown链接）
  - `tag`: 标签共享关系
  - `semantic`: AI提取的语义关系
  - `temporal`: 时间序列关系
- `weight`: 关系强度（0.0-1.0），用于图谱渲染和过滤
- `metadata`: JSON格式，存储如引用位置、语义得分等

### 1.2 数据库方法新增

在 `DatabaseManager` 类中添加：

```javascript
// 获取图谱数据
getGraphData(options = {}) {
  const { relationTypes, minWeight, limit } = options;
  // 查询笔记节点
  // 查询关系边
  // 返回 { nodes: [...], edges: [...] }
}

// 添加关系
addRelation(sourceId, targetId, type, weight, metadata)

// 批量更新关系
updateRelations(relations)

// 获取笔记的所有关系
getKnowledgeRelations(knowledgeId)

// 查找关系路径（BFS）
findRelationPath(sourceId, targetId, maxDepth = 3)
```

## 二、关系提取逻辑

### 2.1 链接引用提取（新建 graph-extractor.js）

**文件位置：** `src/main/graph/graph-extractor.js`

```javascript
class GraphExtractor {
  // 提取 [[wikilink]]
  extractWikiLinks(content) {
    const regex = /\[\[(.*?)\]\]/g;
    return Array.from(content.matchAll(regex)).map(m => m[1]);
  }

  // 提取 markdown 链接
  extractMarkdownLinks(content) {
    const regex = /\[([^\]]+)\]\(([^)]+)\)/g;
    // 过滤内部链接
  }

  // 批量构建链接关系
  async buildLinkRelations(knowledgeId) {
    // 1. 读取笔记内容
    // 2. 提取所有链接
    // 3. 查询目标笔记ID
    // 4. 批量插入关系表
  }
}
```

### 2.2 标签关系转换

利用现有 `knowledge_tags` 表，构建共享标签的笔记关系：

```javascript
// 在 database.js 中添加
async buildTagRelations() {
  // 查询: SELECT k1.knowledge_id as source, k2.knowledge_id as target,
  //        COUNT(*) as shared_tags
  //       FROM knowledge_tags k1
  //       JOIN knowledge_tags k2 ON k1.tag_id = k2.tag_id
  //       WHERE k1.knowledge_id < k2.knowledge_id
  //       GROUP BY k1.knowledge_id, k2.knowledge_id
  // 插入到 knowledge_relations (type='tag', weight=shared_tags/max_tags)
}
```

### 2.3 AI语义关系（利用RAG）

**文件：** `src/main/rag/semantic-relations.js`

```javascript
class SemanticRelationExtractor {
  constructor(ragManager) {
    this.ragManager = ragManager;
  }

  async extractSemanticRelations(knowledgeId, topK = 5) {
    // 1. 获取笔记的embedding
    const item = await db.getKnowledgeItemById(knowledgeId);

    // 2. 向量搜索最相关的笔记
    const similar = await this.ragManager.vectorSearch(item.content, topK + 1);

    // 3. 过滤自身，计算相似度作为weight
    // 4. 插入 knowledge_relations (type='semantic')
  }
}
```

### 2.4 时间序列关系

基于 `created_at` / `updated_at` 构建时序链：

```javascript
async buildTemporalRelations(windowDays = 7) {
  // 查询：相邻时间窗口内的笔记
  // 关系方向：早→晚
  // weight：时间接近度（1 / 时间差天数）
}
```

## 三、后端IPC接口

### 3.1 新增IPC Handlers（index.js）

```javascript
// 获取图谱数据
ipcMain.handle('graph:get-data', async (_event, options) => {
  try {
    return await this.database.getGraphData(options);
  } catch (error) {
    console.error('[Main] 获取图谱数据失败:', error);
    return { nodes: [], edges: [] };
  }
});

// 构建/更新关系
ipcMain.handle('graph:build-relations', async (_event, types = ['link', 'tag']) => {
  try {
    const graphExtractor = new GraphExtractor(this.database);
    const results = {};

    if (types.includes('link')) {
      results.link = await graphExtractor.buildAllLinkRelations();
    }
    if (types.includes('tag')) {
      results.tag = await this.database.buildTagRelations();
    }
    if (types.includes('semantic')) {
      const semanticExtractor = new SemanticRelationExtractor(this.ragManager);
      results.semantic = await semanticExtractor.buildAllRelations();
    }
    if (types.includes('temporal')) {
      results.temporal = await this.database.buildTemporalRelations();
    }

    return { success: true, results };
  } catch (error) {
    console.error('[Main] 构建关系失败:', error);
    throw error;
  }
});

// 查找关系路径
ipcMain.handle('graph:find-path', async (_event, sourceId, targetId, maxDepth) => {
  try {
    return await this.database.findRelationPath(sourceId, targetId, maxDepth);
  } catch (error) {
    console.error('[Main] 查找路径失败:', error);
    return null;
  }
});

// 获取节点邻居
ipcMain.handle('graph:get-neighbors', async (_event, knowledgeId, depth = 1) => {
  try {
    return await this.database.getKnowledgeNeighbors(knowledgeId, depth);
  } catch (error) {
    console.error('[Main] 获取邻居失败:', error);
    return { nodes: [], edges: [] };
  }
});
```

### 3.2 Preload API 暴露（preload/index.js）

```javascript
graph: {
  getData: (options) => ipcRenderer.invoke('graph:get-data', options),
  buildRelations: (types) => ipcRenderer.invoke('graph:build-relations', types),
  findPath: (sourceId, targetId, maxDepth) =>
    ipcRenderer.invoke('graph:find-path', sourceId, targetId, maxDepth),
  getNeighbors: (knowledgeId, depth) =>
    ipcRenderer.invoke('graph:get-neighbors', knowledgeId, depth),
}
```

## 四、前端组件设计

### 4.1 页面结构

**新建页面：** `src/renderer/pages/KnowledgeGraphPage.vue`

```vue
<template>
  <div class="knowledge-graph-page">
    <!-- 顶部工具栏 -->
    <GraphToolbar
      @filter-change="handleFilterChange"
      @search="handleSearch"
      @build-relations="handleBuildRelations"
    />

    <!-- 主图谱区域 -->
    <div class="graph-container">
      <GraphCanvas
        ref="graphCanvas"
        :data="graphData"
        :options="graphOptions"
        @node-click="handleNodeClick"
        @node-hover="handleNodeHover"
      />
    </div>

    <!-- 右侧详情面板 -->
    <GraphDetailPanel
      v-if="selectedNode"
      :node="selectedNode"
      :neighbors="nodeNeighbors"
      @close="selectedNode = null"
      @highlight-path="handleHighlightPath"
    />

    <!-- 图例和统计 -->
    <GraphLegend :relation-types="relationTypes" />
    <GraphStats :data="graphData" />
  </div>
</template>
```

### 4.2 核心组件

#### 4.2.1 GraphCanvas.vue（ECharts图谱渲染）

```vue
<script setup>
import * as echarts from 'echarts';
import { ref, onMounted, watch } from 'vue';

const props = defineProps(['data', 'options']);
const emit = defineEmits(['node-click', 'node-hover']);

const chartRef = ref(null);
let chartInstance = null;

const initChart = () => {
  chartInstance = echarts.init(chartRef.value);

  const option = {
    tooltip: {},
    series: [{
      type: 'graph',
      layout: 'force',
      data: props.data.nodes.map(node => ({
        id: node.id,
        name: node.title,
        value: node.value,
        category: node.type,
        symbolSize: calculateNodeSize(node),
      })),
      links: props.data.edges.map(edge => ({
        source: edge.source,
        target: edge.target,
        lineStyle: {
          color: getEdgeColor(edge.type),
          width: edge.weight * 3,
        },
      })),
      categories: [
        { name: 'note' },
        { name: 'document' },
        { name: 'conversation' },
      ],
      roam: true,  // 拖拽缩放
      label: {
        show: true,
        position: 'right',
      },
      force: {
        repulsion: 1000,
        edgeLength: [50, 200],
      },
    }],
  };

  chartInstance.setOption(option);

  // 事件监听
  chartInstance.on('click', params => {
    if (params.dataType === 'node') {
      emit('node-click', params.data);
    }
  });
};

onMounted(() => initChart());
watch(() => props.data, () => chartInstance?.setOption({...}));
</script>

<template>
  <div ref="chartRef" class="graph-canvas"></div>
</template>
```

#### 4.2.2 GraphToolbar.vue（工具栏）

功能：
- 关系类型过滤（多选框）
- 权重阈值滑块
- 搜索框（节点搜索）
- 布局算法选择（力导向、环形、层次）
- 构建/刷新关系按钮
- 导出图片按钮

#### 4.2.3 GraphDetailPanel.vue（详情面板）

显示内容：
- 笔记标题、类型、创建时间
- 内容预览（前200字）
- 关系统计（入度、出度）
- 相邻节点列表（可点击高亮）
- "在编辑器中打开"按钮
- "显示路径"功能

### 4.3 路由配置（router/index.js）

在 `routes[1].children` 数组中添加（第186行附近，知识模块区域）：

```javascript
// 知识模块
{
  path: 'knowledge/list',
  name: 'KnowledgeList',
  component: () => import('../pages/KnowledgeListPage.vue'),
  meta: { title: '我的知识' },
},
// 👇 新增知识图谱路由
{
  path: 'knowledge/graph',
  name: 'KnowledgeGraph',
  component: () => import('../pages/KnowledgeGraphPage.vue'),
  meta: { requiresAuth: true, title: '知识图谱' }
},
{
  path: 'knowledge/:id',
  name: 'KnowledgeDetail',
  component: () => import('../pages/KnowledgeDetailPage.vue'),
},
```

### 4.4 菜单集成（MainLayout.vue）

在 `知识与AI` 子菜单中添加（第63-98行）：

```vue
<a-sub-menu key="knowledge">
  <template #icon><FileTextOutlined /></template>
  <template #title>知识与AI</template>
  <!-- ... 现有菜单项 ... -->
  <a-menu-item key="knowledge-list">
    <template #icon><FileTextOutlined /></template>
    我的知识
  </a-menu-item>
  <!-- 👇 新增知识图谱菜单项 -->
  <a-menu-item key="knowledge-graph">
    <template #icon><NodeIndexOutlined /></template>
    知识图谱
  </a-menu-item>
  <a-menu-item key="file-import">
    <template #icon><CloudUploadOutlined /></template>
    文件导入
  </a-menu-item>
  <!-- ... 其他菜单项 ... -->
</a-sub-menu>
```

**需要导入的图标**（在 MainLayout.vue 顶部）：
```javascript
import { NodeIndexOutlined } from '@ant-design/icons-vue';
```

**菜单点击处理**（已有的 `handleMenuClick` 方法）：
```javascript
const menuRouteMap = {
  // ... 现有映射 ...
  'knowledge-list': '/knowledge/list',
  'knowledge-graph': '/knowledge/graph',  // 新增
  'ai-chat': '/ai/chat',
  // ...
};
```

### 4.4 Pinia Store（stores/graph.js）

```javascript
export const useGraphStore = defineStore('graph', {
  state: () => ({
    graphData: { nodes: [], edges: [] },
    selectedNode: null,
    highlightedPath: [],
    filters: {
      relationTypes: ['link', 'tag', 'semantic', 'temporal'],
      minWeight: 0.1,
      nodeTypes: ['note', 'document'],
    },
    isBuilding: false,
  }),

  actions: {
    async fetchGraphData() {
      const data = await window.electronAPI.graph.getData(this.filters);
      this.graphData = data;
    },

    async buildRelations(types) {
      this.isBuilding = true;
      await window.electronAPI.graph.buildRelations(types);
      await this.fetchGraphData();
      this.isBuilding = false;
    },

    async highlightPath(sourceId, targetId) {
      const path = await window.electronAPI.graph.findPath(sourceId, targetId, 3);
      this.highlightedPath = path;
    },
  },
});
```

## 五、交互功能实现细节

### 5.1 节点拖拽和缩放

ECharts内置支持，配置项：
```javascript
series: [{
  type: 'graph',
  roam: true,  // 启用拖拽和缩放
  draggable: true,  // 节点可拖动
}]
```

### 5.2 点击查看详情

- 使用 Ant Design Vue 的 `<a-drawer>` 组件
- 从右侧滑出
- 显示笔记详情和操作按钮

### 5.3 路径高亮算法

```javascript
function highlightPath(chart, path) {
  const pathNodeIds = new Set(path.nodes.map(n => n.id));
  const pathEdgeIds = new Set(path.edges.map(e => `${e.source}-${e.target}`));

  chart.setOption({
    series: [{
      data: chart.getOption().series[0].data.map(node => ({
        ...node,
        itemStyle: {
          opacity: pathNodeIds.has(node.id) ? 1 : 0.2,
        },
      })),
      links: chart.getOption().series[0].links.map(link => ({
        ...link,
        lineStyle: {
          ...link.lineStyle,
          opacity: pathEdgeIds.has(`${link.source}-${link.target}`) ? 1 : 0.1,
          width: pathEdgeIds.has(`${link.source}-${link.target}`)
            ? link.lineStyle.width * 1.5
            : link.lineStyle.width,
        },
      })),
    }],
  });
}
```

### 5.4 搜索和过滤UI

- 搜索：输入框实时匹配节点标题，高亮显示
- 过滤：
  - 关系类型：4个复选框
  - 节点类型：笔记/文档/对话/网页剪藏
  - 权重阈值：滑块（0.0-1.0）
  - 时间范围：日期选择器

## 六、实现步骤（MVP优先）

### 阶段1：核心基础（MVP）
1. ✅ 数据库表结构（knowledge_relations）
2. ✅ 链接引用提取（GraphExtractor.extractWikiLinks）
3. ✅ 标签关系转换（buildTagRelations）
4. ✅ 基础IPC接口（graph:get-data, graph:build-relations）
5. ✅ GraphCanvas组件（ECharts基础图谱）
6. ✅ KnowledgeGraphPage页面框架
7. ✅ 路由和菜单集成

**测试目标：** 能看到笔记节点和链接/标签关系

### 阶段2：交互增强
1. 节点点击详情面板（GraphDetailPanel）
2. 工具栏过滤功能（GraphToolbar）
3. 节点搜索和高亮
4. 路径查找和高亮显示

**测试目标：** 交互流畅，能查看详情和过滤

### 阶段3：高级功能
1. AI语义关系提取（SemanticRelationExtractor）
2. 时间序列关系构建
3. 图例和统计面板
4. 布局算法切换（力导向/环形/层次）
5. 导出图片功能

**测试目标：** 完整功能可用

### 阶段4：优化和体验
1. 性能优化（大规模图谱渲染）
2. 增量更新（笔记修改时自动更新关系）
3. 动画效果（节点出现、路径动画）
4. 快捷键支持

## 七、关键文件清单

### 新建文件
- `src/main/graph/graph-extractor.js` - 关系提取逻辑
- `src/main/rag/semantic-relations.js` - AI语义关系
- `src/renderer/pages/KnowledgeGraphPage.vue` - 主页面
- `src/renderer/components/graph/GraphCanvas.vue` - 图谱画布
- `src/renderer/components/graph/GraphToolbar.vue` - 工具栏
- `src/renderer/components/graph/GraphDetailPanel.vue` - 详情面板
- `src/renderer/components/graph/GraphLegend.vue` - 图例
- `src/renderer/components/graph/GraphStats.vue` - 统计面板
- `src/renderer/stores/graph.js` - 图谱状态管理

### 修改文件
- `src/main/database.js` - 添加表和方法
- `src/main/index.js` - 添加IPC handlers
- `src/preload/index.js` - 暴露graph API
- `src/renderer/router/index.js` - 添加路由
- `src/renderer/components/MainLayout.vue` - 添加菜单项

## 八、技术难点和解决方案

### 8.1 大规模图谱性能

**问题：** 1000+节点时渲染卡顿

**解决方案：**
- ECharts数据抽样（sample配置）
- 按需加载：初始只显示核心节点，点击展开邻居
- Web Worker 计算布局
- 虚拟化技术（只渲染可见区域）

### 8.2 关系权重计算

**问题：** 如何准确量化关系强度

**解决方案：**
- 链接：固定权重1.0
- 标签：共享标签数 / max(源标签数, 目标标签数)
- 语义：余弦相似度（RAG向量）
- 时序：1 / (1 + 时间差天数)

### 8.3 实时更新

**问题：** 笔记修改后如何增量更新图谱

**解决方案：**
- 监听数据库变更（SQLite触发器或应用层）
- IPC事件通知：`graph:relations-updated`
- 前端增量更新：只修改变化的节点/边

### 8.4 路径查找性能

**问题：** 深度搜索可能很慢

**解决方案：**
- BFS算法，限制最大深度（默认3）
- 缓存常见路径查询
- 异步计算，显示加载进度

## 九、依赖检查

- ✅ ECharts 6.0.0（已安装）
- ✅ Vue 3 + Composition API
- ✅ Ant Design Vue 4.1
- ✅ Pinia 2.1.7
- ✅ RAG Manager（已有）
- ✅ SQLite + SQLCipher

**无需新增npm依赖**

## 十、测试策略

### 单元测试
- 关系提取函数（wikilink解析）
- 权重计算逻辑
- 路径查找算法

### 集成测试
- IPC通信
- 数据库CRUD
- 图谱数据查询性能

### E2E测试
- 页面加载和渲染
- 交互流程（点击、拖拽、搜索）
- 大数据集测试（1000+笔记）

---

## 总结

这个实现计划采用**分阶段迭代**策略，优先交付MVP（基础图谱展示），然后逐步增强交互和高级功能。整体架构充分利用了现有的数据库、RAG和ECharts基础设施，避免引入新依赖，降低技术风险。

预计开发时间：
- 阶段1（MVP）：核心开发
- 阶段2（交互）：增强体验
- 阶段3（高级）：完整功能
- 阶段4（优化）：性能和细节

关键成功因素：
1. 数据库关系表设计合理（支持4种类型）
2. 关系提取准确（特别是wikilink解析）
3. ECharts配置优化（大规模图谱性能）
4. 交互体验流畅（响应迅速）
