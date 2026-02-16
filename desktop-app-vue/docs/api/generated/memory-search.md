# memory-search

**Source**: `src/main/memory/memory-search.js`

**Generated**: 2026-02-16T13:44:34.645Z

---

## const

```javascript
const
```

* Memory Search System
 *
 * Advanced memory retrieval with RAG integration:
 * - Semantic search via embeddings
 * - Keyword matching
 * - Temporal filtering
 * - Importance weighting
 *
 * @module memory-search
 * @version 1.0.0

---

## const SearchMode =

```javascript
const SearchMode =
```

* Search modes

---

## class MemorySearchEngine

```javascript
class MemorySearchEngine
```

* Memory Search Engine

---

## setMemoryHierarchy(memoryHierarchy)

```javascript
setMemoryHierarchy(memoryHierarchy)
```

* Set memory hierarchy
   * @param {MemoryHierarchy} memoryHierarchy - Memory hierarchy instance

---

## setRagManager(ragManager)

```javascript
setRagManager(ragManager)
```

* Set RAG manager for semantic search
   * @param {Object} ragManager - RAG manager instance

---

## setEmbeddingClient(embeddingClient)

```javascript
setEmbeddingClient(embeddingClient)
```

* Set embedding client
   * @param {Object} embeddingClient - Embedding client instance

---

## async search(query, options =

```javascript
async search(query, options =
```

* Search memories
   * @param {string} query - Search query
   * @param {Object} options - Search options
   * @returns {Promise<Array>} Search results

---

## async _semanticSearch(query, options)

```javascript
async _semanticSearch(query, options)
```

* Semantic search using embeddings
   * @private

---

## async _keywordSearch(query, options)

```javascript
async _keywordSearch(query, options)
```

* Keyword search using text matching
   * @private

---

## async _hybridSearch(query, options)

```javascript
async _hybridSearch(query, options)
```

* Hybrid search combining semantic and keyword
   * @private

---

## async _temporalSearch(query, options)

```javascript
async _temporalSearch(query, options)
```

* Temporal search - find memories by time
   * @private

---

## async findRelated(memoryId, limit = 5)

```javascript
async findRelated(memoryId, limit = 5)
```

* Find related memories
   * @param {string} memoryId - Source memory ID
   * @param {number} limit - Max results
   * @returns {Promise<Array>} Related memories

---

## async getContextualMemories(context, options =

```javascript
async getContextualMemories(context, options =
```

* Get context-relevant memories for conversation
   * @param {string} context - Current conversation context
   * @param {Object} options - Options
   * @returns {Promise<Array>} Relevant memories

---

## _calculateKeywordRelevance(query, content)

```javascript
_calculateKeywordRelevance(query, content)
```

* Calculate keyword relevance score
   * @private

---

## _extractKeywords(text)

```javascript
_extractKeywords(text)
```

* Extract keywords from text
   * @private

---

## _getCacheKey(query, options)

```javascript
_getCacheKey(query, options)
```

* Get cache key
   * @private

---

## _getFromCache(key)

```javascript
_getFromCache(key)
```

* Get from cache
   * @private

---

## _addToCache(key, results)

```javascript
_addToCache(key, results)
```

* Add to cache
   * @private

---

## clearCache()

```javascript
clearCache()
```

* Clear cache

---

## getStats()

```javascript
getStats()
```

* Get statistics
   * @returns {Object} Statistics

---

