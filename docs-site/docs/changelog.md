# 更新日志

所有重要的项目变更都会记录在此文件中。  
格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，版本号遵循语义化版本。

## [5.0.2.43 / CLI 0.156.6] - 2026-04-22 (MainLayout + DIDManagement SFC 拆分 · Shell 接入真实 LLM · 启动流程拆 Critical/Deferred · 重型组件懒加载 · CLI postinstall 跨平台)

### Fixed

- **CLI `postinstall` 跨平台** — `chainlesschain@0.156.5` 把 postinstall 脚本改写成跨平台 Node 实现，修复 Windows 全局安装时 `bash: not found` 导致失败的问题；`0.156.6` 为随后的打包补丁。

### Added

- **MainLayout.vue 六级拆分** — 把原 3203 行桌面壳按功能切成 6 个独立 SFC，累计 **3203 → 1943 行（−39%）**：
  - `FavoriteManagerModal.vue`（151 行） — "管理快捷访问" 弹窗，Favorites / Recents Tab。
  - `HeaderBreadcrumbs.vue`（170 行） — 135 行 `breadcrumbs` computed（7 路由前缀分支），router.push 点击处理。
  - `SyncStatusButton.vue`（97 行） — 全局同步状态按钮，自管 `isSyncing` / `syncStatus` / `syncError` + 3 个事件监听。
  - `VoiceCommandHandler.vue`（584 行） — `VoiceFeedbackWidget` + 75 条语音命令模式表 + 7 个语音识别/转发 handler。
  - `SidebarContextMenu.vue`（97 行） — 侧边栏右键菜单，`show(event, item)` 命令式暴露，14 个调用点不变。
  - `AppHeader.vue`（210 行） — `<a-layout-header>` 整块（侧栏切换 / 面包屑 / Ctrl+K / 同步 / AI / 语言 / 通知 / 用户菜单）。
- **DIDManagement.vue 三级拆分** — 把原 1390 行组件切成 3 个子组件，累计 **1390 → 543 行（−61%）**：
  - `AutoRepublishSettingsPane.vue`（148 行） — 自动重发布设置弹窗 + 状态轮询。
  - `MnemonicModals.vue`（308 行） — 助记词展示 + 导出两个弹窗合一，`defineExpose({showDisplay, triggerExport})` 命令式 API。
  - `IdentityDetailsModal.vue`（约 421 行） — 身份详情 / DID Document / QR 三个弹窗合一 + DHT publish/unpublish。
- **Shell 接入真实 LLM** — V6 预览壳 ShellComposer 真正可发消息：
  - `handleSend()` 接入 `llm-preview-bridge`：优先 `sendChatStream` (prompt-only) 走 `queryStream` 流式；失败回退 `sendChat` (带 history) 非流式。
  - ConversationStream 新增 typing indicator（3 点波浪），无 DID chip 视觉噪音。
  - 开发基于现有 `useConversationPreviewStore`：`beginStreamingAssistant` / `updateAssistantContent` / `finalizeStreamingAssistant` / `removeMessage`。
- **主进程启动拆 Critical / Deferred** — `bootstrap` 按阶段分两段，`main/index.js` 改走 fast-start：
  - `bootstrapCritical()` 仅跑阶段 0-5（Hooks / 核心 / 文件 / LLM / 会话 / RAG+Git），splash 5-55%。
  - `bootstrapDeferred()` 跑阶段 6+，splash 55-90%。
  - IPC 注册拆 `registerCriticalIPC()` + `registerDeferredIPC()`，setupIPC 在 `createWindow` 内仅调用一次（避免 `llm:chat` / `conversation:*` 二次注册与 ipc-guard 竞态）。
  - `CHAINLESSCHAIN_LEGACY_BOOT=1` 保留旧单阶段启动回退开关。
- **重型渲染器组件懒加载** — 5 个重型编辑器改 `defineAsyncComponent`：
  - `FileEditor.vue` → Monaco（~5MB）。
  - `KnowledgeDetailPage.vue` → Milkdown MarkdownEditor（~1.5MB）。
  - `DesignEditorPage.vue` → Fabric.js DesignCanvas（~1MB）。
  - `ProjectDetailPage.vue` → CodeEditor / MarkdownEditor / WebDevEditor 一次三件（共 ~5MB）。
  - 实测 monaco 独立 chunk 3.7MB / gzip 938KB，首屏不再强拉。
- **后端服务并行轮询** — `BackendServiceManager`：
  - 4 个服务改并行轮询（原串行 4×30s），单服务最多 10s，新增 `servicesReady` Promise 供调用方 await。
  - `startServices()` 不再阻塞启动，触发后即返回。

### Changed

- **Phase 3.4 软开关重定向目标：`/v2` → `/v6-preview`** — `router/v6-shell-default.ts::resolveHomeRedirect` 的 opt-in 目标由 `/v2` 改为 `/v6-preview`（Claude-Desktop 风格预览壳），让默认开启场景直接进入真实可用的新壳；同步 9/9 单测 + JSDoc 注释已对齐。
- `SyncStatusButton` 取消 prettier 多行格式，紧跟项目样式规范。
- `components.d.ts` 自动生成文件分号风格对齐。

### Verified

- Store 测试 **600/600** 绿（23 文件，35s）。
- Shell + router + bootstrap 定向测试 **76/76** 绿（5 文件）。
- Skill-handlers + ipc-guard + bootstrap **285/285** 绿。
- Vue 组件测试 **124/125（1 skip）**。
- AI + core + multi-agent 单元测试 **411/413（2 skip）**。
- Database + enterprise + did + knowledge 单元测试 **1456/1464（8 skip）**（3 stderr 错误是预存在的测试脚手架 `no such table: skills` / `pubsub.addEventListener`，非本次引入）。
- shell-preview 组件/服务/widgets **51/51** 绿。
- 集成测试（mcp / canonical-tool / canonical-workflow / code-execution / file-ops / plugin-ext / coding-agent-hosted-tools / planning-ipc / lifecycle）**98/104（6 skip）**。
- Smoke：`vite build` + `build:main` 均成功；`eslint` 0 errors。
- E2E：playwright 1017 测试 / 163 文件全部可枚举；环境健康检查 80%。

---

## [5.0.2.43 / CLI 0.156.4] - 2026-04-21（下午）(SystemSettings / ChatPanel SFC 拆分 + CI/Release 修复)

### Added

- **SystemSettings.vue 六级 Pane 拆分** — 把原 3444 行单文件按功能切成 6 个独立 SFC：
  - `P2PNetworkPane.vue`（830 行） — 流量层 / WebRTC / NAT / Circuit Relay / 网络诊断
  - `SpeechRecognitionPane.vue`（421 行） — Web Speech / Whisper API / Whisper Local / 音频处理
  - `LLMPane.vue`（622 行） — 7 个 Provider 表单 + 对话/嵌入连通性测试
  - `DatabasePane.vue`（约 280 行，自包含） — db 位置 / 迁移 / 备份管理
  - `ProjectPane.vue`（74 行） — 项目根路径设置
  - `PerformancePane.vue`（62 行） — 硬件加速 / GPU / 内存 / 缓存滑块
  - 统一采用 `defineModel('config')` + `v-model:config` 模式，子组件可直接改嵌套 `config.*.*` 路径；最终 SystemSettings.vue **3444 → 1070 行（−69%）**。
- **ChatPanel.vue 两级外提** — 从 4057 行组件抽出两个可复用模块：
  - `chatPanelUtils.js` — 7 个纯工具（`sanitizeJSONString` / `sanitizeFileName` / `getDirectoryPath` / `joinPath` / `resolveProjectOutput` / `cleanForIPC` + `WINDOWS_RESERVED_FILE_NAMES`）。
  - `composables/useMemoryLeakGuard.js` — 封装 `activeTimers` / `activeListeners` + `safeSetTimeout` / `safeRegisterListener` + 自动 `onUnmounted` 清理；对任何跟踪 `electronAPI.*.on` 监听器的组件都可复用。
  - ChatPanel.vue **4057 → 3788 行（−269）**。
