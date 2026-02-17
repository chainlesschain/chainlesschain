# ppt-engine

**Source**: `src/main/engines/ppt-engine.js`

**Generated**: 2026-02-17T10:13:18.247Z

---

## const

```javascript
const
```

* PPT生成引擎
 * 负责根据大纲或Markdown内容生成PowerPoint演示文稿
 * 使用PptxGenJS库实现

---

## async generateFromOutline(outline, options =

```javascript
async generateFromOutline(outline, options =
```

* 从大纲生成PPT
   * @param {Object} outline - PPT大纲
   * @param {Object} options - 生成选项
   * @returns {Promise<Object>} 生成结果

---

## createTitleSlide(ppt, title, subtitle, author, theme)

```javascript
createTitleSlide(ppt, title, subtitle, author, theme)
```

* 创建标题页

---

## createSectionSlide(ppt, sectionTitle, theme)

```javascript
createSectionSlide(ppt, sectionTitle, theme)
```

* 创建章节页

---

## createContentSlide(ppt, slideData, theme)

```javascript
createContentSlide(ppt, slideData, theme)
```

* 创建内容页

---

## createEndSlide(ppt, message, theme)

```javascript
createEndSlide(ppt, message, theme)
```

* 创建结束页

---

## async handleProjectTask(params)

```javascript
async handleProjectTask(params)
```

* 处理项目任务
   * @param {Object} params - 任务参数

---

## async generateFromMarkdown(markdownContent, options =

```javascript
async generateFromMarkdown(markdownContent, options =
```

* 从Markdown生成PPT
   * @param {string} markdownContent - Markdown内容
   * @param {Object} options - 生成选项
   * @returns {Promise<Object>} 生成结果

---

## parseMarkdownToOutline(markdown)

```javascript
parseMarkdownToOutline(markdown)
```

* 解析Markdown为PPT大纲
   * @param {string} markdown - Markdown内容
   * @returns {Object} PPT大纲

---

## async generateOutlineFromDescription(description, llmManager)

```javascript
async generateOutlineFromDescription(description, llmManager)
```

* 从描述生成PPT大纲

---

## async queryBackendAI(prompt)

```javascript
async queryBackendAI(prompt)
```

* 查询后端AI服务（降级方案）

---

## getDefaultOutline(description)

```javascript
getDefaultOutline(description)
```

* 获取默认大纲

---

## addChart(slide, chartData, theme)

```javascript
addChart(slide, chartData, theme)
```

* 添加图表到幻灯片
   * @param {Object} slide - pptxgenjs幻灯片对象
   * @param {Object} chartData - 图表数据
   * @param {Object} theme - 主题配置

---

## addImage(slide, imageData)

```javascript
addImage(slide, imageData)
```

* 添加图片到幻灯片
   * @param {Object} slide - pptxgenjs幻灯片对象
   * @param {Object} imageData - 图片数据

---

