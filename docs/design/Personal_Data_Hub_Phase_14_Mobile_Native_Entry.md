# Personal Data Hub — Phase 14：移动端原生入口（Android + iOS）

> **状态**：v0.1 设计稿（2026-05-20）。Phase 14.0（Android `SeedRegistry` 元数据 21 method）已落地（v5.0.3.72，commit 见 `android-app/app/src/main/java/com/chainlesschain/android/remote/registry/SeedRegistry.kt:386-555`）；14.1 (Android 接线 + UI) / 14.2 (iOS) / 14.3 (双端审计 + 同步进度推送) 待实施。本文档系**首次为 PDH 移动端入口建立完整设计稿**——此前路线图只在 [`personal-data-hub.md`](../../docs-site/docs/chainlesschain/personal-data-hub.md) 末尾以内联段落形式呈现。
>
> **关联文档**：父文档 [`Personal_Data_Hub_Architecture.md`](./Personal_Data_Hub_Architecture.md)（13-Phase 路线图，PDH 主架构）；同构先例 [`iOS_Phase_5_AI_Chat_Skill.md`](./iOS_Phase_5_AI_Chat_Skill.md)（iOS 远程 AI Chat skill = 同框架同模式）、[`iOS_Phase_4_Notification_Skill.md`](./iOS_Phase_4_Notification_Skill.md)（events fan-out + dispatcher 模式参考）、[`Android_Remote_Terminal_Plan_A1.md`](./Android_Remote_Terminal_Plan_A1.md)（Android RemoteCommandClient 框架样板）
>
> **依赖**：(1) 桌面 PDH IPC + WS 21 通道已 v5.0.3.72 双登记；(2) Android `RemoteCommandClient.invoke()` + `SeedRegistry` 23 skill（含 14.0 已 seed 的 `personal-data-hub` namespace）；(3) iOS Phase 6.6 `RemoteCommandClient` + `RemoteOperateView` 13 tab segmented；(4) Android Phase 5 AI Chat skill 的 `ChatBubble` / streaming dispatcher 模式（直接 reuse 给 Hub `ask` 单轮 Q&A）；(5) iOS Phase 5 `RemoteAIChatViewModel` 模式（同上）
>
> **对齐版本**：桌面端 21 通道（PDH v5.0.3.72）；本 Phase 14 wire 全部 21 通道为 typed Android/iOS RPC。

---

## 1. 背景

### 1.1 Phase 14 = PDH 价值兑现的"最后一公里"

PDH v5.0.3.72 已完成 Phase 0–13（19 个 Adapter / 5 内置 Analysis Skill / EntityResolver / Mobile Extraction Layer / 47 测试文件 927 测试），但所有功能只能在**桌面 Electron** 或 **`cc ui` 浏览器**里使用。手机上的用户**完全用不上**自己已经入库的 5 类核心实体（Person / Event / Place / Item / Topic）+ 跨源数据。

Phase 14 不在手机本地复刻 vault — vault 留桌面（SQLCipher + 主密钥 + 全部 LLM 推理），手机端只是 **PDH 的远程操控前端**：通过 **P2P DataChannel RPC** 直连桌面进程的 21 个 `personal-data-hub.*` 通道，把"自然语言提问 / 同步触发 / 审计回查"这些**只读 + 关键变更**操作放回口袋里。

### 1.2 为什么不在手机本地建小 vault？

| 选项 | 理由 |
|---|---|
| **A：手机本地建 mini vault** | ❌ 重复 SQLCipher / migrations / 19 Adapter / EntityResolver 整套；手机算力不足以跑 Ollama qwen2.5:7b（LLM 推理仍要桥回桌面）；增加密钥分发面与同步冲突面（已经被 Phase 12 跨设备 sync 教训过） |
| **B：远程操控（推荐）** | ✅ Hub 已 21 通道 IPC/WS 双登记，加 **mobile-bridge 白名单一行 + Android/iOS RPC wrapper** 就可；vault + LLM 留桌面 = 隐私 gate 自动继承（敏感数据零泄漏到手机）；手机端只携带 `AskResult { answer, citations, llmName, isLocal }`，离开 app 即清 |
| **C：手机做轻量 RAG 检索 cache** | ❌ v0.2+ 可选项；v0.1 不引入，手机端 cache 暴露面与桌面 vault 不一致语义复杂 |

**v0.1 选 B**。这是 PDH 第一次把"全数据本地中台"的查询能力**真正放进用户口袋**，且不破坏隐私架构。

### 1.3 已就位 vs 需新建（双端共用视角）

✅ **已就位**：

- **桌面侧**：
  - `personal-data-hub-ipc.js` 21 个 colon-style 通道（[`desktop-app-vue/src/main/ipc/personal-data-hub-ipc.js`](../../desktop-app-vue/src/main/ipc/personal-data-hub-ipc.js)）
  - `personal-data-hub-protocol.js` 21 个 dot-style WS 主题（[`packages/cli/src/gateways/ws/personal-data-hub-protocol.js`](../../packages/cli/src/gateways/ws/personal-data-hub-protocol.js)）
  - `mobile-skill-whitelist.js` 现成 pattern 路由 + ApprovalUI 路由（[`desktop-app-vue/src/main/remote/handlers/mobile-skill-whitelist.js`](../../desktop-app-vue/src/main/remote/handlers/mobile-skill-whitelist.js)）
- **Android 侧**：
  - `SeedRegistry.kt` 已含 `personal-data-hub` namespace + 21 method 元数据（Phase 14.0 ✅）— 含每个 method 的 `name` / `description` / `paramCount` / `paramSummary` / `returnTypeHint` / `riskOverride` / `requiresApprovalOverride`
  - `RemoteCommandClient.invoke(namespace:, method:, params:)`（Phase 6 范式，复用 0 改动）
  - `RemoteOperateView` 13 tab horizontal scroll picker（Phase 6.6 已扩展）
  - `OfflineCommandQueue` 兜底 mutating（Phase 5 AI Chat 已建模式）
  - Phase 5 AI Chat 的 `ChatBubble` / streaming dispatcher / token 间隔 50ms 缓冲 = 直接迁移给 `hub.ask` 的回答渲染
- **iOS 侧**：
  - `RemoteCommandClient` actor（Phase 3.6 已抽出）
  - `RemoteOperateView` 13 tab segmented（Phase 6.7 已扩展）
  - `RemoteAIChatViewModel` 模板（Phase 5 已落地）
  - `RemoteDependencies` fan-out task 模式（Phase 4.4 已落地）

