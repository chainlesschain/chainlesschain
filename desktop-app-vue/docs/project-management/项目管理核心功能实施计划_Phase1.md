# 项目管理核心功能详细实施计划 - Phase 1

**基于文档**:
- `项目管理增强实施计划.md`
- `实施计划_系统设计对比与差距分析.md`

**目标**: 完成项目管理核心功能的MVP版本，实现文件预览和基础编辑能力

**预计工期**: 2-3周
**当前状态**: 已完成基础框架（FileTree, PreviewPanel已创建）

---

## 阶段概述

### 已完成 ✅
1. 项目CRUD基础（数据库表、IPC接口）
2. FileTree组件（文件树展示）
3. PreviewPanel组件框架（已创建但功能不完整）
4. 文件同步基础架构（FileSyncManager）
5. 项目路径解析（ProjectConfig）

### 待完成（本阶段）🎯
1. **文件预览功能完善**（不同类型不同展示方式）
2. **文件编辑器集成**
3. **项目级AI助手**（ChatPanel）
4. **Git状态显示**

---

## 详细任务拆解

### 任务组 1: 文件预览功能完善 ⭐⭐⭐ 高优先级

#### 任务 1.1: 完善 PreviewPanel 组件（2天）

**当前状态**: 组件已创建，但预览逻辑不完整

**需要实现的功能**:

1. **图片预览**
   - 支持格式: PNG, JPG, JPEG, GIF, SVG, WebP
   - 功能: 缩放、旋转、原始大小查看
   - UI组件: 使用 `a-image` 预览组件

2. **文档预览**
   - **Markdown**: 使用 `marked` + `highlight.js` 渲染
   - **PDF**: 使用 `vue-pdf-embed` 组件
   - **Word/Excel**: 显示提示"请使用外部应用打开"，提供下载按钮

3. **代码文件预览**
   - 支持格式: .js, .ts, .vue, .jsx, .tsx, .html, .css, .scss, .json, .xml, .yml, .yaml
   - 使用 `highlight.js` 语法高亮
   - 只读模式显示（后续步骤添加编辑功能）

4. **数据文件预览**
   - **CSV**: 使用表格展示（ant-design-vue a-table）
   - **JSON**: 使用语法高亮 + 树形展示
   - **Excel**: 提示下载或使用外部应用

5. **多媒体预览**
   - **视频**: HTML5 video标签播放（MP4, WebM）
   - **音频**: HTML5 audio标签播放（MP3, WAV, OGG）

6. **其他文件**
   - 显示文件信息（大小、修改时间、类型）
   - 提供下载按钮
   - 提供"使用系统默认程序打开"按钮

**关键代码文件**:
```
desktop-app-vue/src/renderer/components/projects/PreviewPanel.vue
```

**依赖安装**:
```bash
npm install marked highlight.js vue-pdf-embed papaparse
```

**验收标准**:
- ✅ 打开 .png 图片 → 显示图片预览，支持缩放
- ✅ 打开 .md 文件 → 渲染为HTML，支持代码高亮
- ✅ 打开 .js 文件 → 语法高亮显示代码
- ✅ 打开 .csv 文件 → 表格展示数据
- ✅ 打开 .pdf 文件 → PDF预览
- ✅ 打开 .mp4 视频 → 视频播放器

---

#### 任务 1.2: 实现PreviewManager服务增强（1天）

**文件**: `desktop-app-vue/src/main/preview/preview-manager.js`

**当前状态**: 已实现基础框架

**需要完善**:

1. **静态文件服务器**
   - Express服务器已实现，需添加MIME类型支持
   - 支持热重载（chokidar监听文件变化）

2. **开发服务器检测**
   - 自动检测项目类型（package.json）
   - 支持常见框架:
     - Vue/Vite: `npm run dev`
     - React/Vite: `npm run dev`
     - Next.js: `npm run dev`
     - 纯HTML: 静态服务器

3. **端口管理**
   - 使用 `get-port` 动态分配端口（3000-3100）
   - 记录已使用端口，避免冲突

