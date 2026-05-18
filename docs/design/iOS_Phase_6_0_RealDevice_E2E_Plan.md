# iOS Phase 6.0 真机 E2E Plan — Mac + iPhone + 真桌面

> **状态**：草案 v1.0（2026-05-18）。整个 Phase 6 sprint 收口最后一项：硬件在场跑通 15 main tab × ~75 method 真链路。
>
> **背景**：Win dev box 不能装 Swift，~1500 LOC iOS 改动只在 macOS iOS CI 编译验过（绿基线 `1fb947b32`），但 runtime 行为（DC 握手 / 流式 chunk / 跨网络往返 / iOS API 权限）从未跑过真机。本 plan 是 reproducer 清单，让 Mac + iPhone 持有者按表执行。
>
> **不在本 plan**：本地终端 (`feature-local-terminal`) E2E（Plan C 放弃 iOS local terminal，per `iOS_Local_Terminal_Spike_Decision.md`）；watchOS（Option 1 不做，per `iOS_WatchOS_Spike_Decision.md`）；签名 .ipa 发布流程（已在 `1fb947b32` 之前的 release.yml 路径验过，v5.0.3.61 .ipa 真签名 7.7MB shipped）。

---

## 0. TL;DR

- **硬件**：Mac (macOS 14+ Xcode 15) + iPhone (iOS 16+，越新越好) + Windows/macOS 桌面机一台（跑 ChainlessChain Electron）
- **网络**：iPhone + 桌面同 LAN（Wi-Fi），蜂窝可选 fallback
- **执行时间**：单次 ~3-4 小时（38 场景 + 等待 + 截屏取证）
- **产出**：(1) 通过率表 ✅/❌/⚠️ per 场景；(2) bug 清单（截屏 + 复现 + 桌面 / iPhone 日志）；(3) Plan §6 update — 标记 Phase 1.7/2.7/3.7/4.7/5.7/6.0 收口

---

## 1. Pre-flight 准备（30 min，在 Mac 上做）

### 1.1 硬件 & 软件版本核对

```bash
# Mac 上
sw_vers                      # macOS 14.x 起
xcodebuild -version          # Xcode 15.x 起
swift --version              # 5.9+

# iPhone 上 设置 → 通用 → 关于 → iOS 版本：16.0+
# 桌面机：ChainlessChain v5.0.3.X (productVersion) — Electron 39 + Vue 3
```

### 1.2 从 main 拉 iOS app 到 Mac + Xcode 打开

```bash
git clone git@github.com:chainlesschain/chainlesschain.git  # 或 git pull 若已 clone
cd chainlesschain/ios-app
open ChainlessChain.xcodeproj
# Xcode 选目标设备：左上 scheme → 你的真 iPhone（需先开发者模式 + USB 信任）
# 不行就用 simulator 跑（但 Phase 6.4 v0.3 录音 / PhotosPicker 必须真机）
```

### 1.3 签名设置（首次）

- Xcode → ChainlessChain target → Signing & Capabilities → Team = "Apple Development" 个人开发者 (free) 或团队 (`2GMR44F922`，见 memory `ios_signing_infra_state.md`)
- Bundle ID = `com.chainlesschain.ChainlessChain`
- Capabilities：Push Notifications / Camera / Microphone / Photos （Phase 6.4 v0.3 必需）

### 1.4 桌面 ChainlessChain 启动

```bash
# Win 或 Mac
cd desktop-app-vue && npm install && npm run dev
# 验证 mobile-bridge.js 监听 5050 (per memory desktop_qr_pairing_flow_b.md)
# 验证 ai-handler.js 加载 (打开 console 看 "[AIHandler] 25 method 全完成 + ... 37 method")
# 验证 knowledge-handler 加载 ("Phase 6.3 — 30 method")
```

### 1.5 iPhone 连同 Wi-Fi

iPhone 设置 → Wi-Fi → 选与桌面机同一 SSID。验：iPhone Safari 能 ping 桌面 IP。

### 1.6 iPhone 端权限预清

进 iPhone 系统设置 → ChainlessChain（首次安装后才有）：
- 麦克风 — 预设允许（Phase 6.4 v0.3 录音用）
- 相册 — 允许（Phase 6.4 OCR PhotosPicker 用）
- 相机 — 允许（Phase 1 Pairing QR scan 用）
- 通知 — 允许 + 横幅显示（Phase 4 通知 mirror 用）
- 本地网络 — 允许（mDNS / Bonjour P2P discovery）

---

## 2. 场景矩阵总览

> 38 场景跨 7 段；每段约 30 min。**串行执行**（不要跳，前置 phase 失败下游会假阳）。

