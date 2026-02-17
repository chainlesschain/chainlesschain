# remote-gateway

**Source**: `src/main/remote/remote-gateway.js`

**Generated**: 2026-02-17T10:13:18.197Z

---

## const

```javascript
const
```

* 远程网关 - 统一的远程命令处理入口
 *
 * 功能：
 * - 集成 P2P 命令适配器
 * - 集成权限验证器
 * - 集成命令路由器
 * - 统一的命令处理流程
 * - 事件广播
 * - 统计监控
 *
 * @module remote/remote-gateway

---

## class RemoteGateway extends EventEmitter

```javascript
class RemoteGateway extends EventEmitter
```

* 远程网关类

---

## async initialize()

```javascript
async initialize()
```

* 初始化网关

---

## async initializePermissionGate()

```javascript
async initializePermissionGate()
```

* 初始化权限验证器

---

## async initializeCommandRouter()

```javascript
async initializeCommandRouter()
```

* 初始化命令路由器

---

## async initializeP2PCommandAdapter()

```javascript
async initializeP2PCommandAdapter()
```

* 初始化 P2P 命令适配器

---

## async registerCommandHandlers()

```javascript
async registerCommandHandlers()
```

* 注册命令处理器

---

## setupEventHandlers()

```javascript
setupEventHandlers()
```

* 设置事件监听

---

## async handleCommand(data)

```javascript
async handleCommand(data)
```

* 处理命令（核心方法）

---

## async sendCommand(peerId, method, params, options =

```javascript
async sendCommand(peerId, method, params, options =
```

* 主动发送命令到设备（PC -> Android）

---

## broadcastEvent(method, params, targetDevices = null)

```javascript
broadcastEvent(method, params, targetDevices = null)
```

* 广播事件到所有设备

---

## getConnectedDevices()

```javascript
getConnectedDevices()
```

* 获取已连接设备列表

---

## async disconnectDevice(peerId)

```javascript
async disconnectDevice(peerId)
```

* 断开设备连接
   * @param {string} peerId - 设备的 Peer ID 或 DID
   * @returns {Promise<Object>} 断开结果

---

## async setDevicePermission(did, level, options =

```javascript
async setDevicePermission(did, level, options =
```

* 设置设备权限

---

## async getDevicePermission(did)

```javascript
async getDevicePermission(did)
```

* 获取设备权限

---

## getAuditLogs(options =

```javascript
getAuditLogs(options =
```

* 获取审计日志

---

## getStats()

```javascript
getStats()
```

* 获取统计信息

---

## async stop()

```javascript
async stop()
```

* 停止网关

---

## isRunning()

```javascript
isRunning()
```

* 检查是否正在运行

---

