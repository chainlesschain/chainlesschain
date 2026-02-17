# learned-pattern-manager-ipc

**Source**: `src/main/memory/learned-pattern-manager-ipc.js`

**Generated**: 2026-02-17T10:13:18.223Z

---

## const

```javascript
const
```

* LearnedPatternManager IPC Handlers
 * Handles IPC communication for learned pattern management
 *
 * @module learned-pattern-manager-ipc
 * @version 1.0.0
 * @since 2026-01-17

---

## function registerLearnedPatternManagerIPC(

```javascript
function registerLearnedPatternManagerIPC(
```

* Register all LearnedPatternManager IPC handlers
 * @param {Object} dependencies - Dependencies
 * @param {Object} dependencies.learnedPatternManager - LearnedPatternManager instance
 * @param {Object} [dependencies.ipcMain] - IPC main object (for testing)

---

## ipcMain.handle("pattern:record-prompt", async (_event, params) =>

```javascript
ipcMain.handle("pattern:record-prompt", async (_event, params) =>
```

* Record a prompt pattern
   * Channel: 'pattern:record-prompt'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* Update prompt pattern usage
   * Channel: 'pattern:update-prompt-usage'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* Get prompt suggestions
   * Channel: 'pattern:get-prompt-suggestions'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* Search prompt patterns
   * Channel: 'pattern:search-prompts'

---

## ipcMain.handle("pattern:record-error-fix", async (_event, params) =>

```javascript
ipcMain.handle("pattern:record-error-fix", async (_event, params) =>
```

* Record an error fix pattern
   * Channel: 'pattern:record-error-fix'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* Get error fix suggestions
   * Channel: 'pattern:get-error-fix-suggestions'

---

## ipcMain.handle("pattern:save-snippet", async (_event, snippet) =>

```javascript
ipcMain.handle("pattern:save-snippet", async (_event, snippet) =>
```

* Save a code snippet
   * Channel: 'pattern:save-snippet'

---

## ipcMain.handle("pattern:get-snippets", async (_event, options =

```javascript
ipcMain.handle("pattern:get-snippets", async (_event, options =
```

* Get code snippets
   * Channel: 'pattern:get-snippets'

---

## ipcMain.handle("pattern:use-snippet", async (_event, id) =>

```javascript
ipcMain.handle("pattern:use-snippet", async (_event, id) =>
```

* Use a code snippet (increment use count)
   * Channel: 'pattern:use-snippet'

---

## ipcMain.handle("pattern:toggle-snippet-favorite", async (_event, id) =>

```javascript
ipcMain.handle("pattern:toggle-snippet-favorite", async (_event, id) =>
```

* Toggle snippet favorite
   * Channel: 'pattern:toggle-snippet-favorite'

---

## ipcMain.handle("pattern:delete-snippet", async (_event, id) =>

```javascript
ipcMain.handle("pattern:delete-snippet", async (_event, id) =>
```

* Delete a code snippet
   * Channel: 'pattern:delete-snippet'

---

## ipcMain.handle("pattern:record-workflow", async (_event, workflow) =>

```javascript
ipcMain.handle("pattern:record-workflow", async (_event, workflow) =>
```

* Record a workflow pattern
   * Channel: 'pattern:record-workflow'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* Get workflow suggestions
   * Channel: 'pattern:get-workflow-suggestions'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* Update workflow usage
   * Channel: 'pattern:update-workflow-usage'

---

## ipcMain.handle("pattern:get-stats", async () =>

```javascript
ipcMain.handle("pattern:get-stats", async () =>
```

* Get statistics
   * Channel: 'pattern:get-stats'

---

## ipcMain.handle("pattern:backup", async () =>

```javascript
ipcMain.handle("pattern:backup", async () =>
```

* Backup patterns to files
   * Channel: 'pattern:backup'

---

## ipcMain.handle("pattern:cleanup", async (_event, options =

```javascript
ipcMain.handle("pattern:cleanup", async (_event, options =
```

* Cleanup old patterns
   * Channel: 'pattern:cleanup'

---

## function updateLearnedPatternManager(newManager)

```javascript
function updateLearnedPatternManager(newManager)
```

* Update LearnedPatternManager reference
   * For hot-reload or reinitialization
   * @param {LearnedPatternManager} newManager - New instance

---