- **CLI 0.156.2 → 0.156.4** — 0.156.3 已被 npm 占用，跳到 0.156.4 再发布。

### Changed

- 三站 CLI 版本号统一刷新：用户文档 tagline / 官网首页 chip / 设计站 tagline 全部 `0.156.2` → `0.156.4`。
- 设计站 tagline 修正历史遗留 `v5.0.2.34 / CLI 0.156.0` 为 `v5.0.2.43 / CLI 0.156.4`。

### Fixed

- **CI/Release 打包链** — 多个 commit 修 release 产物：
  - `rsync --ignore-existing` 替代 `cp -Rn` 做 node_modules 合并。
  - 跨 workspace 安装平台专属 rollup 原生 binary（E2E workflow）。
  - 重写 `@chainlesschain/*` workspace symlink 为绝对路径，避免打包后链接指空。
  - `xcopy` 永远把 hoisted `node_modules` 拷进发布包。
  - CLI publish 在 npm 已有同版本时跳过（避免 409）。

---

## [5.0.2.43 / CLI 0.156.2] - 2026-04-21（上午）(发布前测试回归闭环 + 533 自动文档刷新)

### Added

- **发布前测试回归闭环** — 92 单元测试 + 5 集成测试 + `vue-tsc --noEmit` + `vite build` + `describe.skip` E2E **五关全绿**，无 bug 溢出。
- **533 份自动文档刷新** — `desktop-app-vue/docs/api/generated/*.md` prettier list/heading 规范刷新，`ARCHITECTURE_OVERVIEW.md` + `COMPONENT_REFERENCE.md` 格式同步。
- **CLI 0.156.1 → 0.156.2** — patch 补丁（无源码改动，用于 v5.0.2.43 npm 发布）。

### Changed

- 三站版本号统一刷新：`docs-website-v2` 官网 footer + `/desktop` chip + `index.astro` 首页 hero chip 全部 `v5.0.2.34` → `v5.0.2.43`，CLI chip `v0.156.0` → `v0.156.2`。

---

## [5.0.2.42 / CLI 0.156.1] - 2026-04-20 晚 (V6 Shell 回归闭环 + 用户文档)

### Added

- **V6 Shell + `/v6-preview` 用户文档** — `desktop-v6-shell.md` 新增 §18 "P7–P9b 预览壳" 全套 + §18.7 测试回归表；`desktop-ui-refactor-user-guide.md` 新建 355 行用户指南；6 份核心指南追加 17 章规范附录。
- **设计文档** — `docs/design/桌面版UI重构_设计文档.md` 458 行，含 10 章 + 附录 A/B。

### Changed

- `sync-docs.js` / `sync-design-docs.js` 加入新中文 → ASCII 映射；两站 VitePress sidebar 加入新条目。

---

## [5.0.2.34 / CLI 0.140-0.142] - 2026-04-19 (V2 第十批 · 16 个编排/自治/经济/进化 lib 级治理表面)

### Added — 16 个 V2 lib 级治理表面（严格增量 · 内存 governance · 与运行态 / 传输层 / 协议层完全独立）

- **`orchestrator` V2**（`cc orchgov`）— 编排 profile 4-state（retired 终态、paused→active 恢复）+ task 5-state（3 终态），per-owner active cap 6、per-profile pending cap 12，`autoPauseIdle` + `autoFailStuck`；45 V2 单测（gov-stats-v2 独立，避开已有 `cc orchestrate router *-v2`）。
- **`perf-tuning` V2**（追加到现有 `cc perf`）— tuning profile 4-state（decommissioned 终态、stale→active 恢复）+ bench 5-state（3 终态），per-owner 6、per-profile 10，`autoStaleIdle` + `autoFailStuck`；45 V2 单测（Phase 22 SQLite 不动）。
- **`topic-classifier` V2**（`cc topiccls`）— classifier profile 4-state（archived 终态、stale→active 恢复）+ job 5-state（3 终态），per-owner 8、per-profile 20，`autoStaleIdle` + `autoFailStuck`；45 V2 单测。
- **`iteration-budget` V2**（`cc itbudget`）— budget profile 4-state（exhausted 终态、paused→active 恢复）+ run 5-state（3 终态），per-owner 4、per-profile 8，`autoPauseIdle` + `autoFailStuck`；45 V2 单测。
- **`git-integration` V2**（`cc git`）— repo profile 4-state（decommissioned 终态、archived→active 恢复）+ commit 5-state（3 终态），per-owner 10、per-profile 20，`autoArchiveIdle` + `autoFailStuck`；45 V2 单测。
- **`cowork-task-runner` V2**（`cc cowork runner-*-v2`）— runner profile 4-state（retired 终态、paused→active 恢复）+ exec 5-state（3 终态），per-owner 8、per-profile 15，`autoPauseIdle` + `autoFailStuck`；45 V2 单测（`runner-*` 前缀避开 Agent Coordinator V2 冲突）。
- **`inference-network` V2**（`cc inference`）— node profile 4-state（decommissioned 终态、degraded→active 恢复）+ job 5-state（3 终态），per-owner 12、per-profile 25，`autoDegradeIdle` + `autoFailStuck`；45 V2 单测（与已有 task-scheduling V2 共存于同文件）。
- **`content-recommender` V2**（`cc recommend cr-*-v2`）— recommender profile 4-state（archived 终态、stale→active 恢复）+ job 5-state（3 终态），per-owner 8、per-profile 10，`autoStaleIdle` + `autoFailStuck`；45 V2 单测（`cr-*` 前缀避开 content-recommendation.js V2）。
- **`app-builder` V2**（`cc lowcode`）— app profile 4-state（archived 终态、paused→active 恢复）+ build 5-state（3 终态），per-owner 10、per-profile 20，`autoPauseIdle` + `autoFailStuck`；45 V2 单测。
- **`siem-exporter` V2**（`cc siem`）— SIEM target 4-state（retired 终态、degraded→active 恢复）+ export 5-state（3 终态），per-owner 8、per-profile 50，`autoDegradeIdle` + `autoFailStuck`；45 V2 单测。
- **`autonomous-agent` V2**（`cc autoagent`）— autonomous agent profile 4-state（archived 终态、paused→active 恢复）+ run 5-state（3 终态），per-owner 5、per-profile 10，`autoPauseIdle` + `autoFailStuck`；45 V2 单测（与交互式 `cc agent` 分离）。
- **`compliance-framework-reporter` V2**（`cc compliance fwrep-*-v2`）— framework profile 4-state（archived 终态、deprecated→active 恢复）+ report 5-state（3 终态），per-owner 8、per-profile 15，`autoDeprecateIdle` + `autoFailStuck`；45 V2 单测（`fwrep-*` 前缀避开已有 compliance V2）。
- **`agent-economy` V2**（`cc economy`）— account profile 4-state（closed 终态、frozen→active 恢复）+ tx 5-state（3 终态），per-owner 20、per-profile 30，`autoFreezeIdle` + `autoFailStuck`；41 V2 单测（默认 currency=CLC）。
- **`pipeline-orchestrator` V2**（`cc pipeline`）— pipeline profile 4-state（archived 终态、paused→active 恢复）+ run 5-state（3 终态），per-owner 10、per-profile 20，`autoPauseIdle` + `autoFailStuck`；41 V2 单测。
- **`evolution-system` V2**（`cc evolution`）— evo goal profile 4-state（archived 终态、paused→active 恢复）+ cycle 5-state（3 终态），per-owner 6、per-profile 12，`autoPauseIdle` + `autoFailStuck`；41 V2 单测。
- **`hierarchical-memory` V2**（`cc hmemory`）— tier profile 4-state（retired 终态、dormant→active 恢复）+ promotion 5-state（3 终态），per-owner 12、per-profile 30，`autoDormantIdle` + `autoFailStuck`；41 V2 单测（默认 level=short-term）。

