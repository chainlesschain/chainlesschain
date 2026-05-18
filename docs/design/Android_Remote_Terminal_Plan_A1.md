# Android 远程终端 — Plan A.1（WebRTC DataChannel 直连）设计文档

> 状态：✅ Phase 1-5 全部落地（2026-05-14；真机 e2e 由用户验，§5.3 矩阵）
> 关联：[Plan A](Android_Remote_Terminal_Plan_A.md) / [Plan AB 基础设施](Android_Remote_Operate_Plan_AB.md) / [Plan C 信令转发](Android_Remote_Operate_Plan_C.md)
> 前置：Plan A v5.0.3.52 已落（PtyManager + WS topics + 三壳 UI + Android UI），signaling 转发路径在真机测试暴露 4+1 个 bug

## 1. 背景 — 为什么需要 A.1

Plan A v5.0.3.52 把 terminal 命令通道架在 #21 Remote Operate 的 **signaling 转发路径**上（Android WS → 桌面 signaling-server / 公网中继 → 桌面 mobile-bridge → PtyManager）。真机 e2e 验证（Xiaomi 24115RA8EC，2026-05-14）暴露了**链路级 reliability 问题**：

### 1.1 今日发现的 Plan A 链路 bug 列表

| # | 现象 | 根因 | 状态 |
|---|---|---|---|
| 1 | APK 中文显示乱码（终端会话 → 缁堢...） | `kotlin.daemon.jvmargs` 缺 `-Dfile.encoding=UTF-8`，Windows 默认 GBK 读 UTF-8 源 | ✅ 已修 (gradle.properties + compileOptions.encoding) |
| 2 | 每次 invoke 创建新 `mobile-${ts}` peerId，server stale cleanup 误杀 active peer | `WebSocketPairingSignalingGate.sendAck` fallback 用 `currentTimeMillis()` 而不是已 register 的 DID | ✅ 已修（复用 registeredPeerId） |
| 3 | OkHttp pingInterval(20s) 太短，桌面端处理慢命令（system.getInfo ~3s）期间 WS 因 ping/pong 超时被杀 | NetworkModule.kt `.pingInterval(20, SECONDS)` 过紧 | ✅ 已修（拉到 60s） |
| 4 | WS reconnect 后不自动重发 register，server 上新 socket 没 peerId 绑定，response forward 时 from=unknown / to=undefined → 命令进黑洞 | WebSocketSignalClient.onOpen 没保存 + 自动重发上次 register | ✅ 已修（onOpen 加 auto re-register） |
| 5 | **网络层 NAT idle / cell carrier 间歇杀 TCP 连接，4 跳链路（手机→路由器→中继→桌面RelayClient）任一跳断即整体失败** | 长链路 fragile chain，应用层无法根治 | ❌ **本文要解决** |

bug 1-4 修完后基础链路稳定性显著改善，但 5 是**架构性问题**——signaling 路径长度=4，每跳都可能 TCP RST。Plan A.1 的目标：**把高频高吞吐流量从 signaling 链路切到 WebRTC DataChannel 直连**，绕开中间所有跳。

### 1.2 现有架构关键 trap（动手前必看）

#### Trap 1 — `setOnForwardedMessageReceived` 是单 listener，后写覆盖前写

`SignalClient.setOnForwardedMessageReceived(callback)` 是 **set**（不是 add）。当前代码中**两处都在调它**：

- `WebRTCClient.initialize()` (WebRTCClient.kt:170-183) — 装回调拦 `chainlesschain:ice:config` 持久化 iceServers + 转发到 `_messages` SharedFlow
- `TerminalRpcClient.start()` (TerminalRpcClient.kt:79) — 装回调挑 `chainlesschain:event` 里的 `terminal.stdout / .exit` emit 到 `_stdout / _exit` SharedFlow

谁后调谁赢。当前实际顺序（Hilt 注入 → init 顺序）是 `WebRTCClient.initialize()` 先 → 用户进 TerminalListScreen 后 `TerminalRpcClient.start()` 覆盖 → **ice:config 拦截器被悄无声息地踢掉**，桌面后续 push 新 TURN 凭证手机不会持久化，iceExpiry 到期后跨 NAT 不通。

Plan A.1 必须**先治这个 trap**：把 `setOnForwardedMessageReceived` 改成 **多订阅** 的 SharedFlow 模型，或者让 TerminalRpcClient 改听 `WebRTCClient.messages: SharedFlow<String>`（已存在，WebRTCClient.kt:147）而不是覆盖回调。后者侵入更小，推荐。