❌ **缺**：

| # | 缺什么 | 在哪 | 工作量 |
|---|---|---|---|
| 1 | mobile-skill-whitelist 白名单条目 `personal-data-hub.*` + 高敏感 method 进 `approvalChannelsForMobile` | 桌面用户配置 `.chainlesschain/config.json` 或代码默认 | < 0.5h（默认配置 patch + doc） |
| 2 | `PersonalDataHubCommands.kt` actor (21 method typed wrapper) + Codable models | Android `feature-personal-data-hub` 新模块 | 1d |
| 3 | `HubAskScreen.kt` + `HubAskViewModel.kt`（核心 ask + citation chip + 健康卡片） | 同上 | 1.5d |
| 4 | `HubAdaptersScreen.kt` + 触发 sync + 列表 / unregister | 同上 | 0.5d |
| 5 | `HubAuditScreen.kt`（审计 drawer，readonly） | 同上 | 0.5d |
| 6 | `RemoteOperateView` 加第 14 tab "Hub" + SkillTab enum case | Android `app` 模块 | < 0.5h |
| 7 | `PersonalDataHubCommands.swift` actor + Codable + iOS UI 镜像（HubAskView + HubAdaptersView + HubAuditView）+ 第 14 tab "Hub" | iOS `Features/PersonalDataHub/` 新目录 + `RemoteSkills/PersonalDataHub/` | 2d |
| 8 | 流式同步进度（Phase 14.3）— Android `HubSyncEventDispatcher` + iOS 同名 dispatcher 订 `personal-data-hub.sync.progress` event | 双端 | 1d |
| 9 | 隐私 gate UX：`acceptNonLocal=true` 二次确认 dialog/sheet | 双端 ask flow | < 0.5d |

**总工期**：Android 14.1 ≈ 3d；iOS 14.2 ≈ 3d；14.3 双端流式同步 ≈ 1d。**单人串行 ≈ 7d**；双端并行 ≈ 4d。

---

## 2. 目标 & 非目标

### 2.1 目标 (Phase 14 in scope)

| # | 项 | 验收 |
|---|---|---|
| G1 | 桌面侧白名单 wire — `personal-data-hub.*` 21 通道默认放行 + 5 个 Privileged method 进 `approvalChannelsForMobile` | 单测：whitelist isAllowed("personal-data-hub.ask") = true / requiresApproval("personal-data-hub.registerEmail") = true |
| G2 | Android `PersonalDataHubCommands` 21 method 全 wire（typed Codable + 错误响应统一 envelope） | 单测 ≥ 21（每 method 1 happy + 共 5 错误分支） |
| G3 | iOS `PersonalDataHubCommands` actor 21 method（同上） | 同上 |
| G4 | `HubAskScreen` Q&A 主流程（双端）— 输入问题 → ask → 答案 Markdown + citation chip 点击 → eventDetail | 真机：iPhone/Android 各发问 → 桌面 Ollama 推理 → 答案 ≤ 8s + citation chip 可跳详情 |
| G5 | 健康卡片（双端）— stats / health 两通道 | 真机：见 vault.events 数字 + LLM provider + isLocal 标记 |
| G6 | Adapter 列表 + 触发同步（双端）— listAdapters + syncAdapter | 真机：列表见 19 Adapter + 长按某 Adapter sync → 进度条 → SyncReport |
| G7 | 审计回查（双端，readonly） | 真机：iPhone/Android Audit tab 见最近 ingest / ask 记录 |
| G8 | 流式同步进度（Phase 14.3）— `personal-data-hub.sync.progress.event` 推 connecting/fetching/normalizing/done/error | 真机：iPhone/Android 触发 syncAdapter → 进度文字实时更新 |
| G9 | 隐私 gate UX — 桌面端 LLM 非本地时 ask 返回 `error: "Non-local LLM blocked"`；UI 弹二次确认（"我接受发送到 X"），确认后调用 `{ acceptNonLocal: true }` | 真机：切桌面 LLM 到 Anthropic → 手机 ask 弹 sheet/dialog → 确认才放行 |
| G10 | RemoteOperateView 第 14 tab "Hub" — 双端 segmented horizontal scroll 视觉无 regression | UI 验证：13 → 14 tab 横向滚动顺滑 + Hub 入口 icon `database` / `folder.fill.badge.person.crop` |

### 2.2 非目标 (defer 到 Phase 15+)

- **手机本地 mini vault** — 见 §1.2 选项 A，永不在本设计范围。
- **手机端直接跑 LLM 推理** — 设备算力不足 + 隐私 gate 设计中"所有推理在桌面"是硬约束。
- **手机端 Adapter 注册向导**（IMAP 授权码 / Alipay ZIP 密码输入 UI）— v0.1 触发已注册 Adapter 的 sync 即可，注册流程仍 desktop only（移动端输入 8 位授权码 + ZIP 密码 UX 痛）；v0.2 加。
- **手机端事件详情**完整渲染 — v0.1 仅 citation chip 跳事件 ID + 显事件主要字段（subtype / actor / at / amount?）；完整 PDF/原始邮件等附件查看 v0.2。
- **跨设备 vault 同步**到手机 — Phase 12+ sync feature 已为 desktop-Android 双向，但 Hub 数据**不**进 sync feature 范围（vault 是 SoT，手机零 cache）。
- **EntityResolver review 队列**移动端 UI — v0.1 仅 desktop；v0.2 加。
- **destroy 调用** — v0.1 双端 UI **不**暴露 destroy（防误操作），仅 desktop。
- **Analysis Skill 卡片**（5 个内置 skill 的卡片化展示） — v0.1 ask 直接走自然语言；v0.2 加 quick-action grid。
- **多 vault 切换** — v1 单 vault per 桌面进程。

---

## 3. Open Questions

### OQ-1：14.1 → 14.2 顺序 vs 双端并行

**A**：Android 14.1 先落 → iOS 14.2 跟随同模式（mirror）

**B**：Android + iOS 并行（同一 sprint 双端 review 互验）

**C**：iOS 14.2 先（设计上 iOS Phase 5 / 6 模式更成熟）

