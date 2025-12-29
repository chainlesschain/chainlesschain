# 项目文件树组件(EnhancedFileTree)彻底修复计划

## 问题诊断总结

### 核心问题
经过深入代码探索，发现文件树显示问题的根本原因是**数据流不一致和数据缺失**：

1. **数据源混乱** - IPC从文件系统读取但返回对象缺少关键字段
2. **ID生成不一致** - 文件系统扫描生成`fs_`前缀ID，数据库使用UUID
3. **文件内容缺失** - IPC返回的文件对象没有content字段，导致编辑器无法显示
4. **树形结构问题** - ID截断可能导致碰撞，空路径导致文件不进入树
5. **同步机制缺陷** - 文件操作后数据库和文件系统状态不一致

## 用户需求确认

根据用户反馈，本次修复需要支持：
- ✅ **大型项目支持**（>1000个文件）- 需要性能优化
- ✅ **以文件系统为准** - 数据库用于元数据和内容历史
- ✅ **实时文件监听** - 使用chokidar监听文件系统变化
- ✅ **按需加载内容** - 仅在点击文件时加载内容

## 修复策略

### 阶段0: 添加文件系统实时监听（新增，高优先级）

#### 0.1 安装和配置chokidar
**文件**: `desktop-app-vue/package.json`

**操作**: 添加依赖
```bash
npm install chokidar --save
```

#### 0.2 实现文件监听管理器
**文件**: `desktop-app-vue/src/main/file-watcher.js` (新建)

**实现**:
```javascript
const chokidar = require('chokidar');
const path = require('path');

class FileWatcher {
  constructor() {
    this.watchers = new Map(); // projectId -> watcher实例
  }

  watch(projectId, projectPath, mainWindow) {
    // 避免重复监听
    if (this.watchers.has(projectId)) {
      return;
    }

    const watcher = chokidar.watch(projectPath, {
      ignored: /(^|[\/\\])\.|node_modules|\.git|dist|build|out/,
      persistent: true,
      ignoreInitial: true, // 忽略初始扫描
      awaitWriteFinish: {
        stabilityThreshold: 1000, // 文件写入完成后等待1秒
        pollInterval: 100
      }
    });

    watcher
      .on('add', (filePath) => {
        const relativePath = path.relative(projectPath, filePath);
        mainWindow.webContents.send('project:file-added', {
          projectId,
          filePath: relativePath.replace(/\\/g, '/')
        });
      })
      .on('change', (filePath) => {
        const relativePath = path.relative(projectPath, filePath);
        mainWindow.webContents.send('project:file-changed', {
          projectId,
          filePath: relativePath.replace(/\\/g, '/')
        });
      })
      .on('unlink', (filePath) => {
        const relativePath = path.relative(projectPath, filePath);
        mainWindow.webContents.send('project:file-deleted', {
          projectId,
          filePath: relativePath.replace(/\\/g, '/')
        });
      })
      .on('addDir', (dirPath) => {
        const relativePath = path.relative(projectPath, dirPath);
        mainWindow.webContents.send('project:folder-added', {
          projectId,
          filePath: relativePath.replace(/\\/g, '/')
        });
      })
      .on('unlinkDir', (dirPath) => {
        const relativePath = path.relative(projectPath, dirPath);
        mainWindow.webContents.send('project:folder-deleted', {
          projectId,
          filePath: relativePath.replace(/\\/g, '/')
        });
      });

    this.watchers.set(projectId, watcher);
    console.log('[FileWatcher] 开始监听项目:', projectId, projectPath);
  }

  unwatch(projectId) {
    const watcher = this.watchers.get(projectId);
    if (watcher) {
      watcher.close();
      this.watchers.delete(projectId);
      console.log('[FileWatcher] 停止监听项目:', projectId);
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

#### 0.3 集成文件监听到主进程
**文件**: `desktop-app-vue/src/main/index.js`

**修改**:
```javascript
const fileWatcher = require('./file-watcher');

// 在项目加载时启动监听
ipcMain.handle('project:start-watch', async (_event, projectId) => {
  const project = this.database.db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  const rootPath = project.root_path || project.folder_path;

  fileWatcher.watch(projectId, rootPath, this.mainWindow);
  return { success: true };
});

