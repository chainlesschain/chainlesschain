# extended-tools-memgpt

**Source**: `src/main/ai-engine/extended-tools-memgpt.js`

**Generated**: 2026-02-21T22:04:25.873Z

---

## const

```javascript
const
```

* MemGPT Memory Tools Integration
 *
 * Registers MemGPT memory tools with the function caller:
 * - Core memory operations (append, replace)
 * - Recall memory search
 * - Archival memory operations
 * - Conversation search
 *
 * @module extended-tools-memgpt
 * @version 1.0.0

---

## class MemGPTToolsHandler

```javascript
class MemGPTToolsHandler
```

* MemGPT Tools Handler

---

## setMemGPTCore(memgptCore)

```javascript
setMemGPTCore(memgptCore)
```

* Set MemGPTCore reference
   * @param {Object} memgptCore - MemGPTCore instance

---

## register(functionCaller)

```javascript
register(functionCaller)
```

* Register all MemGPT tools
   * @param {FunctionCaller} functionCaller - Function caller instance

---

## function getMemGPTTools()

```javascript
function getMemGPTTools()
```

* Get MemGPT Tools Handler singleton
 * @returns {MemGPTToolsHandler}

---

