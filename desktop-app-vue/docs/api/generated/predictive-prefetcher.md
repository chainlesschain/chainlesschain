# predictive-prefetcher

**Source**: `src\renderer\utils\predictive-prefetcher.js`

**Generated**: 2026-01-27T06:44:03.895Z

---

## import

```javascript
import
```

* Predictive Prefetcher
 * Predicts which files user will open next based on access patterns and prefetches them

---

## async loadHistory()

```javascript
async loadHistory()
```

* Load access history from storage

---

## saveHistory()

```javascript
saveHistory()
```

* Save access history to storage

---

## recordAccess(path, metadata =

```javascript
recordAccess(path, metadata =
```

* Record file access

---

## updatePatterns(access)

```javascript
updatePatterns(access)
```

* Update access patterns

---

## rebuildPatterns()

```javascript
rebuildPatterns()
```

* Rebuild patterns from history

---

## predictNextFiles(currentPath, metadata =

```javascript
predictNextFiles(currentPath, metadata =
```

* Predict next files

---

## async predictAndPrefetch(currentPath, metadata =

```javascript
async predictAndPrefetch(currentPath, metadata =
```

* Predict and prefetch files

---

## async processPrefetchQueue()

```javascript
async processPrefetchQueue()
```

* Process prefetch queue

---

## getPrefetched(path)

```javascript
getPrefetched(path)
```

* Get prefetched file

---

## isPrefetched(path)

```javascript
isPrefetched(path)
```

* Check if file is prefetched

---

## getStats()

```javascript
getStats()
```

* Get statistics

---

## clearHistory()

```javascript
clearHistory()
```

* Clear history

---

## clearPrefetchCache()

```javascript
clearPrefetchCache()
```

* Clear prefetch cache

---

## exportPatterns()

```javascript
exportPatterns()
```

* Export patterns for analysis

---