// 在项目关闭时停止监听
ipcMain.handle('project:stop-watch', async (_event, projectId) => {
  fileWatcher.unwatch(projectId);
  return { success: true };
});

// 应用退出时清理所有监听
app.on('before-quit', () => {
  fileWatcher.unwatchAll();
});
```

#### 0.4 前端监听文件变化事件
**文件**: `desktop-app-vue/src/renderer/pages/projects/ProjectDetailPage.vue`

**修改**:
```javascript
// 在onMounted中启动监听
onMounted(async () => {
  // ... 现有代码 ...

  // 启动文件监听
  await window.electronAPI.project.startWatch(projectId.value);

  // 监听文件变化事件
  window.electronAPI.project.onFileAdded?.((event) => {
    if (event.projectId === projectId.value) {
      console.log('[ProjectDetail] 文件添加:', event.filePath);
      projectStore.loadProjectFiles(projectId.value);
    }
  });

  window.electronAPI.project.onFileChanged?.((event) => {
    if (event.projectId === projectId.value) {
      console.log('[ProjectDetail] 文件修改:', event.filePath);
      // 如果是当前打开的文件，提示用户重新加载
      if (currentFile.value?.file_path === event.filePath) {
        // 显示提示："文件已被修改，是否重新加载？"
      }
    }
  });

  window.electronAPI.project.onFileDeleted?.((event) => {
    if (event.projectId === projectId.value) {
      console.log('[ProjectDetail] 文件删除:', event.filePath);
      projectStore.loadProjectFiles(projectId.value);
    }
  });
});

// 在onUnmounted中停止监听
onUnmounted(() => {
  window.electronAPI.project.stopWatch?.(projectId.value);
});
```

### 阶段1: 修复核心数据流（高优先级）

#### 1.1 统一文件ID生成策略
**文件**: `desktop-app-vue/src/main/index.js` (行5156)

**问题**:
```javascript
id: 'fs_' + Buffer.from(fileRelativePath).toString('base64').substring(0, 32)
```
- 截断到32位可能导致不同路径碰撞
- 与数据库UUID格式不一致

**修复方案**:
```javascript
// 使用完整SHA256哈希的前16位
const crypto = require('crypto');
id: 'fs_' + crypto.createHash('sha256')
  .update(fileRelativePath)
  .digest('hex')
  .substring(0, 16)
```

#### 1.2 确保文件对象完整性
**文件**: `desktop-app-vue/src/main/index.js` (行5143-5169)

**问题**: 返回的fileInfo对象缺少content、content_hash等字段

**修复方案**:
```javascript
const fileInfo = {
  id: '...', // 新的ID生成策略
  project_id: projectId,
  file_name: entry.name,
  file_path: fileRelativePath.replace(/\\/g, '/'),
  file_type: isFolder ? 'folder' : (path.extname(entry.name).substring(1) || 'file'),
  is_folder: isFolder,
  file_size: stats.size || 0,
  created_at: stats.birthtimeMs || Date.now(),
  updated_at: stats.mtimeMs || Date.now(),
  // 新增字段确保完整性
  sync_status: 'synced',
  deleted: 0,
  version: 1,
};

// 移除 removeUndefinedValues，改用安全的字段验证
```

#### 1.3 修复路径为空导致文件不显示
**文件**: `desktop-app-vue/src/renderer/components/projects/EnhancedFileTree.vue` (行278-280)

**问题**:
```javascript
const filePath = file.file_path || file.path || '';
const parts = filePath.split('/').filter(p => p);
// 如果filePath为空，parts为[]，该文件不会进入树
```

**修复方案**:
```javascript
const filePath = file.file_path || file.path || file.file_name || '';
const parts = filePath.split('/').filter(p => p);

