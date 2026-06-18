# 好友 P2P 加密语音 / 视频通话

> **版本: v5.0.3.119 (2026-06-18) | 状态: ✅ P0–P3 已落地（34 JVM 单测全绿）；真机双向音视频验收待两台设备 | 端到端加密 (DTLS-SRTP) | 零中心存储**
>
> 在好友端到端加密消息之上的 1:1 实时语音 / 视频通话：基于同一 DID 好友关系，媒体经独立 WebRTC PeerConnection 端到端加密（DTLS-SRTP），信令经信令服务器中继（仅转发，不存储），支持后台 / 锁屏来电。

## 概述

好友通话复用好友 P2P 消息的身份与连接基础设施：双方以 DID 互为好友后，任意一方可发起语音或视频呼叫。呼叫控制信令（`call:invite/ringing/accept/reject/offer/answer/ice/hangup`）经信令服务器中继转发，与消息走同一条好友 DID 路由；音视频媒体则走一条**独立的** WebRTC `PeerConnection`，端到端 DTLS-SRTP 加密，服务器永不接触媒体内容。

完整链路为：**发起呼叫 → 对端响铃（前台浮层 / 锁屏全屏来电）→ 接听 → 媒体协商（SDP + ICE）→ 双向音视频 → 挂断释放**。通话状态机内置双呼仲裁（glare）、无应答 / 媒体超时，以及前台服务保活、接近传感器贴耳息屏。

## 核心特性

- 🔐 **端到端加密媒体**：音视频经 WebRTC DTLS-SRTP 端到端加密，信令服务器只中继控制信令、不接触媒体。
- 📞 **语音 + 视频**：1:1 语音通话与视频通话（前置摄像头采集、远端全屏 + 本地画中画、前后摄像头翻转）。
- 🔀 **复用消息路由**：`call:*` 信令经既有信令服务器中继，与消息同一好友 DID 路由 —— 即便从未建过 DataChannel 也保送达。
- 🤝 **双呼仲裁（glare）**：双方同时互呼时按 callId 字典序确定保留方，另一方自动让步转为接听。
- ⏱️ **超时与状态机**：无应答 60s / 媒体协商 30s 超时自动结束；完整状态机（去电 / 响铃 / 接听 / 通话中 / 结束）。
- 🔔 **后台 / 锁屏来电**：前台服务（`microphone|camera`）保锁屏 / 熄屏期间麦克风采集不被杀；全屏来电通知越锁屏点亮屏幕 + 接听 / 拒接。
- 🔊 **来电铃声 / 振动**：来电响系统默认铃声 + 振动（尊重响铃 / 振动 / 静音模式）；去电播回铃音；接听 / 结束即停。
- 📴 **贴耳息屏**：语音通话中接近传感器自动息屏（`PROXIMITY_SCREEN_OFF_WAKE_LOCK`）。
- 🕑 **通话记录**：每通通话结束落库 `call_history`（呼出 / 呼入 / 未接 + 语音 / 视频 + 时长 + 状态），好友资料页「查看通话记录」查看。
- 🧭 **零中心存储**：媒体内容从不经服务器；信令服务器仅做发现 + 控制信令转发。

## 系统架构

```
聊天页「语音/视频通话」按钮 ──► CallManager.startCall(好友DID, 媒体类型)
                                       │
        ┌──────────────── CallManager（状态机 + glare + 超时）────────────────┐
        │                              │                                      │
   CallSignalingClient           CallMediaController                   CallServiceLauncher
   (call:* 信令中继)            (WebRtcCallMediaController)            (前台服务 + 全屏来电通知)
        │                              │                                      │
   WebRTCClient.forwardedMessages  独立媒体 PeerConnection            CallForegroundService
   ←─ 信令服务器中继 ─→            (音轨 / 视频轨 + SDP + ICE)         CallActivity（锁屏来电）
                                  DTLS-SRTP 端到端加密                 CallActionReceiver（通知动作）
```

- **CallManager**（`@Singleton`）：通话状态机编排，复用 `electOfferer`（DID 字典序选举 offerer），媒体经 `CallMediaController` seam 解耦。
- **CallSignalingClient**：`call:*` 控制信令经 `WebRTCClient.sendForwardedMessage` / `forwardedMessages` 中继（与消息同一中继）。
- **WebRtcCallMediaController**：独立媒体 `PeerConnection`；语音复用消息侧 `PeerConnectionFactory`，视频懒建带 `EglBase` + 编解码工厂的视频版 factory。
- **CallHost / CallActivity**：全屏通话 UI（来电 / 去电 / 通话中），`CallActivity` 越锁屏显示并管理接近传感器。
- **CallForegroundService**：接通后启动，保后台 / 锁屏麦克风采集。

## 配置参考

通话复用消息的信令服务器 + TURN 配置，无需额外服务端配置。客户端关键常量（`CallManager`）：

| 项 | 默认值 | 说明 |
|---|---|---|
| `NO_ANSWER_TIMEOUT_MS` | 60s | 无应答超时自动结束 |
| `MEDIA_TIMEOUT_MS` | 30s | 媒体协商（ICE）超时 |
| `END_LINGER_MS` | 2.5s | 结束态短暂保留供 UI 展示后清空 |

所需权限（已在 `AndroidManifest.xml`）：`RECORD_AUDIO`、`CAMERA`、`MODIFY_AUDIO_SETTINGS`、`FOREGROUND_SERVICE_MICROPHONE`、`FOREGROUND_SERVICE_CAMERA`、`USE_FULL_SCREEN_INTENT`、`WAKE_LOCK`、`POST_NOTIFICATIONS`。`RECORD_AUDIO` / `CAMERA` 在进入通话时运行时申请。

