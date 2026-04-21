# Changelog

All notable changes to ChainlessChain will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [v5.0.2.43] - 2026-04-21 — 发布前测试回归闭环 + 533 自动文档刷新 + CLI 0.156.2

### Added

- **发布前测试回归闭环** — 92 单元测试 + 5 集成测试 + `vue-tsc --noEmit` + `vite build` 五关全绿，E2E 跟随既有 `describe.skip` 约定；本轮回归未触发任何代码修复。结果表已写入 [`docs-site/docs/guide/desktop-v6-shell.md` §18.7](docs-site/docs/guide/desktop-v6-shell.md) 与 [`docs/design/桌面版UI重构_设计文档.md` v0.5](docs/design/桌面版UI重构_设计文档.md)。
- **533 份自动文档刷新** — `desktop-app-vue/docs/api/generated/*.md` prettier list/heading 规范刷新，`ARCHITECTURE_OVERVIEW.md` + `COMPONENT_REFERENCE.md` 格式同步。
- **CLI 0.156.1 → 0.156.2** — patch 补丁用于 v5.0.2.43 npm release（无源码改动）。

### Changed

- `deploy-docs.py` + `deploy-www.py` 重定向到 `v5.0.2.34-20260420-1831` tar 产物（稍后再滚到 `20260421-*`）。

---

## [v5.0.2.42] - 2026-04-20 — V6 Shell 回归闭环 + 用户文档

### Added

- **V6 Shell + `/v6-preview` 用户文档** — `desktop-v6-shell.md` 新增 §18 "P7–P9b 预览壳" 全套（18.1–18.7）+ v0.4 / v0.5 版本行；`desktop-ui-refactor-user-guide.md` 新建 355 行用户指南；`introduction.md` / `architecture.md` / `tech-stack.md` / `getting-started.md` / `compliance-threat-intel.md` / `social-protocols.md` 六份指南追加 17 章规范附录（概述 / 核心特性 / 系统架构 / 系统定位 / 核心功能 / ... / 相关文档）。
- **设计文档落地** — `docs/design/桌面版UI重构_设计文档.md` 458 行新文档（文档信息 + 修订历史 + 现状分析 + 总体设计 + 详细设计 + 企业定制方案 + 安全设计 + 与其他端的关系 + 迁移方案 + 风险与对策 + 待决事项 + 附录 A 目录约定 + 附录 B 相关文档）。
- **CLI 0.156.0 → 0.156.1** — 文档版本号对齐补丁。

### Changed

- `docs-site-design/scripts/sync-docs.js` + `docs-site/scripts/sync-design-docs.js` 加入新中文 → ASCII 映射：`桌面版UI重构_设计文档.md` / `96_V2规范层governance.md` / `97_桌面版UI_ClaudeDesktop重构计划.md`。
- VitePress 两站 sidebar 加入新条目（`desktop-ui-refactor` / `m97-claude-desktop-refactor` / `96-v2-governance`）。
- `docs-website-v2` footer + `desktop.astro` + `index.astro` evolution hero chip 全部 v5.0.2.10 → v5.0.2.34。

---

## [v5.0.2.34] - 2026-04-20 — 桌面版 V6 Chat-First Shell (P0–P6 完成) + P7 预览外观

### Added (P7 · Claude-Desktop 风格外观预览)

- **`/v6-preview` 路由** — 与 `/v2` 并存的新壳，不替换任何现网入口。沿用 P6 `slash-dispatch` 分发器。
- **4 主题体系** — `src/renderer/shell-preview/themes.css` 提供 dark / light / blue / green 四套 `--cc-preview-*` CSS 变量；`src/renderer/stores/theme-preview.ts` 是 Pinia store，`[data-theme-preview]` 属性切换，localStorage 持久化。
- **4 颗去中心化入口** — 左栏底部固化 `TeamOutlined` P2P / `SwapOutlined` Trade / `GlobalOutlined` Social / `SafetyCertificateOutlined` U-Key；分别绑定 `builtin:openP2P` / `openTrade` / `openSocial` / `openUKey` handler（当前为占位 toast，P8 对接业务页）。
- **三区骨架** — 左栏 `ConversationList` 会话历史 + `DecentralEntries` 四入口 + 主题切换；中区留白气泡 + 极简 composer（Ctrl/Cmd+Enter 发送）；右侧 `ArtifactDrawer` 抽屉从右滑入。
- 设计文档：[`docs/design/modules/97_桌面版UI_ClaudeDesktop重构计划.md`](docs/design/modules/97_桌面版UI_ClaudeDesktop重构计划.md)

