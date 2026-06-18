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

- **采集**：`getUserMedia({audio, video})`（Android `PeerConnectionFactory` + `VideoCapturer`/`AudioSource`）。语音先行，视频可选 + 通话中切换。
- **PeerConnection**：在已有 `WebRTCClient` 基础上加媒体能力——`addTrack(audioTrack[, videoTrack])`，复用同一 ICE 配置（`resolveIceServersFor` + TURN 凭证）。**通话用独立 PeerConnection**（与数据 DataChannel 的 PeerConnection 分开，避免互相影响生命周期；或同一 PC 加媒体 transceiver，二选一，倾向独立 PC 更清晰）。
- **编解码**：音频 Opus，视频 VP8/H264（Android 硬编优先）。带宽自适应（WebRTC 内置）。
- **加密**：DTLS-SRTP（WebRTC 强制），密钥经 DTLS 握手，端到端，服务器无法解。

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