**验收标准**:
- ✅ 启动静态服务器 → 访问 `http://localhost:3000/index.html`
- ✅ 检测到 Vue项目 → 自动运行 `npm run dev`
- ✅ 端口冲突时 → 自动使用下一个可用端口

---

#### 任务 1.3: 添加文件内容读取IPC接口（0.5天）

**需求**: 前端需要读取文件内容用于预览

**实现**:
1. 在 `index.js` 添加新的IPC handler:
   ```javascript
   ipcMain.handle('file:read-content', async (_event, filePath) => {
     const content = await fs.promises.readFile(filePath, 'utf-8');
     return content;
   });

   ipcMain.handle('file:read-binary', async (_event, filePath) => {
     const content = await fs.promises.readFile(filePath);
     return content.toString('base64');
   });
   ```

2. 在 `preload.js` 暴露API:
   ```javascript
   file: {
     readContent: (filePath) => ipcRenderer.invoke('file:read-content', filePath),
     readBinary: (filePath) => ipcRenderer.invoke('file:read-binary', filePath),
   }
   ```

**关键文件**:
- `desktop-app-vue/src/main/index.js`
- `desktop-app-vue/src/preload/index.js`

**验收标准**:
- ✅ 调用 `window.electronAPI.file.readContent(path)` → 返回文件文本内容
- ✅ 调用 `window.electronAPI.file.readBinary(path)` → 返回base64编码的二进制内容

---

### 任务组 2: 文件编辑器（简易版）⭐⭐ 中优先级

#### 任务 2.1: 创建 SimpleEditor 组件（1天）

**说明**: 暂时不使用Monaco Editor（太复杂），先用简单的textarea + 语法高亮实现基础编辑

**功能**:
1. 文本文件编辑（.txt, .md, .js, .css, .html, .json等）
2. 语法高亮（使用 CodeMirror 6）
3. 自动保存（防抖500ms）
4. 行号显示
5. 查找/替换

**依赖**:
```bash
npm install @codemirror/state @codemirror/view @codemirror/lang-javascript @codemirror/lang-html @codemirror/lang-css @codemirror/lang-json @codemirror/lang-markdown
```

**关键代码**:
```vue
<!-- SimpleEditor.vue -->
<template>
  <div class="simple-editor">
    <div class="editor-toolbar">
      <a-button @click="handleSave" :loading="saving">
        <SaveOutlined /> 保存
      </a-button>
      <span class="status">{{ statusText }}</span>
    </div>
    <div ref="editorRef" class="editor-container"></div>
  </div>
</template>

<script setup>
import { ref, onMounted, watch } from 'vue';
import { EditorView, basicSetup } from '@codemirror/basic-setup';
import { javascript } from '@codemirror/lang-javascript';
import { html } from '@codemirror/lang-html';
// ... 其他语言支持

const props = defineProps({
  file: Object,
  content: String,
});

const emit = defineEmits(['save', 'change']);

const editorRef = ref(null);
let editorView = null;

onMounted(() => {
  editorView = new EditorView({
    doc: props.content,
    extensions: [
      basicSetup,
      getLanguageExtension(props.file.file_name),
      EditorView.updateListener.of(v => {
        if (v.docChanged) {
          emit('change', v.state.doc.toString());
        }
      }),
    ],
    parent: editorRef.value,
  });
});

function getLanguageExtension(fileName) {
  if (fileName.endsWith('.js')) return javascript();
  if (fileName.endsWith('.html')) return html();
  // ... 其他语言
  return [];
}

async function handleSave() {
  const content = editorView.state.doc.toString();
  emit('save', content);
}
</script>
```

**关键文件**:
- `desktop-app-vue/src/renderer/components/projects/SimpleEditor.vue` (NEW)

**验收标准**:
- ✅ 打开 .js 文件 → 显示语法高亮的编辑器
- ✅ 修改内容 → 自动触发 change 事件
- ✅ 点击保存按钮 → 调用文件同步API

---

#### 任务 2.2: 集成SimpleEditor到ProjectDetailPage（0.5天）

