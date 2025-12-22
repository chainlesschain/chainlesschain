# 项目管理增强实施计划

## 需求概述

增强 ChainlessChain 桌面应用的项目管理功能，解决以下问题：
1. **项目生成后无法继续对话** - 需要项目级 AI 助手
2. **无法看到实际效果** - 需要预览功能（内置 + 开发服务器 + 文件管理器）
3. **编辑器功能简陋** - 需要集成 Monaco Editor（VSCode 同款）
4. **文件存储不一致** - 需要数据库与文件系统双向同步

## 现状分析

### 存在的问题
1. **文件只存储在数据库**：编辑器修改不写入文件系统，Git 操作无法同步
2. **对话系统与项目分离**：全局对话无项目上下文，无项目级 AI 助手
3. **简陋的 textarea 编辑器**：无语法高亮、代码补全等现代编辑器功能
4. **缺少预览功能**：无法直接查看项目运行效果

### 现有基础
- ✅ 完整的项目 CRUD 系统
- ✅ Git 集成（isomorphic-git）
- ✅ LLM 管理器（多提供商支持）
- ✅ 对话 Store（仅内存，无持久化）
- ✅ FileTree + FileEditor 组件

## 核心架构设计

### 文件双向同步机制
```
编辑器修改 → 同时写入数据库 + 文件系统
Git 操作后 → 文件系统更新 → 同步到数据库 → 刷新编辑器
外部编辑 → chokidar 监听 → 提示用户重新加载
```

### 数据库 Schema 调整

**新增表：file_sync_state**
```sql
CREATE TABLE file_sync_state (
  file_id TEXT PRIMARY KEY,
  fs_hash TEXT,          -- 文件系统内容 SHA256
  db_hash TEXT,          -- 数据库内容 SHA256
  last_synced_at INTEGER,
  sync_direction TEXT,   -- 'db_to_fs' | 'fs_to_db' | 'bidirectional'
  conflict_detected INTEGER DEFAULT 0,
  FOREIGN KEY (file_id) REFERENCES project_files(id)
);
```

**扩展表：conversations**
```sql
ALTER TABLE conversations ADD COLUMN project_id TEXT;
ALTER TABLE conversations ADD COLUMN context_type TEXT DEFAULT 'global';
ALTER TABLE conversations ADD COLUMN context_data TEXT;
```

**扩展表：project_files**
```sql
ALTER TABLE project_files ADD COLUMN fs_path TEXT;
```

## 实施步骤（共 12 步）

### 步骤 1：数据库 Schema 升级 ⭐ 简单
**任务：**
- 创建 `file_sync_state` 表
- 为 `conversations` 添加 `project_id`, `context_type`, `context_data` 字段
- 为 `project_files` 添加 `fs_path` 字段
- 创建必要的索引

**关键文件：**
- `desktop-app-vue/src/main/database.js`

**验证：**
- 启动应用，检查数据库表结构
- 测试插入记录无报错

---

### 步骤 2：FileSyncManager 核心实现 ⭐⭐ 中等
**任务：**
- 创建 `src/main/file-sync/sync-manager.js`
- 实现 `saveFile()` 方法（双向写入数据库 + 文件系统）
- 实现哈希计算和冲突检测
- 添加 IPC 接口：`file-sync:save`

**核心逻辑：**
```javascript
async saveFile(fileId, content, projectId) {
  // 1. 计算内容哈希
  const contentHash = crypto.createHash('sha256').update(content).digest('hex');

  // 2. 更新数据库
  await database.updateProjectFile({ id: fileId, content, content_hash: contentHash });

  // 3. 写入文件系统
  const fsPath = path.join(project.root_path, file.file_path);
  await fs.promises.writeFile(fsPath, content, 'utf8');

  // 4. 更新同步状态
  await database.upsertFileSyncState({ file_id: fileId, fs_hash: contentHash, db_hash: contentHash });
}
```

**关键文件：**
- `desktop-app-vue/src/main/file-sync/sync-manager.js` (NEW)
- `desktop-app-vue/src/main/index.js` (添加 IPC)

**验证：**
- 编辑器保存文件 → 检查文件系统是否创建/更新文件
- 比对数据库内容与文件内容一致性

---

