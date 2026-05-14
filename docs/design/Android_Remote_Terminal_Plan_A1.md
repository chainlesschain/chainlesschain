# Android 远程终端 — Plan A.1（WebRTC DataChannel 直连）设计文档

> 状态：📝 设计调研中（2026-05-14）
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

### 1.3 现有 WebRTC 基建（已落地）

✅ Android 端：
- `app/.../remote/webrtc/WebRTCClient.kt:192` `connect(pcPeerId, localPeerId)` — 5 步 WebRTC handshake (signaling connect → register → createPeerConnection + createDataChannel → createOffer → waitForAnswer)
- `app/.../remote/p2p/P2PClient.kt` — 包装 WebRTCClient 暴露 `connectionState` Flow
- `app/.../remote/RemoteConnectionManager.kt:88` `connect(pcPeerId, pcDID)` — 业务层入口

✅ 桌面端：
- `desktop-app-vue/src/main/p2p/mobile-bridge.js:930` `sendToMobile(mobilePeerId, message)` — **已经优先 DataChannel**，DC 未 ready 才 fallback signaling forward
- `dataChannels: Map<mobilePeerId, RTCDataChannel>` 状态管理
- handleOffer / handleAnswer / handleICECandidate / handleP2PMessage 接 WebRTC 信令帧

✅ 公网中继：
- `wss://signaling.chainlesschain.com` 转发 offer/answer/ice-candidate（含 LAN unreachable 时 fallback）
- coturn `turn.chainlesschain.com:3478/5349` NAT 穿透

### 1.3 缺什么

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

```kotlin
suspend fun invoke(method: String, params: Map<String, Any?>): Result<JSONObject> {
    val dc = dcTransport.currentDataChannel  // null if not ready
    if (dc != null && dc.state == OPEN && featureFlag.useDcForTerminal) {
        // Fast path: DC
        val result = sendViaDc(dc, envelope, timeoutMs = 5_000)
        if (result.isSuccess) return result
        Timber.w("DC send failed, falling back to signaling")
        // fallthrough
    }
    // Slow path: signaling (existing)
    return signalingRpcClient.invoke(pcPeerId, method, params)
}
```

**幂等性**：requestId 是 UUID。DC 和 signaling 双发不会重复处理（desktop 用 requestId 去重）。

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

- DC 死 → 临时全部 fallback 到 signaling
- 后台尝试 reconnect DC（3 次指数退避）
- DC 恢复 → 切回 DC

### 3.5 双发去重

如果 Android 同时走 DC + signaling 双发（保险路径），desktop 端按 envelope.requestId 去重：

```js
// mobile-bridge.js: handleMobileCommand
const recentRequests = new LRU({ max: 100, ttl: 30_000 });
if (recentRequests.has(payload.id)) {
    logger.debug(`Duplicate request ${payload.id}, ignoring`);
    return;
}
recentRequests.set(payload.id, true);
```

但 v0.1 默认 **不双发**（DC 通就只走 DC），保留单路径简洁。双发留作 future hardening。

## 4. Phase 划分

### Phase 1 — Android `DataChannelTransport` 抽象 + DC 状态暴露

新增 `app/.../remote/p2p/DataChannelTransport.kt`：
```kotlin
@Singleton
class DataChannelTransport @Inject constructor(
    private val webRTCClient: WebRTCClient,
) {
    val state: StateFlow<DcState>  // CLOSED | CONNECTING | OPEN | FAILED
    suspend fun send(envelope: String): Result<Unit>
    fun observeMessages(): SharedFlow<String>
}
```

- 包 `WebRTCClient.dataChannel` 的 send / onMessage
- 暴露状态 Flow 让 UI 显示 "P2P 直连/中继" 标识

**验证**：单元测试 + UI 显示状态

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

### Phase 4 — Desktop 端 requestId 去重 + sendToMobile 强化

桌面 mobile-bridge.js:
- 增 LRU dedupe (`recentRequests` 30s TTL)
- sendToMobile 当 DC 已 open 时不再 signaling 兜底（避免双发）

**验证**：双路径压测 + 抓 packet 确认走 DC

### Phase 5 — DC 断开 fallback + 自动重建

- DataChannelTransport 状态变 FAILED 时
- TerminalRpcClient 路由切 signaling
- 后台 retry handshake（指数退避 1s/4s/16s）
- UI banner "P2P 已断，使用中继路径"

**验证**：手动 disable DC 测试 + reconnect 时序

## 5. 测试

### 5.1 单元测试

- `DataChannelTransport` mock WebRTCClient 测 state 流转
- `TerminalRpcClient` 双路径选择测试（DC open / closed / failing）
- `dedupe LRU` (desktop side) 单元测

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
  4. DC 工作中拔网线 — 应 graceful fallback 信令

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
| Phase 1 DataChannelTransport | 0.5d | 独立 PR |
| Phase 2 双路径 routing | 0.5d | 独立 PR |
| Phase 3 触发 + listener | 0.5d | 独立 PR（含真机验证）|
| Phase 4 桌面 dedupe + sendToMobile | 0.3d | 独立 PR |
| Phase 5 fallback + 重建 | 0.7d | 独立 PR + 联调测试 |
| **合计** | **~2.5 天聚焦工作** | 5 PR 渐进交付 |

## 9. 验收标准

- [ ] LAN 同 WiFi 场景：DC 握手 ≤ 2s，terminal.create RTT ≤ 200ms
- [ ] 蜂窝网场景：TURN 路径建立 ≤ 5s，RTT ≤ 500ms
- [ ] 持续 30 分钟 stdout 流式输出（`watch -n 0.5 date`）无中断
- [ ] DC 故意断开（adb 杀 WS）后 fallback 信令延迟 ≤ 3s，UI 显式 "中继路径"
- [ ] DC 恢复后自动切回，UI 显式 "P2P 直连"
- [ ] 桌面 PtyManager 无 session 泄漏（24h 跑 100 次握手循环）

## 10. 相关 commits / memory

- bug 1-4 修复 commits：本 session 改动（android-app/{gradle.properties, app/build.gradle.kts, NetworkModule.kt, WebSocketPairingSignalingGate.kt, WebRTCClient.kt}）
- 历史背景：[Plan A 设计文档](Android_Remote_Terminal_Plan_A.md) §1-3
- WebRTC 现有基建：memory `signaling_relay_and_turn_deploy.md` + `android_remote_operate_plan_c_first.md`
- 配对 + DC handshake 路径：memory `desktop_qr_pairing_flow_b.md`

---

**版本历史**

| 版本 | 日期 | 说明 |
|---|---|---|
| v0.1 | 2026-05-14 | 设计调研初稿，含 Plan A 真机 e2e 发现的 4+1 bug 列表，5 phase 划分待评审 |