#### Trap 2 — DC 入向 message 走 `webRTCClient.setOnMessageReceived`，与 signaling forward 是两条独立路径

WebRTC DataChannel 的 `onMessage`（WebRTCClient.kt:387-399）和 signaling 的 `onForwardedMessage` 路由到**不同 SharedFlow**：
- DC 入：`_messages` (WebRTCClient.kt:147)
- Signaling 入：经 `onForwardedMessageCallback` 处理（不进 `_messages`，除非 callback 主动 emit）

Plan A.1 上线后，桌面 `sendToMobile` 已经优先 DC（mobile-bridge.js:957），所以稳态 stdout 是经 DC 进 `_messages`。**TerminalRpcClient 必须同时订阅这两条流**（或者订阅统一后的 `_messages`，前提是 Trap 1 已治）。

#### Trap 3 — `P2PClient.sendCommand` 已是 DC-only，但有自己的 envelope 协议

`P2PClient.sendCommandInternal`（P2PClient.kt:438-480）走 `webRTCClient.sendMessage`，已经 DC-only。但它的 wire format 是 `P2PMessage(type, payload)` + 自定义 `CommandRequest/Response`，**与 TerminalRpcClient 经 signaling 用的 envelope (`{type:"chainlesschain:command:request", payload:{id, method, params, auth}}`) 不兼容**。

Plan A.1 不能简单"把 TerminalRpcClient 切到 P2PClient.sendCommand"——会破协议对称性（desktop side handler 按 envelope.type 分发）。正确路径是：TerminalRpcClient 自己挑 transport（DC vs signaling），两边都发**同一 envelope 格式**到对应 transport。

### 1.3 现有 WebRTC 基建（已落地，含状态机精确语义）

✅ Android 端 `WebRTCClient.kt`（`@Singleton`，Hilt 注入）：
- `connect(pcPeerId, localPeerId)` (L192) — 5 步 handshake：signaling connect → register → createPeerConnection + createDataChannel → createOffer → waitForAnswer
- `sendMessage(message: String)` (L456) — 直接 DC 发，DC 非 OPEN 时抛 `IllegalStateException("Data channel not open")`
- `connectionState: StateFlow<P2PConnectionState>` (L143-144) — 8 态。**关键语义**：`P2PConnectionState.READY` 才意味 DC `DataChannel.State.OPEN`（在 `setupDataChannel.onStateChange` 设置，L383）；`DATA_CHANNEL_OPEN` 字面虽含 "OPEN" **只是 ICE 通了**（L314 在 IceConnectionState.CONNECTED 时设），DC 未必 open。所以判 DC 可用的正确谓词是 `connectionState.value == READY`，不是 DATA_CHANNEL_OPEN
- `messages: SharedFlow<String>` (L147) — DC 入站（L395 `_messages.tryEmit`）和 signaling forward 入站（L182 `_messages.tryEmit`）**都会 emit 到这**，多订阅安全，是 Plan A.1 的统一入口候选

✅ Android 端 `P2PClient.kt`（`@Singleton` 包装层）：
- `connect(pcPeerId, pcDID): Result<Unit>` (L140) — 业务入口，自带指数退避自动重连（maxAttempts=10，base 1s/cap 60s/factor 2.0）+ 心跳（30s 间隔，90s 超时）
- `connectionState: StateFlow<ConnectionState>` — 业务粗粒度 (DISCONNECTED/CONNECTING/CONNECTED/RECONNECTING/ERROR)
- `sendCommand` (L367, L399) — DC-only，但用 `P2PMessage(type, payload)` + `CommandRequest/Response` 协议，**与 TerminalRpc envelope 不通**（见 Trap 3）

✅ Android 端 `RemoteConnectionManager.kt`：业务入口（UI 调它 → P2PClient.connect）

✅ 桌面端 `mobile-bridge.js`：
- `sendToMobile(mobilePeerId, message)` (L930) — **优先 DC**（接受 "open"/"Open"/1/"OPEN" 多形 readyState，werift 兼容），未 ready 时 **LAN signaling + 公网中继双发**（L957-986）。**注意已是双发兜底**（不是单发），Plan A.1 设计去重时要算进这条
- `dataChannels: Map<mobilePeerId, RTCDataChannel>` 状态表
- `handleOffer / handleAnswer / handleICECandidate / handleP2PMessage` 接 WebRTC 信令帧