**推荐 A**。理由：(1) Android `SeedRegistry` Phase 14.0 已 seed 21 method 元数据，iOS 尚未；先 Android 闭环验证 21 method envelope 形状 → iOS 直接 mirror 减少返工；(2) Android 真机（Xiaomi 24115RA8EC）在场，iOS 真机 E2E 需 Mac + iPhone（开发者环境受限），AVD 模拟器不 representative；(3) Phase 5 / 6 实测显示 Android 先落、iOS mirror 流式 wire 错误率最低（events fan-out / dispatcher / chunk 排序坑双端共享，单端先 land = 双端共享 trap memory）。

### OQ-2：白名单粒度 — namespace 通配 vs 每 method 单列

**A**：`exposeRemoteSkills: ["personal-data-hub.*"]` 一行通配 21 method（与 `terminal.*` / `ai.*` 一致风格）

**B**：21 method 全列名 + 5 Privileged 进 `approvalChannelsForMobile`

**C**：仅 readonly 通配（`personal-data-hub.ask` / `.stats` / `.health` / `.listAdapters` / `.queryEvents` / `.recentAudit` / `.eventDetail` / `.listEmailAccounts` / `.listAlipayAccounts`）；mutating 显式列入

**推荐 A + 显式 ApprovalUI**。理由：(1) 与既有 `terminal.*` / `ai.*` 一致风格降低运维成本；(2) `SeedRegistry` 已为 5 个 Privileged method（registerEmail / unregisterEmail / registerAlipay / unregisterAlipay / unregister）标 `riskOverride = SkillRiskTag.Privileged` + `requiresApprovalOverride = true`，桌面 `approvalChannelsForMobile` 完整 mirror 即可；(3) C 太碎，21 method 长 patternlist 极易漏；(4) v0.1 默认配置打开通配，**仅当用户配 `mobileBridge.enabled = false` 时全关**——保持"用户掌控"承诺。

### OQ-3：手机端 ask 走流式 vs 一次性返回

**A**：一次性 — ask 走 IPC/WS 普通 invoke；桌面端聚合完答案再回 promise（与桌面 SPA 行为一致）

**B**：流式 — ask 改用 server-push `personal-data-hub.ask.delta` event；手机端边接边渲（与 Phase 5 AI Chat 一致 UX）

**C**：双轨 — 短答案（<200 chars）一次性，长答案 fallback 流式（启发式 token threshold）

**推荐 A（v0.1）+ 留 B 接口给 v0.2**。理由：(1) 桌面 `AnalysisEngine.ask` 当前**不**支持流式（query-parse → vault facts → RAG → prompt-build → llm.chat → citation 校验 → return 是同步链路），加流式要改 5 处；(2) Ollama qwen2.5:7b RAG topK=10 端到端 3-8s，体感等待 < AI Chat 长对话（不至于像 30s+ 那么痛）；(3) v0.2 桌面 `AnalysisEngine` 改流式（拆 chat token-by-token push + citation 校验后置）后再开 B。

### OQ-4：citation chip 点击 → 详情 — fetch on tap vs prefetch

**A**：tap on tap — 点 citation 才调 `eventDetail` 单 RPC（懒）

**B**：prefetch — ask 返回后并发拉所有 citations 的 eventDetail，cache 在 ViewModel

**C**：桌面端 `ask` response 直接附带 events 子集（修改 AskResult contract 加 `events: Event[]`）

**推荐 A（v0.1）**。理由：(1) 多数用户不点 citation chip（信任 LLM 答案，点用于审计），prefetch 浪费 RPC；(2) `eventDetail` ~100ms LAN 单 RPC，tap 后 ~150ms 见详情，体感可接受；(3) C 改 contract 影响桌面 SPA + cli，移动端独立尝试不影响主路径。

### OQ-5：14.3 流式同步进度 — push event vs polling syncStatus

**A**：push event — 桌面 `syncAdapterStream` 已 emit `personal-data-hub.sync.progress.event`（v5.0.3.72 已落 WS 主题），iOS/Android dispatcher 订阅 + render

**B**：polling — 手机调 syncAdapter（普通 invoke）+ 200ms 间隔调 `syncStatus`（新 method）拉中间状态

**C**：双轨 — push event 主路 + DC 失败 fallback polling

**推荐 A**。理由：(1) 桌面端已有现成 `sync-adapter-stream` 主题，0 桌面工作量；(2) iOS Phase 4/5 events fan-out 模式已成熟，第 4 子流 buffer 256 直接接通；(3) DC 抖动场景 RemoteCommandClient 已自动 fallback signaling，event 走 signaling 转发不丢；(4) B 加 `syncStatus` method 桌面、双端三端都要改，浪费。

---

## 4. 架构

### 4.1 数据流（iPhone / Android → 桌面 PDH）

```
┌──────────────────────────────────────────────────────────────────┐
│  iPhone / Android                                                 │
│  ┌─────────────────────┐                                          │
│  │ HubAskView (UI)     │  question: "上个月妈妈生日那周买了啥？" │
│  └──────────┬──────────┘                                          │
│             ▼                                                      │
│  ┌─────────────────────┐  invoke("personal-data-hub.ask",         │
│  │ PersonalDataHub-    │   { question, options? })                │
│  │ Commands actor      │                                          │
│  └──────────┬──────────┘                                          │
│             ▼                                                      │
│  ┌─────────────────────┐                                          │
│  │ RemoteCommand-      │ — Phase 3.6 actor pool, 复用 0 改动      │
│  │ Client.invoke()     │                                          │
│  └──────────┬──────────┘                                          │
└─────────────┼──────────────────────────────────────────────────────┘
              │ DC RPC (P2P DataChannel)
              │ fallback → signaling relay
              ▼
┌─────────────────────────────────────────────────────────────────┐
│  桌面 Electron 主进程                                            │
│  ┌────────────────────────┐                                     │
│  │ mobile-bridge          │ ← 白名单查 personal-data-hub.ask     │
│  │  + MobileSkillWhitelist│   = allowed                          │
│  └──────────┬─────────────┘                                     │
│             ▼                                                    │
│  ┌────────────────────────┐                                     │
│  │ remote-gateway routes  │ → personal-data-hub-ipc handler      │
│  └──────────┬─────────────┘                                     │
│             ▼                                                    │
│  ┌────────────────────────┐                                     │
│  │ getHub().ask()         │ — AnalysisEngine 全套                │
│  │  query-parse           │                                      │
│  │  + vault.queryEvents   │                                      │
│  │  + RAG retrieve        │                                      │
│  │  + 隐私 gate 检查       │                                      │
│  │  + LLM.chat (Ollama)   │                                      │
│  │  + citation 校验        │                                      │
│  │  + audit_log 写入       │                                      │
│  └──────────┬─────────────┘                                     │
└─────────────┼─────────────────────────────────────────────────────┘
              │ AskResult { answer, citations[], llmName, isLocal }
              ▼
       回流 iPhone / Android → ViewModel 更新 → UI 渲染
```

