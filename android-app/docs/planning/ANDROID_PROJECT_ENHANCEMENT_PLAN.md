# Android 项目详情页完整增强计划

## 一、PC端 vs Android端功能对比

### 1. 布局架构

| 功能           | PC端                         | Android端现状   | 差距         |
| -------------- | ---------------------------- | --------------- | ------------ |
| 4面板布局      | ✅ 工具栏/文件树/聊天/编辑器 | ❌ 3Tab布局     | 需适配移动端 |
| 可调整面板宽度 | ✅ 拖拽调整                  | ❌ 固定布局     | 移动端不需要 |
| 面包屑导航     | ✅ Projects → Name → File    | ❌ 只有返回按钮 | 需添加       |

### 2. AI聊天面板 (ChatPanel)

| 功能               | PC端                   | Android端现状         | 差距        |
| ------------------ | ---------------------- | --------------------- | ----------- |
| **上下文模式**     | ✅ 项目/文件/全局 三种 | ❌ 只有项目模式       | 🔴 缺失     |
| **消息类型**       | ✅ 7种类型             | ⚠️ 只有user/assistant | 🔴 缺失     |
| 内存管理           | ✅ 200条上限，自动清理 | ❌ 无限制             | 🟡 需优化   |
| 智能上下文         | ✅ 优先保留重要消息    | ❌ 简单截取           | 🔴 缺失     |
| **思考过程可视化** | ✅ 实时阶段显示        | ⚠️ 只有加载动画       | 🟡 需增强   |
| **任务计划系统**   | ✅ 生成/执行/跟踪      | ❌ 无                 | 🔴 缺失     |
| **意图理解**       | ✅ 检测任务类型        | ❌ 无                 | 🟡 可选     |
| 对话持久化         | ✅ 完整保存/加载       | ⚠️ 只保存消息         | 🟡 需增强   |
| **@文件引用**      | ✅ 引用文件内容        | ❌ 无                 | 🔴 缺失     |
| 复制消息           | ✅ 支持                | ⚠️ 部分支持           | 🟢 基本完成 |
| 重新生成           | ✅ 支持                | ⚠️ 只有重试           | 🟡 需增强   |

### 3. 文件编辑器

| 功能         | PC端                 | Android端现状       | 差距        |
| ------------ | -------------------- | ------------------- | ----------- |
| **多编辑器** | ✅ 6种专用编辑器     | ❌ 只有基础代码编辑 | 🔴 缺失     |
| 视图模式     | ✅ auto/edit/preview | ⚠️ 只有edit/preview | 🟢 基本完成 |
| 自动保存     | ✅ 可配置            | ❌ 手动保存         | 🟡 需添加   |
| 语法高亮     | ✅ Monaco Editor     | ❌ 无高亮           | 🔴 缺失     |
| 行号显示     | ✅ 支持              | ✅ 支持             | 🟢 完成     |
| 文件信息     | ✅ 类型/大小/路径    | ⚠️ 部分信息         | 🟡 需完善   |
| 未保存提示   | ✅ 支持              | ✅ 支持             | 🟢 完成     |

### 4. 文件树

| 功能         | PC端            | Android端现状 | 差距        |
| ------------ | --------------- | ------------- | ----------- |
| 树形展示     | ✅ 支持         | ✅ 支持       | 🟢 完成     |
| 虚拟滚动     | ✅ 300+文件优化 | ❌ 无         | 🟡 性能优化 |
| Git状态      | ✅ 文件变更标记 | ❌ 无         | 🔴 缺失     |
| 拖拽支持     | ✅ 拖拽移动文件 | ❌ 无         | 🟡 可选     |
| **文件搜索** | ✅ 支持         | ❌ 无         | 🔴 缺失     |
| 文件图标     | ✅ 按类型显示   | ⚠️ 简单图标   | 🟡 需增强   |
| 刷新按钮     | ✅ 支持         | ❌ 无         | 🟡 需添加   |

### 5. Git集成

| 功能       | PC端            | Android端现状 | 差距    |
| ---------- | --------------- | ------------- | ------- |
| Git状态    | ✅ 显示变更文件 | ❌ 无         | 🔴 缺失 |
| 提交历史   | ✅ 查看历史     | ❌ 无         | 🔴 缺失 |
| 提交操作   | ✅ Commit       | ❌ 无         | 🔴 缺失 |
| 推送/拉取  | ✅ Push/Pull    | ❌ 无         | 🔴 缺失 |
| 自动初始化 | ✅ 支持         | ❌ 无         | 🔴 缺失 |

