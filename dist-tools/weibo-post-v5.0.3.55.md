# 中文社交平台文案 — v5.0.3.55 发版

目标平台：微博 / 即刻 / V2EX / 少数派 / SegmentFault / 公众号摘要
角度：iOS 端镜像移植里程碑（领头）
基调：技术可信、轻语气、不打鸡血、不堆 emoji

---

## 微博版（≤ 2000 字单条；保守目标 ~800 字）

```
🚀 ChainlessChain v5.0.3.55 发布。

Android v1.0 GA 上周真机 E2E 验证通过（Xiaomi × Windows git-bash 全链路打通）。第二天 iOS 端启动镜像移植，一天内四个 Phase 框架级全部落地：

1️⃣ Phase 1 桌面配对三流 — Flow A 桌面扫手机二维码 / Flow B 手机扫桌面二维码 / 6 位数字 code 兜底，71 单测。
2️⃣ Phase 2 远程桌面终端 — WebRTC DataChannel + xterm.js WKWebView，6 method 远程 RPC，163 单测。
3️⃣ Phase 3 远程操控 framework + 4 典型 skill（剪贴板/文件浏览/截图/系统信息），~264 单测累计。
4️⃣ Phase 4 通知 skill — 11 RPC method + LRU dedup 256 + iOS 通知中心 push + 乐观更新 + 离线兜底，~313 单测累计。

"一天四 Phase" 怎么做到的？— 镜像一个已经过真机 E2E 验证的 Android 版本。UI 信息架构 1:1 对齐 Android Kotlin 屏幕，HIG 偏离限制在 6 项白名单内。Android 端真机验证的信心，直接传导到 iOS。

同批一起发的还有：
• CLI 0.162.0 minor — cc pair preflight Linux 局域网配对诊断 + cc pair token 子命令组（SSH 服务器开发场景的无 GUI 配对流程）
• 跨链桥 outbound × M-of-N 多签 provenance（Layer 1+2 共 8 PR，Q-COMP-3 真链上锚定等监管 sign-off）
• 手表 VoiceMode → 手机 forward（Wearable Data Layer，trigger_source 锁 WEAR_FORWARD 防伪）
• iOS RPC pool 2 处 continuation 泄漏 P0 修

下载：
🖥️ Win / macOS / Linux：https://github.com/chainlesschain/chainlesschain/releases/tag/v5.0.3.55
📱 Android（arm64-v8a / armeabi-v7a / universal / aab）：同上 release 页
⌨️ CLI：npm i -g chainlesschain → 0.162.0
🍎 iOS：真机 E2E 收尾中，framework 代码已 in-repo

去中心化个人 AI 系统，U盾 / SIMKey 硬件级安全。知识库 / 社交 / 交易。139 桌面 skill · 28 Android skill · 114 CLI 命令 · 8000+ 测试。

文档站：https://docs.chainlesschain.com
设计文档站：https://design.chainlesschain.com
官网：https://www.chainlesschain.com

#去中心化 #个人AI #开源
```

字数 ~810。微博放得下（2000 字限）。

---

## 即刻版（≤ 1000 字；800 字以内更舒服）

即刻用户偏好「真实感」+「过程感」，不喜欢公告腔。换种讲法：