### Changed

- **CLI 包版本**：`chainlesschain@0.137.0 → 0.142.0`（V2 第十批分多次推进，每次落 2 ~ 4 个 lib 级 surface）
- **design doc 96**：新增"第十批（编排 / 自治 / 经济 / 进化治理层 · 16 个）"章节，版本演进累计更新为 92+ V2 表面

### Tests

本批相较 0.139.0 累计新增 **704 个 V2 单元测试**（12 × 45 + 4 × 41），零回归。

| 层级 | 文件 | 测试 | 状态 |
| --- | --- | --- | --- |
| CLI 单元 | 274 | **11718 / 11718** | 全通过（125s）|
| CLI 集成 | 40 | **696 / 696** | 全通过（40s）|
| CLI E2E | 38 | **565 / 565** | 全通过（360s）|
| **合计** | **352** | **12979 / 12979** | **零回归** |

---

## [5.0.2.34 / CLI 0.137-0.139] - 2026-04-19 (V2 第九批 · 14 个 session/context/permission/social lib 级治理表面)

### Added — 14 个 V2 lib 级治理表面（严格增量 · 内存 governance · 与 session.db / 角色表 / DI 容器 / 社交边零耦合）

- **`slot-filler` V2**（`cc slotfill`）— template profile 4-state（archived 终态、stale→active 恢复）+ fill 5-state（3 终态），per-owner 10、per-profile 20，`autoStaleIdle` + `autoFailStuck`；37 V2 单测。
- **`web-fetch` V2**（`cc webfetch`）— target profile 4-state（retired 终态、degraded→active 恢复）+ job 5-state（3 终态），per-owner 12、per-profile 30，`autoDegradeIdle`（7d）+ `autoFailStuck`（60s）；37 V2 单测。
- **`memory-injection` V2**（`cc meminj`）— rule profile 4-state（archived 终态、paused→active 恢复）+ injection 5-state（3 终态），per-owner 10、per-profile 25，`autoPauseIdle` + `autoFailStuck`；37 V2 单测。
- **`session-search` V2**（`cc seshsearch`）— search profile 4-state（archived 终态、stale→active 恢复）+ query 5-state（3 终态），per-owner 8、per-profile 20，`autoStaleIdle` + `autoFailStuck`；37 V2 单测。
- **`session-tail` V2**（`cc seshtail`）— tail subscription 4-state（closed 终态、paused→active 恢复）+ event 5-state（3 终态），per-owner 10、per-sub 30，`autoPauseIdle`（24h）+ `autoFailStuck`（60s）；37 V2 单测。
- **`session-usage` V2**（`cc seshu`）— usage budget 4-state（archived 终态、exhausted→active 恢复）+ record 5-state（recorded/rejected/cancelled 3 终态），per-owner 5、per-budget 50，`autoExhaustIdle` + `autoRejectStuck`；37 V2 单测。
- **`session-hooks` V2**（`cc seshhook`，避开 SQLite 支持的 `cc hook`）— hook profile 4-state（retired 终态、disabled→active 恢复）+ invocation 5-state（3 终态），per-owner 12、per-profile 25，`autoDisableIdle` + `autoFailStuck`；37 V2 单测。
- **`mcp-scaffold` V2**（`cc mcpscaf`，避开 `cc mcp`）— scaffold profile 4-state（archived 终态、stale→active 恢复）+ generation 5-state（failed 仅从 generating，queued 不可失败；3 终态），per-owner 6、per-profile 15，`autoStaleIdle` + `autoFailStuck`（60s）；37 V2 单测。
- **`plan-mode` V2**（`cc planmode`）— plan profile 4-state（archived 终态、paused→active 恢复）+ step 5-state（3 终态），per-owner 6、per-profile 15，`autoPauseIdle` + `autoFailStuck`；39 V2 单测。
- **`permission-engine` V2**（`cc perm`）— perm rule 4-state（retired 终态、disabled→active 恢复）+ check 5-state（allowed/denied/cancelled），per-owner 10、per-rule 30，`autoDisableIdle` + `autoDenyStuck`；38 V2 单测。
- **`user-profile` V2**（`cc uprof`）— user profile 4-state（archived 终态、dormant→active 恢复）+ pref 5-state（proposed/applied/rejected/superseded/cancelled，applied 非终态），per-owner 5、per-profile 20，`autoDormantIdle` + `autoCancelStale`；37 V2 单测。
- **`social-graph` V2**（`cc social sg-*-v2`，`sg-*` 前缀避开 social-manager V2）— sg node 4-state（removed 终态、inactive→active 恢复）+ edge 5-state（proposed/established/severed/expired/cancelled，established 非终态），per-owner 50、per-node 100，`sg-autoDeactivateIdle` + `sg-autoExpireStale`；37 V2 单测。
- **`service-container` V2**（`cc svccont`）— svc container 4-state（decommissioned 终态、degraded→active 恢复）+ resolution 5-state（3 终态），per-owner 8、per-profile 25，`autoDegradeIdle` + `autoFailStuck`；37 V2 单测。
- **`task-model-selector` V2**（`cc tms`）— selector profile 4-state（decommissioned 终态、stale→active 恢复）+ selection 5-state（3 终态），per-owner 8、per-profile 16，`autoStaleIdle` + `autoFailStuck`；37 V2 单测。

### Changed

- **CLI 包版本**：`chainlesschain@0.131.0 → 0.137.0 → 0.139.0`（V2 第九批分批推进）
- **命令层**：14 个全新 top-level 分派，避免与已有 top-level（`cc session`、`cc mcp`、`cc hook`、`cc social`）冲突

### Tests

本批相较 0.136.0 累计新增 **521 个 V2 单元测试**（10×37 + 39 + 38 + 2×37），零回归。

---

## [5.0.2.34 / CLI 0.131-0.136] - 2026-04-18 晚 (V2 第八批 · 12 个 lib 级治理表面)

### Added — 12 个 V2 lib 级治理表面（严格增量 · 内存 governance · 与 SQLite / 传输层 / 协议层完全独立）

