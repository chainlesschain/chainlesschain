# 文件导入功能实现文档

**实现日期**: 2025-12-18
**版本**: v0.9.0
**优先级**: P0 (立即执行)

---

## 📋 功能概述

文件导入功能允许用户将各种格式的文档导入到知识库中，包括：
- **Markdown** (.md, .markdown)
- **PDF** (.pdf)
- **Word** (.doc, .docx)
- **纯文本** (.txt)

## 🏗️ 架构设计

### 后端模块

#### 1. FileImporter 类 (`src/main/import/file-importer.js`)

**职责**:
- 文件格式检测
- 文件内容解析
- 数据库存储
- 进度事件通知

**主要方法**:
```javascript
class FileImporter {
  // 单文件导入
  async importFile(filePath, options = {})

  // 批量导入
  async importFiles(filePaths, options = {})

  // 格式检测
  isSupportedFile(filePath)
  getFileType(filePath)

  // 格式处理器
  async importMarkdown(filePath, options)
  async importPDF(filePath, options)
  async importWord(filePath, options)
  async importText(filePath, options)
}
```

**事件系统**:
```javascript
// 导入开始
fileImporter.on('import-start', { filePath, fileType })

// 导入成功
fileImporter.on('import-success', { filePath, result })

// 导入失败
fileImporter.on('import-error', { filePath, error })

// 批量导入进度
fileImporter.on('import-progress', { current, total, status, filePath })

// 批量导入完成
fileImporter.on('import-complete', { success, failed, total })
```

### IPC 通信层

#### 主进程 IPC 处理器 (`src/main/index.js`)

```javascript
// 文件选择对话框
ipcMain.handle('import:select-files', async () => {
  const result = await dialog.showOpenDialog(...)
  return { canceled, filePaths }
})

// 单文件导入
ipcMain.handle('import:import-file', async (_, filePath, options) => {
  return await fileImporter.importFile(filePath, options)
})

// 批量导入
ipcMain.handle('import:import-files', async (_, filePaths, options) => {
  return await fileImporter.importFiles(filePaths, options)
})

// 获取支持的格式
ipcMain.handle('import:get-supported-formats', async () => {
  return fileImporter.getSupportedFormats()
})

// 检查文件支持
ipcMain.handle('import:check-file', async (_, filePath) => {
  return { isSupported, fileType }
})
```

#### Preload 暴露 API (`src/preload/index.js`)

```javascript
window.electronAPI.import = {
  selectFiles: () => ipcRenderer.invoke('import:select-files'),
  importFile: (filePath, options) => ipcRenderer.invoke('import:import-file', filePath, options),
  importFiles: (filePaths, options) => ipcRenderer.invoke('import:import-files', filePaths, options),
  getSupportedFormats: () => ipcRenderer.invoke('import:get-supported-formats'),
  checkFile: (filePath) => ipcRenderer.invoke('import:check-file', filePath),
  on: (event, callback) => ipcRenderer.on(event, callback),
  off: (event, callback) => ipcRenderer.removeListener(event, callback),
}
```

### 前端 UI 组件

#### FileImport.vue (`src/renderer/components/FileImport.vue`)

**功能特性**:
1. **文件选择**
   - 点击按钮打开文件对话框
   - 多文件选择支持
   - 格式过滤

2. **拖拽上传**
   - 拖拽文件到指定区域
   - 拖拽状态视觉反馈
   - 自动解析文件路径

3. **导入选项**
   - 知识类型选择 (笔记/文章/文档等)
   - 标签添加
   - 自动索引开关 (RAG)

4. **进度显示**
   - 实时进度条
   - 当前文件显示
   - 成功/失败统计

5. **结果展示**
   - 导入结果列表
   - 成功/失败分类
   - 错误信息显示
   - 分页浏览

