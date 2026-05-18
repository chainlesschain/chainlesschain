# Android Remote Operate — Plan C (Signaling-Forward) 设计文档

> 状态: ✅ 落地 v5.0.3.50 (2026-05-13)
> 关联: [Android W3 Pairing E2E](Android_W3_Pairing_E2E.md) / [REMOTE Commands Inventory](Android_REMOTE_commands_inventory.md) / [Android 重新定位](Android_重新定位_设计文档.md)
> 实现 commits: `f8ec994ef` (feature landing) + `8073edc62` (5 fixes 收口) + `000533895` (follow-up: test assertEquals + web-panel JSON parser)

## 1. 背景与目标

v1.2 GA 已完成 **桌面 QR 显示 + 手机扫码配对**（[W3.7 Flow B](Android_W3_Pairing_E2E.md)）。配对成功后桌面 `paired_devices` 表与 Android `PairedDesktopsStore` 双侧落库。**下一步是让配对完成的手机真正"操控"桌面**——比如点 "Ping" / "系统状态" 按钮，桌面执行命令并返回响应。

最初的设计有三条路径：

| 路径 | 描述 | 工程量 | 适用场景 |
|---|---|---|---|
| **A** | WebRTC P2P DataChannel 直连透传 | 大（需 ICE/STUN/TURN + 真 RTCPeerConnection 通道复用） | 高吞吐 / 低延迟（视频、实时同步） |
| **B** | STUN/TURN 中继 NAT 穿透后的 P2P | 中（A 的兜底） | A 不通时退而求其次 |
| **C** | **不建 P2P**，命令直接经信令服务器 forward（LAN ws / 公网中继 wss 都是同一根管道） | 小（pair-ack 已是同款 forward，只缺 Android RPC 客户端 + 桌面命令路由） | 单次低频命令（控制台 / 表单提交） |

**Plan C 先行**是务实的：
- pair-ack 已经走 forward 路径并打通了双向收发
- 桌面 `handleMobileCommand` 已经接好（pair-ack 来后会触发 desktop-pair-handlers，命令路径只需要复用同一管道）
- 只缺手机端的 `SignalingRpcClient` 和一个简单的 UI 屏

A + B 留作后续（视频流、实时同步、高频小消息）。

## 2. 数据流与组件

```
┌───────────────────────┐           ┌─────────────────────────────────┐
│ Android (Mobile)      │           │ Desktop (PC)                    │
│                       │           │                                 │
│ RemoteOperateScreen   │           │ desktop-pair-handlers.js        │
│        ↓ user tap     │           │ ↑ recordPairAck (LAN + relay)   │
│ RemoteOperateVM       │           │                                 │
│        ↓ rpc.invoke() │           │ MobileBridge / handleMobileCmd  │
│ SignalingRpcClient    │  request  │ ↑ dispatches to:                │
│        ↓ sendForward  │ ════════> │   - AICommands                  │
│ PairingSignalingGate  │           │   - SystemCommands              │
│   (ws or wss relay)   │  response │   - …                           │
│                       │ <======== │                                 │
└───────────────────────┘           └─────────────────────────────────┘
              │                                          │
              │              传输层：                     │
              ├──────► LAN signaling (ws://lan:9001) ────┤
              └──────► 公网中继 (wss://signaling.chainlesschain.com)
                                                          │
                                                          ↓
                                                    RelayClient (desktop outbound)
                                                    + register peerId on relay
                                                    + onMessage → handleMobileCommand
```

### 2.1 Android 端新增组件

| 组件 | 路径 | 职责 |
|---|---|---|
| `SignalingRpcClient` | `app/.../remote/client/SignalingRpcClient.kt` | RPC 入口；构 `{type:"chainlesschain:command:request", payload}` → `signalingGate.sendAck`；安装一次性 `setOnForwardedMessageReceived` listener；按 `requestId` 关联 `CompletableDeferred` resolve 响应；30s timeout |
| `RemoteOperateScreen` + ViewModel | `app/.../remote/ui/RemoteOperateScreen.kt` | 极简 UI：3 个 chip 按钮（Ping / 系统状态 / 系统信息）+ 响应 JSON 显示；ViewModel 注入 `SignalingRpcClient` + `PairedDesktopsStore` |
| `PairedDesktopsStore` | `core-p2p/.../pairing/PairedDesktopsStore.kt` | SharedPreferences 持久化已配对桌面列表（pcPeerId / deviceName / lanSignalingUrl / relayUrl）；upsert idempotent by pcPeerId；首页点已连接卡片走 NavGraph 跳 `remote_operate/{peerId}` |

### 2.2 Android 端修改组件

