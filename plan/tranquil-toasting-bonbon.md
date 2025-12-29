# 项目详情页重构实施计划

## 一、需求概述

将项目详情页从当前的**三栏布局**重构为**四栏布局**，使其更符合现代IDE的交互模式（参考VSCode和参考图片）。

### 当前布局（三栏）
```
[ProjectSidebar(可折叠)] | [FileTree | 编辑器/预览 | ChatPanel(可折叠)]
```

### 目标布局（四栏）
```
[ProjectSidebar(可折叠)] | [FileTree管理器 | 对话历史+输入框 | 编辑/预览面板(可折叠)]
```

## 二、核心变化

| 区域 | 当前状态 | 目标状态 | 优先级 |
|------|---------|---------|--------|
| 最左侧 | ProjectSidebar（保持不变） | ProjectSidebar（保持不变） | 无需修改 |
| 左侧 | 文件树（240px固定宽） | 增强的VSCode风格文件管理器 | 高 |
| 中间 | 编辑器/预览面板（flex:1） | **对话历史+对话输入框**（主要对话区域） | 高 |
| 右侧 | ChatPanel AI助手（600px，可隐藏） | **文件编辑/预览面板**（可折叠，支持多种编辑器） | 高 |

## 三、详细实施方案

### 阶段1：布局结构调整（最高优先级）

#### 1.1 修改 ProjectDetailPage.vue 布局

**文件路径**: `C:\code\chainlesschain\desktop-app-vue\src\renderer\pages\projects\ProjectDetailPage.vue`

**调整内容**:

```vue
<!-- 当前结构 (line 148-274) -->
<div class="content-container">
  <div class="left-sidebar">文件树</div>
  <div class="main-content">编辑器</div>
  <div class="right-sidebar">ChatPanel</div>
</div>

<!-- 新结构 -->
<div class="content-container">
  <!-- 左：文件树管理器 -->
  <div class="file-explorer-panel">
    <EnhancedFileTree />
  </div>

  <!-- 中：对话区域 -->
  <div class="conversation-panel">
    <ConversationHistoryView />
    <ConversationInput />
  </div>

  <!-- 右：编辑/预览面板 (可折叠) -->
  <div class="editor-preview-panel" :class="{ collapsed: !showEditorPanel }">
    <EditorPanelHeader />
    <!-- 复用现有的所有编辑器组件 -->
    <ExcelEditor v-if="shouldShowExcelEditor" />
    <CodeEditor v-else-if="shouldShowCodeEditor" />
    <!-- ... 其他编辑器 ... -->
  </div>
</div>
```

**CSS调整** (新建或修改样式部分):

```css
.content-container {
  display: flex;
  flex: 1;
  overflow: hidden;
}

/* 文件管理器面板 - 固定宽度 */
.file-explorer-panel {
  width: 280px;
  min-width: 200px;
  max-width: 400px;
  flex-shrink: 0;
  border-right: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  background: var(--sidebar-bg);
}

/* 对话面板 - 主要区域，弹性扩展 */
.conversation-panel {
  flex: 1;
  min-width: 400px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--main-bg);
}

/* 编辑/预览面板 - 固定宽度，可折叠 */
.editor-preview-panel {
  width: 50%;
  max-width: 800px;
  min-width: 400px;
  flex-shrink: 0;
  border-left: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition: width 0.3s ease, opacity 0.3s ease;
}

.editor-preview-panel.collapsed {
  width: 0;
  min-width: 0;
  opacity: 0;
  pointer-events: none;
}
```

---

### 阶段2：文件树管理器增强

#### 2.1 创建 EnhancedFileTree.vue 组件

**文件路径**: `C:\code\chainlesschain\desktop-app-vue\src\renderer\components\projects\EnhancedFileTree.vue`

**功能特性**:

1. **VSCode风格的UI**
   - 文件/文件夹图标（复用现有的图标映射）
   - 展开/收起箭头动画
   - 悬停高亮效果
   - 选中状态样式

