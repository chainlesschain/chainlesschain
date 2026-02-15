# word-engine

**Source**: `src/main/engines/word-engine.js`

**Generated**: 2026-02-15T08:42:37.241Z

---

## const

```javascript
const
```

* Word文档处理引擎
 * 提供Word文档的读取、写入、编辑和转换功能
 * 支持 .docx 格式

---

## async readWord(filePath)

```javascript
async readWord(filePath)
```

* 读取Word文档
   * @param {string} filePath - 文件路径
   * @returns {Promise<Object>} 文档内容

---

## async writeWord(filePath, content)

```javascript
async writeWord(filePath, content)
```

* 写入Word文档
   * @param {string} filePath - 文件路径
   * @param {Object} content - 文档内容

---

## createParagraph(paraData)

```javascript
createParagraph(paraData)
```

* 创建段落对象

---

## getHeadingLevel(level)

```javascript
getHeadingLevel(level)
```

* 获取标题级别

---

## getAlignment(align)

```javascript
getAlignment(align)
```

* 获取对齐方式

---

## parseHtmlToContent(html)

```javascript
parseHtmlToContent(html)
```

* 解析HTML为结构化内容

---

## async extractMetadata(filePath)

```javascript
async extractMetadata(filePath)
```

* 提取元数据

---

## async markdownToWord(markdownText, outputPath, options =

```javascript
async markdownToWord(markdownText, outputPath, options =
```

* Markdown转Word

---

## async wordToMarkdown(filePath)

```javascript
async wordToMarkdown(filePath)
```

* Word转Markdown

---

## async wordToPDF(filePath, outputPath)

```javascript
async wordToPDF(filePath, outputPath)
```

* Word转PDF
   * 注意: 需要LibreOffice或其他转换工具

---

## async htmlToWord(html, outputPath, options =

```javascript
async htmlToWord(html, outputPath, options =
```

* HTML转Word

---

## async createTemplate(templateType, outputPath, data =

```javascript
async createTemplate(templateType, outputPath, data =
```

* 创建Word模板

---

## createReportTemplate(data)

```javascript
createReportTemplate(data)
```

* 创建报告模板

---

## createLetterTemplate(data)

```javascript
createLetterTemplate(data)
```

* 创建信件模板

---

## createResumeTemplate(data)

```javascript
createResumeTemplate(data)
```

* 创建简历模板

---

## async handleProjectTask(params)

```javascript
async handleProjectTask(params)
```

* 处理项目任务（用于任务规划系统集成）
   * @param {Object} params - 任务参数
   * @returns {Promise<Object>} 执行结果

---

## async generateDocumentStructureFromDescription(description, llmManager)

```javascript
async generateDocumentStructureFromDescription(description, llmManager)
```

* 从描述生成Word文档结构
   * @param {string} description - 文档描述
   * @param {Object} llmManager - LLM管理器
   * @returns {Promise<Object>} 文档结构

---

## normalizeDocumentStructure(structure, description)

```javascript
normalizeDocumentStructure(structure, description)
```

* 规范化文档结构

---

## getDefaultDocumentStructure(description)

```javascript
getDefaultDocumentStructure(description)
```

* 获取默认文档结构

---

## async queryBackendAI(prompt)

```javascript
async queryBackendAI(prompt)
```

* 查询后端AI服务（降级方案）

---