| 组件 | 改动 |
|---|---|
| `ScanDesktopPairingViewModel` | 扫桌面 QR 成功后写 `PairedDesktopsStore` + 持久化 QR 里的 `signalingUrl` / `relayUrl` 到 `SignalingConfig` prefs。LAN sendAck 失败时自动 reset gate → 切到中继 URL → 重试一次 |
| `NavGraph.kt` | 新增 `Screen.RemoteOperate.routePattern = "remote_operate/{peerId}"` 路由 |
| `NewHomeScreen.kt` | 读 `PairedDesktopsStore.devices`，渲染"已连接桌面"卡片（替代之前读 `p2pClient.connectedPeers` live 连接 — Plan C 不建持久连接，扫码后信令立刻断 connectedPeers 即空，UX 反直觉的根因） |
| `SignalingConfig.kt` | 新增 `getRelayUrl()` / `setRelayUrl()` + `DEFAULT_RELAY_URL = "wss://signaling.chainlesschain.com"`，与 `DEFAULT_SIGNALING_URL`（LAN 路径，默认 `ws://192.168.1.1:9001`）解耦持久化 |
| `PairingSignalingGate` | 加 `reset()` interface 方法（默认 no-op），让 LAN→relay 切换前清缓存的 registered peer 状态防 ensureRegistered 短路 |

### 2.3 Desktop 端新增组件

| 组件 | 路径 | 职责 |
|---|---|---|
| `RelayClient` | `desktop-app-vue/src/main/p2p/relay-client.js` | outbound 长连 `wss://signaling.chainlesschain.com`；`register` 注册桌面 pcPeerId；`onMessage` 收到中继转发的 pair-ack / 命令时路由进 `recordPairAck` 或 `handleMobileCommand`（与 LAN 同一管道）；指数退避自重连 max 60s |
| `MobileBridgeHeaderStatus.vue` | `packages/web-panel/src/components/` | web-panel header 显示已配对 mobile 数量，5s 轮询 `p2p devices --type mobile` CLI |

### 2.4 Desktop 端修改组件

| 组件 | 改动 |
|---|---|
| `main/index.js` | 启动时 `startRelayClient()` (`mobileBridge.peerId` 优先于 `deviceManager.deviceId`，两路径同一 pcPeerId 保证 phone forward 到此 ID 时不区分 LAN/WAN) |
| `mobile-bridge.js` | 新增 `handlePairAckFromRelay(ack, fromPeerId)` —— LAN 路径走 `handleP2PMessage` 的 pair-ack 拦截，relay 路径补 EventEmitter 通知对称 |
| `desktop-pair-handlers.js` | QR payload 新增 `relayUrl` 字段（`process.env.CC_RELAY_URL` 可覆盖），手机扫码后立刻写 Android `SignalingConfig` prefs |

## 3. 协议

### 3.1 命令请求 (Android → Desktop)

```jsonc
{
  "type": "chainlesschain:command:request",
  "payload": {
    "id": "<uuid-v4>",              // requestId; 关联 response
    "method": "system.ping",        // 命令方法名
    "params": { /* 命令参数 */ },
    "auth": { "did": "did:cc:mobile-xxx" },
    "timestamp": 1715567890123
  }
}
```

经 `PairingSignalingGate.sendAck(pcPeerId, payload)` 走信令 forward。LAN 通则进 LAN signaling server，不通则 ScanDesktopPairing 时已切到 relay URL。

### 3.2 命令响应 (Desktop → Android)

Desktop `handleMobileCommand` 内部走 JSON-RPC 2.0：

```jsonc
{
  "type": "chainlesschain:command:response",
  "payload": "<stringified JSON-RPC>"  // 注意 payload 是 string 不是 object
}
```

`payload` 解出来：
```jsonc
{
  "jsonrpc": "2.0",
  "id": "<same uuid as request>",
  "result": { /* 业务结果 */ },     // 或
  "error": { "code": -32000, "message": "..." }
}
```

`SignalingRpcClient.ensureResponseListener` 一次性安装的 callback 按 `id` 查 pending map → complete `CompletableDeferred`。

### 3.3 LAN → 中继 fallback

- **配对路径**：`ScanDesktopPairingViewModel` 第一次 sendAck 失败时 `gate.reset()` + `signalingConfig.setCustomSignalingUrl(getRelayUrl())` + 重试。reset 必须在切 URL 前调一次，否则 gate 的 `registeredPeerId` 缓存会让 `ensureRegistered` 短路，不真的重连新 URL。
- **RPC 路径**：`SignalingRpcClient.invoke` 复用同一模式 —— 首次 sendAck 失败时 reset → 切 relay URL → re-register → 重试 sendAck 一次。两次都失败才 `Result.failure`。

