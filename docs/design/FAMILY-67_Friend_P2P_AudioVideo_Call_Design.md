# 好友 P2P 音视频通话设计方案（FAMILY-67）

> 状态：**设计阶段（待实现）**，2026-06-18。
> 关联：[好友 P2P 消息系统](FAMILY-67_Friend_P2P_Messaging_Design.md)（复用其信令/TURN/连接管理）· [远程操控 Plan AB（WebRTC/TURN 基础设施）](Android_Remote_Operate_Plan_AB.md) · [去中心化社交模块](modules/02_去中心化社交模块.md)

## 1. 背景与目标

在已落地的**好友 P2P 消息**之上，加**好友间端到端音视频通话**（1:1 语音 + 视频）。复用同一套 DID 身份 + WebRTC + 信令服务器 + coturn TURN，媒体流 P2P / TURN 直传不经服务器存储。

目标：
- **复用现有基础设施**：信令服务器（呼叫信令）、coturn（媒体 relay）、`P2PClient`/`WebRTCClient`（PeerConnection）、`FriendSyncConnector`（presence/发现）一律复用，不另起炉灶。
- **端到端**：媒体经 WebRTC DTLS-SRTP 加密，P2P 直传或 TURN relay，服务器只转发呼叫信令（不碰媒体）。
- **1:1 起步**：先语音后视频，群组通话留后续。

## 2. 关键差异：媒体不能走应用层信令中继

消息链路有「信令中继 RPC 兜底」——DataChannel 打不通时命令经信令服务器转发。**但音视频媒体（RTP）不能这样兜底**：实时媒体吞吐高、延迟敏感，必须走 WebRTC 的 ICE/DTLS-SRTP 媒体通道（P2P 直连或 coturn TURN relay）。

故通话**强依赖 WebRTC 媒体连接建立成功**（ICE connected）。好处是消息链路已经把这条打通：
- ICE 用 **ALL**（同网直连 + 跨网 srflx/relay）。
- coturn `external-ip=公网/私网` 修复后 TURN relay 真能中继媒体（已 turnutils 自测 12/12 + 真机消息直连验证）。
- TURN 端口 49152-65535 已开（媒体 relay 必需）。

**呼叫信令**（响铃/接听/挂断/ICE 协商）走信令服务器中继（`sendForwardedMessage`，与消息命令同栈），媒体走 WebRTC。即使 DataChannel 没建过，呼叫信令也能送达对端拉起接听 → 协商媒体连接。

## 3. 架构总览

```
主叫 点「通话」──► CallManager.startCall(peerDid, video?)
       │ getUserMedia(audio[+video]) → 本地媒体轨
       │ PeerConnection.addTrack(媒体轨)
       │ 信令: call:invite {callId, from, video} ──信令服务器──► 被叫
                                                                  │ 响铃 UI
被叫 接听 ──► call:accept {callId} ──► 双方 createOffer/Answer(含媒体 SDP)
       │ ICE 候选交换(信令中继，同消息) → ICE connected
       │ DTLS-SRTP 媒体直传(P2P) 或 经 coturn relay
       └► onTrack → 远端媒体轨 → 通话中 UI(本地/远端视频)
挂断 ──► call:hangup {callId} ──► 双方 PeerConnection.close + 释放媒体
```

## 4. 信令协议（经信令服务器 type:"message" 中继）

复用 `WebRTCClient.sendForwardedMessage(peerDid, payload)` + `forwardedMessages` 流，加一组 `call:*` payload 类型（`P2PClient.handleRelayEnvelope` 分支或独立 CallSignalingClient 订阅同一流）：

| type | 方向 | 载荷 | 说明 |
|---|---|---|---|
| `call:invite` | 主叫→被叫 | callId, from, hasVideo | 发起呼叫，被叫响铃 |
| `call:ringing` | 被叫→主叫 | callId | 已收到、正在响铃 |
| `call:accept` | 被叫→主叫 | callId | 接听 → 进入媒体协商 |
| `call:reject` | 被叫→主叫 | callId, reason | 拒接/忙 |
| `call:offer` / `call:answer` | 双向 | callId, sdp | 含媒体的 SDP（区别于已有的 data-only offer/answer） |
| `call:ice` | 双向 | callId, candidate | ICE 候选（复用 ICE 交换） |
| `call:hangup` | 双向 | callId | 挂断 |