### 步骤 3：chokidar 文件监听 ⭐⭐ 中等
**任务：**
- 安装 `chokidar` 依赖
- 实现 `watchProject()` 方法
- 监听 `add`, `change`, `unlink` 事件
- 实现文件系统 → 数据库同步
- 添加 IPC 接口：`file-sync:watch-project`, `file-sync:stop-watch`

**核心逻辑：**
```javascript
async watchProject(projectId, rootPath) {
  const watcher = chokidar.watch(rootPath, {
    ignored: /(^|[\/\\])\.|node_modules|\.git/,
    awaitWriteFinish: { stabilityThreshold: 500 }
  });

  watcher.on('change', async (fsPath) => {
    // 读取文件内容
    const content = await fs.promises.readFile(fsPath, 'utf8');
    const contentHash = crypto.createHash('sha256').update(content).digest('hex');

    // 查找数据库记录
    const file = await findFileByPath(projectId, relativePath);

    // 检测冲突（数据库和文件系统都被修改）
    const syncState = await getFileSyncState(file.id);
    if (syncState.db_hash !== syncState.fs_hash) {
      this.emit('sync-conflict', { fileId: file.id });
      return;
    }

    // 更新数据库
    await updateProjectFile({ id: file.id, content });

    // 通知前端刷新
    mainWindow.webContents.send('file-reloaded', { fileId: file.id, content });
  });
}
```

**关键文件：**
- `desktop-app-vue/src/main/file-sync/sync-manager.js`
- `desktop-app-vue/package.json` (添加 chokidar 依赖)

**验证：**
- 在 VSCode 中修改项目文件 → 检查数据库是否更新
- 在编辑器中打开文件 → 弹窗提示重新加载

---

### 步骤 4：Monaco Editor 组件 ⭐⭐ 中等
**任务：**
- 安装 Monaco 依赖：`monaco-editor`, `vite-plugin-monaco-editor`
- 配置 Vite 插件
- 创建 `MonacoEditor.vue` 组件
- 实现语法高亮、快捷键、自动保存

**Vite 配置：**
```javascript
// vite.config.js
import monacoEditorPlugin from 'vite-plugin-monaco-editor';

export default {
  plugins: [
    vue(),
    monacoEditorPlugin({
      languageWorkers: ['editorWorkerService', 'typescript', 'json', 'css', 'html']
    })
  ]
}
```

**组件接口：**
```vue
<MonacoEditor
  v-model="content"
  :file="currentFile"
  @save="handleSave"
  @change="handleChange"
/>
```

**关键文件：**
- `desktop-app-vue/src/renderer/components/projects/MonacoEditor.vue` (NEW)
- `desktop-app-vue/vite.config.js`
- `desktop-app-vue/package.json`

**验证：**
- 打开 `.js` 文件 → 检查 JavaScript 语法高亮
- 按 `Ctrl+S` → 触发保存事件
- 输入代码 → 检查自动补全

---

### 步骤 5：替换 FileEditor 组件 ⭐ 简单
**任务：**
- 修改 `FileEditor.vue`，使用 `MonacoEditor` 替换 `<textarea>`
- 保留原有的工具栏、状态栏
- 适配自动保存逻辑
- 调用 `file-sync:save` IPC

**关键文件：**
- `desktop-app-vue/src/renderer/components/projects/FileEditor.vue`

**验证：**
- 项目详情页打开文件 → Monaco 编辑器正常显示
- 编辑并保存 → 文件系统同步更新

---

### 步骤 6：Conversation 数据库持久化 ⭐ 简单
**任务：**
- 在 `database.js` 添加对话 CRUD 方法：
  - `createConversation()`
  - `getConversationByProject(projectId)`
  - `updateConversation()`
  - `createMessage()`
  - `getMessagesByConversation(conversationId)`
- 添加 IPC 接口

**关键文件：**
- `desktop-app-vue/src/main/database.js`
- `desktop-app-vue/src/main/index.js`

**验证：**
- 创建对话 → 检查数据库插入
- 关闭应用重新打开 → 对话历史保留

---

### 步骤 7：ChatPanel 组件 ⭐⭐⭐ 复杂
**任务：**
- 创建 `ChatPanel.vue` 侧边栏组件
- 实现三种上下文模式：项目、文件、自定义
- 构建项目上下文（文件结构）
- 构建文件上下文（当前文件内容）
- 集成 LLM 查询
- 显示 RAG 引用（如果有）

