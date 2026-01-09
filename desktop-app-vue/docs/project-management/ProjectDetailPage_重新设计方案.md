# ProjectDetailPage 重新设计方案

**设计目标**: 满足Phase 1实施计划的所有功能需求
**设计日期**: 2025-12-22

---

## 一、当前问题分析

### 现有布局
```
┌────────────────────────────────────┐
│         顶部工具栏                  │
├──────────┬─────────────────────────┤
│          │                         │
│ 文件树    │    文件编辑器            │
│          │                         │
│ (200px)  │    (flex 1)             │
└──────────┴─────────────────────────┘
```

### 问题
1. ❌ 没有预览面板 - 无法预览图片、Markdown等
2. ❌ 没有AI助手 - 无法进行项目对话
3. ❌ 编辑器过于简陋 - 只有基础textarea
4. ❌ 缺少模式切换 - 无法在编辑/预览模式间切换
5. ❌ Git状态未集成到文件树

---

## 二、新布局设计

### 三栏布局（IDE风格）
```
┌─────────────────────────────────────────────────────┐
│   顶部工具栏（面包屑、保存、Git、预览模式切换）      │
├──────┬───────────────────────┬──────────────────────┤
│      │                       │                      │
│ 文件树 │    编辑器/预览面板      │    AI助手面板         │
│      │                       │   (ChatPanel)        │
│ 200px│    (可切换)            │                      │
│      │                       │    300px             │
│ -Git │    - SimpleEditor     │   - 上下文切换        │
│  状态 │    - PreviewPanel     │   - 消息历史          │
│      │    - Monaco(可选)     │   - 输入框            │
│      │                       │   - 流式响应          │
└──────┴───────────────────────┴──────────────────────┘
```

### 关键特性
- **左侧（文件树）**: 200px固定宽度，显示Git状态标记
- **中间（主内容）**: Flex 1，根据文件类型自动选择编辑器或预览
- **右侧（AI助手）**: 300px固定宽度，可折叠

---

## 三、组件架构

### 组件层级
```
ProjectDetailPage.vue
├── Toolbar（顶部工具栏）
│   ├── 面包屑导航
│   ├── 视图模式切换（编辑/预览/分屏）
│   ├── Git操作按钮
│   └── 保存/关闭按钮
│
├── LeftSidebar（左侧栏）
│   ├── FileTree（文件树）
│   └── Git状态标记
│
├── MainContent（主内容区）
│   ├── SimpleEditor（简易编辑器）- 可编辑文件
│   ├── PreviewPanel（预览面板）- 不可编辑文件
│   └── EmptyState（空状态）- 未选择文件
│
└── RightSidebar（右侧栏）
    ├── ChatPanel（AI对话）
    └── 折叠按钮
```

---

## 四、状态管理

### ViewMode（视图模式）
```javascript
const viewMode = ref('auto'); // 'auto' | 'edit' | 'preview' | 'split'

// auto: 根据文件类型自动选择
//   - 可编辑文件(.js, .md等) → 编辑器
//   - 不可编辑文件(.png, .pdf等) → 预览
// edit: 强制编辑模式（仅可编辑文件）
// preview: 强制预览模式（所有文件）
// split: 分屏模式（左编辑右预览）
```

### FileType判断
```javascript
const fileTypeInfo = computed(() => {
  if (!currentFile.value) return null;

  const fileName = currentFile.value.file_name;
  const ext = fileName.split('.').pop().toLowerCase();

  // 可编辑文本文件
  const editableExtensions = ['js', 'ts', 'vue', 'jsx', 'tsx', 'html', 'css', 'scss', 'less', 'json', 'md', 'txt', 'xml', 'yml', 'yaml'];
  // 图片文件
  const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico'];
  // 文档文件
  const documentExtensions = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'];
  // 数据文件
  const dataExtensions = ['csv', 'json'];
  // 视频文件
  const videoExtensions = ['mp4', 'webm', 'ogg', 'mov', 'avi'];
  // 音频文件
  const audioExtensions = ['mp3', 'wav', 'ogg', 'm4a', 'flac'];

  return {
    extension: ext,
    isEditable: editableExtensions.includes(ext),
    isImage: imageExtensions.includes(ext),
    isDocument: documentExtensions.includes(ext),
    isData: dataExtensions.includes(ext),
    isVideo: videoExtensions.includes(ext),
    isAudio: audioExtensions.includes(ext),
    isCode: ['js', 'ts', 'vue', 'jsx', 'tsx'].includes(ext),
    isMarkdown: ext === 'md',
    category: getFileCategory(ext),
  };
});

function getFileCategory(ext) {
  // 返回文件类别：code / markup / data / image / document / media / other
}
```

