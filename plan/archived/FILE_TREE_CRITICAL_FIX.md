# 项目文件树系统紧急修复方案

**优先级**: 🔴🔴🔴 CRITICAL
**影响范围**: 所有项目的文件树显示功能
**预估工期**: 2-3天
**状态**: 待实施

---

## 📋 执行摘要

### 问题严重性

**文件树在所有场景都失败** ❌

- ❌ 项目切换时文件树不更新
- ❌ 手动点击刷新按钮无效
- ❌ 初次打开项目看不到文件
- ❌ 两种文件树组件都有问题

### 根本原因（5个）

1. **数据库层** - root_path 为 null，无法扫描文件
2. **响应式失效** - Vue组件未正确追踪数据变化
3. **数据流混乱** - 文件系统vs数据库，ID不一致
4. **时序问题** - 组件挂载早于数据加载
5. **缺少监听** - 文件系统变化无法实时同步

### 修复策略

**采用分层修复，优先数据库层，然后响应式，最后实时监听**

```
第一阶段 (Day 1): 数据库层修复 - 确保所有项目有root_path
第二阶段 (Day 2): 响应式修复 - 修复Vue组件数据追踪
第三阶段 (Day 3): 文件监听 - 添加chokidar实时监听
```

---

## 🎯 第一阶段：数据库层修复（Day 1）

### 优先级: 🔴 CRITICAL - 必须首先修复

### 目标

确保所有项目都有有效的 `root_path`，解决"文件列表为空"的根本问题

### 实施步骤

#### 1.1 添加自动修复函数

**文件**: `desktop-app-vue/src/main/index.js`
**位置**: 新增方法

```javascript
/**
 * 修复单个项目的root_path
 */
async repairProjectRootPath(projectId) {
  try {
    const project = this.database.db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);

    if (!project) {
      throw new Error(`项目不存在: ${projectId}`);
    }

    // 已有root_path，无需修复
    if (project.root_path) {
      return { success: true, message: '项目已有root_path', rootPath: project.root_path };
    }

    // 仅修复document类型项目
    const projectType = project.project_type || project.projectType;
    if (projectType !== 'document') {
      return { success: false, message: `无法修复类型为 ${projectType} 的项目` };
    }

    // 构建root_path
    const { getProjectConfig } = require('./project/project-config');
    const projectConfig = getProjectConfig();
    const rootPath = require('path').join(
      projectConfig.getProjectsRootPath(),
      projectId
    );

    // 创建目录（如不存在）
    await require('fs').promises.mkdir(rootPath, { recursive: true });

    // 更新数据库
    await this.database.updateProject(projectId, {
      root_path: rootPath,
    });

    console.log(`[Main] ✅ 修复项目 ${projectId} 的root_path: ${rootPath}`);
    return { success: true, message: '修复成功', rootPath };
  } catch (error) {
    console.error(`[Main] ❌ 修复项目 ${projectId} 失败:`, error);
    return { success: false, message: error.message };
  }
}

/**
 * 批量修复所有项目的root_path
 */
async repairAllProjectRootPaths() {
  try {
    const projects = this.database.db.prepare('SELECT * FROM projects').all();
    let fixed = 0;
    let skipped = 0;

    for (const project of projects) {
      const result = await this.repairProjectRootPath(project.id);
      if (result.success && result.message === '修复成功') {
        fixed++;
      } else {
        skipped++;
      }
    }

    console.log(`[Main] 批量修复完成: ${fixed}个成功, ${skipped}个跳过`);
    return { fixed, skipped, total: projects.length };
  } catch (error) {
    console.error('[Main] 批量修复失败:', error);
    throw error;
  }
}
```

#### 1.2 应用启动时自动修复

**文件**: `desktop-app-vue/src/main/index.js`
**位置**: `initializeDatabase()` 方法末尾

```javascript
async initializeDatabase() {
  // ... 现有初始化代码 ...

  // 自动修复缺失 root_path 的项目
  console.log('[Main] 检查并修复项目路径...');
  try {
    const result = await this.repairAllProjectRootPaths();
    if (result.fixed > 0) {
      console.log(`[Main] ✅ 自动修复了 ${result.fixed} 个项目的路径`);

      // 显示通知
      const { dialog } = require('electron');
      dialog.showMessageBox({
        type: 'info',
        title: '数据修复',
        message: `已自动修复 ${result.fixed} 个项目的文件路径`,
        buttons: ['知道了']
      });
    }
  } catch (error) {
    console.error('[Main] 自动修复失败:', error);
  }
}
```

#### 1.3 增强 project:get-files 错误处理

**文件**: `desktop-app-vue/src/main/index.js`
**位置**: Line ~5534（project:get-files handler）

