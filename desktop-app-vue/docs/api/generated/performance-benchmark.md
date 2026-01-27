# performance-benchmark

**Source**: `src\renderer\utils\performance-benchmark.js`

**Generated**: 2026-01-27T06:44:03.896Z

---

## class PerformanceBenchmark

```javascript
class PerformanceBenchmark
```

* Performance Benchmark Utility
 * 性能基准测试工具
 *
 * Features:
 * - Measure page load time
 * - FPS monitoring
 * - Memory usage tracking
 * - Network performance metrics
 * - Custom performance marks
 * - Generate performance reports

---

## init()

```javascript
init()
```

* Initialize benchmark

---

## trackPageLoad()

```javascript
trackPageLoad()
```

* Track page load metrics

---

## getFirstPaint()

```javascript
getFirstPaint()
```

* Get First Paint time

---

## getNavigationType(type)

```javascript
getNavigationType(type)
```

* Get navigation type

---

## startFPSMonitoring()

```javascript
startFPSMonitoring()
```

* Start FPS monitoring

---

## startMemoryMonitoring()

```javascript
startMemoryMonitoring()
```

* Start memory monitoring

---

## measureNetwork()

```javascript
measureNetwork()
```

* Measure network performance

---

## getResourceType(url)

```javascript
getResourceType(url)
```

* Get resource type from URL

---

## mark(name)

```javascript
mark(name)
```

* Create custom performance mark

---

## measure(name, startMark, endMark)

```javascript
measure(name, startMark, endMark)
```

* Measure time between two marks

---

## getAverageFPS()

```javascript
getAverageFPS()
```

* Get average FPS

---

## getCurrentMemory()

```javascript
getCurrentMemory()
```

* Get current memory usage

---

## getPerformanceScore()

```javascript
getPerformanceScore()
```

* Get performance score (0-100)

---

## generateReport()

```javascript
generateReport()
```

* Generate performance report

---

## exportReport(filename = `performance-report-$

```javascript
exportReport(filename = `performance-report-$
```

* Export report as JSON

---

## logReport()

```javascript
logReport()
```

* Log report to console (formatted)

---

## compare(baseline)

```javascript
compare(baseline)
```

* Compare with baseline

---

## stop()

```javascript
stop()
```

* Stop monitoring

---

## export function getPerformanceBenchmark(options)

```javascript
export function getPerformanceBenchmark(options)
```

* Get or create performance benchmark instance

---

## export function mark(name)

```javascript
export function mark(name)
```

* Convenience functions

---

