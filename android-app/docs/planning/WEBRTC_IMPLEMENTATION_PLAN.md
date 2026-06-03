# 🔌 WebRTC P2P 实现计划

**版本**: v1.0
**状态**: 设计阶段
**优先级**: P1 (高优先级)
**预计工作量**: 2-3周

---

## 📋 概述

实现完整的 WebRTC P2P 连接功能，支持设备间的实时数据传输、文件共享和远程控制。

### 当前状态

**已完成**:

- ✅ WebRTC 依赖已集成（`ch.threema:webrtc-android:134.0.0`）
- ✅ P2P 基础架构已搭建（`core-p2p` 模块）
- ✅ UI 界面已实现（设备列表、文件传输）
- ✅ DID 身份系统已完善

**未完成**（TODO标记）:

- ❌ 信令服务器连接管理（`P2PClient.kt:63`）
- ❌ WebRTC Offer/Answer 交换（`P2PClient.kt:362`）
- ❌ ICE 候选交换（`P2PClient.kt:420`）
- ❌ 数据通道建立（`P2PClient.kt:424`）
- ❌ 连接状态管理（`P2PClient.kt:440`）
- ❌ 离线消息队列（P2P相关）

---

## 🎯 目标

### 核心功能

1. **设备发现与连接**
   - 基于 DID 的设备识别
   - WebRTC 点对点连接建立
   - 自动 NAT 穿透

2. **数据传输**
   - 可靠数据通道（文件传输）
   - 不可靠数据通道（实时消息）
   - 流控和重传机制

3. **文件共享**
   - 大文件分块传输
   - 断点续传支持
   - 传输进度监控

4. **消息同步**
   - 实时消息推送
   - 离线消息队列
   - 消息顺序保证

### 非功能需求

- **性能**: 连接建立 < 5秒
- **稳定性**: 连接成功率 > 90%
- **安全性**: 端到端加密（DTLS/SRTP）
- **兼容性**: Android 8.0+

---

## 🏗️ 架构设计

### 模块划分

```
core-p2p/
├── connection/              # WebRTC 连接管理
│   ├── WebRTCConnectionManager.kt      # 连接管理器
│   ├── SignalingClient.kt              # 信令客户端
│   ├── IceCandidateManager.kt          # ICE 候选管理
│   └── PeerConnectionFactory.kt        # PeerConnection 工厂
├── channel/                 # 数据通道
│   ├── DataChannelManager.kt           # 数据通道管理
│   ├── ReliableChannel.kt              # 可靠通道（文件）
│   └── UnreliableChannel.kt            # 不可靠通道（消息）
├── signaling/               # 信令协议
│   ├── SignalingMessage.kt             # 信令消息定义
│   ├── SignalingProtocol.kt            # 协议实现
│   └── SignalingServer.kt              # 服务器接口
├── transfer/                # 文件传输
│   ├── FileTransferManager.kt          # 传输管理器
│   ├── ChunkManager.kt                 # 分块管理
│   └── TransferProtocol.kt             # 传输协议
└── queue/                   # 消息队列
    ├── OfflineMessageQueue.kt          # 离线队列
    └── MessageSyncManager.kt           # 同步管理
```

### 数据流

```
┌─────────────┐         ┌─────────────┐
│  Device A   │         │  Device B   │
└──────┬──────┘         └──────┬──────┘
       │                       │
       │  1. Signal (Offer)    │
       │──────────────────────>│
       │                       │
       │  2. Signal (Answer)   │
       │<──────────────────────│
       │                       │
       │  3. ICE Candidates    │
       │<─────────────────────>│
       │                       │
       │  4. WebRTC Connection │
       │<═════════════════════>│
       │                       │
       │  5. Data Channel      │
       │<─────────────────────>│
```

---

## 🔧 技术方案

### 1. 信令服务器

**方案选择**:

**选项A: WebSocket (推荐)**