### Tests (P7)

- `src/renderer/stores/__tests__/theme-preview.test.ts` — 11 例，覆盖初始值 / apply / restore / clear / 无效值保护 / 多 pinia 实例共享 localStorage
- `src/renderer/shell/__tests__/slash-dispatch.test.ts` — 8 例，覆盖注册 / 派发 / 未注册 / 覆盖语义 / 解绑匹配 / 错误捕获 / listRegisteredHandlers / 4 入口共存
- 合计新增 19 例全部通过

### Added (P8 · 4 颗入口接入 drawer preview widget)

- **4 个 preview widget** — `src/renderer/shell-preview/widgets/{P2p,Trade,Social,UKey}PreviewWidget.vue`，每颗 widget 统一 "概览 hero + kv 指标卡 + 2–3 按钮 router.push 进 `/main/*` 完整页" 骨架。
- **widget 注册表** — `shell-preview/widgets/index.ts` 把 4 个 entry id（`p2p` / `trade` / `social` / `ukey`）映射到 component + title。
- **`AppShellPreview.vue` 替换 `message.info()` 占位** — 现在 4 个 `builtin:open*` handler 直接打开 `ArtifactDrawer` 并挂载对应 widget；drawer 的 `toggleArtifact` / `closeDrawer` 同步清理 `activeEntryId` 状态。
- **跳转目标**：P2P 用 `P2PMessaging` + `/main/p2p/device-pairing`；Trade 用 `TradingHub` / `Marketplace` / `Contracts`；Social 用 `Chat` / `/main/social-collab` / `SocialInsights`；U-Key 用 `ThresholdSecurity` / `DatabaseSecurity` / `/main/hsm-adapter`（均已在 `router/index.ts` 存在）。

### Tests (P8)

- `src/renderer/shell-preview/widgets/__tests__/widget-registry.test.ts` — 5 例：4 canonical ids / 字段完整 / 已知 id 查询 / 未知 id undefined（大小写敏感）/ 标题唯一
- 合计 P7+P8 新增 **24 例** 单测全部通过（3.64s）

### Added (P9a · 会话持久化)

- **`useConversationPreviewStore`** — `src/renderer/stores/conversation-preview.ts` Pinia store，把预览壳的会话列表 + 消息 + 活跃 id 持久化到 `localStorage`（key `cc.preview.conversations`，`version: 1` schema）。
- **Schema 安全**：非法 version / 损坏 JSON / 非数组 conversations / `activeId` 指向不存在会话 — 均触发 "重新 seed 欢迎会话"；`restore()` 不抛错
- **actions**：`restore` / `select` / `createBlank` / `appendMessage` / `remove` / `clearAll` — 每次写操作立即 `_persist()` 到 localStorage
- **`AppShellPreview.vue` 重构**：所有会话 / 消息读写改走 store，`ref<Conversation[]>` + 内联种子完全删除，`onMounted` 额外调用 `conversationStore.restore()`

### Tests (P9a)

- `src/renderer/stores/__tests__/conversation-preview.test.ts` — 13 例：seed / hydrate / schema 版本拒绝 / 损坏 JSON 容错 / `createBlank` 活跃切换 / `appendMessage` 更新 preview+title+updatedAt+持久化 / 空串忽略 / `select` 未知 id 拒绝 / `remove` 当前活跃自动切换 / `remove` 非活跃保持 / `clearAll` 清空 / schema version 校验 / 空 store 自动 `createBlank`
- 合计 P7+P8+P9a 新增 **37 例** 单测全绿（~22s，4 个测试文件）

