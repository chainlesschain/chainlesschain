# 好友 P2P 端到端加密消息

> **版本: v5.0.3.119 (2026-06-18) | 状态: ✅ 已落地并真机验证（双向消息 <1s 送达）| 端到端加密 (Signal 协议) | 零中心存储**
>
> 去中心化社交的好友间即时消息：基于 DID 身份 + Signal 协议（X3DH + Double Ratchet）端到端加密，消息密文经 WebRTC P2P 直连或信令服务器中继投递，服务器永不存储消息明文。

## 概述

好友 P2P 消息是 ChainlessChain 去中心化社交的核心通信能力。两台设备无需任何中心服务器存储消息内容：用户以 DID（去中心化身份）互为好友，消息经 Signal 协议端到端加密后，优先走 WebRTC 数据通道 P2P 直连投递；当 P2P 直连在复杂 NAT/网络下打不通时，自动降级为「经信令服务器中继命令」——服务器只转发签名/密文帧，不解密、不存储。

完整链路为：**加好友（扫码/DID）→ 建立 E2EE 会话（X3DH 握手）→ 消息投递（sync.push）→ 接收显示**。整套机制保证在同网、跨网（一方 WiFi 一方蜂窝）、断连重连等场景下的消息送达稳定性。

## 核心特性

- 🔐 **端到端加密**：Signal 协议（X3DH 密钥协商 + Double Ratchet），密钥不出设备，服务器无法解密。
- 🪪 **DID 身份**：好友关系基于去中心化身份（`did:key`），扫码加好友含签名验签，离线互加。
- 📡 **双路投递**：WebRTC DataChannel P2P 直连优先；打不通时自动经信令服务器中继 RPC，端到端加密不受影响。
- ♻️ **自动重连**：连接丢失即清理状态并 ≤15 秒内自动重拨，杜绝「假在线真离线」。
- ⚡ **即时推送**：本地变更信号即时唤醒推送循环，消息近实时投递（免等 30 秒周期同步）。
- 💾 **会话持久化**：E2EE 会话落盘，进程重启自动恢复，免重新握手；自动验证清除「设备未验证」横幅。
- 🔔 **新消息通知**：app 不在前台时收到好友消息弹通知（发送方 + 内容预览，点击直达对应聊天）；前台不打扰。
- ❤️‍🩹 **连接自愈**：握手仅在 DataChannel 已连时发起，避免中继空转失败 + 退避死循环 —— 连不上自动退避重连、连上即握手，不再卡「正在自动连接」需手动重启。
- 🧭 **零中心存储**：消息内容从不经服务器存储；信令服务器仅做发现 + 帧转发。

## 系统架构

```
加好友(扫码/DID) ──► FriendEntity(ACCEPTED) ──► FriendSyncConnector 自动接通
                                                      │ electOfferer(DID 字典序)
                                          ┌───────────┴───────────┐
                                      offerer                 responder
                              FriendSessionHandshake     E2EEHandshakeCommandRouter
                              (e2ee.getBundle / e2ee.init) ◄──► (PreKeyBundle / acceptSession)
                                          └───────────┬───────────┘
                                          PersistentSessionManager 双方建会话(落盘)
                                                      │
发消息 ─► P2PMessageRepository.sendMessage ─► 加密 + 本地存
            └► SocialSyncAdapter ─► SyncManager(changeSignal) ─► SyncCoordinator
                                                      │ sync.push(MESSAGE)
                                          P2PClient.sendCommand
                                          ┌───────────┴───────────┐
                                  WebRTC DataChannel        信令中继 RPC (兜底)
                                  (直连，最快)              (sendForwardedMessage)
                                          └───────────┬───────────┘
                                          对端 SyncCommandRouter ─► saveMessageFromSync
                                          (按本机视角重写 peerId/方向) ─► 聊天 UI 显示
```

- **身份层**：扫码（DID + 签名 + 时间戳）→ 双方各写 `FriendEntity(status=ACCEPTED)`。
- **加密层**：offerer（DID 字典序较小方）发起 X3DH，双方在 `PersistentSessionManager` 建立并落盘会话。
- **同步层**：消息记为 `ResourceType.MESSAGE` 进同步队列，`SyncCoordinator` 经 `sync.push` 投递；接收方按本机视角重写 `peerId`/方向后入库显示。
- **传输层**：WebRTC DataChannel（ICE ALL，DTLS 加密）+ 信令中继兜底 + coturn TURN 跨 NAT。

## 配置参考

> 客户端无需手工配置；以下为部署 P2P 通信基础设施的服务端配置。