| 段 | Phase | 场景数 | 时长 | 前置依赖 |
|---|---|---:|---:|---|
| **A** | 1.7 Pairing | 3 | 25 min | 桌面起 + iPhone 同网 |
| **B** | 2.7 Remote Terminal | 4 | 30 min | A 通 |
| **C** | 3.7 Remote Operate 4 skill | 4 | 30 min | A 通 |
| **D** | 4.7 Notification | 8 | 35 min | A 通 + 通知权限 |
| **E** | 5.7 AI Chat | 8 | 40 min | A 通 + 桌面 LLM (Ollama) |
| **F** | 6.0 Phase 6 主屏 skill spot-check | 6 | 25 min | A 通 |
| **G** | 6.4 v0.2/v0.3 Knowledge + AIExtended 新 UI | 5 | 30 min | A 通 + Phase 5.7 已通 |

**Total**：38 场景，约 3.5 小时。建议午后 14:00 起，留晚饭前结束。

---

## 3. 段 A — Phase 1.7 Pairing E2E (3 场景, 25 min)

参考：memory `ios_qr_pairing_three_flows.md` / `desktop_qr_pairing_flow_b.md` / design `iOS_Phase_1_Pairing_Flow_B.md` §6.5。

| # | 场景 | 通过标准 |
|---|---|---|
| A1 | Flow A QR scan | iPhone 扫桌面端 QR → ≤ 3s 出现在 "已配对桌面" 列表 + 桌面端 UI 同步显设备 |
| A2 | Flow B 手输 code | iPhone "Manual wire" 入口 → 桌面显 6 字 code → iPhone 输 → ≤ 3s 同 A1 |
| A3 | LAN→relay fallback | iPhone WiFi 关 / 开蜂窝 → 重启 app → 之前配对的桌面**仍可控**（走 signaling relay）|

**Reproducer**：
- **A1**：桌面 GUI → 我的设备 / 移动配对 → 生成 QR 显示。iPhone app → 设置 → 桌面配对 → "扫描 QR"。秒表起：从 iPhone 摄像头对准 QR 到 iPhone "已配对桌面" 列表出现新行。
- **A2**：桌面 GUI 同上 → 切 "手输 code" → 显示 6 位 code (e.g. `A3B7K9`)。iPhone app → 设置 → 桌面配对 → "手输 code" → 输入 → 提交。
- **A3**：iPhone 关 WiFi → 开蜂窝。重启 app（双击 home / swipe up）→ 进 RemoteOperate → 验任何已配对桌面**仍能进 Terminal tab 看 prompt**（说明走 relay，不是断网）。

---

## 4. 段 B — Phase 2.7 Remote Terminal E2E (4 场景, 30 min)

参考：design `iOS_Phase_2_Remote_Terminal.md` §8.3 / memory `ios_remote_terminal_phase2.md`。

| # | 场景 | 通过标准 |
|---|---|---|
| B1 | LAN 同网 DC 握手 + RTT | iPhone → Terminal tab → 选桌面 → ≤ 2s 出现 prompt；RTT ≤ 200ms（type 字符肉眼无延迟）|
| B2 | 蜂窝 → TURN relay | iPhone 蜂窝 → 同 B1 但 RTT ≤ 500ms + 30 min stdout 不断流 |
| B3 | 故意杀桌面 mobile-bridge | iPhone 终端连接 → 桌面 kill mobile-bridge.js → ≤ 3s fallback 中继 + chip 切色（绿→橙）|
| B4 | 恢复 P2P 直连 | 桌面 mobile-bridge 重启 → ≤ 3s chip 切回绿（直连）|

**Reproducer**：
- **B1**：iPhone WiFi 模式 → Terminal tab → 单击桌面行 → xterm.js webview 弹出。打字 `ls`<Enter> → 看输出。秒表起：tap 到首个 prompt 字符出现。
- **B2**：iPhone 切蜂窝 → 重新进 Terminal → 一样跑 `ls`。开 `top` 命令让 stdout 持续滚 30 min → 验中途无中断、无重连提示。
- **B3**：先 B1 连接好。桌面 PowerShell：`Get-Process node | Where-Object {$_.MainWindowTitle -match "mobile"} | Stop-Process`（或在 task manager 杀对应 node 进程）。iPhone 验：Terminal 顶部 chip 颜色切换 + 仍能 type。
- **B4**：`cd desktop-app-vue && npm run dev` 重启 → iPhone chip 颜色切回。

---

## 5. 段 C — Phase 3.7 Remote Operate 4 Skill E2E (4 场景, 30 min)

