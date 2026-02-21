# context-associator-ipc

**Source**: `src/main/memory/context-associator-ipc.js`

**Generated**: 2026-02-21T22:04:25.815Z

---

## const

```javascript
const
```

* ContextAssociator IPC Handlers
 * Handles IPC communication for context association
 *
 * @module context-associator-ipc
 * @version 1.0.0
 * @since 2026-01-18

---

## function registerContextAssociatorIPC(

```javascript
function registerContextAssociatorIPC(
```

* Register all ContextAssociator IPC handlers
 * @param {Object} dependencies - Dependencies
 * @param {Object} dependencies.contextAssociator - ContextAssociator instance
 * @param {Object} [dependencies.ipcMain] - IPC main object (for testing)

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* Extract knowledge from session
   * Channel: 'context:extract-knowledge'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* Get session knowledge
   * Channel: 'context:get-session-knowledge'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* Find related sessions
   * Channel: 'context:find-related'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* Analyze conversation
   * Channel: 'context:analyze-conversation'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* Search knowledge
   * Channel: 'context:search-knowledge'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* Get or create topic
   * Channel: 'context:get-or-create-topic'

---

## ipcMain.handle("context:get-popular-topics", async (_event, options =

```javascript
ipcMain.handle("context:get-popular-topics", async (_event, options =
```

* Get popular topics
   * Channel: 'context:get-popular-topics'

---

## ipcMain.handle("context:get-stats", async () =>

```javascript
ipcMain.handle("context:get-stats", async () =>
```

* Get statistics
   * Channel: 'context:get-stats'

---

## function updateContextAssociator(newAssociator)

```javascript
function updateContextAssociator(newAssociator)
```

* Update ContextAssociator reference
   * For hot-reload or reinitialization
   * @param {ContextAssociator} newAssociator - New instance

---