- **`a2a-protocol` V2** — `A2A_AGENT_MATURITY_V2` 4-state（retired 终态）+ `A2A_MESSAGE_LIFECYCLE_V2` 5-state（3 终态），per-owner active-agent cap（pending→active 仅）、per-agent pending-message cap（queued+dispatching）在 `createA2aMessageV2` 强制，`autoRetireIdleA2aAgentsV2` + `autoFailStuckA2aMessagesV2`；40 V2 单测，独立于 Phase 81 A2A schema / typed subscription 实现。
- **`activitypub-bridge` V2** — `AP_ACTOR_MATURITY_V2` 4-state + `AP_ACTIVITY_LIFECYCLE_V2` 5-state（3 终态），per-owner active-actor cap、per-actor pending-activity cap 在 `createApActivityV2` 强制，`autoRetireIdleApActorsV2` + `autoFailStuckApActivitiesV2`；39 V2 单测，独立于现有 ActivityPub outbox 语义。
- **`bi-engine` V2** — `BI_DATASET_MATURITY_V2` 4-state + `BI_QUERY_LIFECYCLE_V2` 5-state（3 终态），per-owner active-dataset cap、per-dataset pending-query cap 在 `createBiQueryV2` 强制，`autoArchiveIdleBiDatasetsV2` + `autoFailStuckBiQueriesV2`；39 V2 单测，独立于 Phase 95 NL→SQL / IQR 异常 / 线性预测。
- **`browser-automation` V2** — `BROWSE_SESSION_MATURITY_V2` 4-state + `BROWSE_STEP_LIFECYCLE_V2` 5-state（3 终态），per-owner active-session cap、per-session pending-step cap 在 `createBrowseStepV2` 强制，`autoArchiveIdleBrowseSessionsV2` + `autoFailStuckBrowseStepsV2`；37 V2 单测，独立于现有 Playwright / MCP computer-use 集成。
- **`cross-chain` V2** — `CC_BRIDGE_MATURITY_V2` 4-state + `CC_TRANSFER_LIFECYCLE_V2` 5-state（3 终态），per-owner active-bridge cap、per-bridge pending-transfer cap 在 `createCrossChainTransferV2` 强制，`autoDegradeIdleCcBridgesV2` + `autoFailStuckCcTransfersV2`；40 V2 单测，独立于 Phase 89 bridge/swap/message HTLC 流。
- **`dao-governance` V2** — `DAO_REALM_MATURITY_V2` 4-state + `DAO_PROPOSAL_LIFECYCLE_V2` 5-state（3 终态），per-owner active-realm cap、per-realm open-proposal cap 在 `createDaoProposalV2` 强制，`autoArchiveIdleDaoRealmsV2` + `autoFailStuckDaoProposalsV2`；41 V2 单测，独立于 Phase 92 二次方投票 / 循环安全委托。
- **`dlp-engine` V2** — `DLP_POLICY_MATURITY_V2` 4-state + `DLP_INCIDENT_LIFECYCLE_V2` 5-state（3 终态），per-owner active-policy cap、per-policy open-incident cap 在 `createDlpIncidentV2` 强制，`autoDeprecateIdleDlpPoliciesV2` + `autoCloseStaleDlpIncidentsV2`；40 V2 单测，独立于 Phase 50 channel-scoped 策略 / UTF-8 byte-gate。
- **`evomap-manager` V2** — `EVOMAP_HUB_MATURITY_V2` 4-state + `EVOMAP_SUBMISSION_LIFECYCLE_V2` 5-state（3 终态），per-owner active-hub cap、per-hub pending-submission cap 在 `createEvoSubmissionV2` 强制，`autoArchiveIdleEvoHubsV2` + `autoFailStuckEvoSubmissionsV2`；39 V2 单测，独立于 Phase 42 federation / 加权投票实现。
- **`matrix-bridge` V2** — `MX_ROOM_MATURITY_V2` 4-state + `MX_EVENT_LIFECYCLE_V2` 5-state（3 终态），per-owner active-room cap、per-room pending-event cap 在 `createMxEventV2` 强制，`autoArchiveIdleMxRoomsV2` + `autoFailStuckMxEventsV2`；37 V2 单测。
- **`nostr-bridge` V2** — `NOSTR_RELAY_MATURITY_V2` 4-state + `NOSTR_EVENT_LIFECYCLE_V2` 5-state（3 终态），per-owner active-relay cap、per-relay pending-event cap 在 `createNostrEventV2` 强制，`autoDegradeIdleNostrRelaysV2` + `autoFailStuckNostrEventsV2`；39 V2 单测。
- **`session-consolidator` V2** — `CONSOL_PROFILE_MATURITY_V2` 4-state + `CONSOL_JOB_LIFECYCLE_V2` 5-state（3 终态），per-owner active-profile cap、per-profile pending-job cap 在 `createConsolJobV2` 强制，`autoArchiveIdleConsolProfilesV2` + `autoFailStuckConsolJobsV2`；38 V2 单测，独立于现有 session-consolidator 聚合流。
- **`zkp-engine` V2** — `ZKP_CIRCUIT_MATURITY_V2` 4-state + `ZKP_PROOF_LIFECYCLE_V2` 5-state（3 终态），per-owner active-circuit cap、per-circuit pending-proof cap 在 `createZkpProofV2` 强制，`autoArchiveIdleZkpCircuitsV2` + `autoFailStuckZkpProofsV2`；41 V2 单测，独立于 Phase 88 scheme-parametric（Groth16/PLONK/Bulletproofs）实现。

### Changed

- **CLI 包版本**：`chainlesschain@0.131.0 → 0.136.0`（V2 第八批分多次推进，每次落 2 ~ 3 个 lib 级 surface）
- **docs-site**：首页 hero tagline 同步到 v5.0.2.34 · CLI 0.136.0 · V2 规范层第八批 · 11700+ 测试

### Tests

本批相较 0.130.0 累计新增 **470 个 V2 单元测试**（40+39+39+37+40+41+40+39+37+39+38+41），零回归。

| 层级 | 文件 | 测试 | 状态 |
| --- | --- | --- | --- |
| CLI 单元 | 244 | **10493 / 10493** | 全通过 |
| CLI 集成 | 40 | **696 / 696** | 全通过 |
| CLI E2E | 38 | **565 / 565** | 全通过 |
| **合计** | **322** | **11754 / 11754** | **零回归** |

---

## [5.0.2.34 / CLI 0.124-0.130] - 2026-04-18 (V2 第七批 · 9 个治理表面)

### Added — 9 个 V2 治理表面（严格增量，纯内存 governance，与 SQLite / 传输层独立）

- **`cc sso` V2** (CLI 0.124.0) — Provider 4-state 成熟度（`pending/active/deprecated/retired`，`deprecated→active` 恢复）+ 5-state 登录生命周期（`initiated/authenticating/completed/failed/cancelled`，3 终态），per-owner active-provider cap（`pending→active` 仅）、per-provider pending-login cap（`initiated+authenticating`）在 `createLoginV2` 时强制，`autoDeprecateIdleProvidersV2` + `autoFailStuckLoginsV2`；35 V2 单测，基于现有 SSO SQLite 表。
- **`cc workflow` V2** (CLI 0.125.0) — Workflow 4-state 成熟度（`draft/active/paused/retired`，`paused→active` 恢复）+ 5-state Run 生命周期（`queued/running/succeeded/failed/cancelled`，3 终态），per-owner active-workflow cap（`draft→active` 仅）、per-workflow pending-run cap（`queued+running`）在 `createRunV2` 时强制，`autoPauseIdleWorkflowsV2` + `autoFailStuckRunsV2`；44 V2 单测，独立于旧 DAG 执行器。
- **`cc router` V2** (CLI 0.127.0) — Router Profile 4-state 成熟度 + 5-state dispatch 生命周期（3 终态），per-owner active-profile cap（`pending→active` 仅）、per-profile pending-dispatch cap（`queued+dispatching`）在 `createDispatchV2` 时强制，`autoDegradeIdleProfilesV2` + `autoFailStuckDispatchesV2`；37 V2 单测（共 43），新顶层 `router` 命令，独立于旧 AgentRouter 类。
- **`cc hook` V2** (CLI 0.128.0) — Hook Profile 4-state 成熟度（`retired` 终态、`disabled→active` 恢复）+ 5-state exec 生命周期（3 终态），per-owner active-hook cap（`pending→active` 仅）、per-hook pending-exec cap（`queued+running`）在 `createHookExecV2` 时强制，`autoDisableIdleHooksV2` + `autoFailStuckExecsV2`；42 V2 单测（共 76），独立于 SQLite `registerHook` / `executeHooks` 路径。
- **`cc mcp` V2** (CLI 0.129.0) — MCP Server Profile 4-state 成熟度（`retired` 终态、`degraded→active` 恢复）+ 5-state invocation 生命周期（3 终态），per-owner active-server cap（`pending→active` 仅）、per-server pending-invocation cap（`queued+dispatching`）在 `createInvocationV2` 时强制，`autoDegradeIdleServersV2` + `autoFailStuckInvocationsV2`；33 V2 单测（共 65），独立于 MCPClient 传输层。
- **`cc cowork coord-*-v2`** (CLI 0.130.0) — Coord Agent 4-state 成熟度（`retired` 终态、`idle→active` 恢复）+ 5-state assignment 生命周期（3 终态），per-owner active-agent cap（`pending→active` 仅）、per-agent pending-assignment cap（`queued+dispatched`）在 `createAssignmentV2` 时强制，`autoIdleCoordAgentsV2` + `autoFailStuckAssignmentsV2`；32 V2 单测（共 74），函数名以 `Coord` 中缀避免与旧 team/template/result 流冲突。
- **`cc subagent` V2** — Sub-Agent Profile 4-state 成熟度（`retired` 终态、`paused→active` 恢复）+ 5-state task 生命周期（3 终态），per-owner active cap、per-profile pending cap，`autoPauseIdle` + `autoFailStuck`；37 V2 单测（共 43），独立于旧 RingBuffer-backed 单例注册中心。新顶层 `subagent` 命令。
- **`cc execbe` V2** — Execution Backend Profile 4-state 成熟度（`retired` 终态、`degraded→active` 恢复）+ 5-state exec-job 生命周期（`succeeded` 终态 + 3 终态），per-owner active cap、per-backend pending cap，`autoDegradeIdle` + `autoFailStuck`；46 V2 单测（共 68），独立于 Local/Docker/SSH Backend 实现。新顶层 `execbe` 命令。
- **`cc todo` V2** — Todo List 4-state 成熟度（`archived` 终态、`paused→active` 恢复）+ 5-state item 生命周期（`in_progress` 中间态 + 3 终态），per-owner active cap、per-list pending cap，`autoPauseIdle` + `autoFailStuck`；39 V2 单测（共 41），独立于 per-session `writeTodos`/`getTodos` API。新顶层 `todo` 命令。