```
v5.0.3.55 发版 — 这一版主要把 iOS 端做出来了。

背景：Android v1.0 GA 上周真机跑通，确认 framework 没问题之后，iOS 镜像移植第二天启动。结果一天之内四个 Phase 框架全落地：桌面配对（三种流：A 扫码 / B 反扫 / 6 位 code 兜底）、远程桌面终端（WebRTC DataChannel + xterm.js + WKWebView）、远程操控 framework + 4 典型 skill（剪贴板/文件/截图/系统信息）、通知 skill（11 method RPC + 桌面 push → iOS 通知中心）。累计 ~313 新单测。

为什么这么快？因为 Android 版已经过真机 E2E（Xiaomi × Windows git-bash），并不是从零设计。iOS 端做的事情是「严格 mirror 已验证版本」—— UI 信息架构 1:1 对齐 Android Kotlin 屏幕，HIG 偏离限制在 6 项白名单内。Android 端的信心，传导过来。

剩余的真机 E2E（4 个 Phase 各一轮）需要 Mac + iPhone + 真桌面，这一步移交给用户场景跑。

同批还发了：CLI 0.162.0（cc pair preflight Linux 局域网诊断 + cc pair token 无 GUI 配对，给 SSH 服务器场景）、跨链桥 m-of-n 多签 provenance、手表→手机 VoiceMode forward、iOS RPC pool 2 处 continuation 泄漏 P0 修。

下载 + 文档：
github.com/chainlesschain/chainlesschain/releases/tag/v5.0.3.55
docs.chainlesschain.com
design.chainlesschain.com（含 4 个 iOS Phase 完整设计文档）
```

字数 ~520，留白舒服。

---

## V2EX 版（节点 `/go/share` 或 `/go/programmer`）

V2EX 用户喜欢「项目简介一句话 + 改动列表 + 自我吐槽」结构，避免营销腔：

**标题**：`[发版] ChainlessChain v5.0.3.55 — iOS 端镜像移植 4 Phase 一日落地`

**正文**：

```
项目简介：去中心化个人 AI 管理系统。U盾/SIMKey 硬件级加密 + 本地 Ollama + 端到端 P2P，整合知识库、社交、交易。Electron + Vue3 桌面 + Android 原生 + 现在加上 iOS。仓库：https://github.com/chainlesschain/chainlesschain

v5.0.3.55 主要内容：

# iOS 端镜像移植（Phase 1+2+3+4 全落地）

Android v1.0 GA 上周真机跑通后，iOS 镜像移植启动。一天内：

- Phase 1 — 桌面配对三流（71 单测）：Flow A 桌面扫手机 QR / Flow B 反过来手机扫桌面 / 6 位数字 code 兜底。`PairingSignalingGate` 接口 + `PairedDesktopsStore` UserDefaults JSON 持久化。
- Phase 2 — 远程桌面终端（163 单测）：WebRTC DataChannel + xterm.js 嵌 WKWebView，6 method 远程 RPC。Phase 2 实施时回填 Phase 1 的 `SignalClient.forwardedMessages` 多订阅 AsyncStream 缺口。
- Phase 3 — 远程操控 framework + 4 典型 skill（~264 累计）：`RemoteCommandClient` 通用 RPC + `OfflineCommandQueue` UserDefaults 持久化 + 4 typed skill（剪贴板 / 文件浏览 / 截图 / 系统信息 5s 轮询）。
- Phase 4 — 通知 skill（~313 累计）：11 method RPC + LRU dedup 256 + 桌面 push 触 iOS UN Center 弹 banner + 乐观更新 + 离线 enqueue + RemoteOperateView 第 6 tab 横滚 picker + Capsule 未读 badge。

为什么一天能做完四个 Phase？答案是不刻意：Android 版已经过真机 E2E 验证（Xiaomi 24115RA8EC × Win git-bash），iOS 端「严格镜像」—— UI 信息架构 1:1，HIG 偏离 6 项白名单。

真机 E2E 验收矩阵（4 Phase × 4-8 场景）需要 Mac + iPhone + 真桌面，移交用户。

# 同批

- CLI 0.162.0 minor — `cc pair preflight` 5 项 LAN 诊断（平台 / 网卡 / multicast / 5353 port / firewall hint）+ `cc pair token generate/list/show/revoke`（one-active-DID + atomic write，给 SSH dev box 场景）+ systemd hardening 模板 + Linux 配对 9 段用户指南。
- 跨链桥 outbound × M-of-N 多签 provenance — Layer 1+2 共 8 PR：CLI `bridge --require-multisig` / `bridge-consume` + `cc_bridges` m-of-n provenance 列 + `crosschain-mtc` helpers + `verifyMultiHopBridgeEnvelope` auto-runs check。Layer 3 真链上锚定等 Q-COMP-3 监管 sign-off。
- 手表 VoiceMode → 手机 forward — Wearable Data Layer MessageClient，`trigger_source` 锁 `WEAR_FORWARD` 防伪（防 wear 端伪造 trigger_source 提权）。
- iOS RPC pool 2 处 continuation 泄漏 P0 修 — `RemoteCommandClient.invoke` withThrowingTaskGroup timeout 路径 + `RemoteWebRTCClient.waitForAnswer` pendingAnswer 清理；2 regression test + 1 集成 test 验池清干净。

# 下载

- Win/macOS/Linux 桌面 + Android 4 个 ABI APK + iOS placeholder：https://github.com/chainlesschain/chainlesschain/releases/tag/v5.0.3.55
- CLI: `npm i -g chainlesschain` → 0.162.0
- 用户文档：https://docs.chainlesschain.com
- 设计文档（含 4 个 iOS Phase 完整设计 + 9 trap memory 复盘）：https://design.chainlesschain.com

# 自我吐槽

iOS 端代码看起来"零"工作量是因为 Android 版已经踩了所有坑——9 个 Plan A.1 真机 E2E bug 复盘记录在 design 文档里，包括 WebRTC echo loop sendOffer 误把 target peerId 写进 self currentPeerId 让 WS 重连 auto-re-register 路由回自己。这些「设计正确但 implementation 细节犯错」的 latent bug 全部是 Android 端踩过、修过、收口过的，iOS 端享受现成结论。

protocol-level success ≠ product-level success——这一版主要工作其实是把 Android 端 1 年多积累的 product-level lessons 平移到 iOS。
```

