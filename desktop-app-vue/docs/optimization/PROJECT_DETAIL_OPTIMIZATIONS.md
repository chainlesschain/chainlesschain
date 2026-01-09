# 项目详情页优化文档

本文档记录了项目详情页的三个核心优化功能的实现。

## 📋 优化概览

### 1. ✅ 对话历史搜索功能
**组件**: `ConversationSearchPanel.vue`

#### 功能特性
- **全文搜索**: 支持在对话历史中搜索关键词
- **智能过滤**: 
  - 按角色过滤（用户/助手/系统）
  - 按消息类型过滤（普通对话/任务计划/采访/意图识别）
  - 按时间范围过滤（今天/本周/本月）
- **高亮显示**: 搜索结果中关键词高亮显示
- **相关度排序**: 根据匹配度和时间智能排序
- **实时搜索**: 输入时自动触发搜索（防抖优化）

#### 使用方式
```vue
<ConversationSearchPanel
  :messages="messages"
  :conversationId="currentConversation?.id"
  @result-click="handleSearchResultClick"
  @search="handleSearch"
/>
```

#### 核心算法
- **匹配度计算**: 完全匹配 > 开头匹配 > 单词匹配 > 包含匹配
- **搜索优化**: 支持从数据库或内存中搜索，自动选择最优方案

---

### 2. ✅ 智能上下文推荐功能
**组件**: `SmartContextRecommendation.vue`

#### 功能特性
- **相关文件推荐**: 
  - 基于关键词匹配文件名、路径和内容
  - 显示相关度评分（0-100%）
  - 支持多选文件添加到上下文
- **历史对话推荐**: 
  - 使用 Jaccard 相似度算法
  - 推荐讨论过类似话题的对话
- **相关知识推荐**: 
  - 从知识库中推荐相关文档（预留接口）
  - 支持标签分类

#### 使用方式
```vue
<SmartContextRecommendation
  :projectId="projectId"
  :currentMessage="userInput"
  :conversationHistory="messages"
  :projectFiles="files"
  @apply-context="handleApplyContext"
  @view-conversation="handleViewConversation"
  @view-knowledge="handleViewKnowledge"
/>
```

#### 核心算法
1. **关键词提取**: 
   - 移除标点符号
   - 分词并过滤短词（长度 < 3）
   - 去重

2. **文件相关度计算**:
   ```javascript
   score = (文件名匹配 * 30 + 路径匹配 * 20 + 内容匹配 * 10) / 关键词数量
   ```

3. **文本相似度计算**:
   ```javascript
   similarity = |交集| / |并集| * 100  // Jaccard 相似度
   ```

---

### 3. ✅ 文件树搜索功能
**组件**: `FileTree.vue` (增强版)

#### 功能特性
- **实时搜索**: 输入关键词即时过滤文件树
- **递归过滤**: 
  - 保留匹配的文件
  - 保留包含匹配文件的文件夹
  - 自动展开匹配路径
- **高亮显示**: 匹配的文件名高亮显示
- **搜索统计**: 显示找到的文件数量
- **空状态提示**: 未找到结果时显示友好提示

#### 使用方式
```vue
<FileTree
  :files="projectFiles"
  :currentFileId="currentFile?.id"
  :loading="filesLoading"
  :gitStatus="gitStatus"
  @select="handleFileSelect"
/>
```

#### 核心算法
- **递归过滤树节点**:
  1. 检查当前节点是否匹配
  2. 如果是文件夹，递归过滤子节点
  3. 保留匹配的节点或包含匹配子节点的文件夹
  4. 自动展开所有匹配路径

---

## 🎨 UI/UX 设计

### 视觉风格
- **统一配色**: 
  - 主色: `#1890ff` (蓝色)
  - 成功: `#52c41a` (绿色)
  - 警告: `#faad14` (橙色)
  - 高亮: `#fff566` (黄色)
- **圆角设计**: 统一使用 `6px` 圆角
- **阴影效果**: hover 时显示轻微阴影提升交互感

