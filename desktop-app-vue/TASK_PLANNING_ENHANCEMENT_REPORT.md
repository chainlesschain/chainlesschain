# 任务规划系统增强报告

**日期**: 2026-01-05
**版本**: v1.0
**作者**: Claude Code

## 概述

本次优化主要针对任务规划系统进行全面增强，参考PPT引擎的实现模式，为其他文档类型（Word、Excel、PDF、图片、视频、Web等）实现了类似的优化。目标是提供更精准的意图识别和更高质量的文档生成能力。

## 主要修改

### 1. 意图识别器增强 (`ai-engine/intent-recognizer.js`)

#### 新增功能

1. **更细粒度的文件类型识别**
   - 新增 `media` 项目类型（图片、视频、音频）
   - 扩展文档子类型：ppt、word、pdf、markdown、text
   - 扩展数据子类型：excel、csv、analysis
   - 扩展Web子类型：website、webpage、webapp

2. **新增字段**
   - `toolEngine`: 建议使用的引擎名称（如 `word-engine`、`excel-engine`）
   - `outputFormat`: 期望的输出格式（如 `docx`、`xlsx`、`pdf`）

3. **增强的关键词映射表**
   ```javascript
   const keywordMappings = {
     ppt: { keywords: ['ppt', 'powerpoint', '演示', '幻灯片'], toolEngine: 'ppt-engine' },
     word: { keywords: ['word', 'doc', '文档', '报告'], toolEngine: 'word-engine' },
     excel: { keywords: ['excel', '表格', '数据表'], toolEngine: 'excel-engine' },
     pdf: { keywords: ['pdf', '导出pdf'], toolEngine: 'pdf-engine' },
     image: { keywords: ['图片', '图像', '海报'], toolEngine: 'image-engine' },
     video: { keywords: ['视频', '短视频'], toolEngine: 'video-engine' },
     // ... 更多类型
   };
   ```

4. **辅助函数**
   - `inferOutputFormat(subType)`: 根据子类型推断输出格式
   - `inferToolEngine(subType)`: 根据子类型推断工具引擎

#### 使用示例

```javascript
const { recognizeProjectIntent } = require('./ai-engine/intent-recognizer');

const result = await recognizeProjectIntent('生成一份年度总结报告', llmManager);
// 返回:
// {
//   projectType: 'document',
//   subType: 'word',
//   outputFormat: 'docx',
//   toolEngine: 'word-engine',
//   confidence: 0.9,
//   detectedKeywords: ['报告'],
//   ...
// }
```

### 2. Word引擎增强 (`engines/word-engine.js`)

#### 新增方法

1. **`handleProjectTask(params)`**
   - 处理任务规划系统的项目任务
   - 参数：
     - `description`: 文档描述
     - `projectPath`: 项目路径
     - `llmManager`: LLM管理器
     - `action`: 操作类型（默认: `create_document`）

2. **`generateDocumentStructureFromDescription(description, llmManager)`**
   - 使用LLM生成Word文档结构
   - 返回包含title和paragraphs的JSON结构
   - 支持本地LLM和后端AI服务降级

3. **`normalizeDocumentStructure(structure, description)`**
   - 规范化文档结构
   - 确保所有字段完整且类型正确

4. **`getDefaultDocumentStructure(description)`**
   - 提供默认文档结构（降级方案）

5. **`queryBackendAI(prompt)`**
   - 后端AI服务降级方案
   - 处理SSE流式响应

#### 生成质量提升

- **完整的内容生成**: 不再使用占位符，LLM生成实际的文档内容
- **结构化组织**: 使用不同级别的标题（heading 1-6）组织文档
- **样式支持**: 支持粗体、斜体、下划线、字体颜色等样式
- **专业格式**: 符合中文写作规范

### 3. Excel引擎增强 (`engines/excel-engine.js`)

#### 新增方法

1. **`handleProjectTask(params)`**
   - 处理Excel表格生成任务
   - 生成完整的工作簿结构（sheets、columns、rows）

2. **`generateTableStructureFromDescription(description, llmManager)`**
   - 使用LLM生成Excel表格结构
   - 支持多个工作表
   - 自动生成列定义和数据行

3. **`normalizeTableStructure(structure, description)`**
   - 规范化表格结构
   - 确保列数一致、类型正确

4. **`getDefaultTableStructure(description)`**
   - 提供默认表格结构（3列：项目、内容、备注）

5. **`queryBackendAI(prompt)`**
   - 后端AI服务降级方案

#### 生成质量提升

- **智能数据生成**: LLM生成3-5行有意义的示例数据
- **类型识别**: 自动识别数据类型（string/number/boolean/date）
- **格式化**: 表头行自动加粗并设置背景色
- **完整结构**: 包含columns、rows、metadata等完整信息

### 4. PDF引擎增强 (`engines/pdf-engine.js`)

#### 新增方法

1. **`handleProjectTask(params)`**
   - 处理PDF文档生成任务
   - 通过Markdown → HTML → PDF流程生成

2. **`generateMarkdownContentFromDescription(description, llmManager)`**
   - 使用LLM生成Markdown内容
   - 自动提取标题作为文件名

3. **`extractTitle(markdownContent)`**
   - 从Markdown内容中提取一级标题

4. **`queryBackendAI(prompt)`**
   - 后端AI服务降级方案

#### 生成质量提升

- **专业排版**: 使用Electron的printToPDF功能，确保高质量输出
- **完整内容**: LLM生成的Markdown包含标题、章节、列表等完整结构
- **格式保留**: 支持表格、代码块、引用等Markdown元素
- **自适应页面**: 默认A4页面，支持自定义页面尺寸