## 性能指标

- **接通时延**：同网直连媒体协商 + ICE 连通通常 <2s；跨网经 TURP relay 视网络而定。
- **加密**：DTLS-SRTP（媒体）+ 控制信令经既有签名通道。
- **视频默认采集**：1280×720@30fps（卡顿时可降级 640×480）。
- **保活**：接通后前台服务确保锁屏 / 熄屏 / 后台不被系统回收麦克风。

## 测试覆盖

- **单元测试（25）**：`CallManagerTest`（状态机：去电 / 来电 / 响铃 / 接听 / 拒接 / 挂断 / glare / 超时 / P3 前台服务 seam 转发）+ `CallSignalTest`（信令序列化 + glare 仲裁）。
- **集成测试（5，Robolectric）**：`AndroidCallServiceLauncherTest`（通话状态 → 通知 / 前台服务映射：来电全屏通知 / 接通起 FGS / 去电只通知 / clear 撤通知）。
- **端到端测试（2）**：`CallHandshakeE2ETest`（两个 `CallManager` 经 fake 信令总线互联，跑完整握手 `INVITE→RINGING→ACCEPT→media→ACTIVE`（双方）`→HANGUP→ENDED` + 拒接路径）。
- **通话记录映射（6）**：`CallHistoryRecorderTest`（终态 → `CallHistoryEntity`：方向 / 状态 / 时长 / 媒体类型）。
- 合计 **40 个 JVM 测试全绿**（非 flaky，多轮复跑）。**真机验证**：amethyst↔chopin 发起 / 来电 / 接通 / 通话记录已通；双向音视频实听 + 锁屏来电仍在真机验收中。

## 安全考虑

- **媒体端到端加密**：WebRTC DTLS-SRTP，信令服务器只中继控制信令，无法解密 / 录制音视频。
- **零中心存储**：媒体内容从不经服务器存储或转发明文。
- **身份绑定**：呼叫目标 = 好友 DID（与消息同一路由键），不可向非好友 DID 发起。
- **权限最小化**：`RECORD_AUDIO` / `CAMERA` 进入通话时才运行时申请；前台服务仅在接通后启动（避免无权限启动崩溃）。
- **TURN 凭证**：服务端密钥永不进客户端 APK，按需经信令同域接口下发短期凭证。

## 故障排除

| 现象 | 可能原因 / 排查 |
|---|---|
| 拨号对方无来电 | 双方是否互为好友（同一 DID）；对端是否在线注册到信令服务器；查 logcat `[CallSignaling]` 出/入向 |
| 响铃但接通后无声 | `RECORD_AUDIO` 是否授予；查 `[CallMedia] ICE state`；跨网时 TURN 凭证 / `49152-65535` UDP 是否放行 |
| 视频黑屏 | `CAMERA` 是否授予；查 `[CallMedia] local video setup`；部分 ROM 需回落 Camera1 |
| 锁屏收不到全屏来电 | `POST_NOTIFICATIONS`（Android 13+）/ `USE_FULL_SCREEN_INTENT` 是否授予；通话渠道是否被系统静音 |
| 后台一会儿就断 | 确认前台服务已启动（接通后）；Android 14 后台拨号→接听场景前台服务可能被系统限制（已兜底降级为前台时工作） |
| 来电没有铃声 | 检查手机是否处于静音 / 振动模式（静音模式不响铃只振动）；确认系统默认铃声已设置；通话通知渠道未被静音 |
| 查看通话记录为空 | 仅记录**升级到含通话记录版本之后**的通话；旧通话不会回填。新打一通后即出现 |

## 关键文件

- `android-app/app/src/main/java/com/chainlesschain/android/call/CallManager.kt` — 通话状态机
- `.../call/CallSignalingClient.kt` — `call:*` 信令中继
- `.../call/WebRtcCallMediaController.kt` — WebRTC 媒体（音频 + 视频）
- `.../call/AudioRouteController.kt` — 音频路由 / 焦点
- `.../call/ui/CallHost.kt` / `CallViewModel.kt` — 通话 UI 浮层
- `.../call/CallForegroundService.kt` / `CallActivity.kt` / `AndroidCallServiceLauncher.kt` / `CallActionReceiver.kt` — 前台服务 + 锁屏来电
- `.../call/CallRinger.kt` — 来电铃声 / 振动 / 去电回铃音
- `.../call/CallHistoryRecorder.kt` / `RoomCallHistoryRecorder.kt` / `ui/CallHistoryScreen.kt` / `ui/CallHistoryViewModel.kt` — 通话记录落库 + 查看页（`call_history` 表）
- 设计文档：`docs/design/FAMILY-67_Friend_P2P_AudioVideo_Call_Design.md`

## 使用示例

1. 两台设备各登账号并互为好友（扫码 / DID，见[好友 P2P 加密消息](./friend-p2p-messaging.md)）。
2. 进入好友聊天页，点顶栏「语音通话」或「视频通话」按钮。
3. 对端弹出来电（前台浮层；锁屏 / 熄屏则全屏来电点亮屏幕）→ 点「接听」。
4. 通话中：静音 / 扬声器切换；视频通话可前后摄像头翻转；语音贴耳自动息屏。
5. 任一方「挂断」结束，双方释放媒体与音频焦点。

## 相关文档

- [好友 P2P 端到端加密消息](./friend-p2p-messaging.md)
- 设计文档：`docs/design/FAMILY-67_Friend_P2P_AudioVideo_Call_Design.md`、`docs/design/FAMILY-67_Friend_P2P_Messaging_Design.md`