### Added (P9b · composer → 真 LLM)

- **`llm-preview-bridge.ts`** — `src/renderer/shell-preview/services/llm-preview-bridge.ts` 薄桥：`isAvailable()` 查 `window.electronAPI.llm.checkStatus()`；`sendChat(messages)` 调 `window.electronAPI.llm.chat({ messages, enableRAG:false, enableCache:false, enableCompression:false, enableSessionTracking:false, enableManusOptimization:false, enableMultiAgent:false, enableErrorPrecheck:false })`，从 `{ content }` / `{ message: { content } }` / `{ reply }` 三种返回形状中提取文本；`toBridgeMessages(history, nextUser?)` 把 `BubbleMessage[]` 转 `{role,content}[]`；所有失败（electronAPI 未就绪 / checkStatus 拒绝 / chat 抛错 / 返回空）都走 `BridgeResult = { ok: false, reason }` 兜底，不抛。
- **`AppShellPreview.sendDraft()` 重写**：追加用户气泡 → 翻 `isGenerating=true` → 调 bridge → 成功追加 assistant 气泡 / 失败追加 `LLM 调用失败：${reason}` / 不可用追加 `LLM 服务不可用，请检查火山引擎/Ollama 配置` → `finally` 翻 `isGenerating=false`。
- **typing 指示器 + 发送态**：气泡列表在 `isGenerating` 时追加一只三点动画气泡（`data-testid="cc-preview-typing"`）；发送按钮进入 `loading` 并禁用，直到回合结束。
- **`conversation-preview` store 扩展**：新增 `isGenerating: boolean` state、`appendAssistantMessage(content)` / `setGenerating(flag)` actions；`appendMessage` 修正为仅 `role==="user"` 时才在 `新会话` 标题上自动覆盖（之前 assistant 消息也会改标题）。

### Tests (P9b)

- `src/renderer/shell-preview/services/__tests__/llm-preview-bridge.test.ts` — 19 例：`isAvailable` 5 例（无 api / `{available:true}` / 布尔 / `{available:false}` / reject）+ `sendChat` 6 例（`{content}` / `{message.content}` / 空返回 / 抛错 / 无 api / 消息透传 + 关闭高级开关）+ `toBridgeMessages` 3 例（历史 + next / 空 next 跳过 / trim）+ `extractReply` 5 例。
- `conversation-preview.test.ts` 新增 2 例：`appendAssistantMessage` 不改标题 / `setGenerating` 翻转。
- 合计 P7+P8+P9a+P9b 新增 **58 例** 单测全绿（~15s，5 个测试文件）

### Added (P9c · 流式输出)

- **Bridge 扩展**：`llm-preview-bridge.ts` 新增 `streamAvailable()` / `sendChatStream(prompt, onChunk)` — 调 `window.electronAPI.llm.queryStream(prompt)` 并监听 `llm:stream-chunk` 事件。Payload 优先读 `fullText`，退回累加 `chunk`；调用方通过 `onChunk(liveText)` 收到每次累积文本。`queryStream` 返回为空时以累积文本兜底。`finally` 里 `off(STREAM_CHUNK_EVENT, listener)` 清理监听（preload 现有 off 无法真正 removeListener，是已知既有 quirk，影响范围限单监听器）。
- **局限**：`llm:query-stream` 只接收单串 prompt（无 messages 数组），预览壳流式发送时**仅把最新用户输入作为 prompt**，不含会话历史；历史感知的流式需要新建 main-process handler，超出 preview 范围，留给后续。
- **Store 新 actions**：`beginStreamingAssistant()` 种一只空 assistant 气泡并返回其 id；`updateAssistantContent(id, content)` 增量更新（不持久化，只在 finalize 时落盘）；`finalizeStreamingAssistant(id, content)` 写最终值 + `_persist()`；`removeMessage(id)` 删除指定消息（流式失败时把空气泡撤回，再走非流式 fallback）。
- **`AppShellPreview.sendDraft()` 双路径**：先查 `streamAvailable()` → 开 streaming bubble → 每个 chunk `updateAssistantContent` → 成功 `finalize` 返回；失败 `removeMessage` 后回落到非流式 `sendChat`；非流式再失败走友好提示（P9b 原路径）。
- **typing 指示器收敛**：新增 `showTypingIndicator` computed — 仅在"生成中但最后一条不是已开始填充的 assistant 气泡"时显示，避免流式状态下出现"打字指示器 + 实时内容气泡"双显。