**UI 布局**:
```
┌─────────────────────────────────────────┐
│ 文件导入                    [选择文件] │
├─────────────────────────────────────────┤
│ 导入进度                                │
│ ████████████████░░░░ 80%                │
│ 正在导入: 3 / 5 - document.pdf          │
├─────────────────────────────────────────┤
│ 导入选项 (可折叠)                       │
│ - 知识类型: [笔记 ▼]                    │
│ - 标签: [标签1] [标签2]                 │
│ - 自动索引: [✓]                         │
├─────────────────────────────────────────┤
│ 导入结果                                │
│ 成功: 4 / 5    失败: 1 / 5    总计: 5  │
│                                         │
│ ✓ document1.md (成功)                   │
│ ✓ document2.pdf (成功)                  │
│ ✗ document3.docx (失败: 依赖库未安装)   │
│ ✓ document4.txt (成功)                  │
│ ✓ document5.md (成功)                   │
├─────────────────────────────────────────┤
│ 或                                      │
│      [云图标]                           │
│   拖拽文件到此处                        │
│  或点击上方"选择文件"按钮               │
└─────────────────────────────────────────┘
```

## 📦 依赖库

### 必需依赖

```json
{
  "dependencies": {
    "pdf-parse": "^1.1.1",    // PDF 文件解析
    "mammoth": "^1.8.0"        // Word 文档解析
  }
}
```

### 安装命令

```bash
cd desktop-app-vue
npm install pdf-parse mammoth
```

## 🔄 数据流程

### 单文件导入流程

```
用户选择文件
    ↓
Renderer: import.selectFiles()
    ↓
Main: dialog.showOpenDialog()
    ↓
Renderer: import.importFile(filePath, options)
    ↓
Main: fileImporter.importFile()
    ↓
检测文件格式
    ↓
调用对应解析器 (importMarkdown/importPDF/importWord/importText)
    ↓
解析文件内容
    ↓
database.addKnowledgeItem()
    ↓
添加到 RAG 索引 (如果启用)
    ↓
返回结果 → Renderer
    ↓
显示导入结果
```

### 批量导入流程

```
用户选择多个文件
    ↓
Renderer: import.importFiles(filePaths, options)
    ↓
Main: fileImporter.importFiles()
    ↓
逐个文件处理
    ↓
每个文件导入 (同单文件流程)
    ↓
发送进度事件 → Renderer (实时更新 UI)
    ↓
统计成功/失败数量
    ↓
重建 RAG 索引
    ↓
返回批量结果 → Renderer
    ↓
显示汇总统计
```

## 📝 文件格式处理

### Markdown (.md, .markdown)

**特性**:
- YAML Front Matter 解析
- 自动提取标题 (title)
- 自动提取标签 (tags)
- 自动提取类型 (type)

**示例**:
```markdown
---
title: 我的文档
tags: tag1, tag2
type: article
---

# 文档内容

这是正文...
```

**解析逻辑**:
1. 读取文件内容
2. 检测 Front Matter (以 `---` 开始和结束)
3. 解析 YAML 元数据
4. 提取正文内容
5. 保存到数据库

### PDF (.pdf)

**依赖**: pdf-parse

**特性**:
- 提取纯文本内容
- 获取页数信息
- 保存 PDF 元信息

**解析逻辑**:
1. 读取 PDF 文件为 Buffer
2. 使用 pdf-parse 解析
3. 提取文本内容 (data.text)
4. 提取元信息 (data.info, data.numpages)
5. 保存到数据库

**注意**: PDF 图片和复杂布局可能无法完美解析

### Word (.doc, .docx)

**依赖**: mammoth

**特性**:
- 提取纯文本内容
- 自动转换格式

**解析逻辑**:
1. 使用 mammoth 读取 Word 文件
2. 提取纯文本 (extractRawText)
3. 保存到数据库

**注意**: 不支持图片、表格等复杂元素

### 纯文本 (.txt)

**特性**:
- 直接读取内容
- UTF-8 编码

**解析逻辑**:
1. 读取文件内容 (UTF-8)
2. 保存到数据库

## 🎯 使用方法

### 在应用中集成

1. **在路由中添加**:
```javascript
// src/renderer/router/index.js
import FileImport from '@/components/FileImport.vue'

const routes = [
  // ... 其他路由
  {
    path: '/import',
    name: 'Import',
    component: FileImport,
  },
]
```

2. **在菜单中添加入口**:
```vue
<!-- MainLayout.vue -->
<a-menu-item key="import">
  <router-link to="/import">
    <upload-outlined />
    <span>文件导入</span>
  </router-link>
</a-menu-item>
```

### 编程方式调用

