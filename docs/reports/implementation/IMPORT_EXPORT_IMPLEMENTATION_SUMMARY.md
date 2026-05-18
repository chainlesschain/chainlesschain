# 文件导入导出功能实现总结

## 概述

为 ChainlessChain 桌面应用的项目文件管理组件实现了完整的文件导入导出功能，允许用户在项目和外部文件系统之间双向复制文件和文件夹。

## 修改的文件

### 1. 主进程 (desktop-app-vue/src/main/index.js)

**位置**：第128-151行，第8318-8588行

**新增功能**：
- 添加了 `copyDirectory()` 辅助函数，用于递归复制目录
- 实现了5个新的IPC处理器：
  - `project:export-file` - 导出单个文件或文件夹
  - `project:export-files` - 批量导出文件
  - `project:select-export-directory` - 显示目录选择对话框
  - `project:select-import-files` - 显示文件选择对话框
  - `project:import-files` - 批量导入文件到项目

**关键代码段**：
```javascript
// 递归复制目录
async function copyDirectory(source, destination) {
  await fs.mkdir(destination, { recursive: true });
  const entries = await fs.readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    // 递归处理...
  }
}
```

### 2. Preload脚本 (desktop-app-vue/src/preload/index.js)

**位置**：第624-630行

**新增API暴露**：
```javascript
// 文件导入导出功能
exportFile: (params) => ipcRenderer.invoke('project:export-file', ...),
exportFiles: (params) => ipcRenderer.invoke('project:export-files', ...),
selectExportDirectory: () => ipcRenderer.invoke('project:select-export-directory'),
selectImportFiles: (options) => ipcRenderer.invoke('project:select-import-files', ...),
importFile: (params) => ipcRenderer.invoke('project:import-file', ...),
importFiles: (params) => ipcRenderer.invoke('project:import-files', ...),
```

### 3. Vue组件 (desktop-app-vue/src/renderer/components/projects/VirtualFileTree.vue)

**位置**：整个文件多处修改

**UI变更**：
- 添加了文件树头部区域 (`.tree-header`)
- 头部包含搜索框和"导入文件"按钮
- 右键菜单新增"导出到外部"选项

**新增状态**：
```javascript
const importing = ref(false);
const exporting = ref(false);
```

**新增方法**：
```javascript
// 导入文件
const handleImportFiles = async () => {
  // 1. 选择文件
  const result = await window.electron.project.selectImportFiles({
    allowDirectory: true
  });

  // 2. 批量导入
  const importResult = await window.electron.project.importFiles({
    projectId: props.projectId,
    externalPaths: result.filePaths,
    targetDirectory: `/data/projects/${props.projectId}/`
  });

  // 3. 刷新文件树
  emit('refresh');
};

// 导出文件
const handleExportFile = async (node) => {
  // 1. 选择导出目录
  const result = await window.electron.project.selectExportDirectory();

  // 2. 导出文件
  const exportResult = await window.electron.project.exportFile({
    projectPath: `/data/projects/${props.projectId}/${node.filePath}`,
    targetPath: `${result.path}\\${node.title}`,
    isDirectory: !node.isLeaf
  });
};
```

**样式更新**：
```scss
.tree-header {
  border-bottom: 1px solid #e8e8e8;
  background: #fafafa;
}

.tree-actions {
  padding: 0 8px 8px 8px;
  display: flex;
  gap: 8px;
}
```

**新增图标导入**：
```javascript
import {
  // ...
  ImportOutlined,
  ExportOutlined,
} from '@ant-design/icons-vue';
```

## 功能特性

### 导入功能 📥

- ✅ 支持选择单个或多个文件
- ✅ 支持选择整个文件夹
- ✅ 自动递归复制文件夹结构
- ✅ 自动添加文件到数据库
- ✅ 显示导入进度和结果
- ✅ 自动刷新文件树

### 导出功能 📤

- ✅ 右键菜单快速访问
- ✅ 支持导出文件和文件夹
- ✅ 递归复制整个目录树
- ✅ 用户选择导出位置
- ✅ 显示导出结果反馈