### Changed

- **CLI 包版本**：`chainlesschain@0.123.0 → 0.124.0 → 0.125.0 → 0.127.0 → 0.128.0 → 0.129.0 → 0.130.0`（V2 第七批分多次推进 + 0.126.0 修复 bump；subagent/execbe/todo 三个表面为本批后续增量）
- **docs-site**：首页 hero tagline 同步到 v5.0.2.34 · CLI 0.130.0 · 109 命令
- **docs-site-design**：首页 badges 同步到 v5.0.2.34 · 95+ 模块 · 139 技能 · 7600+ 总测试
- **docs-website-v2**：`index.astro` evolution 条目增加 9 张 v5.0.2.34 卡片（ember 高亮），架构演进计数 49 → 58；CLI 数 76 → 109、测试数 5517+ → 7600+；`cli.astro` 标题与正文从 90 命令升至 109 命令

### Tests

本批相较 0.123.0 累计新增 **345 个 V2 单元测试**（35 + 44 + 37 + 42 + 33 + 32 + 37 + 46 + 39），零回归。所有 V2 表面均以 `-v2` 后缀分派，preAction bypass 自动识别。

- CLI 单元：新增 6 文件 / **+223 pass**
- CLI 集成：无新增，既有 40 文件 / 696 pass 绿
- CLI E2E：无新增，既有 38 文件 / 565 pass 绿

---

## [5.0.2.10 / CLI 0.130.0] - 2026-04-18 晚 (V2 第六批 · 13 个运行时管家)

### Added — 13 个 V2 规范表面（严格增量，全部基于内存 governance 层，与遗留 SQLite/ 文件态独立）

- **`cc automation` V2** — `AUTOMATION_MATURITY_V2` draft/active/paused/archived + `EXECUTION_LIFECYCLE_V2` queued/running/succeeded/failed/cancelled，per-owner active-automation cap = 20、per-flow pending-execution cap = 30，`autoPauseIdle*` + `autoCancelStuck*`。
- **`cc instinct` V2** — `PROFILE_MATURITY_V2` pending/active/dormant/archived + `OBSERVATION_LIFECYCLE_V2` captured/reviewed/reinforced/discarded/promoted，per-user 5、per-profile 100，`autoDormantIdleProfilesV2` + `autoDiscardStaleObservationsV2`。
- **`cc memory` V2** — `ENTRY_MATURITY_V2` draft/active/stale/archived + `CONSOLIDATION_LIFECYCLE_V2` pending/running/merged/rejected/superseded，per-owner 200、per-owner 20，`autoStaleEntries*` + `autoSupersedeStuck*`。
- **`cc note` V2** — `NOTE_MATURITY_V2` draft/active/stale/archived + `REVISION_LIFECYCLE_V2` pending/applied/rolled_back/conflicting/discarded，per-author 100、per-note 50，`autoStaleNotesV2` + `autoDiscardStaleRevisionsV2`。
- **`cc org` V2** — `ORG_MATURITY_V2` provisional/active/suspended/archived + `MEMBER_LIFECYCLE_V2` invited/active/suspended/removed/expired，per-owner 10、per-org 500，`autoSuspendIdleOrgsV2` + `autoExpireStaleMembersV2`。
- **`cc permmem` V2**（新命令组）— `PIN_MATURITY_V2` pending/active/dormant/archived + `RETENTION_JOB_LIFECYCLE_V2` queued/running/succeeded/failed/cancelled，per-owner 100、per-pin 10，`autoDormantIdlePinsV2` + `autoCancelStuckJobsV2`。
- **`cc rcache` V2**（新命令组）— `PROFILE_MATURITY_V2` pending/active/suspended/archived + `REFRESH_JOB_LIFECYCLE_V2` queued/running/completed/failed/cancelled，per-owner active-profile 25、per-profile pending-job 4，`autoSuspendIdleProfilesV2` + `autoFailStuckRefreshJobsV2`。与 legacy LRU `cc tokens cache` 并存不冲突。
- **`cc scim` V2** — `IDENTITY_LIFECYCLE_V2` pending/provisioned/suspended/deprovisioned + `SYNC_JOB_V2` queued/running/succeeded/failed/cancelled，per-tenant 5000、per-idp 50，`autoSuspendIdleIdentitiesV2` + `autoFailStuckSyncJobsV2`。
- **`cc session` V2** — `CONVERSATION_MATURITY_V2` active/idle/closed/archived + `TURN_LIFECYCLE_V2` queued/running/completed/failed/cancelled，per-user 20、per-session 100，`autoIdleConversationsV2` + `autoFailStuckTurnsV2`。
- **`cc social` V2** — `RELATIONSHIP_MATURITY_V2` pending/active/muted/blocked + `THREAD_LIFECYCLE_V2` draft/posted/archived/flagged/removed，per-user 1000、per-user 500，`autoMuteStaleRelationshipsV2` + `autoArchiveStaleThreadsV2`。
- **`cc sync` V2** — `RESOURCE_MATURITY_V2` pending/active/paused/archived + `SYNC_RUN_V2` queued/running/succeeded/failed/cancelled，per-owner 50、per-resource 20，`autoPauseIdleResourcesV2` + `autoFailStuckRunsV2`。
- **`cc tokens` V2** — `BUDGET_MATURITY_V2` pending/active/warning/exhausted + `USAGE_RECORD_LIFECYCLE_V2` pending/committed/refunded/rejected/disputed，per-owner 10、per-budget 10000，`autoExhaustBudgetsV2` + `autoCommitStaleRecordsV2`。
- **`cc wallet` V2** — `WALLET_MATURITY_V2` provisioned/active/frozen/retired + `TX_LIFECYCLE_V2` pending/submitted/confirmed/failed/cancelled，per-user 10、per-wallet 100，`autoFreezeIdleWalletsV2` + `autoCancelStuckTxsV2`。

### Changed

- **CLI 包版本**：`chainlesschain@0.106.0 → 0.130.0`（V2 第六批一次性推进 13 个管家 + 小版本收口）
- **README**：中/英双语在最新版本区前插入 V2 第六批条目，替换安装命令到 `chainlesschain@0.130.0`

### Tests

