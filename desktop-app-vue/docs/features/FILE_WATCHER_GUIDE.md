# 文件系统实时监听功能使用指南

## 功能概述

ChainlessChain 已实现基于 chokidar 的文件系统实时监听功能，当外部应用（如 VS Code、记事本等）修改项目文件时，UI 会自动刷新。

## 技术架构

### 1. 主进程 (src/main/file-sync/sync-manager.js)

`FileSyncManager` 类负责：
- 使用 chokidar 监听项目目录的文件变化
- 检测文件的增删改操作
- 同步文件系统和数据库之间的内容
- 检测并处理文件冲突

### 2. IPC 通信 (src/main/index.js)

提供的 IPC 处理器：
- `file-sync:watch-project` - 启动项目监听
- `file-sync:stop-watch` - 停止项目监听
- `file-sync:save` - 保存文件（双向同步）
- `file-sync:sync-from-fs` - 从文件系统同步到数据库
- `file-sync:resolve-conflict` - 解决文件冲突
- `file-sync:flush-all` - 刷新所有更改到文件系统

### 3. 渲染进程 API (src/preload/index.js)

暴露给前端的 API：
```javascript
// 启动/停止监听
window.electronAPI.project.watchProject(projectId, rootPath)
window.electronAPI.project.stopWatchProject(projectId)

// 监听事件
window.electronAPI.onFileReloaded(callback)      // 文件内容更新
window.electronAPI.onFileAdded(callback)         // 新文件添加
window.electronAPI.onFileDeleted(callback)       // 文件删除
window.electronAPI.onFileSyncConflict(callback)  // 同步冲突
```

### 4. UI 自动刷新 (src/renderer/pages/projects/ProjectDetailPage.vue)

在组件挂载时：
1. 启动文件系统监听 (line 1211-1218)
2. 注册事件监听器 (line 1221-1253)
3. 自动刷新文件树和编辑器内容

在组件卸载时：
1. 停止文件系统监听 (line 1292-1299)
2. 清理事件监听器 (line 1301-1310)

## 监听的事件类型

### 1. 文件修改 (change)
- **触发条件**: 文件内容被外部应用修改
- **自动行为**:
  - 更新数据库中的文件内容
  - 如果文件当前在编辑器中打开，自动重新加载
  - 刷新文件树显示
  - 通知用户文件已更新

### 2. 文件添加 (add)
- **触发条件**: 外部应用在项目目录中创建新文件
- **自动行为**:
  - 将新文件添加到数据库
  - 刷新文件树，显示新文件
  - 通知用户新文件已添加

### 3. 文件删除 (unlink)
- **触发条件**: 外部应用删除项目文件
- **自动行为**:
  - 从数据库中删除文件记录
  - 如果文件当前在编辑器中打开，关闭编辑器
  - 刷新文件树，移除文件
  - 通知用户文件已删除

### 4. 同步冲突
- **触发条件**: 文件同时在应用内和外部被修改
- **自动行为**:
  - 标记冲突状态
  - 通知用户存在冲突
  - 提供冲突解决选项（使用数据库版本 / 文件系统版本 / 手动合并）

## 配置参数

```javascript
const watcher = chokidar.watch(rootPath, {
  ignored: /(^|[\/\\])\.|node_modules|\.git|dist|build|out/,  // 忽略隐藏文件、node_modules、git等
  persistent: true,                                            // 持续监听
  ignoreInitial: true,                                         // 忽略初始文件扫描
  awaitWriteFinish: {
    stabilityThreshold: 500,  // 文件稳定 500ms 后触发
    pollInterval: 100         // 每 100ms 轮询一次
  }
});
```

## 使用示例

### 测试文件监听功能

1. **启动应用并打开项目**
   ```bash
   cd desktop-app-vue
   npm run dev
   ```

2. **创建测试项目**（如果还没有）
   - 在应用中创建一个新项目
   - 指定本地文件系统路径（如 `C:\test-project`）

3. **打开项目详情页**
   - 点击项目进入详情页
   - 检查控制台应显示：`[ProjectDetail] 文件系统监听已启动`

4. **测试外部修改**
   - 使用外部编辑器（VS Code、记事本等）修改项目中的文件
   - 保存文件后，观察应用界面：
     - 文件树会自动刷新
     - 如果文件在编辑器中打开，内容会自动重新加载
     - 控制台显示：`[ProjectDetail] 检测到文件内容更新`

5. **测试添加文件**
   - 在外部文件管理器中，在项目目录创建新文件
   - 观察应用界面：
     - 文件树会自动显示新文件
     - 收到通知：`新文件已添加: xxx.txt`
     - 控制台显示：`[FileSyncManager] 检测到新文件`

