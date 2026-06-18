# 好友 P2P 消息系统设计（FAMILY-67）

> 状态：**v1 已落地并真机验证**（v5.0.3.119，2026-06-18，amethyst↔chopin 双向消息 <1s 送达）。
> 关联：[去中心化社交模块](modules/02_去中心化社交模块.md) · [P2P 实时协作系统](modules/18_P2P实时协作系统.md) · [远程操控 Plan AB（WebRTC/TURN 基础设施）](Android_Remote_Operate_Plan_AB.md) · [家庭守护跨设备遥测](FAMILY-67_ChildActivity_Dashboard_E2E_Plan.md)

## 1. 背景与目标

去中心化社交的**好友间端到端加密即时消息**：两台手机不经任何中心服务器存储消息内容，经 DID 身份 + Signal 协议（X3DH + Double Ratchet）E2EE，消息密文走 P2P / 信令中继投递。

此前「加好友」只写本地 FriendEntity、从不建立两机 P2P 连接，消息发出去对方收不到。本设计补齐**加好友 → 建立 E2EE 会话 → 消息投递**的完整链路，并保证在各种 NAT/网络下的**送达稳定性**。

设计目标：
- **零中心存储**：服务器（信令）只转发签名/密文帧，永不持久化消息明文。
- **稳定送达**：WebRTC 直连优先；打不通时自动经信令服务器中继，不依赖 P2P 直连建立成功。
- **端到端加密**：消息内容经 PersistentSessionManager（Signal 协议）加密，传输层换不影响加密。

## 2. 架构总览

```
加好友(扫码/DID)──► FriendEntity(ACCEPTED) ──► FriendSyncConnector 自动接通
                                                      │
                                          electOfferer(DID 字典序)
                                          ┌───────────┴───────────┐
                                      offerer                 responder
                              FriendSessionHandshake     E2EEHandshakeCommandRouter
                              (e2ee.getBundle/init) ◄──► (PreKeyBundle/acceptSession)
                                          └───────────┬───────────┘
                                          PersistentSessionManager 双方建会话(持久化)
                                                      │
发消息 ──► P2PMessageRepository.sendMessage ──► 加密 + 本地存
              └► SocialSyncAdapter ──► SyncManager(changeSignal) ──► SyncCoordinator
                                                      │ sync.push(MESSAGE)
                                          P2PClient.sendCommand
                                          ┌───────────┴───────────┐
                                  WebRTC DataChannel        信令中继 RPC（兜底）
                                  (直连，最快)              (sendForwardedMessage)
                                          └───────────┬───────────┘
                                          对端 SyncCommandRouter ──► saveMessageFromSync
                                          (按本机视角重写 peerId/方向) ──► 聊天 UI 显示
```

## 3. 加好友（身份层）

- **扫码加好友**：`MyQRCodeViewModel` 用 `DIDManager.currentIdentity` 生成含 DID + 签名 + 时间戳的二维码（`QRCodeGenerator.generateDIDQRCode(did, signature, timestamp)`，签名时间戳必须等于二维码内嵌时间戳，否则验签失败）；`QRCodeScannerViewModel` 扫码验签后 `AddFriendViewModel.sendFriendRequest` 写 `FriendEntity(status=ACCEPTED)`（离线互加，双方各加一次即互为好友）。
- **⚠️ 身份持久化坑**：DID 私钥存 Android Keystore，`pm clear` 清不掉、Android auto-backup 还会 restore 回来。换新 DID 须 `adb uninstall`（不是 pm clear）。二维码显示的 DID 必须等于运行态 `getCurrentDID()`，否则扫到的是死身份（见修复历史）。

## 4. E2EE 会话握手（加密层）

好友连上后由 **offerer**（`electOfferer(myDid, peerDid) = myDid < peerDid`，DID 字典序较小方）发起 X3DH 握手：

- **发起方** `FriendSessionHandshake.initiate(peerDid)`（`sync/FriendSessionHandshake.kt`）：
  1. `e2ee.getBundle` 取对端 `PreKeyBundle`
  2. `PersistentSessionManager.createSession(peer, bundle)` → 本地会话 + InitialMessage
  3. `e2ee.init {fromDid, initialMessage}` 发给对端 → 对端 acceptSession
- **响应方** `E2EEHandshakeCommandRouter`（`remote/p2p/E2EEHandshakeCommandRouter.kt`）：处理 `e2ee.getBundle`（返回本机 PreKeyBundle）+ `e2ee.init`（acceptSession 建会话）。
- **⚠️ 用 `PersistentSessionManager`（不是内存态 SessionManager）**：好友聊天的发送闸 `getSession`/`hasSession` + encrypt/decrypt 全走它（@Singleton + 持久化到磁盘），握手必须把会话建在同一个管理器里聊天才看得见；进程重启 `initialize(autoRestore=true)` 自动恢复，免重握手（`AppInitializer` 启动即恢复）。
- **自动验证**：DID 验签认证的握手即视为已验证（`VerificationManager.markAsVerified(MUTUAL_HANDSHAKE)`），清「设备未验证」横幅；手动 Safety Numbers 验证仍可叠加。会话存在即视为已验证（`P2PChatViewModel.refreshConnectionState` 从会话事实重建验证态，因验证态在内存、重启即丢）。

## 5. 消息投递（同步层）