- **去重 + 鉴权**：与消息命令同样经 DID 验签（`SyncAuthVerifier` 等价）；callId 防串话。
- **超时**：invite 后 N 秒无 accept → 主叫 timeout 挂断；ringing 后无 accept → 被叫超时拒接。

## 5. 媒体层（WebRTC）

- **决策：独立 Call PeerConnection**（已定，不复用消息 DataChannel 的 PC）。理由：① 消息 PC 单连接且常走中继兜底，生命周期与通话无关；② 通话有独立的呼叫态/挂断/重连，混在一起易互相打断；③ 独立 PC 各自 ICE/DTLS/TURN 分配，互不干扰。**复用**（非复制）：`PeerConnectionFactory`（抽成共享单例 `WebRtcCore`，供消息 + 通话共用，避免双份 native 初始化）、ICE 配置 `resolveIceServersFor` + TURN 凭证、`SignalClient.sendForwardedMessage`/`forwardedMessages`（呼叫信令复用同一信令通道，按 `type:"call:*"` 分流）。
- **采集（音频，P1）**：`PeerConnectionFactory.createAudioSource(MediaConstraints)` → `createAudioTrack` → `pc.addTrack(audioTrack)`。`JavaAudioDeviceModule`（`setUseHardwareAcousticEchoCanceler` / `NoiseSuppressor` 真机可用时开，否则 WebRTC 软件 AEC/NS/AGC）。接收侧 `onTrack` 拿远端 `AudioTrack`，WebRTC 自动经 AudioDeviceModule 播放。
- **采集（视频，P2）**：`Camera2Enumerator` + `VideoCapturer` → `VideoSource` → `VideoTrack` → `addTrack`；渲染 `SurfaceViewRenderer`（本地/远端各一）。
- **编解码**：音频 Opus（默认），视频 VP8/H264（`DefaultVideoEncoderFactory` 硬编优先）。带宽自适应 WebRTC 内置。
- **加密**：DTLS-SRTP（WebRTC 强制），密钥经 DTLS 握手，端到端，服务器无法解。
- **音频路由 / 焦点（P1 必做）**：`AudioManager.mode = MODE_IN_COMMUNICATION`；请求音频焦点（`AudioFocusRequest`，通话期暂停他方音频）；默认听筒、可切扬声器/蓝牙（`setSpeakerphoneOn` / `AudioDeviceInfo` 路由）；接近传感器贴耳息屏（`PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK`）。通话结束恢复 `MODE_NORMAL` + 放焦点。

## 6. UI / 交互

- **去电**：好友详情/聊天页加「语音通话」「视频通话」按钮 → `CallActivity`（拨号中 → 通话中）。
- **来电**：`call:invite` 到达 → 全屏来电界面（接听/拒接）+ 推送（应用在后台时经厂商推送拉起，见 [推送 checklist](FAMILY-67_ChildActivity_Dashboard_E2E_Plan.md)）+ 铃声/震动。
- **通话中**：本地小窗 + 远端大窗（视频）/ 头像（语音）；静音、扬声器、摄像头开关、翻转、挂断。
- **权限**：首次 `RECORD_AUDIO` / `CAMERA` 运行时申请；拒绝则降级（仅语音/无法通话提示）。
- **状态**：拨号中/响铃中/已接通/通话时长/重连中（媒体 ICE 断重连）/已结束。

## 7. 连接 / 稳定性（复用消息链路成果）