2. **文件系统操作**
   - 右键上下文菜单：
     - 新建文件/文件夹
     - 重命名
     - 删除
     - 复制路径
     - 在文件管理器中显示
   - 拖拽功能：
     - 项目内文件拖拽重组（移动文件到不同文件夹）
     - 从外部拖入文件/文件夹（导入）
     - 拖出到系统文件管理器（导出复制）

3. **实时文件监听**
   - 监听项目文件夹变化（使用现有的 `file-sync:watch-project` IPC）
   - 自动刷新文件树
   - Git状态标签实时更新

**实现策略**:
- 复用现有 `FileTree.vue` 的核心逻辑
- 添加右键菜单组件（使用 Ant Design `a-dropdown`）
- 集成 HTML5 Drag & Drop API
- 调用现有的 IPC handlers：
  - `project:copyFile` - 文件复制
  - `project:delete-file` - 文件删除
  - `file:write-content` - 创建新文件
  - `dialog:showOpenDialog` - 选择导入文件

#### 2.2 新建文件操作相关IPC（如需）

如果现有IPC不足，需要在 `src/main/index.js` 中添加：

```javascript
// 重命名文件
ipcMain.handle('project:rename-file', async (_event, projectId, fileId, newName) => {
  // 实现文件重命名逻辑
});

// 创建文件夹
ipcMain.handle('project:create-folder', async (_event, projectId, parentPath, folderName) => {
  // 实现文件夹创建逻辑
});

// 移动文件（拖拽）
ipcMain.handle('project:move-file', async (_event, projectId, fileId, targetPath) => {
  // 实现文件移动逻辑
});
```

---

### 阶段3：对话历史显示实现

#### 3.1 创建 ConversationHistoryView.vue 组件

**文件路径**: `C:\code\chainlesschain\desktop-app-vue\src\renderer\components\projects\ConversationHistoryView.vue`

**功能特性**:

1. **消息列表显示**
   - 滚动到底部自动加载更多（虚拟滚动优化）
   - 用户消息/AI消息区分样式
   - Markdown渲染（复用现有 marked.js 配置）
   - 代码块语法高亮
   - 时间戳显示

2. **步骤展示**（参考图片中的"3个步骤"、"4个步骤"）
   - 可折叠的步骤列表
   - 步骤完成状态标记
   - 步骤内容预览

3. **文件关联**
   - 显示消息中提及的文件（带图标）
   - 点击文件名在右侧编辑器打开

**数据来源**:
- 从 `conversationStore` 获取当前项目的对话历史
- 调用现有的 `window.electronAPI.conversation.getMessages(conversationId)`

**实现策略**:
```vue
<template>
  <div class="conversation-history-view">
    <div class="messages-container" ref="messagesContainer">
      <div
        v-for="message in messages"
        :key="message.id"
        :class="['message-item', `message-${message.role}`]"
      >
        <!-- 用户消息 -->
        <template v-if="message.role === 'user'">
          <div class="message-avatar">👤</div>
          <div class="message-content">{{ message.content }}</div>
        </template>

        <!-- AI消息 -->
        <template v-else>
          <div class="message-avatar">🤖</div>
          <div class="message-content">
            <!-- Markdown渲染 -->
            <div v-html="renderMarkdown(message.content)"></div>

            <!-- 步骤列表 -->
            <div v-if="message.steps" class="steps-list">
              <div class="steps-header" @click="toggleSteps">
                {{ message.steps.length }} 个步骤
                <DownOutlined />
              </div>
              <div v-show="stepsExpanded" class="steps-content">
                <div v-for="(step, idx) in message.steps" :key="idx" class="step-item">
                  <CheckCircleOutlined v-if="step.completed" />
                  {{ step.title }}
                </div>
              </div>
            </div>

            <!-- 附件文件 -->
            <div v-if="message.attachments" class="attachments">
              <div
                v-for="file in message.attachments"
                :key="file.id"
                class="attachment-item"
                @click="openFile(file)"
              >
                <FileIcon :filename="file.name" />
                {{ file.name }}
              </div>
            </div>
          </div>
        </template>

        <div class="message-time">{{ formatTime(message.timestamp) }}</div>
      </div>
    </div>
  </div>
</template>
```

#### 3.2 调整 ConversationInput 组件