| 模块 | 单元测试（新/总） | 状态 |
| --- | --- | --- |
| `automation-engine.test.js` | +46 / 114 | 全通过 |
| `instinct-manager.test.js` | +48 / 73 | 全通过 |
| `memory-manager.test.js` | +47 / 101 | 全通过 |
| `note-versioning.test.js` | +49 / 71 | 全通过 |
| `org-manager.test.js` | +43 / 75 | 全通过 |
| `permanent-memory.test.js` | +46 / 71 | 全通过 |
| `response-cache.test.js` | +46 / 66 | 全通过 |
| `scim-manager.test.js` | +39 / 62 | 全通过 |
| `session-manager.test.js` | +33 / 77 | 全通过 |
| `social-manager.test.js` | +34 / 75 | 全通过 |
| `sync-manager.test.js` | +39 / 65 | 全通过 |
| `token-tracker.test.js` | +49 / 88 | 全通过 |
| `wallet-manager.test.js` | +41 / 70 | 全通过 |

本批相较 0.106.0 累计新增 **560 个 V2 单元测试**，零回归。

- CLI 单元：232 文件 / **9219/9229**（10 skipped）
- CLI 集成：40 文件 / **696/696**
- CLI E2E：38 文件 / **565/565**
- Desktop core+database / renderer stores / ai-engine sample 全部绿（15+16+3 files / 1587 pass）

---

## [5.0.2.10 / CLI 0.106.0] - 2026-04-18 (V2 第五批 · 协作治理 + UEBA + 威胁情报)

### Added — 3 个 V2 规范表面（严格增量）

- **`cc collab` V2** (CLI 0.105.0)：4-state Agent 成熟度 (`provisional/active/suspended/retired`，`suspended→active` 恢复) + 5-state 提案生命周期 (`draft/voting/approved/rejected/withdrawn`，3 终态)，per-realm active-agent cap = 10、per-proposer voting-proposal cap = 3，`autoRetireIdleAgentsCgV2` + `autoWithdrawStuckProposalsV2` 批量 auto-flip。
- **`cc compliance ueba` V2** (CLI 0.105.0)：4-state baseline 成熟度 (`draft/active/stale/archived`，`stale→active` 恢复) + 5-state investigation 生命周期 (`open/investigating/closed/dismissed/escalated`，3 终态)，per-owner active-baseline cap = 20、per-analyst open-investigation cap = 10（在 `openInvestigationV2` 创建时强制，因 open 即起始态），`autoMarkStaleBaselinesV2` + `autoEscalateStuckInvestigationsV2`。
- **`cc compliance threat-intel` V2** (CLI 0.106.0)：4-state Feed 成熟度 (`pending/trusted/deprecated/retired`，`deprecated→trusted` 恢复) + 5-state Indicator 生命周期 (`pending/active/expired/revoked/superseded`，3 终态)，per-owner active-feed cap、per-feed active-indicator cap、`autoDeprecateIdleFeedsV2` + `autoExpireStaleIndicatorsV2`。SQLite IoC 目录之上叠加纯内存 V2 层。

### Changed

- **CLI 包版本**：`chainlesschain@0.104.0 → 0.105.0 → 0.106.0`（V2 第五批分两次推进）
- **docs-site**：`cli-collab.md` / `cli-compliance.md` 追加 V2 规范表面段（共 4 个枚举 + 3 状态机 + 6 个 auto-flip + 18 配额配置）
- **docs-website-v2**：`index.astro` 升级到 48 条 evolution 条目（v5.0.2.10 新增 39 项，第五批 V2 列入）；CLI chip 从 `v0.104.0` 升至 `v0.106.0`
- **docs/cli/platform.md**：吸收 Collaboration Governance V2 / Compliance UEBA V2 段（项目根反向同步）

### Tests

| 模块 | 单元测试 | V2 新增 | 状态 |
| --- | --- | --- | --- |
| `collaboration-governance.test.js` | 98 | 37 | 全通过 |
| `ueba.test.js` | 59 | 29 | 全通过 |
| `threat-intel.test.js` | 69 | 41 | 全通过 |

本批相较 0.104.0 累计新增 **107 个 V2 单元测试**，零回归。

---

## [5.0.2.34] - 2026-04-17 (npm 0.66.0 · 7 个新命令组 + 8 个 V2 强化)

### Added — 7 个新 CLI 命令组

- **`cc agent-network`** — 去中心化 Agent 网络：Ed25519 DID + W3C VC + Kademlia k-bucket 模拟 + 4 维加权声誉任务路由 (Phase 24)
- **`cc automation` / `cc auto`** — 工作流自动化引擎：12 个 SaaS 连接器 (Gmail/Slack/GitHub/Jira/Notion/Trello/Discord/Teams/Airtable/Figma/Linear/Confluence) + 5 种触发器 + DAG 流 (Phase 96)
- **`cc didv2`** — W3C DID v2.0：did:key/web/chain + Ed25519 VC/VP + k-of-n 守护人社交恢复 + 身份漫游 (Phase 55)
- **`cc perf`** — 性能自动调优：OS 真采样 + 5 规则带滞回 + 冷却，CLI 只汇报不自动应用 (Phase 22)
- **`cc pipeline`** — 开发流水线编排：7 阶段 AI 开发流水线 (req→arch→code→test→review→deploy→monitor) + 4 模板 + 6 部署策略 (Phase 26)
- **`cc ecosystem` / `cc eco`** — 智能插件生态 2.0：注册 + DFS 依赖求解器 + 沙箱日志 + 发布状态机 + 70/30 收益分账 (Phase 64)
- **`cc sso`** — 企业身份认证：SAML/OAuth2/OIDC 配置 CRUD + PKCE S256 + AES-256-GCM Token 加密 + DID↔SSO 身份桥 (Phase 14)

### Added — 8 个现有命令 V2 强化（严格增量，向后兼容）

- **`cc social graph`** — 图分析：度/紧密度/中介中心性 + 影响力 + 社区发现 + BFS 最短路径 (Phase 42)
- **`cc dao`** — 4 阶段生命周期 + 二次投票 (cost=n²) + 防环委托 + 时锁 + 多数+法定人数门槛 (Phase 92)
- **`cc economy`** — 支付类型 + 双边状态通道 + NFT 铸造/列表/购买/销毁 + 任务贡献加权分账 (Phase 85)
- **`cc evolution`** — 6 维能力评估 + 4 级严重度诊断 + 4 种修复策略 + 成长里程碑自动记录 (Phase 100)
- **`cc hmemory`** — 4 层内存 + 3 类型 + 3 权限共享 + 巩固状态机 + 概念重叠语义搜索 (Phase 83)
- **`cc sandbox`** — 沙箱状态机 + 5 类权限 + 5 级风险评分 + 5 类配额 + 自动隔离 + 审计过滤 (Phase 87)
- **`cc workflow`** — 5 类标准模板 + 检查点快照 + 回滚到检查点 + 条件断点（正则安全） + JSON 导入/导出 (Phase 82)
- **`cc zkp`** — 3 种证明方案 (Groth16/PLONK/Bulletproofs) + 方案参数化证明形状 + 凭证注册表 + 选择性披露 (Phase 88)

### Changed

- **CLI 包版本**：`chainlesschain@0.51.0 → 0.66.0`（单次 npm publish，包含 2026-04-17 下午全部新增）
- **docs-site 新增 12 个命令参考页**：`cli-agent-network` / `cli-automation` / `cli-did-v2` / `cli-perf` / `cli-pipeline` / `cli-ecosystem` / `cli-sso` 等，VitePress 侧栏同步更新
- **docs/cli 子文件**：`blockchain-enterprise.md` / `core-phases.md` / `platform.md` 吸收新命令项

### Tests

| 层 | 文件数 | 用例数 | 耗时 |
| --- | --- | --- | --- |
| CLI 单元 | 232 | **7618/7618** | 129s |
| CLI 集成 | 40 | **696/696** | 46s |
| CLI E2E | 38 | **565/565** | 427s |

本批相较 0.51.0 新增 **536 个单元测试**（7082 → 7618），覆盖 15 个新 / 强化命令，全部通过；集成 / E2E 零回归。