6. **测试删除文件**
   - 在外部文件管理器中删除项目文件
   - 观察应用界面：
     - 文件树会自动移除该文件
     - 如果文件正在编辑，编辑器会关闭
     - 收到通知：`文件已删除: xxx.txt`

## 防止循环触发

系统使用 `syncLocks` Map 防止以下循环：
1. 应用修改文件 → 写入文件系统
2. chokidar 检测到变化 → 尝试更新数据库
3. 数据库更新触发写入 → 再次修改文件系统
4. ...无限循环

**解决方案**：在执行文件操作时设置锁标志，操作完成后释放。

```javascript
if (this.syncLocks.get(fileId)) {
  console.log('文件正在同步，跳过');
  return;
}
this.syncLocks.set(fileId, true);
try {
  // 执行同步操作
} finally {
  this.syncLocks.delete(fileId);
}
```

## 冲突处理

当检测到同步冲突时：

1. **检测条件**
   ```
   数据库版本 ≠ 上次同步的数据库版本
   AND
   文件系统版本 ≠ 上次同步的文件系统版本
   ```

2. **解决方式**
   - `use-db`: 使用数据库中的版本覆盖文件系统
   - `use-fs`: 使用文件系统版本覆盖数据库
   - `manual`: 用户手动合并内容

3. **API 调用**
   ```javascript
   await window.electronAPI.project.resolveConflict(
     fileId,
     'use-fs',  // 或 'use-db', 'manual'
     manualContent  // 仅在 manual 模式下需要
   );
   ```

## 性能优化

### 1. 忽略不必要的文件
```javascript
ignored: /(^|[\/\\])\.|node_modules|\.git|dist|build|out/
```

### 2. 防抖机制
```javascript
awaitWriteFinish: {
  stabilityThreshold: 500,  // 等待文件稳定后再触发
  pollInterval: 100
}
```

### 3. 按需启动/停止
- 只在打开项目详情页时启动监听
- 离开页面时自动停止监听
- 避免同时监听多个项目造成性能损耗

## 调试信息

### 主进程日志
```
[FileSyncManager] 开始监听项目: <projectId>, 路径: <rootPath>
[FileSyncManager] 检测到文件变化: <relativePath>
[FileSyncManager] 文件同步成功: <fileId>
[FileSyncManager] 检测到新文件: <relativePath>
[FileSyncManager] 检测到文件删除: <relativePath>
[FileSyncManager] 检测到同步冲突: <fileId>
```

### 渲染进程日志
```
[ProjectDetail] 文件系统监听已启动
[ProjectDetail] 检测到文件内容更新: <event>
[ProjectDetail] 检测到新文件添加: <event>
[ProjectDetail] 检测到文件删除: <event>
[ProjectDetail] 检测到文件同步冲突: <event>
```

## 故障排查

### 问题 1: 文件变化未被检测

**可能原因**:
1. 文件路径不在监听范围内
2. 文件被 `ignored` 规则过滤
3. 监听未正确启动

**解决方法**:
- 检查控制台是否显示 `文件系统监听已启动`
- 检查文件路径是否符合 `ignored` 规则
- 确认项目有 `root_path` 属性

### 问题 2: UI 未自动刷新

**可能原因**:
1. 事件监听器未正确注册
2. 组件已卸载但监听未清理

**解决方法**:
- 检查 `onMounted` 中是否调用了事件监听 API
- 检查 `onUnmounted` 中是否正确清理
- 刷新页面重新加载组件

### 问题 3: 性能问题

**可能原因**:
1. 监听目录包含大量文件
2. 频繁触发文件变化事件

**解决方法**:
- 添加更多忽略规则
- 增加 `stabilityThreshold` 值
- 限制监听的目录范围

## 未来改进

1. **增量同步**: 只同步变化的部分，而不是整个文件
2. **批量处理**: 合并短时间内的多个文件变化事件
3. **智能冲突解决**: 提供三方合并界面
4. **版本历史**: 保存文件的历史版本，支持回滚
5. **实时协作**: 支持多人同时编辑同一项目

## 相关文件

- `src/main/file-sync/sync-manager.js` - 文件同步管理器
- `src/main/index.js` - IPC 处理器
- `src/preload/index.js` - API 暴露
- `src/renderer/pages/projects/ProjectDetailPage.vue` - UI 集成

## 参考资源

- [chokidar 官方文档](https://github.com/paulmillr/chokidar)
- [Electron IPC 文档](https://www.electronjs.org/docs/latest/tutorial/ipc)
