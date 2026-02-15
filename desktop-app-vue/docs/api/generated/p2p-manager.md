# p2p-manager

**Source**: `src/main/p2p/p2p-manager.js`

**Generated**: 2026-02-15T07:37:13.807Z

---

## const

```javascript
const
```

* P2P 网络管理器
 *
 * 基于 libp2p 实现去中心化的 P2P 通信网络
 * 功能：节点发现、DHT、消息传输、NAT穿透、端到端加密

---

## const DEFAULT_CONFIG =

```javascript
const DEFAULT_CONFIG =
```

* P2P 配置

---

## class P2PManager extends EventEmitter

```javascript
class P2PManager extends EventEmitter
```

* P2P 管理器类

---

## async loadP2PConfig()

```javascript
async loadP2PConfig()
```

* 从数据库加载P2P配置

---

## async initialize()

```javascript
async initialize()
```

* 初始化 P2P 节点

---

## async loadOrGeneratePeerId()

```javascript
async loadOrGeneratePeerId()
```

* 加载或生成 PeerId

---

## getPeerDiscoveryConfig()

```javascript
getPeerDiscoveryConfig()
```

* 获取对等节点发现配置

---

## setupEvents()

```javascript
setupEvents()
```

* 设置事件监听

---

## async initializeDeviceManager()

```javascript
async initializeDeviceManager()
```

* 初始化设备管理器

---

## async initializeSignalManager()

```javascript
async initializeSignalManager()
```

* 初始化 Signal 会话管理器

---

## async initializeSyncManager()

```javascript
async initializeSyncManager()
```

* 初始化设备同步管理器

---

## registerEncryptedMessageHandlers()

```javascript
registerEncryptedMessageHandlers()
```

* 注册加密消息协议处理器

---

## registerDeviceBroadcastHandlers()

```javascript
registerDeviceBroadcastHandlers()
```

* 注册设备广播协议处理器

---

## registerDeviceSyncHandlers()

```javascript
registerDeviceSyncHandlers()
```

* 注册设备同步协议处理器

---

## async broadcastDeviceInfo()

```javascript
async broadcastDeviceInfo()
```

* 广播当前设备信息

---

## async initiateKeyExchange(peerIdStr, targetDeviceId = null)

```javascript
async initiateKeyExchange(peerIdStr, targetDeviceId = null)
```

* 发起密钥交换
   * @param {string} peerId - 对等节点 ID
   * @param {string} deviceId - 设备 ID (可选，默认使用对方的默认设备)

---

## async hasEncryptedSession(peerIdStr)

```javascript
async hasEncryptedSession(peerIdStr)
```

* 检查是否已建立加密会话
   * @param {string} peerId - 对等节点 ID

---

## async connectToPeer(multiaddrStr)

```javascript
async connectToPeer(multiaddrStr)
```

* 连接到对等节点
   * @param {string} multiaddr - 多地址字符串

---

## async disconnectFromPeer(peerIdStr)

```javascript
async disconnectFromPeer(peerIdStr)
```

* 断开与对等节点的连接
   * @param {string} peerId - 对等节点 ID

---

## getConnectedPeers()

```javascript
getConnectedPeers()
```

* 获取连接的对等节点列表

---

## isInitialized()

```javascript
isInitialized()
```

* 检查 P2P 节点是否已初始化
   * @returns {boolean} 是否已初始化

---

## getNodeInfo()

```javascript
getNodeInfo()
```

* 获取节点信息

---

## async dhtPut(key, value)

```javascript
async dhtPut(key, value)
```

* DHT: 存储数据
   * @param {string} key - 键
   * @param {Buffer} value - 值

---

## async dhtGet(key)

```javascript
async dhtGet(key)
```

* DHT: 获取数据
   * @param {string} key - 键

---

## async dhtFindProviders(cid)

```javascript
async dhtFindProviders(cid)
```

* DHT: 查找提供者
   * @param {string} cid - CID

