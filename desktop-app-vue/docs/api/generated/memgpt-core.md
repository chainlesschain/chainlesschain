# memgpt-core

**Source**: `src/main/memory/memgpt-core.js`

**Generated**: 2026-02-21T20:04:16.233Z

---

## const EventEmitter = require("events");

```javascript
const EventEmitter = require("events");
```

* MemGPT Core - Self-Editing Memory System
 *
 * Implements MemGPT-style memory management:
 * - Autonomous memory management via function calls
 * - Working/Recall/Archival memory hierarchy
 * - Self-editing capabilities
 * - Context window optimization
 *
 * @module memgpt-core
 * @version 1.0.0

---

## const MEMGPT_TOOLS =

```javascript
const MEMGPT_TOOLS =
```

* MemGPT Memory Tools - Functions exposed to LLM

---

## class MemGPTCore extends EventEmitter

```javascript
class MemGPTCore extends EventEmitter
```

* MemGPT Core - Main class

---

## async initialize(options =

```javascript
async initialize(options =
```

* Initialize the memory system
   * @param {Object} options - Initialization options

---

## setDatabase(db)

```javascript
setDatabase(db)
```

* Set database instance
   * @param {Object} db - Database instance

---

## setLLMManager(llmManager)

```javascript
setLLMManager(llmManager)
```

* Set LLM manager for summarization
   * @param {Object} llmManager - LLM manager instance

---

## setRagManager(ragManager)

```javascript
setRagManager(ragManager)
```

* Set RAG manager for vector search
   * @param {Object} ragManager - RAG manager instance

---

## getTools()

```javascript
getTools()
```

* Get memory tools for function calling
   * @returns {Array} Tool definitions

---

## async executeTool(toolName, params)

```javascript
async executeTool(toolName, params)
```

* Execute a memory tool
   * @param {string} toolName - Tool name
   * @param {Object} params - Tool parameters
   * @returns {Promise<Object>} Tool result

---

## async processMessage(message)

```javascript
async processMessage(message)
```

* Process a conversation turn
   * @param {Object} message - User or assistant message

---

## getMemoryContext()

```javascript
getMemoryContext()
```

* Get context for LLM prompt
   * @returns {string} Memory context

---

## async retrieveRelevantMemories(query, options =

```javascript
async retrieveRelevantMemories(query, options =
```

* Retrieve relevant memories for a query
   * @param {string} query - Query string
   * @param {Object} options - Search options
   * @returns {Promise<Array>} Relevant memories

---

## async learnUserFact(fact, importance = MemoryImportance.HIGH)

```javascript
async learnUserFact(fact, importance = MemoryImportance.HIGH)
```

* Learn a fact about the user
   * @param {string} fact - Fact to learn
   * @param {number} importance - Importance score

---

## async getStats()

```javascript
async getStats()
```

* Get memory statistics
   * @returns {Promise<Object>} Statistics

---

## clearSession()

```javascript
clearSession()
```

* Clear session memory (keep archival)

---

## cleanup()

```javascript
cleanup()
```

* Cleanup resources

---

## async _ensureTable()

```javascript
async _ensureTable()
```

* Ensure database table exists
   * @private

---

## async _loadCoreMemory()

```javascript
async _loadCoreMemory()
```

* Load core memory from database
   * @private

---

## async _saveCoreMemory()

```javascript
async _saveCoreMemory()
```

* Save core memory to database
   * @private

---

## async _coreMemoryAppend(params)

```javascript
async _coreMemoryAppend(params)
```

* Core memory append implementation
   * @private

---

## async _coreMemoryReplace(params)

```javascript
async _coreMemoryReplace(params)
```

* Core memory replace implementation
   * @private

---

## async _recallMemorySearch(params)

```javascript
async _recallMemorySearch(params)
```

* Recall memory search implementation
   * @private

---

## async _archivalMemoryInsert(params)

```javascript
async _archivalMemoryInsert(params)
```

* Archival memory insert implementation
   * @private

---

## async _archivalMemorySearch(params)

```javascript
async _archivalMemorySearch(params)
```

* Archival memory search implementation
   * @private

---

## async _conversationSearch(params)

```javascript
async _conversationSearch(params)
```

* Conversation search implementation
   * @private

---

## async _checkAndSummarize()

```javascript
async _checkAndSummarize()
```

* Check and summarize if needed
   * @private

---

## async _summarizeWorkingMemory()

```javascript
async _summarizeWorkingMemory()
```

* Summarize working memory
   * @private

---

## function getMemGPTCore(config)

```javascript
function getMemGPTCore(config)
```

* Get MemGPT Core singleton
 * @param {Object} config - Configuration
 * @returns {MemGPTCore}

---