### 4.2 Module / 文件 placement

#### Android（Phase 14.1）

> **实际落地 (2026-05-20) 偏离原设计**：所有 PDH 代码落入 `:app` 而非独立 `feature-personal-data-hub` 模块。原因：
>
> 1. **Hilt graph 根植 :app** — `RemoteCommandClient` / `P2PClient` / `RemoteEventDispatcher` 都在 :app/remote/ 之内 provide；独立 feature module 想注入它们需在 :app 暴露 Hilt entry-point，反而增加 boilerplate。
> 2. **既有 remote skill UI 全部在 `:app/remote/ui/`**（ai / file / notification / clipboard / ... ）— PDH 跟其它 23 个 remote skill 同性质（mobile UI 走 RemoteCommandClient RPC 远调桌面），单独成模块破坏既有约定。
> 3. **PersonalDataHubCommands.kt 已落 `:app/remote/commands/`**（Phase 14.0 data layer commit）— 与 AICommands / NotificationCommands / FileCommands 等其它 24 个 typed wrapper 同位。
>
> 偏离后路径（v0.1 已 land）：
>
> ```
> android-app/app/src/main/java/com/chainlesschain/android/remote/
> ├── commands/
> │   └── PersonalDataHubCommands.kt          # 21 method typed wrapper ✅ (Phase 14.0)
> └── ui/
>     └── personalDataHub/                    # NEW
>         ├── HubAskScreen.kt                 ✅ 隐私 gate + citation chip
>         ├── HubAskViewModel.kt              ✅ + 6 单测
>         ├── HubAdaptersScreen.kt            ✅
>         ├── HubAdaptersViewModel.kt         ✅
>         ├── HubAuditScreen.kt               ✅ (action filter chip)
>         ├── HubAuditViewModel.kt            ✅
>         ├── HubHealthCard.kt                ✅
>         ├── AcceptNonLocalDialog.kt         ✅
>         └── PersonalDataHubScreen.kt        ✅ 3 tab container
> ```

**原（未采纳）多模块布局**（保留供参考；仅 PersonalDataHubScreen 这层从 :app 把入口暴露给 RemoteOperateScreen 使用）：

```
android-app/
├── feature-personal-data-hub/                               # NOT USED — 与 :app/remote/ 约定冲突
│   └── ...
│
├── app/src/main/java/com/chainlesschain/android/remote/
│   ├── ui/personalDataHub/                                  # 实际落地 (per 上一 ASCII 框)
│   ├── operate/RemoteOperateView.kt                         # 加第 14 tab "Hub" (modified) — 待 #4
│   └── registry/SeedRegistry.kt                             # 14.0 已 land；14.1 仅 .reflect on
│
└── desktop-app-vue/src/main/remote/handlers/
    └── mobile-skill-whitelist.js                            # 14.1 配置 patch（默认 config + 单测）
```

#### iOS（Phase 14.2）

```
ios-app/ChainlessChain/
├── Features/
│   ├── PersonalDataHub/                                     # NEW
│   │   ├── HubAskView.swift                                 # SwiftUI 镜像 Android HubAskScreen
│   │   ├── HubAdaptersView.swift
│   │   ├── HubAuditView.swift
│   │   ├── HubHealthCard.swift
│   │   ├── CitationChip.swift
│   │   ├── AcceptNonLocalSheet.swift
│   │   └── HubViewModels.swift                              # @MainActor HubAskViewModel / HubAdaptersViewModel / HubAuditViewModel
│   └── RemoteOperate/
│       └── RemoteOperateView.swift                          # 加第 14 tab "Hub" (modified)
│
├── Modules/CoreP2P/Sources/RemoteSkills/
│   └── PersonalDataHub/                                     # NEW
│       ├── PersonalDataHubModels.swift                      # Codable: AskResult / HubStats / HubHealth / Event 等
│       ├── PersonalDataHubCommands.swift                    # actor 21 method
│       └── HubSyncEventDispatcher.swift                     # @MainActor, 订 commandClient.events
│
└── Modules/CoreP2P/Sources/RemoteOperate/
    └── RemoteDependencies.swift                             # 加 hub: PersonalDataHubCommands + hubDispatcher (modified)
```

### 4.3 21 method 一览（与 SeedRegistry.kt 对齐）

| # | Android `RemoteCommandClient.invoke` method | risk | Mobile UI | 备注 |
|---|---|---|---|---|
| 1 | `personal-data-hub.ask` | Safe | HubAskScreen 核心 | options.acceptNonLocal 走二次确认 |
| 2 | `personal-data-hub.stats` | Safe | HubHealthCard 顶部 | events / persons / places / items / topics 数 |
| 3 | `personal-data-hub.health` | Safe | HubHealthCard 4 项 | vault.schemaVersion / llm.isLocal / kgSink / ragSink |
| 4 | `personal-data-hub.listAdapters` | Safe | HubAdaptersScreen 列表 | name / version / sensitivity / capabilities |
| 5 | `personal-data-hub.syncAdapter` | Mutating | HubAdaptersScreen 长按或菜单 | SyncReport 弹通知 |
| 6 | `personal-data-hub.syncAll` | Mutating | HubAdaptersScreen 顶部菜单 | 并发同步全部 |
| 7 | `personal-data-hub.syncAdapterStream` | Mutating | Phase 14.3 触发 | event 序列：connecting/fetching/normalizing/done/error |
| 8 | `personal-data-hub.queryEvents` | Safe | citation chip tap 详情时 fall-through | filter: subtype/since/until/actor/adapter/limit |
| 9 | `personal-data-hub.recentAudit` | Safe | HubAuditScreen 列表 | filter: since/action/limit |
| 10 | `personal-data-hub.eventDetail` | Safe | citation chip tap | event + classification + extraction |
| 11 | `personal-data-hub.registerEmail` | **Privileged** | v0.1 不在手机 UI 暴露 | 仅留 typed API for v0.2 |
| 12 | `personal-data-hub.unregisterEmail` | **Privileged** | v0.1 同上 | |
| 13 | `personal-data-hub.testEmailAuth` | Safe | v0.1 不暴露 | API 留接口 |
| 14 | `personal-data-hub.listEmailAccounts` | Safe | HubAdaptersScreen Email 子段 | hint badge for "已注册 N 个邮箱" |
| 15 | `personal-data-hub.registerAlipay` | **Privileged** | v0.1 不暴露 | |
| 16 | `personal-data-hub.unregisterAlipay` | **Privileged** | v0.1 不暴露 | |
| 17 | `personal-data-hub.importAlipayBill` | Mutating | v0.1 不暴露（需 ZIP 文件路径，手机端文件 picker UX 复杂） | v0.2 移动端文档 picker |
| 18 | `personal-data-hub.listAlipayAccounts` | Safe | HubAdaptersScreen Alipay 子段 | |
| 19 | `personal-data-hub.syncAllStream` | Mutating | Phase 14.3 触发 | |
| 20 | `personal-data-hub.registerMock` | Mutating | v0.1 不暴露（dev only） | |
| 21 | `personal-data-hub.unregister` | **Privileged** | v0.1 不暴露 | |

