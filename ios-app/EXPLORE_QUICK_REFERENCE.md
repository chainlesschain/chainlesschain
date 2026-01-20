# 探索页功能实现 - 快速参考指南

## 📁 新创建的文件

### 1. ExploreFeedViewModel.swift
**路径**: `/ios-app/ChainlessChain/Features/Common/ViewModels/ExploreFeedViewModel.swift`

**主要类型**:
- `ContentFilter`: 内容类型筛选 (全部/知识库/AI对话/项目)
- `SortOption`: 排序选项 (最新/最常访问/收藏)
- `ExploreCardType`: 卡片类型枚举
- `ExploreCardModel`: 统一的卡片数据模型
- `ExploreFeedViewModel`: 主视图模型
- `ExploreStatistics`: 统计信息

**核心方法**:
```swift
func loadFeed() async                  // 初始加载
func refresh() async                   // 刷新数据
func loadMore()                        // 加载更多(分页)
func applyFiltersAndSort()             // 应用筛选和排序
```

### 2. ExploreCardViews.swift
**路径**: `/ios-app/ChainlessChain/Features/Common/Views/ExploreCardViews.swift`

**主要组件**:
- `BaseExploreCard`: 基础卡片容器
- `ExploreCardView`: 卡片路由器(根据类型渲染)
- `KnowledgeExploreCard`: 知识库卡片
- `AIConversationExploreCard`: AI对话卡片
- `ProjectExploreCard`: 项目卡片
- `ExploreEmptyView`: 空状态视图
- `ExploreStatsOverview`: 统计概览

**工具函数**:
```swift
timeAgoString(from: Date) -> String           // 相对时间格式化
formatFileSize(_ bytes: Int64) -> String      // 文件大小格式化
```

### 3. ContentView.swift (修改)
**路径**: `/ios-app/ChainlessChain/App/ContentView.swift`

**修改内容**:
- 完全重构 `ExploreView`
- 添加 `FilterChip` 和 `SortChip` 组件
- 更新 `SearchBarView` 支持绑定
- 集成 ExploreFeedViewModel
- 实现导航到详情页

## 🎯 主要功能

### 数据聚合
```swift
// ViewModel 并发加载三个数据源
async let knowledgeTask = loadKnowledgeItems()
async let conversationsTask = loadAIConversations()
async let projectsTask = loadProjects()
```

### 筛选和排序
```swift
// 选择筛选器
viewModel.selectedFilter = .knowledge

// 选择排序
viewModel.selectedSort = .latest

// 自动应用
viewModel.applyFiltersAndSort()
```

### 搜索
```swift
// 绑定到 SearchBar
@Published var searchText = ""

// 300ms 防抖,自动搜索
// 支持多关键词: "AI 项目"
```

### 分页
```swift
// 滚动到最后一项时自动加载
.onAppear {
    if card.id == viewModel.cards.last?.id {
        viewModel.loadMore()
    }
}
```

## 🎨 UI 组件使用

### 统计概览
```swift
if !viewModel.cards.isEmpty {
    ExploreStatsOverview(statistics: viewModel.statistics)
}
```

### 筛选器栏
```swift
ForEach(ContentFilter.allCases, id: \.self) { filter in
    FilterChip(
        title: filter.rawValue,
        icon: filter.icon,
        isSelected: viewModel.selectedFilter == filter
    ) {
        viewModel.selectedFilter = filter
    }
}
```

### 卡片列表
```swift
ForEach(viewModel.cards) { card in
    Button(action: { handleCardTap(card) }) {
        ExploreCardView(card: card)
    }
}
```

## 🔄 数据流

```
用户操作
  ↓
ExploreView (UI事件)
  ↓
ExploreFeedViewModel (业务逻辑)
  ↓
Repository (数据访问)
  ↓
Database (持久化)
  ↓
返回数据
  ↓
ViewModel 处理 (筛选/排序/分页)
  ↓
ExploreView 渲染
```

## 🎭 卡片类型对应

| 数据源 | Entity类型 | CardType | 卡片组件 | 详情页 |
|--------|-----------|----------|---------|-------|
| 知识库 | KnowledgeItem | .knowledge | KnowledgeExploreCard | KnowledgeDetailView |
| AI对话 | AIConversationEntity | .aiConversation | AIConversationExploreCard | AIChatView |
| 项目 | ProjectEntity | .project | ProjectExploreCard | ProjectDetailView |

## ⚡️ 性能优化点

1. **并发加载**: `async let` 并发获取数据
2. **防抖搜索**: `.debounce(for: .milliseconds(300))`
3. **分页**: 每页20条,减少内存
4. **LazyVStack**: 延迟渲染
5. **数据缓存**: ViewModel缓存原始数据

## 🐛 常见问题

### Q: 编译错误 "Cannot find ExploreFeedViewModel"
**A**: 需要在 Xcode 项目中添加新文件到 target

### Q: 卡片没有显示
**A**: 检查数据源是否有数据,查看 `viewModel.errorMessage`

### Q: 导航不工作
**A**: 确保 NavigationLink 的 tag 和 selection 绑定正确

### Q: 搜索不生效
**A**: 检查 SearchBarView 的绑定是否正确

## 📝 后续扩展建议

1. **添加新内容类型**
   - 在 `ContentFilter` 添加 case
   - 创建对应的 Repository
   - 添加对应的 Card 组件

2. **自定义筛选器**
   - 扩展 `applyFiltersAndSort()` 方法
   - 添加更多筛选条件

3. **高级搜索**
   - 支持正则表达式
   - 支持标签搜索
   - 支持日期范围

4. **更多排序方式**
   - 按名称排序
   - 按创建时间排序
   - 自定义排序

## 🔗 相关文件

- KnowledgeRepository: `/Features/Knowledge/Services/KnowledgeRepository.swift`
- AIConversationRepository: `/Features/AI/Services/AIConversationRepository.swift`
- ProjectRepository: `/Features/Project/Services/ProjectRepository.swift`
- KnowledgeDetailView: `/Features/Knowledge/Views/KnowledgeDetailView.swift`
- ProjectDetailView: `/Features/Project/Views/ProjectDetailView.swift`
- AIChatView: `/Features/AI/Views/AIChatView.swift`