### 6. 项目创建

| 功能       | PC端                | Android端现状 | 差距      |
| ---------- | ------------------- | ------------- | --------- |
| AI辅助创建 | ✅ 自然语言描述     | ⚠️ 基础版     | 🟡 需增强 |
| 职业模板   | ✅ 医疗/法律/教育   | ❌ 无         | 🟡 可选   |
| 快速示例   | ✅ Todo/博客/仪表板 | ⚠️ 简单示例   | 🟡 需增强 |
| 创建进度   | ✅ 实时进度显示     | ❌ 无         | 🔴 缺失   |
| 模板变量   | ✅ 支持             | ❌ 无         | 🟡 可选   |

### 7. 高级功能

| 功能       | PC端              | Android端现状 | 差距      |
| ---------- | ----------------- | ------------- | --------- |
| RAG索引    | ✅ 项目文件索引   | ❌ 无         | 🟡 可选   |
| 代码助手   | ✅ 生成/审查/重构 | ❌ 无         | 🟡 可选   |
| 任务监视器 | ✅ 多步骤显示     | ❌ 无         | 🔴 需添加 |
| 项目分享   | ✅ 链接分享       | ❌ 无         | 🟡 可选   |
| 文件导出   | ✅ 多格式导出     | ❌ 无         | 🟡 可选   |

---

## 二、优先级分析

### 🔴 P0 - 核心功能（必须实现）

1. **多上下文模式** - 项目/文件/全局切换
2. **@文件引用** - 在聊天中引用文件内容
3. **完整消息类型** - 支持任务计划、意图确认等
4. **任务计划系统** - 生成和执行任务计划
5. **文件搜索** - 在文件树中搜索
6. **语法高亮** - 代码编辑器语法高亮
7. **创建进度显示** - AI创建项目的进度

### 🟡 P1 - 重要功能（应该实现）

8. **思考过程可视化增强** - 显示AI思考阶段
9. **智能上下文管理** - 优先保留重要消息
10. **自动保存** - 文件编辑自动保存
11. **Git基础集成** - 状态查看和提交
12. **虚拟滚动** - 大文件列表优化
13. **模型选择器UI** - 可视化选择模型
14. **面包屑导航** - 更好的导航体验

### 🟢 P2 - 增强功能（可以实现）

15. **完整Git操作** - Push/Pull等
16. **职业模板** - 更多专业模板
17. **项目分享** - 分享链接生成
18. **文件拖拽** - 拖拽移动文件
19. **代码助手** - 代码生成/审查
20. **RAG索引** - 项目内搜索

---

## 三、详细实施计划

### Phase 1: AI聊天核心增强 (P0)

#### 1.1 多上下文模式

**目标**: 支持项目/文件/全局三种上下文模式

**文件修改:**

- `ProjectChatPanel.kt` - 添加上下文模式切换
- `ProjectViewModel.kt` - 添加上下文状态管理
- `ProjectChatRepository.kt` - 根据模式构建不同上下文

**实现细节:**

```kotlin
enum class ChatContextMode {
    PROJECT,  // 项目整体上下文
    FILE,     // 当前选中文件上下文
    GLOBAL    // 无特定上下文
}

// UI: 在聊天顶部添加SegmentedButton切换
// 系统提示根据模式变化:
// - PROJECT: 包含项目结构和所有文件列表
// - FILE: 包含当前文件完整内容
// - GLOBAL: 通用AI助手
```

#### 1.2 @文件引用

**目标**: 支持在消息中@引用文件，将文件内容加入上下文

**文件修改:**

- `ProjectChatPanel.kt` - 添加@提及输入支持
- `ProjectChatInput.kt` - 新建，带@提及弹出菜单
- `ProjectChatRepository.kt` - 解析@引用并获取文件内容

**实现细节:**

````kotlin
// 输入框检测到@时弹出文件列表
// 选择文件后插入 @filename.ext
// 发送时解析@引用，获取文件内容
// 在系统提示中添加:
// "Referenced file content:
//  @main.kt:
//  ```kotlin
//  [file content]
//  ```"
````

#### 1.3 消息类型扩展

**目标**: 支持多种消息类型的显示

**文件修改:**

- `ProjectChatMessageEntity.kt` - 添加messageType字段
- `ProjectChatPanel.kt` - 根据类型渲染不同UI

**消息类型:**

