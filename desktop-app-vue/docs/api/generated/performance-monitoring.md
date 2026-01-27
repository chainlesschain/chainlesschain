# performance-monitoring

**Source**: `src\renderer\utils\performance-monitoring.js`

**Generated**: 2026-01-27T06:44:03.896Z

---

## export class PerformanceBudgetManager

```javascript
export class PerformanceBudgetManager
```

* Performance Budget and Real-time Monitoring System
 * 性能预算和实时监控系统
 *
 * Features:
 * - Performance budget definition and checking
 * - Core Web Vitals monitoring (LCP, FID, CLS)
 * - Real-time performance tracking
 * - Performance alerts
 * - Automated reporting
 * - Regression detection

---

## export class PerformanceBudgetManager

```javascript
export class PerformanceBudgetManager
```

* Performance Budget Manager
 * 性能预算管理器

---

## check(metrics)

```javascript
check(metrics)
```

* Check if metrics meet budget

---

## onViolation(callback)

```javascript
onViolation(callback)
```

* Add budget violation listener

---

## notifyViolation(violation)

```javascript
notifyViolation(violation)
```

* Notify violation

---

## getStatus()

```javascript
getStatus()
```

* Get budget status

---

## updateBudget(key, value)

```javascript
updateBudget(key, value)
```

* Update budget

---

## export class CoreWebVitalsMonitor

```javascript
export class CoreWebVitalsMonitor
```

* Core Web Vitals Monitor
 * Core Web Vitals 监控器

---

## init()

```javascript
init()
```

* Initialize monitoring

---

## observeLCP()

```javascript
observeLCP()
```

* Observe LCP

---

## observeFID()

```javascript
observeFID()
```

* Observe FID

---

## observeCLS()

```javascript
observeCLS()
```

* Observe CLS

---

## observeFCP()

```javascript
observeFCP()
```

* Observe FCP

---

## observeTTFB()

```javascript
observeTTFB()
```

* Observe TTFB

---

## destroy()

```javascript
destroy()
```

* Destroy and cleanup

---

## onMetric(callback)

```javascript
onMetric(callback)
```

* Add metric listener

---

## notifyListeners(name, value)

```javascript
notifyListeners(name, value)
```

* Notify listeners

---

## getMetrics()

```javascript
getMetrics()
```

* Get all metrics

---

## getScore(metric, value)

```javascript
getScore(metric, value)
```

* Get metric score

---

## getOverallScore()

```javascript
getOverallScore()
```

* Get overall score

---

## export class RealtimePerformanceMonitor

```javascript
export class RealtimePerformanceMonitor
```

* Real-time Performance Monitor
 * 实时性能监控器

---

## start()

```javascript
start()
```

* Start monitoring

---

## stop()

```javascript
stop()
```

* Stop monitoring

---

## startFPSMonitoring()

```javascript
startFPSMonitoring()
```

* Start FPS monitoring

---

## update()

```javascript
update()
```

* Update metrics

---

## onUpdate(callback)

```javascript
onUpdate(callback)
```

* Add metrics listener

---

## notifyListeners(metrics)

```javascript
notifyListeners(metrics)
```

* Notify listeners

---

## getMetrics()

```javascript
getMetrics()
```

* Get current metrics

---

## export class PerformanceAlertSystem

```javascript
export class PerformanceAlertSystem
```

* Performance Alert System
 * 性能告警系统

---

## check(metrics)

```javascript
check(metrics)
```

* Check metrics and alert

---

## createAlert(type, message)

```javascript
createAlert(type, message)
```

* Create alert

---

## getSeverity(type)

```javascript
getSeverity(type)
```

* Get alert severity

---

## processAlert(alert)

```javascript
processAlert(alert)
```

* Process alert

---

## static async requestNotificationPermission()

```javascript
static async requestNotificationPermission()
```

* Request notification permission

---

## export default

```javascript
export default
```

* Export default object

---