**组件结构：**
```vue
<div class="chat-panel">
  <div class="context-selector">
    <a-radio-group v-model="contextMode">
      <a-radio-button value="project">项目上下文</a-radio-button>
      <a-radio-button value="file">当前文件</a-radio-button>
    </a-radio-group>
  </div>

  <div class="messages-container">
    <div v-for="msg in messages" :class="msg.role">
      {{ msg.content }}
    </div>
  </div>

  <div class="input-container">
    <a-textarea v-model="userInput" @keydown.enter.ctrl="sendMessage" />
  </div>
</div>
```

**关键文件：**
- `desktop-app-vue/src/renderer/components/projects/ChatPanel.vue` (NEW)
- `desktop-app-vue/src/renderer/stores/conversation.js` (增强)

**验证：**
- 在项目详情页打开聊天面板
- 选择"项目上下文" → 发送"项目有哪些文件？" → AI 回复文件列表
- 选择"当前文件" → 发送"这个文件做什么？" → AI 基于文件内容回复

---

### 步骤 8：ConversationStore 增强 ⭐⭐ 中等
**任务：**
- 添加 `loadOrCreateProjectConversation(projectId)` 方法
- 修改 `createNewConversation()` 支持 `project_id` 参数
- 添加 `buildProjectContext()` 上下文构建逻辑
- 实现 Token 限制和消息裁剪
- 添加对话持久化 `saveCurrentConversation()`

**关键文件：**
- `desktop-app-vue/src/renderer/stores/conversation.js`

**验证：**
- 打开项目 A → 对话 → 切换到项目 B → 对话独立
- 发送长对话 → 检查 Token 裁剪生效

---

### 步骤 9：PreviewManager 实现 ⭐⭐ 中等
**任务：**
- 创建 `src/main/preview/preview-manager.js`
- 实现静态文件服务器（Express）
- 实现开发服务器启动（npm run dev）
- 实现文件管理器打开（shell.openPath）
- 端口动态分配（get-port）
- 添加 IPC 接口

**依赖安装：**
```bash
npm install express get-port
```

**关键方法：**
- `startStaticServer(projectId, rootPath)` → 返回 `{ url, port }`
- `startDevServer(projectId, rootPath, command)` → 解析输出获取端口
- `openInExplorer(rootPath)` → shell.openPath
- `stopServer(projectId)`

**关键文件：**
- `desktop-app-vue/src/main/preview/preview-manager.js` (NEW)
- `desktop-app-vue/src/main/index.js` (添加 IPC)

**验证：**
- 静态预览：启动 → 访问 `http://localhost:3000` → 显示 HTML
- 开发服务器：启动 → 自动检测端口 → 前端显示 URL
- 文件管理器：点击 → Windows 资源管理器打开项目目录

---

### 步骤 10：PreviewPanel 组件 ⭐ 简单
**任务：**
- 创建 `PreviewPanel.vue` 组件
- 三种预览模式切换
- iframe 嵌入预览
- 启动/停止服务器按钮
- 外部浏览器打开

**关键文件：**
- `desktop-app-vue/src/renderer/components/projects/PreviewPanel.vue` (NEW)
- `desktop-app-vue/src/renderer/pages/projects/ProjectDetailPage.vue` (集成)

**验证：**
- 切换预览模式 → UI 更新
- 启动预览 → iframe 显示页面或外部浏览器打开

---

### 步骤 11：Git 操作增强 ⭐⭐ 中等
**任务：**
- 修改 `project:git-commit` IPC：提交前调用 `fileSyncManager.flushAllChanges()`
- 修改 `project:git-pull` IPC：拉取后调用 `fileSyncManager.syncFromFilesystem()`
- 添加 `project:git-status` 实时获取文件状态
- 发送 `git-pulled` 事件通知前端刷新

**关键文件：**
- `desktop-app-vue/src/main/index.js` (Git IPC handlers)
- `desktop-app-vue/src/main/file-sync/sync-manager.js`

**验证：**
- Git commit → 文件从数据库同步到文件系统 → 提交成功
- Git pull → 文件从文件系统同步到数据库 → 编辑器刷新

---

### 步骤 12：FileTree Git 状态显示 ⭐ 简单
**任务：**
- 在 `projectStore` 添加 `gitStatus` 状态
- 定期调用 `project:git-status` 更新状态
- `FileTree.vue` 显示 M/U 标记

**UI 示例：**
```
📁 src
  📄 App.vue [M]        ← 橙色 Modified 标记
  📄 main.js [U]        ← 绿色 Untracked 标记
  📄 utils.js
```

