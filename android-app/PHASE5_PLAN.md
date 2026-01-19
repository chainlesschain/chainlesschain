# Phase 5 (Week 9-10) 实施计划：P2P网络 + DID身份

## 🎯 目标

实现设备间点对点通信、去中心化身份系统和端到端加密，为多设备同步奠定基础。

## 📦 交付成果

### 1. P2P网络基础设施

- ✅ libp2p集成（或Android替代方案）
- ✅ 设备发现（mDNS/Network Service Discovery）
- ✅ 连接管理（TCP/WebRTC）
- ✅ NAT穿透（STUN/TURN）
- ✅ 消息协议（Protobuf）

### 2. DID身份系统

- ✅ DID生成和管理
- ✅ Ed25519密钥对生成
- ✅ DID Document存储
- ✅ 设备身份验证
- ✅ 信任链管理

### 3. 端到端加密

- ✅ Signal Protocol集成
- ✅ X3DH密钥交换
- ✅ Double Ratchet算法
- ✅ 消息加密/解密
- ✅ 前向安全保证

### 4. 消息同步基础

- ✅ 消息队列（发送/接收）
- ✅ 离线消息存储
- ✅ 增量同步机制
- ✅ 冲突解决策略

### 5. UI界面

- ✅ 设备列表界面
- ✅ 连接状态指示器
- ✅ DID管理界面
- ✅ 设备配对界面

## 🏗️ 技术栈选型

### P2P网络方案

**方案对比：**

| 方案                   | 优点                | 缺点              | 推荐度     |
| ---------------------- | ------------------- | ----------------- | ---------- |
| libp2p-android         | 完整P2P协议栈       | 依赖重，维护少    | ⭐⭐⭐     |
| WebRTC                 | 成熟稳定，NAT穿透好 | 信令服务器依赖    | ⭐⭐⭐⭐⭐ |
| NSD + Socket           | 简单直接            | 需自行实现NAT穿透 | ⭐⭐⭐⭐   |
| Nearby Connections API | Google官方，易用    | 仅限局域网        | ⭐⭐⭐     |

**最终选择：** **WebRTC + NSD** (Network Service Discovery)

- WebRTC处理复杂的NAT穿透和连接建立
- NSD用于局域网设备发现
- 信令通过自建简单服务器或STUN/TURN

### DID实现

**使用方案：**

- **did:key** 方法（最简单，基于Ed25519公钥）
- **BouncyCastle** 加密库（Ed25519、X25519）
- **Android Keystore** 存储私钥

**DID格式：**

```
did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK
```

### 加密方案

**Signal Protocol：**

- **libsignal-android** (官方库)
- 实现Double Ratchet + X3DH
- 消息级加密，前向安全

**备选方案（如libsignal集成困难）：**

- NaCl/libsodium (sealed boxes + ephemeral keys)
- 自实现简化版Double Ratchet

## 📁 模块结构

```
core-p2p/                          # P2P网络核心模块
├── src/main/java/
│   ├── connection/
│   │   ├── P2PConnectionManager.kt       # 连接管理器
│   │   ├── WebRTCPeerConnection.kt       # WebRTC连接封装
│   │   ├── SignalingClient.kt            # 信令客户端
│   │   └── NATTraversal.kt               # NAT穿透辅助
│   ├── discovery/
│   │   ├── DeviceDiscovery.kt            # 设备发现
│   │   ├── NSDDiscovery.kt               # NSD实现
│   │   └── DiscoveredDevice.kt           # 设备信息模型
│   ├── transport/
│   │   ├── MessageTransport.kt           # 消息传输接口
│   │   ├── DataChannelTransport.kt       # WebRTC DataChannel
│   │   └── MessageProtocol.kt            # 消息协议定义
│   └── sync/
│       ├── SyncManager.kt                # 同步管理器
│       ├── MessageQueue.kt               # 消息队列
│       └── ConflictResolver.kt           # 冲突解决
└── src/test/java/                        # 单元测试

core-did/                          # DID身份模块
├── src/main/java/
│   ├── identity/
│   │   ├── DIDManager.kt                 # DID管理器
│   │   ├── DIDDocument.kt                # DID Document模型
│   │   ├── DIDKeyGenerator.kt            # 密钥生成器
│   │   └── Ed25519KeyPair.kt             # Ed25519密钥对
│   ├── verification/
│   │   ├── VerifiableCredential.kt       # 可验证凭证
│   │   ├── SignatureVerifier.kt          # 签名验证
│   │   └── TrustChain.kt                 # 信任链
│   └── storage/
│       ├── DIDStorage.kt                 # DID存储接口
│       └── RoomDIDDao.kt                 # Room实现
└── src/test/java/

core-e2ee/                         # 端到端加密模块
├── src/main/java/
│   ├── signal/
│   │   ├── SignalProtocolStore.kt        # Signal协议存储
│   │   ├── X3DHKeyExchange.kt            # X3DH密钥交换
│   │   ├── DoubleRatchet.kt              # Double Ratchet
│   │   └── SessionCipher.kt              # 会话加密器
│   ├── crypto/
│   │   ├── MessageEncryptor.kt           # 消息加密器
│   │   ├── KeyManager.kt                 # 密钥管理
│   │   └── PreKeyBundle.kt               # 预共享密钥束
│   └── repository/
│       └── E2EERepository.kt             # 加密仓库
└── src/test/java/

feature-p2p/                       # P2P功能模块
├── src/main/java/
│   ├── domain/model/
│   │   ├── P2PDevice.kt                  # P2P设备模型
│   │   ├── P2PMessage.kt                 # P2P消息模型
│   │   └── ConnectionStatus.kt           # 连接状态枚举
│   ├── data/repository/
│   │   ├── P2PDeviceRepository.kt        # 设备仓库
│   │   └── P2PMessageRepository.kt       # 消息仓库
│   └── presentation/
│       ├── P2PViewModel.kt               # P2P视图模型
│       ├── DeviceListScreen.kt           # 设备列表界面
│       ├── DevicePairingScreen.kt        # 设备配对界面
│       └── DIDManagerScreen.kt           # DID管理界面
└── src/test/java/
```

