# extended-tools-office

**Source**: `src/main/ai-engine/extended-tools-office.js`

**Generated**: 2026-02-22T01:23:36.765Z

---

## const

```javascript
const
```

* Office文档工具的handler实现
 * 提供Word、Excel、PPT的生成和操作功能

---

## async tool_word_generator(params)

```javascript
async tool_word_generator(params)
```

* Word文档生成器
   * 生成标准格式的Word文档（.docx）

---

## parseMarkdownToWordParagraphs(markdown, options =

```javascript
parseMarkdownToWordParagraphs(markdown, options =
```

* 解析Markdown为Word段落

---

## async tool_word_table_creator(params)

```javascript
async tool_word_table_creator(params)
```

* Word表格创建器
   * 在Word文档中创建和格式化表格

---

## async tool_excel_generator(params)

```javascript
async tool_excel_generator(params)
```

* Excel电子表格生成器
   * 生成多工作表Excel文件

---

## async tool_excel_formula_builder(params)

```javascript
async tool_excel_formula_builder(params)
```

* Excel公式构建器
   * 生成和验证Excel公式

---

## async tool_excel_chart_creator(params)

```javascript
async tool_excel_chart_creator(params)
```

* Excel图表创建器
   * 在Excel工作表中创建图表

---

## async tool_ppt_generator(params)

```javascript
async tool_ppt_generator(params)
```

* PPT演示文稿生成器
   * 生成PowerPoint演示文稿

---

## register(functionCaller)

```javascript
register(functionCaller)
```

* 注册所有工具到FunctionCaller

---