- **发送**：`P2PMessageRepository.sendMessage` 闸 `getSession(peer) != null` → 加密 → 存 `P2PMessageEntity`（发送方视角：`peerId=对端`、`isOutgoing=true`）→ `SocialSyncAdapter` 记 `ResourceType.MESSAGE` 进 `SyncManager` 队列。
- **推送**：`SyncManager.recordChange` 发 `changeSignal`（CONFLATED Channel）→ `SyncCoordinator` 周期 push 循环立即唤醒（免等 30s）→ `pushPendingToDesktopRpc(peerDid)` → `P2PClient.sendCommand("sync.push", ...)`。
- **接收**：对端 `SyncCommandRouter` 路由 `sync.push` → `DefaultSyncDataApplier` → `P2PMessageRepository.saveMessageFromSync`。
  - **⚠️ 必须按本机视角重写**：发来的 entity 是发送方视角（`peerId`=接收方自己 DID、`isOutgoing=true`），原样 insert 会落进 `peerId=本机DID` 的会话、标成「我发的」，接收方打开「与发送方的聊天」(`getMessagesByPeer(发送方DID)`) 根本查不到 → UI 不显示。修法：`peerId = entity.fromDeviceId`（发送方）、`isOutgoing = false`（入向）。

## 6. 传输层（连接 + 中继兜底）

P2P 命令（e2ee 握手 + sync.push）经 `P2PClient.sendCommand` 发出，两条路径：

1. **WebRTC DataChannel 直连**（最快）：`webRTCClient.sendMessage`。ICE 用 **ALL** 策略（同网 host 直连 + 跨网 srflx/relay 兜底）。DataChannel OPEN 超时 **40s**（给同网直连 + DTLS 握手足够时间；曾 15s 偏紧）。
2. **信令中继 RPC（兜底）**：DataChannel 打不通时（`sendMessage` 抛 `Data channel not open`），`sendCommandInternal` 自动改走 `webRTCClient.sendForwardedMessage(peer, {type:"p2p-rpc", dir, from, frame})` 经信令服务器转发命令请求；对端 `forwardedMessages` 流订阅 → `handleRelayEnvelope` 解包 → `commandRouter.route`（与 DataChannel 路径复用同一路由 + 鉴权）→ 响应经信令回传给 `from`。**E2EE 不受影响**（信令只转发签名/密文帧）。双方都稳连信令服务器（offer/answer/ICE 本就经它），故中继路径保证送达。
- **`sendCommand` 闸放宽**：`_connectionState != CONNECTED` 时只要 `currentPeerDid != null`（知道对端 DID）就放行走中继，不再直接 "Not connected" 失败。

**TURN 基础设施**：coturn 部署在 47.111.5.128（`turn.chainlesschain.com`，3478/5349 + relay 49152-65535）。`external-ip=公网/私网`（1:1 NAT 必需，否则广播私网 relay IP 致 CREATE_PERMISSION 403）。time-limited credentials 经 `signaling.chainlesschain.com/turn-credentials` 签发（secret 只在服务端）。详见 [TURN/信令基础设施](Android_Remote_Operate_Plan_AB.md)。

## 7. 连接管理（FriendSyncConnector）

- **自动接通**：`FriendSyncConnector.ensureConnected()` 轮询已接受好友 DID，按 `electOfferer` 角色 `connectFamilyPeer`。offerer 发起 E2EE 握手（**不再要求 DataChannel 已连**——握手命令经中继也能送达，新好友对在中继路径下也能建会话）。
- **单连接约束**：底层 WebRTCClient 当前单连接，已连一个 peer 时不再拨别的（家庭遥测优先）；失败指数退避 5/10/20/40/封顶 60s。
- **自动重连**：`P2PClient.handleDisconnection` 连接丢失即清空 `_connectedPeers`（否则残留 stale 条目 → 连接器误判仍连着、永不重拨 → 假在线真离线），连接器 ≤15s（`IDLE_INTERVAL_MS`）内重拨。
- **即时推送**：`SyncManager.changeSignal` → `SyncCoordinator` 即时唤醒，发消息近实时投递（免等 30s 周期）。

## 8. 修复历史（2026-06-17/18，两天调试收口）

| 问题 | 根因 | 修复 |
|---|---|---|
| 扫码加到死好友 | 二维码显示残留旧 DID（Keystore 持久，pm clear 清不掉、auto-backup restore） | adb uninstall 换新 DID |
| 消息看不到 | 收方原样 insert 发方视角 entity，落错会话 | 按本机视角重写 peerId/isOutgoing |
| 连不上 | 误用 relay-only ICE（禁直连 + 撞 coturn 自身 IP）+ 15s 超时太紧 | ICE 回 ALL + 超时 40s |
| 对方收不到 | DataChannel 打不通无兜底 | 信令中继 RPC 兜底 |
| TURN relay 403 | coturn external-ip 缺私网映射 | external-ip=公网/私网 |
| 假在线 | handleDisconnection 不清 connectedPeers | 清空 + 连接器重拨 |
| 重启要重验/看不到会话 | 验证态内存、会话未启动恢复 | AppInitializer 启动恢复 + 自动验证 |
| loading 永转 | isLoading 卡 true（collect 永不结束 finally 不可达） | 首帧关 isLoading |

## 9. 后续

- **多连接**：当前单连接（一次只能跟一个 peer 通），多好友在线只一个连上。需放开 WebRTCClient 单连接限制（N-peer）。
- **群聊**：当前 1:1，群聊需 sender-keys / MLS。
- **离线消息**：当前对端在线才送达；离线消息需服务端密文中转队列（仍 E2EE）。
- **音视频通话**：复用本设计的信令 + TURN + 连接管理，见 [音视频通话设计方案](FAMILY-67_Friend_P2P_AudioVideo_Call_Design.md)。