**文件路径**: `C:\code\chainlesschain\desktop-app-vue\src\renderer\components\projects\ConversationInput.vue`

**调整内容**:
- 保持现有的输入框功能（@ 提及、附件上传、快捷键）
- 调整样式以适应新布局（固定在对话面板底部）
- 添加"建议问题"按钮（参考图片中的"根据这个来改"等建议）

---

### 阶段4：编辑/预览面板移到右侧

#### 4.1 创建 EditorPanelHeader.vue 组件

**文件路径**: `C:\code\chainlesschain\desktop-app-vue\src\renderer\components\projects\EditorPanelHeader.vue`

**功能特性**:

1. **文件标签显示**
   - 当前打开文件名
   - 文件类型图标
   - 未保存状态指示器（红点）

2. **操作按钮**
   - 保存按钮（Ctrl+S）
   - 视图模式切换（编辑/预览/自动）
   - 关闭编辑器按钮（折叠面板）
   - 文件导出菜单（复用现有的 FileExportMenu）

3. **面包屑导航**
   - 显示文件路径（可点击跳转到文件夹）

```vue
<template>
  <div class="editor-panel-header">
    <div class="file-info">
      <FileIcon :filename="currentFile?.file_name" />
      <span class="file-name">{{ currentFile?.file_name }}</span>
      <span v-if="hasUnsavedChanges" class="unsaved-indicator">●</span>
    </div>

    <div class="header-actions">
      <!-- 视图模式 -->
      <a-radio-group v-model:value="viewMode" size="small">
        <a-radio-button value="edit">编辑</a-radio-button>
        <a-radio-button value="preview">预览</a-radio-button>
      </a-radio-group>

      <!-- 保存 -->
      <a-button size="small" @click="handleSave">
        <SaveOutlined />
        保存
      </a-button>

      <!-- 导出 -->
      <FileExportMenu :file="currentFile" />

      <!-- 关闭面板 -->
      <a-button size="small" type="text" @click="$emit('close')">
        <CloseOutlined />
      </a-button>
    </div>
  </div>
</template>
```

#### 4.2 复用现有编辑器组件

**策略**:
- 不修改现有的编辑器组件（ExcelEditor, CodeEditor, MarkdownEditor等）
- 仅调整它们在 ProjectDetailPage 中的位置（从 `.main-content` 移到 `.editor-preview-panel`）
- 保持所有编辑器的 props、events、功能不变

---

### 阶段5：可折叠面板功能

#### 5.1 实现可调整大小的分割面板（可选）

**使用库**: vue-resizable 或自定义 resize-handle

**实现方式**:
1. 在 `.file-explorer-panel` 和 `.conversation-panel` 之间添加拖拽手柄
2. 在 `.conversation-panel` 和 `.editor-preview-panel` 之间添加拖拽手柄
3. 使用 `@mousedown` + `@mousemove` + `@mouseup` 实现拖拽调整宽度

**代码示例**:
```vue
<div class="content-container">
  <div class="file-explorer-panel" :style="{ width: explorerWidth + 'px' }">
    <!-- 文件树 -->
  </div>

  <!-- 拖拽手柄 -->
  <div
    class="resize-handle"
    @mousedown="startResize('explorer')"
  ></div>

  <div class="conversation-panel">
    <!-- 对话历史 -->
  </div>

  <!-- 拖拽手柄 -->
  <div
    class="resize-handle"
    @mousedown="startResize('editor')"
  ></div>

  <div class="editor-preview-panel" :style="{ width: editorWidth + 'px' }">
    <!-- 编辑器 -->
  </div>
</div>

<script>
const startResize = (panel) => {
  // 实现拖拽调整宽度逻辑
};
</script>
```

#### 5.2 折叠/展开状态管理

**在 ProjectDetailPage.vue 中添加状态**:

```javascript
const showFileExplorer = ref(true);  // 文件树面板
const showEditorPanel = ref(true);   // 编辑/预览面板

const toggleFileExplorer = () => {
  showFileExplorer.value = !showFileExplorer.value;
};

const toggleEditorPanel = () => {
  showEditorPanel.value = !showEditorPanel.value;
};
```