### Tests (P9c)

- `llm-preview-bridge.test.ts` 新增 12 例：`streamAvailable` 4 例（无 api / `queryStream` 缺失 / 都齐 / 只有 queryStream 缺 on）+ `sendChatStream` 8 例（electronAPI 缺 / queryStream 缺 / 空 prompt / chunk 累加 + on/off 注册 / fullText 优先 / null 返回用累加兜底 / 空返回空累加报 `空` / 抛错仍清理 listener）。
- `conversation-preview.test.ts` 新增 5 例：`beginStreamingAssistant` 种 id / `updateAssistantContent` 更新 + preview / 未知 id + 非 assistant role 不动 / `finalizeStreamingAssistant` 落盘 / `removeMessage` 按 id 剔除。
- 合计 P7+P8+P9a+P9b+P9c 新增 **75 例** 单测全绿（~14s，5 个测试文件）

### Added

- **桌面版 V6 对话壳 P0–P6 全量落地** — Electron 桌面端 `/v2` 路由提供"对话优先 + 插件化平台"新壳，完整取代旧 dashboard。设计文档见 [`docs/design/桌面版UI重构_设计文档.md`](docs/design/桌面版UI重构_设计文档.md)，用户指南见 [`docs-site/docs/guide/desktop-v6-shell.md`](docs-site/docs/guide/desktop-v6-shell.md)。
  - **三区布局** — 左侧 `ShellSidebar`（空间切换）+ 中间 `ConversationStream` + `ShellComposer`（对话 + `/` 命令 + `@` 引用）+ 右侧 `ArtifactPanel` + 底部 `ShellStatusBar`。
  - **扩展点 7 类** — Spaces / Artifacts / Slash / Mention / StatusBar / Home Cards / Composer Slots，通过 `plugin.json` 的 `contributes.ui.*` 声明，经 `ExtensionPointRegistry` 按 priority 降序选出胜出者。
  - **企业能力 5 类** — LLM / Auth / Storage / Crypto / Audit Providers，通过 `contributes.provider.*` 声明，通过同一优先级机制让企业 Profile 覆盖默认。
  - **P6 分发器 + Widget 注册表**（本版本核心）— `src/renderer/shell/slash-dispatch.ts` + `widget-registry.ts` 把 plugin 声明的 `handler` / `component` 字符串真正接上运行时行为；内置 `builtin:openAdminConsole` + `builtin:AdminShortcut`。
  - **AdminConsole** — `Ctrl+Shift+A` / `/admin` / 状态栏齿轮按钮三路径打开；4 标签页（概览 / UI 扩展点 / 企业能力 / 调试），仅 `admin` 权限账户可见。
  - **企业定制三路径** — 私有 Registry（`trustedPublicKeys` 验签）、`.ccprofile`（ed25519 签名 + 每插件 sha256，一键换肤换能力）、MDM 推送（启动时校验解包到覆盖目录，高 priority 胜出）。
  - **13 个内置 first-party 插件** — `chat-core` / `notes` / `spaces-personal` / `cowork-runner` / `brand-default` / `ai-ollama-default` / `auth-local` / `data-sqlite-default` / `crypto-ukey-default` / `compliance-default` / `admin-console` / `chain-gateway` / `did-core`，跳过 DB / 沙箱 / 权限流程直接从 `src/main/plugins-builtin/` 载入。

### Tests