> **v0.1 UI 实际暴露 method**：ask / stats / health / listAdapters / syncAdapter / syncAll / syncAdapterStream / syncAllStream / queryEvents / recentAudit / eventDetail / listEmailAccounts / listAlipayAccounts = **13 method**；另 **8 method (含 5 Privileged)** typed wrapper 落地但 UI 不调用，留 v0.2 / 桌面端访问。

### 4.4 envelope shape 对齐（与桌面 IPC handler 一致）

每个 method 都按桌面 `personal-data-hub-ipc.js` handler 的入参 + 返回形状定 Codable / @Serializable。例：

```kotlin
// Android: HubModels.kt
@Serializable
data class AskParams(
    val question: String,
    val options: AskOptions? = null,
)

@Serializable
data class AskOptions(
    val acceptNonLocal: Boolean? = null,
    val useRag: Boolean? = null,
    val timeWindow: TimeWindow? = null,
    val topK: Int? = null,
)

@Serializable
data class AskResult(
    val answer: String,
    val citations: List<Citation>,
    val llmName: String,
    val isLocal: Boolean,
)

@Serializable
data class Citation(
    val eventId: String,
    val excerpt: String? = null,
    val confidence: Double? = null,
)
```

```swift
// iOS: PersonalDataHubModels.swift
struct AskParams: Codable {
    let question: String
    let options: AskOptions?
}

struct AskOptions: Codable {
    let acceptNonLocal: Bool?
    let useRag: Bool?
    let timeWindow: TimeWindow?
    let topK: Int?
}

struct AskResult: Codable {
    let answer: String
    let citations: [Citation]
    let llmName: String
    let isLocal: Bool
}

struct Citation: Codable {
    let eventId: String
    let excerpt: String?
    let confidence: Double?
}
```

错误响应统一 envelope（桌面 IPC handler 已规范）：

```jsonc
{ "error": "Non-local LLM blocked — pass options.acceptNonLocal=true to override" }
{ "error": "Analysis engine unavailable — LLM manager not initialized" }
```

双端通过 `invokeAndDecode` helper 把 `error` 字段 throw 成 typed Error，UI 走 Result/Combine pattern 渲染（与 Phase 6.7 iOS Extension skill `invokeAndDecode` 模式一致）。

### 4.5 RemoteOperateView 第 14 tab "Hub" wire-up

**Android**（`SkillTab` enum 添 case + RemoteOperateView 添 view 分支）：

```kotlin
enum class SkillTab(
    val displayName: String,
    val icon: ImageVector,
) {
    Clipboard("剪贴板", Icons.Default.ContentCopy),
    File("文件", Icons.Default.Folder),
    Screenshot("截图", Icons.Default.Camera),
    SystemInfo("系统信息", Icons.Default.Memory),
    Terminal("终端", Icons.Default.Terminal),
    Notifications("通知", Icons.Default.Notifications),
    AI("AI", Icons.Default.AutoAwesome),
    KnowledgeBase("知识库", Icons.Default.MenuBook),
    AIExtended("AI 扩展", Icons.Default.Extension),
    Display("显示器", Icons.Default.Monitor),
    Extension("浏览器扩展", Icons.Default.Extension),
    SystemTools("系统工具", Icons.Default.Build),
    Desktop("远程桌面", Icons.Default.DesktopWindows),
    Hub("个人数据中台", Icons.Default.Storage),                // NEW
}
```

**iOS**（`SkillTab` enum case 同名添加 + `RemoteOperateView` switch 分支 case + `RemoteDependencies` 加 `hub` + `hubDispatcher` props + fan-out task 加第 4 子流 buffer 256）。

---

## 5. 详细流：HubAskScreen 端到端

### 5.1 happy path（本地 LLM）

```
1. 用户在 HubAskScreen 输入 "上个月妈妈生日那周买了啥"
2. 点 Send → HubAskViewModel.ask(question)
3. ViewModel 状态机：idle → asking
4. PersonalDataHubCommands.ask({ question }) → RemoteCommandClient.invoke
5. 桌面 PDH AnalysisEngine 全套（~3-8s, Ollama qwen2.5:7b）
6. 返回 AskResult { answer, citations: [eventId1, eventId2, ...], llmName: "qwen2.5:7b-instruct", isLocal: true }
7. ViewModel: asking → done(result)
8. UI 渲染 Markdown answer + N 个 CitationChip
9. 用户 tap CitationChip(eventId1) → HubAskViewModel.fetchCitation(eventId1)
10. PersonalDataHubCommands.eventDetail({ eventId }) → 返回 EventDetail
11. 弹 BottomSheet / Sheet 显事件 subtype / actor / at / amount / source adapter
```

### 5.2 隐私 gate 流（桌面 LLM 非本地）

```
1-5. 同上
6. 返回 { error: "Non-local LLM blocked — pass options.acceptNonLocal=true to override" }
7. ViewModel: asking → blockedNonLocal(question, error)
8. UI 弹 AcceptNonLocalDialog（Android）/ AcceptNonLocalSheet（iOS）
   "桌面当前使用 Anthropic Claude（非本地 LLM）。继续发送将把问题与相关事件上下文发送至 Anthropic 服务器。
    本次仅本次会话生效，不会改默认设置。"
   [取消] [仅本次接受]
9. 用户确认 → ViewModel.askWithAcceptNonLocal()
10. PersonalDataHubCommands.ask({ question, options: { acceptNonLocal: true } })
11. 桌面 PDH 放行 → 返回 AskResult
12. ViewModel: blockedNonLocal → done(result)
```