参考：memory `ios_remote_operate_phase3.md` / `phase_3d_mobile_sync_landing.md`。

| # | 场景 | 通过标准 |
|---|---|---|
| C1 | Clipboard 双向 | iPhone Clipboard tab → 输文字 → "推送" → 桌面 Cmd+V (Mac) / Ctrl+V (Win) 验粘贴；反向：桌面复制 → iPhone "拉取" 显内容 |
| C2 | File 浏览 ~/Documents | iPhone File tab → 进 ~/Documents → 列表正确 → tap `.txt` 或 `.md` 看内容 ≤ 1s |
| C3 | Screenshot + 相册保存 | iPhone Screenshot tab → "触发截屏" → 桌面截屏返 base64 → iPhone 显图 → "保存到相册" → 首次弹 PHPhotoLibrary 权限 → 相册可见 |
| C4 | SystemInfo 4 卡 + 5s polling | iPhone System tab → 4 cards (CPU/Mem/Disk/Net) 显**真数字** → 等 5s 看自动刷新（数字变） |

---

## 6. 段 D — Phase 4.7 Notification E2E (8 场景, 35 min)

参考：design `iOS_Phase_4_Notification_Skill.md` §8.3 / memory `ios_remote_notification_phase4.md`。

| # | 场景 | 通过标准 |
|---|---|---|
| D1 | 拉历史 ≤ 500ms | iPhone Notification tab → 列表初次拉 ≤ 500ms |
| D2 | 桌面 push → iPhone banner | `cc cli notification.send` → ≤ 2s iPhone 锁屏 banner + tab badge "+1" + app icon badge |
| D3 | 3 条 push + LRU dedup | 快速 push 3 条 → iPhone 都收到 + DC/signaling 双发不重复 |
| D4 | iPhone markAsRead → 桌面同步 | iPhone swipe markAsRead → 桌面 history 真已读 |
| D5 | 离线 markAsRead → 队列 → 自动 drain | iPhone 飞行模式 → swipe markAsRead → 关飞行 → drainer 自动跑 |
| D6 | Quiet hours silenced | 桌面 push silenced=true → iPhone 收 envelope **不弹** banner |
| D7 | 权限拒绝降级 | iPhone 系统设置临时关通知 → 桌面 push → app 内 banner 替代 |
| D8 | 后台 1 min 回前台 | iPhone 后台 1 min → 回前台 → unread refresh（不弹 banner） |

**桌面侧 reproducer**：

⚠️ **FIXME（2026-05-18 drift audit 抓到）**：`cc cli notification.send` 命令**不存在** — CLI 没有 `cli` subcommand 也没有 `notification` subcommand。`notification.send` 是 remote handler action（`desktop-app-vue/src/main/remote/handlers/notification-handler.js` line 215+），需经 WS / DC 远程通道触发。Mac user 真机 E2E 前先选一条路径：

```bash
# 路径 A（推荐）：写个 Node 一次性脚本 open WS 直接 invoke handler。
# 例：
node -e "const W=require('ws'),w=new W('ws://localhost:<port>');w.on('open',()=>w.send(JSON.stringify({type:'rpc',method:'notification.send',params:{title:'测试 D2',body:'Phase 4 通知 E2E',target:'<iPhone-DID>'}})))"
# 注：<port> 视 cc serve / cc ui / Electron web-shell 不同（5050 是 mobile-bridge，但 remote-gateway 是另一个）— 先 grep desktop-app-vue/src/main 找 ws-server.js 监听端口确认。

# 路径 B：iPhone 自己触发（自测） — RemoteOperate Notification tab 内若有 "Send Test" 入口可点。检查 NotificationsView SwiftUI 实现是否含 dev-only test button。

# 路径 C：用桌面 desktop-app-vue UI 调试入口 — 若 V6 shell 有通知设置 panel 含 "测试推送" 按钮则点之。

# D6 silenced=true：上述路径任一加 `params.silenced: true` 即可。
```

**Mac user 真跑 D2/D3/D6 前先做：** (1) `git log --since=2026-05-18 -- desktop-app-vue/src/main/remote/handlers/notification-handler.js` 看是否有新增 send 入口；(2) 若仍只有 WS handler 路径，用路径 A，记下确切 ws-server.js 端口。

---

## 7. 段 E — Phase 5.7 AI Chat E2E (8 场景, 40 min)

直接抄 design `iOS_Phase_5_AI_Chat_Skill.md` §8.4 reproducer 全文 — 已写得很细，重复一遍冗余。

