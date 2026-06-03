# performanceMonitor

**Source**: `src\renderer\utils\performanceMonitor.js`

**Generated**: 2026-01-27T06:44:03.895Z

---

## import

```javascript
import
```

* 性能监控管理器
 * 监控应用性能指标，包括内存、CPU、渲染性能等

---

## export const MetricType =

```javascript
export const MetricType =
```

* 性能指标类型

---

## class PerformanceMetric

```javascript
class PerformanceMetric
```

* 性能指标类

---

## class PerformanceMonitor

```javascript
class PerformanceMonitor
```

* 性能监控管理器

---

## start()

```javascript
start()
```

* 开始监控

---

## stop()

```javascript
stop()
```

* 停止监控

---

## async collectMetrics()

```javascript
async collectMetrics()
```

* 收集性能指标

---

## addMetric(type, value, metadata =

```javascript
addMetric(type, value, metadata =
```

* 添加指标数据

---

## startFPSMonitoring()

```javascript
startFPSMonitoring()
```

* 启动 FPS 监控

---

## stopFPSMonitoring()

```javascript
stopFPSMonitoring()
```

* 停止 FPS 监控

---

## startRenderMonitoring()

```javascript
startRenderMonitoring()
```

* 启动渲染性能监控

---

## stopRenderMonitoring()

```javascript
stopRenderMonitoring()
```

* 停止渲染性能监控

---

## getMetrics(type, limit = null)

```javascript
getMetrics(type, limit = null)
```

* 获取指标数据

---

## getCurrentMetrics()

```javascript
getCurrentMetrics()
```

* 获取当前指标

---

## getPerformanceReport()

```javascript
getPerformanceReport()
```

* 获取性能报告

---

## mark(name)

```javascript
mark(name)
```

* 标记性能点

---

## measure(name, startMark, endMark)

```javascript
measure(name, startMark, endMark)
```

* 测量性能

---

## clearMarks(name = null)

```javascript
clearMarks(name = null)
```

* 清除标记

---

## clearMeasures(name = null)

```javascript
clearMeasures(name = null)
```

* 清除测量

---

## clear()

```javascript
clear()
```

* 清空所有数据

---

## exportData()

```javascript
exportData()
```

* 导出性能数据

---

## export function usePerformanceMonitor()

```javascript
export function usePerformanceMonitor()
```

* 组合式函数：使用性能监控

---