---

## 五、核心功能实现

### 5.1 主内容区渲染逻辑

```vue
<div class="main-content">
  <!-- 编辑模式 -->
  <SimpleEditor
    v-if="shouldShowEditor"
    :file="currentFile"
    :content="fileContent"
    @change="handleContentChange"
    @save="handleSave"
  />

  <!-- 预览模式 -->
  <PreviewPanel
    v-else-if="shouldShowPreview"
    :file="currentFile"
    :project-path="resolvedProjectPath"
    :content="fileContent"
  />

  <!-- 空状态 -->
  <EmptyState v-else />
</div>

<script setup>
const shouldShowEditor = computed(() => {
  if (!currentFile.value) return false;
  if (viewMode.value === 'edit') return fileTypeInfo.value?.isEditable;
  if (viewMode.value === 'preview') return false;
  if (viewMode.value === 'auto') return fileTypeInfo.value?.isEditable;
  return false;
});

const shouldShowPreview = computed(() => {
  if (!currentFile.value) return false;
  if (viewMode.value === 'preview') return true;
  if (viewMode.value === 'auto') return !fileTypeInfo.value?.isEditable;
  return false;
});
</script>
```

### 5.2 顶部工具栏增强

```vue
<div class="toolbar">
  <div class="toolbar-left">
    <!-- 面包屑 -->
    <a-breadcrumb>...</a-breadcrumb>
  </div>

  <div class="toolbar-center">
    <!-- 视图模式切换 -->
    <a-radio-group v-model:value="viewMode" button-style="solid" size="small">
      <a-radio-button value="auto">
        <EyeOutlined /> 自动
      </a-radio-button>
      <a-radio-button value="edit" :disabled="!fileTypeInfo?.isEditable">
        <EditOutlined /> 编辑
      </a-radio-button>
      <a-radio-button value="preview">
        <FileSearchOutlined /> 预览
      </a-radio-button>
    </a-radio-group>
  </div>

  <div class="toolbar-right">
    <!-- AI助手开关 -->
    <a-button @click="toggleChatPanel">
      <CommentOutlined />
      {{ showChatPanel ? '隐藏' : '显示' }} AI助手
    </a-button>

    <!-- Git操作 -->
    <a-dropdown>...</a-dropdown>

    <!-- 保存 -->
    <a-button type="primary" :disabled="!hasChanges" @click="handleSave">
      <SaveOutlined /> 保存
    </a-button>
  </div>
</div>
```

### 5.3 文件树集成Git状态

```vue
<FileTree
  :files="projectFiles"
  :git-status="gitStatus"
  :current-file-id="currentFile?.id"
  @select="handleSelectFile"
/>

<script setup>
// Git状态轮询
const gitStatus = ref({});
let gitStatusInterval = null;

async function refreshGitStatus() {
  if (!currentProject.value?.root_path) return;

  try {
    const status = await window.electronAPI.project.gitStatus(currentProject.value.root_path);
    gitStatus.value = status;
  } catch (error) {
    console.error('获取Git状态失败:', error);
  }
}

onMounted(() => {
  refreshGitStatus();
  // 每10秒刷新一次
  gitStatusInterval = setInterval(refreshGitStatus, 10000);
});

onUnmounted(() => {
  if (gitStatusInterval) clearInterval(gitStatusInterval);
});
</script>
```

### 5.4 右侧AI助手集成

```vue
<div v-show="showChatPanel" class="right-sidebar">
  <ChatPanel
    :project-id="projectId"
    :current-file="currentFile"
    :project-files="projectFiles"
    @close="showChatPanel = false"
  />
</div>

<script setup>
const showChatPanel = ref(true); // 默认显示

function toggleChatPanel() {
  showChatPanel.value = !showChatPanel.value;
}
</script>
```

---

## 六、样式设计（CSS）

### 布局容器
```scss
.project-detail-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;

  .toolbar {
    height: 48px;
    border-bottom: 1px solid #e8e8e8;
    display: flex;
    align-items: center;
    padding: 0 16px;
    gap: 16px;

    .toolbar-left {
      flex: 0 0 auto;
    }

    .toolbar-center {
      flex: 1;
      display: flex;
      justify-content: center;
    }

    .toolbar-right {
      flex: 0 0 auto;
      display: flex;
      gap: 8px;
    }
  }

  .content-container {
    flex: 1;
    display: flex;
    overflow: hidden;

    .left-sidebar {
      width: 200px;
      border-right: 1px solid #e8e8e8;
      overflow-y: auto;
    }

    .main-content {
      flex: 1;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }

    .right-sidebar {
      width: 300px;
      border-left: 1px solid #e8e8e8;
      overflow: hidden;

      &.collapsed {
        width: 0;
        border: none;
      }
    }
  }
}
```