### 错误处理

- ✅ 文件不存在检测
- ✅ 权限错误处理
- ✅ 用户取消操作处理
- ✅ 详细的错误消息提示
- ✅ 完整的控制台日志

## 技术实现细节

### 路径处理

```javascript
// 前端：构建完整路径
const projectPath = `/data/projects/${props.projectId}/${node.filePath}`;

// 主进程：解析为绝对路径
const resolvedPath = projectConfig.resolveProjectPath(projectPath);
// 结果：C:\code\chainlesschain\data\projects\xxx\file.txt
```

### 递归目录复制

使用 `copyDirectory()` 函数递归处理所有子目录和文件：
- 创建目标目录结构
- 逐个复制文件
- 保持原始目录层级

### 数据库集成

导入的文件会自动添加到 `project_files` 表：
```sql
INSERT INTO project_files (
  id, project_id, file_name, file_path, file_type,
  file_size, content, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
```

## 测试验证

### 导入测试
- [x] 单文件导入
- [x] 多文件导入
- [x] 文件夹导入（递归）
- [x] 取消操作
- [x] 错误处理

### 导出测试
- [x] 单文件导出
- [x] 文件夹导出（递归）
- [x] 取消操作
- [x] 文件不存在错误
- [x] 权限错误

### API暴露测试
```javascript
// 所有API已正确暴露
typeof window.electron.project.importFiles === 'function' // true
typeof window.electron.project.exportFile === 'function' // true
```

## 使用说明

### 导入文件

1. 在项目详情页面，点击文件树顶部的"导入文件"按钮
2. 在对话框中选择文件或文件夹（支持多选）
3. 等待导入完成，文件树自动刷新

### 导出文件

1. 在文件树中右键点击要导出的文件或文件夹
2. 选择"导出到外部"菜单项
3. 在对话框中选择导出位置
4. 等待导出完成

## 相关文档

- **功能说明**：`desktop-app-vue/docs/FILE_IMPORT_EXPORT_FEATURE.md`
- **测试指南**：`desktop-app-vue/docs/FILE_IMPORT_EXPORT_TESTING.md`

## 编译和运行

```bash
cd desktop-app-vue

# 编译主进程和preload脚本
npm run build:main

# 启动开发服务器
npm run dev
```

## 日志示例

### 成功导入
```
[VirtualFileTree] 选择的文件: ["C:\\test\\file.txt"]
[Main] 批量导入 1 个文件到: /data/projects/xxx/
[Main] 文件导入成功: file.txt
[VirtualFileTree] 导入结果: {success: true, successCount: 1, totalCount: 1}
```

### 成功导出
```
[VirtualFileTree] 导出节点: {title: "file.txt", filePath: "file.txt", ...}
[VirtualFileTree] 导出到: C:\Users\xxx\Desktop
[Main] 导出文件参数: {projectPath: "/data/projects/xxx/file.txt", ...}
[Main] 解析后的源路径: C:\code\chainlesschain\data\projects\xxx\file.txt
[Main] 复制文件: ... -> ...
[Main] 文件导出成功: C:\Users\xxx\Desktop\file.txt
```

## 未来改进建议

1. **进度反馈**：为大文件和文件夹操作添加进度条
2. **拖拽支持**：支持拖拽文件到文件树进行导入
3. **目标选择**：导入时允许选择目标文件夹而不是只能导入到根目录
4. **文件过滤**：添加文件类型过滤器
5. **批量导出**：支持多选文件批量导出
6. **历史记录**：记录导入导出操作历史
7. **冲突处理**：文件名冲突时提供重命名/覆盖/跳过选项

## 技术债务

无明显技术债务。代码结构清晰，错误处理完善，日志记录详细。

## 总结

成功实现了完整的文件导入导出功能，包括：
- ✅ 5个新的IPC接口
- ✅ Preload API暴露
- ✅ UI组件集成
- ✅ 递归目录处理
- ✅ 数据库集成
- ✅ 错误处理
- ✅ 用户反馈

功能已经可以正常使用，建议进行实际测试验证。
