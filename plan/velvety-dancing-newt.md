# 文件预览增强实施计划

## 执行摘要

ChainlessChain桌面应用已具备完善的文件预览系统（支持10+文件类型），本计划将在4个维度进行增强：

1. **新增文件格式支持**：Office文档、压缩包预览
2. **增强现有预览功能**：PDF标注、图片编辑、Markdown目录、代码搜索
3. **性能和体验优化**：大文件懒加载、缩略图缓存、全屏模式
4. **文件转换和导出**：格式转换、批量导出、截图录屏

**实施策略**：分3个阶段推进，优先快速见效的功能，采用增量开发避免破坏现有系统。

---

## 阶段1：高优先级/快速见效 (2-3周)

### 1.1 Office文件预览 (.docx, .xlsx, .pptx) - 高影响

**方案**：使用纯JS库实现跨平台预览（无需系统依赖）

**新增依赖**：
```json
{
  "docx-preview": "^0.3.0",        // Word预览
  "xlsx": "^0.18.5",               // Excel解析（已安装）
  "sheetjs-style": "^0.15.8",      // Excel样式支持
  "pptx2json": "^2.0.0"            // PowerPoint解析
}
```

**关键文件修改**：

1. **PreviewPanel.vue** (+200行)
   - 第210-230行：添加Office文件类型检测
   - 第305-330行：在`loadFileContent()`中添加Office加载逻辑
   - 模板部分：添加Office预览区域

2. **document-engine.js** (+250行)
   - 新增方法：`previewOfficeDocument(filePath, format)`
   - 集成docx-preview、xlsx、pptx2json库

3. **src/main/index.js** (+50行)
   - 新增IPC处理器：`ipcMain.handle('file:preview-office', ...)`

**实现复杂度**：中等（3-4天）

---

### 1.2 压缩文件预览 (.zip, .rar, .7z) - 中影响

**新增依赖**：
```json
{
  "adm-zip": "^0.5.10",            // ZIP支持（纯JS）
  "node-7z": "^3.0.0",             // 7-Zip包装器
  "unrar-promise": "^2.0.3"        // RAR支持（需二进制）
}
```

**新增文件**：

1. **src/main/archive/archive-manager.js** (新建，300行)
   - `listArchiveContents()` - 列出文件树
   - `extractToTemp()` - 提取单个文件到临时目录
   - `getArchiveInfo()` - 获取压缩包元信息

2. **src/renderer/components/projects/ArchivePreview.vue** (新建，250行)
   - 树形文件列表（使用Ant Design Tree）
   - 文件预览（双击预览内部文件）
   - 提取/下载按钮

3. **PreviewPanel.vue** (+30行)
   - 添加`archive`文件类型支持

**实现复杂度**：中等（2-3天）

---

### 1.3 大文件懒加载 - 关键性能优化

**问题**：当前系统全文件加载到内存（PreviewPanel.vue:295-337）

**方案**：虚拟滚动+分块加载（>10MB文件）

**新增依赖**：
```json
{
  "@tanstack/virtual-core": "^3.0.0"   // 虚拟滚动核心
}
```

**新增文件**：

1. **src/main/file/large-file-reader.js** (新建，200行)
   ```javascript
   class LargeFileReader {
     async readChunk(filePath, offset, size) {
       // 使用fs.createReadStream读取1MB块
     }
     async searchInFile(filePath, query) {
       // 流式搜索，无需加载全文件
     }
   }
   ```

2. **src/renderer/components/projects/LargeFilePreview.vue** (新建，300行)
   - 虚拟滚动容器
   - 每次加载50行
   - 双向无限滚动
   - 内置搜索功能

3. **PreviewPanel.vue** (+40行)
   - 在`loadFileContent()`中检测文件大小
   - 如果>10MB，切换到LargeFilePreview组件

**实现复杂度**：高（5-6天）

---

### 1.4 缩略图缓存系统 - 高影响

**当前状态**：image-processor.js有缩略图生成但无缓存

**新增文件**：