// 特殊处理根目录文件
if (parts.length === 0 && file.file_name) {
  parts.push(file.file_name);
}
```

#### 1.4 改进removeUndefinedValues逻辑
**文件**: `desktop-app-vue/src/main/index.js` (行900-959)

**问题**: 过度清理可能导致整个对象丢失

**修复方案**:
```javascript
// 不要移除整个对象，而是将undefined字段设为默认值
removeUndefinedValues(data) {
  if (Array.isArray(data)) {
    return data.map(item => this.removeUndefinedValues(item));
  }

  if (data && typeof data === 'object') {
    const cleaned = {};
    Object.keys(data).forEach(key => {
      const value = data[key];
      if (value !== undefined) {
        cleaned[key] = typeof value === 'object'
          ? this.removeUndefinedValues(value)
          : value;
      }
      // undefined字段直接忽略，不设置到cleaned对象
    });
    return cleaned;
  }

  return data;
}
```

### 阶段2: 改进树形节点构建（中优先级）

#### 2.1 确保树节点key唯一性
**文件**: `desktop-app-vue/src/renderer/components/projects/EnhancedFileTree.vue` (行312)

**问题**:
```javascript
key: item.fileData?.id || item.path
```

**修复方案**:
```javascript
// 双重保证key唯一性
key: item.fileData?.id || `node_${item.path}` || `temp_${Math.random()}`
```

#### 2.2 保留完整文件数据到树节点
**文件**: `desktop-app-vue/src/renderer/components/projects/EnhancedFileTree.vue` (行306-323)

**修复方案**:
```javascript
const node = {
  key: item.fileData?.id || `node_${item.path}`,
  title: item.name,
  isLeaf: !isFolder,
  icon: getFileIcon(item.name, isFolder),
  filePath: item.path,
  // 新增：保留完整文件数据对象
  fileData: item.fileData || null,
  // 新增：添加文件类型标记
  fileType: item.fileData?.file_type || '',
  children: isFolder ? convertToTreeNodes(item.children) : []
};
```

### 阶段3: 优化数据库同步（中优先级）

#### 3.1 检查软删除标志
**文件**: `desktop-app-vue/src/main/database.js` (getProjectFiles方法)

**修复方案**:
```javascript
getProjectFiles(projectId) {
  const stmt = this.db.prepare(`
    SELECT * FROM project_files
    WHERE project_id = ? AND deleted = 0
    ORDER BY file_path
  `);
  return stmt.all(projectId);
}
```

#### 3.2 实现文件扫描与数据库合并
**文件**: `desktop-app-vue/src/main/index.js` (project:get-files handler)

**策略**:
1. 从文件系统扫描获得文件列表
2. 从数据库读取已保存的文件记录
3. 合并两个数据源，文件系统为主，数据库为辅

**实现**:
```javascript
ipcMain.handle('project:get-files', async (_event, projectId) => {
  // 1. 扫描文件系统
  const fsFiles = await scanDirectory(rootPath);

  // 2. 查询数据库
  const dbFiles = this.database.getProjectFiles(projectId);

  // 3. 构建映射: file_path -> dbFile
  const dbFileMap = {};
  dbFiles.forEach(f => {
    dbFileMap[f.file_path] = f;
  });

  // 4. 合并数据
  const mergedFiles = fsFiles.map(fsFile => {
    const dbFile = dbFileMap[fsFile.file_path];

    if (dbFile) {
      // 文件系统和数据库都存在：合并
      return {
        ...dbFile,           // 数据库字段（包含content）
        ...fsFile,           // 文件系统字段（最新的size/time）
        id: dbFile.id,       // 保留数据库ID
      };
    } else {
      // 仅文件系统存在：返回文件系统信息
      return fsFile;
    }
  });

  return mergedFiles;
});
```

### 阶段4: 文件内容加载优化（低优先级）

#### 4.1 按需加载文件内容
**文件**: `desktop-app-vue/src/main/index.js`

**问题**: project:get-files返回所有文件信息，如果包含content会很大

**修复方案**:
```javascript
// project:get-files 只返回元数据，不包含content