### npm

| Tag | 版本 | 发布时间 |
| --- | --- | --- |
| v5.0.2.34 | 0.66.0 | 2026-04-17 晚 |

`npm i -g chainlesschain@0.66.0`（别名 `cc` / `clc` / `clchain`）

---

## [5.0.2.33] - 2026-04-17 (npm 发布批次 · CLI 0.51.0)

### Added

- **Phase 17 IPFS 去中心化存储 CLI**：`cc ipfs node-start/add/get/pin/gc/set-quota/attach-knowledge`，确定性 bafy CID + AES-256-GCM + 配额/GC + 知识库附件，64 tests
- **Phase 20 模型量化 CLI**：`cc quantize`，GGUF 14 级 + GPTQ 目录 + 作业生命周期 (pending→running→completed/failed/cancelled) + 进度追踪，48 tests
- **Phase 27 多模态协作 CLI**：`cc mm session/stream/track/snapshot`，CRDT 风格会话状态 + 5 模态/7 文档格式/6 输出格式参考目录，68 tests
- **Phase 28 自然语言编程 CLI**：`cc nlprog classify/extract/detect-stack/translate/refine/convention-add/conventions/stats`，启发式双语意图/实体/技术栈识别 + 翻译/惯例 CRUD，62 tests
- **Phase 63 统一应用运行时 CLI**：`cc runtime`，OS/容器/云环境能力检测 + 自适应资源分配策略 + 运行时统计，60 tests
- **5 个新 docs-site 页面**：`cli-ipfs.md` · `cli-quantize.md` · `cli-mm.md` · `cli-nlprog.md` · `cli-runtime.md`（由并行会话 commit `27267ed9f` 落地）
- **VitePress 侧栏**：新增 2 个命令分组，去除过期 NEW 标记

### Changed

- **CLAUDE.md 计数更新**：90 → 102 CLI commands，7200+ → 7400+ tests
- **CLI 包版本**：`chainlesschain@0.47.9 → 0.49.0 → 0.51.0`（v5.0.2.32 / v5.0.2.33 两次 npm 发布）
- **docs-website-v2**：`index.astro` 升级到 36 条 evolution 条目，`cli.astro` 新增 3 个命令类别

### npm

| Tag | 版本 | 包含 Phase |
| --- | --- | --- |
| v5.0.2.31 | 0.48.0 | 2026-04-17 文档重构基线（本地 tag） |
| v5.0.2.32 | 0.49.0 | + Phase 63 Universal Runtime |
| v5.0.2.33 | 0.51.0 | + Phase 17 IPFS + Phase 27 Multimodal |

发布渠道：`npm i -g chainlesschain@0.51.0`（别名 `cc` / `clc` / `clchain`）

### Tests

| 层 | 文件数 | 用例数 | 耗时 |
| --- | --- | --- | --- |
| CLI 单元 | 232 | **7082/7082** | 210s |
| CLI 集成 | 40 | **696/696** | 76s |
| CLI E2E | 38 | **565/565** | 459s |

本批新增 Phase 17/20/27/28/63 共 **302 个 CLI 单元测试**（64 + 48 + 68 + 62 + 60），全部通过。E2E 首次运行时 vitest-worker 出现一次 `Timeout calling "onTaskUpdate"` RPC 告警（已知长跑套件抖动），重跑全绿。

---

## [5.0.2.10-cli-wrap] - 2026-04-17

### Added

- **Phase 58 联邦硬化 CLI**：`cc federation register/breaker/failure/success/half-open/check/node-health/pool-* /stats`，熔断器三态 (closed/open/half_open) + 健康检查最差态聚合 + 连接池模拟
- **Phase 84 多模态感知 CLI**：`cc perception record/results/voice-start/voice-status/index-add/query/context/stats`，四模态 (screen/voice/document/video) + 语音会话状态机 + 跨模态索引搜索
- **Phase 80 数据库演进 CLI**：`cc dbevo register/up/down/status/history/query-log/query-stats/analyze/suggestions/apply/stats`，迁移 CRUD + 慢查询分析 + 索引建议追踪
- **Phase 25 AIOps CLI**：`cc ops detect/incidents/baselines/playbooks/postmortem/stats`，Z-Score/IQR 异常检测 + 事件四阶段生命周期 + playbook + 事后复盘
- **Phase 86 代码生成 Agent 2.0 CLI**：`cc codegen generate/show/list/review/review-show/reviews/scaffold/scaffolds/stats`，生成追踪 + 5 条启发式安全规则 + 脚手架记录
- **新增 docs-site 页面**：`cli-federation.md` (Phase 58 CLI 参考) · `cli-perception.md` (Phase 84 CLI 参考)，VitePress 侧栏新增"v5.0.2.10 联邦与多模态感知"分组

### Changed

- **`docs/CLI_COMMANDS_REFERENCE.md` 精简重构**：54.8k → 4.4k 精简索引；完整命令清单拆到 `docs/cli/` 6 个子文件 (core-phases / managed-agents / blockchain-enterprise / observability / platform / video)
- **命令注释全量中文化**：~371 条 `#` 注释由英文翻译为中文，技术术语 (DID/P2P/MCP/PQC/...) 保留原文
- **CLAUDE.md 计数更新**：65 → 90 CLI commands，5960+ → 7200+ tests

### Tests

| 层 | 文件数 | 用例数 | 耗时 |
| --- | --- | --- | --- |
| CLI 单元 | 219 | **6010/6010** | 114s |
| CLI 集成 | 40 | **696/696** | 36s |
| CLI E2E | 38 | **565/565** | 495s |

本轮新增 Phase 25/58/80/84/86 共 **239 个 CLI 单元测试**（48 + 59 + 47 + 47 + 38），全部通过。E2E 运行过程中 vitest-worker 抛出一次 `Timeout calling "onTaskUpdate"` RPC 超时告警（长跑套件已知问题），不影响任何断言结果。

### Fixed

- `docs-site/docs/chainlesschain/ai-video-generation.md` 最后一个参考链接由已删除的锚点修正为 `cli/video.md`

---

## [5.0.2.9-polish] - 2026-04-15

### Added

- **会话钩子第四事件 `AssistantResponse`**：在 `agentLoop()` 返回后 fire-and-forget 触发，钩子可读到 `{sessionId, response, messageCount, provider, model}`
- **`UserPromptSubmit` 钩子支持 rewrite / abort**：钩子 stdout 返回 `{"rewrittenPrompt": "..."}` 即可改写本轮 prompt；返回 `{"abort": true, "reason": "..."}` 直接跳过 LLM
- **Skill-Embedded MCP 上下文过滤**：`buildOptimizedPrompt({ activeMcpServers })` 只把白名单内的 MCP 服务器工具暴露给 LLM，避免 130+ 技能场景下的工具爆炸
- **`UnifiedToolRegistry.initialize({ deferSkills: true })`**：fast init 立即返回，技能解析延迟到第一次读 API 或 `setImmediate` 后台执行；生产 wiring 已切换
- **`MCPClientManager.disconnect(name)`**：单服务器断开别名，配合 Skill-Embedded MCP 的 mount/unmount 流程
- **Category Routing 扩展 `EMBEDDING` / `AUDIO`**：embedding 默认 `ollama` 优先（本地、免费）；audio 默认 `openai` 优先（whisper/tts 质量最高）

### Tests

- 新增 145 测试覆盖本轮（unit 131 + integration 11 + e2e 3），全绿
- 新增 `tests/integration/skill-mcp-context-filter.integration.test.js`、`tests/integration/unified-tool-registry-deferred.integration.test.js`、`__tests__/integration/session-hooks-lifecycle.test.js`、`__tests__/e2e/session-hooks-smoke.test.js`

### Performance

- 6 个核心包 `vitest.config.js` 统一加 `pool: "forks", maxForks: 2` 防御并行 OOM
- UnifiedToolRegistry 冷启动从 ~数百 ms 降到接近 0（138 技能解析延迟到首次读）

