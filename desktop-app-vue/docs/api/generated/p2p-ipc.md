# p2p-ipc

**Source**: `src/main/p2p/p2p-ipc.js`

**Generated**: 2026-02-15T10:10:53.398Z

---

## function registerP2PIPC(

```javascript
function registerP2PIPC(
```

* P2P IPC 处理器
 * 负责处理 P2P 网络通信相关的前后端通信
 *
 * @module p2p-ipc
 * @description 提供 P2P 节点管理、加密消息、多设备支持、设备同步、NAT穿透等 IPC 接口

---

## function registerP2PIPC(

```javascript
function registerP2PIPC(
```

* 注册所有 P2P IPC 处理器
 * @param {Object} dependencies - 依赖对象
 * @param {Object} dependencies.p2pManager - P2P 管理器
 * @param {Object} dependencies.ipcMain - IPC主进程对象（可选，用于测试注入）

---

## ipcMain.handle("p2p:get-node-info", async () =>

```javascript
ipcMain.handle("p2p:get-node-info", async () =>
```

* 获取节点信息
   * Channel: 'p2p:get-node-info'

---

## ipcMain.handle("p2p:connect", async (_event, multiaddr) =>

```javascript
ipcMain.handle("p2p:connect", async (_event, multiaddr) =>
```

* 连接到对等节点
   * Channel: 'p2p:connect'

---

## ipcMain.handle("p2p:disconnect", async (_event, peerId) =>

```javascript
ipcMain.handle("p2p:disconnect", async (_event, peerId) =>
```

* 断开对等节点连接
   * Channel: 'p2p:disconnect'

---

## ipcMain.handle("p2p:get-peers", async () =>

```javascript
ipcMain.handle("p2p:get-peers", async () =>
```

* 获取已连接的对等节点列表
   * Channel: 'p2p:get-peers'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 发送加密消息
   * Channel: 'p2p:send-encrypted-message'

---

## ipcMain.handle("p2p:has-encrypted-session", async (_event, peerId) =>

```javascript
ipcMain.handle("p2p:has-encrypted-session", async (_event, peerId) =>
```

* 检查是否存在加密会话
   * Channel: 'p2p:has-encrypted-session'

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 发起密钥交换
   * Channel: 'p2p:initiate-key-exchange'

---

## ipcMain.handle("p2p:get-user-devices", async (_event, userId) =>

```javascript
ipcMain.handle("p2p:get-user-devices", async (_event, userId) =>
```

* 获取用户的所有设备列表
   * Channel: 'p2p:get-user-devices'

---

## ipcMain.handle("p2p:get-current-device", async () =>

```javascript
ipcMain.handle("p2p:get-current-device", async () =>
```

* 获取当前设备信息
   * Channel: 'p2p:get-current-device'

---

## ipcMain.handle("p2p:get-device-statistics", async () =>

```javascript
ipcMain.handle("p2p:get-device-statistics", async () =>
```

* 获取设备统计信息
   * Channel: 'p2p:get-device-statistics'

---

## ipcMain.handle("p2p:get-sync-statistics", async () =>

```javascript
ipcMain.handle("p2p:get-sync-statistics", async () =>
```

* 获取同步统计信息
   * Channel: 'p2p:get-sync-statistics'

---

## ipcMain.handle("p2p:get-message-status", async (_event, messageId) =>

```javascript
ipcMain.handle("p2p:get-message-status", async (_event, messageId) =>
```

* 获取消息状态
   * Channel: 'p2p:get-message-status'

---

## ipcMain.handle("p2p:start-device-sync", async (_event, deviceId) =>

```javascript
ipcMain.handle("p2p:start-device-sync", async (_event, deviceId) =>
```

* 启动设备同步
   * Channel: 'p2p:start-device-sync'

---

## ipcMain.handle("p2p:stop-device-sync", async (_event, deviceId) =>

```javascript
ipcMain.handle("p2p:stop-device-sync", async (_event, deviceId) =>
```

* 停止设备同步
   * Channel: 'p2p:stop-device-sync'

---

## ipcMain.handle("p2p:detect-nat", async () =>

```javascript
ipcMain.handle("p2p:detect-nat", async () =>
```

* 检测 NAT 类型
   * Channel: 'p2p:detect-nat'

---

## ipcMain.handle("p2p:get-nat-info", async () =>

```javascript
ipcMain.handle("p2p:get-nat-info", async () =>
```

* 获取 NAT 信息
   * Channel: 'p2p:get-nat-info'

---

## ipcMain.handle("p2p:get-relay-info", async () =>

```javascript
ipcMain.handle("p2p:get-relay-info", async () =>
```

* 获取中继信息
   * Channel: 'p2p:get-relay-info'

---

## ipcMain.handle("p2p:run-diagnostics", async () =>

```javascript
ipcMain.handle("p2p:run-diagnostics", async () =>
```

* 运行网络诊断
   * Channel: 'p2p:run-diagnostics'

---

## ipcMain.handle("p2p:get-webrtc-quality-report", async (_event, peerId) =>

```javascript
ipcMain.handle("p2p:get-webrtc-quality-report", async (_event, peerId) =>
```

* 获取WebRTC连接质量报告
   * Channel: 'p2p:get-webrtc-quality-report'
   * @param {string} peerId - 对等节点ID（可选，不传则返回所有连接的报告）

---

## ipcMain.handle(

```javascript
ipcMain.handle(
```

* 获取WebRTC优化建议
   * Channel: 'p2p:get-webrtc-optimization-suggestions'
   * @param {string} peerId - 对等节点ID

---

## ipcMain.handle("p2p:get-connection-pool-stats", async () =>

```javascript
ipcMain.handle("p2p:get-connection-pool-stats", async () =>
```

* 获取连接池统计信息
   * Channel: 'p2p:get-connection-pool-stats'

---