1. **src/main/cache/thumbnail-cache.js** (新建，250行)
   ```javascript
   class ThumbnailCache {
     constructor() {
       this.cacheDir = path.join(app.getPath('userData'), 'thumbnails');
       this.db = new Map(); // LRU缓存
       this.maxCacheSize = 500;
     }

     async generateAndCache(filePath, size = 200) {
       const hash = crypto.createHash('sha256').update(filePath).digest('hex');
       const cachePath = path.join(this.cacheDir, `${hash}_${size}.jpg`);

       if (await fs.pathExists(cachePath)) {
         return cachePath; // 缓存命中
       }

       // 使用Sharp生成缩略图
       await this.imageProcessor.generateThumbnail(...);
       return cachePath;
     }
   }
   ```

2. **集成到FileTree组件**：
   - 打开文件夹时后台生成缩略图
   - 可选网格视图显示缩略图

**实现复杂度**：中等（3天）

---

### 1.5 全屏预览模式 - 中影响

**实现方式**：增强PreviewPanel.vue

**修改**：
- **PreviewPanel.vue** (+60行)
  - 添加全屏按钮（header-right区域）
  - 添加fullscreen CSS类
  - F11快捷键触发
  - 全屏时隐藏工具栏（悬停显示）

**实现复杂度**：低（1天）

---

### 1.6 格式转换增强 (MD↔PDF↔Word)

**当前状态**：document-engine.js已有基础实现，需增强

**优化点**：

1. **document-engine.js** (+100行)
   - 改进`exportToPDF()`：Puppeteer已安装，增强样式
   - 改进`exportToDocx()`：优先使用pandoc，备选docx库
   - 新增`convertFormat()`：统一转换接口
   - 新增格式：PDF→Word（使用pdf2docx Python库）

2. **新增文件**：
   - **src/main/engines/converter-engine.js** (新建，400行)
     - 集中管理所有格式转换
     - Markdown ↔ PDF ↔ Word ↔ HTML
     - 使用Puppeteer（PDF生成）+ pandoc（备选）

3. **FileExportMenu.vue增强**：
   - 连接真实转换API（当前是占位符）
   - 添加进度条
   - 支持批量转换

**实现复杂度**：中高（4-5天）

---

## 阶段2：中优先级功能 (3-4周)

### 2.1 PDF标注和标记 - 高价值

**新增依赖**：
```json
{
  "pdfjs-dist": "^4.0.379",        // PDF渲染（替代vue-pdf-embed）
  "pdf-lib": "^1.17.1",            // PDF操作库
  "annotpdf": "^1.0.0"             // PDF标注
}
```

**新增文件**：

1. **src/renderer/components/projects/PDFAnnotator.vue** (新建，500行)
   - 工具栏：高亮、文本、画笔、形状
   - Canvas绘制
   - 标注保存为.json（不修改原PDF）
   - 导出带标注的PDF

2. **PreviewPanel.vue**：
   - PDF预览区添加"编辑PDF"按钮
   - 条件渲染PDFAnnotator

**实现复杂度**：高（6-7天）

---

### 2.2 图片编辑器 (裁剪、滤镜、旋转)

**当前状态**：image-processor.js有rotate/crop基础方法

**新增依赖**：
```json
{
  "tui-image-editor": "^3.15.3"    // 全功能图片编辑器
}
```

**新增文件**：

1. **src/renderer/components/projects/ImageEditor.vue** (新建，400行)
   - 集成tui-image-editor
   - 功能：裁剪、旋转、翻转、调整大小、滤镜、亮度/对比度、文本叠加
   - 保存编辑后的图片

2. **PreviewPanel.vue**：
   - 图片预览区添加"编辑图片"按钮
   - 弹出ImageEditor模态框

**实现复杂度**：中等（4天）

---

### 2.3 Markdown目录导航 + 代码搜索

**Markdown增强**：

1. **MarkdownEditor.vue** (+150行)
   - 新增依赖：`markdown-it-toc-done-right`, `markdown-it-anchor`
   - 侧边栏显示TOC
   - 点击跳转到对应章节
   - 锚点链接支持

**代码搜索增强**：

1. **切换到MonacoEditor**：
   - SimpleEditor.vue保留用于轻量场景
   - 代码文件默认使用MonacoEditor（已有组件）
   - MonacoEditor内置搜索（Ctrl+F）、符号搜索（Ctrl+Shift+O）

2. **ProjectDetailPage.vue**：
   - 添加编辑器选择逻辑（Monaco vs Simple）

**实现复杂度**：中等（3-4天）

---

### 2.4 文件对比视图

