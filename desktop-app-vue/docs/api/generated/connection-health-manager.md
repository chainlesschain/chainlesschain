# connection-health-manager

**Source**: `src/main/p2p/connection-health-manager.js`

**Generated**: 2026-02-22T01:23:36.702Z

---

## const

```javascript
const
```

* P2P连接健康监控和自动重连管理器
 *
 * 功能：
 * - 连接健康检查
 * - 自动重连机制
 * - 网络质量监控
 * - 连接降级策略

---

## async initialize()

```javascript
async initialize()
```

* 初始化

---

## _setupEventListeners()

```javascript
_setupEventListeners()
```

* 设置事件监听

---

## _setupNetworkMonitoring()

```javascript
_setupNetworkMonitoring()
```

* 设置网络监控

---

## _startHealthCheck()

```javascript
_startHealthCheck()
```

* 启动健康检查

---

## async _performHealthCheck()

```javascript
async _performHealthCheck()
```

* 执行健康检查

---

## async _checkPeerConnection(peerId)

```javascript
async _checkPeerConnection(peerId)
```

* 检查对等方连接

---

## async _measureLatency(peerId)

```javascript
async _measureLatency(peerId)
```

* 测量延迟

---

## _evaluateConnectionQuality(peerId, health)

```javascript
_evaluateConnectionQuality(peerId, health)
```

* 评估连接质量

---

## async _triggerReconnect(peerId)

```javascript
async _triggerReconnect(peerId)
```

* 触发重连

---

## _onPeerConnected(peerId)

```javascript
_onPeerConnected(peerId)
```

* 处理对等方连接

---

## _onPeerDisconnected(peerId)

```javascript
_onPeerDisconnected(peerId)
```

* 处理对等方断开

---

## _onPeerError(peerId, error)

```javascript
_onPeerError(peerId, error)
```

* 处理对等方错误

---

## async _handleNetworkRestore()

```javascript
async _handleNetworkRestore()
```

* 处理网络恢复

---

## _handleNetworkLoss()

```javascript
_handleNetworkLoss()
```

* 处理网络丢失

---

## getPeerHealth(peerId)

```javascript
getPeerHealth(peerId)
```

* 获取对等方健康状态

---

## getAllPeerHealth()

```javascript
getAllPeerHealth()
```

* 获取所有健康状态

---

## getNetworkQuality()

```javascript
getNetworkQuality()
```

* 获取网络质量

---

## cleanup()

```javascript
cleanup()
```

* 清理资源

---

