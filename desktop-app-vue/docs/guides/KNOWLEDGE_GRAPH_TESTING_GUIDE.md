# 知识图谱功能测试指南

## 功能概述

知识图谱功能已全部实现完成！该功能可以自动从笔记内容中提取关系，并以可视化图谱的形式展示笔记之间的连接。

## 实现进度：100% ✅

### 已完成的模块

#### 1. 后端层 (Backend)
- ✅ **数据库表** (`knowledge_relations`)
  - 支持 4 种关系类型：link、tag、semantic、temporal
  - 优化的索引：source_id、target_id、relation_type、weight

- ✅ **GraphExtractor** (`src/main/graph-extractor.js`)
  - Wiki 链接提取：`[[笔记标题]]` (权重 2.0)
  - Markdown 链接提取：`[文本](url)` (权重 1.5)
  - @mentions 提取：`@笔记标题` (权重 1.8)
  - 潜在链接建议
  - LLM 语义关系提取（可选）

- ✅ **Database API** (`src/main/database.js`)
  - `getGraphData()` - 获取图谱数据
  - `addRelation()` / `addRelations()` - 添加关系
  - `deleteRelations()` - 删除关系
  - `buildTagRelations()` - 构建标签关系
  - `buildTemporalRelations()` - 构建时间关系
  - `findRelatedNotes()` - 查找关联路径

- ✅ **IPC Handlers** (`src/main/index.js`)
  - 11 个 IPC 通道，覆盖所有图谱操作

#### 2. 前端层 (Frontend)
- ✅ **Pinia Store** (`src/renderer/stores/graph.js`)
  - 状态管理
  - 筛选选项
  - 统计信息

- ✅ **GraphCanvas 组件** (`src/renderer/components/graph/GraphCanvas.vue`)
  - ECharts 力导向图可视化
  - 3 种布局：力导向、环形、层级
  - 节点/边交互（点击、悬停）
  - 工具栏（刷新、缩放、布局切换）
  - 节点详情面板

- ✅ **主页面** (`src/renderer/pages/KnowledgeGraphPage.vue`)
  - 侧边栏控制面板
  - 统计信息展示
  - 筛选选项（关系类型、节点类型、权重、数量）
  - 操作按钮（重建图谱、重建关系、刷新）

- ✅ **路由集成**
  - 路由路径：`/knowledge/graph`
  - 菜单项：知识与AI > 知识图谱

---

## 测试步骤

### 前提条件
1. 确保已安装依赖：
   ```bash
   cd desktop-app-vue
   npm install
   ```

2. 确保 ECharts 已安装：
   ```bash
   npm install echarts
   ```

### 步骤 1: 启动应用
```bash
cd desktop-app-vue
npm run dev
```

### 步骤 2: 创建测试笔记

为了测试图谱功能，需要创建一些包含链接的笔记：

**笔记 1：Vue.js 学习笔记**
```markdown
# Vue.js 学习笔记

Vue.js 是一个渐进式框架，与 [[React]] 和 [[Angular]] 类似。

主要特点：
- 响应式数据绑定
- 组件化开发
- 虚拟 DOM

相关笔记：[[前端框架对比]]、[[JavaScript 基础]]
```

**笔记 2：React**
```markdown
# React 学习笔记

React 是 Facebook 开发的 UI 库。

与 [[Vue.js 学习笔记]] 的对比：
- 都使用虚拟 DOM
- 都支持组件化

参考：[[前端框架对比]]
```

**笔记 3：前端框架对比**
```markdown
# 前端框架对比

主流框架：
- [[Vue.js 学习笔记]]
- [[React]]
- [[Angular]]

推荐学习路径：先学 [[JavaScript 基础]]
```

**笔记 4：JavaScript 基础**
```markdown
# JavaScript 基础

JavaScript 是前端开发的基础。

建议学习：
- ES6+ 语法
- 异步编程
- 模块化

进阶：[[Vue.js 学习笔记]]、@前端框架对比
```

### 步骤 3: 导航到知识图谱页面

1. 点击左侧菜单：**知识与AI** > **知识图谱**
2. 或直接访问：`http://localhost:5173/#/knowledge/graph`

### 步骤 4: 构建图谱

1. 点击侧边栏的 **"重建图谱"** 按钮
2. 系统将：
   - 扫描所有笔记内容
   - 提取 `[[...]]` wiki 链接
   - 提取 `@...` mentions
   - 自动构建标签关系
   - 自动构建时间关系（7天窗口内）

3. 等待处理完成（会显示成功消息）

### 步骤 5: 验证功能

#### 5.1 图谱展示
- ✅ 图谱应显示所有笔记节点
- ✅ 节点之间应有连线表示关系
- ✅ 节点大小反映重要性（关联数）
- ✅ 不同颜色表示不同笔记类型

#### 5.2 交互功能
- ✅ **缩放**：鼠标滚轮缩放图谱
- ✅ **拖拽**：拖动节点改变位置
- ✅ **点击节点**：显示节点详情面板
- ✅ **悬停节点**：高亮显示关联节点和边

