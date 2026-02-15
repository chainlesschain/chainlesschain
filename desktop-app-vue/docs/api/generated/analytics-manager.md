# analytics-manager

**Source**: `src/main/monitoring/analytics-manager.js`

**Generated**: 2026-02-15T07:37:13.813Z

---

## const

```javascript
const
```

* 应用统计分析器
 * 收集和分析应用使用数据

---

## startSession()

```javascript
startSession()
```

* 开始会话

---

## endSession()

```javascript
endSession()
```

* 结束会话

---

## trackEvent(category, action, label = "", value = 0)

```javascript
trackEvent(category, action, label = "", value = 0)
```

* 跟踪事件

---

## trackFeature(featureName)

```javascript
trackFeature(featureName)
```

* 跟踪功能使用

---

## trackError(error, context =

```javascript
trackError(error, context =
```

* 跟踪错误

---

## trackPerformance(metric, value, unit = "ms")

```javascript
trackPerformance(metric, value, unit = "ms")
```

* 跟踪性能指标

---

## getStatistics()

```javascript
getStatistics()
```

* 获取统计数据

---

## getSessions(limit = 10)

```javascript
getSessions(limit = 10)
```

* 获取会话列表

---

## getErrors(limit = 10)

```javascript
getErrors(limit = 10)
```

* 获取错误列表

---

## getFeatureUsage()

```javascript
getFeatureUsage()
```

* 获取功能使用情况

---

## loadData()

```javascript
loadData()
```

* 加载数据

---

## saveData()

```javascript
saveData()
```

* 保存数据

---

## clearData()

```javascript
clearData()
```

* 清空数据

---

## exportData(outputPath)

```javascript
exportData(outputPath)
```

* 导出数据

---