| 项                    | 值 / 说明                                                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 信令服务器            | `wss://signaling.chainlesschain.com`（offer/answer/ICE + 命令中继转发 `type:"message"`）                                             |
| TURN 服务器           | `turn.chainlesschain.com` · STUN/TURN `3478` · TLS `5349` · relay 端口 `49152-65535`（UDP，**必须放行**）                            |
| coturn `external-ip`  | `公网IP/私网IP`（云主机 1:1 NAT 必需；缺私网映射会广播私网 relay IP 导致 CREATE_PERMISSION 403）                                     |
| TURN 凭证             | time-limited credentials，经 `https://signaling.chainlesschain.com/turn-credentials?uid=<did>` 签发，`static-auth-secret` 仅在服务端 |
| ICE 策略              | `ALL`（同网 host 直连 + 跨网 srflx/relay 兜底）——勿改 `relay-only`（会禁直连且撞 coturn 自身 IP）                                    |
| DataChannel OPEN 超时 | `40s`（给同网直连 + DTLS 握手足够时间）                                                                                              |
| 重连兜底间隔          | `IDLE_INTERVAL_MS = 15s`（连接丢失后重拨上限）                                                                                       |
| 推送周期兜底          | `pushIntervalMs = 30s`（有新消息时由 changeSignal 即时唤醒，不等满 30s）                                                             |

## 性能指标

| 指标               | 实测 / 设计值                                                 |
| ------------------ | ------------------------------------------------------------- |
| 消息端到端送达延迟 | **< 1 秒**（真机 amethyst↔chopin 双向，直连路径 ~400-650ms）  |
| 即时推送触发       | 发送后同毫秒触发推送（CONFLATED changeSignal），不等 30s 周期 |
| 断连后重连         | ≤ 15 秒自动重拨恢复                                           |
| 会话握手           | X3DH 2 次 RPC 往返；会话落盘后重启免重握手                    |
| 失败退避           | 离线 peer 指数退避 5/10/20/40/封顶 60 秒                      |

## 测试覆盖

- **单元/集成**：`FriendSessionHandshakeTest`（发起方 X3DH）/ `E2EEHandshakeCommandRouterTest`（响应方）/ `P2PMessageRepository` 同步重写 / `SyncManager`·`SyncCoordinator` 推送信号 / `VerificationManager` 自动验证；`:feature-family-guard` 模块 337 测试全绿。
- **真机端到端**：amethyst（非 root）+ chopin（root）双机验证——加好友扫码、E2EE 握手双向 `Session created/accepted`、双向消息 `Message saved from sync` <1s、断连自动重连、重启会话恢复。
- **传输层**：TURN relay 服务端自测 `turnutils_uclient` 12/12 往返；coturn `peer usage` 字节核验。

## 安全考虑

- **端到端加密**：消息内容经 Signal 协议（X3DH + Double Ratchet）加密，前向保密；密钥派生在设备本地，服务器/中继只见密文。
- **身份验签**：加好友二维码含 DID 签名（时间戳防重放，24 小时有效）；`sync.*` / `e2ee.*` 命令强制 `auth` 验签（`SyncAuthVerifier`），未签名请求拒绝。
- **信令中继零知识**：中继路径只转发 `type:"p2p-rpc"` 信封（含签名/密文帧），服务器无法解密消息内容，也不持久化。
- **DTLS-SRTP/DTLS**：WebRTC 通道 DTLS 加密，媒体（后续音视频）走 SRTP。
- **私钥不出设备**：DID 私钥存 Android Keystore（StrongBox 可用时），不导出、不上链。
- **TURN secret 不下发客户端**：仅签发 time-limited credentials，`static-auth-secret` 留服务端。

## 故障排除

| 现象                             | 原因                                                                               | 处理                                                              |
| -------------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 扫码加好友总加到一个连不上的身份 | 二维码显示的是残留旧 DID（DID 存 Keystore，`pm clear` 清不掉、auto-backup 会恢复） | **彻底卸载重装**（`adb uninstall`）换新 DID；勿用 pm clear        |
| 提示「设备未验证」               | 验证态在内存、重启即丢，且会话未就绪                                               | 等连接 + 会话恢复（自动验证）；会话存在即自动标记已验证           |
| 输入框显示「请先建立连接」       | E2EE 会话未就绪（连接未建/未恢复）                                                 | 启动会自动恢复持久化会话；连接建立后输入框自动可用                |
| 消息已发但对方看不到             | 旧版收方未按本机视角重写消息归属（已于 v5.0.3.119 修复）                           | 升级到 v5.0.3.119+                                                |
| 连不上 / 对方收不到              | DataChannel 在双方 NAT 下打不通                                                    | v5.0.3.119 起自动经信令中继兜底；确认 TURN UDP 49152-65535 已放行 |
| 顶部 loading 进度条一直转        | 旧版 isLoading 卡 true（已修复）                                                   | 升级到 v5.0.3.119+                                                |