**预检**：桌面 Ollama 已起 + 至少一个 model（如 `qwen2:7b`）pulled。在桌面 `cc cli ai.getModels` 验返非空。

8 场景：列表拉取 / token-by-token 流式 / cancel ≤ 1s / tab 切换保留 / 离线发问 banner / 离线创建入队 / 长对话 100 limit / pull-to-refresh。**第 6.0 这版加 1 个增量**：

| # | 场景 | 通过标准 |
|---|---|---|
| E0 | (Phase 6.4 Action 1 fix 验) chatStream 直接调（不是 mock）| iPhone send → 桌面 console 看 `chatStream` log（不是 "Unknown action"），iPhone 流式渲染 |

---

## 8. 段 F — Phase 6 主屏 skill spot-check (6 场景, 25 min)

15 main tab 不全跑（太多），抽 6 个最易出问题的：

| # | 场景 | 通过标准 |
|---|---|---|
| F1 | Input tab 远程键鼠 | iPhone Input tab → 鼠标 trackpad 区拖动 → 桌面光标真动；点 key → 桌面真 type |
| F2 | Display tab 截屏 | Display tab → tap 截屏 → 显图 |
| F3 | Media tab 音量 | Media tab → slider 改音量 → 桌面音量真变（看 macOS 音量条 / Win 任务栏喇叭）|
| F4 | Browser tab 控浏览器 | Browser tab → "新建 tab https://example.com" → 桌面 Chrome 真打开 + 跳转 |
| F5 | Desktop tab 远程桌面 30 FPS | Desktop tab → 看实时画面 ≤ 200ms 延迟 + 触控板控光标 |
| F6 | SystemTools 13 sub-tab 全可点 | SystemTools tab → 13 个子 tab 各 tap 一下，不崩 |

---

## 9. 段 G — Phase 6.4 v0.2/v0.3 新 UI (5 场景, 30 min)

最后一段，覆盖 Phase 6.4 sprint 新 UI 入口 — **本 sprint 最后未跑过真机的部分**。

| # | 场景 | 通过标准 |
|---|---|---|
| G1 | KnowledgeView CRUD | Knowledge tab → 新建笔记（title+content+tags）→ 列表显 → tap 看详情 → swipe 星标 → 切 starred filter 验在 → swipe 归档 → 切 archived filter 验在 |
| G2 | AIExtended Templates | AI+ tab → 模板子 tab → 新建模板（name+template `Sum {{x}}`+variables）→ 列表显 → swipe delete → 重新拉验消失 |
| G3 | AIExtended Code 3 mode | AI+ → 代码子 tab → 各 mode（解释/生成/重构）输入实际代码片段（如 `let x = 1`）→ 等待结果（5-30s 取决 LLM）→ 文本框显结果非空 |
| G4 | AIExtended Multimodal OCR + TTS + 录音 | AI+ → 多模态子 tab：(a) 生图 prompt → 等 → 显图；(b) PhotosPicker 选张含文字的图 → "识别" → 显文字 + 置信度；(c) TTS 输入文字 → 合成 → 点 ▶ AVAudioPlayer 真出声；(d) 点 "开始录音" → 闪烁红点 + 时长跑 → 录 3s → "停止" → 自动灌 base64 → "识别" → 桌面 ASR 返文字 |
| G5 | AIExtended Agents streaming | AI+ → Agents 子 tab → 验 banner（available 或 unavailable + agent 数）→ 选 agent + 输入 → 开 "流式输出" toggle → 执行 → 验**实时累积**渲染（看到字符一段段冒出，不是一次性弹出）→ Stop 中途 → 桌面 agent 真停 |

**G4(d) 录音子场景注意**：
- 首次录音会弹麦克权限弹窗 — 选"允许"。memory `ios_ci_only_verify_path_on_win.md` 提过 NSMicrophoneUsageDescription 已配。
- 录音文件落 NSTemporaryDirectory()/cc_record_<ts>.m4a — 16kHz mono AAC，3s ≈ 50KB base64，不太大。
- 录完不要切 tab — 切后 viewModel.audioBase64 状态如何不保留是 v0.3 已知 limitation。

**G5 streaming 注意**：
- 验证桌面 agent 真有 streaming 输出（不是一次性 return）— 桌面 agentManager 接口必须含 `runStream(id, input, opts, onChunk)` 或 `run(id, input, {onChunk})`。如果桌面无 agentManager 实现，agentsAvailable=false，G5 直接 skip。
- "流式接收中…" 蓝色闪烁应在 first chunk 前可见；first chunk 后立刻消失换成实际字符。
- Stop 应触发 desktop 的 `cancelStream` + iOS Task.cancel — 桌面进程 log 应有相应记录。