## 4. 测试

### 4.1 单元测试（新增 20 个）

| 类 | 测试数 | 位置 |
|---|---|---|
| `PairedDesktopsStoreTest` (mocked SharedPreferences) | 7 | `core-p2p/src/test/.../PairedDesktopsStoreTest.kt` |
| `SignalingRpcClientTest` (FakeSignalClient + CapturingGate) | 7 | `app/src/test/.../SignalingRpcClientTest.kt` |
| `RemoteOperateViewModelTest` (mockk + StandardTestDispatcher) | 6 | `app/src/test/.../RemoteOperateViewModelTest.kt` |

**关键技术决策**：
- **不用 Robolectric**：core-p2p 模块没有 Robolectric 依赖（pure JVM 模块），用 mockk 模拟 `SharedPreferences` 而非引 Robolectric — 启动快几个数量级
- **用 `runCurrent()` 而非 `advanceUntilIdle()`**：`SignalingRpcClient.invoke` 内部 `withTimeout(30000) { deferred.await() }` 用虚拟时间。`advanceUntilIdle` 会把虚拟时间推到 30s 后触发超时；`runCurrent` 只跑当前时间点 ready 的任务，timer 不会被推动
- **新增 `testImplementation("org.json:json:20240303")`**：Android SDK 自带的 `org.json.JSONObject` 在 `isReturnDefaultValues=true` 下方法静默返默认值而非真解析 JSON，会让 `invoke()` 内部 payload 字段全空。引真实 org.json 覆盖
- **手写 `FakeSignalClient` 而非 mockk**：`SignalClient.setOnForwardedMessageReceived(callback: ((String) -> Unit)?)` 的 nullable function-type 参数在 mockk 里 `arg<>` / `firstArg<>` 拿到 null，原因不详。9 个 stub 方法直接 hand-roll 反而更可读
- **测试也覆盖**：happy path（response listener resolve deferred）/ 无 DID fail fast / LAN→relay fallback 后成功 / 双失败 / response 含 error 字段 / withTimeout 真超时 / 未知 rid silent ignore

### 4.2 ScanDesktopPairingViewModelTest 测试调整

LAN→relay retry 加入后，原 `signaling gate failure surfaces Failed` 测试期望 `sendAckCallCount == 1`，需调整为 2（FakeGate 每次返失败 → LAN + relay 都打）。

### 4.3 e2e 验证

Plan C 真实 e2e 验证需要 Android 真机 + 桌面 + 公网中继（Flow B 配对走完后用 RemoteOperate 屏发命令），与 Flow B 的真机验证 pattern 一致（见 [Android W3 Pairing E2E](Android_W3_Pairing_E2E.md)），在用户出场清单。Desktop 端的命令路由 / RelayClient 重连等已被 vitest 7600+ 套覆盖。

## 5. 路线图

| 阶段 | 内容 | 状态 |
|---|---|---|
| **Plan C** | Signaling forward RPC（单次低频命令） | ✅ v5.0.3.50 落地 |
| **Plan A.1** | WebRTC DataChannel 复用：在 pair 完成且 datachannel 已建立时优先走 DC，仅 DC 不可用时退到信令 forward | 未开始 |
| **Plan A.2** | 高吞吐场景（流式 token / 文件同步）真正走 DC 直连，绕过中继带宽瓶颈 | 未开始 |
| **Plan B** | STUN/TURN 接入，让真正 NAT 隔离的两端也能 A.1 P2P | 未开始 |

## 6. 已知约束 / Trade-offs

- **延迟**：信令服务器一跳 + 公网中继时多一跳，p99 延迟可能 100-500ms。低频命令（点按钮）可接受；流式 token / 视频不适用 → A.2
- **吞吐**：中继带宽是全平台共享，不适合大文件传输 → 文件同步保持 Phase 3d Mobile Sync 路径
- **隐私**：命令明文经中继（公网 wss TLS 但中继服务器能看到 payload）。需端到端加密时上 Signal Protocol session（已有 e2ee 模块，但 Plan C 当前未挂）
- **可靠性**：中继宕机 = Plan C 完全不可用；LAN 仍可工作。未来 Plan A 直连可降低对中继的硬依赖

## 7. 相关 commits

| Commit | 内容 |
|---|---|
| `f8ec994ef` | feat(remote-operate): plan C signaling-forward landing — productVersion v5.0.3.49 → v5.0.3.50 |
| `8073edc62` | fix(remote-operate): plan C 收口 — relay 双发 + handlePairAckFromRelay + 3 tests + org.json testImpl |
| `000533895` | fix(remote-operate): scan-test assertEquals 2 + web-panel JSON parser skip log prefix |