```javascript
// 选择并导入文件
const { canceled, filePaths } = await window.electronAPI.import.selectFiles()
if (!canceled) {
  const result = await window.electronAPI.import.importFile(filePaths[0], {
    type: 'note',
    tags: ['imported'],
  })
  console.log('导入成功:', result)
}

// 批量导入
const results = await window.electronAPI.import.importFiles(filePaths, {
  type: 'document',
  tags: ['batch-import'],
})
console.log('批量导入完成:', results)

// 检查文件是否支持
const { isSupported, fileType } = await window.electronAPI.import.checkFile('/path/to/file.pdf')
```

## 🐛 错误处理

### 常见错误及解决方案

1. **PDF 解析失败**
   ```
   错误: 导入 PDF 失败: PDF 解析库未安装。请运行: npm install pdf-parse
   解决: cd desktop-app-vue && npm install pdf-parse
   ```

2. **Word 解析失败**
   ```
   错误: 导入 Word 失败: Word 解析库未安装。请运行: npm install mammoth
   解决: cd desktop-app-vue && npm install mammoth
   ```

3. **文件不存在**
   ```
   错误: 导入 Markdown 失败: ENOENT: no such file or directory
   解决: 检查文件路径是否正确
   ```

4. **编码错误**
   ```
   错误: 导入文本失败: Invalid character encoding
   解决: 确保文本文件使用 UTF-8 编码
   ```

## ⚡ 性能优化

1. **大文件处理**
   - PDF: 使用流式读取 (未来优化)
   - Word: 分块处理 (未来优化)

2. **批量导入**
   - 并发控制 (当前串行，未来可并行)
   - 进度反馈 (已实现)
   - 错误隔离 (已实现)

3. **RAG 索引**
   - 单文件: 即时添加索引
   - 批量: 导入完成后统一重建索引

## 🧪 测试

### 单元测试 (待实现)

```javascript
// test/file-importer.test.js
describe('FileImporter', () => {
  it('should import markdown file', async () => {
    const result = await fileImporter.importMarkdown('./test.md')
    expect(result.title).toBe('Test Document')
  })

  it('should handle PDF import', async () => {
    const result = await fileImporter.importPDF('./test.pdf')
    expect(result.pages).toBeGreaterThan(0)
  })
})
```

### 集成测试 (待实现)

```javascript
// test/file-import.e2e.js
describe('File Import UI', () => {
  it('should open file dialog on button click', async () => {
    await page.click('[data-testid="select-files-btn"]')
    // ... 断言
  })

  it('should show progress during import', async () => {
    // ... 测试导入进度
  })
})
```

## 📊 完成度

| 功能模块 | 状态 | 完成度 |
|---------|------|--------|
| Markdown 导入 | ✅ | 100% |
| PDF 导入 | ✅ | 100% |
| Word 导入 | ✅ | 100% |
| 文本导入 | ✅ | 100% |
| 批量导入 | ✅ | 100% |
| 拖拽上传 | ✅ | 100% |
| 进度显示 | ✅ | 100% |
| RAG 集成 | ✅ | 100% |
| UI 组件 | ✅ | 100% |
| 错误处理 | ✅ | 100% |
| **总体** | ✅ | **100%** |

## 🚀 下一步优化

### P1 优先级
- [ ] 图片上传和 OCR 识别
- [ ] 大文件分块处理
- [ ] 导入历史记录
- [ ] 导入模板配置

### P2 优先级
- [ ] Excel 文件导入 (.xlsx)
- [ ] HTML 文件导入
- [ ] 网页剪藏集成
- [ ] 云盘同步导入

### P3 优先级
- [ ] 自动分类 (基于内容)
- [ ] 智能摘要 (基于 LLM)
- [ ] 重复检测
- [ ] 增量导入 (避免重复)

## 📚 相关文档

- **系统设计**: `系统设计_个人移动AI管理系统.md` (数据采集层 2.1.1)
- **数据库设计**: `DATABASE.md`
- **RAG 集成**: `RAG_IMPLEMENTATION.md`
- **实现状态报告**: `IMPLEMENTATION_STATUS_REPORT.md`

---

**实现者**: Claude Code
**文档版本**: v1.0
**最后更新**: 2025-12-18