```javascript
ipcMain.handle("project:get-files", async (_event, projectId) => {
  try {
    const project = this.database.db
      .prepare("SELECT * FROM projects WHERE id = ?")
      .get(projectId);
    const rootPath = project.root_path || project.folder_path;

    if (!rootPath) {
      console.error("[Main] ⚠️ 项目缺少 root_path，尝试自动修复");
      console.error("[Main] 项目ID:", projectId);

      // 尝试自动修复
      const repairResult = await this.repairProjectRootPath(projectId);

      if (repairResult.success) {
        console.log("[Main] ✅ 自动修复成功，重新获取文件列表");

        // 重新获取项目信息
        const repairedProject = this.database.db
          .prepare("SELECT * FROM projects WHERE id = ?")
          .get(projectId);
        const repairedPath = repairedProject.root_path;

        if (repairedPath) {
          // 继续扫描（调用下面的扫描逻辑）
          return await this.scanProjectFiles(projectId, repairedPath);
        }
      }

      console.error("[Main] ❌ 自动修复失败，返回空列表");
      console.error("[Main] 建议：手动运行 project:repair-root-path");
      return [];
    }

    // 正常扫描流程
    return await this.scanProjectFiles(projectId, rootPath);
  } catch (error) {
    console.error("[Main] 获取文件列表失败:", error);
    return [];
  }
});
```

#### 1.4 添加IPC接口供前端手动触发

**文件**: `desktop-app-vue/src/main/index.js`
**位置**: 新增handler

```javascript
// 手动修复单个项目
ipcMain.handle("project:repair-root-path", async (_event, projectId) => {
  return await this.repairProjectRootPath(projectId);
});

// 手动批量修复
ipcMain.handle("project:repair-all-root-paths", async (_event) => {
  return await this.repairAllProjectRootPaths();
});
```

### 测试验证

```bash
# 测试场景1: 创建缺少root_path的项目
1. 手动修改数据库，删除某个项目的root_path
2. 重启应用
3. 验证: 应用启动时自动修复并显示通知
4. 验证: 打开项目，文件树正常显示

# 测试场景2: 实时修复
1. 打开缺少root_path的项目
2. 验证: 文件树加载时自动修复
3. 验证: 文件树正常显示

# 测试场景3: 手动触发修复
1. 打开控制台，调用 window.electronAPI.project.repairRootPath(projectId)
2. 验证: 返回修复结果
3. 验证: 刷新后文件树正常显示
```

---

## 🎯 第二阶段：响应式修复（Day 2）

### 优先级: 🔴 HIGH

### 目标

修复Vue组件的响应式问题，确保数据变化时UI正确更新

### 实施步骤

#### 2.1 修复 VirtualFileTree 响应式

**文件**: `desktop-app-vue/src/renderer/components/projects/VirtualFileTree.vue`
**位置**: Line ~220-231

```vue
<!-- 修改前 -->
current[part] = { children: isLeaf ? null : {}, expanded:
expandedKeys.value.has(...) };

<!-- 修改后 -->
import { reactive } from 'vue'; current[part] = reactive({ children: isLeaf ?
null : {}, expanded: expandedKeys.value.has(...) });
```

#### 2.2 修复 EnhancedFileTree 监听

**文件**: `desktop-app-vue/src/renderer/components/projects/EnhancedFileTree.vue`
**位置**: 新增 watch

```vue
<script setup>
import { watch } from "vue";

// 显式监听 props.files 变化
watch(
  () => props.files,
  (newFiles, oldFiles) => {
    console.log("[EnhancedFileTree] 文件列表变化:", {
      newCount: newFiles?.length || 0,
      oldCount: oldFiles?.length || 0,
    });

    // 强制重新计算树结构
    fileTreeKey.value++;
  },
  { deep: true },
);
</script>
```

#### 2.3 修复 ProjectDetailPage computed

**文件**: `desktop-app-vue/src/renderer/pages/projects/ProjectDetailPage.vue`
**位置**: Line ~507-514

```vue
<!-- 修改前 -->
const projectFiles = computed(() => { const files =
projectStore.currentProjectFiles; return files; });

<!-- 修改后 -->
const projectFiles = computed(() => { const files =
projectStore.currentProjectFiles; // 创建新引用，确保Vue检测到变化 return files
? [...files] : []; });
```

#### 2.4 修复 Pinia store

**文件**: `desktop-app-vue/src/renderer/stores/project.js`
**位置**: `loadProjectFiles` action

