# 文件导入导出功能测试指南

## 修复的问题

1. ✅ **Preload脚本暴露问题**：在 `src/preload/index.js` 中添加了新的IPC接口暴露
2. ✅ **API调用方式**：更新组件使用 `window.electron.project.*` API而不是直接调用 `ipcRenderer.invoke`
3. ✅ **错误处理**：改进了主进程中的错误处理和日志记录
4. ✅ **路径处理**：添加了详细的路径解析日志

## 新增的Preload API

在 `window.electron.project` 对象中添加了以下方法：

```javascript
// 导出功能
project.exportFile(params)           // 导出单个文件/文件夹
project.exportFiles(params)          // 批量导出文件
project.selectExportDirectory()      // 选择导出目录

// 导入功能
project.selectImportFiles(options)   // 选择要导入的文件
project.importFile(params)           // 导入单个文件
project.importFiles(params)          // 批量导入文件
```

## 测试步骤

### 1. 启动应用

```bash
cd desktop-app-vue
npm run dev
```

等待应用启动完成，打开开发者工具（F12）查看控制台日志。

### 2. 测试导入功能

#### 测试场景1：导入单个文件

1. 打开任意项目的详情页面
2. 在文件树面板找到顶部的"导入文件"按钮
3. 点击"导入文件"按钮
4. 在文件选择对话框中选择一个文本文件（如 `.txt`, `.md`, `.js`）
5. 点击"打开"

**预期结果**：
- 控制台显示：`[VirtualFileTree] 选择的文件: [...]`
- 控制台显示：`[Main] 批量导入 1 个文件到: ...`
- 文件成功复制到项目目录
- 弹出成功提示：`成功导入 1/1 个文件`
- 文件树自动刷新，显示新导入的文件

#### 测试场景2：导入多个文件

1. 点击"导入文件"按钮
2. 在文件选择对话框中，按住 Ctrl 键选择多个文件
3. 点击"打开"

**预期结果**：
- 控制台显示所有选中的文件路径
- 弹出成功提示：`成功导入 X/X 个文件`
- 所有文件都出现在文件树中

#### 测试场景3：导入文件夹

1. 点击"导入文件"按钮
2. 在文件选择对话框中选择一个包含子文件夹的目录
3. 点击"选择文件夹"

**预期结果**：
- 控制台显示：`[Main] 复制目录: ...`
- 整个文件夹结构被递归复制
- 文件树显示完整的目录结构

### 3. 测试导出功能

#### 测试场景1：导出单个文件

1. 在文件树中右键点击一个文件
2. 选择"导出到外部"菜单项
3. 在目录选择对话框中选择桌面或其他位置
4. 点击"选择文件夹"

**预期结果**：
- 控制台显示：`[VirtualFileTree] 导出节点: {...}`
- 控制台显示：`[Main] 解析后的源路径: ...`
- 控制台显示：`[Main] 复制文件: ... -> ...`
- 控制台显示：`[Main] 文件导出成功: ...`
- 弹出成功提示：`成功导出: 文件名`
- 文件成功复制到选定位置

#### 测试场景2：导出文件夹

1. 在文件树中右键点击一个文件夹
2. 选择"导出到外部"菜单项
3. 在目录选择对话框中选择目标位置
4. 点击"选择文件夹"

**预期结果**：
- 控制台显示：`[Main] 复制目录: ...`
- 整个文件夹及其内容被递归复制
- 弹出成功提示：`成功导出: 文件夹名`
- 验证目标位置有完整的文件夹结构

### 4. 测试取消操作

1. 点击"导入文件"按钮，然后点击"取消"
2. 右键文件选择"导出到外部"，然后点击"取消"

**预期结果**：
- 没有错误提示
- 控制台没有错误日志
- 操作静默取消

### 5. 测试错误场景

#### 场景1：导出不存在的文件

1. 修改文件树数据，指向不存在的文件
2. 尝试导出

**预期结果**：
- 控制台显示：`[Main] 源文件不存在: ...`
- 弹出错误提示：`文件导出失败: 源文件不存在`

#### 场景2：导入到只读目录

1. 尝试导出到系统保护的目录（如C:\Windows\System32）

**预期结果**：
- 显示权限错误提示
- 不会导致应用崩溃

## 控制台日志检查清单

### 导入操作的日志

```
[VirtualFileTree] 选择的文件: ["C:\\path\\to\\file.txt"]
[Main] 批量导入 1 个文件到: /data/projects/xxx/
[Main] 文件导入成功: file.txt
[VirtualFileTree] 导入结果: {success: true, results: [...], ...}
```

### 导出操作的日志

```
[VirtualFileTree] 导出节点: {key: "...", title: "file.txt", ...}
[VirtualFileTree] 导出到: C:\Users\xxx\Desktop
[VirtualFileTree] 项目路径: /data/projects/xxx/file.txt
[VirtualFileTree] 目标路径: C:\Users\xxx\Desktop\file.txt
[Main] 导出文件参数: {projectPath: "...", targetPath: "...", ...}
[Main] 解析后的源路径: C:\code\chainlesschain\data\projects\xxx\file.txt
[Main] 目标路径: C:\Users\xxx\Desktop\file.txt
[Main] 复制文件: ... -> ...
[Main] 文件导出成功: C:\Users\xxx\Desktop\file.txt
[VirtualFileTree] 导出结果: {success: true, path: "...", ...}
```

## 调试提示

### 如果导入不工作

1. 检查控制台是否有错误
2. 确认 `window.electron.project.selectImportFiles` 是否已定义
3. 检查项目ID是否正确传递
4. 查看主进程日志中的路径解析结果

### 如果导出不工作

1. 检查右键菜单是否显示"导出到外部"选项
2. 确认节点数据中是否有 `filePath` 字段
3. 检查目标路径是否有写权限
4. 查看主进程日志中是否显示"源文件不存在"错误

### 如果路径不正确

1. 检查 `node.filePath` 的值（应该是相对路径，如 "docs/README.md"）
2. 确认项目ID正确（检查 `props.projectId`）
3. 查看主进程的 `projectConfig.resolveProjectPath()` 解析结果

## 文件位置

- **主进程代码**：`desktop-app-vue/src/main/index.js` (8319行开始)
- **Preload脚本**：`desktop-app-vue/src/preload/index.js` (624-630行)
- **Vue组件**：`desktop-app-vue/src/renderer/components/projects/VirtualFileTree.vue`

## 快速测试脚本

可以在浏览器控制台中运行以下代码进行快速测试：

```javascript
// 测试导入API是否暴露
console.log('导入API:', typeof window.electron.project.importFiles);
console.log('导出API:', typeof window.electron.project.exportFile);
console.log('选择导入:', typeof window.electron.project.selectImportFiles);
console.log('选择导出:', typeof window.electron.project.selectExportDirectory);

// 应该都显示 "function"
```

## 已知限制

1. 导入默认到项目根目录（未来可以支持选择目标文件夹）
2. 大文件导入/导出没有进度条（未来可以添加进度反馈）
3. 不支持拖拽导入（未来可以支持）
4. 文件夹导入会递归复制所有内容（可能导入不需要的文件）

## 下一步改进

1. [ ] 添加进度条显示
2. [ ] 支持拖拽导入
3. [ ] 导入时选择目标文件夹
4. [ ] 文件类型过滤
5. [ ] 批量选择多个文件导出
6. [ ] 导入/导出历史记录
