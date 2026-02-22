# pdf-engine

**Source**: `src/main/engines/pdf-engine.js`

**Generated**: 2026-02-22T01:23:36.733Z

---

## const

```javascript
const
```

* PDF生成引擎
 * 使用Electron的printToPDF功能将HTML转换为PDF

---

## function _setBrowserWindowForTesting(BrowserWindowCtor)

```javascript
function _setBrowserWindowForTesting(BrowserWindowCtor)
```

* Set BrowserWindow constructor for testing
 * @param {Function|null} BrowserWindowCtor - The BrowserWindow constructor or null to reset

---

## function _setFsExtraForTesting(fsExtra)

```javascript
function _setFsExtraForTesting(fsExtra)
```

* Set fs-extra module for testing
 * @param {Object|null} fsExtra - The fs-extra module or null to reset

---

## function _setMarkedForTesting(marked)

```javascript
function _setMarkedForTesting(marked)
```

* Set marked module for testing
 * @param {Object|null} marked - The marked module or null to reset

---

## async markdownToPDF(markdownContent, outputPath, options =

```javascript
async markdownToPDF(markdownContent, outputPath, options =
```

* 将Markdown转换为PDF

---

## async markdownToHTML(markdown, options =

```javascript
async markdownToHTML(markdown, options =
```

* Markdown转HTML

---

## async htmlToPDF(html, outputPath, options =

```javascript
async htmlToPDF(html, outputPath, options =
```

* HTML转PDF（使用Electron的printToPDF）

---

## async htmlFileToPDF(htmlPath, outputPath, options =

```javascript
async htmlFileToPDF(htmlPath, outputPath, options =
```

* HTML文件转PDF

---

## async textFileToPDF(textPath, outputPath, options =

```javascript
async textFileToPDF(textPath, outputPath, options =
```

* 文本文件转PDF

---

## async batchConvert(files, outputDir, options =

```javascript
async batchConvert(files, outputDir, options =
```

* 批量转换

---

## async handleProjectTask(params)

```javascript
async handleProjectTask(params)
```

* 处理项目任务（用于任务规划系统集成）
   * @param {Object} params - 任务参数
   * @returns {Promise<Object>} 执行结果

---

## async generateMarkdownContentFromDescription(description, llmManager)

```javascript
async generateMarkdownContentFromDescription(description, llmManager)
```

* 从描述生成Markdown内容
   * @param {string} description - 文档描述
   * @param {Object} llmManager - LLM管理器
   * @returns {Promise<string>} Markdown内容

---

## extractTitle(markdownContent)

```javascript
extractTitle(markdownContent)
```

* 从Markdown内容中提取标题

---

## async queryBackendAI(prompt)

```javascript
async queryBackendAI(prompt)
```

* 查询后端AI服务（降级方案）

---

## function getPDFEngine()

```javascript
function getPDFEngine()
```

* 获取PDF引擎实例

---