✅ 公网基建：
- `wss://signaling.chainlesschain.com` 转发 offer/answer/ice-candidate（LAN unreachable 时备份）
- coturn `turn.chainlesschain.com:3478/5349` NAT 穿透
- iceServers 24h TTL，`desktop-pair-handlers.signIceCredentials` 签发，pair-ack 后 push `chainlesschain:ice:config`（Trap 1 风险点）

### 1.4 缺什么

❌ **TerminalRpcClient 写死走 signaling**——`SignalingRpcClient.invoke()` 内部 `signalingGate.sendAck()` → `signalClient.sendForwardedMessage()` 调用链全在 signaling 层，没有 DC 分支判断

❌ **没有触发 DC handshake 的入口**——`RemoteConnectionManager.connect` 存在但没被 terminal flow 调用，所以 DC 永远是 NOT_READY 状态，桌面 sendToMobile 永远走 signaling fallback

❌ **没有 DC 双向消息处理**——Android 端没 `onDataChannelMessage` listener 把 incoming `chainlesschain:event` (terminal.stdout) 路由进 `TerminalRpcClient._stdout`

❌ **DC 断开后没 fallback / 自动重建**——一旦 DC 死了没有 graceful degradation

## 2. 数据流改造

### 2.1 改造前（Plan A 当前）

```
Android                          Signaling Path (4 hops)             Desktop
                                                                     
TerminalRpcClient                                                    
  → SignalingRpcClient.invoke                                        
    → signalingGate.sendAck                                          
      → signalClient.sendForwardedMessage  ──┐                       
                                              ▼                       
                                    [router NAT]                     
                                              ▼                       
                                    [wss://signaling.cc.com]         
                                              ▼                       
                                    [桌面 RelayClient]               
                                              ▼                       
                                    mobile-bridge.bridgeToLibp2p     
                                              ▼                       
                                    handleMobileCommand              
                                              ▼                       
                                    handleTerminalCommand            
                                              ▼                       
                                    PtyManager.create/list/...        
                                              ▼                       
                                    sendToMobile                     
                                      ├─ DataChannel? (NO, 跳过)     
                                      └─ signaling forward 兜底     
                                              ▼ (同 4 跳反向)         
SignalingRpcClient ← onForwardedMessage ← signal pull               
  ← terminalRpc.observeStdout                                        
```

### 2.2 改造后（Plan A.1）

```
Android                          WebRTC DataChannel (1 跳直连)     Desktop
                                                                     
TerminalRpcClient                                                    
  ├─ dcTransport (优先)                                              
  │   └─ dataChannel.send(envelope)  ────────────────────────────►   
  │                                                                  channel.onmessage
  │                                                                    ↓
  │                                                                  handleMobileCommand
  │                                                                    ↓
  │                                                                  handleTerminalCommand
  │                                                                    ↓
  │                                                                  PtyManager
  │                                                                    ↓
  │                                                                  sendToMobile
  │                                                                    └─ DataChannel? (YES)
  │                                                                       ↓
  │                                                                       channel.send (1 跳反向)
  ◄─────────────────────────────────────────────────────────────────────
  │   ← DataChannel.onMessage
  │   ← 路由进 _stdout/_exit/_response
  │                                                                  
  └─ signalingFallback (DC 不通时)                                   
      └─ SignalingRpcClient.invoke (原路径)                          
```

**关键变化**：稳态下 0 中间跳。中继 + NAT + 路由器 NAT idle timeout 全部绕开。

### 2.3 性能预期

| 指标 | Plan A (signaling) | Plan A.1 (DataChannel) |
|---|---|---|
| 端到端 RTT p50 | 200-500ms | 30-80ms (LAN) / 50-200ms (TURN relay) |
| RTT p99 | 1500-30000ms (timeout 频发) | 200-800ms |
| 持续连接稳定性 | 20s-2min 间歇断 | 数小时持续（依赖 ICE keepalive）|
| stdout 吞吐 | 中继带宽共享，~100KB/s 拥塞 | 仅受 NAT/网络限制，~1MB/s 单流可达 |

## 3. 关键设计决策

### 3.1 何时触发 DC handshake

**选 A：用户进 TerminalListScreen 即触发**
- 优点：UX 自然，进终端页就建好
- 缺点：用户只点 ping 也建 DC，资源浪费
- ❌ 不选