### 交互优化
- **防抖处理**: 搜索输入延迟 300-500ms 触发
- **加载状态**: 显示 loading 动画提升用户体验
- **空状态**: 友好的空状态提示和图标
- **响应式**: 自适应不同屏幕尺寸

---

## 📊 性能优化

### 1. 搜索性能
- **防抖优化**: 避免频繁触发搜索
- **计算缓存**: 使用 Vue computed 缓存计算结果
- **分页加载**: 大量结果时支持分页（预留）

### 2. 渲染性能
- **虚拟滚动**: 对话列表使用虚拟滚动（已在 ChatPanel 中实现）
- **条件渲染**: 使用 v-if 避免不必要的渲染
- **懒加载**: 推荐内容延迟生成

### 3. 内存优化
- **及时清理**: 组件卸载时清理监听器和定时器
- **数据限制**: 限制推荐数量（文件 5 个，对话 3 条）

---

## 🔧 技术实现

### 依赖库
- **Vue 3**: Composition API
- **Ant Design Vue 4**: UI 组件库
- **@ant-design/icons-vue**: 图标库

### 核心技术
- **响应式系统**: ref, computed, watch
- **事件通信**: emit 父子组件通信
- **正则表达式**: 文本搜索和高亮
- **递归算法**: 树形结构过滤

---

## 📝 使用示例

### 完整集成示例
```vue
<template>
  <div class="project-detail">
    <!-- 左侧：文件树（带搜索） -->
    <div class="left-panel">
      <FileTree
        :files="projectFiles"
        :currentFileId="currentFile?.id"
        @select="handleFileSelect"
      />
    </div>

    <!-- 中间：对话面板 -->
    <div class="center-panel">
      <ChatPanel
        :projectId="projectId"
        :currentFile="currentFile"
        @files-changed="loadProjectFiles"
      />
    </div>

    <!-- 右侧：智能推荐 + 搜索 -->
    <div class="right-panel">
      <a-tabs>
        <a-tab-pane key="recommend" tab="智能推荐">
          <SmartContextRecommendation
            :projectId="projectId"
            :currentMessage="userInput"
            :conversationHistory="messages"
            :projectFiles="projectFiles"
            @apply-context="handleApplyContext"
          />
        </a-tab-pane>
        <a-tab-pane key="search" tab="搜索历史">
          <ConversationSearchPanel
            :messages="messages"
            :conversationId="currentConversation?.id"
            @result-click="scrollToMessage"
          />
        </a-tab-pane>
      </a-tabs>
    </div>
  </div>
</template>
```

---

## 🚀 未来优化方向

### 短期优化
1. **搜索性能**: 
   - 实现全文索引（使用 SQLite FTS5）
   - 支持拼音搜索
   - 支持模糊匹配

2. **推荐算法**: 
   - 引入 TF-IDF 算法提升相关度计算
   - 使用向量相似度（Embedding）
   - 学习用户偏好

3. **UI 增强**: 
   - 搜索历史记录
   - 快捷键支持（Ctrl+F）
   - 搜索结果导出

### 长期规划
1. **AI 增强**: 
   - 使用 LLM 理解搜索意图
   - 智能问答（基于搜索结果）
   - 自动摘要

2. **协作功能**: 
   - 分享搜索结果
   - 团队知识库
   - 标注和评论

3. **跨项目搜索**: 
   - 全局搜索所有项目
   - 跨项目推荐
   - 知识图谱

---

## 📚 相关文档

- [ChatPanel 优化文档](./CHATPANEL_OPTIMIZATIONS.md)
- [虚拟滚动实现](./VIRTUAL_SCROLL.md)
- [消息类型系统](../src/renderer/utils/messageTypes.js)

---

## 🐛 已知问题

1. **搜索性能**: 大量消息时搜索可能较慢（需要实现索引）
2. **推荐准确度**: 简单的关键词匹配可能不够精确（需要引入 AI）
3. **内存占用**: 大型项目文件树可能占用较多内存（需要虚拟滚动）

---

## 📞 联系方式

如有问题或建议，请提交 Issue 或 PR。

**最后更新**: 2026-01-06
**版本**: v0.16.0
