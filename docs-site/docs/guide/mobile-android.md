# 移动端 Android（v1.0 GA 用户文档）

> **版本: v1.0.0 (Android `v5.0.3.54`, 2026-05-14) | 状态: 🎉 GA | 383+ 单测 | 28 内置技能 | ADR 8/8 accepted | M1/M2/M3/M4/M5/M7 ✅ | M6 性能预算文档就位**
>
> ChainlessChain Android 客户端 — Jetpack Compose + Kotlin 原生应用。三层定位：**L1 StrongBox 硬件 DID 钱包 / L2 移动现场捕获 / L3 REMOTE 远程遥控桌面 139 skill**。桌面与移动同版本同步发布（`v5.0.3.X`），每个 release tag 同时挂桌面 8 包 + Android 4 包。

::: tip 适用读者
- 第一次安装手机端、想搞清楚怎么用的用户
- 桌面 ↔ Android 配对失败、远程终端黑屏、远程操控掉线时排错的用户
- 想了解架构、配置、性能指标、安全模型的开发者
:::

## 概述

ChainlessChain 桌面端是"重资产个人 AI 主机"——139 内置 skills、Cowork 多智能体、RAG / 向量检索、MCP、Marketplace、联邦治理、Workflow、ZKP，典型久坐工作站形态。手机端**不重复实现桌面**，只补桌面在手机场景下做不到的事，对齐 Claude Desktop / Mobile 的二端分工：**桌面 = AI 工作站，手机 = 它的延伸**。

具体落到三层：

| 层 | 名称 | 干什么 | 桌面替代不了的原因 |
|---|---|---|---|
| **L1** | StrongBox DID 钱包 | 硬件级保管 W3C DID v2 私钥 | Android Keystore + StrongBox HSM 是芯片级隔离，桌面 U-Key 需插着才能用 |
| **L2** | 移动现场捕获 | 语音 / 拍照 OCR / GPS / 系统分享 / 推送 | 桌面没有麦克风触手可及、没有摄像头、没有 GPS、不能接 Android 系统分享意图 |
| **L3** | REMOTE 遥控器 | 调桌面 139 skill / 23 个 REMOTE command | 手机不重复跑大模型，但能在地铁里指挥桌面跑 |

## 核心特性

- 🪪 **StrongBox 硬件 DID 钱包**: Android Keystore + StrongBox HSM 芯片级隔离，私钥永不导出，生物识别解锁
- 🔑 **BIP-39 助记词**: 12/24 词标准，密语可选；旧明文密钥升级自动迁 StrongBox
- 👥 **多 DID 切换**: 工作 / 个人 / 匿名 三身份独立，签名/配对/消息走当前活跃 DID
- 🎙️ **VoiceMode 连续语音**: 麦克风 → SeedASR → LLM → TTS 全链路，VAD 静音检测自动切换，前台 Foreground Service
- 📷 **CameraOCR 拍照入库**: 相机 → OCR(豆包视觉) → 笔记 / 翻译 / 摘要；单张 / 连续 / 文档模式
- 📍 **LocationTagger GPS**: 前台轨迹服务，3-50m 精度，笔记自动打位置标 + 时间线
- 📤 **ShareReceiver 系统分享**: 接 Android 5 种 SharePayload（文本 / URL / 图片 / 文件 / 多文件）入知识库
- 🔔 **PushNotifier 推送**: 4 类本地通知 + FCM 远程通道（GA 后接 google-services.json）
- 🎮 **REMOTE 遥控**: 23 个跨 namespace 命令（AI / Knowledge / Application / Browser / File / Workflow 等）调桌面 139 skill
- ✅ **ApprovalUI 4 类审批**: Sign / Cowork / Marketplace / SystemCritical，桌面端 trust anchor 二次确认
- ⏳ **ProgressViewer 长时任务面板**: reverse-RPC `task.*` 推进度，支持手机端取消
- 🖥️ **远程终端 (Plan A.1)**: WebRTC DataChannel 直连，xterm.js 渲染，cc / claude / git / npm 任意 CLI
- 🔄 **桌面 ↔ Android 双向同步**: Note / Conversation / DID / Community / Channel + tombstones 五类资源
- 🌐 **三段位远程操控**: Plan C 信令转发（先通）+ Plan A WebRTC DC（高吞吐）+ Plan B STUN/TURN（NAT 穿透）
- 📱 **W3.7 扫码配对**: 桌面显 QR 手机扫，1 秒完成，跟微信 / 支付宝套路
- 🛡️ **trust anchor 在桌面**: 手机被劫持只能发请求，高危确认必须在桌面端完成
- 🔐 **Ed25519 严格验签**: 全链路 envelope 签名 + 时间戳防 replay
- 🤝 **社交功能产线化**: 14 屏 + 通知中心 / 屏蔽 / 举报全部接通真实屏幕
- 🚀 **M5 SignAsService**: macOS / Linux 桌面调手机硬件签名，跨平台 U-Key 替代品
- 🏗️ **25 Gradle 模块**: 9 core / 13 feature / 2 data / app / wear-app，Hilt DI + Compose UI

## 三层定位详解

### L1：StrongBox DID 钱包

| 特性 | 说明 |
|---|---|
| 硬件级隔离 | Android Keystore + StrongBox HSM（Titan M / 高通 SPU / 三星 eFuse）芯片层保管私钥 |
| 私钥永不导出 | 物理芯片设计上不允许导出 |
| BIP-39 助记词 | 12 / 24 词标准，密语可选 |
| 生物识别解锁 | 指纹 / 面容（强制 biometric tier，FAR ≤ 1/50,000）|
| 多 DID 切换 | 工作 / 个人 / 匿名 三身份切换 |
| 旧明文自动迁移 | 升级时自动把 v0.x 明文密钥迁到 StrongBox |
| W3C DID v2 兼容 | did:key / did:web / did:ion 三种解析器 |

::: warning 助记词丢失 = 钱包丢失
助记词是唯一找回途径。团队没有任何方式恢复（硬件钱包设计原则）。
:::