### 5.3 离线 / DC 失败流

```
1. 用户在 HubAskScreen 输入问题
2. Send → invoke 触发
3. RemoteCommandClient DC 不通 + signaling fallback 也失败
4. 抛 RemoteCommandError.disconnected
5. ViewModel: asking → error("无法连接到桌面端，请确认桌面端在线")
6. UI banner 红色（不入离线队列 — ask 是 read 操作，离线 = 不可用，与 Phase 5 AI Chat OfflineQueue 三分支 gate 一致）
```

### 5.4 syncAdapter 触发流（Phase 14.3 流式版）

```
1. HubAdaptersScreen 列表见 19 Adapter，长按 EmailAdapter → 菜单 "立即同步"
2. ViewModel.triggerSync("email-imap") → invokeStream
3. PersonalDataHubCommands.syncAdapterStream({ name: "email-imap" })
4. HubSyncEventDispatcher 订 commandClient.events filter "personal-data-hub.sync.progress"
5. 桌面 push event 序列：
   - { kind: "connecting", adapter: "email-imap" }
   - { kind: "fetching", adapter: "email-imap", partition: "INBOX", detail: { uidsScanned: 250 } }
   - { kind: "normalizing", adapter: "email-imap", partition: "INBOX", detail: { eventsBuilt: 30 } }
   - { kind: "done", adapter: "email-imap", report: { ingested: 30, kgTriples: 90, ragDocs: 30, durationMs: 18200 } }
6. ViewModel 累 event → UI 进度文字 + 完成后 Snackbar "EmailAdapter 已同步 30 条事件"
```

---

## 6. 6 个 sub-phase 拆分

### Phase 14.1 — Android impl（3d）

| Sub | 主题 | 关键产出 | 单测目标 |
|---|---|---|---|
| 14.1.1 | 白名单配置 patch + Hilt 模块骨架 | 默认 `mobileBridge.exposeRemoteSkills` 加 `personal-data-hub.*` + `approvalChannelsForMobile` 加 5 Privileged method + `PersonalDataHubCommands` + Hilt 注入 | 单测 ≥ 5（whitelist 路由 + Hilt provides） |
| 14.1.2 | 21 method actor + Codable | `PersonalDataHubCommands.kt` 21 method 全 typed wrapper + `HubModels.kt` 全 envelope | 单测 ≥ 21 |
| 14.1.3 | HubAskScreen + ViewModel | Compose + Markdown answer + Citation chip + AcceptNonLocalDialog + acceptNonLocal 流 | 单测 ≥ 8 + UI preview |
| 14.1.4 | HubAdaptersScreen + HubHealthCard | 列表 + 长按触发 sync + 4 健康卡片 | 单测 ≥ 6 |
| 14.1.5 | HubAuditScreen + RemoteOperateView 14 tab wire | 审计列表 + paged + 14 tab segmented | 单测 ≥ 4 |
| 14.1.6 | Phase 14.1 静态审计 + 集成测试 | mockk 全链路：ask → AnalysisEngine 模拟 → AskResult → ViewModel state 校验 | 集成 ≥ 3 |

### Phase 14.2 — iOS impl（3d）

| Sub | 主题 | 关键产出 |
|---|---|---|
| 14.2.1 | `PersonalDataHubCommands` actor + `PersonalDataHubModels.swift` | 21 method + Codable mirror Android |
| 14.2.2 | `HubAskView` + `HubViewModels.swift HubAskViewModel` | SwiftUI + Markdown answer + CitationChip + AcceptNonLocalSheet |
| 14.2.3 | `HubAdaptersView` + `HubHealthCard.swift` | 列表 + swipe action sync + 4 health card |
| 14.2.4 | `HubAuditView` | 列表 + paged |
| 14.2.5 | `RemoteOperateView` 第 14 tab "Hub" + `RemoteDependencies` add hub + dispatcher + fan-out 子流 4 buffer 256 | iOS 第 14 tab horizontal scroll segmented verify |
| 14.2.6 | Phase 14.2 静态审计 + 集成测试 | XCTest + mock invoke → ViewModel state 校验 |

### Phase 14.3 — 流式同步（1d）

| Sub | 主题 |
|---|---|
| 14.3.1 | Android `HubSyncEventDispatcher` + ViewModel 集成 |
| 14.3.2 | iOS `HubSyncEventDispatcher` + ViewModel 集成 |
| 14.3.3 | 双端流式进度 UI（连接中 / 拉取中 / 归一化 / 完成） |

---

## 7. Traps & 风险（forward-looking）

