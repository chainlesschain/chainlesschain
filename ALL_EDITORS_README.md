# ChainlessChain 编辑器功能完整说明

## 🎯 项目进度总览

| 编辑器 | 状态 | 完成度 | 文档 |
|-------|------|--------|------|
| Excel编辑器 | ✅ 已完成 | 100% | `EXCEL_EDITOR_README.md` |
| Word/富文本编辑器 | ✅ 已完成 | 100% | 本文档 |
| 代码编辑器(Monaco) | 📋 待实现 | 0% | `EDITORS_IMPLEMENTATION_GUIDE.md` |
| PPT编辑器 | 📋 待实现 | 0% | `EDITORS_IMPLEMENTATION_GUIDE.md` |
| Markdown增强 | 📋 待实现 | 0% | `EDITORS_IMPLEMENTATION_GUIDE.md` |
| Web开发引擎 | 📋 待实现 | 0% | `EDITORS_IMPLEMENTATION_GUIDE.md` |

---

## ✅ 已完成的编辑器

### 1. Excel编辑器

**状态**: ✅ **100%完成**

**功能特性**:
- ✅ 完整的表格编辑（单元格、行、列）
- ✅ 多工作表支持
- ✅ 单元格格式化（粗体、斜体、对齐）
- ✅ 数据操作（排序、筛选、求和、平均值）
- ✅ 导出功能（Excel/CSV/JSON）
- ✅ 自动保存

**技术栈**:
- 后端: `exceljs`, `papaparse`
- 前端: `jspreadsheet-ce`
- 文件: `ExcelEditor.vue`, `excel-engine.js`

**使用方法**:
```javascript
// 在项目中打开.xlsx/.xls/.csv文件，自动启动Excel编辑器
```

**详细文档**: 查看 `EXCEL_EDITOR_README.md`

---

### 2. Word/富文本编辑器

**状态**: ✅ **100%完成**

**功能特性**:
- ✅ 富文本编辑（粗体、斜体、下划线、删除线）
- ✅ 标题格式（H1-H3）
- ✅ 列表（有序/无序）
- ✅ 文本对齐（左/中/右）
- ✅ 字体大小调整（10-32px）
- ✅ 引用块
- ✅ 导出功能（Word/Markdown/HTML）
- ✅ 自动保存（2秒延迟）
- ✅ 字数统计
- ✅ 快捷键支持（Ctrl+S, Ctrl+B, Ctrl+I, Ctrl+U）

**技术栈**:
- 后端: `docx`, `mammoth`, `marked`
- 前端: HTML ContentEditable + 自定义工具栏
- 文件: `RichTextEditor.vue`, `word-engine.js`

**使用方法**:
```vue
<RichTextEditor
  :file="currentFile"
  :initial-content="htmlContent"
  :auto-save="true"
  @change="handleChange"
  @save="handleSave"
/>
```

**工具栏功能**:
| 功能分类 | 具体功能 |
|---------|---------|
| 文本格式 | 粗体、斜体、下划线、删除线 |
| 字体大小 | 10, 12, 14, 16, 18, 20, 24, 28, 32 px |
| 文本对齐 | 左对齐、居中、右对齐 |
| 列表 | 有序列表、无序列表 |
| 段落格式 | 标题1-3、正文、引用 |
| 导出 | Word(.docx)、Markdown(.md)、HTML(.html)、PDF(计划中) |

**导出功能详解**:

#### 导出为Word (.docx)
- 保留所有格式（粗体、斜体、标题等）
- 使用docx库生成
- 完整保留文档结构

#### 导出为Markdown (.md)
- 自动转换HTML标签为Markdown语法
- H1-H3 → `#`, `##`, `###`
- 粗体 → `**text**`
- 斜体 → `*text*`
- 段落保留

#### 导出为HTML (.html)
- 生成完整的HTML文档
- 包含基础样式
- 可在浏览器中直接打开

**快捷键**:
- `Ctrl+S`: 保存
- `Ctrl+B`: 粗体
- `Ctrl+I`: 斜体
- `Ctrl+U`: 下划线

**数据格式**:

**读取Word文档**:
```javascript
const result = await window.electronAPI.file.readWord(filePath);
// 返回:
{
  success: true,
  html: "<p>HTML内容</p>",
  text: "纯文本内容",
  content: {
    paragraphs: [
      {
        text: "段落文本",
        style: { bold: true, italic: false },
        heading: 1
      }
    ]
  },
  metadata: {
    fileName: "document.docx",
    size: 12345,
    created: Date,
    modified: Date
  }
}
```

**保存Word文档**:
```javascript
await window.electronAPI.file.writeWord(filePath, {
  title: "文档标题",
  paragraphs: [
    {
      text: "段落内容",
      style: {
        bold: true,
        italic: false,
        fontSize: 14
      },
      heading: 1,
      alignment: 'left'
    }
  ]
});
```

**格式转换**:

```javascript
// Markdown → Word
await window.electronAPI.file.markdownToWord(
  markdownText,
  'output.docx',
  { title: '文档标题' }
);

// Word → Markdown
const result = await window.electronAPI.file.wordToMarkdown('input.docx');
console.log(result.markdown);

// HTML → Word
await window.electronAPI.file.htmlToWord(
  htmlContent,
  'output.docx',
  { title: '文档标题' }
);
```

---

## 📦 依赖包安装

### 已安装的依赖
```bash
cd desktop-app-vue

# Excel编辑器
npm install exceljs jspreadsheet-ce papaparse

# Word编辑器
npm install docx mammoth marked

# 代码编辑器（已安装）
# monaco-editor vite-plugin-monaco-editor
```

### 待安装的依赖（用于未完成的编辑器）
```bash
# PPT编辑器
npm install pptxgenjs

# Markdown增强
npm install markdown-it mermaid katex

# 其他
npm install highlight.js
```

---

## 🏗️ 架构说明

### 整体架构

```
ChainlessChain编辑器系统
│
├── 后端引擎 (Main Process)
│   ├── excel-engine.js          ✅ Excel处理引擎
│   ├── word-engine.js            ✅ Word处理引擎
│   ├── ppt-engine.js             📋 PPT处理引擎 (待实现)
│   └── document-engine.js        ⚠️ 通用文档引擎 (需增强)
│
├── IPC通信层
│   ├── file-ipc.js               ✅ 文件操作IPC处理器
│   └── preload/index.js          ✅ API暴露
│
├── 前端编辑器组件 (Renderer Process)
│   ├── ExcelEditor.vue           ✅ Excel编辑器
│   ├── RichTextEditor.vue        ✅ Word/富文本编辑器
│   ├── CodeEditor.vue            📋 代码编辑器 (待实现)
│   ├── PPTEditor.vue             📋 PPT编辑器 (待实现)
│   ├── WebDevEditor.vue          📋 Web开发编辑器 (待实现)
│   └── SimpleEditor.vue          ✅ 简单文本编辑器 (已有)
│
└── 集成页面
    └── ProjectDetailPage.vue     ✅ 项目详情页（已集成Excel和Word）
```

### 数据流

```
用户操作
  ↓
前端编辑器组件 (Vue)
  ↓
IPC调用 (window.electronAPI.file.*)
  ↓
Preload桥接 (contextBridge)
  ↓
IPC处理器 (file-ipc.js)
  ↓
后端引擎 (*-engine.js)
  ↓
文件系统操作 (fs, 第三方库)
```

### 文件类型识别流程

在`ProjectDetailPage.vue`中:

```javascript
// 1. 计算文件类型信息
const fileTypeInfo = computed(() => {
  const ext = currentFile.value.file_name.split('.').pop().toLowerCase();
  return {
    isExcel: ['xlsx', 'xls', 'csv'].includes(ext),
    isWord: ['docx', 'doc'].includes(ext),
    isPPT: ['pptx', 'ppt'].includes(ext),
    isCode: ['js', 'ts', 'py', 'java'].includes(ext),
    // ...
  };
});

// 2. 决定使用哪个编辑器
const shouldShowExcelEditor = computed(() => {
  return fileTypeInfo.value?.isExcel;
});

const shouldShowWordEditor = computed(() => {
  return fileTypeInfo.value?.isWord;
});
// ...

// 3. 条件渲染编辑器
<ExcelEditor v-if="shouldShowExcelEditor" />
<RichTextEditor v-else-if="shouldShowWordEditor" />
<SimpleEditor v-else-if="shouldShowEditor" />
```