// 新增独立的 project:get-file-content IPC
ipcMain.handle('project:get-file-content', async (_event, fileId, filePath) => {
  // 1. 尝试从数据库获取
  const dbFile = this.database.db.prepare(
    'SELECT content FROM project_files WHERE id = ? OR file_path = ?'
  ).get(fileId, filePath);

  if (dbFile?.content) {
    return dbFile.content;
  }

  // 2. 如果数据库没有，从文件系统读取
  const content = await fs.readFile(fullPath, 'utf-8');
  return content;
});
```

### 阶段5: 大型项目性能优化（高优先级）

#### 5.1 实现虚拟滚动
**文件**: `desktop-app-vue/src/renderer/components/projects/EnhancedFileTree.vue`

**问题**: 当项目有1000+文件时，渲染所有树节点会导致性能问题

**修复方案**: 使用Ant Design Vue的虚拟滚动Tree组件

```vue
<template>
  <a-tree
    :tree-data="treeData"
    :expanded-keys="expandedKeys"
    :selected-keys="selectedKeys"
    :virtual="true"
    :height="600"
    @select="handleSelect"
    @expand="handleExpand"
  >
    <!-- ... -->
  </a-tree>
</template>

<script setup>
// 虚拟滚动配置
const virtualConfig = {
  height: 600, // 可视区域高度
  itemHeight: 28, // 单个节点高度
};
</script>
```

#### 5.2 懒加载子目录
**文件**: `desktop-app-vue/src/renderer/components/projects/EnhancedFileTree.vue`

**策略**: 初始只加载第一层目录，展开时再加载子目录

**实现**:
```javascript
// 修改treeData构建逻辑
const treeData = computed(() => {
  if (!props.files || props.files.length === 0) {
    return [];
  }

  // 仅构建第一层节点
  const rootLevelFiles = props.files.filter(file => {
    const parts = (file.file_path || '').split('/').filter(p => p);
    return parts.length === 1; // 仅根目录文件
  });

  // 构建第一层树节点
  const buildFirstLevel = (files) => {
    const folders = new Set();

    // 识别所有第一层文件夹
    props.files.forEach(file => {
      const parts = (file.file_path || '').split('/').filter(p => p);
      if (parts.length > 1) {
        folders.add(parts[0]);
      }
    });

    const nodes = [];

    // 添加文件夹节点（带有懒加载标记）
    folders.forEach(folderName => {
      nodes.push({
        key: `folder_${folderName}`,
        title: folderName,
        isLeaf: false,
        icon: getFileIcon(folderName, true),
        filePath: folderName,
        children: [], // 空数组，展开时才加载
        isLazy: true, // 懒加载标记
      });
    });

    // 添加根目录文件
    rootLevelFiles.forEach(file => {
      if (!file.is_folder) {
        nodes.push({
          key: file.id,
          title: file.file_name,
          isLeaf: true,
          icon: getFileIcon(file.file_name, false),
          filePath: file.file_path,
          fileData: file,
        });
      }
    });

    return nodes.sort((a, b) => {
      if (a.isLeaf === b.isLeaf) {
        return a.title.localeCompare(b.title);
      }
      return a.isLeaf ? 1 : -1;
    });
  };

  return buildFirstLevel(props.files);
});

// 懒加载子节点
const loadChildrenLazy = (treeNode) => {
  return new Promise((resolve) => {
    const folderPath = treeNode.filePath;

    // 过滤出该文件夹下的直接子项
    const childFiles = props.files.filter(file => {
      const filePath = file.file_path || '';
      if (!filePath.startsWith(folderPath + '/')) {
        return false;
      }

      const relativePath = filePath.substring(folderPath.length + 1);
      const parts = relativePath.split('/').filter(p => p);
      return parts.length === 1; // 仅直接子项
    });

    // 构建子节点
    const children = buildTreeNodes(childFiles, folderPath);
    resolve(children);
  });
};

// Tree展开事件
const handleExpand = async (expandedKeys, { expanded, node }) => {
  if (expanded && node.isLazy && node.children.length === 0) {
    // 懒加载子节点
    const children = await loadChildrenLazy(node);
    node.children = children;
    node.isLazy = false;
  }
};
</script>
```

#### 5.3 分批加载文件列表
**文件**: `desktop-app-vue/src/main/index.js` (project:get-files handler)

**策略**: 初始只返回前500个文件，滚动到底部时加载更多

**实现**:
```javascript
ipcMain.handle('project:get-files', async (_event, projectId, options = {}) => {
  const { pageSize = 500, offset = 0 } = options;

  // ... 扫描文件系统 ...

  // 分批返回
  const paginatedFiles = files.slice(offset, offset + pageSize);

  return {
    files: paginatedFiles,
    total: files.length,
    hasMore: offset + pageSize < files.length,
  };
});