字数 ~1500，V2EX 长贴正常。

---

## 少数派 / SegmentFault 摘要（投稿摘要 ≤ 200 字）

```
ChainlessChain v5.0.3.55 发布：Android v1.0 GA 真机验证后，iOS 端启动镜像移植，桌面配对、远程终端、远程操控 framework、通知 skill 四个 Phase 框架级全部落地，累计 ~313 新单测。同批 CLI 0.162.0 新增 cc pair preflight / cc pair token 子命令组（Linux SSH 场景无 GUI 配对），跨链桥支持 M-of-N 多签 provenance，手表 VoiceMode → 手机 forward，iOS RPC pool 修两处 continuation 泄漏。Win/macOS/Linux/Android 全平台同步分发。
```

字数 ~210，可投稿摘要使用。

---

## 公众号摘要（≤ 64 字标题 + ≤ 120 字摘要）

**标题候选**：
- `ChainlessChain v5.0.3.55 — iOS 端镜像移植 4 Phase 一日落地`（30 字）
- `从 Android 真机验证到 iOS 镜像移植：一天的距离`（22 字）
- `v5.0.3.55 发版：iOS 端正式加入`（17 字，最克制）

**摘要候选**（取一）：
- `Android v1.0 GA 真机验证后启动 iOS 镜像移植。桌面配对 / 远程终端 / 远程操控 framework / 通知 skill 四 Phase 一日落地，~313 新单测。同批 CLI 0.162.0 新增 Linux 无 GUI 配对子命令组。`（93 字）

---

## 选择建议

| 平台 | 推荐文案 | 投放时间（北京时间） |
|------|----------|------|
| 微博 | 微博版 | 工作日 12:00 / 21:00 |
| 即刻 | 即刻版 | 工作日 09:00 / 22:00 |
| V2EX | V2EX 版 | 工作日 10:00-11:00 |
| 少数派 / SegmentFault | 摘要版 | 投稿走编辑流程，时间无所谓 |
| 公众号 | 摘要 + 重定向 GitHub Release | 工作日 18:00-21:00 |

均不主动塞 hashtag 链。