- ✅ 实时双向通信
- ✅ 支持广播
- ✅ 实现简单
- ❌ 需要服务器维护

**选项B: Firebase Cloud Messaging**

- ✅ 无需自建服务器
- ✅ 高可用性
- ❌ 延迟较高
- ❌ 消息大小限制

**选项C: Signal Protocol**

- ✅ 端到端加密
- ✅ 安全性高
- ❌ 实现复杂
- ❌ 依赖第三方服务器

**决策**: 采用 **WebSocket** + **备用 FCM**

### 2. ICE 服务器配置

```kotlin
val iceServers = listOf(
    // Google 公共 STUN 服务器
    PeerConnection.IceServer.builder("stun:stun.l.google.com:19302").createIceServer(),
    PeerConnection.IceServer.builder("stun:stun1.l.google.com:19302").createIceServer(),

    // 可选：自建 TURN 服务器（NAT 穿透失败时使用）
    PeerConnection.IceServer.builder("turn:turn.example.com:3478")
        .setUsername("username")
        .setPassword("password")
        .createIceServer()
)
```

### 3. 数据通道配置

**可靠通道（文件传输）**:

```kotlin
val reliableInit = DataChannel.Init().apply {
    ordered = true          // 保证顺序
    maxRetransmits = -1     // 无限重传
}
```

**不可靠通道（实时消息）**:

```kotlin
val unreliableInit = DataChannel.Init().apply {
    ordered = false         // 不保证顺序
    maxRetransmitTimeMs = 1000  // 最多重传1秒
}
```

---

## 📝 实现步骤

### Phase 1: 信令系统（1周）

#### 1.1 信令消息定义

```kotlin
sealed class SignalingMessage {
    data class Offer(
        val sdp: String,
        val from: String,
        val to: String
    ) : SignalingMessage()

    data class Answer(
        val sdp: String,
        val from: String,
        val to: String
    ) : SignalingMessage()

    data class IceCandidate(
        val candidate: String,
        val sdpMid: String,
        val sdpMLineIndex: Int,
        val from: String,
        val to: String
    ) : SignalingMessage()

    data class Bye(
        val from: String,
        val to: String
    ) : SignalingMessage()
}
```

#### 1.2 信令客户端实现

**关键接口**:

```kotlin
interface SignalingClient {
    // 连接到信令服务器
    suspend fun connect(serverUrl: String)

    // 断开连接
    suspend fun disconnect()

    // 发送信令消息
    suspend fun sendMessage(message: SignalingMessage)

    // 接收信令消息
    val messages: Flow<SignalingMessage>

    // 连接状态
    val connectionState: StateFlow<ConnectionState>
}
```

**实现要点**:

- 使用 OkHttp WebSocket
- 自动重连机制（指数退避）
- 心跳检测（30秒间隔）
- 消息序列化（Kotlinx Serialization）

#### 1.3 测试用例

- [ ] 连接建立成功
- [ ] 消息发送和接收
- [ ] 断线自动重连
- [ ] 心跳超时处理

---

### Phase 2: WebRTC 连接（5天）

#### 2.1 PeerConnection 工厂

```kotlin
class WebRTCPeerConnectionFactory @Inject constructor(
    private val context: Context
) {
    private val factory: PeerConnectionFactory by lazy {
        PeerConnectionFactory.builder()
            .setOptions(PeerConnectionFactory.Options().apply {
                disableEncryption = false
                disableNetworkMonitor = false
            })
            .createPeerConnectionFactory()
    }

    fun createPeerConnection(
        iceServers: List<PeerConnection.IceServer>,
        observer: PeerConnection.Observer
    ): PeerConnection? {
        val rtcConfig = PeerConnection.RTCConfiguration(iceServers).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
            continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_CONTINUALLY
            iceTransportsType = PeerConnection.IceTransportsType.ALL
        }

        return factory.createPeerConnection(rtcConfig, observer)
    }
}
```

#### 2.2 连接管理器