- 单元：`tests/unit/renderer/shell/slash-dispatch.test.ts`（7）+ `widget-registry.test.ts`（5）+ `AdminShortcut.test.ts`（2）
- 集成：`tests/integration/plugin-extension-points.integration.test.js`（5）— 验证 `.ccprofile` + MDM 覆盖链路，合成 `acme-corporate@100` 胜过 `chainlesschain-default@10`
- 深度集成：`tests/unit/renderer/shell/AppShell.interaction.test.ts`（3）— 全 jsdom 挂载 `AppShell` 验证三路径都能打开 AdminConsole
- E2E：`tests/e2e/v6-shell/admin-console.e2e.test.ts`（3 × `describe.skip`，待登录 helper 支持 admin 权限后启用）
- 合计：22 例单元 + 集成全部通过（13.6s）；渲染器 `npm run build` 4m 52s 绿灯

### Docs

- 新增 `docs-site/docs/guide/desktop-v6-shell.md` 用户指南（VitePress 侧栏已注入）
- 同步 `docs-site/docs/design/desktop-ui-refactor.md`（设计侧栏已注入）
- 设计文档升级到 v0.3（P0–P6 实现完成，附实现文件映射表 + 验证章节）

## [v5.0.2.10] - 2026-04-16 — Managed Agents A–J + Deep Agents Deploy + CutClaw B

### Added

- **Managed Agents Phase A–J** — Full parity with Anthropic Managed Agents architecture via `@chainlesschain/session-core` (0.3.0).
  - Phase A: `SessionHandle`, `TraceStore`, `AgentDefinition` + cache (79 tests)
  - Phase B: `SessionManager` — idle detection + park/unpark persistence (25 tests)
  - Phase C: `IdleParker` — configurable idle threshold + interval polling (14 tests)
  - Phase D: `MemoryStore` — scoped memory (global/session/agent/user) + `MemoryConsolidator` (55 tests)
  - Phase E: `ApprovalGate` (strict/trusted/autopilot) + `BetaFlags` with date-based expiry (46 tests)
  - Phase F: `StreamRouter` — unified `StreamEvent` protocol for all streaming paths (19 tests)
  - Phase G: `AgentGroup` + `SharedTaskList` with rev-based concurrency control (52 tests)
  - Phase H: Desktop IPC consumption — 24 IPC channels, singletons + preload namespace (33 tests)
  - Phase I: Session tail/usage + 14 WS routes + `stream.run` + `sessions.subscribe` + 3-provider token accounting (30 tests)
  - Phase J: Desktop `closeSession` → auto-consolidate + `_executeHostedTool` → ApprovalGate routing (36 tests)

- **Deep Agents Deploy Phase 1–5** — Agent bundle system for portable agent packaging.
  - Phase 1: `agent-bundle-schema` + `agent-bundle-loader` + `agent-bundle-resolver` (40 tests)
  - Phase 2: USER.md memory seeding via `applyUserMemorySeed` + `parseUserMdSeed`
  - Phase 3: `mcp-policy` — hosted/lan/local MCP transport gating (19 tests)
  - Phase 4: `sandbox-policy` — scope-based sandbox lifecycle (26 tests)
  - Phase 5: `service-envelope` + `envelope-sse` — unified wire format for WS/HTTP/SSE (30 tests)
  - CLI: `cc agent --bundle <path>` + `cc serve --bundle <path>` integration (15 tests)
  - Desktop: `bundle:load/info/unload` IPC channels + Pinia store integration

- **CutClaw Path B verification** — Architecture alignment items all verified.
  - B-1: `DebateReview.resolveConflictingVerdicts()` consumes `detectConflictPairs` + `pickWinnersAndLosers` from `sub-runtime-pool.js` (34 debate-review tests)
  - B-2: 4 built-in `QualityGate` checker factories — `createProtagonistChecker`, `createDurationChecker`, `createThresholdChecker`, `createLintPassChecker` (39 quality-gate tests)
  - B-3: 3 media categories (ASR/AUDIO_ANALYSIS/VIDEO_VLM) in `LLM_CATEGORIES` (25 tests)

- **session-core v0.3.0** — 22 library modules, 21 test files, 452 tests total