### Compatibility

- 全部改动**向后兼容**：未传新参数时行为与之前完全一致

## [5.0.2.10] - 2026-04-06

### Changed

- 文档站版本同步到 `v5.0.2.10`
- CLI Agent Runtime 重构文档已对齐到当前实现
- Web Panel 文档已补齐 runtime event、session record、后台任务、Worktree、压缩遥测相关说明
- 设计文档模块 78 已接入固定路由，不再生成 `78-unmapped.md`
- 根 README、设计文档索引、文档站首页已重新补回推荐阅读与当前架构主线
- 设计模块 69 / 73 / 75 / 77 / 78 已统一补成当前实现对应的长版文档

### Added

- `session-created`、`session-resumed`、`session-list-result` 的 `record` 字段文档
- `tasks-detail`、`tasks-history`、`task:notification` 的用户文档
- `worktree-diff`、`worktree-merge` 的用户文档
- `compression-stats` 的筛选参数文档
- `cli-ui` 增补项目模式、全局模式、会话流转、联调要点说明
- `agent-optimization` 增补五个核心优化模块与已完成增强集成说明
- `minimal-coding-agent-plan` 文档同步代码实际进度：Phase 0–6 全部落地、9 个测试文件 85/85 通过
- 新增 `coding-agent-bridge.test.js` 单元测试（12 用例），通过 `_deps` 注入覆盖桥接层并发场景
- 新增 `coding-agent-lifecycle.integration.test.js`（10 用例）覆盖 19 个 IPC channel、plan-mode、high-risk gating、worktree 全流程
- 新增 `coding-agent-bridge-real-cli.test.js`（2 用例）真实子进程启动 `chainlesschain serve` 端到端验证

### Fixed

- `coding-agent-bridge.js`：`request()` 在 `_send` 抛错时未清理 `pending`，导致内存泄漏；现 try/catch 中先 `pending.delete(id)` 再 throw
- `coding-agent-bridge.js`：WebSocket `close` 时未拒绝在途 pending 请求，调用方永久挂起；现 `_attachSocket()` 的 close 处理器调用 `_rejectAllPending(...)`
- 修复 `docs-site` 首页、Agent 架构页、UI / Serve 文档页的中文乱码
- 修复设计文档首页与运行时重构计划页的内容不同步问题
- 修复模块 78 在文档站同步时未映射到稳定路由的问题
- 修复模块 69 / 73 / 75 / 77 文本被压缩成提纲页的问题
- 同步修正首页、Agent 架构页、UI 页中过期的验证结果数字
- 文档站新增 `Minimal Coding Agent 实施计划`，与设计模块 78 一并入口化
- 设计文档站补齐模块 77 / 78 的稳定路由与侧边栏入口

### Tests

- CLI `ws-runtime-events`：`2/2`
- CLI `tools-registry`：`6/6`
- CLI `agent-core`：`66/66`
- CLI `ws-session-workflow`：`16/16`
- CLI 本轮定向合计：`90/90`
- Web Panel 定向单元：`27/27`
- Web Panel 构建：通过
- Docs Site 构建：通过

## [5.0.2.8] - 2026-03-31

### Added

- Web 管理面板扩展为 10 个模块、4 套主题
- 新增 Services、Logs、Notes、McpTools、Memory、Cron 页面
- 新增主题切换 store 与全局主题变量覆盖
- 新增多组纯函数解析器用于 Web Panel 输出解析

### Fixed

- 修复技能列表始终显示 0 的问题，`stdout` / `output` 字段兼容恢复
- 修复多个页面的中文字符损坏
- 修复浅色主题下组件样式未完整适配的问题
- 修复 DeepSeek 图标损坏

### Tests

- 新增 29 个 Web Panel 单元测试
- Web Panel 测试总量提升到 150+ 级别

## [5.0.2.7] - 2026-03-25

### Added

- Skill Creator v1.2.0
- 新增 `optimize-description`
- 新增 eval 样本自动生成、训练集 / 测试集划分
- 支持 LLM 驱动的技能描述迭代优化

### Tests

- 新增 76 个测试

## [5.0.2.6] - 2026-03-24

### Added

- Vue3 Web 管理面板 npm 打包接入发布流程
- `prepublishOnly` 自动构建 Web Panel
- `findWebPanelDist()` 支持多路径查找

### Fixed

- 修复 `$&`、`$'`、`$$` 等特殊字符注入导致的配置损坏
- 修复文档中部分字符被 U+FFFD 覆盖的问题

### Tests

- 新增 `$` 特殊字符相关回归测试

## [5.0.2.3] - 2026-03-20

### Fixed

- 修复 Web UI 与 WS 服务器之间 5 处协议不匹配：
  - 消息缺少 `id`
  - `auth-ok` / `auth-result` 不一致
  - `msg.session.id` / `msg.sessionId` 不一致
  - `session-list` / `session-list-result` 不一致
  - `stream-data` / `response-token` 语义不一致

### Added

- 新增 21 个协议单元回归测试
- 新增 6 个协议集成测试
- 设计文档模块 73 补充 v1 -> v2 协议对照说明

## [5.0.2.2] - 2026-03-18

### Added

- 新增 `chainlesschain ui`
- 支持项目模式与全局模式
- 支持会话列表、Markdown 流式渲染、自动重连
- 支持 HTTP + WebSocket 一体化启动
- 支持浏览器自动打开、token 注入和基础安全响应头

### Fixed

- 修复 UI 关闭流程与 `server.listen` 错误处理问题
- 修复带 query 参数时的 URL 路由匹配问题

## [5.0.2.1] - 2026-03-17

### Added

- 新增 `doc-edit` 技能
- 支持 md/txt/html/docx/xlsx/pptx 文档编辑
- 支持 `edit` / `append` / `rewrite-section`
- 输出总是写入 `_edited` 新文件

### Added Docs

- 新增 ai-doc-creator 与 ai-media-creator 用户文档
- 文档站开始按用户文档与设计文档分层导航

## [5.0.2.0] - 2026-03-17

### Added

- 新增 AI 文档创作模板 `ai-doc-creator`
- 新增 AI 音视频创作模板 `ai-media-creator`
- 新增 `doc-generate`、`libre-convert`、ComfyUI / TTS 技能
- 文档站升级到 `v5.0.2.0`

## [5.0.1.9] - 2026-03-17

### Added

- 新增 CLI 指令技能包系统
- 将 60+ CLI 指令自动封装为 9 组技能包
- 引入 `sync-cli`
- 支持 direct / agent / hybrid / llm-query 四种执行模式

## [5.0.1.8] - 2026-03-16

### Added

- 子代理隔离系统 v2
- `SubAgentContext`
- `SubAgentRegistry`
- 命名空间记忆与作用域上下文
- Agent 智能增强 v2

## [5.0.1.7] - 2026-03-15

### Added

- 子代理隔离系统初版
- `spawn_sub_agent`
- 三级摘要策略
- 作用域上下文引擎

## [5.0.1.6] - 2026-03-15

### Added

- Agent 智能增强
- `run_code` 工具的 auto pip-install
- 脚本持久化
- 错误分类
- 环境检测
- `agent-core` 从 REPL 中提取

## [5.0.1.5] - 2026-03-15

### Added

- SlotFiller 集成到 Agent 主循环
- `serve` 自动接入 `WSSessionManager`
- `session:create` / `session:close` 事件日志

### Fixed

- 修复 `session-resume` 后无法继续发送消息的问题

## [5.0.1.4] - 2026-03-15

### Added

- WebSocket 有状态会话
- `session-create`
- `session-resume`
- `session-message`
- `session-list`
- `session-close`
- `slash-command`
- `session-answer`

### Notes

- 这是后续 Runtime / Gateway / Event 统一演进的重要基础版本