- **presence/发现**：复用 `FriendSyncConnector` 的 DID 注册——被叫即使未主动连，信令注册在线即可收 `call:invite`。
- **NAT 穿透**：ICE ALL + coturn TURN relay（已修 external-ip + 端口已开），媒体在双方不同 NAT 下经 relay 中继。
- **媒体重连**：ICE disconnected → restartIce 重新协商候选（媒体短暂中断后自愈），复用 `handleDisconnection` 思路但针对媒体 PC。
- **降级**：视频卡顿 → 自动降分辨率/帧率；ICE 始终连不上（极端 NAT）→ 提示「网络受限，通话失败」（媒体无应用层中继兜底，这是与消息的本质区别）。

## 8. Phase 划分

- **P0 信令骨架**：`call:*` 信令收发 + callId 状态机 + 来电/去电/挂断 UI 壳（无媒体，纯信令打通响铃/接听/挂断）。
- **P1 语音**：`getUserMedia(audio)` + addTrack + 媒体 SDP 协商 + onTrack 播放 → 1:1 语音通话真机打通（同网 + 跨网 TURN）。
- **P2 视频**：加视频轨 + 本地/远端视频渲染 + 摄像头开关/翻转 + 带宽自适应。
- **P3 体验**：后台来电推送拉起 + 铃声/震动 + 通话时长 + 媒体重连 + 弱网降级 + 通话记录（存聊天时间线，仅元数据不存媒体）。
- **P4（后续）**：群组通话（SFU/Mesh）、屏幕共享、通话中发消息。

## 9. 风险 / 待定

- **媒体无中继兜底**：极端对称 NAT 双方且 TURN 也打不通时通话失败（消息可中继、媒体不行）。缓解：TURN relay 已修可用，覆盖绝大多数；监控 ICE 成功率。
- **后台来电**：Android 后台/锁屏拉起来电需厂商推送（FCM/小米/华为）+ 前台服务 + 全屏 Intent 权限，各 ROM 差异大（参考远程终端/家庭守护推送经验）。
- **回声/啸叫**：WebRTC AEC/NS/AGC 默认开，真机调参。
- **电量/发热**：视频通话耗电，限时长 + 降级策略。
- **单连接约束**：当前 WebRTCClient 单连接；通话与数据同步可能争用，需确认通话期间数据同步策略（暂停/独立 PC）。

## 10. 实施细节（音频先行 P0 + P1，已定稿）

> **实施状态（2026-06-18）**：P0 信令 + P1 音频 + P2 视频 + UI 已落地（`:app` / `:feature-p2p`，`:app:assembleDebug` 绿）。
> - **P0 信令**：`CallModels` / `CallSignal`（`resolveGlareKeepMine`）/ `CallSignalingClient`（复用 `WebRTCClient.forwardedMessages` 中继）/ `CallManager`（状态机 + glare + 超时），23 单测过。
> - **P1 音频**：`WebRtcCallMediaController`（独立媒体 PeerConnection，复用 `sharedFactory()`+`callIceServers()`，音轨 + offer/answer/ICE）+ `AudioRouteController`（`MODE_IN_COMMUNICATION` + 焦点 + 听筒/扬声器）+ `AppInitializer` 接线。
> - **P2 视频**：同 `WebRtcCallMediaController` 懒建独立**视频版** `PeerConnectionFactory`（`EglBase` + `DefaultVideoEncoder/DecoderFactory`；消息侧 factory 无视频编解码）；`Camera2/1Enumerator` 优先前置摄像头采集 + 本地视频轨 + 远端视频轨经 `onAddTrack` 暴露；`CallHost` 渲染远端全屏 `SurfaceViewRenderer` + 本地 PiP + 摄像头翻转 + `CAMERA` 运行时权限。
> - **UI**：`CallHost`（MainActivity 顶层全屏浮层，来电/去电/通话中）+ `CallViewModel` + `P2PChatScreen`「语音/视频通话」按钮（用好友 DID 拨号，同消息信令路由键）。
> - **剩余**：真机 amethyst↔chopin 双向音视频验收（设备阻塞，需两机）；来电前台服务/全屏 intent / 接近传感器息屏（P3）。

### 10.1 模块与职责

