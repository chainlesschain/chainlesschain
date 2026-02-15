# memgpt-ipc

**Source**: `src/main/memory/memgpt-ipc.js`

**Generated**: 2026-02-15T08:42:37.221Z

---

## const

```javascript
const
```

* MemGPT IPC Handlers
 *
 * Provides IPC interface for MemGPT memory system:
 * - Memory search and retrieval
 * - Memory management operations
 * - Statistics and status
 *
 * @module memgpt-ipc
 * @version 1.0.0

---

## function registerMemGPTIPC(options =

```javascript
function registerMemGPTIPC(options =
```

* Register MemGPT IPC handlers
 * @param {Object} options - Options
 * @param {MemGPTCore} options.memgptCore - MemGPT Core instance
 * @param {Object} [options.ipcMain] - Custom IPC main (for testing)
 * @returns {Object} Handler update functions

---

## ipc.handle('memgpt:check-status', async () =>

```javascript
ipc.handle('memgpt:check-status', async () =>
```

* Check MemGPT status

---

## ipc.handle('memgpt:get-stats', async () =>

```javascript
ipc.handle('memgpt:get-stats', async () =>
```

* Get memory statistics

---

## ipc.handle('memgpt:get-core-memory', async () =>

```javascript
ipc.handle('memgpt:get-core-memory', async () =>
```

* Get core memory content

---

## ipc.handle('memgpt:update-core-memory', async (event,

```javascript
ipc.handle('memgpt:update-core-memory', async (event,
```

* Update core memory

---

## ipc.handle('memgpt:replace-core-memory', async (event,

```javascript
ipc.handle('memgpt:replace-core-memory', async (event,
```

* Replace core memory content

---

## ipc.handle('memgpt:search', async (event,

```javascript
ipc.handle('memgpt:search', async (event,
```

* Search memories

---

## ipc.handle('memgpt:search-recall', async (event,

```javascript
ipc.handle('memgpt:search-recall', async (event,
```

* Search recall memory

---

## ipc.handle('memgpt:search-archival', async (event,

```javascript
ipc.handle('memgpt:search-archival', async (event,
```

* Search archival memory

---

## ipc.handle('memgpt:search-conversations', async (event,

```javascript
ipc.handle('memgpt:search-conversations', async (event,
```

* Search conversations

---

## ipc.handle('memgpt:archive', async (event,

```javascript
ipc.handle('memgpt:archive', async (event,
```

* Archive memory

---

## ipc.handle('memgpt:learn-fact', async (event,

```javascript
ipc.handle('memgpt:learn-fact', async (event,
```

* Learn user fact

---

## ipc.handle('memgpt:process-message', async (event,

```javascript
ipc.handle('memgpt:process-message', async (event,
```

* Process message (add to conversation memory)

---

## ipc.handle('memgpt:get-context', async () =>

```javascript
ipc.handle('memgpt:get-context', async () =>
```

* Get memory context for LLM

---

## ipc.handle('memgpt:clear-session', async () =>

```javascript
ipc.handle('memgpt:clear-session', async () =>
```

* Clear session memory

---

## ipc.handle('memgpt:get-working-memory', async () =>

```javascript
ipc.handle('memgpt:get-working-memory', async () =>
```

* Get working memory

---

## ipc.handle('memgpt:get-recall-memory', async (event,

```javascript
ipc.handle('memgpt:get-recall-memory', async (event,
```

* Get recall memory

---

## ipc.handle('memgpt:get-archival-stats', async () =>

```javascript
ipc.handle('memgpt:get-archival-stats', async () =>
```

* Get archival memory stats

---

## ipc.handle('memgpt:get-important-memories', async (event,

```javascript
ipc.handle('memgpt:get-important-memories', async (event,
```

* Get important memories

---

## ipc.handle('memgpt:get-memories-by-type', async (event,

```javascript
ipc.handle('memgpt:get-memories-by-type', async (event,
```

* Get memories by type

---

## ipc.handle('memgpt:update-importance', async (event,

```javascript
ipc.handle('memgpt:update-importance', async (event,
```

* Update memory importance

---

## ipc.handle('memgpt:delete-memory', async (event,

```javascript
ipc.handle('memgpt:delete-memory', async (event,
```

* Delete memory

---

## ipc.handle('memgpt:get-tools', async () =>

```javascript
ipc.handle('memgpt:get-tools', async () =>
```

* Get memory tools for function calling

---

## ipc.handle('memgpt:execute-tool', async (event,

```javascript
ipc.handle('memgpt:execute-tool', async (event,
```

* Execute memory tool

---