### L2：移动现场捕获（5 件）

桌面没有的：随身拍 / 随手录 / 随地标 / 系统分享接入 / 推送提醒。130 单测覆盖。

| 模块 | 链路 | 入口 | 真机状态 |
|---|---|---|---|
| **VoiceMode** | 麦克风 → SeedASR → LLM → TTS | 底部"语音" / Quick Tile | 待真机 E2E |
| **CameraOCR** | 相机 → 豆包视觉 OCR → 笔记 | 底部"相机" / 长按 home | 待真机 E2E |
| **LocationTagger** | GPS 前台服务 → 笔记打标 | 设置 → 启用位置 | 已落地 `be6cb4974` |
| **ShareReceiver** | Android 系统分享意图 → 5 种 SharePayload | 任意 App 点"分享" | 已落地 `be6cb4974` |
| **PushNotifier** | 本地 4 类通知 + FCM 骨架 | 系统通知设置 | 待 google-services.json |

### L3：REMOTE 远程遥控桌面（23 命令）

method-level 双粒度白名单（file × method）。每个 method 有：`namespace` / `action` / `riskLevel`（low/medium/high）/ `riskOverride` / `aliases`。

| Namespace | 示例 method | 用途 |
|---|---|---|
| `AI.*` | summarize / translate / askChain | 调桌面 LLM |
| `Application.*` | listApps / focusApp / launchApp | 应用切换 |
| `Browser.*` | newTab / closeTab / navigate | 浏览器控制 |
| `Clipboard.*` | get / set / history | 跨设备剪贴板 |
| `Desktop.*` | screenshot / lockScreen | 桌面查询 |
| `Extension.*` | invokeSkill / listSkills | 调任意 139 skill |
| `File.*` | read / write / search | 文件操作（审批）|
| `Input.*` | type / click / press | 输入注入 |
| `Knowledge.*` | search / createNote / annotate | 知识库 |
| `Security.*` | sign / verify | 签名（生物识别）|
| `System.*` | shutdown / restart | 系统（审批）|
| `Workflow.*` | run / status | 工作流 |

ApprovalUI 4 类审批：

| 类别 | 用途 | 审批方式 |
|---|---|---|
| Sign | DID 签名 / 跨链交易 | 生物识别 + payload 摘要 |
| Cowork | 多智能体调用本机 | 一次性 / 永久信任 |
| Marketplace | 安装第三方 skill | 权限清单 + 来源验证 |
| SystemCritical | 关机 / 删文件 / 改系统设置 | 二次确认 + 输入 yes 文本 |

## 系统架构

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                          Android 端 (Kotlin + Compose)                        │
│  ┌──────────────────────────────────────────────────────────────────────┐    │
│  │  L1 钱包 (core-did + core-security)                                  │    │
│  │   ├─ StrongBoxKeyStore (HSM)         ←── BiometricPrompt 解锁         │    │
│  │   ├─ Bip39Mnemonic                                                   │    │
│  │   └─ DIDManager (key/web/ion)                                        │    │
│  └──────────────────────────────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────────────────────────────┐    │
│  │  L2 移动捕获 (feature-ai + feature-knowledge)                        │    │
│  │   ├─ VoiceModeService (ForegroundService)                             │    │
│  │   ├─ CameraOCRViewModel + 豆包 Vision Client                          │    │
│  │   ├─ LocationTaggerService (ForegroundService)                        │    │
│  │   ├─ ShareReceiverActivity → SharePayloadDispatcher                   │    │
│  │   └─ NotificationChannel + FCMReceiver                                │    │
│  └──────────────────────────────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────────────────────────────┐    │
│  │  L3 REMOTE (core-p2p + feature-collaboration)                        │    │
│  │   ├─ RemoteCommandRouter ←── envelope dispatcher                     │    │
│  │   ├─ RemoteSkillRegistry (method-level whitelist)                    │    │
│  │   ├─ ApprovalUI 4 类 dialog                                          │    │
│  │   └─ TaskProgressCommandRouter (reverse-RPC)                         │    │
│  └──────────────────────────────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────────────────────────────┐    │
│  │  传输层 (core-p2p)                                                   │    │
│  │   ├─ SignalClient (WebSocket → signaling-relay)                      │    │
│  │   ├─ WebRTCClient + DataChannel                                      │    │
│  │   ├─ PairedDesktopsStore (Room 持久化)                                │    │
│  │   ├─ TerminalRpcClient + SignalingRpcClient                          │    │
│  │   └─ SyncManager (5 ResourceType + tombstones)                       │    │
│  └──────────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────────┘
                              ↕ (LAN ws / WAN wss / WebRTC DC)
┌──────────────────────────────────────────────────────────────────────────────┐
│                            Desktop (Electron 主进程)                          │
│   ├─ MobileBridge (WS gateway)                                                │
│   ├─ MobileSignClient (M5 SignAsService)                                      │
│   ├─ MobileApprovalChannel / MobileApprovalTransport (M4 D2)                  │
│   ├─ MobileSkillWhitelist (method-level)                                      │
│   ├─ PtyManager (远程终端 node-pty)                                            │
│   ├─ RelayClient + handlePairAckFromRelay                                     │
│   └─ Sync walker × 5 ResourceType                                             │
└──────────────────────────────────────────────────────────────────────────────┘
                              ↕