**关键文件：**
- `desktop-app-vue/src/renderer/components/projects/FileTree.vue`
- `desktop-app-vue/src/renderer/stores/project.js`

**验证：**
- 修改文件 → 文件树显示 [M] 标记
- 新建文件 → 文件树显示 [U] 标记
- Git add → 标记消失

---

## 集成到 ProjectDetailPage

最终布局结构：
```vue
<ProjectDetailPage>
  <div class="layout">
    <div class="left-sidebar">
      <FileTree :files="files" @select="openFile" />
    </div>

    <div class="main-content">
      <div class="editor-container">
        <FileEditor v-if="currentFile">
          <MonacoEditor ... />
        </FileEditor>

        <PreviewPanel v-if="showPreview" />
      </div>
    </div>

    <div class="right-sidebar">
      <ChatPanel :projectId="projectId" />
    </div>
  </div>
</ProjectDetailPage>
```

## 关键技术决策

1. **Monaco 打包**：使用 `vite-plugin-monaco-editor`（Vite 官方推荐）
2. **文件监听**：使用 `chokidar`（跨平台兼容，性能优于 fs.watch）
3. **对话上下文**：动态裁剪，最多 8000 tokens
4. **端口管理**：`get-port` 动态分配 3000-3100 范围
5. **冲突处理**：弹窗提示用户选择（文件系统/数据库/手动合并）

## 风险缓解

### 大文件性能
- 文件 > 5MB → 只读模式
- Monaco 虚拟滚动（内置）

### 同步冲突
- 文件监听检测冲突 → 弹窗提示
- Git 操作前锁定编辑

### 资源管理
- 最多 3 个预览服务器
- LRU 淘汰策略

## 关键文件清单

### 新建文件（5 个）
- `desktop-app-vue/src/main/file-sync/sync-manager.js` - 文件同步核心
- `desktop-app-vue/src/renderer/components/projects/MonacoEditor.vue` - Monaco 编辑器
- `desktop-app-vue/src/renderer/components/projects/ChatPanel.vue` - 项目 AI 助手
- `desktop-app-vue/src/main/preview/preview-manager.js` - 预览管理器
- `desktop-app-vue/src/renderer/components/projects/PreviewPanel.vue` - 预览面板

### 重度修改文件（5 个）
- `desktop-app-vue/src/main/database.js` - Schema 升级 + 对话 CRUD
- `desktop-app-vue/src/main/index.js` - 新增 IPC 接口（file-sync, preview, conversation）
- `desktop-app-vue/src/renderer/stores/conversation.js` - 项目关联 + 持久化
- `desktop-app-vue/src/renderer/components/projects/FileEditor.vue` - 集成 Monaco
- `desktop-app-vue/src/renderer/pages/projects/ProjectDetailPage.vue` - 布局调整（添加 ChatPanel 和 PreviewPanel）

### 轻度修改文件（3 个）
- `desktop-app-vue/src/renderer/components/projects/FileTree.vue` - Git 状态显示
- `desktop-app-vue/src/renderer/stores/project.js` - Git 状态管理
- `desktop-app-vue/vite.config.js` - Monaco 插件配置

## 测试验证

每个步骤完成后必须验证：
1. **步骤 1-3**：文件同步测试（编辑器 → 文件系统 → 数据库 → 外部编辑）
2. **步骤 4-5**：Monaco 功能测试（语法高亮、补全、快捷键）
3. **步骤 6-8**：对话测试（项目上下文、文件上下文、持久化）
4. **步骤 9-10**：预览测试（静态、开发服务器、文件管理器）
5. **步骤 11-12**：Git 集成测试（commit 同步、pull 刷新、状态显示）

最终集成测试：
- 创建项目 → 编辑文件 → 保存 → 预览 → 对话 → Git 提交 → 拉取 → 完整流程

## 预估工作量

- **简单步骤**（1, 5, 6, 10, 12）：每步 1-2 小时，共 5-10 小时
- **中等步骤**（2, 3, 4, 8, 9, 11）：每步 3-5 小时，共 18-30 小时
- **复杂步骤**（7）：6-8 小时

**总计**：29-48 小时（约 4-6 个工作日）

## 依赖安装

```bash
cd desktop-app-vue
npm install monaco-editor vite-plugin-monaco-editor chokidar express get-port
```
