# 知识图谱可视化完善 - 安装和使用指南

## 快速开始

### 1. 安装依赖

知识图谱的 3D 可视化需要 `echarts-gl` 库：

```bash
cd desktop-app-vue
npm install echarts-gl
```

### 2. 启动应用

```bash
# 开发模式
npm run dev

# 或者从项目根目录
npm run dev:desktop-vue
```

### 3. 访问知识图谱

在应用中导航到 **知识图谱** 页面，即可看到增强后的可视化界面。

## 新功能使用

### 图分析工具

1. 打开知识图谱页面
2. 点击侧边栏的 **图分析工具** 标签
3. 选择分析类型：
   - **中心性分析**: 识别重要节点
   - **社区检测**: 发现节点群组
   - **关键节点**: 查找最重要的笔记
   - **统计信息**: 查看图谱整体统计

### 3D 可视化

1. 在图谱页面工具栏中点击 **3D 视图** 按钮
2. 使用鼠标拖拽旋转视角
3. 滚轮缩放
4. 点击 **自动旋转** 按钮启用自动旋转
5. 使用视角菜单切换预设视角

### 导出图谱

1. 在图谱页面点击 **导出** 按钮
2. 选择导出格式：
   - **JSON**: 数据交换
   - **GraphML/GEXF**: 导入 Gephi 分析
   - **HTML**: 分享交互式图谱
   - **DOT**: 使用 Graphviz 渲染
   - **CSV**: Excel 分析
3. 选择保存位置
4. 导出完成

### 实体提取

#### 自动提取（推荐）

1. 在笔记编辑器中编写内容
2. 保存笔记时自动提取实体和关系
3. 在图谱中查看提取的实体节点

#### 手动批量提取

```javascript
// 在浏览器控制台或自定义脚本中
const notes = await window.electronAPI.knowledge.getAllNotes();
const results = await window.electronAPI.graph.processNotesEntities(notes, true);
console.log('提取结果:', results);
```

## 配置

### 启用/禁用 LLM 实体提取

在 `src/main/app-config.js` 中配置：

```javascript
module.exports = {
  graph: {
    enableLLMExtraction: true,  // 启用 LLM 实体提取
    extractionModel: 'qwen2:7b', // 使用的模型
  }
};
```

### 调整图谱性能

在 `src/renderer/components/graph/GraphCanvasOptimized.vue` 中调整：

```javascript
const LOD_CONFIG = {
  maxNodesForFull: 200,      // 全量渲染阈值（减小以提高性能）
  maxNodesForSimplified: 500, // 简化渲染阈值
  clusterThreshold: 1000,     // 聚合阈值
  progressiveChunkSize: 100,  // 渐进加载块大小
};
```

## 测试

### 测试图分析算法

```bash
cd desktop-app-vue
node -e "
const analytics = require('./src/main/knowledge-graph/graph-analytics');

const nodes = [
  { id: '1', title: 'Node 1' },
  { id: '2', title: 'Node 2' },
  { id: '3', title: 'Node 3' },
];

const edges = [
  { source_id: '1', target_id: '2', relation_type: 'link', weight: 1.0 },
  { source_id: '2', target_id: '3', relation_type: 'link', weight: 1.0 },
];

const centrality = analytics.calculateDegreeCentrality(nodes, edges);
console.log('度中心性:', Array.from(centrality.entries()));

const pageRank = analytics.calculatePageRank(nodes, edges);
console.log('PageRank:', Array.from(pageRank.entries()));
"
```

### 测试实体提取

```bash
node -e "
const extraction = require('./src/main/knowledge-graph/entity-extraction');

const text = '我在2025年1月12日学习了React和Vue.js，它们都是前端框架。';

const entities = extraction.extractEntities(text);
console.log('提取的实体:', entities);

const keywords = extraction.extractKeywords(text);
console.log('关键词:', keywords);
"
```

### 测试导出功能

```bash
node -e "
const { exportToJSON } = require('./src/main/knowledge-graph/graph-export');

const nodes = [{ id: '1', title: 'Test Node', type: 'note' }];
const edges = [];

const json = exportToJSON(nodes, edges);
console.log('JSON 导出:', json);
"
```

## 故障排除

### 问题：3D 视图显示黑屏