```kotlin
enum class ProjectMessageType {
    NORMAL,           // 普通对话
    SYSTEM,           // 系统消息
    TASK_PLAN,        // 任务计划
    TASK_ANALYSIS,    // 任务分析
    INTENT_CONFIRM,   // 意图确认
    CREATION,         // 创建消息
    CODE_BLOCK        // 代码块
}
```

#### 1.4 任务计划系统

**目标**: AI可以生成任务计划，用户确认后执行

**新建文件:**

- `model/TaskPlan.kt` - 任务计划数据模型
- `ui/components/TaskPlanCard.kt` - 任务计划UI组件

**实现细节:**

```kotlin
data class TaskPlan(
    val id: String,
    val title: String,
    val steps: List<TaskStep>,
    val status: TaskPlanStatus
)

data class TaskStep(
    val id: String,
    val description: String,
    val status: StepStatus,
    val result: String? = null
)

// UI显示:
// - 任务标题
// - 步骤列表（带状态图标）
// - 确认/取消/修改按钮
// - 执行进度
```

---

### Phase 2: 文件编辑器增强 (P0-P1)

#### 2.1 语法高亮

**目标**: 代码编辑器支持语法高亮

**依赖添加:**

```kotlin
// 使用 highlight.js Android port 或 Prism4j
implementation("io.noties.prism4j:prism4j:2.0.0")
implementation("io.noties.prism4j:prism4j-bundler:2.0.0")
```

**文件修改:**

- `FileEditorScreen.kt` - 集成语法高亮
- 新建 `SyntaxHighlightedEditor.kt`

#### 2.2 自动保存

**目标**: 编辑文件自动保存

**实现细节:**

```kotlin
// 在FileEditorViewModel中:
private var autoSaveJob: Job? = null

fun onContentChange(content: String) {
    _content.value = content
    _isDirty.value = true

    // 取消之前的自动保存
    autoSaveJob?.cancel()

    // 1秒后自动保存
    autoSaveJob = viewModelScope.launch {
        delay(1000)
        saveFile()
    }
}
```

#### 2.3 文件搜索

**目标**: 在文件树中搜索文件

**文件修改:**

- `ProjectDetailScreen.kt` - 添加搜索栏
- `ProjectViewModel.kt` - 添加搜索过滤逻辑

**UI设计:**

- 文件Tab顶部添加搜索图标
- 点击展开搜索输入框
- 实时过滤文件树

---

### Phase 3: 创建进度与思考过程 (P0-P1)

#### 3.1 AI创建进度显示

**目标**: AI创建项目时显示实时进度

**新建文件:**

- `ui/components/CreationProgressDialog.kt`

**实现细节:**

```kotlin
@Composable
fun CreationProgressDialog(
    isVisible: Boolean,
    currentStage: String,  // "连接AI服务", "生成文件", "保存项目"
    progress: Float,       // 0.0 - 1.0
    onCancel: () -> Unit
) {
    if (isVisible) {
        AlertDialog(
            // 进度条
            // 当前阶段文本
            // 取消按钮（仅在未完成时）
        )
    }
}
```

#### 3.2 思考过程可视化

**目标**: 显示AI思考的各个阶段

**文件修改:**

- `ProjectChatPanel.kt` - 增强ThinkingIndicator

**UI设计:**

```kotlin
@Composable
fun EnhancedThinkingIndicator(
    currentStage: ThinkingStage,
    stages: List<ThinkingStage>
) {
    // 显示:
    // ✓ 理解问题
    // ● 分析项目结构  <-- 当前阶段
    // ○ 生成回答
}

enum class ThinkingStage {
    UNDERSTANDING,    // 理解问题
    ANALYZING,        // 分析上下文
    PLANNING,         // 规划回答
    GENERATING        // 生成内容
}
```

---

### Phase 4: Git基础集成 (P1)

#### 4.1 Git状态显示

**目标**: 显示项目Git状态和文件变更

**新建文件:**

- `ui/components/GitStatusPanel.kt`
- `repository/GitRepository.kt`

**实现细节:**

```kotlin
// 使用JGit库
implementation("org.eclipse.jgit:org.eclipse.jgit:6.8.0.202311291450-r")

// 显示:
// - 当前分支
// - 变更文件列表（Added/Modified/Deleted）
// - 提交按钮
```

#### 4.2 Git提交

**目标**: 支持提交变更

**UI设计:**

- 底部Sheet显示变更文件
- 选择要提交的文件
- 输入提交信息
- 提交按钮

---

### Phase 5: 性能与UI优化 (P1-P2)