---

## async acquireConnection(peerIdStr)

```javascript
async acquireConnection(peerIdStr)
```

* 使用连接池获取连接
   * @param {string} peerIdStr - 对等节点 ID
   * @returns {Promise<Connection>} 连接对象

---

## releaseConnection(peerIdStr)

```javascript
releaseConnection(peerIdStr)
```

* 释放连接回连接池
   * @param {string} peerIdStr - 对等节点 ID

---

## getConnectionPoolStats()

```javascript
getConnectionPoolStats()
```

* 获取连接池统计信息
   * @returns {Object} 统计信息

---

## async sendMessage(peerIdStr, data)

```javascript
async sendMessage(peerIdStr, data)
```

* 发送消息到对等节点 (明文)
   * @param {string} peerId - 对等节点 ID
   * @param {Buffer} data - 数据

---

## async sendEncryptedMessage(

```javascript
async sendEncryptedMessage(
```

* 发送加密消息到对等节点
   * @param {string} peerId - 对等节点 ID
   * @param {string|Buffer} message - 消息内容
   * @param {string} targetDeviceId - 目标设备 ID (可选)
   * @param {Object} options - 发送选项 (可选)
   * @param {boolean} options.autoQueue - 发送失败时自动入队 (默认 true)

---

## registerMessageHandler(handler)

```javascript
registerMessageHandler(handler)
```

* 注册消息处理器
   * @param {Function} handler - 处理函数

---

## getUserDevices(userId = null)

```javascript
getUserDevices(userId = null)
```

* 获取用户的所有设备
   * @param {string} userId - 用户 ID (默认为当前用户)

---

## getCurrentDevice()

```javascript
getCurrentDevice()
```

* 获取当前设备信息

---

## getDeviceStatistics()

```javascript
getDeviceStatistics()
```

* 获取设备统计信息

---

## setFriendManager(friendManager)

```javascript
setFriendManager(friendManager)
```

* 设置好友管理器
   * @param {FriendManager} friendManager - 好友管理器实例

---

## registerFriendProtocols()

```javascript
registerFriendProtocols()
```

* 注册好友相关协议处理器

---

## setPostManager(postManager)

```javascript
setPostManager(postManager)
```

* 设置动态管理器
   * @param {PostManager} postManager - 动态管理器实例

---

## registerPostProtocols()

```javascript
registerPostProtocols()
```

* 注册动态相关协议处理器

---

## async close()

```javascript
async close()
```

* 关闭 P2P 节点

---

## buildTransports(

```javascript
buildTransports(
```

* 根据配置和NAT类型构建传输层数组

---

## buildICEServers()

```javascript
buildICEServers()
```

* 构建ICE服务器配置（用于WebRTC）

---

## buildICEServers()

```javascript
buildICEServers()
```

* 构建ICE服务器配置（STUN + TURN）

---

## getWebRTCQualityReport(peerId)

```javascript
getWebRTCQualityReport(peerId)
```

* 获取WebRTC连接质量报告

---

## getWebRTCOptimizationSuggestions(peerId)

```javascript
getWebRTCOptimizationSuggestions(peerId)
```

* 获取WebRTC优化建议

---

## async startSignalingServer()

```javascript
async startSignalingServer()
```

* 启动嵌入式信令服务器

---

## async stopSignalingServer()

```javascript
async stopSignalingServer()
```

* 停止嵌入式信令服务器

---

## getSignalingServer()

```javascript
getSignalingServer()
```

* 获取信令服务器实例
   * @returns {SignalingServer|null}

---

## getSignalingServerStatus()

```javascript
getSignalingServerStatus()
```

* 获取信令服务器状态
   * @returns {Object}

---

## startNSDService()

```javascript
startNSDService()
```

* 启动 NSD 服务（让 Android 设备能发现本机）

---

## stopNSDService()

```javascript
stopNSDService()
```

* 停止 NSD 服务

---

