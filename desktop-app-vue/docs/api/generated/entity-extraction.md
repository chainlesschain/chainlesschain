# entity-extraction

**Source**: `src/main/knowledge-graph/entity-extraction.js`

**Generated**: 2026-02-16T13:44:34.658Z

---

## const ENTITY_TYPES =

```javascript
const ENTITY_TYPES =
```

* 增强的实体提取模块
 * 使用 NLP 技术从笔记中提取实体和关系

---

## const ENTITY_TYPES =

```javascript
const ENTITY_TYPES =
```

* 中文分词和实体识别（简化版）
 * 在生产环境中，建议使用专业的 NLP 库如 nodejieba 或调用 LLM API

---

## const ENTITY_TYPES =

```javascript
const ENTITY_TYPES =
```

* 常见实体类型

---

## const RELATION_TYPES =

```javascript
const RELATION_TYPES =
```

* 关系类型

---

## function extractEntities(text)

```javascript
function extractEntities(text)
```

* 提取实体（基于规则和模式）

---

## async function extractEntitiesWithLLM(text, llmManager)

```javascript
async function extractEntitiesWithLLM(text, llmManager)
```

* 使用 LLM 提取实体和关系（高级版）

---

## function extractKeywords(text, topN = 10)

```javascript
function extractKeywords(text, topN = 10)
```

* 提取关键词（TF-IDF 简化版）

---

## function extractWikiLinks(text)

```javascript
function extractWikiLinks(text)
```

* 查找文本中的引用（双向链接）

---

## function extractSummary(text, maxLength = 200)

```javascript
function extractSummary(text, maxLength = 200)
```

* 提取文本摘要（简单版）

---

## function calculateTextSimilarity(text1, text2)

```javascript
function calculateTextSimilarity(text1, text2)
```

* 计算文本相似度（余弦相似度）

---

## async function processNotesForEntities(notes, llmManager = null)

```javascript
async function processNotesForEntities(notes, llmManager = null)
```

* 批量处理笔记，提取实体和关系

---

## function buildEntityGraph(processedNotes)

```javascript
function buildEntityGraph(processedNotes)
```

* 构建实体关系图

---