**选 B：第一次 `terminal.create` 时同步建**
- 优点：按需，避免无用 handshake
- 缺点：首次 create 延迟 +1-3s（DC 握手时间）
- ⚠️ 备选

**选 C（推荐）：进远程操控页就 lazy 触发 + 在 handshake 期间命令走 signaling 兜底**
- 优点：DC 建立的同时不阻塞用户操作，DC 一好就自然切换
- 缺点：实现复杂一点（双路径状态机）
- ✅ 选

### 3.2 命令路由策略

正确谓词应基于 `WebRTCClient.connectionState`（不是 P2PClient.connectionState — 后者粗粒度，CONNECTED 时 DC 可能还在 ICE 阶段没 OPEN）：

```kotlin
// in TerminalRpcClient (or a new TransportSelector)
private fun isDcReady(): Boolean =
    webRTCClient.connectionState.value == P2PConnectionState.READY
        && featureFlag.preferDataChannel

suspend fun invoke(
    pcPeerId: String,
    method: String,
    params: Map<String, Any?>,
): Result<JSONObject> {
    val envelope = buildEnvelope(method, params)   // 同 SignalingRpcClient 用的 envelope
    if (isDcReady()) {
        val dcResult = sendViaDc(envelope, timeoutMs = 5_000)  // 注册 pending[reqId] + dc.send
        if (dcResult.isSuccess) return dcResult
        Timber.w("[TerminalRpc] DC path failed, fallback signaling: ${dcResult.exceptionOrNull()?.message}")
        // 落到下面 signaling 路径
    }
    return rpc.invoke(pcPeerId, method, params)  // 现有路径，envelope 完全一样
}
```

**关键**：DC 路径和 signaling 路径用**同一 envelope 格式 + 同一 requestId 池**（pendingDeferred 共享），所以无论响应从哪条路回都能匹配到同一 Deferred。

**幂等性**：v0.1 单发（DC 通就只走 DC），不会重复。**但 desktop sendToMobile 现有就是 LAN+relay 双发兜底**（mobile-bridge.js:957-986），所以**反向响应 stream 上原本就要做去重**——见 Phase 4。

### 3.3 stdout/exit push 路由

桌面端 `_subscribeMobileToSession` 用 `sendToMobile`，已经优先 DC。所以**只要 DC 是 open 状态，stdout 自然走 DC**。

Android 端需要新增 DataChannel onMessage listener：
```kotlin
dataChannel.observeMessages().collect { rawMsg ->
    val msg = JSONObject(rawMsg)
    when (msg.optString("type")) {
        "chainlesschain:command:response" -> 路由到 pending[rid]
        "chainlesschain:event" -> 按 event 名分发到 _stdout / _exit
    }
}
```

### 3.4 DC 断开 fallback

触发条件 — **覆盖三个状态**（不只是 FAILED）：
- `WebRTCClient.connectionState.value` ∈ {FAILED, DISCONNECTED}（PeerConnection / ICE 层）
- `DataChannel.state()` ∈ {CLOSING, CLOSED}（DC 层，独立于 PeerConnection）
- `sendViaDc` 抛 `IllegalStateException` 或超时

降级行为：
- 单次失败 → 即刻 fallback signaling（同 requestId，pendingDeferred 复用）
- **不在 TerminalRpcClient 重写重连**——直接复用 `P2PClient.scheduleReconnect`（P2PClient.kt:242，指数退避 1s→60s，maxAttempts=10）。Plan A.1 只暴露一个 `onDcLost()` 钩子触发 P2PClient 进入 RECONNECTING 状态
- DC 恢复（`connectionState` 再次 READY）→ 路由器自动切回 DC（下次 invoke 时 isDcReady() 检查通过即可，无显式切换动作）

### 3.5 双发去重（v0.1 范围）

**v0.1 Android 出向不双发**（DC 通就只走 DC）。但 **desktop → mobile 反向已经在双发**——mobile-bridge.js:957-986 当 DC 未 ready 时同时 LAN signaling + 公网中继发，二者目的地可能都是同一个 mobile（手机如果两处都连）。所以 Android 端必须做**反向去重**：

```kotlin
// in TerminalRpcClient or where _messages 被 collect
private val seenResponseIds = LruCache<String, Boolean>(128)  // ~30s TTL by replace

// 收到 chainlesschain:command:response 时
val responseId = payload.optString("id")
if (seenResponseIds.put(responseId, true) != null) {
    Timber.d("[TerminalRpc] duplicate response $responseId, ignoring")
    return
}
// 否则 emit 到 pendingDeferred[responseId]
```

