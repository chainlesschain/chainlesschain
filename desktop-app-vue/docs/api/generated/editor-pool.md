# editor-pool

**Source**: `src\renderer\utils\editor-pool.js`

**Generated**: 2026-01-27T06:44:03.900Z

---

## class EditorPool

```javascript
class EditorPool
```

* Editor Instance Pool
 * Reuses editor instances instead of creating new ones for better performance

---

## async acquire(containerId, options =

```javascript
async acquire(containerId, options =
```

* Acquire an editor instance

---

## release(containerId)

```javascript
release(containerId)
```

* Release an editor instance back to pool

---

## getFromPool(options)

```javascript
getFromPool(options)
```

* Get editor from pool

---

## isCompatible(poolOptions, requestOptions)

```javascript
isCompatible(poolOptions, requestOptions)
```

* Check if editor options are compatible

---

## async createEditor(containerId, options)

```javascript
async createEditor(containerId, options)
```

* Create new editor instance

---

## cleanEditor(editor, options)

```javascript
cleanEditor(editor, options)
```

* Clean editor state before returning to pool

---

## destroyEditor(editor, options)

```javascript
destroyEditor(editor, options)
```

* Destroy editor instance

---

## clear()

```javascript
clear()
```

* Clear pool and destroy all editors

---

## prune(maxAge = 5 * 60 * 1000)

```javascript
prune(maxAge = 5 * 60 * 1000)
```

* Prune old editors from pool

---

## getStats()

```javascript
getStats()
```

* Get pool statistics

---

## getActive(containerId)

```javascript
getActive(containerId)
```

* Get active editor by container ID

---

## isActive(containerId)

```javascript
isActive(containerId)
```

* Check if editor is active

---

## resizeAll()

```javascript
resizeAll()
```

* Resize all active editors

---

## setTheme(theme)

```javascript
setTheme(theme)
```

* Set theme for all active editors

---

## export function createMonacoEditorFactory(monaco)

```javascript
export function createMonacoEditorFactory(monaco)
```

* Create Monaco editor factory

---

## export function createMilkdownEditorFactory()

```javascript
export function createMilkdownEditorFactory()
```

* Create Milkdown editor factory

---

## export function createEditorPoolManager(options =

```javascript
export function createEditorPoolManager(options =
```

* Create editor pool manager

---

## getPool(type)

```javascript
getPool(type)
```

* Get or create pool for editor type

---

## async acquire(containerId, options)

```javascript
async acquire(containerId, options)
```

* Acquire editor from appropriate pool

---

## release(containerId, type)

```javascript
release(containerId, type)
```

* Release editor back to pool

---

## clearAll()

```javascript
clearAll()
```

* Clear all pools

---

## pruneAll(maxAge)

```javascript
pruneAll(maxAge)
```

* Prune all pools

---

## getAllStats()

```javascript
getAllStats()
```

* Get statistics for all pools

---

## resizeAll()

```javascript
resizeAll()
```

* Resize all active editors

---

## setTheme(theme)

```javascript
setTheme(theme)
```

* Set theme for all active editors

---