### 响应式设计
```scss
@media (max-width: 1200px) {
  .right-sidebar {
    width: 0; // 小屏幕默认隐藏AI助手
    border: none;
  }
}

@media (max-width: 768px) {
  .left-sidebar {
    position: absolute;
    z-index: 10;
    background: white;
    box-shadow: 2px 0 8px rgba(0,0,0,0.1);

    &.collapsed {
      width: 0;
      border: none;
    }
  }

  .toolbar-center {
    display: none; // 隐藏视图模式切换
  }
}
```

---

## 七、性能优化

### 7.1 文件内容懒加载
```javascript
// 只在选中文件时加载内容
watch(() => currentFile.value, async (newFile) => {
  if (!newFile) {
    fileContent.value = '';
    return;
  }

  loading.value = true;
  try {
    // 判断是否需要加载内容
    if (fileTypeInfo.value.isEditable || fileTypeInfo.value.isMarkdown) {
      fileContent.value = await window.electronAPI.file.readContent(newFile.file_path);
    } else if (fileTypeInfo.value.isImage) {
      // 图片使用base64
      fileContent.value = await window.electronAPI.file.readBinary(newFile.file_path);
    }
    // 其他文件不预加载
  } catch (error) {
    message.error('加载文件失败: ' + error.message);
  } finally {
    loading.value = false;
  }
});
```

### 7.2 大文件处理
```javascript
async function handleFileSelect(file) {
  // 检查文件大小
  if (file.file_size > 5 * 1024 * 1024) { // 5MB
    Modal.confirm({
      title: '文件较大',
      content: `文件大小为 ${formatFileSize(file.file_size)}，加载可能较慢。是否继续？`,
      onOk: () => {
        currentFile.value = file;
      },
    });
    return;
  }

  currentFile.value = file;
}
```

### 7.3 Git状态缓存
```javascript
// 只在文件变化时更新Git状态
let gitStatusCache = null;
let lastGitCheckTime = 0;

async function getGitStatus() {
  const now = Date.now();
  if (gitStatusCache && now - lastGitCheckTime < 10000) {
    return gitStatusCache;
  }

  gitStatusCache = await window.electronAPI.project.gitStatus(repoPath);
  lastGitCheckTime = now;
  return gitStatusCache;
}
```

---

## 八、实施步骤

### Step 1: 重构布局结构（1天）
1. 修改 `ProjectDetailPage.vue` 模板部分
2. 添加三栏布局容器
3. 更新样式（SCSS）

### Step 2: 集成SimpleEditor和PreviewPanel（1天）
1. 导入 SimpleEditor 组件（待创建）
2. 更新 PreviewPanel 组件（已存在）
3. 实现视图模式切换逻辑

### Step 3: 集成ChatPanel（1天）
1. 导入 ChatPanel 组件（待创建）
2. 添加折叠/展开功能
3. 连接项目上下文

### Step 4: 文件树Git状态（0.5天）
1. 更新 FileTree 组件支持Git状态显示
2. 添加Git状态轮询
3. 显示文件修改标记

### Step 5: 优化和测试（0.5天）
1. 性能优化（大文件、懒加载）
2. 响应式适配
3. 边界情况测试

**总计**: 3-4天

---

## 九、验收标准

### 功能验收
- ✅ 打开项目 → 显示文件树、空白编辑器、AI助手
- ✅ 点击 .js 文件 → 显示语法高亮编辑器
- ✅ 点击 .png 图片 → 显示图片预览
- ✅ 点击 .md 文件 → 显示Markdown渲染预览
- ✅ 切换到"编辑"模式 → 显示Markdown源码编辑器
- ✅ 修改文件 → 文件树显示 [M] 标记
- ✅ AI助手输入"项目有哪些文件？" → 列出文件列表
- ✅ 保存文件 → 文件系统和数据库同步

### UI验收
- ✅ 布局合理，三栏比例恰当
- ✅ 右侧AI面板可折叠
- ✅ 顶部工具栏按钮清晰可用
- ✅ 响应式适配，小屏幕下正常显示

---

## 十、后续扩展（Phase 2）

完成重新设计后，可以继续添加：
1. Monaco Editor 替换 SimpleEditor
2. 分屏模式（左编辑右预览）
3. 开发服务器预览（Vue/React项目）
4. 文件监听（外部编辑同步）
5. 代码补全、跳转等IDE功能

---

**文档版本**: v1.0
**创建日期**: 2025-12-22
**维护者**: Claude Code