push 事件（`chainlesschain:event` terminal.stdout/exit）也同理，按 `(sessionId, seq)` 二元组去重。

**v0.1 desktop 入向去重**：mobile-bridge.js `handleMobileCommand` 加 LRU(128, 30s)，按 `payload.id` 去重。即使 Android 不双发，也防止"未来某场景双发"或"网络重传"造成的桌面 PtyManager 误处理（例如同一 stdin 被执行两次）。这是 robust default，不是 over-engineering。

**双发出向**留作 v0.2 hardening（DC 测试出"DC send 成功但桌面没收到"的边缘 case 时再上）。

### 3.6 Feature flag 位置

Plan A.1 **必须挂 flag**——首批发版回滚成本低于回滚 APK。

| Key | 默认 | 位置 |
|---|---|---|
| `terminal.preferDataChannel` | `true` (v5.0.3.53+) | Android: `SharedPreferences("plan_a1_flags")` + 桌面 `.chainlesschain/config.json` 镜像 |
| `terminal.dcSendTimeoutMs` | `5000` | 同上 |
| `terminal.fallbackOnDcFailure` | `true` | 同上（false = DC 死直接报错给用户，便于诊断） |

Android 端 Hilt 注入 `Plan A1FeatureFlags` provider 读 SharedPreferences；桌面用 `unified-config-manager.js` `terminal.*` 子节点。两端独立可配，**调试时 Android 改 flag 不需要桌面同步**（Android 决定从哪发，桌面只是接收者）。

### 3.7 与 Phase3d `core-p2p:DataChannelTransport` 的关系

Phase3d Mobile Sync 已有 `core-p2p/transport/DataChannelTransport.kt`（256KB 分片 + 1MB/256KB 高低水位线 + 背压超时 30s），但**那一份是为 sync 二进制 P2PMessage 设计**，与 terminal 的 envelope JSON 协议不通。

**决定不复用**——理由：
1. 分片机制 terminal 不需要（单 envelope < 64KB，stdout chunk 桌面侧已分片）
2. 背压窗口 terminal 不适用（terminal 是 RPC 式 req/res，不是 streaming push）
3. `core-p2p:DataChannelTransport` 跑在 P2PClient 内 wraps `webRTCClient.sendMessage`，复用反而要解 P2PMessage envelope 双重包装

**做法**：Plan A.1 在 `app/.../remote/terminal/` 内部直接调 `webRTCClient.sendMessage` + 监听 `webRTCClient.messages` SharedFlow。**不抽 DataChannelTransport 类**，原 doc 的 Phase 1 改名 Phase 1 "DC 状态暴露 + Trap 1 修复"（见下）。

## 4. Phase 划分

### Phase 1 — Trap 1 修复 + DC 路由 helper

不抽 DataChannelTransport（见 §3.7）。本 Phase 干两件事：

**A. 修 Trap 1**（单 listener 覆盖 ice:config bug）

`SignalClient` 接口扩展为多订阅模式，或更小侵入：把 `WebRTCClient.initialize` 和 `TerminalRpcClient.start` 都改成订阅 `webRTCClient.messages: SharedFlow<String>`（已存在，L147）而不是 `signalClient.setOnForwardedMessageReceived`。

具体：
- `WebRTCClient.initialize`：`signalClient.setOnForwardedMessageReceived` 内部已 `_messages.tryEmit(message)`（L182），ice:config 拦截逻辑前置到这里，**不改成 set callback override**——保持现状但加一句注释 "Plan A.1 之后此 callback 是 ice:config-only"
- `TerminalRpcClient.start`：删 `signalClient.setOnForwardedMessageReceived` 调用，改 `scope.launch { webRTCClient.messages.collect { handleForwarded(it) } }`

**验证**：
- 测试 `TerminalRpcClient.start` 不再覆盖 ice:config 拦截器
- 真机测试桌面 push 一次 ice:config 仍能持久化到 PairedDesktopsStore

**B. DC 状态 helper**

`WebRTCClient.kt` 加一个 derived flag：
```kotlin
val dataChannelReady: StateFlow<Boolean> =
    connectionState.map { it == P2PConnectionState.READY }
        .stateIn(scope, SharingStarted.Eagerly, false)
```