```kotlin
class WebRTCConnectionManager @Inject constructor(
    private val factory: WebRTCPeerConnectionFactory,
    private val signalingClient: SignalingClient
) {
    // 创建 Offer（发起方）
    suspend fun createOffer(peerId: String): Result<String>

    // 处理 Offer（接收方）
    suspend fun handleOffer(offer: String, peerId: String): Result<String>

    // 处理 Answer
    suspend fun handleAnswer(answer: String)

    // 添加 ICE 候选
    suspend fun addIceCandidate(candidate: IceCandidate)

    // 关闭连接
    suspend fun close()
}
```

#### 2.3 测试用例

- [ ] Offer 创建成功
- [ ] Answer 创建成功
- [ ] ICE 候选交换
- [ ] 连接建立成功
- [ ] 连接关闭清理

---

### Phase 3: 数据通道（3天）

#### 3.1 数据通道管理

```kotlin
class DataChannelManager @Inject constructor(
    private val peerConnection: PeerConnection
) {
    // 创建数据通道
    fun createDataChannel(
        label: String,
        reliable: Boolean = true
    ): DataChannel

    // 发送数据
    suspend fun sendData(
        channel: DataChannel,
        data: ByteArray
    ): Result<Unit>

    // 接收数据
    val receivedData: Flow<DataChannelMessage>
}
```

#### 3.2 测试用例

- [ ] 可靠通道创建
- [ ] 不可靠通道创建
- [ ] 数据发送和接收
- [ ] 大数据分块传输

---

### Phase 4: 文件传输（3天）

#### 4.1 文件传输协议

```kotlin
sealed class TransferMessage {
    data class Start(
        val fileId: String,
        val fileName: String,
        val fileSize: Long,
        val chunkSize: Int
    ) : TransferMessage()

    data class Chunk(
        val fileId: String,
        val chunkIndex: Int,
        val data: ByteArray,
        val checksum: String
    ) : TransferMessage()

    data class Ack(
        val fileId: String,
        val chunkIndex: Int
    ) : TransferMessage()

    data class Complete(
        val fileId: String
    ) : TransferMessage()
}
```

#### 4.2 文件传输管理器

```kotlin
class FileTransferManager @Inject constructor(
    private val dataChannelManager: DataChannelManager,
    private val database: FileTransferDao
) {
    // 发送文件
    suspend fun sendFile(
        peerId: String,
        file: File
    ): Flow<TransferProgress>

    // 接收文件
    suspend fun receiveFile(
        fileId: String
    ): Flow<TransferProgress>

    // 暂停传输
    suspend fun pauseTransfer(fileId: String)

    // 恢复传输
    suspend fun resumeTransfer(fileId: String)

    // 取消传输
    suspend fun cancelTransfer(fileId: String)
}
```

#### 4.3 测试用例

- [ ] 小文件传输 (< 1MB)
- [ ] 大文件传输 (> 100MB)
- [ ] 断点续传
- [ ] 传输暂停/恢复
- [ ] 传输取消

---

### Phase 5: 离线队列（2天）

#### 5.1 离线消息队列

```kotlin
class OfflineMessageQueue @Inject constructor(
    private val database: OfflineQueueDao
) {
    // 添加离线消息
    suspend fun enqueue(
        peerId: String,
        message: ByteArray
    )

    // 发送队列中的消息
    suspend fun flushQueue(peerId: String): Flow<SendResult>

    // 清理已发送消息
    suspend fun cleanup()
}
```

#### 5.2 测试用例

- [ ] 离线消息入队
- [ ] 上线后自动发送
- [ ] 消息顺序保证
- [ ] 失败重试机制

---

## 🧪 测试策略

### 单元测试

**覆盖率目标**: 80%+

**关键测试类**:

- `SignalingClientTest` - 信令客户端
- `WebRTCConnectionManagerTest` - 连接管理
- `DataChannelManagerTest` - 数据通道
- `FileTransferManagerTest` - 文件传输
- `OfflineMessageQueueTest` - 离线队列