```javascript
async loadProjectFiles(projectId) {
  try {
    console.log('[ProjectStore] 开始加载文件:', projectId);

    const files = await window.electronAPI.project.getFiles(projectId);

    // 确保响应式更新
    this.currentProjectFiles = [];  // 先清空
    await nextTick();  // 等待DOM更新
    this.currentProjectFiles = files;  // 再赋值

    console.log('[ProjectStore] 文件加载完成:', files.length);
    return files;
  } catch (error) {
    console.error('[ProjectStore] 加载文件失败:', error);
    this.currentProjectFiles = [];
    throw error;
  }
}
```

### 测试验证

```bash
# 测试场景1: 项目切换
1. 打开项目A，查看文件树
2. 切换到项目B
3. 验证: 文件树立即更新为项目B的文件
4. 验证: 控制台输出"[EnhancedFileTree] 文件列表变化"

# 测试场景2: 手动刷新
1. 打开项目
2. 点击刷新按钮
3. 验证: 文件树重新加载
4. 验证: 控制台输出刷新日志

# 测试场景3: 文件数量变化
1. 打开项目
2. 在文件系统中添加新文件
3. 刷新文件树
4. 验证: 新文件出现在树中
```

---

## 🎯 第三阶段：文件监听（Day 3）

### 优先级: 🟡 MEDIUM（可选）

### 目标

添加文件系统实时监听，文件变化自动同步到UI

### 实施步骤

#### 3.1 安装依赖

```bash
cd desktop-app-vue
npm install chokidar --save
```

#### 3.2 创建 FileWatcher

**文件**: `desktop-app-vue/src/main/file-watcher.js`（新建）

```javascript
const chokidar = require("chokidar");
const path = require("path");

class FileWatcher {
  constructor() {
    this.watchers = new Map();
  }

  watch(projectId, projectPath, mainWindow) {
    if (this.watchers.has(projectId)) {
      console.log("[FileWatcher] 项目已在监听:", projectId);
      return;
    }

    const watcher = chokidar.watch(projectPath, {
      ignored: /(^|[\/\\])\.|node_modules|\.git|dist|build|out/,
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 1000,
        pollInterval: 100,
      },
    });

    watcher
      .on("add", (filePath) => {
        const relativePath = path
          .relative(projectPath, filePath)
          .replace(/\\/g, "/");
        mainWindow.webContents.send("project:file-added", {
          projectId,
          filePath: relativePath,
        });
        console.log("[FileWatcher] 文件添加:", relativePath);
      })
      .on("change", (filePath) => {
        const relativePath = path
          .relative(projectPath, filePath)
          .replace(/\\/g, "/");
        mainWindow.webContents.send("project:file-changed", {
          projectId,
          filePath: relativePath,
        });
        console.log("[FileWatcher] 文件修改:", relativePath);
      })
      .on("unlink", (filePath) => {
        const relativePath = path
          .relative(projectPath, filePath)
          .replace(/\\/g, "/");
        mainWindow.webContents.send("project:file-deleted", {
          projectId,
          filePath: relativePath,
        });
        console.log("[FileWatcher] 文件删除:", relativePath);
      });

    this.watchers.set(projectId, watcher);
    console.log("[FileWatcher] 开始监听项目:", projectId);
  }

  unwatch(projectId) {
    const watcher = this.watchers.get(projectId);
    if (watcher) {
      watcher.close();
      this.watchers.delete(projectId);
      console.log("[FileWatcher] 停止监听项目:", projectId);
    }
  }

  unwatchAll() {
    for (const [projectId, watcher] of this.watchers) {
      watcher.close();
    }
    this.watchers.clear();
  }
}

module.exports = new FileWatcher();
```

#### 3.3 集成到主进程

**文件**: `desktop-app-vue/src/main/index.js`

```javascript
const fileWatcher = require("./file-watcher");

// 项目打开时启动监听
ipcMain.handle("project:start-watch", async (_event, projectId) => {
  const project = this.database.db
    .prepare("SELECT * FROM projects WHERE id = ?")
    .get(projectId);
  const rootPath = project.root_path || project.folder_path;

  if (rootPath) {
    fileWatcher.watch(projectId, rootPath, this.mainWindow);
    return { success: true };
  }

  return { success: false, message: "项目缺少root_path" };
});

// 项目关闭时停止监听
ipcMain.handle("project:stop-watch", async (_event, projectId) => {
  fileWatcher.unwatch(projectId);
  return { success: true };
});

// 应用退出时清理
app.on("before-quit", () => {
  fileWatcher.unwatchAll();
});
```

#### 3.4 前端监听事件

**文件**: `desktop-app-vue/src/renderer/pages/projects/ProjectDetailPage.vue`