UI 直接订阅 `dataChannelReady` 渲染 "P2P 直连/中继" 标识。

**验证**：单元测试 state 流转 + UI 显示状态

### Phase 2 — `TerminalRpcClient` 双路径 routing

修改 `TerminalRpcClient.create/list/stdin/...`：

```kotlin
suspend fun create(pcPeerId: String, shell: String): Result<CreatedSession> {
    val params = buildMap<String, Any?> { ... }
    val envelope = buildEnvelope("terminal.create", params)
    
    return if (dcTransport.state.value == DcState.OPEN) {
        sendViaDc(envelope, timeoutMs = 5_000)
            .recoverCatching {
                Timber.w("DC fail, fallback signaling: $it")
                rpc.invoke(pcPeerId, "terminal.create", params).getOrThrow()
            }
    } else {
        rpc.invoke(pcPeerId, "terminal.create", params)
    }.map { json -> CreatedSession(...) }
}
```

**验证**：mock DC 测试 + 真实 DC 端到端

### Phase 3 — Android handshake 触发 + stdout/exit DC listener

修改 `TerminalListViewModel.init` 或 `RemoteOperateViewModel.init`：
- 检测当前 DC 状态
- 若 NOT_READY，调 `remoteConnectionManager.connect(pcPeerId, pcDID)` 异步触发握手
- UI 显示握手状态："正在建立 P2P 直连..."

同时 `TerminalRpcClient.start()` 安装 DC onMessage listener（与 signaling listener 并行，两边都监听同名事件）。

**验证**：手动测试握手时机 + stdout 推送计时

### Phase 4 — 反向去重 + sendToMobile 路径收紧

桌面 mobile-bridge.js:
- 增 LRU dedupe (`recentRequests` 128 entries / 30s TTL) 在 `handleMobileCommand` 入口，按 `payload.id`
- **保留** DC 未 ready 时 LAN signaling + 公网中继双发兜底（L957-986 既有逻辑）——这是稳定性兜底，不是 bug。但 DC 已 open 时**只发 DC** 不再兜底，避免一次响应到达两次

Android 端：
- `TerminalRpcClient` 收响应 / event 时按 `(responseId)` / `(sessionId, seq)` 反向去重（§3.5 已述）

**验证**：
- 双路径压测：mock DC + signaling 两路同时收同一 responseId，pendingDeferred 只完成一次
- 真机抓 packet（adb tcpdump）确认 DC open 时 sendToMobile 走单路径

### Phase 5 — DC 断开 fallback + 自动重建（无新代码 — Phase 2 + P2PClient 既有 wiring 组合）

实施反思：Phase 5 设计目标在前 4 个 Phase 完成时已经成立，**不需要新代码**：

- **DC 失效 fallback**：Phase 2 `trySendViaDataChannel`（SignalingRpcClient.kt）在 DC 抛 `IllegalStateException("Data channel not open")` 或 isDcReady=false 时返 false，caller 自动走 signaling 路径。Phase 2 测试 `Plan A1 — DC sendMessage throws falls back to signaling` 直接覆盖。
- **自动重建**：`P2PClient.handleDisconnection` (P2PClient.kt:222) 监听 `webRTCClient.setOnDisconnected`，DC 死 → 调 `scheduleReconnect` (P2PClient.kt:242) 指数退避（base 1s / cap 60s / factor 2.0 / maxAttempts 10）。已存在，Plan A.1 piggy-back。
- **DC 恢复后自动切回**：`isDcReady()` (SignalingRpcClient.kt) 在每次 `invoke()` 入口重新读 `webRTCClient.connectionState.value`。READY 即用 DC，否则 signaling。无显式 "切回" 动作。
- **UI banner**：Phase 3 已加 — `dataChannelReady` StateFlow 驱动 TerminalListScreen chip 颜色（green=DC, yellow=relay），是同一概念的实时映射，不需要额外 banner。

**测试**：Phase 2 + Phase 4 测试矩阵已 cover；真机 e2e 跑 §5.3 step 4-5 验证 fallback / 恢复时序。

## 5. 测试

### 5.1 单元测试

