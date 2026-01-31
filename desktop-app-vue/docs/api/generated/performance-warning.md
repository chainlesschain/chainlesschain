# performance-warning

**Source**: `src\renderer\utils\performance-warning.js`

**Generated**: 2026-01-27T06:44:03.895Z

---

## import

```javascript
import
```

* 性能预警系统
 * 监控应用性能指标并在超过阈值时发出警告

---

## start()

```javascript
start()
```

* 启动性能监控

---

## stop()

```javascript
stop()
```

* 停止性能监控

---

## checkPerformance()

```javascript
checkPerformance()
```

* 检查性能指标

---

## checkFPS()

```javascript
checkFPS()
```

* 检查FPS

---

## checkMemory()

```javascript
checkMemory()
```

* 检查内存使用

---

## checkRenderPerformance()

```javascript
checkRenderPerformance()
```

* 检查渲染性能

---

## checkErrorRate()

```javascript
checkErrorRate()
```

* 检查错误率

---

## getCurrentFPS()

```javascript
getCurrentFPS()
```

* 获取当前FPS

---

## getWarningLevel(value, thresholds, inverse = false)

```javascript
getWarningLevel(value, thresholds, inverse = false)
```

* 获取警告级别

---

## addWarning(warning)

```javascript
addWarning(warning)
```

* 添加警告

---

## showNotification(warning)

```javascript
showNotification(warning)
```

* 显示通知

---

## getWarningTitle(level)

```javascript
getWarningTitle(level)
```

* 获取警告标题

---

## clearWarning(id)

```javascript
clearWarning(id)
```

* 清除警告

---

## clearAllWarnings()

```javascript
clearAllWarnings()
```

* 清除所有警告

---

## addListener(callback)

```javascript
addListener(callback)
```

* 添加监听器

---

## notifyListeners(warning)

```javascript
notifyListeners(warning)
```

* 通知监听器

---

## getStats()

```javascript
getStats()
```

* 获取统计信息

---

## exportHistory()

```javascript
exportHistory()
```

* 导出警告历史

---

## setThreshold(type, level, value)

```javascript
setThreshold(type, level, value)
```

* 设置阈值

---

## setNotificationEnabled(enabled)

```javascript
setNotificationEnabled(enabled)
```

* 启用/禁用通知

---

## export function getPerformanceWarningSystem()

```javascript
export function getPerformanceWarningSystem()
```

* 获取性能预警系统实例

---

## export function usePerformanceWarning()

```javascript
export function usePerformanceWarning()
```

* 性能预警 Composable

---