---

## 🚀 快速开始

### 1. 安装依赖

```bash
cd C:/code/chainlesschain/desktop-app-vue
npm install docx mammoth marked exceljs jspreadsheet-ce papaparse
```

### 2. 构建主进程

```bash
npm run build:main
```

### 3. 启动应用

```bash
npm run dev
```

### 4. 测试编辑器

#### 测试Excel编辑器
1. 在项目中创建或上传 `.xlsx` 文件
2. 点击文件，Excel编辑器自动启动
3. 尝试编辑、插入行列、格式化
4. 测试导出功能

#### 测试Word编辑器
1. 在项目中创建或上传 `.docx` 文件
2. 点击文件，Word编辑器自动启动
3. 尝试富文本编辑、格式化
4. 测试导出为Markdown和HTML

---

## 📚 API参考

### 文件操作API (window.electronAPI.file)

#### Excel相关
```javascript
// 读取Excel
const data = await window.electronAPI.file.readExcel(filePath);

// 写入Excel
await window.electronAPI.file.writeExcel(filePath, data);

// Excel → JSON
const jsonData = await window.electronAPI.file.excelToJSON(filePath);

// JSON → Excel
await window.electronAPI.file.jsonToExcel(jsonData, outputPath);
```

#### Word相关
```javascript
// 读取Word
const result = await window.electronAPI.file.readWord(filePath);

// 写入Word
await window.electronAPI.file.writeWord(filePath, content);

// Markdown → Word
await window.electronAPI.file.markdownToWord(markdown, outputPath, options);

// Word → Markdown
const result = await window.electronAPI.file.wordToMarkdown(filePath);

// HTML → Word
await window.electronAPI.file.htmlToWord(html, outputPath, options);
```

#### 通用文件操作
```javascript
// 读取文件内容
const content = await window.electronAPI.file.readContent(filePath);

// 写入文件内容
await window.electronAPI.file.writeContent(filePath, content);

// 文件是否存在
const exists = await window.electronAPI.file.exists(filePath);

// 获取文件信息
const stats = await window.electronAPI.file.stat(filePath);

// 另存为
await window.electronAPI.file.saveAs(sourceFilePath);
```

#### 对话框API (window.electronAPI.dialog)
```javascript
// 显示打开文件对话框
const result = await window.electronAPI.dialog.showOpenDialog({
  filters: [
    { name: 'Excel文件', extensions: ['xlsx', 'xls'] }
  ]
});

// 显示保存文件对话框
const result = await window.electronAPI.dialog.showSaveDialog({
  defaultPath: 'document.docx',
  filters: [
    { name: 'Word文档', extensions: ['docx'] }
  ]
});
```

---

## 🐛 已知问题和限制

### Excel编辑器
- ⚠️ 复杂公式支持有限
- ⚠️ 不支持图表
- ⚠️ 不支持VBA宏
- ⚠️ 单个文件建议不超过10MB

### Word编辑器
- ⚠️ 不支持复杂表格
- ⚠️ 图片插入功能有限
- ⚠️ PDF导出需要外部工具（LibreOffice）
- ⚠️ 样式支持基础

### 通用限制
- ⚠️ 文件大小限制：建议单文件 < 10MB
- ⚠️ 并发编辑：暂不支持多用户实时协作
- ⚠️ 版本控制：依赖Git，未集成文档版本对比

---

## 🔧 故障排查

### 问题1: 编辑器无法加载

**症状**: 点击文件后编辑器不显示或报错

**解决方案**:
1. 检查文件扩展名是否正确
2. 查看浏览器控制台错误信息
3. 确认依赖包已安装: `npm list docx exceljs`
4. 重新构建主进程: `npm run build:main`

### 问题2: 保存失败

**症状**: 点击保存按钮后提示失败