- `TerminalRpcClient` 双路径选择测试（覆盖 4 种组合：DC open + flag on / DC open + flag off / DC closed / DC send fails 抛 IllegalStateException）
- `webRTCClient.dataChannelReady: StateFlow<Boolean>` derived flow 测试（READY → true，其它 7 态 → false）
- Android 端 LRU dedupe 单元测（同 id 二次入 emit 一次）
- desktop `mobile-bridge.js` handleMobileCommand LRU dedupe 单元测
- **Trap 1 回归测试**：`TerminalRpcClient.start()` 调用后桌面 push ice:config 仍能被 `WebRTCClient.persistIceConfigMessage` 处理（断言 PairedDesktopsStore.upsert 被调用）

### 5.2 集成测试

- mock signaling + mock DC，模拟"DC 握手成功"→"命令走 DC"→"DC 断"→"fallback 信令"全流程
- mock 一组完整 terminal.create / stdin / stdout 来回

### 5.3 真机 e2e

- Xiaomi 24115RA8EC（已有 device）
- 桌面 Windows + ChainlessChain dev 模式
- 场景：
  1. LAN 同 WiFi — DC 应秒级握手成功
  2. 蜂窝网 + LAN 桌面 — TURN relay 路径
  3. 双 NAT (3G symmetric) — 应 fallback 到 signaling
  4. DC 工作中模拟 DC 失效（**不是杀 WS**——WS 是 signaling，反过来会让信令也死）：在 WebRTCClient 暴露 debug 方法 `simulateDataChannelFailure()` 或 adb 直接 disable WebRTC UDP 端口段 → 期望 `connectionState` 进 FAILED → fallback signaling 接管 ≤ 3s
  5. DC 恢复后（重启 WiFi / 重 adb enable port）— 期望 isDcReady() 复检通过，下一 invoke 自然走 DC

## 6. 已知风险

| 风险 | 缓解 |
|---|---|
| **WebRTC DC 在某些 ISP 下完全建不起来**（双方都对称 NAT 且 TURN 也跨墙）| Plan A 信令路径保留作兜底 |
| **TURN 流量计费**（coturn 自部署，但流量经服务器中转）| 桌面端 systray 显示流量统计；超过阈值警告 |
| **DC handshake 失败诊断难**（ICE 状态在 SDK 内部）| Phase 1 暴露详细 stateFlow + WebRTC stats |
| **WS reconnect 期间 DC 握手卡死**（信令在握手期不能 idle）| 握手阶段强制 keep WS alive，握手完才允许 idle |
| **桌面 PtyManager 资源泄漏**（DC 断 → 信令 → DC 重建过程中 session 累积）| Phase 4 桌面 dedupe + session GC 检查 |

## 7. 与现有 Plan 的关系

| Plan | 角色 | 状态 |
|---|---|---|
| Plan C | 单条低频命令走信令转发 | ✅ v5.0.3.50 |
| Plan A+B 基础设施 | 信令服务器 + coturn STUN/TURN 部署 | ✅ v5.0.3.51 |
| Plan A | PtyManager + 三壳 UI + 信令路径 terminal | ✅ v5.0.3.52（4 bug 已修） |
| **Plan A.1** | **terminal 流量切 DataChannel** | 📝 **本文** |
| Future B | 已开外部终端只读快照（屏幕截图+OCR+SendInput） | 📝 未开始 |

## 8. 估算

| Phase | 工程量 | 建议 |
|---|---|---|
| Phase 1 Trap 1 修复 + DC 状态 helper | 0.5d | 独立 PR（含 ice:config 回归测试） |
| Phase 2 双路径 routing + envelope 共享 pendingDeferred | 0.5d | 独立 PR |
| Phase 3 触发 + DC listener + UI 状态显示 | 1.0d | 独立 PR（**含真机 e2e**，按 W3.7 pattern 估实） |
| Phase 4 双向去重（Android + desktop LRU） | 0.5d | 独立 PR |
| Phase 5 fallback + 复用 P2PClient 重连 | 0.5d | 独立 PR + 联调测试 |
| **合计** | **~3.0 天聚焦工作** | 5 PR 渐进交付 |

## 9. 验收标准