#### 5.3 筛选功能
在侧边栏调整筛选选项：
- ✅ 取消勾选某些关系类型（如"时间"），图谱应更新
- ✅ 调整最小权重滑块，低权重关系应被过滤
- ✅ 修改节点数量限制

#### 5.4 布局切换
点击工具栏的 **"布局"** 按钮：
- ✅ **力导向布局**：节点自动分散，关联节点靠近
- ✅ **环形布局**：节点呈圆形排列
- ✅ **层级布局**：节点按层级排列

#### 5.5 其他操作
- ✅ **重建标签关系**：点击侧边栏按钮，基于共享标签创建关系
- ✅ **重建时间关系**：基于时间接近度创建关系
- ✅ **刷新数据**：重新加载图谱数据

### 步骤 6: 查看统计信息

侧边栏顶部应显示：
- ✅ 节点数（应该 = 笔记数量）
- ✅ 关系数（总边数）
- ✅ 各类型关系数量（链接、标签、语义、时间）

---

## 常见问题排查

### 问题 1: 图谱为空

**可能原因：**
1. 笔记中没有使用 `[[...]]` 语法链接其他笔记
2. 笔记标题与链接文本不匹配

**解决方案：**
- 确保使用 `[[笔记标题]]` 格式，标题必须完全匹配
- 点击"重建图谱"按钮重新处理

### 问题 2: ECharts 报错

**可能原因：**
- ECharts 库未安装或版本不兼容

**解决方案：**
```bash
npm install echarts@latest
```

### 问题 3: 节点点击没反应

**可能原因：**
- 路由配置问题

**解决方案：**
- 检查 `KnowledgeDetail` 路由是否存在
- 查看浏览器控制台错误信息

### 问题 4: 数据库错误

**可能原因：**
- `knowledge_relations` 表未创建

**解决方案：**
- 删除 `data/chainlesschain.db` 文件重启应用（会重新初始化数据库）

---

## API 使用示例

如果需要在代码中手动调用图谱 API：

```javascript
// 在 Vue 组件中
import { useGraphStore } from '@/stores/graph';

const graphStore = useGraphStore();

// 加载图谱数据
await graphStore.loadGraphData({
  relationTypes: ['link', 'tag'],
  minWeight: 0.5,
  limit: 100
});

// 处理单个笔记
await graphStore.processNote(noteId, content, [tagId1, tagId2]);

// 查找关联路径
const path = await graphStore.findRelatedNotes(sourceId, targetId, 3);

// 查找潜在链接
const suggestions = await graphStore.findPotentialLinks(noteId, content);
```

---

## 性能优化建议

1. **节点数量限制**：默认限制 500 个节点，避免图谱过于复杂
2. **权重筛选**：提高最小权重可以只显示强关联
3. **关系类型筛选**：只显示需要的关系类型
4. **增量更新**：修改单个笔记时使用 `processNote()` 而非 `processAllNotes()`

---

## 下一步扩展建议

1. **实时更新**：笔记编辑时自动更新图谱
2. **双向链接**：点击链接时在图谱中高亮显示
3. **路径高亮**：选中两个节点时显示最短路径
4. **社区检测**：自动发现笔记簇/主题
5. **导出功能**：导出图谱为图片或 JSON
6. **全文搜索**：在图谱中搜索节点
7. **时间轴模式**：按时间线展示笔记演进

---

## 文件清单

### 新增文件
```
desktop-app-vue/
├── src/main/
│   └── graph-extractor.js                    # 关系提取器
├── src/renderer/
│   ├── stores/
│   │   └── graph.js                          # Pinia 状态管理
│   ├── components/
│   │   └── graph/
│   │       └── GraphCanvas.vue               # ECharts 图谱组件
│   └── pages/
│       └── KnowledgeGraphPage.vue            # 主页面
└── KNOWLEDGE_GRAPH_TESTING_GUIDE.md          # 本文档
```

### 修改文件
```
desktop-app-vue/
├── src/main/
│   ├── database.js                           # 添加 getKnowledgeItemByTitle 等方法
│   └── index.js                              # 添加 11 个 IPC handlers
├── src/preload/
│   └── index.js                              # 暴露 graph API
├── src/renderer/
│   ├── router/
│   │   └── index.js                          # 添加 /knowledge/graph 路由
│   └── components/
│       └── MainLayout.vue                     # 添加菜单项和图标
```

---

## 技术栈

- **前端**：Vue 3 + Pinia + Ant Design Vue + ECharts
- **后端**：Electron IPC + SQLite + sql.js
- **图算法**：BFS 路径查找、力导向布局

---

## 贡献者

- 知识图谱功能由 Claude Sonnet 4.5 协助实现
- 基于 ChainlessChain 项目架构

---

**测试愉快！如有问题请在 GitHub Issues 反馈。** 🚀
