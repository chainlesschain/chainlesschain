# webrtc-quality-monitor

**Source**: `src/main/p2p/webrtc-quality-monitor.js`

**Generated**: 2026-02-21T22:04:25.804Z

---

## const

```javascript
const
```

* WebRTC连接质量监控器
 *
 * 功能：
 * - 监控WebRTC连接质量
 * - 收集连接统计信息
 * - 检测连接问题
 * - 提供优化建议

---

## const QualityLevel =

```javascript
const QualityLevel =
```

* 连接质量等级

---

## class WebRTCQualityMonitor extends EventEmitter

```javascript
class WebRTCQualityMonitor extends EventEmitter
```

* WebRTC质量监控器类

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

## setupEventListeners()

```javascript
setupEventListeners()
```

* 设置事件监听器

---

## initializeConnectionStats(peerId)

```javascript
initializeConnectionStats(peerId)
```

* 初始化连接统计信息

---

## async collectStats()

```javascript
async collectStats()
```

* 收集统计信息

---

## isWebRTCConnection(connection)

```javascript
isWebRTCConnection(connection)
```

* 检查是否是WebRTC连接

---

## async getConnectionStats(connection)

```javascript
async getConnectionStats(connection)
```

* 获取连接统计信息

---

## processStats(peerId, stats)

```javascript
processStats(peerId, stats)
```

* 处理统计信息

---

## calculateQuality(statsHistory)

```javascript
calculateQuality(statsHistory)
```

* 计算连接质量

---

## calculateMetrics(statsHistory)

```javascript
calculateMetrics(statsHistory)
```

* 计算质量指标

---

## checkAlerts(peerId, stats, connData)

```javascript
checkAlerts(peerId, stats, connData)
```

* 检查告警

---

## getQualityReport(peerId)

```javascript
getQualityReport(peerId)
```

* 获取连接质量报告

---

## getAllQualityReports()

```javascript
getAllQualityReports()
```

* 获取所有连接的质量报告

---

## getOptimizationSuggestions(peerId)

```javascript
getOptimizationSuggestions(peerId)
```

* 获取优化建议

---