**解决方案**:
1. 检查文件权限
2. 确认磁盘空间充足
3. 查看文件是否被其他程序占用
4. 尝试另存为到其他位置

### 问题3: 导出功能不工作

**症状**: 点击导出后无响应或报错

**解决方案**:
1. 确认相关依赖已安装（`docx`, `exceljs`等）
2. 检查导出目标路径是否有写入权限
3. 查看控制台错误信息
4. 尝试使用默认路径导出

### 问题4: 依赖包安装失败

**症状**: `npm install`时报错

**解决方案**:
```bash
# 清理npm缓存
npm cache clean --force

# 使用--force强制安装
npm install docx --force
npm install exceljs --force

# 或使用淘宝镜像
npm install --registry=https://registry.npmmirror.com
```

---

## 📈 性能优化建议

### 1. 文件大小优化
- 大文件分割为多个小文件
- 使用CSV代替Excel（数据量大时）
- 定期清理不需要的内容

### 2. 编辑器性能
- 关闭不需要的自动保存
- 减少工作表数量（Excel）
- 避免复杂公式和格式

### 3. 内存优化
- 及时关闭不用的文件标签页
- 定期重启应用
- 监控内存使用情况

---

## 🎯 下一步开发计划

参考 `EDITORS_IMPLEMENTATION_GUIDE.md` 了解详细的实现方案。

### 短期 (1-2周)
- [ ] 实现代码编辑器 (Monaco Editor)
  - 优先级: ⭐⭐⭐ 高
  - 依赖: 已安装 `monaco-editor`
  - 预计工作量: 2-3天

- [ ] 增强Markdown编辑器
  - 优先级: ⭐⭐⭐ 高
  - 功能: 实时预览、导出、图表支持
  - 预计工作量: 2-3天

### 中期 (2-4周)
- [ ] 实现Web开发引擎 (HTML/CSS/JS实时预览)
  - 优先级: ⭐⭐ 中
  - 预计工作量: 3-4天

- [ ] 实现PPT编辑器
  - 优先级: ⭐ 低
  - 依赖: 需安装 `pptxgenjs`
  - 预计工作量: 4-5天

### 长期 (1-2月)
- [ ] 图表编辑器
- [ ] PDF编辑器
- [ ] 思维导图编辑器
- [ ] 协作编辑功能
- [ ] 版本对比和合并

---

## 💡 最佳实践

### 1. 文件组织
- 使用清晰的文件命名
- 按项目类型分类文件
- 定期备份重要文档

### 2. 编辑习惯
- 利用自动保存功能
- 重要操作前手动保存
- 使用版本控制（Git）
- 定期导出备份

### 3. 性能考虑
- 避免单个文件过大
- 及时清理临时文件
- 合理使用预览功能
- 关闭不需要的编辑器标签

### 4. 安全建议
- 定期备份数据
- 使用Git追踪变更
- 敏感文档加密存储
- 注意文件共享权限

---

## 🆘 获取帮助

### 文档资源
- **Excel编辑器**: `EXCEL_EDITOR_README.md`
- **编辑器实现指南**: `EDITORS_IMPLEMENTATION_GUIDE.md`
- **系统设计**: `系统设计_个人移动AI管理系统.md`
- **快速开始**: `QUICK_START.md`

### 问题反馈
- GitHub Issues: 报告bug和问题
- GitHub Discussions: 功能建议和讨论

### 社区支持
- 查看项目Wiki
- 阅读技术博客
- 参与社区讨论

---

## 📝 更新日志

### v1.0.0 (2025-12-25)
- ✅ 完成Excel编辑器实现
- ✅ 完成Word/富文本编辑器实现
- ✅ 集成到ProjectDetailPage
- ✅ 添加完整的API文档
- ✅ 创建编辑器实现指南

### 下一版本计划 (v1.1.0)
- 🔜 代码编辑器(Monaco)
- 🔜 Markdown增强
- 🔜 Web开发引擎

---

**版本**: v1.0.0
**最后更新**: 2025-12-25
**作者**: ChainlessChain Team
**许可**: MIT