### Tests

- session-core: 452 tests across 21 test files
- Desktop session-core IPC: 33 tests
- Desktop session-service Phase J: 36 tests
- Desktop debate-review conflict resolution: 34 tests
- CLI agent-bundle integration: 15 tests
- CLI envelope-http-server: 11 tests

## [Unreleased] - 2026-04-09 — CLI Runtime 收口闭环 (Phase 7 Parity Harness)

### Added

- **Phase 7 Parity Harness 全量落地** — CLI Runtime 收口路线图 (`docs/design/modules/82_CLI_Runtime收口路线图.md`) Phase 0–7 全部完成，统一 Coding Agent envelope 协议 v1.0 在 CLI / Desktop / Web UI 三端达成字节级对齐。
  - 8 步 parity 测试矩阵全部通过（91 tests）：envelope 契约、sequence tracker、legacy→unified 双向映射、WS server envelope 透传、JSONL session store、SubAgentContext worktree 隔离、mock LLM provider、desktop bridge envelope parity。
  - 新增 `packages/cli/__tests__/integration/parity-envelope-bridge.test.js`(58 tests)覆盖 `createCodingAgentEvent` / `CodingAgentSequenceTracker` / `wrapLegacyMessage` / `unwrapEnvelope` / 数据驱动 roundtrip / `validateCodingAgentEvent` / `mapLegacyType` 全路径。
  - `src/lib/agent-core.js` / `src/lib/ws-server.js` / `src/lib/ws-agent-handler.js` 降级为 @deprecated shim（26/16/12 行），canonical 实现收归 `src/runtime/` 与 `src/gateways/ws/`。

### Status

- 收口完成定义 5 项准则全部达成 ✅（见 82 路线图 §8）：单一入口、envelope 协议统一、parity harness 全绿、shim 明确标注迁移窗口、文档同步。

### Docs

- 同步更新 `docs-site/docs/chainlesschain/cli-runtime-convergence-roadmap.md` 与 `docs-site/docs/design/modules/82-cli-runtime-convergence.md` 镜像至 canonical。

## [v0.45.55–v0.45.61] - 2026-04-08 — 技术债收官 (M2 + IPC Registry)

### Performance

- **M2 启动期同步 IO 异步化收官** — 把启动关键路径上的同步 IO 全部转为 `fs.promises`，避免阻塞 Electron 主进程事件循环。共改造 11 个模块（unified-config-manager / ai-engine-config / tool-skill-mapper-config / mcp-config-loader / database-config / logger / git-auto-commit / project-config + 3 个 ai-engine-manager 变体）。所有改造均使用 `_deps` 注入模式以保持单元测试可 mock；同步 API 作为运行时快路径保留。
  - v0.45.58: `project-config.js` 新增 `initializeAsync` / `loadConfigAsync` / `saveConfigAsync` + `getProjectConfigAsync()` 工厂；`ai-engine-manager.js` / `ai-engine-manager-p1.js` / `ai-engine-manager-optimized.js` 三个变体的 `initialize()` 改用 `await getProjectConfigAsync()`。

### Refactored

- **IPC Registry 收官** (v0.45.59~60)
  - **v0.45.59** — `ipc-registry.js` 的 Phase 5 / Phase 9-15 deps 构造曾用 `{ mcpClientManager, mcpToolAdapter }` 简写但顶部从未声明这两个标识符。由于 `...dependencies` 已经覆盖了它们，简写引用纯属冗余 + 真实潜在 ReferenceError。删除两处冗余引用。
  - **v0.45.60** — 主文件顶部 30+ 行的 destructure（绝大多数项只解构出来又通过 `...dependencies` 转发）压缩到只剩 5 个本文件直接引用的 manager (`app` / `database` / `mainWindow` / `llmManager` / `aiEngineManager`)，其余通过 `...dependencies` 透传。文件 495 → 446 行。

### Fixed

