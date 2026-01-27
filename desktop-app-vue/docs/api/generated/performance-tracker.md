# performance-tracker

**Source**: `src\renderer\utils\performance-tracker.js`

**Generated**: 2026-01-27T06:44:03.895Z

---

## class PerformanceTracker

```javascript
class PerformanceTracker
```

* Performance Tracker
 * Tracks file operations, AI responses, and system metrics

---

## addListener(callback)

```javascript
addListener(callback)
```

* Add listener for performance events

---

## emit(event, data)

```javascript
emit(event, data)
```

* Emit event to all listeners

---

## trackFileOperation(operation, file, startTime)

```javascript
trackFileOperation(operation, file, startTime)
```

* Track file operation

---

## trackAiResponse(model, tokens, startTime)

```javascript
trackAiResponse(model, tokens, startTime)
```

* Track AI response

---

## trackNetworkRequest(url, method, startTime, success = true)

```javascript
trackNetworkRequest(url, method, startTime, success = true)
```

* Track network request

---

## trackCacheHit()

```javascript
trackCacheHit()
```

* Track cache hit

---

## trackCacheMiss()

```javascript
trackCacheMiss()
```

* Track cache miss

---

## getCacheHitRate()

```javascript
getCacheHitRate()
```

* Get cache hit rate

---

## getFileOperationStats()

```javascript
getFileOperationStats()
```

* Get file operation statistics

---

## getAiResponseStats()

```javascript
getAiResponseStats()
```

* Get AI response statistics

---

## getNetworkStats()

```javascript
getNetworkStats()
```

* Get network request statistics

---

## interceptFetch()

```javascript
interceptFetch()
```

* Intercept fetch for network tracking

---

## async measure(name, fn)

```javascript
async measure(name, fn)
```

* Measure function execution time

---

## mark(name)

```javascript
mark(name)
```

* Create a performance mark

---

## measureBetween(name, startMark, endMark)

```javascript
measureBetween(name, startMark, endMark)
```

* Measure between two marks

---

## clear()

```javascript
clear()
```

* Clear all metrics

---

## getAllMetrics()

```javascript
getAllMetrics()
```

* Get all metrics

---