**实现**:
1. 在 `ProjectDetailPage.vue` 添加编辑模式切换
2. 当文件类型可编辑时，显示 `SimpleEditor`
3. 其他文件类型显示 `PreviewPanel`

**代码示例**:
```vue
<template>
  <div class="project-detail-page">
    <!-- 文件树 -->
    <FileTree @select="handleFileSelect" />

    <!-- 主内容区 -->
    <div class="main-content">
      <!-- 编辑器（可编辑文件） -->
      <SimpleEditor
        v-if="currentFile && isEditable(currentFile)"
        :file="currentFile"
        :content="fileContent"
        @save="handleFileSave"
      />

      <!-- 预览（不可编辑文件或预览模式） -->
      <PreviewPanel
        v-else
        :file="currentFile"
        :project-path="resolvedProjectPath"
      />
    </div>
  </div>
</template>

<script setup>
const isEditable = (file) => {
  const editableExtensions = ['.txt', '.md', '.js', '.ts', '.vue', '.html', '.css', '.json', '.xml', '.yml'];
  return editableExtensions.some(ext => file.file_name.endsWith(ext));
};

async function handleFileSave(content) {
  await window.electronAPI.fileSync.save({
    fileId: currentFile.value.id,
    content,
    projectId: projectId.value,
  });
  message.success('文件已保存');
}
</script>
```

**验收标准**:
- ✅ 点击 .js 文件 → 显示编辑器
- ✅ 点击 .png 图片 → 显示预览面板
- ✅ 编辑代码并保存 → 文件系统和数据库同步更新

---

### 任务组 3: 项目级AI助手（ChatPanel）⭐⭐⭐ 高优先级

#### 任务 3.1: 创建 ChatPanel 组件（2天）

**功能需求**:
1. 消息列表显示（用户消息 + AI回复）
2. 输入框（支持多行、Ctrl+Enter发送）
3. 上下文模式切换:
   - **项目上下文**: 包含项目文件结构
   - **文件上下文**: 包含当前打开文件的内容
   - **无上下文**: 纯对话
4. 发送消息到LLM
5. 流式响应显示
6. 对话历史持久化

**组件结构**:
```vue
<!-- ChatPanel.vue -->
<template>
  <div class="chat-panel">
    <!-- 上下文选择器 -->
    <div class="context-selector">
      <a-radio-group v-model="contextMode">
        <a-radio-button value="none">普通对话</a-radio-button>
        <a-radio-button value="project">项目上下文</a-radio-button>
        <a-radio-button value="file">当前文件</a-radio-button>
      </a-radio-group>
    </div>

    <!-- 消息列表 -->
    <div class="messages-container" ref="messagesRef">
      <div
        v-for="msg in messages"
        :key="msg.id"
        :class="['message', msg.role]"
      >
        <div class="message-avatar">
          <UserOutlined v-if="msg.role === 'user'" />
          <RobotOutlined v-else />
        </div>
        <div class="message-content">
          <div v-if="msg.role === 'assistant'" v-html="renderMarkdown(msg.content)"></div>
          <div v-else>{{ msg.content }}</div>
        </div>
      </div>
    </div>

    <!-- 输入框 -->
    <div class="input-container">
      <a-textarea
        v-model="userInput"
        :rows="3"
        placeholder="输入消息... (Ctrl+Enter发送)"
        @keydown.ctrl.enter="sendMessage"
      />
      <a-button
        type="primary"
        :loading="loading"
        @click="sendMessage"
      >
        <SendOutlined /> 发送
      </a-button>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue';
import { marked } from 'marked';

const props = defineProps({
  projectId: String,
  currentFile: Object,
});

const contextMode = ref('none');
const messages = ref([]);
const userInput = ref('');
const loading = ref(false);

async function sendMessage() {
  if (!userInput.value.trim()) return;

  // 添加用户消息
  const userMessage = {
    id: Date.now(),
    role: 'user',
    content: userInput.value,
  };
  messages.value.push(userMessage);

  // 构建上下文
  const context = await buildContext();

  // 清空输入
  const prompt = userInput.value;
  userInput.value = '';
  loading.value = true;

  try {
    // 调用LLM API
    const response = await window.electronAPI.llm.query(prompt, {
      conversationId: `project-${props.projectId}`,
      context,
    });

    // 添加AI回复
    messages.value.push({
      id: Date.now() + 1,
      role: 'assistant',
      content: response.content,
    });
  } catch (error) {
    console.error('AI回复失败:', error);
    message.error('AI回复失败: ' + error.message);
  } finally {
    loading.value = false;
  }
}

async function buildContext() {
  if (contextMode.value === 'none') return '';

  if (contextMode.value === 'project') {
    // 获取项目文件列表
    const files = await window.electronAPI.project.getFiles(props.projectId);
    return `当前项目包含以下文件:\n${files.map(f => f.file_path).join('\n')}`;
  }

  if (contextMode.value === 'file' && props.currentFile) {
    // 读取当前文件内容
    const content = await window.electronAPI.file.readContent(props.currentFile.file_path);
    return `当前文件 ${props.currentFile.file_name} 的内容:\n\`\`\`\n${content}\n\`\`\``;
  }

  return '';
}

