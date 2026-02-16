# history-memory-optimization

**Source**: `src/main/ai-engine/history-memory-optimization.js`

**Generated**: 2026-02-16T22:06:51.519Z

---

## const

```javascript
const
```

* History Memory Optimization
 * P2 Extended Feature - Long-term Memory Integration
 *
 * Integrates with MemGPT Core for:
 * - Historical task learning
 * - Success prediction based on past executions
 * - Pattern recognition and memory
 *
 * @module history-memory-optimization
 * @version 2.0.0

---

## class HistoryMemoryOptimization

```javascript
class HistoryMemoryOptimization
```

* History Memory Optimization Class
 * Bridges AI Engine with MemGPT long-term memory system

---

## setDatabase(db)

```javascript
setDatabase(db)
```

* Set database reference
   * @param {Object} db - Database instance

---

## setMemGPTCore(memgptCore)

```javascript
setMemGPTCore(memgptCore)
```

* Set MemGPT Core reference
   * @param {MemGPTCore} memgptCore - MemGPT Core instance

---

## async learnFromHistory(taskType, context =

```javascript
async learnFromHistory(taskType, context =
```

* Learn from task execution history
   * @param {string} taskType - Type of task
   * @param {Object} context - Execution context
   * @returns {Promise<Object|null>} Learned memory or null

---

## async predictSuccess(task, context =

```javascript
async predictSuccess(task, context =
```

* Predict success probability for a task
   * @param {Object} task - Task to predict
   * @param {Object} context - Execution context
   * @returns {Promise<Object>} Prediction result

---

## async recordExecution(task, result, duration, context =

```javascript
async recordExecution(task, result, duration, context =
```

* Record task execution for future learning
   * @param {Object} task - Executed task
   * @param {Object} result - Execution result
   * @param {number} duration - Execution duration in ms
   * @param {Object} context - Execution context

---

## updatePredictionAccuracy(prediction, actualSuccess)

```javascript
updatePredictionAccuracy(prediction, actualSuccess)
```

* Update prediction accuracy
   * @param {Object} prediction - Original prediction
   * @param {boolean} actualSuccess - Actual outcome

---

## getStats()

```javascript
getStats()
```

* Get statistics
   * @returns {Object} Statistics

---

## cleanup()

```javascript
cleanup()
```

* Cleanup resources

---

## _getCacheKey(taskType, context)

```javascript
_getCacheKey(taskType, context)
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

## _addToCache(key, data)

```javascript
_addToCache(key, data)
```

* Add to cache
   * @private

---

## _invalidateCache(taskType)

```javascript
_invalidateCache(taskType)
```

* Invalidate cache entries for a task type
   * @private

---

## _aggregateMemories(results)

```javascript
_aggregateMemories(results)
```

* Aggregate memories from MemGPT search results
   * @private

---

## _aggregateDbRows(rows)

```javascript
_aggregateDbRows(rows)
```

* Aggregate database rows
   * @private

---