| # | Trap | 描述 | 缓解 |
|---|---|---|---|
| T1 | 白名单 namespace 通配后，新增 method 自动放行 | 未来桌面加新 `personal-data-hub.X` method 时手机自动可调，可能泄漏未审 method | (1) namespace 通配 + 5 Privileged 显式列入 `approvalChannelsForMobile`；(2) 每加新 method 走 PR review checklist：是否需进 approvalChannelsForMobile？ |
| T2 | 桌面 LLM provider 切换瞬间，手机正在 ask | 用户在桌面切到 Claude 时手机 ask in-flight → 返回 NonLocalBlocked 但用户已等了 5s | acceptNonLocalGate 流提示文案明确："在你发问期间桌面 LLM 被切换到非本地"，再次发问询问是否接受 |
| T3 | `eventDetail` 返回事件含 PDF / 大附件元数据 → 手机端渲染卡 | event.extra 可能含 base64 PDF / 大邮件正文 | v0.1 `eventDetail` 桌面端裁字段 — 只回 subtype / actor / at / 关键 fields（amount / merchant / counterparty），不回 `extra.bodyText` / `extra.pdfBytes`；v0.2 加 `personal-data-hub.eventAttachment` 单独 method 拉附件 |
| T4 | citation 引用的 eventId 在 fetch 时已被销毁（vault.destroy 或 unregister 清表） | 用户在 ask 后调 destroy → 再点 citation 报 404 | UI: eventDetail 返回 404 → chip 灰色 + "事件已不在 vault"，不抛 fatal |
| T5 | 离线触发 syncAdapter | DC/signaling 都不通时 sync 入 OfflineQueue → 网络恢复后 drainer 触发，但桌面 vault 可能已有 user 在 desktop 触发的 sync → 双 sync 并发 | Adapter `health()` 进入流水线时已检查 `vault.watermark`，重叠窗口 0 重复事件；UI 不阻拦双 sync |
| T6 | 长答案 Markdown 渲染崩溃（手机端 markdown lib 兼容性） | LLM 答案含复杂 table / nested list | Android 用 `Markwon` 安全模式；iOS 用 `AttributedString(markdown:)` 16+；答案过长 (> 4000 chars) 自动截断 + "见完整答案" 跳详细页 |
| T7 | acceptNonLocal 误点 → 长期 leak | 用户 dismiss dialog 反复出现，烦躁后误点 | "仅本次接受" 文案明确；UI 不持久化 acceptNonLocal=true；下次发问重新弹（与 Phase 4 ApprovalUI 一致） |
| T8 | mobile-skill-whitelist 配置文件被用户/恶意 app 改 → 越权 | `.chainlesschain/config.json` 0644 可读 | (1) 0600 写出；(2) Hub registerEmail / unregister 等 Privileged 还在桌面侧二次 ApprovalUI（不能仅靠 client-side gate） |
| T9 | `personal-data-hub.sync.progress` event 与既有 event 同名 collision | events fan-out 多子流共享底层 commandClient.events | event type 用 `personal-data-hub.sync.progress` full-qualified namespace，与 `terminal.output` / `ai.chat.delta` / `notification.received` 不冲突；dispatcher filter 用 startsWith("personal-data-hub.sync.progress") |
| T10 | iOS SwiftUI Inner View + StateObject init 模式 trap（已记忆） | `@EnvironmentObject` 在 init() 不可用 | Outer View 读 EnvironmentObject + 传 Inner View，Inner 在 init 构造 StateObject（per memory `ios_inner_view_stateobject_pattern.md`） |
| T11 | Android Compose AndroidView + LazyColumn citation list re-compose 漏 ViewModel state | 高频 chip tap | 用 `key()` 包 citation list item + `remember(eventId)` cache fetched detail |
| T12 | 双 invoke `eventDetail` 并发 race（用户连点 2 个 chip） | 第二个返回先 overwrite 第一个 ViewModel state | ViewModel 维 `currentDetailRequestId`，只接受最新 request 的 response（per Phase 5 iOS `currentStreamId` filter 模式） |

---

## 8. 验收

### 8.1 单测目标

- Android：`PersonalDataHubCommandsTest.kt` ≥ 21 + `HubAskViewModelTest.kt` ≥ 8 + `HubAdaptersViewModelTest.kt` ≥ 6 + `HubAuditViewModelTest.kt` ≥ 4 + `HubSyncEventDispatcherTest.kt` ≥ 5 = **≥ 44 单测**
- iOS：`PersonalDataHubCommandsTests.swift` ≥ 21 + `HubAskViewModelTests` ≥ 8 + `HubAdaptersViewModelTests` ≥ 6 + `HubAuditViewModelTests` ≥ 4 + `HubSyncEventDispatcherTests` ≥ 5 = **≥ 44 单测**
- 桌面：`mobile-skill-whitelist.test.js` 加 ≥ 5（personal-data-hub.* namespace + 5 Privileged ApprovalUI 路由）

### 8.2 集成测试

- Android：`PersonalDataHubIntegrationTest.kt` ≥ 3 — (1) mock RemoteCommandClient ask → AskResult → ViewModel done state；(2) mock acceptNonLocalGate 流；(3) mock syncAdapterStream events → dispatcher → ViewModel 进度更新
- iOS：同名 XCTest ≥ 3
- 桌面：`personal-data-hub-ipc-mobile-route.test.js` ≥ 2 — mobile-bridge → personal-data-hub-ipc handler 端到端 fake 链路

### 8.3 真机 E2E（Phase 14.4，本设计稿不含 — 需 Mac + iPhone + 真桌面 + Xiaomi Android）

8 场景矩阵：

1. **基础 Q&A**：Android/iPhone 发问 "上个月妈妈生日那周买了啥" → 桌面 Ollama 推理 → 答案 ≤ 8s + 3-5 个 citation chip
2. **Citation tap**：点任一 citation → 事件详情 sheet ≤ 200ms
3. **隐私 gate**：桌面切 Claude → Android/iPhone 发问 → 弹 NonLocalDialog → 取消 → 不发；再发问 → 确认 → 答案返回
4. **健康卡片**：进 Hub tab → 4 卡片显 vault.schemaVersion / llm.isLocal / kgSink.ok / ragSink.ok
5. **触发 sync**：长按 EmailAdapter → sync → 进度文字实时 → 完成 Snackbar
6. **审计回查**：Audit tab → 见最近 ask / ingest / sync 记录，时间戳 / actor 准确
7. **离线发问**：拔网线 → 发问 → 红色 banner "无法连接桌面"；不入离线队列
8. **DC fallback**：模拟 DC 断 → ask 自动走 signaling relay → 答案返回（RTT ≤ 600ms）

---

## 9. 配套：桌面端默认配置 patch（Phase 14.1 第 1 步）

`.chainlesschain/config.json` 默认值（在 `unified-config-manager.js` 加入）：

```jsonc
{
  "mobileBridge": {
    "enabled": true,
    "exposeRemoteSkills": [
      "terminal.*",
      "ai.*",
      "knowledge.*",
      "personal-data-hub.*",        // NEW Phase 14.1
      "system.info.*",
      "..."
    ],
    "approvalChannelsForMobile": [
      "marketplace.purchase",
      "did.delegate",
      "personal-data-hub.register-email",      // NEW — kebab-case to match
      "personal-data-hub.unregister-email",    //       the actual WS dispatch
      "personal-data-hub.register-alipay",     //       keys in personal-data-
      "personal-data-hub.unregister-alipay",   //       hub-protocol.js. camel-
      "personal-data-hub.unregister"           //       Case silently bypasses.
    ]
  }
}
```

> **配置覆盖优先级**（per CLAUDE.md "Configuration Management" 节）：环境变量 > `.chainlesschain/config.json` > 默认值。用户可通过编辑 config.json **完全关闭**手机访问 PDH (`mobileBridge.exposeRemoteSkills` 删 `personal-data-hub.*` 一行)，或 enable=false 关全部移动桥。

---

## 10. 参考

