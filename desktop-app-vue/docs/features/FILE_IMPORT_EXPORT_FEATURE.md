# 文件导入导出功能说明

## 功能概述

为项目文件管理组件（VirtualFileTree）添加了文件导入导出功能，允许用户在项目和外部文件系统之间复制文件和文件夹。

## 新增功能

### 1. 导入文件到项目

**位置**：文件树组件顶部的"导入文件"按钮

**功能**：
- 支持选择单个或多个文件
- 支持选择文件夹
- 自动将文件复制到项目目录
- 自动添加到数据库
- 显示导入进度和结果

**使用方法**：
1. 点击文件树顶部的"导入文件"按钮
2. 在弹出的文件选择对话框中选择要导入的文件或文件夹
3. 系统会自动将选中的文件复制到项目根目录
4. 导入完成后显示成功提示，文件树自动刷新

**示例代码**：
```javascript
// 调用导入接口
const result = await window.electron.ipcRenderer.invoke('project:import-files', {
  projectId: 'project-uuid',
  externalPaths: ['/path/to/file1.txt', '/path/to/folder'],
  targetDirectory: '/data/projects/project-uuid/'
});
```

### 2. 导出文件到外部

**位置**：文件树右键菜单中的"导出到外部"选项

**功能**：
- 支持导出单个文件
- 支持导出整个文件夹（包括子文件夹）
- 选择目标导出位置
- 显示导出进度和结果

**使用方法**：
1. 在文件树中右键点击要导出的文件或文件夹
2. 选择"导出到外部"菜单项
3. 在弹出的目录选择对话框中选择导出位置
4. 系统会自动将文件复制到选定位置
5. 导出完成后显示成功提示

**示例代码**：
```javascript
// 调用导出接口
const result = await window.electron.ipcRenderer.invoke('project:export-file', {
  projectPath: 'data/projects/project-uuid/file.txt',
  targetPath: 'C:/Users/username/Desktop/file.txt',
  isDirectory: false
});
```

## 新增 IPC 接口

### 主进程接口 (src/main/index.js)

#### 1. `project:export-file`

导出单个文件或文件夹到外部

**参数**：
```javascript
{
  projectPath: string,    // 项目内的文件路径
  targetPath: string,     // 目标路径
  isDirectory: boolean    // 是否是目录
}
```

**返回值**：
```javascript
{
  success: boolean,
  path: string,          // 导出的路径
  isDirectory: boolean
}
```

#### 2. `project:export-files`

批量导出多个文件到外部

**参数**：
```javascript
{
  files: Array<{name: string, path: string}>,
  targetDirectory: string
}
```

**返回值**：
```javascript
{
  success: boolean,
  results: Array<{success: boolean, name: string, path: string}>,
  successCount: number,
  totalCount: number
}
```

#### 3. `project:select-export-directory`

显示目录选择对话框

**返回值**：
```javascript
{
  success: boolean,
  path: string,      // 选中的目录路径
  canceled: boolean  // 是否取消
}
```

#### 4. `project:select-import-files`

显示文件选择对话框

**参数**：
```javascript
{
  allowDirectory: boolean,  // 是否允许选择目录
  filters: Array           // 文件过滤器（可选）
}
```

**返回值**：
```javascript
{
  success: boolean,
  filePaths: string[],  // 选中的文件路径数组
  canceled: boolean
}
```

#### 5. `project:import-files`

批量导入文件到项目

**参数**：
```javascript
{
  projectId: string,
  externalPaths: string[],     // 外部文件路径数组
  targetDirectory: string      // 目标目录
}
```

**返回值**：
```javascript
{
  success: boolean,
  results: Array<{success: boolean, fileId: string, name: string, path: string}>,
  successCount: number,
  totalCount: number
}
```

## 辅助函数

### `copyDirectory(source, destination)`

递归复制目录及其所有内容

**位置**：`src/main/index.js`

**功能**：
- 创建目标目录
- 递归复制所有子目录和文件
- 保持目录结构

**实现**：
```javascript
async function copyDirectory(source, destination) {
  const fs = require('fs').promises;
  const path = require('path');

  await fs.mkdir(destination, { recursive: true });
  const entries = await fs.readdir(source, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name);
    const destPath = path.join(destination, entry.name);

    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, destPath);
    } else {
      await fs.copyFile(sourcePath, destPath);
    }
  }
}
```

## UI 组件更新

### VirtualFileTree.vue

**新增属性**：
- `importing`: 导入状态标志
- `exporting`: 导出状态标志

**新增方法**：
- `handleImportFiles()`: 处理文件导入
- `handleExportFile(node)`: 处理文件导出

**UI 变化**：
1. 添加了文件树头部区域 (`.tree-header`)
2. 头部包含搜索框和导入按钮
3. 右键菜单新增"导出到外部"选项

**样式更新**：
```scss
.tree-header {
  border-bottom: 1px solid #e8e8e8;
  background: #fafafa;
}

.tree-search {
  padding: 8px;
}

.tree-actions {
  padding: 0 8px 8px 8px;
  display: flex;
  gap: 8px;
}
```

## 测试场景

### 导入测试

1. **单文件导入**
   - 点击"导入文件"按钮
   - 选择一个文本文件
   - 验证文件是否出现在文件树中

2. **多文件导入**
   - 点击"导入文件"按钮
   - 使用 Ctrl 选择多个文件
   - 验证所有文件是否都导入成功

3. **文件夹导入**
   - 点击"导入文件"按钮
   - 选择一个包含子文件夹的目录
   - 验证目录结构是否完整保留

### 导出测试

1. **单文件导出**
   - 右键点击一个文件
   - 选择"导出到外部"
   - 选择目标目录
   - 验证文件是否成功复制到目标位置

2. **文件夹导出**
   - 右键点击一个文件夹
   - 选择"导出到外部"
   - 选择目标目录
   - 验证整个文件夹结构是否完整导出

## 错误处理

所有操作都包含完善的错误处理：

1. **文件不存在**：显示错误提示
2. **权限不足**：显示权限错误
3. **磁盘空间不足**：显示空间不足错误
4. **取消操作**：静默处理，不显示错误

## 性能优化

1. **批量操作**：使用批量导入接口，减少IPC通信次数
2. **进度反馈**：显示loading状态，改善用户体验
3. **异步处理**：所有文件操作都是异步的，不阻塞UI

## 未来改进

1. **拖拽导入**：支持直接拖拽文件到文件树
2. **进度条**：显示大文件导入导出的详细进度
3. **文件过滤**：根据文件类型过滤导入文件
4. **批量导出**：支持多选文件批量导出
5. **导入位置选择**：允许用户选择导入到哪个文件夹