- [ ] LAN 同 WiFi 场景：DC 握手 ≤ 2s，terminal.create RTT ≤ 200ms
- [ ] 蜂窝网场景：TURN 路径建立 ≤ 5s，RTT ≤ 500ms
- [ ] 持续 30 分钟 stdout 流式输出（`watch -n 0.5 date`）无中断
- [ ] DC 故意失效（见 §5.3 step 4）后 fallback 信令延迟 ≤ 3s，UI 显式 "中继路径"
- [ ] DC 恢复后自动切回，UI 显式 "P2P 直连"
- [ ] 桌面 PtyManager 无 session 泄漏（24h 跑 100 次握手循环）
- [ ] **Trap 1 回归**：100 次进退 TerminalListScreen 后桌面仍能 push ice:config 让 Android 持久化 iceServers（grep logcat `[WebRTCClient] ✓ iceServers persisted` 必出现）
- [ ] **telemetry**：埋点 `[TerminalRpc.metric] path=dc|signaling reqId=...`，发版后第一周 fast path 占比 > 80%（用户基数 ≥10 设备）。低于 80% 说明 DC 不通比预想多，需诊断

## 10. 相关 commits / memory

实施 commits（2026-05-14 一日完成 Phase 1-5）：
- `aee5f1d8f` fix(remote-terminal): 4 bug fixes uncovered by Plan A real-device e2e（§1.1 bug 1-4）
- `d22b7ac8a` feat(remote-terminal): Plan A.1 Phase 1 prep — dataChannelReady + forwardedMessages multi-subscribe（WebRTCClient + SignalingRpcClient 主体改造）
- `bb759bc78` feat(remote-terminal): Plan A.1 Phase 1 close — multi-subscribe migration + Trap 1 regression test（TerminalRpc 迁移 + 双 client 测试 + WebRTCClientTest 修 pre-existing pairedDesktopsStore 缺参）
- `a01eeac47` feat(remote-terminal): Plan A.1 Phase 2 — DC fast path + dual-listener pending pool（SignalingRpcClient.invoke 接 DC fast path + 反向双 listener；4 个 transport-selection 测试）
- `91e77e489` feat(remote-terminal): Plan A.1 Phase 3 — trigger DC handshake on TerminalListScreen entry + UI path indicator（TerminalListViewModel + Screen chip）
- `dd9b1227e` feat(remote-terminal): Plan A.1 Phase 4 (Android) — dual-listener push events + LRU dedup（TerminalRpc 双订 + (sessionId, seq) 去重；3 dedup 测试）
- `fc3752360` feat(remote-terminal): Plan A.1 Phase 4 (desktop) — mobile-bridge LRU dedup for command requests（bridgeToLibp2p reqId LRU 128/30s）

历史背景：
- [Plan A 设计文档](Android_Remote_Terminal_Plan_A.md) §1-3（terminal Plan A 全套）
- WebRTC 现有基建：memory `signaling_relay_and_turn_deploy.md` + `android_remote_operate_plan_c_first.md`
- 配对 + DC handshake 路径：memory `desktop_qr_pairing_flow_b.md`

---

**版本历史**

| 版本 | 日期 | 说明 |
|---|---|---|
| v0.1 | 2026-05-14 | 设计调研初稿，含 Plan A 真机 e2e 发现的 4+1 bug 列表，5 phase 划分待评审 |
| v0.2 | 2026-05-14 | 对齐真实代码后第二轮：(1) 加 §1.2 三个现有架构 trap（含 setOnForwardedMessageReceived 单 listener bug），(2) §3.2 谓词改用 WebRTCClient.connectionState==READY（更精确），(3) §3.4 fallback 状态覆盖 PeerConnection+DC 双层 + 复用 P2PClient 重连，(4) §3.5 反向去重才是必需（出向单发），(5) §3.6 feature flag 落点，(6) §3.7 不复用 :core-p2p DataChannelTransport 的决定，(7) Phase 1 改为治 Trap 1 + 暴露 dataChannelReady helper，(8) Phase 3 估算 0.5→1.0d 含真机，(9) §5.3 step 4 改"模拟 DC 失效"非"杀 WS"，(10) §9 加 Trap 1 回归 + path=dc/signaling telemetry 验收。 |
| v1.0 | 2026-05-14 | Phase 1-5 全部 land（7 commits 一日完成）。设计在落地过程中两处偏离 v0.2：(a) Phase 1 没等真"加 derived dataChannelReady"才发 Phase 2，并行 session `d22b7ac8a` 同时把 dataChannelReady + forwardedMessages SharedFlow 都加了，本会话 close 收 listener migration + Trap 1 回归测试；(b) Phase 5 实施反思发现 fallback + 重建已是 Phase 2 + P2PClient 既有 wiring 的免费副产物，零新代码。其余按 v0.2 跑通。真机 e2e §5.3 矩阵移交用户。 |