- 父文档：[`Personal_Data_Hub_Architecture.md`](./Personal_Data_Hub_Architecture.md)（PDH 主架构 + Phase 0-13 完整路线图）
- 桌面端 IPC：[`desktop-app-vue/src/main/ipc/personal-data-hub-ipc.js`](../../desktop-app-vue/src/main/ipc/personal-data-hub-ipc.js)
- 桌面端 WS：[`packages/cli/src/gateways/ws/personal-data-hub-protocol.js`](../../packages/cli/src/gateways/ws/personal-data-hub-protocol.js)
- 桌面端 mobile-skill-whitelist：[`desktop-app-vue/src/main/remote/handlers/mobile-skill-whitelist.js`](../../desktop-app-vue/src/main/remote/handlers/mobile-skill-whitelist.js)
- Android `SeedRegistry`（含 Phase 14.0 21 method 元数据）：[`android-app/app/src/main/java/com/chainlesschain/android/remote/registry/SeedRegistry.kt`](../../android-app/app/src/main/java/com/chainlesschain/android/remote/registry/SeedRegistry.kt#L386)
- 同构样板：
  - [`iOS_Phase_5_AI_Chat_Skill.md`](./iOS_Phase_5_AI_Chat_Skill.md) — iOS 远程 AI Chat skill，模式同
  - [`iOS_Phase_4_Notification_Skill.md`](./iOS_Phase_4_Notification_Skill.md) — events fan-out 模式参考
  - [`Android_Remote_Terminal_Plan_A1.md`](./Android_Remote_Terminal_Plan_A1.md) — Android 远程操控样板
- 关联设计：
  - [`iOS_Phase_6_3_6_4_Knowledge_AI_Desktop_Debt.md`](./iOS_Phase_6_3_6_4_Knowledge_AI_Desktop_Debt.md) — Knowledge / AI 扩展 skill（与 Hub 入口同等位置 tab）

---

## 11. 当前状态（v5.0.3.74，2026-05-20）

- ✅ **Phase 14.0** — Android `SeedRegistry` 21 method 元数据，含 5 Privileged 标 `requiresApprovalOverride = true`
- ✅ **Phase 14.1** — Android 接线 + UI 全完工
  - 14.1.1 桌面 whitelist defaults + approval gate kebab-case (`7dc47ee49`)
  - 14.1.1 follow-up: social-initializer wire mobileBridge config → RemoteGateway (`fa1be3a6f`)
  - 14.1.2 PersonalDataHubCommands actor 21 method + Codable models (`841651ea8`，kebab-case 修在 `839622250`)
  - 14.1.3 HubAskScreen + ViewModel + AcceptNonLocalDialog (in `841651ea8`)
  - 14.1.4 HubAdaptersScreen + HubHealthCard + ViewModel (in `841651ea8`)
  - 14.1.5 HubAuditScreen + NavGraph route + RemoteOperateScreen button (in `841651ea8`)
  - 14.1.6 PersonalDataHubIntegrationTest 3 集成测试 + route-mobile dispatcher (`dc3322452` + `fcfc555f3`)
- 🚧 **Phase 14.2** — iOS 接线 + UI（iOS scaffold 22/22 + 28 tests 已 land per `20722ee60`；UI + 14.3 dispatcher 待并行 session 推进）
- ✅ **Phase 14.3** — 流式同步 Android + 桌面端真接通
  - 14.3.1 Android `HubSyncEventDispatcher` + 7 单测 (`08c16cb42`)
  - 14.3 ViewModel 接入: `syncStream()` + `applyProgress()` + 6 streaming 单测 (`dd0b74a0b`)
  - 14.3 桌面 `route-mobile.js` `runSyncStream` helper + `index.js` `sendEventToPeer` 闭包 + 5 wiring 单测 (`badc1e108`)
  - 14.3.3 `HubAdaptersScreen` 流式按钮 + `progressTextFor` 文本 + 9 helper 单测 (`67af0bcaa`)
  - 🚧 14.3.2 iOS dispatcher + ViewModel + UI — 并行 session
- ⏳ **Phase 14.4** — 真机 E2E（待 Mac + iPhone + Xiaomi 24115RA8EC + 真桌面 + 真 Adapter 注册）

### 测试 totals（Android）

| Test file | Count |
|---|---|
| `PersonalDataHubCommandsTest.kt` | 26 |
| `HubAskViewModelTest.kt` | 8 |
| `HubAdaptersViewModelTest.kt` | 12 |
| `HubAuditViewModelTest.kt` | 5 |
| `PersonalDataHubIntegrationTest.kt` | 3 |
| `HubSyncEventDispatcherTest.kt` | 7 |
| `HubAdaptersProgressTextTest.kt` | 9 |
| **Total Android** | **70** ✅ |

桌面：`route-mobile.test.js` 20 + `mobile-skill-whitelist.test.js` 25 + `unified-config-manager.test.js` mobileBridge 1 = **46** desktop tests for Phase 14。

### Phase 14.3 end-to-end 数据流（已闭环 except 真机 verify）

```
Android UI 同步 button
  → HubAdaptersViewModel.syncStream(name)
  → PersonalDataHubCommands.syncAdapterStream(name)  ⇨ DC RPC
桌面 routeMobileCommand 'personal-data-hub' case
  → 构造 sendEventToPeer(method, params) 闭包绑 mobileBridge.sendToMobile(mobilePeerId, ...)
  → route-mobile.runSyncStream
    → 装 hub.registry.onSyncEvent = msg => sendEventToPeer('personal-data-hub.sync.progress', msg)
    → 返回 {streamId, name}  ⇨ Android 收到立即返回
    → 异步 hub.registry.syncAdapter(name, options) 跑
      → 每事件 fire onSyncEvent → mobileBridge.sendToMobile(...)
        ⇨ chainlesschain:event:notification 包装 → DC
Android P2PClient._events.emit(EventNotification)
  → HubSyncEventDispatcher filter method=='personal-data-hub.sync.progress'
  → HubAdaptersViewModel.applyProgress(HubSyncEvent)
  → UiState.syncProgressKind / Partition / Detail
  → progressTextFor(...) → AdapterRow 显示
"连接中…" → "拉取中 (INBOX) · 250 条" → "归一化中 · 30 事件" → "上次 +30 事件"
```

> **本文档为 Phase 14 首个完整设计稿**。后续 implementation 将依本稿落地；任何偏差通过 PR 回填本稿 `## Open Questions` 或 `## Traps` 章节。