**添加快捷键支持**:
- `Ctrl+B` - 切换文件树
- `Ctrl+Shift+E` - 打开文件树（VSCode快捷键）
- `Ctrl+Shift+P` - 打开编辑器

---

## 四、数据流和状态管理

### 4.1 现有Store复用

**保持不变的Store**:
- `project.js` - 项目列表、当前项目、项目文件
- `conversation.js` - 对话历史、消息列表
- `llm.js` - LLM配置和查询

**可能需要的新状态**:
```javascript
// 在 project.js 中添加
const state = {
  // ... 现有状态 ...

  // UI状态
  showFileExplorer: true,
  showEditorPanel: true,
  explorerWidth: 280,
  editorWidth: 600,

  // 文件操作
  clipboardFiles: [],  // 复制/剪切的文件列表
  draggedFile: null,   // 正在拖拽的文件
};
```

### 4.2 组件间通信

```
ProjectDetailPage (父组件)
  ├── EnhancedFileTree
  │     └── emit('select-file') → 打开编辑器
  │     └── emit('context-menu') → 显示右键菜单
  │
  ├── ConversationHistoryView
  │     └── emit('file-clicked') → 打开编辑器
  │
  ├── ConversationInput
  │     └── emit('send-message') → 添加消息到历史
  │
  └── EditorPanelHeader
        └── emit('close') → 折叠编辑器面板
        └── emit('save') → 保存文件
```

---

## 五、分步实施顺序（推荐）

### Phase 1: 基础布局调整（1-2天）
1. ✅ 修改 ProjectDetailPage.vue 的模板结构
2. ✅ 调整 CSS 样式实现四栏布局
3. ✅ 确保现有功能不被破坏（编辑器、文件树、ChatPanel）

### Phase 2: 对话区域迁移（1天）
4. ✅ 创建 ConversationHistoryView 组件
5. ✅ 将 ChatPanel 的对话功能迁移到中间面板
6. ✅ 调整 ConversationInput 样式和位置

### Phase 3: 编辑器面板右移（0.5天）
7. ✅ 创建 EditorPanelHeader 组件
8. ✅ 将编辑器组件移到右侧面板
9. ✅ 实现折叠/展开功能

### Phase 4: 文件树增强（2-3天）
10. ✅ 创建 EnhancedFileTree 组件
11. ✅ 实现右键上下文菜单
12. ✅ 实现拖拽功能（项目内、导入、导出）
13. ✅ 添加新的IPC handlers（重命名、移动等）

### Phase 5: 可调整大小面板（可选，1天）
14. ✅ 添加拖拽手柄组件
15. ✅ 实现面板宽度调整逻辑
16. ✅ 保存用户的布局偏好到localStorage

### Phase 6: 细节优化和测试（1-2天）
17. ✅ 快捷键支持
18. ✅ 动画效果优化
19. ✅ 响应式适配
20. ✅ 全面测试各种场景

**总计**: 约6-10天开发时间

---

## 六、关键文件清单

### 需要修改的文件
| 文件路径 | 修改内容 | 优先级 |
|---------|---------|--------|
| `src/renderer/pages/projects/ProjectDetailPage.vue` | 重构布局结构、调整CSS | 🔴 高 |
| `src/renderer/components/projects/ChatPanel.vue` | 拆分对话历史显示逻辑 | 🟡 中 |
| `src/renderer/stores/project.js` | 添加UI状态管理 | 🟡 中 |
| `src/main/index.js` | 添加新的文件操作IPC handlers | 🟢 低 |

### 需要新建的文件
| 文件路径 | 功能 | 优先级 |
|---------|-----|--------|
| `src/renderer/components/projects/EnhancedFileTree.vue` | VSCode风格文件树管理器 | 🔴 高 |
| `src/renderer/components/projects/ConversationHistoryView.vue` | 对话历史显示组件 | 🔴 高 |
| `src/renderer/components/projects/EditorPanelHeader.vue` | 编辑器面板头部 | 🟡 中 |
| `src/renderer/components/projects/FileContextMenu.vue` | 文件右键菜单 | 🟡 中 |
| `src/renderer/components/projects/ResizeHandle.vue` | 拖拽调整大小手柄 | 🟢 低 |

