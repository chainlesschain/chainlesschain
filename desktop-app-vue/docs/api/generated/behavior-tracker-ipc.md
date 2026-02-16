# behavior-tracker-ipc

**Source**: `src/main/memory/behavior-tracker-ipc.js`

**Generated**: 2026-02-16T22:06:51.465Z

---

## const

```javascript
const
```

* BehaviorTracker IPC Handlers
 * Handles IPC communication for behavior tracking
 *
 * @module behavior-tracker-ipc
 * @version 1.0.0
 * @since 2026-01-18

---

## function registerBehaviorTrackerIPC(

```javascript
function registerBehaviorTrackerIPC(
```

* Register all BehaviorTracker IPC handlers
 * @param {Object} dependencies - Dependencies
 * @param {Object} dependencies.behaviorTracker - BehaviorTracker instance
 * @param {Object} [dependencies.ipcMain] - IPC main object (for testing)

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* Track page visit
   * Channel: 'behavior:track-page'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* Track feature use
   * Channel: 'behavior:track-feature'

---

## ipcMain.handle("behavior:track-llm", async (_event, params) =>

```javascript
ipcMain.handle("behavior:track-llm", async (_event, params) =>
```

* Track LLM interaction
   * Channel: 'behavior:track-llm'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* Track search
   * Channel: 'behavior:track-search'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* Track error
   * Channel: 'behavior:track-error'

---

## ipcMain.handle("behavior:analyze-now", async () =>

```javascript
ipcMain.handle("behavior:analyze-now", async () =>
```

* Trigger pattern analysis
   * Channel: 'behavior:analyze-now'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* Get recommendations
   * Channel: 'behavior:get-recommendations'

---

## ipcMain.handle("behavior:recommendation-shown", async (_event, id) =>

```javascript
ipcMain.handle("behavior:recommendation-shown", async (_event, id) =>
```

* Mark recommendation as shown
   * Channel: 'behavior:recommendation-shown'

---

## ipcMain.handle("behavior:accept-recommendation", async (_event, id) =>

```javascript
ipcMain.handle("behavior:accept-recommendation", async (_event, id) =>
```

* Accept recommendation
   * Channel: 'behavior:accept-recommendation'

---

## ipcMain.handle("behavior:dismiss-recommendation", async (_event, id) =>

```javascript
ipcMain.handle("behavior:dismiss-recommendation", async (_event, id) =>
```

* Dismiss recommendation
   * Channel: 'behavior:dismiss-recommendation'

---

## ipcMain.handle("behavior:get-stats", async () =>

```javascript
ipcMain.handle("behavior:get-stats", async () =>
```

* Get behavior statistics
   * Channel: 'behavior:get-stats'

---

## ipcMain.handle("behavior:start-session", async () =>

```javascript
ipcMain.handle("behavior:start-session", async () =>
```

* Start new session
   * Channel: 'behavior:start-session'

---

## function updateBehaviorTracker(newTracker)

```javascript
function updateBehaviorTracker(newTracker)
```

* Update BehaviorTracker reference
   * For hot-reload or reinitialization
   * @param {BehaviorTracker} newTracker - New instance

---