```vue
<script setup>
import { onMounted, onUnmounted } from "vue";

onMounted(async () => {
  // 启动文件监听
  await window.electronAPI.project.startWatch(projectId.value);

  // 监听文件变化事件
  window.electronAPI.on("project:file-added", handleFileAdded);
  window.electronAPI.on("project:file-changed", handleFileChanged);
  window.electronAPI.on("project:file-deleted", handleFileDeleted);
});

onUnmounted(async () => {
  // 停止文件监听
  await window.electronAPI.project.stopWatch(projectId.value);

  // 移除事件监听
  window.electronAPI.off("project:file-added", handleFileAdded);
  window.electronAPI.off("project:file-changed", handleFileChanged);
  window.electronAPI.off("project:file-deleted", handleFileDeleted);
});

function handleFileAdded({ projectId, filePath }) {
  if (projectId === projectId.value) {
    console.log("[ProjectDetail] 文件添加:", filePath);
    projectStore.loadProjectFiles(projectId); // 重新加载
  }
}

function handleFileChanged({ projectId, filePath }) {
  if (projectId === projectId.value) {
    console.log("[ProjectDetail] 文件修改:", filePath);
    // 可选: 仅更新该文件，而非全部重载
  }
}

function handleFileDeleted({ projectId, filePath }) {
  if (projectId === projectId.value) {
    console.log("[ProjectDetail] 文件删除:", filePath);
    projectStore.loadProjectFiles(projectId); // 重新加载
  }
}
</script>
```

### 测试验证

```bash
# 测试场景1: 文件添加
1. 打开项目
2. 在文件系统中创建新文件
3. 验证: 文件树自动刷新，新文件出现（<2秒）

# 测试场景2: 文件删除
1. 打开项目
2. 在文件系统中删除文件
3. 验证: 文件树自动刷新，文件消失（<2秒）

# 测试场景3: 文件修改
1. 打开项目
2. 在外部编辑器修改文件
3. 验证: 收到file-changed事件（可选操作）
```

---

## 📋 关键文件清单

### 需要修改的文件（5个）

1. `desktop-app-vue/src/main/index.js` - 添加修复函数和增强错误处理
2. `desktop-app-vue/src/renderer/components/projects/VirtualFileTree.vue` - 响应式修复
3. `desktop-app-vue/src/renderer/components/projects/EnhancedFileTree.vue` - 添加watch
4. `desktop-app-vue/src/renderer/pages/projects/ProjectDetailPage.vue` - computed修复+事件监听
5. `desktop-app-vue/src/renderer/stores/project.js` - loadProjectFiles优化

### 需要新建的文件（1个）

1. `desktop-app-vue/src/main/file-watcher.js` - 文件监听管理器

---

## ✅ 成功标准

### 功能验收

- [ ] 所有项目都有root_path（批量修复成功）
- [ ] 项目切换时文件树立即更新
- [ ] 手动刷新按钮正常工作
- [ ] 初次打开项目文件树正常显示
- [ ] 文件数量正确显示
- [ ] 文件树展开/收起正常
- [ ] 文件系统变化自动同步（如启用监听）

### 性能指标

- 文件列表加载 < 1秒（100个文件）
- 文件列表加载 < 3秒（1000个文件）
- 文件变化同步 < 2秒
- 无控制台错误

### 稳定性

- 连续切换10个项目无问题
- 连续刷新20次无问题
- 长时间运行（1小时）无内存泄漏

---

## ⚠️ 风险控制

### 风险1: 自动修复误操作

**降级**: 修复前备份数据库，显示通知提示用户

### 风险2: 响应式修复破坏现有功能

**降级**: 充分测试，保留原代码注释，方便回滚

### 风险3: chokidar性能问题（大项目）

**降级**: 第三阶段可选，前两阶段即可解决核心问题

---

## 📊 实施进度追踪

| 阶段     | 任务             | 预估      | 实际 | 状态      |
| -------- | ---------------- | --------- | ---- | --------- |
| 第一阶段 | 数据库层修复     | 1天       | -    | ⏳ 待开始 |
| 第二阶段 | 响应式修复       | 1天       | -    | ⏳ 待开始 |
| 第三阶段 | 文件监听（可选） | 1天       | -    | ⏳ 待开始 |
| **总计** |                  | **2-3天** | -    | -         |

---

## 🔗 相关文档

- **原计划1**: `plan/sparkling-twirling-beacon.md` (17KB) - 全面修复计划
- **原计划2**: `plan/crystalline-tickling-stardust.md` (24KB) - 彻底修复计划
- **原计划3**: `plan/dynamic-twirling-cat.md` (17KB) - 对话文件操作修复（独立功能）

**本方案整合了前两个计划的核心内容，第三个计划涉及不同功能（对话中的文件操作），需单独实施。**

---

**创建日期**: 2025-12-29
**状态**: ✅ 准备就绪，等待开始实施
**下一步**: 执行第一阶段（数据库层修复）