## 🔧 依赖库

### build.gradle.kts (project level)

```kotlin
// WebRTC
implementation("org.webrtc:google-webrtc:1.0.32006")

// Signal Protocol (端到端加密)
implementation("org.signal:libsignal-android:0.51.0")

// BouncyCastle (加密基础)
implementation("org.bouncycastle:bcprov-jdk18on:1.77")

// Protobuf (消息协议)
implementation("com.google.protobuf:protobuf-javalite:3.25.1")

// 网络发现
// Android原生NSD，无需额外依赖

// STUN/TURN客户端（如需要）
implementation("io.github.crow-misia.libjingle:webrtc-ktx:120.0.0")
```

## 📋 实施步骤

### Week 9 - Day 1-3: P2P网络基础

**Day 1: 模块搭建 + 设备发现**

1. 创建 `core-p2p` 模块
2. 实现 NSD设备发现
3. 定义 P2P设备模型

**Day 2: WebRTC连接管理**

1. 集成 WebRTC Android库
2. 实现 PeerConnection封装
3. 实现信令客户端（简单版）

**Day 3: 消息传输**

1. 定义消息协议（Protobuf）
2. 实现 DataChannel传输
3. 实现消息队列

### Week 9 - Day 4-5: DID身份系统

**Day 4: DID生成和管理**

1. 创建 `core-did` 模块
2. 实现 Ed25519密钥对生成
3. 实现 did:key生成
4. 实现 DID Document存储

**Day 5: 身份验证**

1. 实现签名和验证
2. 实现设备认证流程
3. 实现信任链管理

### Week 10 - Day 1-3: 端到端加密

**Day 1-2: Signal Protocol集成**

1. 创建 `core-e2ee` 模块
2. 集成 libsignal-android
3. 实现 X3DH密钥交换
4. 实现 Double Ratchet

**Day 3: 消息加密**

1. 实现消息加密/解密
2. 实现密钥存储
3. 实现会话管理

### Week 10 - Day 4-5: UI界面 + 测试

**Day 4: UI实现**

1. 创建 `feature-p2p` 模块
2. 实现设备列表界面
3. 实现设备配对界面
4. 实现DID管理界面

**Day 5: 集成测试**

1. 编写单元测试
2. 编写集成测试
3. 双设备连接测试
4. 文档更新

## 🎯 验收标准

### 功能验收

- [ ] 两台设备能在局域网内自动发现
- [ ] 设备能成功建立P2P连接
- [ ] 能发送和接收加密消息
- [ ] DID能正确生成和验证
- [ ] 离线消息能在连接后同步
- [ ] NAT穿透在不同网络环境下工作

### 性能指标

- [ ] 设备发现延迟 < 5秒
- [ ] 连接建立时间 < 10秒
- [ ] 消息端到端延迟 < 100ms
- [ ] 加密/解密性能 > 1000 msg/s

### 安全要求

- [ ] 所有消息端到端加密
- [ ] 私钥存储在Android Keystore
- [ ] 实现前向安全（Forward Secrecy）
- [ ] 通过中间人攻击测试

## 📊 风险评估

| 风险                      | 概率 | 影响 | 缓解措施                     |
| ------------------------- | ---- | ---- | ---------------------------- |
| WebRTC集成复杂            | 高   | 高   | 使用成熟封装库，参考官方示例 |
| NAT穿透失败率高           | 中   | 高   | 部署TURN服务器作为备选       |
| Signal Protocol学习曲线陡 | 中   | 中   | 先实现简化版，后续优化       |
| 多设备同步冲突            | 低   | 中   | 使用CRDT或Last-Write-Wins    |

## 📚 参考资源

### WebRTC

- [WebRTC Android官方文档](https://webrtc.github.io/webrtc-org/native-code/android/)
- [WebRTC Samples](https://github.com/webrtc/samples)

### DID

- [W3C DID Specification](https://www.w3.org/TR/did-core/)
- [did:key Method Spec](https://w3c-ccg.github.io/did-method-key/)

### Signal Protocol

- [Signal Protocol Specification](https://signal.org/docs/)
- [libsignal-android](https://github.com/signalapp/libsignal)

### Android NSD

- [Network Service Discovery Guide](https://developer.android.com/develop/connectivity/nsd)

---

**准备开始**: 2026-01-19
**预计完成**: Week 10 结束
**下一阶段**: Phase 6 - 知识库同步 + 社交功能