### 5. 图片、视频、Web引擎

**注意**: 从代码检查发现，这些引擎已经实现了`handleProjectTask`方法，本次优化主要集中在意图识别器的增强，确保这些引擎能被正确识别和调用。

## 任务规划系统集成

### 任务规划器调用流程

```javascript
// 1. 意图识别
const intent = await recognizeProjectIntent(userInput, llmManager);

// 2. 任务拆解
const taskPlan = await taskPlanner.decomposeTask(userInput, {
  projectId,
  projectType: intent.projectType,
  subType: intent.subType,
  toolEngine: intent.toolEngine
});

// 3. 执行任务
const result = await taskPlanner.executeTaskPlan(taskPlan, projectContext, progressCallback);
```

### 引擎自动选择

任务规划器会根据`subtask.tool`自动选择对应的引擎：

```javascript
// task-planner-enhanced.js 中的引擎映射
switch (tool) {
  case 'web-engine':
    return await this.executeWebEngineTask(subtask, projectContext);
  case 'document-engine':
    return await this.executeDocumentEngineTask(subtask, projectContext);
  case 'word-engine':
    return await this.executeWordEngineTask(subtask, projectContext);
  case 'excel-engine':
    return await this.executeExcelEngineTask(subtask, projectContext);
  case 'ppt-engine':
    return await this.executePPTEngineTask(subtask, projectContext);
  case 'pdf-engine':
    return await this.executePDFEngineTask(subtask, projectContext);
  // ...
}
```

## 生成质量对比

### 优化前

- **意图识别**: 只能识别大类（document、web、app、data、code）
- **文档生成**: 使用模板+占位符，需要用户手动填充
- **表格生成**: 固定3列结构，示例数据简单
- **PDF生成**: 不支持

### 优化后

- **意图识别**: 精确识别到子类型（ppt、word、excel、pdf、image、video）
- **文档生成**: LLM生成完整内容，结构化、专业化
- **表格生成**: LLM生成真实数据，列数可变，类型准确
- **PDF生成**: 支持通过Markdown → PDF生成高质量文档

## 使用示例

### 示例1: 生成Word文档

```javascript
// 用户输入
"写一份2024年度工作总结报告"

// 意图识别结果
{
  projectType: 'document',
  subType: 'word',
  toolEngine: 'word-engine',
  outputFormat: 'docx'
}

// 生成的文档结构
{
  title: "2024年度工作总结报告",
  paragraphs: [
    { text: "概述", heading: 1 },
    { text: "2024年是充实的一年...", },
    { text: "主要成就", heading: 1 },
    { text: "1. 完成了...", },
    // ... 更多段落
  ]
}
```

### 示例2: 生成Excel表格

```javascript
// 用户输入
"制作一个员工考勤统计表"

// 意图识别结果
{
  projectType: 'data',
  subType: 'excel',
  toolEngine: 'excel-engine',
  outputFormat: 'xlsx'
}

// 生成的表格结构
{
  name: "员工考勤统计表",
  sheets: [{
    name: "考勤记录",
    columns: [
      { header: "员工姓名", width: 150 },
      { header: "部门", width: 150 },
      { header: "出勤天数", width: 100 },
      { header: "迟到次数", width: 100 },
      { header: "请假天数", width: 100 }
    ],
    rows: [
      // 表头行 + 3-5行示例数据
    ]
  }]
}
```

### 示例3: 生成PDF文档

```javascript
// 用户输入
"生成产品使用手册PDF"

// 意图识别结果
{
  projectType: 'document',
  subType: 'pdf',
  toolEngine: 'pdf-engine',
  outputFormat: 'pdf'
}

// 生成流程
LLM生成Markdown内容 → 转换为HTML → Electron printToPDF → 生成PDF文件
```

## 注意事项

### 1. LLM依赖

所有引擎的`handleProjectTask`方法都依赖LLM服务：
- **优先使用**: 本地LLM（通过llmManager）
- **降级方案**: 后端AI服务（http://localhost:8001）

### 2. 后端AI服务配置

确保后端AI服务正常运行：
```bash
cd backend/ai-service
uvicorn main:app --reload --port 8001
```

### 3. Token限制

不同文档类型的maxTokens配置：
- Word文档: 3000 tokens
- Excel表格: 3000 tokens
- PDF文档: 3000 tokens
- PPT大纲: 2000 tokens

### 4. 文件命名

所有引擎会从生成的内容中提取标题作为文件名，并过滤非法字符：
```javascript
fileName.replace(/[\/\\:*?"<>|]/g, '-')
```

## 下一步计划

1. **增加用户交互**
   - 类似Claude Plan模式，生成计划后先让用户确认
   - 支持用户调整生成参数（如表格列数、文档风格等）

2. **模板和技能集成**
   - 参考现有模板库，生成更专业的文档
   - 集成技能系统，自动推荐相关技能

3. **质量评估**
   - 添加生成质量评分机制
   - 支持用户反馈和迭代优化

4. **性能优化**
   - 缓存常用的LLM响应
   - 优化大文档的生成速度

## 总结

本次优化显著提升了任务规划系统的能力：

1. ✅ **意图识别准确率提升**: 从粗粒度（5种类型）提升到细粒度（10+种子类型）
2. ✅ **文档生成质量提升**: 从模板+占位符提升到LLM生成完整内容
3. ✅ **引擎覆盖范围扩大**: Word、Excel、PDF引擎全面支持任务规划
4. ✅ **降级方案完善**: 本地LLM失败时自动切换到后端AI服务

用户现在可以通过简单的自然语言描述，自动生成高质量的Word文档、Excel表格、PDF报告等各种文件类型。