function renderMarkdown(text) {
  return marked(text);
}
</script>
```

**关键文件**:
- `desktop-app-vue/src/renderer/components/projects/ChatPanel.vue` (NEW)

**验收标准**:
- ✅ 输入"你好" → AI回复"你好！我是项目助手..."
- ✅ 选择"项目上下文" + 输入"项目有哪些文件？" → AI列出项目文件
- ✅ 选择"文件上下文" + 输入"这个文件做什么？" → AI基于文件内容回答

---

#### 任务 3.2: 对话持久化（1天）

**实现**:
1. 在数据库中保存对话历史（已有 conversations 和 messages 表）
2. 页面加载时恢复历史对话
3. 支持清空对话

**数据库操作**:
```javascript
// database.js 中添加方法
createConversation(projectId, contextType) {
  const id = uuid();
  this.db.run(`
    INSERT INTO conversations (id, project_id, context_type, created_at)
    VALUES (?, ?, ?, ?)
  `, [id, projectId, contextType, Date.now()]);
  return id;
}

saveMessage(conversationId, role, content) {
  this.db.run(`
    INSERT INTO messages (id, conversation_id, role, content, created_at)
    VALUES (?, ?, ?, ?, ?)
  `, [uuid(), conversationId, role, content, Date.now()]);
}

getConversationMessages(conversationId) {
  return this.db.prepare(`
    SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC
  `).all(conversationId);
}
```

**验收标准**:
- ✅ 发送消息 → 数据库保存
- ✅ 刷新页面 → 对话历史恢复
- ✅ 点击"清空对话" → 历史清除

---

### 任务组 4: Git状态显示 ⭐ 低优先级

#### 任务 4.1: FileTree显示Git状态（1天）

**功能**:
1. 定期调用 `project:git-status` 获取文件状态
2. 在文件树中显示标记:
   - [M] Modified（橙色）
   - [A] Added（绿色）
   - [D] Deleted（红色）
   - [U] Untracked（蓝色）

**实现**:
```vue
<!-- FileTree.vue -->
<template>
  <a-tree
    :tree-data="treeDataWithGitStatus"
    @select="handleSelect"
  >
    <template #title="{ file }">
      <span>{{ file.name }}</span>
      <a-tag v-if="file.gitStatus" :color="getGitStatusColor(file.gitStatus)">
        {{ file.gitStatus }}
      </a-tag>
    </template>
  </a-tree>
</template>

<script setup>
const gitStatus = ref({});

// 每10秒刷新一次Git状态
setInterval(async () => {
  const status = await window.electronAPI.project.gitStatus(repoPath);
  gitStatus.value = status;
}, 10000);

const treeDataWithGitStatus = computed(() => {
  return addGitStatusToTree(treeData.value, gitStatus.value);
});

