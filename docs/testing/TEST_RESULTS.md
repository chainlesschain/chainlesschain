# 文件导入导出功能测试结果

## 测试时间
2025-12-28 14:05

## 实施状态

### ✅ 已完成的工作

1. **主进程IPC处理器** - 已实现并编译
   - `project:export-file` (8319行)
   - `project:export-files` (8373行)
   - `project:select-export-directory` (8416行)
   - `project:select-import-files` (8441行)
   - `project:import-files` (8491行)
   - `copyDirectory()` 辅助函数 (128-151行)

2. **Preload API暴露** - 已实现并编译
   ```javascript
   // 在 dist/preload/index.js 中确认存在：
   line 625: exportFile: (params) => ipcRenderer.invoke('project:export-file', ...)
   line 626: exportFiles: (params) => ipcRenderer.invoke('project:export-files', ...)
   line 627: selectExportDirectory: () => ipcRenderer.invoke('project:select-export-directory')
   line 628: selectImportFiles: (options) => ipcRenderer.invoke('project:select-import-files', ...)
   line 630: importFiles: (params) => ipcRenderer.invoke('project:import-files', ...)
   ```

3. **Vue组件更新** - 已实现
   - 添加了"导入文件"按钮
   - 右键菜单添加了"导出到外部"选项
   - 实现了 `handleImportFiles()` 和 `handleExportFile()` 方法

4. **代码编译** - 成功
   - 主进程已编译
   - Preload脚本已编译
   - Vue组件已更新

## 🧪 需要进行的手动测试

### 测试1：验证API可用性

1. 启动应用（已启动，Vite运行在 http://localhost:5173）
2. 打开开发者工具（F12）
3. 在控制台中运行以下命令：

```javascript
// 验证API是否存在
console.log('导入API:', typeof window.electron.project.importFiles);
console.log('导出API:', typeof window.electron.project.exportFile);
console.log('选择导入:', typeof window.electron.project.selectImportFiles);
console.log('选择导出:', typeof window.electron.project.selectExportDirectory);

// 应该都显示 "function"
```

**预期结果**：所有API都应该返回 `"function"`

### 测试2：导入文件测试

1. 打开任意项目详情页面
2. 查找文件树面板顶部是否有"导入文件"按钮
3. 点击"导入文件"按钮
4. 选择一个测试文件
5. 观察控制台日志和文件树更新

**预期日志**：
```
[VirtualFileTree] 选择的文件: [...]
[Main] 批量导入 1 个文件到: /data/projects/xxx/
[Main] 文件导入成功: xxx
```

### 测试3：导出文件测试

1. 在文件树中右键点击任意文件
2. 查找是否有"导出到外部"菜单项
3. 点击"导出到外部"
4. 选择目标目录（比如桌面）
5. 检查文件是否成功复制到目标位置

**预期日志**：
```
[VirtualFileTree] 导出节点: {...}
[Main] 导出文件参数: {...}
[Main] 解析后的源路径: ...
[Main] 复制文件: ... -> ...
[Main] 文件导出成功: ...
```

## 🔍 潜在问题排查

### 问题1：API未定义

**症状**：`window.electron.project.importFiles is undefined`

**解决方法**：
1. 确认应用已完全重启（关闭所有Electron窗口）
2. 重新编译：`cd desktop-app-vue && npm run build:main`
3. 重启：`npm run dev`

### 问题2：按钮/菜单项不显示

**症状**：看不到"导入文件"按钮或"导出到外部"菜单

**解决方法**：
1. 确认你在项目详情页面
2. 确认使用的是 VirtualFileTree 组件（不是旧的FileTree组件）
3. 检查控制台是否有Vue渲染错误

### 问题3：文件路径错误

**症状**：`源文件不存在` 错误

**检查点**：
1. 查看主进程日志中的 `[Main] 解析后的源路径`
2. 确认项目ID是否正确
3. 确认 `node.filePath` 字段是否存在且正确

## 📋 测试检查清单

- [ ] API在浏览器控制台中可访问
- [ ] "导入文件"按钮显示在文件树顶部
- [ ] 点击导入按钮弹出文件选择对话框
- [ ] 选择文件后能成功导入
- [ ] 文件树自动刷新显示新文件
- [ ] 右键菜单显示"导出到外部"选项
- [ ] 点击导出弹出目录选择对话框
- [ ] 选择目录后文件成功复制到外部
- [ ] 控制台日志正确显示操作流程
- [ ] 错误情况（取消操作等）处理正确

## 🐛 调试建议

### 启用详细日志

主进程中已经添加了详细的日志。检查以下日志：

```javascript
// 前端日志
[VirtualFileTree] 导出节点: ...
[VirtualFileTree] 选择的文件: ...

// 主进程日志
[Main] 导出文件参数: ...
[Main] 解析后的源路径: ...
[Main] 批量导入 X 个文件到: ...
```

### 使用调试断点

在以下位置添加断点进行调试：

1. `VirtualFileTree.vue:368` - handleImportFiles 方法开始
2. `VirtualFileTree.vue:410` - handleExportFile 方法开始
3. `index.js:8319` - project:export-file IPC处理器
4. `index.js:8491` - project:import-files IPC处理器

## 📝 下一步

如果测试中发现问题，请提供：
1. 控制台的完整错误日志
2. 主进程的相关日志
3. 操作的具体步骤
4. 预期行为 vs 实际行为

我将根据这些信息进行进一步的调试和修复。

## 📚 相关文档

- 功能说明：`desktop-app-vue/docs/FILE_IMPORT_EXPORT_FEATURE.md`
- 测试指南：`desktop-app-vue/docs/FILE_IMPORT_EXPORT_TESTING.md`
- 实现总结：`IMPORT_EXPORT_IMPLEMENTATION_SUMMARY.md`