- **v0.45.61** — `project-export-ipc.js` 的 `project:import-file` 处理器有 v0.45.13 引入的 copy-paste 死代码块，引用了 `projectPath` 和 `normalizedProjectPath` 两个未在该作用域定义的变量；进入该 handler 即抛 `ReferenceError`。彻底删除死块，改用 `getActiveDatabase()` 路径（与 export-file handler 一致）。同步补全 `project-export-ipc.test.js` 中 mockDatabase 的 `getProjectById` / `getProjectFiles` / `db.get` / `db.run` 接口，原本静默失败的 3 个文件操作测试还原为真实断言。
- **v0.45.57** — `git-auto-commit.js` 的 `isGitRepository()` 改用 `fs.promises.stat` + ENOENT/ENOTDIR 容错，消除最后一处启动可达的 `existsSync` 调用。

### Tests

本轮全面回归通过：
- `src/main/ipc/__tests__/`: 89/89 ✅
- `src/main/git/__tests__/` + `tests/unit/git/`: 192/192 ✅
- `tests/unit/project/`: 212/212 ✅（修复了 3 个 pre-existing 失败）
- `tests/unit/ai-engine/`: 1987/1987 ✅
- `packages/cli/__tests__/unit/`: 3053/3053 ✅

### Tasks

- ✅ #2 H2 IPC Registry 拆分（completed）
- ✅ #7 M2 启动期同步 IO 异步化（completed）

12 项 tech-debt 列表全部清零。

## [3.4.0] - 2026-02-28

### Added

**v3.1.0 — Decentralized AI Market (Phase 65-67):**

- Phase 65: Skill-as-a-Service — SkillServiceProtocol, SkillInvoker, 5 IPC handlers
- Phase 66: Token Incentive — TokenLedger, ContributionTracker, 5 IPC handlers
- Phase 67: Inference Network — InferenceNodeRegistry, InferenceScheduler, 6 IPC handlers

**v3.2.0 — Hardware Security Ecosystem (Phase 68-71):**

- Phase 68: Trinity Trust Root — TrustRootManager, attestation chain, 5 IPC handlers
- Phase 69: PQC Full Migration — PQCEcosystemManager, ML-KEM/ML-DSA replacement, 4 IPC handlers
- Phase 70: Satellite Communication — SatelliteComm, DisasterRecovery, 5 IPC handlers
- Phase 71: Open Hardware Standard — HsmAdapterManager, FIPS 140-3, 4 IPC handlers

**v3.3.0 — Global Decentralized Social (Phase 72-75):**

- Phase 72: Protocol Fusion Bridge — ProtocolFusionBridge, cross-protocol conversion, 5 IPC handlers
- Phase 73: AI Social Enhancement — RealtimeTranslator, ContentQualityAssessor, 5 IPC handlers
- Phase 74: Decentralized Storage — FilecoinStorage, ContentDistributor, 5 IPC handlers
- Phase 75: Anti-Censorship — AntiCensorshipManager, MeshNetworkManager, 5 IPC handlers

**v3.4.0 — EvoMap Global Evolution (Phase 76-77):**

- Phase 76: Global Evolution Network — EvoMapFederation, multi-Hub sync, 5 IPC handlers
- Phase 77: IP & Governance DAO — GeneIPManager, EvoMapDAO, 5 IPC handlers

**Infrastructure:**

- 64 new IPC handlers across 13 phases
- 23 new database tables
- 13 new Pinia stores, Vue pages, and routes
- 4 new Context Engineering setters (steps 4.9-4.12)
- 13 new config sections
- Comprehensive unit tests (279 tests passing) and E2E tests

## [0.21.0] - 2026-01-19

### Added

**Desktop Application (v0.20.0 → v0.21.0):**

- GitHub Release automation system with comprehensive workflows
- Multi-platform build improvements and optimizations
- Virtual project creation for AI chat E2E tests
- Test infrastructure improvements with ESLint fixes
- Playwright E2E testing support at root level

**Android Application (v0.1.0 → v0.4.0 → Phase 5):**