// 新增：获取总文件数
ipcMain.handle('project:get-file-count', async (_event, projectId) => {
  // 快速统计文件数，不扫描内容
  // ...
});
```

#### 5.4 缓存扫描结果
**文件**: `desktop-app-vue/src/main/index.js`

**策略**: 缓存文件列表，避免每次都重新扫描

**实现**:
```javascript
class FileCache {
  constructor() {
    this.cache = new Map(); // projectId -> { files, timestamp }
    this.ttl = 5 * 60 * 1000; // 5分钟过期
  }

  get(projectId) {
    const cached = this.cache.get(projectId);
    if (!cached) return null;

    const now = Date.now();
    if (now - cached.timestamp > this.ttl) {
      this.cache.delete(projectId);
      return null;
    }

    return cached.files;
  }

  set(projectId, files) {
    this.cache.set(projectId, {
      files,
      timestamp: Date.now(),
    });
  }

  invalidate(projectId) {
    this.cache.delete(projectId);
  }
}

const fileCache = new FileCache();

// 在 project:get-files 中使用缓存
ipcMain.handle('project:get-files', async (_event, projectId, options = {}) => {
  const { forceRefresh = false } = options;

  if (!forceRefresh) {
    const cached = fileCache.get(projectId);
    if (cached) {
      console.log('[project:get-files] 使用缓存');
      return cached;
    }
  }

  // 扫描文件系统
  const files = await scanDirectory(rootPath);

  // 缓存结果
  fileCache.set(projectId, files);

  return files;
});

// 文件监听器检测到变化时，使缓存失效
// 在 file-watcher.js 中
watcher.on('add', (filePath) => {
  fileCache.invalidate(projectId);
  // ...
});
```

### 阶段6: 增强错误处理和调试（低优先级）

#### 5.1 添加详细日志
**文件**:
- `desktop-app-vue/src/main/index.js` (project:get-files)
- `desktop-app-vue/src/renderer/components/projects/EnhancedFileTree.vue`

**修复方案**:
```javascript
// 在关键点添加console.log
console.log('[project:get-files] 开始扫描，项目:', projectId);
console.log('[project:get-files] 根路径:', rootPath);
console.log('[project:get-files] 扫描完成，文件数:', files.length);
console.log('[project:get-files] 返回前数据示例:', files[0]);