| 组件 | 模块 | 职责 |
|---|---|---|
| `WebRtcCore`（新，共享单例） | :app | `PeerConnectionFactory` + EglBase + ADM 单例，供消息 PC + 通话 PC 共用，避免双份 native 初始化 |
| `CallManager`（新，@Singleton） | :app | 通话状态机 + 编排（发起/接听/挂断/媒体协商/重连）+ 暴露 `callState: StateFlow` 给 UI |
| `CallSignalingClient`（新） | :app | 订阅 `WebRTCClient.forwardedMessages` 按 `type:"call:*"` 分流；`sendForwardedMessage` 发呼叫信令；DID 验签 |
| `CallPeerConnection`（新） | :app | 独立媒体 PeerConnection（音频轨 + ICE/DTLS-SRTP）；复用 `resolveIceServersFor` + TURN 凭证 |
| `AudioRouteController`（新） | :app | AudioManager MODE_IN_COMMUNICATION + 焦点 + 听筒/扬声器/蓝牙 + 接近传感器 |
| `CallForegroundService`（新） | :app | 通话期前台服务（microphone 类型，Android 14+ `FOREGROUND_SERVICE_MICROPHONE`），防 OS 杀 |
| `Outgoing/Incoming/InCallScreen`（新 Compose） | :app | 去电/来电/通话中 UI，绑定 `CallManager.callState` |

### 10.2 状态机（CallState）

```
IDLE
 ├─(主叫 startCall)──► OUTGOING ──(收 call:ringing)──► OUTGOING_RINGING
 │                         │                              │(收 call:accept)
 │                         │(收 call:reject/超时60s)       ▼
 │                         ▼                          CONNECTING ──(ICE connected + DTLS)──► ACTIVE
 │                       ENDED                            │(媒体协商/超时)                      │(挂断/对端 hangup)
 └─(收 call:invite)──► INCOMING ─(接听)─► CONNECTING      └─► ENDED                            ▼
                          │(拒接/超时)                                                       ENDED
                          ▼
                        ENDED
```
- **超时**：OUTGOING→无 ringing/accept 60s→ENDED；INCOMING→无接听 60s→自动拒接；CONNECTING→媒体 30s 不通→ENDED（提示网络受限）。
- **Glare（双方同时呼叫）**：各持一个 callId，比较 `min(callIdA, callIdB)` 保留、另一个自动 reject（确定性，两端一致）。
- **幂等**：重复 invite/accept/hangup 按 callId 去重；ENDED 后丢弃迟到信令。

### 10.3 媒体协商（音频 P1）

1. 接听后，offerer（沿用 `electOfferer(myDid, peerDid)`）`CallPeerConnection.createOffer`（含 audio m-line）→ `call:offer{callId, sdp}`。
2. 对端 setRemoteDescription + `createAnswer` → `call:answer`。
3. 双方 onIceCandidate → `call:ice{callId, candidate}`（与消息 ICE 分流，callId 命名空间）。
4. ICE connected + DTLS 握手完成 → onTrack 拿远端 AudioTrack → ACTIVE，开始计时。

### 10.4 P0 验收（无媒体，纯信令）

主叫点「语音通话」→ 被叫**响铃 UI 弹出** → 接听/拒接/挂断**双端状态同步**（经信令中继，即使 DataChannel 没建过）。不涉及 getUserMedia/媒体 PC。可在两台真机仅验信令链路。

### 10.5 P1 验收（音频打通）

P0 之上接媒体：接听后媒体协商 → ICE connected → **双向听到对方声音 <2s 接通**（同网直连 + 跨网 TURN relay）+ 静音/扬声器切换 + 挂断释放（AudioManager 恢复、焦点放、PC close）。真机 amethyst↔chopin 验证。

### 10.6 权限 / 清单

- `RECORD_AUDIO`（运行时申请）；`MODIFY_AUDIO_SETTINGS`；`FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_MICROPHONE`（Android 14+）；`USE_FULL_SCREEN_INTENT`（P3 来电）。
- `CallForegroundService` 注册 `android:foregroundServiceType="microphone"`。
