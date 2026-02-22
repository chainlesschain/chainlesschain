# graph-extractor

**Source**: `src/main/knowledge-graph/graph-extractor.js`

**Generated**: 2026-02-22T01:23:36.722Z

---

## class GraphExtractor

```javascript
class GraphExtractor
```

* 知识图谱关系提取器
 * 从笔记内容中提取各种类型的关系

---

## extractRelations(noteId, content, tags = [])

```javascript
extractRelations(noteId, content, tags = [])
```

* 从笔记内容中提取所有关系
   * @param {string} noteId - 笔记ID
   * @param {string} content - 笔记内容（Markdown格式）
   * @param {Array} tags - 笔记标签ID列表
   * @returns {Array} 关系列表

---

## extractWikiLinks(content)

```javascript
extractWikiLinks(content)
```

* 提取 Wiki 风格链接 [[笔记标题]]
   * @param {string} content - Markdown内容
   * @returns {Array<string>} 标题列表

---

## extractMarkdownLinks(content)

```javascript
extractMarkdownLinks(content)
```

* 提取 Markdown 链接 [text](url)
   * @param {string} content - Markdown内容
   * @returns {Array<{text: string, url: string}>} 链接列表

---

## extractMentions(content)

```javascript
extractMentions(content)
```

* 提取 @mentions
   * @param {string} content - Markdown内容
   * @returns {Array<string>} 提及的标题列表

---

## extractCodeReferences(content)

```javascript
extractCodeReferences(content)
```

* 提取代码块中的引用
   * @param {string} content - Markdown内容
   * @returns {Array<string>} 代码引用列表

---

## processNote(noteId, content, tags = [])

```javascript
processNote(noteId, content, tags = [])
```

* 处理笔记并生成所有关系
   * @param {string} noteId - 笔记ID
   * @param {string} content - 笔记内容
   * @param {Array} tags - 标签ID列表
   * @returns {number} 创建的关系数量

---

## processAllNotes(noteIds = null)

```javascript
processAllNotes(noteIds = null)
```

* 批量处理所有笔记
   * @param {Array<string>} noteIds - 笔记ID列表（可选，默认处理所有）
   * @returns {object} { processed: number, relations: number }

---

## findPotentialLinks(noteId, content)

```javascript
findPotentialLinks(noteId, content)
```

* 查找笔记中所有未链接的潜在引用
   * @param {string} noteId - 笔记ID
   * @param {string} content - 笔记内容
   * @returns {Array<{title: string, noteId: string, confidence: number}>} 潜在链接建议

---

## escapeRegex(str)

```javascript
escapeRegex(str)
```

* 转义正则表达式特殊字符
   * @param {string} str - 字符串
   * @returns {string} 转义后的字符串

---

## async extractSemanticRelations(noteId, content, llmManager)

```javascript
async extractSemanticRelations(noteId, content, llmManager)
```

* 使用LLM提取语义关系（高级功能）
   * @param {string} noteId - 笔记ID
   * @param {string} content - 笔记内容
   * @param {object} llmManager - LLM管理器实例
   * @returns {Promise<Array>} 语义关系列表

---