**新增依赖**：
```json
{
  "diff": "^5.2.0",                // Diff算法
  "monaco-diff-editor": "^0.55.1"  // Monaco Diff
}
```

**新增文件**：

1. **src/renderer/components/projects/FileDiffViewer.vue** (新建，350行)
   - 选择两个文件对比
   - Monaco Diff Editor显示差异
   - 支持内联/并排视图
   - 导出diff补丁

2. **集成点**：
   - 项目页面添加"对比文件"按钮
   - Git历史版本对比（集成现有git系统）

**实现复杂度**：高（5-6天）

---

### 2.5 截图和录屏功能

**新增依赖**：
```json
{
  "html2canvas": "^1.4.1",         // DOM转图片
  "@ffmpeg-installer/ffmpeg": "^1.1.0"  // FFmpeg
}
```

**实现**：

1. **PreviewPanel截图**：
   - 添加截图按钮
   - 使用html2canvas渲染当前预览内容
   - 保存为PNG

2. **录屏功能** (Main Process)：
   - **src/main/capture/screen-recorder.js** (新建)
   - 使用Electron desktopCapturer API
   - MediaRecorder录制为.webm
   - 可选转换为.mp4（FFmpeg）

**实现复杂度**：高（6天）

---

## 阶段3：扩展功能 (4+周，可选)

### 3.1 3D模型预览 (.obj, .stl, .gltf)

**依赖**：three.js
**复杂度**：极高（10+天）

### 3.2 电子书预览 (.epub, .mobi)

**依赖**：epubjs, mobi
**复杂度**：中等（4-5天）

### 3.3 CAD文件预览 (.dwg, .dxf)

**依赖**：商业API或Aspose.CAD
**复杂度**：极高（15+天）

---

## 架构设计原则

### IPC通信模式（继续遵循现有模式）

```javascript
// Main Process (src/main/index.js)
ipcMain.handle('feature:action', async (event, ...args) => {
  try {
    const result = await featureModule.action(...args);
    return { success: true, data: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Renderer (Vue component)
const result = await window.electronAPI.feature.action(...args);
if (!result.success) {
  message.error(result.error);
}
```

### 文件大小阈值配置

**新增**：`src/main/config/preview-config.js`
```javascript
module.exports = {
  LARGE_FILE_THRESHOLD: 10 * 1024 * 1024,    // 10MB
  THUMBNAIL_SIZE: 200,
  THUMBNAIL_CACHE_MAX: 500,
  VIDEO_PREVIEW_MAX_SIZE: 500 * 1024 * 1024, // 500MB
  PDF_MAX_PAGES_PREVIEW: 50,
  VIRTUAL_SCROLL_CHUNK_SIZE: 1024 * 1024,    // 1MB
};
```

### 数据库扩展（可选）

如需保存预览设置/标注：

```sql
-- src/main/database.js

CREATE TABLE IF NOT EXISTS file_preview_settings (
  file_id INTEGER PRIMARY KEY,
  last_zoom REAL DEFAULT 1.0,
  last_page INTEGER DEFAULT 1,
  annotations TEXT,  -- JSON
  created_at INTEGER DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER DEFAULT (strftime('%s', 'now'))
);

CREATE TABLE IF NOT EXISTS thumbnail_cache (
  file_path TEXT PRIMARY KEY,
  thumbnail_path TEXT NOT NULL,
  file_hash TEXT,
  created_at INTEGER DEFAULT (strftime('%s', 'now'))
);
```

---

## 关键文件清单

### 需要修改的现有文件

1. **C:\code\chainlesschain\desktop-app-vue\src\renderer\components\projects\PreviewPanel.vue**
   - 文件类型检测扩展（第210-230行）
   - 加载逻辑增强（第295-337行）
   - 新预览类型UI

2. **C:\code\chainlesschain\desktop-app-vue\src\main\engines\document-engine.js**
   - Office文档预览方法
   - 格式转换增强

3. **C:\code\chainlesschain\desktop-app-vue\src\main\image\image-processor.js**
   - 与缩略图缓存集成

4. **C:\code\chainlesschain\desktop-app-vue\src\main\index.js**
   - 新增20+个IPC处理器

5. **C:\code\chainlesschain\desktop-app-vue\package.json**
   - 新增15+个npm依赖

