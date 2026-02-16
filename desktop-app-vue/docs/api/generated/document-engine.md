# document-engine

**Source**: `src/main/engines/document-engine.js`

**Generated**: 2026-02-16T13:44:34.667Z

---

## const

```javascript
const
```

* 文档处理引擎
 * 负责Word/PDF/Markdown文档的生成和处理
 * 支持3种模板: 商务报告、学术论文、用户手册

---

## async generateDocument(options =

```javascript
async generateDocument(options =
```

* 生成文档
   * @param {Object} options - 配置选项
   * @returns {Promise<Object>} 生成结果

---

## generateMarkdown(template, options)

```javascript
generateMarkdown(template, options)
```

* 生成Markdown格式文档
   * @private

---

## generateBusinessReportMarkdown(content)

```javascript
generateBusinessReportMarkdown(content)
```

* 生成商务报告Markdown
   * @private

---

## generateAcademicPaperMarkdown(content)

```javascript
generateAcademicPaperMarkdown(content)
```

* 生成学术论文Markdown
   * @private

---

## generateUserManualMarkdown(content)

```javascript
generateUserManualMarkdown(content)
```

* 生成用户手册Markdown
   * @private

---

## generateHTML(template, options)

```javascript
generateHTML(template, options)
```

* 生成HTML格式文档
   * @private

---

## markdownToHTML(markdown)

```javascript
markdownToHTML(markdown)
```

* 简单的Markdown转HTML
   * @private

---

## closeListIfOpen(htmlLines, inUnorderedList, inOrderedList)

```javascript
closeListIfOpen(htmlLines, inUnorderedList, inOrderedList)
```

* 关闭打开的列表
   * @private

---

## parseInlineMarkdown(text)

```javascript
parseInlineMarkdown(text)
```

* 解析行内Markdown语法
   * @private

---

## escapeHtml(text)

```javascript
escapeHtml(text)
```

* HTML转义
   * @private

---

## generateReadme(title, template)

```javascript
generateReadme(title, template)
```

* 生成README
   * @private

---

## getTemplates()

```javascript
getTemplates()
```

* 获取所有模板
   * @returns {Object} 模板列表

---

## async exportToPDF(markdownPath, outputPath)

```javascript
async exportToPDF(markdownPath, outputPath)
```

* 导出为PDF
   * @param {string} markdownPath - Markdown文件路径
   * @param {string} outputPath - 输出PDF路径

---

## async generateWordWithPython(params)

```javascript
async generateWordWithPython(params)
```

* 使用Python工具生成Word文档
   * @param {Object} params - 文档参数
   * @returns {Promise<Object>} 生成结果

---

## async exportToDocx(markdownPath, outputPath)

```javascript
async exportToDocx(markdownPath, outputPath)
```

* 导出为Word文档
   * @param {string} markdownPath - Markdown文件路径
   * @param {string} outputPath - 输出Docx路径

---

## createDocxFromMarkdown(markdownContent, docx)

```javascript
createDocxFromMarkdown(markdownContent, docx)
```

* 从Markdown创建Docx文档（使用docx库）
   * @private

---

## parseInlineMarkdownForDocx(text, docx)

```javascript
parseInlineMarkdownForDocx(text, docx)
```

* 解析行内Markdown格式为Docx TextRun数组
   * @private

---

## async exportTo(sourcePath, format, outputPath = null)

```javascript
async exportTo(sourcePath, format, outputPath = null)
```

* 多格式导出
   * @param {string} sourcePath - 源文件路径
   * @param {string} format - 目标格式（pdf/docx/html/txt）
   * @param {string} outputPath - 输出路径（可选）

---

## async handleProjectTask(params)

```javascript
async handleProjectTask(params)
```

* 处理项目任务
   * @param {Object} params - 任务参数

---

## async createDocumentFromDescription(description, projectPath, llmManager)

```javascript
async createDocumentFromDescription(description, projectPath, llmManager)
```

* 根据描述创建文档（使用LLM）

---

## async queryBackendAI(prompt, options =

```javascript
async queryBackendAI(prompt, options =
```

* 查询后端AI服务（降级方案）

---

## async createMarkdownFromDescription(description, projectPath, llmManager)

```javascript
async createMarkdownFromDescription(description, projectPath, llmManager)
```

* 创建Markdown文档

---

## async exportDocumentToPDF(projectPath, outputFiles)

```javascript
async exportDocumentToPDF(projectPath, outputFiles)
```

* 导出项目文档为PDF

---

## async exportDocumentToDocx(projectPath, outputFiles)

```javascript
async exportDocumentToDocx(projectPath, outputFiles)
```

* 导出项目文档为Word

---

## async exportDocumentToHTML(projectPath, outputFiles)

```javascript
async exportDocumentToHTML(projectPath, outputFiles)
```

* 导出项目文档为HTML

---

## async findMarkdownFiles(projectPath)

```javascript
async findMarkdownFiles(projectPath)
```

* 查找项目中的Markdown文件

---