function getGitStatusColor(status) {
  const colors = {
    M: 'orange',
    A: 'green',
    D: 'red',
    U: 'blue',
  };
  return colors[status] || 'default';
}
</script>
```

**验收标准**:
- ✅ 修改文件 → 文件树显示 [M] 标记
- ✅ 新建文件 → 文件树显示 [U] 标记

---

## 实施时间线

### Week 1: 文件预览 + 基础编辑

**Day 1-2**: 任务 1.1 - 完善 PreviewPanel（图片、Markdown、代码预览）
**Day 3**: 任务 1.2 + 1.3 - PreviewManager增强 + 文件读取IPC
**Day 4-5**: 任务 2.1 + 2.2 - SimpleEditor组件 + 集成

**Week 1 交付物**:
- ✅ 完整的文件预览功能（支持10+种文件类型）
- ✅ 简易代码编辑器（语法高亮、自动保存）

---

### Week 2: AI助手 + Git状态

**Day 1-2**: 任务 3.1 - ChatPanel组件
**Day 3**: 任务 3.2 - 对话持久化
**Day 4**: 任务 4.1 - Git状态显示
**Day 5**: 整体测试 + Bug修复

**Week 2 交付物**:
- ✅ 项目级AI助手（支持上下文对话）
- ✅ 对话历史持久化
- ✅ Git状态实时显示

---

## 验收标准（整体）

### 场景1: 查看项目文件
```
1. 打开项目详情页
2. 点击 data.csv 文件 → 表格预览数据
3. 点击 logo.png 文件 → 图片预览，支持缩放
4. 点击 README.md 文件 → Markdown渲染预览
5. 点击 main.js 文件 → 语法高亮的代码预览
```

### 场景2: 编辑文件
```
1. 打开 main.js 文件
2. 点击"编辑"按钮 → 切换到编辑模式
3. 修改代码
4. Ctrl+S 保存 → 文件系统和数据库同步更新
5. 查看文件树 → 显示 [M] 标记
```

### 场景3: AI助手对话
```
1. 打开ChatPanel
2. 选择"项目上下文"
3. 输入"项目有哪些文件？" → AI列出文件列表
4. 选择"文件上下文"
5. 输入"这个文件做什么？" → AI分析代码功能
6. 关闭页面重新打开 → 对话历史保留
```

---

## 技术依赖

### 新增NPM包
```json
{
  "dependencies": {
    "marked": "^11.0.0",
    "highlight.js": "^11.9.0",
    "vue-pdf-embed": "^2.0.0",
    "papaparse": "^5.4.1",
    "@codemirror/state": "^6.4.0",
    "@codemirror/view": "^6.23.0",
    "@codemirror/lang-javascript": "^6.2.1",
    "@codemirror/lang-html": "^6.4.7",
    "@codemirror/lang-css": "^6.2.1",
    "@codemirror/lang-json": "^6.0.1",
    "@codemirror/lang-markdown": "^6.2.4"
  }
}
```

### 安装命令
```bash
cd desktop-app-vue
npm install marked highlight.js vue-pdf-embed papaparse @codemirror/state @codemirror/view @codemirror/lang-javascript @codemirror/lang-html @codemirror/lang-css @codemirror/lang-json @codemirror/lang-markdown
```

---

## 风险与应对

### 风险1: 大文件预览性能问题
**应对**:
- 文件 > 5MB 时显示警告
- 提供"下载"或"外部打开"选项
- 大文件只加载前1000行

### 风险2: AI回复速度慢
**应对**:
- 使用流式响应（SSE）
- 显示"正在思考..."加载动画
- 提供停止生成按钮

### 风险3: Git状态轮询影响性能
**应对**:
- 轮询间隔设为10秒
- 文件数量 > 1000时禁用自动刷新
- 提供手动刷新按钮

---

## 下一步（Phase 2）

完成Phase 1后，继续实施：
1. Monaco Editor集成（完整代码编辑器）
2. 开发服务器预览（Vue/React项目）
3. 文件监听（外部编辑同步）
4. Git操作增强（可视化提交、推送、拉取）

---

**文档版本**: v1.0
**创建日期**: 2025-12-22
**维护者**: Claude Code