### 集成测试

**测试场景**:

1. 同一WiFi下两设备连接
2. 不同网络下NAT穿透
3. 文件传输（各种大小）
4. 断线重连
5. 离线消息同步

### 压力测试

**测试指标**:

- 并发连接数（目标：10+）
- 文件传输速度（目标：> 10MB/s）
- 内存占用（目标：< 100MB）
- 连接稳定性（目标：> 90%）

---

## 🚧 风险和挑战

### 技术风险

| 风险             | 影响 | 概率 | 缓解措施           |
| ---------------- | ---- | ---- | ------------------ |
| NAT穿透失败      | 高   | 中   | 配置TURN服务器备用 |
| 信令服务器不稳定 | 高   | 低   | 实现FCM备用方案    |
| 连接频繁断开     | 中   | 中   | 自动重连机制       |
| 大文件传输OOM    | 中   | 低   | 分块+流式处理      |
| 电池消耗过高     | 低   | 中   | 空闲自动断开       |

### 依赖风险

- **信令服务器**: 需要自建或使用第三方
- **TURN服务器**: NAT穿透失败时必需
- **网络质量**: 影响用户体验

---

## 📅 时间规划

| 阶段     | 任务                | 工作量 | 负责人 |
| -------- | ------------------- | ------ | ------ |
| Week 1   | Phase 1: 信令系统   | 5天    | -      |
| Week 2   | Phase 2: WebRTC连接 | 5天    | -      |
| Week 2-3 | Phase 3: 数据通道   | 3天    | -      |
| Week 3   | Phase 4: 文件传输   | 3天    | -      |
| Week 3   | Phase 5: 离线队列   | 2天    | -      |
| Week 3   | 测试和优化          | 2天    | -      |

**总计**: 约 3 周（15个工作日）

---

## 📚 参考资料

### 官方文档

- [WebRTC Official](https://webrtc.org/)
- [WebRTC Android API](https://webrtc.github.io/webrtc-org/native-code/android/)
- [MDN WebRTC API](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API)

### 开源项目

- [AppRTC](https://github.com/webrtc/apprtc) - Google官方示例
- [WebRTC Android Sample](https://github.com/vivek1794/webrtc-android-codelab)
- [Jitsi Meet](https://github.com/jitsi/jitsi-meet) - 生产级实现

### 最佳实践

- [WebRTC for the Curious](https://webrtcforthecurious.com/)
- [Real-time Communication with WebRTC](https://codelabs.developers.google.com/codelabs/webrtc-web)

---

## ✅ 验收标准

### 功能完整性

- [ ] 设备发现和配对
- [ ] WebRTC连接建立
- [ ] 文件传输（小文件 + 大文件）
- [ ] 实时消息推送
- [ ] 离线消息队列
- [ ] 断点续传

### 性能指标

- [ ] 连接建立时间 < 5秒
- [ ] 连接成功率 > 90%
- [ ] 文件传输速度 > 10MB/s
- [ ] 内存占用 < 100MB

### 代码质量

- [ ] 单元测试覆盖率 > 80%
- [ ] 集成测试通过
- [ ] 代码审查通过
- [ ] 文档完整

---

## 🔄 后续优化

### v1.1 功能增强

- [ ] 多设备同时连接
- [ ] 文件批量传输
- [ ] 传输速度限制
- [ ] 传输历史记录

### v1.2 体验优化

- [ ] 自动NAT类型检测
- [ ] 连接质量指示
- [ ] 传输加速优化
- [ ] 低电量模式

### v2.0 高级功能

- [ ] 音视频通话
- [ ] 屏幕共享
- [ ] 远程控制
- [ ] P2P CDN

---

**文档版本**: v1.0
**创建日期**: 2026-02-05
**最后更新**: 2026-02-05
**状态**: ✅ 计划完成，待实施