---

## 10. Bug 捕获模板

每发现一个 bug，按这个 issue body 模板贴 GitHub issue：

```markdown
**Phase**: e.g. 6.4 v0.3 (G5 Agent streaming)
**场景**: G5 Agent streaming
**复现**:
1. iPhone Air... 进 AI+ tab
2. ...
**期望**: streaming 字符一段段冒
**实际**: 一次性弹出 / 卡住 / crash / ...

**iPhone log**: (Xcode console 截图 / paste)
**桌面 log**: (`desktop-app-vue` console / chat-handler.js error)
**iPhone screenshot**: (附图)

**Commit baseline**: `1fb947b32` (绿 iOS CI 基线)
**Git status**: clean / 有未提交改动
**iOS 版本**: 16.x / 17.x
**桌面 OS**: macOS / Win
```

---

## 11. 通过 / 失败 后续动作

### 11.1 全通过（理想）

1. 在本 plan 末尾加 §12 "执行记录"，列每场景 ✅ + 完成时间 + iOS / 桌面版本
2. 在 commit message 写 "test(ios): Phase 6.0 E2E 38 场景全通过 ✅ — 1fb947b32 真机 verify"
3. 更新 `iOS_对标_Android_Phase_6_Plan.md` §11.4 follow-up：Phase 6.0 真机 E2E ✅
4. 写 memory `phase_6_e2e_verified.md`（type=project）记录通过基线
5. Phase 6 sprint 完全收口

### 11.2 部分失败（常见）

按 bug 严重度分 3 类：

| 类 | 含义 | 处理 |
|---|---|---|
| **P0 阻断** | iPhone crash / DC 完全连不上 / 主流 100% 复现失败 | 立刻 fix + rerun，本会话不出 plan |
| **P1 功能** | 单个 skill 不工作 / 流式不流 / 截屏返空 | issue + 修 + 下次 sprint |
| **P2 体验** | 延迟略高 / banner 颜色错 / 文案 typo | 累积 issue，下个 sprint 批 |

### 11.3 跳过场景（合法）

允许 skip 的场景：
- B2 蜂窝（如无蜂窝 SIM / 流量）— 记 N/A，但 LAN B1 必须通
- D2/D3/D6 通知 push（如桌面 push 系统配置不全）— 记 N/A，但 D1 历史拉必须通
- G5 Agents（如桌面 agentManager 未配 — `available: false`）— 记 N/A
- F5 远程桌面（如桌面无 mss 库 / Win NPCAP 限制）— 记 N/A

不允许 skip：A1（最基础）/ B1（最基础）/ E0（chat 主路径）/ G1（Knowledge CRUD）/ G2（Templates CRUD）。

---

## 12. 执行记录（执行时填）

> 表格留空，每场景跑完填一行。

| 场景 | 状态 | 时长 | 备注 / bug# |
|---|---|---:|---|
| A1 Flow A QR | | | |
| A2 Flow B 手输 | | | |
| A3 LAN→relay | | | |
| B1 LAN DC | | | |
| ... | | | |
| G5 Agents streaming | | | |

**执行人**：
**iOS 版本**：
**桌面 OS / 版本**：
**iPhone 型号**：
**桌面机型号**：
**Commit baseline**：`1fb947b32`
**开始时间**：
**结束时间**：
**总通过率**：__/__

---

## 13. 关联文档 / memory

- `iOS_对标_Android_Phase_6_Plan.md` §6.0 + §11.4 follow-up（本 plan 是其展开）
- `iOS_Phase_1_Pairing_Flow_B.md` / `_2_Remote_Terminal.md` / `_3_Remote_Operate_Framework.md` / `_4_Notification_Skill.md` / `_5_AI_Chat_Skill.md`（各段 reproducer 源）
- `iOS_Phase_6_6_Desktop_Skill.md` / `_6_7_Extension_Skill.md`（F 段补充）
- `iOS_Local_Terminal_Spike_Decision.md`（解释为何 6.8 不在本 plan）
- `iOS_WatchOS_Spike_Decision.md`（解释为何 6.9 不在本 plan）
- memory：`ios_qr_pairing_three_flows.md` / `ios_remote_terminal_phase2.md` /
  `ios_remote_operate_phase3.md` / `ios_remote_notification_phase4.md` /
  `ios_remote_ai_chat_phase5.md` / `ios_remote_desktop_phase6_6.md` /
  `ios_remote_extension_phase6_7.md` / `phase_6_knowledge_ai_hybrid_complete.md` /
  `ios_ci_only_verify_path_on_win.md`
