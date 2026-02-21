# memory-hierarchy

**Source**: `src/main/memory/memory-hierarchy.js`

**Generated**: 2026-02-21T20:04:16.233Z

---

## const EventEmitter = require("events");

```javascript
const EventEmitter = require("events");
```

* Memory Hierarchy System (MemGPT-style)
 *
 * Implements a three-tier memory hierarchy:
 * - Working Memory: Current context, limited tokens
 * - Recall Memory: Recent memories, fast retrieval
 * - Archival Memory: Long-term storage, vector search
 *
 * @module memory-hierarchy
 * @version 1.0.0

---

## const MemoryImportance =

```javascript
const MemoryImportance =
```

* Memory importance levels

---

## const MemoryType =

```javascript
const MemoryType =
```

* Memory types

---

## class WorkingMemory

```javascript
class WorkingMemory
```

* Working Memory - Limited context window

---

## add(memory)

```javascript
add(memory)
```

* Add memory to working context
   * @param {Object} memory - Memory to add
   * @returns {boolean} Whether addition was successful

---

## evictOldest()

```javascript
evictOldest()
```

* Remove oldest memory to make room
   * @returns {Object|null} Removed memory

---

## getAll()

```javascript
getAll()
```

* Get all working memories
   * @returns {Array} Current memories

---

## getContext()

```javascript
getContext()
```

* Get context for LLM
   * @returns {string} Formatted context

---

## clear()

```javascript
clear()
```

* Clear working memory

---

## setSystemMessage(message)

```javascript
setSystemMessage(message)
```

* Set system message
   * @param {string} message - System message

---

## setUserPersona(persona)

```javascript
setUserPersona(persona)
```

* Set user persona
   * @param {string} persona - User persona description

---

## getStats()

```javascript
getStats()
```

* Get usage stats
   * @returns {Object} Usage statistics

---

## _estimateTokens(text)

```javascript
_estimateTokens(text)
```

* Estimate token count
   * @private

---

## class RecallMemory

```javascript
class RecallMemory
```

* Recall Memory - Recent memories with fast access

---

## store(id, memory)

```javascript
store(id, memory)
```

* Store memory
   * @param {string} id - Memory ID
   * @param {Object} memory - Memory object

---

## get(id)

```javascript
get(id)
```

* Retrieve memory
   * @param {string} id - Memory ID
   * @returns {Object|null} Memory or null

---

## search(query, limit = 10)

```javascript
search(query, limit = 10)
```

* Search by query
   * @param {string} query - Search query
   * @param {number} limit - Max results
   * @returns {Array} Matching memories

---

## getRecent(limit = 20)

```javascript
getRecent(limit = 20)
```

* Get recent memories
   * @param {number} limit - Max results
   * @returns {Array} Recent memories

---

## getAll()

```javascript
getAll()
```

* Get all memories
   * @returns {Array} All memories

---

## remove(id)

```javascript
remove(id)
```

* Remove memory
   * @param {string} id - Memory ID
   * @returns {boolean} Whether removal was successful

---

## clear()

```javascript
clear()
```

* Clear all memories

---

## getStats()

```javascript
getStats()
```

* Get stats
   * @returns {Object} Statistics

---

## _evictLRU()

```javascript
_evictLRU()
```

* Evict least recently used
   * @private

---

## class ArchivalMemory extends EventEmitter

```javascript
class ArchivalMemory extends EventEmitter
```

* Archival Memory - Long-term storage with vector search

---

## setDatabase(db)

```javascript
setDatabase(db)
```

* Set database instance
   * @param {Object} db - Database instance

---

## setRagManager(ragManager)

```javascript
setRagManager(ragManager)
```

* Set RAG manager for vector search
   * @param {Object} ragManager - RAG manager instance

---

## async store(memory)

```javascript
async store(memory)
```

* Store memory in archive
   * @param {Object} memory - Memory to store
   * @returns {Promise<string>} Memory ID

---

## async get(id)

```javascript
async get(id)
```

* Retrieve memory by ID
   * @param {string} id - Memory ID
   * @returns {Promise<Object|null>} Memory or null

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

## async getByType(type, limit = 50)

```javascript
async getByType(type, limit = 50)
```

* Get memories by type
   * @param {string} type - Memory type
   * @param {number} limit - Max results
   * @returns {Promise<Array>} Memories

---

## async getMostImportant(limit = 20)

```javascript
async getMostImportant(limit = 20)
```

* Get most important memories
   * @param {number} limit - Max results
   * @returns {Promise<Array>} Important memories

---

## async updateImportance(id, importance)

```javascript
async updateImportance(id, importance)
```

* Update memory importance
   * @param {string} id - Memory ID
   * @param {number} importance - New importance

---

## async delete(id)

```javascript
async delete(id)
```

* Delete memory
   * @param {string} id - Memory ID
   * @returns {Promise<boolean>} Success

---

## async getStats()

```javascript
async getStats()
```

* Get statistics
   * @returns {Promise<Object>} Statistics

---

## _parseRow(row)

```javascript
_parseRow(row)
```

* Parse database row
   * @private

---

## _generateId()

```javascript
_generateId()
```

* Generate unique ID
   * @private

---

## class MemoryHierarchy extends EventEmitter

```javascript
class MemoryHierarchy extends EventEmitter
```

* Memory Hierarchy Manager - Coordinates all memory layers

---

## setDatabase(db)

```javascript
setDatabase(db)
```

* Set database instance
   * @param {Object} db - Database instance

---

## setRagManager(ragManager)

```javascript
setRagManager(ragManager)
```

* Set RAG manager
   * @param {Object} ragManager - RAG manager instance

---

## async addMemory(memory, layer = "recall")

```javascript
async addMemory(memory, layer = "recall")
```

* Add memory to appropriate layer
   * @param {Object} memory - Memory to add
   * @param {string} layer - Target layer ('working', 'recall', 'archival')
   * @returns {Promise<string|boolean>} Result

---

## promoteToWorking(id)

```javascript
promoteToWorking(id)
```

* Promote memory from recall to working
   * @param {string} id - Memory ID
   * @returns {boolean} Success

---

## async archiveFromRecall(id)

```javascript
async archiveFromRecall(id)
```

* Archive memory from recall to archival
   * @param {string} id - Memory ID
   * @returns {Promise<string|null>} Archived memory ID

---

## async search(query, options =

```javascript
async search(query, options =
```

* Search across all memory layers
   * @param {string} query - Search query
   * @param {Object} options - Search options
   * @returns {Promise<Object>} Results by layer

---

## async autoManage()

```javascript
async autoManage()
```

* Auto-manage memory - evict from recall to archival when threshold reached

---

## async getStats()

```javascript
async getStats()
```

* Get statistics from all layers
   * @returns {Promise<Object>} Combined statistics

---

## async clear(layers = ["working", "recall"])

```javascript
async clear(layers = ["working", "recall"])
```

* Clear all memories
   * @param {Array} layers - Layers to clear (default: all)

---

## _setupEventHandlers()

```javascript
_setupEventHandlers()
```

* Setup event handlers
   * @private

---