### 可以复用的现有组件（无需修改）
- `FileTree.vue` - 作为 EnhancedFileTree 的基础
- `ConversationInput.vue` - 对话输入框
- `MonacoEditor.vue`, `MarkdownEditor.vue` 等所有编辑器组件
- `FileExportMenu.vue` - 文件导出菜单
- `ProjectSidebar.vue` - 项目历史侧边栏

---

## 七、潜在风险和注意事项

### 7.1 技术风险

1. **布局兼容性**
   - ⚠️ 确保在不同屏幕尺寸下布局不崩溃
   - 建议：设置最小宽度限制（min-width: 1280px）

2. **性能问题**
   - ⚠️ 大量文件时FileTree渲染可能卡顿
   - 建议：使用虚拟滚动（vue-virtual-scroller）

3. **文件监听**
   - ⚠️ 文件系统监听可能导致频繁刷新
   - 建议：添加防抖（debounce 500ms）

4. **拖拽冲突**
   - ⚠️ HTML5 DnD API 可能与Electron拖拽冲突
   - 建议：使用 `webContents.setWindowOpenHandler` 禁用默认拖拽

### 7.2 用户体验风险

1. **学习成本**
   - ⚠️ 用户习惯了旧布局，需要引导
   - 建议：首次使用时显示引导提示

2. **向后兼容**
   - ⚠️ 旧的ChatPanel位置用户可能不适应
   - 建议：提供"经典布局"开关（可选）

3. **快捷键冲突**
   - ⚠️ 新增的快捷键可能与现有冲突
   - 建议：统一在设置中管理快捷键配置

### 7.3 数据安全

1. **文件操作**
   - ⚠️ 删除/移动文件需要二次确认
   - 建议：添加确认对话框和撤销功能

2. **拖拽导出**
   - ⚠️ 敏感文件可能被意外拖出
   - 建议：添加权限检查和操作日志

---

## 八、测试清单

### 8.1 功能测试
- [ ] 四栏布局正常显示
- [ ] 文件树选择文件后，编辑器正确打开
- [ ] 对话历史正确显示和滚动
- [ ] 对话输入发送消息后，历史更新
- [ ] 编辑器保存文件成功
- [ ] 折叠/展开面板动画流畅
- [ ] 拖拽调整面板宽度正常
- [ ] 文件右键菜单功能完整
- [ ] 文件拖拽导入/导出正常
- [ ] Git状态标签实时更新

### 8.2 边界测试
- [ ] 空项目（无文件）显示正常
- [ ] 超大文件列表（1000+文件）不卡顿
- [ ] 超长文件名显示省略
- [ ] 深层嵌套文件夹正常展开
- [ ] 窗口最小化后布局不错乱

### 8.3 兼容性测试
- [ ] Windows 10/11 正常运行
- [ ] 4K高分屏显示正常
- [ ] 1366x768低分辨率可用
- [ ] 暗色/亮色主题正常切换

---

## 九、可选增强功能（未来迭代）

1. **多文件标签页**
   - 在编辑器面板顶部显示标签页
   - 支持快捷键切换（Ctrl+Tab）

2. **文件搜索**
   - 在文件树顶部添加搜索框
   - 支持模糊搜索和正则表达式

3. **文件预览缩略图**
   - 图片文件显示缩略图
   - PDF显示首页预览

4. **分组折叠**
   - 文件树支持按文件类型分组
   - 可折叠的分组区域

5. **历史版本对比**
   - Git文件对比视图
   - 时间线滑块浏览历史版本

---

## 十、总结

本重构方案**充分复用现有代码**，主要工作集中在**布局调整**和**组件位置重组**，新增功能主要是**文件树增强**和**对话历史显示优化**。

**核心优势**:
- ✅ 最小化代码改动，降低引入bug风险
- ✅ 保持所有现有功能不受影响
- ✅ 渐进式实施，可分阶段上线
- ✅ 用户体验显著提升，更接近现代IDE

**关键成功因素**:
- 严格按照分步顺序实施
- 每个阶段充分测试后再进入下一阶段
- 保持与用户的沟通，及时调整设计
- 做好代码备份和版本控制
