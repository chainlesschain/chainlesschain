# text-splitter

**Source**: `src/main/rag/text-splitter.js`

**Generated**: 2026-02-15T07:37:13.794Z

---

## const

```javascript
const
```

* RecursiveCharacterTextSplitter
 * 递归字符文本分块器，用于将长文档切分为小块以提升RAG检索精度

---

## const DEFAULT_SPLITTER_CONFIG =

```javascript
const DEFAULT_SPLITTER_CONFIG =
```

* 文本分块器配置

---

## class RecursiveCharacterTextSplitter extends EventEmitter

```javascript
class RecursiveCharacterTextSplitter extends EventEmitter
```

* 递归字符文本分块器

---

## splitText(text, metadata =

```javascript
splitText(text, metadata =
```

* 分割文本为块
   * @param {string} text - 输入文本
   * @param {Object} metadata - 元数据（可选）
   * @returns {Array<Object>} 文本块数组

---

## _recursiveSplit(text, separators)

```javascript
_recursiveSplit(text, separators)
```

* 递归分割文本
   * @private

---

## _splitTextWithSeparator(text, separator)

```javascript
_splitTextWithSeparator(text, separator)
```

* 使用分隔符分割文本
   * @private

---

## _mergeSplits(splits, separator)

```javascript
_mergeSplits(splits, separator)
```

* 合并小片段，避免产生太多碎片
   * @private

---

## _forceSplit(text)

```javascript
_forceSplit(text)
```

* 强制分割（当没有更多分隔符时）
   * @private

---

## splitDocuments(documents)

```javascript
splitDocuments(documents)
```

* 分割文档列表
   * @param {Array<Object>} documents - 文档列表 [{content, metadata}, ...]
   * @returns {Array<Object>} 分块后的文档列表

---

## createChunksWithOverlap(text, metadata =

```javascript
createChunksWithOverlap(text, metadata =
```

* 创建带重叠的文本块
   * @param {string} text - 输入文本
   * @param {Object} metadata - 元数据
   * @returns {Array<Object>} 文本块数组

---

## getChunkStats(text)

```javascript
getChunkStats(text)
```

* 获取分块统计信息
   * @param {string} text - 输入文本
   * @returns {Object} 统计信息

---

## updateConfig(newConfig)

```javascript
updateConfig(newConfig)
```

* 更新配置

---

## getConfig()

```javascript
getConfig()
```

* 获取当前配置

---

## class MarkdownTextSplitter extends RecursiveCharacterTextSplitter

```javascript
class MarkdownTextSplitter extends RecursiveCharacterTextSplitter
```

* Markdown专用分块器

---

## class CodeTextSplitter extends RecursiveCharacterTextSplitter

```javascript
class CodeTextSplitter extends RecursiveCharacterTextSplitter
```

* 代码专用分块器

---

## static getSeparatorsForLanguage(language)

```javascript
static getSeparatorsForLanguage(language)
```

* 获取语言特定的分隔符

---