┌──────────────────────────────────────────────────────────────────────────────┐
│        signaling-relay (Node.js, wss://signaling.chainlesschain.com)          │
│        coturn 4.6 (turn.chainlesschain.com, HMAC-SHA1 24h TTL)                │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 25 Gradle 模块

- **app**: 主应用入口
- **core × 9**: core-common / core-database / core-network / core-security / core-p2p / core-did / core-e2ee / core-ui / core-blockchain
- **feature × 13**: feature-auth / feature-knowledge / feature-ai / feature-p2p / feature-project / feature-file-browser / feature-blockchain / feature-enterprise / feature-knowledge-graph / feature-mcp / feature-hooks / feature-collaboration / feature-performance
- **data × 2**: data-knowledge / data-ai
- **wear-app**: 独立 APK，与 :app 不共享 lib

## 安装

### 下载入口

[官方下载页](https://www.chainlesschain.com/mobile/#download)。每个桌面 release tag（如 `v5.0.3.54`）同时挂 4 个 Android 包：

| 包名 | 适用 | 大小（约）|
|---|---|---|
| `app-arm64-v8a-release.apk` | 现代主流 Android 手机（2017 后）| 82 MB |
| `app-armeabi-v7a-release.apk` | 老 ARM 32 位设备 | 59 MB |
| `app-universal-release.apk` | 不确定架构 / 多机切换分发 | 124 MB |
| `app-release.aab` | Google Play 上架用（普通用户不下）| 71 MB |

### APK 安装步骤

1. 手机浏览器打开 [release 页面](https://github.com/chainlesschain/chainlesschain/releases/latest)
2. 下载对应 APK
3. 系统提示"未知来源应用"——开启对应权限（设置 → 应用 → 你的浏览器 → 允许安装应用）
4. 点击 APK 完成安装
5. 首次启动会请求权限：相机 / 麦克风 / 位置 / 通知 / 存储——按需授权

### 系统要求

- Android 8.0+（API 26+）
- 推荐 Android 12+（StrongBox HSM 需 Android 9+，强制 biometric 需 Android 10+）
- 必需权限：网络
- 推荐权限：相机 / 麦克风 / 位置 / 通知 / 存储（按需启用 L2 捕获）

## 首次设置：W3.7 Flow B 扫码配对

::: tip 一句话
桌面显二维码 → 手机相机扫 → 1 秒配对完成。跟微信 / 支付宝 / Discord / WhatsApp Web 一个套路。
:::

### 为什么走"手机扫桌面"而不是反过来

| 维度 | Flow B（手机扫桌面）✅ 默认 | Flow A（桌面扫手机）|
|---|---|---|
| 识别率 | 手机摄像头扫大屏，10ms 出码 | webcam 扫小手机屏，需对焦 + 多次尝试 |
| 用户心智 | 微信 / 支付宝 / Discord 同套路 | 反直觉 |
| webcam 依赖 | 不需要 | 桌面必须有 webcam |
| Signal e2ee | 不需要 | 需要协议握手 |

Flow A 保留为高级路径。

### 标准操作流程

**桌面端**：

1. 启动 ChainlessChain 桌面
2. 设置 → 同步 → "扫描手机扫描我"（V5）或 V6 工具栏"配对"
3. 桌面端生成 QR 码（含 `pcPeerId` / TTL 60s / 一次性 nonce）

**Android 端**：

1. 启动 App，设置 → "扫描桌面 QR"（推荐入口）
2. 授予相机权限（首次）
3. 对准桌面屏幕的 QR 码 → ML Kit 自动识别 → 自动建立 signaling 通道
4. 桌面端弹"匹配设备：<手机型号> <时间> ——确认 / 拒绝"
5. 桌面确认后，手机端跳"已配对桌面"列表

### 配对的安全模型

- **trustLevel 三档**：`paired`（信令握手成功）/ `full`（用户在桌面端确认）/ `revoked`（用户解绑）
- 大部分敏感操作（远程终端 / REMOTE / sync）要求 `full`
- 手机被劫持也只能发请求，桌面才是 trust anchor — 高危操作必须在桌面端二次确认

## 远程终端（Android 操控桌面 PTY）

::: tip
专题文档：[远程终端 Plan A 用户指南](./remote-terminal.md)
:::

### 能做什么 vs 不能做什么

**能做**：

- 在手机里看到桌面新开 shell 的输出
- 输入任意 CLI 命令（cc / claude / git / npm / kubectl / docker / pytest）
- 跨 shell 一致：pwsh / cmd / bash / wsl 都行
- 断连重连自动补帧（256KB ring buffer + `terminal.history` 按 `seq` 补帧）

**不能做**：

- 操作桌面已经打开的外部终端（OS 不允许跨进程 attach）
- 跑 GUI 程序（PTY 只能跑 CLI）

### v5.0.3.54 收口的 6 个真因 bug

v5.0.3.53 协议链路是通的，但真机 E2E 压出 6 个独立 root cause bug。v5.0.3.54 一次性扫净：

| # | bug | 真因 | 修法 | 提交 |
|---|---|---|---|---|
| 1 | WebRTC echo loop | `sendOffer` 误把 target peerId 写进 self `currentPeerId` → WS 重连 auto-re-register 把 mobile 注册成桌面 → 消息路由回自己 | `currentPeerId` 只在 `register()` 写 | `b50552574` |
| 2 | 中继 from 字段未注入 | signaling-relay handleMessage 只校验 to 不补 from → desktop 回包 `to=undefined` 被 reject 死循环 | `msg.from = ws._peerId` | `e65c278ae` |
| 3 | iceServers 24h TTL 过期跨 NAT 全断 | 一次性 push 后没刷新机制 | `maybeRefreshIceForMobile` 12h 节流 LAN + relay 双发 | (内嵌) |
| 4 | WebView 0 高死锁（"黑屏"真因）| AndroidView 默认 WRAP_CONTENT + HTML body height:100% → 父级 0 高 → xterm.fit() 返回 cols=49 rows=1 → 桌面 PTY 被 resize 成 1 行 | `LayoutParams MATCH_PARENT` + ResizeObserver + DOM `clientWidth/Height` guard | `8d3c95df6` |
| 5 | cc / claude 命令找不到 | PtyManager `pty.spawn` 无 args → bash/wsl 不走 login mode → `~/.bashrc` 不加载 → 用户全局 CLI 找不到 | 返回 `{cmd, args}` 元组，bash 加 `-l`，shell=bash 优先 probe `Program Files/Git/bin/bash.exe` 避免 WSL 拦截 | `f54a6fcd0` |
| 6 | TerminalListViewModel closure shadow | `onSuccess` 闭包参数 `it`（CreatedSession）被内层 `_state.update` 的 `it`（state）shadow → `lastCreatedId` 永远不更新 | 改用 named param `created.sessionId` + LaunchedEffect 自动 navigate | (内嵌) |

## 桌面 ↔ Android 双向同步（Phase 3d v1.3）

### 同步资源类型

5 类（+ tombstones）：

| 类型 | 内容 | 双向 / 单向 |
|---|---|---|
| Note | 笔记（标题 / Markdown 正文 / tags）| 双向 |
| Conversation | LLM 对话记录 | 双向 |
| DID | DID 文档 / 公钥 | 双向（私钥不走线）|
| Community | 加入的社区元数据 | 双向 |
| Channel | 频道订阅 + 已读位置 | 双向 |
| Tombstones | 删除标记 | 双向 |

### 同步触发时机

| 时机 | 行为 |
|---|---|
| App 启动 + 进入"已配对"卡片 | 主动 pull |
| 桌面端新写入 | 桌面主动 push |
| 手动 | 设置 → 同步 → 立即同步 |
| 定时 | 30 分钟后台 worker，仅 wifi |

### 安全模型

- gate 1–4 全部 strict Ed25519 验签
- 私钥不离手机，密码不上线
- envelope 必须签名 + 时间戳防 replay
- Tombstone 也签名，防止"删除"被伪造

## 远程操控架构（Plan A / B / C 三段位）

| Plan | 路径 | 适用 | 延迟 | 吞吐 |
|---|---|---|---|---|
| **Plan C** 信令转发 | signaling-relay JSON-RPC 2.0 转发 | 点按钮发单条命令、列设备、查状态 | 100-400ms | 低 |
| **Plan A** WebRTC DC | 手机 ↔ 桌面 P2P DC 直连 | 远程终端 stdout 流、长命令 | 30-80ms LAN / 50-200ms TURN | 高 |
| **Plan B** STUN+TURN | NAT 穿透回落 | 双 NAT / 蜂窝运营商 / 防火墙重 | 50-200ms | 中 |

### Plan A.1 升级动机（v5.0.3.53）

v5.0.3.52 Plan A 真机首测暴露**架构性问题**：4 跳信令链路（手机 → 路由器 → 公网中继 → 桌面 RelayClient），任一跳断即整体失败。

修法：高频高吞吐的终端流量切到 **WebRTC DataChannel 直连**，绕开中间所有跳；signaling 路径保留兜底。

#### Phase 1-5 拆分

| Phase | 内容 |
|---|---|
| Phase 1 Trap 1 修 | `SignalClient.forwardedMessages` 改 multi-subscribe SharedFlow；`WebRTCClient.dataChannelReady StateFlow`（READY 才真意味 DC OPEN）|
| Phase 2 DC fast path | `SignalingRpcClient.invoke` 内置 transport selector；两路 listener 同 `requestId` 同 `CompletableDeferred`|
| Phase 3 触发 + UI | `TerminalListViewModel` 进屏异步触发 connect；chip 显示 "P2P 直连"（绿）vs "中继路径"（黄）|
| Phase 4 双向 LRU 去重 | Android 256-LRU + 桌面 128-LRU / 30s-TTL |
| Phase 5 零新代码 | DC 失效 fallback / 自动重建 / 恢复切回 都是 Phase 2 既有 wiring 副产物 |

#### 5 场景验收矩阵

| 场景 | 网络 | 结果 |
|---|---|---|
| 同 LAN | adb reverse 或同 wifi | DC 直连，RTT 30-80ms |
| 蜂窝 4G/5G | 手机 4G 桌面办公网 | DC 不通则 TURN，RTT 50-200ms |
| 双 NAT | 家用宽带 ↔ 公司办公网 | 必经 TURN，RTT 80-300ms |
| DC 强制失效 | adb 屏蔽 UDP | 自动 fallback signaling，RTT 200-500ms |
| DC 恢复 | 解封 UDP | 自动切回 DC（5-15s）|

### TURN 部署

- coturn 4.6 部署 `turn.chainlesschain.com`
- 端口：UDP/TCP 3478 + TCP 5349（TLS）+ UDP 49152-65535（relay 段）
- Let's Encrypt acme.sh 自动续证
- HMAC-SHA1 use-auth-secret 24h TTL ephemeral 凭证（不预分配账号 / 密码）
- 阿里云安全组需开 UDP/TCP 3478 / TCP 5349 / UDP 49152-65535 全 `0.0.0.0/0`

## 社交功能（v5.0.3.53 产线化）

14 屏 + 9 ViewModel + 4 Repository 的社交骨架（约 10K LOC）建好已久，v5.0.3.53 前只有 MyQRCode / QRCodeScanner 两路由真接通；v5.0.3.53 一次性收口。

### NavGraph 7 占位换实屏 + 2 新路由

- PublishPost / PostDetail / FriendDetail / UserProfile / AddFriend / CommentDetail / EditPost
- 新增：NotificationCenter / BlockedUsers

### SocialScreen 三 tab 升级

| Tab | 之前 | 之后 |
|---|---|---|
| Friends | 固定字串 | FriendListScreen |
| Timeline | 固定字串 | TimelineScreen（myDid 走 DIDViewModel）|
| Notifications | 固定字串 | NotificationCenterScreen（筛选 / 批量已读 / 清理菜单）|

## 配置参考

### Android Build Config

`android-app/version.properties`：

```properties
versionCode=100
versionName=1.0.0
applicationId=com.chainlesschain.client
minSdkVersion=26
targetSdkVersion=35
compileSdkVersion=35
```

### Hilt DI 配置（DIDManager）

```kotlin
@Singleton
class DIDManager @Inject constructor(
    private val keystore: StrongBoxKeyStore,
    private val didStorage: DIDStorage,
    private val mnemonicEncoder: Bip39Mnemonic,
    @ApplicationContext private val ctx: Context,
) {
    suspend fun createDID(passphrase: String? = null): Result<DIDDocument> {
        // StrongBox-backed Ed25519 key + BIP-39 mnemonic
    }

    suspend fun signWithBiometric(didId: String, payload: ByteArray): Result<Signature> {
        // BiometricPrompt 解锁 → StrongBox 出签
    }
}
```

### 桌面端 `.chainlesschain/config.json`（Android-related）

```json
{
  "terminal": {
    "shellWhitelist": ["pwsh", "cmd", "bash", "wsl"],
    "defaultShell": "pwsh",
    "defaultCwd": "${HOME}",
    "maxConcurrentSessions": 8,
    "ringBufferBytes": 262144,
    "idleKillHours": 24
  },
  "mobile": {
    "iceServersRefreshHours": 12,
    "pairAckTimeoutMs": 30000,
    "syncWalkerBatchSize": 50,
    "approvalTimeoutMs": 60000,
    "biometricRequired": true
  },
  "signaling": {
    "relayUrl": "wss://signaling.chainlesschain.com",
    "turnUrl": "turn:turn.chainlesschain.com:3478",
    "turnSecret": "${CC_TURN_SECRET}",
    "iceTtlHours": 24
  }
}
```

### RemoteSkillRegistry seed 配置

```kotlin
data class RemoteSkillMetadata(
    val namespace: String,          // "AI" / "Knowledge" / "Application" ...
    val action: String,             // "summarize" / "search" ...
    val riskLevel: RiskLevel,       // LOW / MEDIUM / HIGH
    val riskOverride: RiskLevel?,   // 特定方法手动调整
    val aliases: List<String>,      // 兼容窗口（1 版）
    val requiresBiometric: Boolean,
    val description: String,
)

// 例：
val aiSummarize = RemoteSkillMetadata(
    namespace = "AI",
    action = "summarize",
    riskLevel = RiskLevel.LOW,
    riskOverride = null,
    aliases = listOf("ai.summarize"),
    requiresBiometric = false,
    description = "对桌面端任意文本调 LLM 做摘要",
)
```

## 性能指标

### 远程操控延迟

| 路径 | RTT p50 | RTT p99 | 稳定性 |
|---|---|---|---|
| Plan A（v5.0.3.52，纯 signaling）| 200-500ms | 1.5-30s timeout | 20s-2min 间歇断 |
| **Plan A.1（v5.0.3.53+，DC 直连）LAN** | **30-80ms** | **200-800ms** | **数小时持续** |
| Plan A.1 TURN（蜂窝 / 双 NAT）| 50-200ms | 800ms-2s | 数小时持续 |
| Plan B 强制 TURN（DC 失效）| 200-500ms | 1-3s | 数小时持续 |
| Plan C 信令转发 | 100-400ms | 1-5s | 数小时持续 |

### 端侧响应时间

| 操作 | 目标 | 实际 |
|---|---|---|
| StrongBox 签名（一次）| < 200ms | ~80ms（Pixel 6）/ ~150ms（中端机）|
| 助记词派生 BIP-39 | < 500ms | ~200ms |
| DID 切换 | < 50ms | ~30ms |
| QR 扫描识别（ML Kit）| < 100ms | ~50ms |
| 远程终端 stdout 渲染（xterm.js）| < 16ms / frame | 60fps 不卡 |
| OCR 拍照入笔记（豆包视觉）| < 3s | ~1.5s（wifi）|

### 资源占用

| 指标 | 数值 |
|---|---|
| App 安装包（arm64-v8a）| 82 MB |
| App 启动后内存（idle）| 80-120 MB |
| App 启动后内存（远程终端 active）| 150-200 MB |
| 单 session ring buffer | 256 KB |
| Room 数据库（5 ResourceType + tombstones，1000 条）| ~5 MB |
| 后台耗电（idle，foreground service off）| < 1% / 小时 |
| 后台耗电（LocationTagger ON）| 3-5% / 小时 |

### 可扩展性

| 限制 | 数值 |
|---|---|
| 最大配对桌面数 | 10 |
| 单桌面最大并发 session 数 | 8 |
| RemoteSkillRegistry seed 容量 | 200 method |
| Sync 单批最大资源数 | 50 |
| FCM 单次推送最大 payload | 4 KB |

## 测试覆盖率

### 单元测试（383+ 用例）

```
✅ core-did 测试         — 68 用例（DIDManager / StrongBoxKeyStore / BIP-39）
✅ core-security 测试    — 30 用例（SecurityChecker / 加密 / 生物识别）
✅ core-p2p 测试         — 51 用例（SignalClient / WebRTCClient / SyncManager）
✅ feature-ai 测试       — 30 用例（VoiceModeService / CameraOCR / SeedASRClient）
✅ feature-knowledge 测试 — 36 用例（ShareReceiver / SharePayloadDispatcher / NoteRepository）
✅ M5 SignAsService 测试  — 33 用例（反向签名协议 + 桌面 → 手机 RPC）
✅ M4 D1 method-level 测试 — 8 用例（RemoteSkillRegistry / MobileSkillWhitelist）
✅ M4 D2 桌面胶水测试    — 10 集成 + 30 单元（MobileApprovalChannel / Transport）
✅ Phase 3d 同步测试     — 6 core-p2p + 14 feature-p2p + 8 core-database
✅ Plan A.1 测试         — Android 8（dedup 3 / transport 4 / Trap 1）+ 桌面 14
✅ 社交收口测试         — 39 用例（11 NavGraph + tab 结构 + 8 PostReportDao）
✅ W3.7 扫码配对测试    — 29 用例（ScanDesktopPairingViewModel 10 + desktop-pair-handlers 19）
```

**总覆盖率**: ~85%，383+ 测试用例全绿，不需要模拟器（JVM only）。

### 真机 E2E 测试

- ✅ Xiaomi 24115RA8EC × Windows git-bash（W3.7 配对 + Plan A 远程终端 + Plan A.1 DC 直连）
- ✅ Pixel 6+ 内部测试（StrongBox 全功能 + 多 DID 切换）
- ✅ 三星 Galaxy S20+（M3 LocationTagger 后台保活）
- 🚧 M3 D-voice / D-camera 真机（v1.0 GA 后用户出场）
- 🚧 M3 D-push FCM（待 google-services.json）
- 🚧 M4 D2 真机 E2E（桌面 JVM-integration 10 绿，差最后一公里）

### CI 工作流

- `.github/workflows/android-tests.yml` — JVM 单测全跑
- `.github/workflows/android-ci.yml` — 不跑 `:app` 模块（耗时长）
- `.github/workflows/android-pr-check.yml` — PR 触发，concurrency cancel-in-progress
- Instrumented 测试（26+33）设 `continue-on-error: true` 故意 mask AVD ADB infra flake

## 安全考虑

### 私钥安全

1. **StrongBox HSM 隔离** — Android 9+ 强制 Titan M / 高通 SPU 芯片层保管
2. **私钥永不导出** — Android Keystore API 设计上禁导出
3. **生物识别强 tier** — FAR ≤ 1/50,000，多次失败自动锁
4. **旧明文密钥迁移** — App 启动检测 v0.x 明文密钥 → 自动迁 StrongBox + 删原文件
5. **助记词不落盘** — 显示一次（写在纸上），App 不存
6. **多 DID 隔离** — 工作 / 个人 / 匿名 独立 keypair，不共密钥

### 传输安全

1. **全链路 Ed25519** — envelope 必签名 + 时间戳防 replay
2. **WebRTC DTLS 1.2** — DataChannel 内置端到端加密
3. **TURN HMAC-SHA1** — 24h TTL ephemeral 凭证，不预分配账号
4. **trustLevel 三档** — paired（握手）/ full（用户确认）/ revoked
5. **trust anchor 在桌面** — 手机被劫持只能发请求，高危操作必须在桌面端二次确认
6. **iceServers 12h 节流刷新** — 跨 24h TTL 仍可保 TURN 可用

### 数据安全

1. **Room 数据库不加密**（默认）— 敏感数据走 EncryptedSharedPreferences
2. **EncryptedSharedPreferences** — AES-256-GCM with master key in StrongBox
3. **同步 envelope 必验签** — gate 1-4 strict mode 拒绝任何 invalid 签名
4. **Tombstone 也签名** — 防止"删除"被伪造跨设备投毒

### 远程操控安全

1. **RemoteSkillRegistry method-level 白名单** — 默认拒绝，需显式注册
2. **ApprovalUI 4 类** — Sign / Cowork / Marketplace / SystemCritical 桌面端 dialog
3. **生物识别强制** — Sign / SystemCritical 类必须 BiometricPrompt
4. **高危关键字拦截** — 远程终端 `rm -rf` / `format` / `shutdown` / fork bomb 必弹桌面确认
5. **Shell 白名单** — `terminal.shellWhitelist` 配，不在表内的 shell 直接拒
6. **session 24h idle kill** — 防遗忘 session 占资源

### 推送通知安全

1. **本地通知不可绕过** — Android 系统级
2. **FCM payload 加密** — 待 GA 后接 `google-services.json`，端到端 AES
3. **通知 deep link 验签** — payload 含 Ed25519 签名，验签失败丢弃

## 故障排查

### 安装 / 启动

| 现象 | 原因 | 修法 |
|---|---|---|
| APK 安装提示"未知来源"| Android 默认禁第三方源 | 设置 → 应用 → 浏览器 → 允许安装应用 |
| 启动闪退 | 架构不匹配 | 下载 universal 包 |
| 启动报"DID 钱包初始化失败"| StrongBox 不支持（老机器）| App 自动降级 TEE，不影响功能但安全等级低一档 |
| MIUI 杀后台 | MIUI 激进省电 | 设置 → 自启动 + 后台弹窗权限 |
| Huawei 收不到推送 | 无 GMS | 待接入 HMS |

### 配对

| 现象 | 原因 | 修法 |
|---|---|---|
| 扫码无反应 | QR 过期（>60s）| 桌面"刷新 QR" |
| 桌面没收请求 | signaling-relay 不通 / 防火墙 | 桌面 `cc doctor` 检查 `wss://signaling.chainlesschain.com` |
| 配对成功列表不刷 | v5.0.3.52 前 `my_role` 字段 shape 错 | 升级到 v5.0.3.52+ |
| Xiaomi QR 卡死 | MIUI 后台权限 | 开"自启动" + "后台弹窗权限" |
| 一直显示 "等待桌面确认"| 桌面弹窗被遮挡 | 在桌面 systray 看通知 |

### 远程终端 / 操控

| 现象 | 原因 | 版本 |
|---|---|---|
| 终端黑屏 0 cols × 1 rows | WebView 0 高死锁 | v5.0.3.54 修 |
| `cc` 命令找不到 | bash 不走 login mode | v5.0.3.54 修 |
| WebRTC echo loop | mobile 注册成 desktop peerId | v5.0.3.54 修 |
| iceServers 24h 后失效 | 没自动 refresh | v5.0.3.54 修（12h 节流刷新）|
| signaling 反复重连 | from 字段未注入 | v5.0.3.54 修 |
| TUI（vim / tmux）打字卡 | signaling 路径延迟高 | 用 Plan A.1 DC 直连（v5.0.3.53+）|
| 长时任务面板不显示 | M4 D2 真机 E2E 待补 | 见 v1.0_GA_checklist |

### 同步

| 现象 | 原因 | 修法 |
|---|---|---|
| 永久"等待" | sync.\* WS handler 没注册 | 桌面升级到 v5.0.3.40+ |
| 部分类型缺 | listTombstones SQL filter 错 | 升级 |
| `auth` null 报错 | 老桌面要求 non-nullable | 升级 |
| 桌面无 device 记录 | Android 用 P2P session DID 兜替 | 确认 pair 时桌面看到了 |

### 调试模式

```kotlin
// MainApplication.kt
@HiltAndroidApp
class MainApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        if (BuildConfig.DEBUG) {
            Timber.plant(Timber.DebugTree())
            // 启用 OkHttp logging
            HttpLoggingInterceptor().apply { level = HttpLoggingInterceptor.Level.BODY }
        }
    }
}
```

查看 Android logcat 关键 tag：

```bash
adb logcat -s SignalClient WebRTCClient TerminalRpcClient SyncManager DIDManager
```

## 关键文件

### Android 核心模块

| 文件 / 模块 | 职责 | 概况 |
|---|---|---|
| `android-app/app/` | 主应用入口 + DI 配置 | MainActivity / Application |
| `android-app/core-common/` | 通用基础 | ResourceProvider / DispatcherProvider |
| `android-app/core-database/` | Room DB + Migration | 5 ResourceType + tombstones DAO |
| `android-app/core-network/` | OkHttp + Retrofit | API client |
| `android-app/core-security/` | 安全检查 + 加密 | `SecurityChecker.kt` (443 行) |
| `android-app/core-did/` | DID 生成 / 签名 / 管理 | DIDKeyGenerator / DIDSigner / DIDManager |
| `android-app/core-p2p/` | P2P + WebRTC + Sync | `SignalClient.kt` / `WebRTCClient.kt` / `SyncManager.kt` |
| `android-app/core-e2ee/` | Signal Protocol E2E | Pre-key bundle / Session |
| `android-app/core-ui/` | 共享 Compose 组件 | Theme / Common Composables |
| `android-app/core-blockchain/` | 区块链交互 | 跨链桥接 |

### feature 模块（13 个）

| 模块 | 职责 |
|---|---|
| `feature-auth/` | 登录 / 注册 / 助记词导入导出 |
| `feature-knowledge/` | 笔记 / 知识库 / ShareReceiver |
| `feature-ai/` | LLM / VoiceMode / CameraOCR |
| `feature-p2p/` | 配对 / 同步 / 设备管理 |
| `feature-project/` | 项目管理 |
| `feature-file-browser/` | 文件浏览 + EnhancedCodeEditor |
| `feature-blockchain/` | 钱包 UI / 交易 |
| `feature-enterprise/` | RBAC / 组织 / 审计 |
| `feature-knowledge-graph/` | KG 可视化 |
| `feature-mcp/` | MCP 协议客户端 |
| `feature-hooks/` | 钩子 / 自动化 |
| `feature-collaboration/` | 社交 / 远程操控 / 远程终端 |
| `feature-performance/` | 性能监控 |

### 桌面端配套文件

| 文件 | 职责 |
|---|---|
| `desktop-app-vue/src/main/p2p/mobile-bridge.js` | 移动端 WS gateway + bridgeToLibp2p |
| `desktop-app-vue/src/main/p2p/desktop-pair-handlers.js` | 配对处理 + iceServers 推送 |
| `desktop-app-vue/src/main/p2p/mobile-approval-channel.js` | M4 D2 审批通道 |
| `desktop-app-vue/src/main/p2p/mobile-approval-transport.js` | 审批 RPC transport bridge |
| `desktop-app-vue/src/main/p2p/mobile-sign-client.js` | M5 SignAsService 客户端 |
| `desktop-app-vue/src/main/terminal/pty-manager.js` | 远程终端 node-pty 托管 |
| `desktop-app-vue/src/main/terminal/terminal-handlers.js` | terminal.\* envelope 处理 |
| `signaling-relay/server.js` | wss://signaling.chainlesschain.com 中继 |

### 设计文档

| 文件 | 职责 |
|---|---|
| `docs/design/Android_重新定位_设计文档.md` | 主文档（693 行）— L1/L2/L3 + M1-M7 |
| `docs/design/Android_W3_Pairing_E2E.md` | 配对协议（329 行）|
| `docs/design/Android_Remote_Terminal_Plan_A.md` | 远程终端（359 行）|
| `docs/design/Android_Remote_Terminal_Plan_A1.md` | DC 直连升级（461 行）|
| `docs/design/Android_Remote_Operate_Plan_AB.md` | WebRTC + TURN（199 行）|
| `docs/design/Android_Remote_Operate_Plan_C.md` | 信令转发（180 行）|
| `docs/design/Android_Social_Wiring_2026-05.md` | 社交产线化（278 行）|
| `docs/design/Android_REMOTE_commands_inventory.md` | 23 命令清单（209 行）|
| `docs/design/Android_M3_Real_Device_Test_Plan.md` | M3 真机测试（197 行）|
| `docs/design/Android_M4_D2_E2E.md` | M4 D2 真机 E2E（183 行）|
| `docs/design/Android_M6_Performance_Validation.md` | M6 性能验证（192 行）|
| `docs/design/phase3d-mobile-sync.md` | Phase 3d 同步设计 |
| `docs/v1.0_GA_checklist.md` | GA 剩 5 项用户出场清单 |

## 使用示例

### 创建第一个 DID

```kotlin
// MainActivity.kt 或任意 ViewModel
viewModelScope.launch {
    didManager.createDID(passphrase = null)
        .onSuccess { doc ->
            Log.d("DID", "Created: ${doc.id}")
            // 把助记词显示给用户备份
            val mnemonic = doc.mnemonic
            displayMnemonicScreen(mnemonic)
        }
        .onFailure { e ->
            Log.e("DID", "Create failed", e)
            showError("StrongBox unavailable, falling back to TEE")
        }
}
```

### 调桌面远程 skill（L3 REMOTE）

```kotlin
// 例：调桌面 AI.summarize
val request = RemoteCommandRequest(
    namespace = "AI",
    action = "summarize",
    params = mapOf("text" to longText),
    requireBiometric = false,
)

remoteCommandClient.invoke(desktopPeerId, request)
    .onSuccess { result ->
        val summary = result.data["summary"] as String
        showSummary(summary)
    }
    .onFailure { e ->
        when (e) {
            is ApprovalDeniedException -> showError("桌面用户拒绝")
            is BiometricFailedException -> showError("生物识别失败")
            is TimeoutException -> showError("桌面无响应")
            else -> showError("调用失败: ${e.message}")
        }
    }
```

### 远程终端创建 + 输入

```kotlin
// 1. 创建 session
val session = terminalRpcClient.create(
    peerId = desktopPeerId,
    shell = "bash",
    cwd = "/c/code/test1",
).getOrThrow()

// 2. 订阅 stdout
viewModelScope.launch {
    terminalRpcClient.stdoutFlow(session.sessionId).collect { chunk ->
        webView.evaluateJavascript(
            "term.write('${chunk.escapeJs()}')",
            null
        )
    }
}

// 3. 发送 stdin（含 Ctrl+C = \x03）
terminalRpcClient.stdin(session.sessionId, "claude\n")
```

### 接 Android 系统分享意图

```kotlin
// AndroidManifest.xml
<activity android:name=".ShareReceiverActivity">
    <intent-filter>
        <action android:name="android.intent.action.SEND" />
        <category android:name="android.intent.category.DEFAULT" />
        <data android:mimeType="text/*" />
        <data android:mimeType="image/*" />
    </intent-filter>
</activity>

// ShareReceiverActivity.kt
class ShareReceiverActivity : ComponentActivity() {
    @Inject lateinit var dispatcher: SharePayloadDispatcher

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val payload = SharePayload.fromIntent(intent)
        lifecycleScope.launch {
            dispatcher.dispatch(payload)
                .onSuccess { route -> navigateTo(route) }
                .onFailure { e -> showError(e.message) }
        }
    }
}
```

### 同步资源

```kotlin
// 主动触发一次完整 sync
syncManager.syncAll(desktopPeerId)
    .collect { progress ->
        when (progress) {
            is SyncProgress.Pulling -> showStatus("拉取 ${progress.resourceType} ...")
            is SyncProgress.Pushing -> showStatus("推送 ${progress.resourceType} ...")
            is SyncProgress.Done -> showStatus("同步完成：${progress.stats}")
            is SyncProgress.Error -> showError(progress.error.message)
        }
    }
```

### CLI 端配套（cc）

```bash
# 桌面端查配对设备
cc p2p list-paired

# 主动触发 sync（替代 GUI 按钮）
cc sync mobile <peerId>

# 启动远程终端 web shell（cc ui 模式）
cc ui --port 9001
# 访问 http://localhost:9001/terminal
```

## 版本历史

| 版本 | 日期 | 重点 |
|---|---|---|
| v1.0.0 (`v5.0.3.48`) | 2026-05-12 | GA flip — ADR 8/8 / M1-M5 全落 / 383 单测 |
| `v5.0.3.50` | 2026-05-13 | Plan C 信令转发 RPC（远程操控先通），20 单测 |
| `v5.0.3.51` | 2026-05-13 | Plan A+B 基础设施 — TURN 部署 + iceServers 异步推送 |
| `v5.0.3.52` | 2026-05-14 | Plan A 远程终端 — node-pty / xterm.js / 162 单测 |
| `v5.0.3.53` | 2026-05-14 | Plan A.1 — 4 跳信令砍到 1 跳 DC 直连；RTT p50 30-80ms |
| `v5.0.3.54` | 2026-05-14 | 远程终端真机收口 — 6 root cause bug 一次扫净；地铁里能跑 cc/claude |

完整 changelog：[CHANGELOG.md](https://github.com/chainlesschain/chainlesschain/blob/main/CHANGELOG.md)。

## 相关文档

### 用户文档

- [远程终端 Plan A 用户指南 →](./remote-terminal.md)
- [桌面 V6 对话壳 →](./desktop-v6-shell.md)
- [社交协议生态 →](./social-protocols.md)
- [快速开始 →](./getting-started.md)

### 设计文档（开发者）

- [Android 重新定位 v0.8（主文档）](https://github.com/chainlesschain/chainlesschain/blob/main/docs/design/Android_重新定位_设计文档.md) — L1/L2/L3 三层模型 + M1-M7 milestones + ADR 8 项
- [Android Remote Terminal Plan A](https://github.com/chainlesschain/chainlesschain/blob/main/docs/design/Android_Remote_Terminal_Plan_A.md) — 远程终端架构
- [Android Remote Terminal Plan A.1](https://github.com/chainlesschain/chainlesschain/blob/main/docs/design/Android_Remote_Terminal_Plan_A1.md) — DC 直连升级
- [Android Remote Operate Plan A+B](https://github.com/chainlesschain/chainlesschain/blob/main/docs/design/Android_Remote_Operate_Plan_AB.md) — WebRTC + TURN
- [Android Remote Operate Plan C](https://github.com/chainlesschain/chainlesschain/blob/main/docs/design/Android_Remote_Operate_Plan_C.md) — 信令转发
- [Android W3 Pairing E2E](https://github.com/chainlesschain/chainlesschain/blob/main/docs/design/Android_W3_Pairing_E2E.md) — Flow B 扫码配对
- [Android Social Wiring 2026-05](https://github.com/chainlesschain/chainlesschain/blob/main/docs/design/Android_Social_Wiring_2026-05.md) — 社交产线化
- [Android REMOTE commands inventory](https://github.com/chainlesschain/chainlesschain/blob/main/docs/design/Android_REMOTE_commands_inventory.md) — 23 command 清单
- [Phase 3d 移动端同步](https://github.com/chainlesschain/chainlesschain/blob/main/docs/design/phase3d-mobile-sync.md)

### 真机验证 / 性能 / GA

- [Android M3 Real Device Test Plan](https://github.com/chainlesschain/chainlesschain/blob/main/docs/design/Android_M3_Real_Device_Test_Plan.md)
- [Android M4 D2 E2E](https://github.com/chainlesschain/chainlesschain/blob/main/docs/design/Android_M4_D2_E2E.md)
- [Android M6 Performance Validation](https://github.com/chainlesschain/chainlesschain/blob/main/docs/design/Android_M6_Performance_Validation.md)
- [v1.0_GA_checklist](https://github.com/chainlesschain/chainlesschain/blob/main/docs/v1.0_GA_checklist.md) — 剩 5 项用户出场清单

---

> 本文档为 Android v1.0 GA 用户参考。如需更细的设计 rationale 与代码级 walkthrough，参阅上方"设计文档（开发者）"章节链接的源文档。