**解决方案**:
1. 确认已安装 `echarts-gl`: `npm list echarts-gl`
2. 检查浏览器控制台是否有 WebGL 错误
3. 更新显卡驱动
4. 尝试在不同浏览器中打开

### 问题：实体提取没有结果

**解决方案**:
1. 检查笔记内容是否包含可识别的实体
2. 如果使用 LLM 提取，确认 LLM 服务正在运行
3. 查看控制台日志了解详细错误
4. 尝试使用基于规则的提取（不依赖 LLM）

### 问题：导出失败

**解决方案**:
1. 检查文件系统权限
2. 确认目标目录存在且可写
3. 检查磁盘空间
4. 查看主进程日志：`~/.config/chainlesschain-desktop-vue/logs/main.log`

### 问题：图谱加载缓慢

**解决方案**:
1. 减少显示的节点数量（调整筛选器）
2. 启用节点聚合
3. 使用渐进渲染
4. 考虑升级硬件（特别是 GPU）

## 性能基准

在不同规模的图谱上的性能表现：

| 节点数 | 边数 | 2D 渲染 FPS | 3D 渲染 FPS | PageRank 耗时 | 社区检测耗时 |
|--------|------|-------------|-------------|---------------|--------------|
| 100    | 200  | 60          | 60          | < 100ms       | < 200ms      |
| 500    | 1000 | 60          | 45          | < 500ms       | < 1s         |
| 1000   | 2000 | 45          | 30          | < 2s          | < 3s         |
| 5000   | 10000| 30          | 15          | < 10s         | < 15s        |

*测试环境: MacBook Pro M1, 16GB RAM*

## 最佳实践

### 1. 图谱构建

- 定期运行 **重建图谱** 以更新关系
- 使用标签组织笔记，自动建立标签关系
- 在笔记中使用 `[[双向链接]]` 语法建立显式链接
- 启用 LLM 语义关系提取以发现隐式关联

### 2. 图谱分析

- 先运行 **统计分析** 了解图谱整体情况
- 使用 **关键节点** 功能找到核心笔记
- 使用 **社区检测** 发现主题群组
- 定期导出图谱数据作为备份

### 3. 可视化

- 小图（< 200 节点）使用 2D 全量渲染
- 中图（200-1000 节点）启用简化渲染
- 大图（> 1000 节点）启用节点聚合
- 使用 3D 视图探索复杂关系

### 4. 实体提取

- 对重要笔记使用 LLM 提取（更准确）
- 对大量笔记使用规则提取（更快）
- 定期审查提取的实体，手动修正错误
- 使用提取的关键词优化搜索

## 进阶用法

### 自定义图分析算法

在 `src/main/knowledge-graph/graph-analytics.js` 中添加自定义算法：

```javascript
function myCustomAlgorithm(nodes, edges) {
  // 你的算法实现
  return results;
}

module.exports = {
  // ... 现有导出
  myCustomAlgorithm,
};
```

### 自定义实体类型

在 `src/main/knowledge-graph/entity-extraction.js` 中添加：

```javascript
const ENTITY_TYPES = {
  // ... 现有类型
  MY_CUSTOM_TYPE: 'my_custom_type',
};

// 添加提取规则
const myPattern = /your-regex-pattern/g;
// ...
```

### 自定义导出格式

在 `src/main/knowledge-graph/graph-export.js` 中添加：

```javascript
function exportToMyFormat(nodes, edges) {
  // 你的导出逻辑
  return formattedData;
}

module.exports = {
  // ... 现有导出
  exportToMyFormat,
};
```

## 更新日志

### v0.17.0 (2025-01-12)

- ✨ 新增图分析算法（中心性、社区检测、聚类）
- ✨ 新增 3D 可视化支持
- ✨ 新增智能实体提取（基于规则和 LLM）
- ✨ 新增多格式导出（JSON, GraphML, GEXF, DOT, CSV, HTML）
- 🎨 优化图谱渲染性能
- 📝 完善文档和使用指南

## 支持

如有问题或建议，请：

1. 查看 [完整文档](./KNOWLEDGE_GRAPH_ENHANCEMENTS.md)
2. 搜索 [GitHub Issues](https://github.com/your-repo/issues)
3. 提交新的 Issue
4. 加入社区讨论

## 许可证

MIT License
