# iOS 项目详情页 UI 实施计划

## 目标

将iOS项目详情页功能提升到与桌面端对等，实现完整的项目管理体验。

## 当前状态

- 后端服务：100% 完成（GitManager、SyncManager、DocumentExportManager、ProjectAIManager、ProjectRAGManager）
- UI界面：约30% 完成（仅基础文件列表和信息展示）

## 实施计划

### Phase 1: 核心交互组件（优先级最高）

#### 1.1 ProjectChatView - AI对话面板

**参考**: desktop-app-vue/src/renderer/components/projects/ChatPanel.vue

**功能**:

- AI对话输入和消息展示
- 流式响应显示
- 文件操作命令（创建、修改、删除）
- 任务计划生成
- 代码助手（生成、解释、重构）
- 内容处理（润色、扩写、摘要）

**依赖**: ProjectAIManager.swift

#### 1.2 FileTreeView - 文件树组件

**参考**: desktop-app-vue/src/renderer/components/projects/EnhancedFileTree.vue

**功能**:

- 层级文件树展示
- 文件/文件夹图标
- 展开/折叠
- 文件选择
- 右滑操作（删除、重命名）
- Git状态指示器

**依赖**: ProjectManager.swift (getFileTree)

### Phase 2: 编辑与预览

#### 2.1 FileEditorView - 文件编辑器

**参考**: desktop-app-vue/src/renderer/components/editors/

**功能**:

- Markdown编辑（语法高亮）
- 代码编辑（基础语法高亮）
- 纯文本编辑
- 自动保存
- 未保存提示

**依赖**: ProjectRepository.swift (updateProjectFile)

#### 2.2 FilePreviewView - 文件预览

**参考**: desktop-app-vue/src/renderer/components/projects/PreviewPanel.vue

**功能**:

- Markdown渲染预览
- 代码语法高亮
- 图片预览
- PDF预览（使用PDFKit）

### Phase 3: Git集成UI

#### 3.1 GitOperationsView - Git操作界面

**参考**: desktop-app-vue/src/renderer/components/projects/GitStatusDialog.vue

**功能**:

- Git状态展示（已修改/已暂存/未跟踪）
- 提交对话框
- 分支管理
- 提交历史
- 差异查看

**依赖**: GitManager.swift

### Phase 4: 导出与分享

#### 4.1 ExportMenuView - 导出菜单

**参考**: desktop-app-vue/src/renderer/components/projects/FileExportMenu.vue

**功能**:

- PDF导出
- HTML导出
- Markdown导出
- TXT导出
- PPT大纲生成

**依赖**: DocumentExportManager.swift

### Phase 5: 集成重构

#### 5.1 ProjectDetailView 重构

将所有组件集成到项目详情页：

**新布局**:

```
┌─────────────────────────────────────────┐
│           Project Header                │
├─────────────────────────────────────────┤
│  Files │ Chat │ Editor │ Git │ Info    │  <- Tab选择
├─────────────────────────────────────────┤
│                                         │
│         Selected Tab Content            │
│                                         │
└─────────────────────────────────────────┘
```

**Tab说明**:

- **Files**: FileTreeView + 文件操作
- **Chat**: ProjectChatView (AI对话)
- **Editor**: FileEditorView/FilePreviewView
- **Git**: GitOperationsView
- **Info**: 项目信息（已有）

## 文件结构

```
ios-app/ChainlessChain/Features/Project/
├── Views/
│   ├── ProjectListView.swift          ✅ 已有
│   ├── ProjectDetailView.swift        ✅ 已重构
│   ├── ProjectChatView.swift          ✅ 已完成
│   ├── FileTreeView.swift             ✅ 已完成
│   ├── FileEditorView.swift           ✅ 已完成
│   ├── GitOperationsView.swift        ✅ 已完成
│   └── ExportMenuView.swift           ✅ 已完成
├── ViewModels/
│   ├── ProjectChatViewModel.swift     ✅ 已完成
│   ├── FileTreeViewModel.swift        ✅ 已完成
│   ├── FileEditorViewModel.swift      ✅ 已完成
│   └── GitViewModel.swift             ✅ 已完成
└── Services/
    ├── ProjectManager.swift           ✅ 已有
    ├── ProjectRepository.swift        ✅ 已有
    ├── ProjectAIManager.swift         ✅ 已有
    ├── GitManager.swift               ✅ 已有
    ├── SyncManager.swift              ✅ 已有
    └── DocumentExportManager.swift    ✅ 已有
```

## 实施顺序

1. **ProjectChatView** - 核心AI交互，最重要
2. **FileTreeView** - 文件导航基础
3. **FileEditorView** - 文件编辑能力
4. **GitOperationsView** - 版本控制UI
5. **ExportMenuView** - 导出功能UI
6. **ProjectDetailView重构** - 整合所有组件

## 预计工作量

| 组件                  | 预计代码行数  | 复杂度 |
| --------------------- | ------------- | ------ |
| ProjectChatView       | 400-500       | 高     |
| FileTreeView          | 200-300       | 中     |
| FileEditorView        | 300-400       | 中高   |
| GitOperationsView     | 300-400       | 中     |
| ExportMenuView        | 150-200       | 低     |
| ProjectDetailView重构 | 200-300       | 中     |
| **总计**              | **1550-2100** | -      |

## 实施状态

✅ **全部完成** (2026-01-20)

1. ✅ **ProjectChatView** - AI对话面板（~400行）
2. ✅ **FileTreeView** - 文件树组件（~400行）
3. ✅ **FileEditorView** - 文件编辑器（~450行）
4. ✅ **GitOperationsView** - Git操作界面（~450行）
5. ✅ **ExportMenuView** - 导出菜单（~300行）
6. ✅ **ProjectDetailView重构** - 5标签页集成（~500行）

**实际代码行数**: ~2,500行（超出预计）

**新增ViewModels**:

- ProjectChatViewModel.swift
- FileTreeViewModel.swift
- FileEditorViewModel.swift
- GitViewModel.swift

**关键特性**:

- 完整的AI对话支持，包括流式响应和快捷操作
- 层级文件树，支持Git状态指示器
- Markdown编辑和预览
- Git完整操作界面（状态/历史/分支管理）
- 多格式导出（PDF/HTML/Markdown/TXT）
- 5标签页设计，与桌面端功能对等
