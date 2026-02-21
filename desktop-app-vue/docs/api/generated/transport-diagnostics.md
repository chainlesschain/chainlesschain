# transport-diagnostics

**Source**: `src/main/p2p/transport-diagnostics.js`

**Generated**: 2026-02-21T20:04:16.225Z

---

## class TransportDiagnostics

```javascript
class TransportDiagnostics
```

* 传输层诊断工具
 * 测试P2P传输层的健康状况和性能

---

## async testTransport(transport, targetPeer = null)

```javascript
async testTransport(transport, targetPeer = null)
```

* 测试单个传输层
   * @param {string} transport - 传输层名称 ('tcp', 'webrtc', 'websocket')
   * @param {string} targetPeer - 目标peer ID（可选）
   * @returns {Promise<Object>} 测试结果

---

## async runFullDiagnostics()

```javascript
async runFullDiagnostics()
```

* 运行完整诊断
   * @returns {Promise<Object>} 完整诊断结果

---

## getTransportHealth(transport)

```javascript
getTransportHealth(transport)
```

* 获取传输层健康状态
   * @param {string} transport - 传输层名称
   * @returns {Object} 健康指标

---

## updateTransportHealth(transport, success, latency = 0)

```javascript
updateTransportHealth(transport, success, latency = 0)
```

* 更新传输层健康数据
   * @param {string} transport - 传输层名称
   * @param {boolean} success - 是否成功
   * @param {number} latency - 延迟（毫秒）

---

## startHealthMonitoring(interval = 60000)

```javascript
startHealthMonitoring(interval = 60000)
```

* 开始健康监控
   * @param {number} interval - 监控间隔（毫秒）

---

## stopHealthMonitoring()

```javascript
stopHealthMonitoring()
```

* 停止健康监控

---

## getHealthReport()

```javascript
getHealthReport()
```

* 获取所有传输层的健康报告
   * @returns {Object} 健康报告

---

## clearHealthData()

```javascript
clearHealthData()
```

* 清除健康数据

---