#### 5.1 虚拟滚动

**目标**: 大文件列表性能优化

**实现:**

```kotlin
// 使用LazyColumn的key和contentType优化
LazyColumn {
    items(
        items = files,
        key = { it.id },
        contentType = { it.type }
    ) { file ->
        FileTreeItem(file)
    }
}
```

#### 5.2 模型选择器UI

**目标**: 可视化选择AI模型

**新建文件:**

- `ui/components/ModelSelectorSheet.kt`

**UI设计:**

```kotlin
// 底部Sheet显示:
// - 模型列表（带图标和描述）
// - 当前选中标记
// - 模型能力标签（速度/质量/成本）
```

#### 5.3 面包屑导航

**目标**: 显示当前位置路径

**文件修改:**

- `ProjectDetailScreen.kt` - TopAppBar添加面包屑

---

## 四、文件清单

### 需要修改的文件

| 文件                          | 修改内容                     |
| ----------------------------- | ---------------------------- |
| `ProjectDetailScreen.kt`      | 添加搜索栏、面包屑、Git按钮  |
| `ProjectChatPanel.kt`         | 上下文模式切换、消息类型渲染 |
| `ProjectViewModel.kt`         | 上下文状态、搜索、Git状态    |
| `ProjectChatRepository.kt`    | 多上下文构建、@引用解析      |
| `ProjectChatMessageEntity.kt` | 添加messageType字段          |
| `FileEditorScreen.kt`         | 语法高亮、自动保存           |
| `CreateProjectScreen.kt`      | 创建进度显示                 |
| `build.gradle.kts`            | 添加新依赖                   |

### 需要新建的文件

| 文件                                         | 用途             |
| -------------------------------------------- | ---------------- |
| `model/TaskPlan.kt`                          | 任务计划数据模型 |
| `model/ChatContextMode.kt`                   | 上下文模式枚举   |
| `model/ThinkingStage.kt`                     | 思考阶段枚举     |
| `ui/components/TaskPlanCard.kt`              | 任务计划UI       |
| `ui/components/ContextModeSwitcher.kt`       | 上下文切换UI     |
| `ui/components/FileMentionPopup.kt`          | @提及弹出菜单    |
| `ui/components/CreationProgressDialog.kt`    | 创建进度对话框   |
| `ui/components/EnhancedThinkingIndicator.kt` | 增强思考指示器   |
| `ui/components/ModelSelectorSheet.kt`        | 模型选择器       |
| `ui/components/GitStatusPanel.kt`            | Git状态面板      |
| `ui/components/FileSearchBar.kt`             | 文件搜索栏       |
| `ui/components/BreadcrumbNav.kt`             | 面包屑导航       |
| `ui/components/SyntaxHighlightedEditor.kt`   | 语法高亮编辑器   |
| `repository/GitRepository.kt`                | Git操作仓库      |

---

## 五、依赖添加

```kotlin
// build.gradle.kts (feature-project)

// 语法高亮
implementation("io.noties.prism4j:prism4j:2.0.0")

// Git操作 (可选)
implementation("org.eclipse.jgit:org.eclipse.jgit:6.8.0.202311291450-r")
```

---

## 六、实施顺序

### Week 1: AI聊天核心

- [ ] 1.1 多上下文模式
- [ ] 1.2 @文件引用
- [ ] 1.3 消息类型扩展

### Week 2: 任务系统与编辑器

- [ ] 1.4 任务计划系统
- [ ] 2.1 语法高亮
- [ ] 2.2 自动保存

### Week 3: 进度与搜索

- [ ] 3.1 AI创建进度显示
- [ ] 3.2 思考过程可视化
- [ ] 2.3 文件搜索

### Week 4: Git与优化

- [ ] 4.1 Git状态显示
- [ ] 4.2 Git提交
- [ ] 5.1-5.3 UI优化

---

## 七、验收标准

### P0 验收

- [ ] 能在项目/文件/全局模式间切换
- [ ] 能使用@引用文件内容
- [ ] AI可生成任务计划并显示
- [ ] 代码文件有语法高亮
- [ ] 能搜索项目文件
- [ ] AI创建项目显示进度

### P1 验收

- [ ] 显示AI思考阶段
- [ ] 文件自动保存
- [ ] 能查看Git状态
- [ ] 能提交Git变更
- [ ] 大文件列表流畅

### P2 验收

- [ ] 能Push/Pull
- [ ] 有更多项目模板
- [ ] 能分享项目