- **Phase 3**: Knowledge base feature module with CRUD, FTS5 search, and Paging 3
- **Phase 4**: AI chat integration with LLM adapters (OpenAI, DeepSeek, Ollama), SSE streaming, RAG retrieval
- **Phase 5**: P2P networking (WebRTC, NSD discovery, DataChannel transport) and DID identity system (did:key, Ed25519)

**Mobile Application:**

- Performance testing tools and Lighthouse integration
- Final performance metrics report

### Fixed

- CI workflow: Added Playwright dependency to root package.json
- CI workflow: Corrected package-lock.json path in release workflow
- Test failures: Converted CommonJS to ESM imports in test files
- Test failures: Updated IPC handler counts for LLM and Knowledge Graph
- Test failures: Fixed syntax errors and module path issues
- MCP: Removed unused variables and imports
- MCP: Added missing latency metrics to performance monitor
- PDF engine: Fixed test failures with dependency injection
- Tool manager: Fixed test mocks and upsert logic
- Word engine: Fixed HTML parsing
- Windows: Fixed unit test failures
- MCP: Improved server environment variables and default configs
- Desktop: Ensured main window shows after splash screen

### Changed

- Improved P2P voice/video tests with real manager integration
- Enhanced MCP tool testing UI and permission handling
- Added public validation methods to MCPSecurityPolicy
- Refactored test infrastructure with global mocks
- Organized root directory files
- Reorganized src/main into categorized subdirectories

### Performance

- Lazy loading for blockchain, plugins, and media modules
- Optimized startup time with deferred module loading
- Reduced memory footprint with lazy highlight.js loading

### Security

- Enhanced MCP security with improved config validation
- Better error handling for incomplete server configurations

## [0.20.0] - 2026-01-15

### Added

- MCP (Model Context Protocol) integration POC v0.1.0
  - Filesystem, PostgreSQL, SQLite, Git server support
  - Defense-in-depth security architecture
  - Tool testing UI
- LLM Performance Dashboard with ECharts visualization
- SessionManager v0.22.0 with auto-compression (30-40% token savings)
- ErrorMonitor AI diagnostics with local Ollama LLM
- Manus optimizations (Context Engineering, Tool Masking, Task Tracking)

### Changed

- Updated all design documentation to v0.20.0
- Refactored main process modules into categorized subdirectories
- Enhanced login debug logging

### Fixed

- Git status modal now receives correct project ID
- Added WebRTC compatibility layer for P2P
- Improved monitoring and test stability

## [0.19.0] - 2026-01-10

### Added

- P2P encrypted messaging with Signal Protocol
- Knowledge graph visualization
- Advanced RAG retrieval system
- Multi-agent task execution framework

### Fixed

- Database encryption with SQLCipher
- U-Key hardware integration improvements

## [0.18.0] - 2026-01-05

### Added

- Desktop app Vue 3 migration complete
- Ant Design Vue 4.1 UI components
- Electron 39.2.6 upgrade

### Changed

- Migrated from Vue 2 to Vue 3 with Composition API
- Updated build toolchain to Vite

## [0.16.0] - 2025-12-20

### Added

- Knowledge base management (95% complete)
- RAG-enhanced search
- DID-based identity system
- P2P network foundation

---

## Version History

- **3.4.0** (2026-02-28) - v3.1.0-v3.4.0 Phase 65-77: AI Market, Hardware Security, Global Social, EvoMap
- **0.21.0** (2026-01-19) - Android Phase 5, Release automation, Test improvements
- **0.20.0** (2026-01-15) - MCP integration, Performance dashboard, Manus optimizations
- **0.19.0** (2026-01-10) - P2P messaging, Knowledge graph
- **0.18.0** (2026-01-05) - Vue 3 migration, Electron upgrade
- **0.16.0** (2025-12-20) - Knowledge base MVP

---

## Links

- [Repository](https://github.com/chainlesschain/chainlesschain)
- [Documentation](https://github.com/chainlesschain/chainlesschain/tree/main/docs)
- [Issues](https://github.com/chainlesschain/chainlesschain/issues)
- [Releases](https://github.com/chainlesschain/chainlesschain/releases)