// 在EnhancedFileTree中
console.log('[FileTree] 接收到文件数:', props.files.length);
console.log('[FileTree] 树节点数:', treeData.value.length);
console.log('[FileTree] expandedKeys:', expandedKeys.value);
```

#### 5.2 添加数据验证
**文件**: `desktop-app-vue/src/renderer/components/projects/EnhancedFileTree.vue`

**修复方案**:
```javascript
// 在treeData computed中添加验证
const treeData = computed(() => {
  if (!props.files || props.files.length === 0) {
    console.warn('[FileTree] 文件列表为空');
    return [];
  }

  // 验证数据完整性
  const invalidFiles = props.files.filter(f =>
    !f.file_path && !f.path && !f.file_name
  );

  if (invalidFiles.length > 0) {
    console.error('[FileTree] 发现无效文件:', invalidFiles);
  }

  // ... 构建树形数据
});
```

## 测试计划

### 1. 单元测试
- 测试ID生成函数的唯一性
- 测试路径分割和树形构建逻辑
- 测试文件列表为空/单个文件/嵌套目录的情况

### 2. 集成测试
- 创建测试项目，包含多层嵌套目录结构
- 验证所有文件正确显示
- 测试文件创建/删除/重命名后自动刷新
- 测试文件选中和内容显示

### 3. 边界情况测试
- 空项目（无文件）
- 超大项目（1000+文件）
- 文件名包含特殊字符
- 非常深的目录层级（10层+）
- 文件路径包含空格、中文

## 关键文件清单

| 文件 | 修改内容 | 优先级 |
|------|---------|--------|
| `desktop-app-vue/src/main/index.js` (行5104-5197) | 修复project:get-files handler，统一ID生成，合并数据库数据 | 高 |
| `desktop-app-vue/src/main/index.js` (行900-959) | 改进removeUndefinedValues逻辑 | 高 |
| `desktop-app-vue/src/renderer/components/projects/EnhancedFileTree.vue` (行278-323) | 修复空路径处理，确保key唯一性 | 高 |
| `desktop-app-vue/src/main/database.js` | 添加软删除检查 | 中 |
| `desktop-app-vue/src/main/index.js` | 新增project:get-file-content IPC | 低 |

## 实施步骤（按优先级排序）

### 第一轮：核心修复（必须完成）
1. **阶段1** - 修复核心数据流
   - 统一文件ID生成策略
   - 确保文件对象完整性
   - 修复空路径处理
   - 改进removeUndefinedValues逻辑
   - 预计：30-45分钟

2. **阶段2** - 改进树形节点构建
   - 确保树节点key唯一性
   - 保留完整文件数据到树节点
   - 预计：15-20分钟

3. **阶段3** - 优化数据库同步
   - 检查软删除标志
   - 实现文件扫描与数据库合并
   - 预计：20-30分钟

### 第二轮：实时监听（大幅提升用户体验）
4. **阶段0** - 添加文件系统实时监听
   - 安装chokidar依赖
   - 实现文件监听管理器
   - 集成到主进程和前端
   - 预计：45-60分钟

### 第三轮：性能优化（大型项目支持）
5. **阶段5** - 大型项目性能优化
   - 实现虚拟滚动
   - 懒加载子目录
   - 分批加载文件列表
   - 缓存扫描结果
   - 预计：60-90分钟

### 第四轮：完善功能（可选）
6. **阶段4** - 文件内容按需加载
   - 新增project:get-file-content IPC
   - 预计：15-20分钟

7. **阶段6** - 增强错误处理和调试
   - 添加详细日志
   - 添加数据验证
   - 预计：10-15分钟

### 总计预估时间
- **核心修复**: 1-2小时
- **实时监听**: 45-60分钟
- **性能优化**: 1-1.5小时
- **测试验证**: 30-45分钟
- **总计**: 3-4.5小时

## 预期结果

### 核心功能修复
✅ 所有项目文件正确显示在树中
✅ 文件夹可以展开/折叠
✅ 没有重复或丢失的树节点
✅ 点击文件能正确显示内容
✅ Git状态标签正确显示
✅ 支持任意深度的嵌套目录
✅ 处理边界情况（空路径、特殊字符等）

### 实时监听功能
✅ 外部应用修改文件时，UI自动刷新
✅ 新增文件立即显示在树中
✅ 删除文件立即从树中移除
✅ 重命名文件实时更新
✅ 当前打开的文件被修改时，提示用户重新加载

### 性能优化
✅ 支持1000+文件的大型项目
✅ 使用虚拟滚动，仅渲染可见节点
✅ 懒加载子目录，按需展开
✅ 缓存文件列表，避免重复扫描
✅ 初始加载时间 < 2秒（即使有数千个文件）
✅ 树节点展开/折叠流畅无卡顿

### 数据一致性
✅ 以文件系统为准，确保显示真实状态
✅ 数据库用于存储文件内容和元数据
✅ 文件系统和数据库自动合并
✅ 软删除文件不显示在树中

## 风险评估

### 高风险项
1. **chokidar监听性能** - 大型项目可能导致大量事件触发
   - 缓解措施：使用debounce延迟刷新，批量处理事件

2. **虚拟滚动兼容性** - Ant Design Vue的Tree虚拟滚动可能与现有功能冲突
   - 缓解措施：先在小范围测试，必要时使用第三方虚拟滚动库

### 中风险项
1. **文件ID不一致** - 旧数据可能使用UUID，新数据使用fs_前缀
   - 缓解措施：添加兼容层，支持两种ID格式

2. **缓存失效策略** - 缓存可能导致数据不一致
   - 缓解措施：文件监听器自动使缓存失效

### 低风险项
1. **调试日志过多** - 可能影响性能
   - 缓解措施：生产环境禁用详细日志

## 回退策略

如果修复导致严重问题，可以快速回退：
1. 保留git分支，随时可以回退到修改前状态
2. 文件监听功能可以通过设置开关禁用
3. 性能优化可以逐步启用，出问题立即关闭
4. 数据库结构未修改，数据不会丢失