### 需要新建的文件

**Main Process (Node.js后端)**：
- `src/main/archive/archive-manager.js` - 压缩包管理
- `src/main/file/large-file-reader.js` - 大文件读取
- `src/main/cache/thumbnail-cache.js` - 缩略图缓存
- `src/main/engines/converter-engine.js` - 格式转换引擎
- `src/main/capture/screen-recorder.js` - 录屏功能
- `src/main/config/preview-config.js` - 配置常量

**Renderer Process (Vue前端)**：
- `src/renderer/components/projects/ArchivePreview.vue` - 压缩包预览
- `src/renderer/components/projects/LargeFilePreview.vue` - 大文件预览
- `src/renderer/components/projects/PDFAnnotator.vue` - PDF标注
- `src/renderer/components/projects/ImageEditor.vue` - 图片编辑器
- `src/renderer/components/projects/FileDiffViewer.vue` - 文件对比

---

## 依赖包汇总

### 阶段1（必需）
```json
{
  "docx-preview": "^0.3.0",
  "sheetjs-style": "^0.15.8",
  "pptx2json": "^2.0.0",
  "adm-zip": "^0.5.10",
  "node-7z": "^3.0.0",
  "unrar-promise": "^2.0.3",
  "@tanstack/virtual-core": "^3.0.0"
}
```

**Bundle大小影响**：+5-8MB

### 阶段2（推荐）
```json
{
  "pdfjs-dist": "^4.0.379",
  "pdf-lib": "^1.17.1",
  "annotpdf": "^1.0.0",
  "tui-image-editor": "^3.15.3",
  "markdown-it-toc-done-right": "^4.2.0",
  "markdown-it-anchor": "^9.0.1",
  "diff": "^5.2.0",
  "html2canvas": "^1.4.1",
  "@ffmpeg-installer/ffmpeg": "^1.1.0"
}
```

**Bundle大小影响**：+10-15MB

### 缓解策略
- 动态导入（lazy loading）
- Tree shaking
- 按需安装（首次使用时下载）

---

## 向后兼容性保证

1. **保留现有预览处理器**：新功能作为额外case，不修改现有逻辑
2. **数据库迁移**：使用版本化迁移，提供回滚脚本
3. **配置默认值**：所有新配置提供合理默认值
4. **API兼容**：保持现有IPC处理器不变，新功能使用新名称

---

## 成功指标

### 覆盖率
- 支持文件类型：10 → 20+ 种
- Office文档：完整预览（70%渲染精度）
- 压缩包：列表+预览内部文件

### 性能
- 大文件（100MB）加载：<2秒
- 缩略图缓存命中率：>80%
- 内存占用（10个预览）：<500MB

### 用户体验
- 全屏模式、对比视图、批量操作
- PDF标注、图片编辑
- 格式转换成功率：>95%

---

## 风险缓解

### 技术风险
1. **Bundle过大** → 动态导入、按需加载
2. **跨平台兼容** → 使用纯JS库、多平台测试
3. **性能下降** → 虚拟滚动、缓存、分块加载
4. **第三方库维护** → 选择活跃项目、准备备选方案

### 实施风险
1. **破坏现有功能** → 增量开发、充分测试、保持向后兼容
2. **时间超期** → 分阶段实施、优先核心功能

---

## 实施时间线

### 第1-3周：阶段1
- 第1周：Office文件预览 + 大文件懒加载
- 第2周：缩略图缓存 + 全屏模式 + 压缩包预览
- 第3周：格式转换增强 + 批量导出

### 第4-7周：阶段2
- 第4周：PDF标注 + 图片编辑器
- 第5周：Markdown目录 + 代码搜索
- 第6周：文件对比视图 + 版本历史
- 第7周：截图/录屏 + 测试优化

### 第8周+：阶段3（可选）
- 根据用户反馈决定优先级

---

## 下一步行动

1. **立即行动**：安装阶段1依赖包
   ```bash
   cd desktop-app-vue
   npm install docx-preview sheetjs-style pptx2json adm-zip node-7z @tanstack/virtual-core
   ```

2. **开始实施**：从Office文件预览着手（最高影响）

3. **增量测试**：每个功能完成后立即测试，避免积累问题

4. **用户反馈**：阶段1完成后收集反馈，调整阶段2优先级