**诊断顺序**（连不上时）：① `adb shell ping` 测两机直连（排除路由器 AP 隔离）② 看 logcat ICE 状态（`CHECKING`/`CONNECTED`/`FAILED`）+ 候选 sent/received ③ coturn 日志看 `CREATE_PERMISSION ... 403` / `peer usage` 字节 ④ 再考虑调整 ICE/超时。

## 关键文件

| 文件                                                                                                                              | 职责                                                      |
| --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `feature-p2p/.../ui/social/QRCodeScannerScreen.kt` · `viewmodel/social/MyQRCodeViewModel.kt`                                      | 扫码 / 我的二维码（DID + 签名）                           |
| `app/.../sync/FriendSessionHandshake.kt`                                                                                          | 发起方 X3DH 会话握手（offerer）                           |
| `app/.../remote/p2p/E2EEHandshakeCommandRouter.kt`                                                                                | 响应方 `e2ee.*` 路由（PreKeyBundle / acceptSession）      |
| `core-e2ee/.../session/PersistentSessionManager.kt`                                                                               | Signal 会话（加密/解密 + 落盘恢复）                       |
| `feature-p2p/.../repository/P2PMessageRepository.kt`                                                                              | 发送/接收/按本机视角重写消息归属                          |
| `feature-p2p/.../repository/social/SocialSyncAdapter.kt` · `core-p2p/.../sync/SyncManager.kt` · `app/.../sync/SyncCoordinator.kt` | 消息进同步队列 + changeSignal 即时推送                    |
| `app/.../remote/p2p/P2PClient.kt`                                                                                                 | 命令 RPC（DataChannel + 信令中继兜底）+ 单连接 + 自动重连 |
| `app/.../remote/webrtc/WebRTCClient.kt`                                                                                           | WebRTC PeerConnection / DataChannel / 信令客户端          |
| `app/.../sync/FriendSyncConnector.kt`                                                                                             | 好友自动接通 + 角色选举 + 触发握手                        |
| `feature-p2p/.../viewmodel/P2PChatViewModel.kt`                                                                                   | 聊天界面状态（连接观察 + 自动验证）                       |

## 使用示例

**加好友（用户操作）**

1. 设备 A 打开「社交 → 添加好友 → 我的二维码」展示二维码（含 A 的 DID + 签名）。
2. 设备 B「社交 → 添加好友 → 扫码添加」对准 A 的**实时屏幕**（勿扫旧截图）扫码 → 验签通过 → 互为好友。
3. 后台连接器自动建立 P2P 连接 + E2EE 会话（offerer 发起 X3DH 握手）。

**发消息**

1. 进入与好友的聊天页（输入框就绪即表示会话已建立）。
2. 输入消息发送 → 本地加密存储 + 即时推送 → 对方近实时收到并在正确会话显示。
3. 直连不可用时自动经信令中继投递，用户无感。

**部署 P2P 基础设施（运维）**

```bash
# coturn 关键配置（/etc/coturn/turnserver.conf）
external-ip=<公网IP>/<私网IP>        # 1:1 NAT 必需
listening-port=3478
min-port=49152
max-port=65535
use-auth-secret
static-auth-secret=<服务端 secret>
# 云安全组放行：UDP 3478 + UDP 49152-65535
```

## 相关文档

- [好友 P2P 语音/视频通话](./friend-p2p-calls.md) — 在消息之上的 1:1 实时音视频通话（已落地）
- [好友 P2P 消息系统设计（FAMILY-67）](https://design.chainlesschain.com/FAMILY-67_Friend_P2P_Messaging_Design.html) — 实现层设计 + 修复历史
- [好友 P2P 音视频通话设计方案](https://design.chainlesschain.com/FAMILY-67_Friend_P2P_AudioVideo_Call_Design.html) — 实现层设计（P0–P3 已落地）
- [去中心化社交模块](https://design.chainlesschain.com/modules/02_去中心化社交模块.html) — 高层社交设计
- [远程操控 Plan AB](https://design.chainlesschain.com/Android_Remote_Operate_Plan_AB.html) — WebRTC/信令/coturn TURN 基础设施
- [CLI P2P 命令](./cli-p2p.md) · [去中心化社交](./social.md)
