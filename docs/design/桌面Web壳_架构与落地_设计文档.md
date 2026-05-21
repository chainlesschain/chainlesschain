# 桌面 Web 壳 — 架构与落地设计文档

> 版本：v1.1（Phase 2 收尾 + 持久化 / 取消 / Speech port，2026-05-01）
> 关联：`memory/desktop_web_shell_strategy.md`、`memory/desktop_web_shell_multi_window_design.md`

## 1. 问题与目标

### 现状（2026-04-29 基线）
- `desktop-app-vue/`：Electron + Vue3 + 51 Pinia store + 3238-LOC preload + 7600+ 测试。V5 / V6 shell 双轨并存。
- `packages/web-panel/`：Vue3 + 9 store + 39 测试，纯 web SPA，借 WS 与 CLI（`packages/cli/src/lib/web-ui-server.js`）通信，对外功能成熟。
- 痛点：桌面端 V5/V6 page port 速度慢（每页 3-5 天）、bug 多；web 版功能更全更稳但缺桌面专属能力（U-Key、本地 FS、MCP、Ollama 等）。

### Vision（用户口径）
**桌面版 = web 版的加强版**：
1. **好分发**：用户无需 Node 环境，Electron 自包含可执行。
2. **能力超集**：U-Key 硬件签名、本地 FS、MCP 子进程、Ollama 本地推理、P2P/libp2p 真接入等 web 做不到的，桌面也能用。
3. **独有特性强项化**：把已投入的 30,000+ 测试、141 skills、114 store、原生集成转化为差异化卖点——不是"和 web 一样"，是"web + 原生"。

### 不做
- 完整 store 折回（114→9 不现实）
- 退役 V5/V6 desktop renderer（已投 7600 测试）
- 强行抽 ui-shared / transport-shared 共享包（暂不投资）

---

## 2. 架构（A1 同进程嵌入）

```
┌──────────────────────────────────────────────────────────────────┐
│ Electron Main Process                                             │
│ ┌────────────────────────────────────────────────────────────┐   │
│ │ web-shell-bootstrap.js                                     │   │
│ │  ├─ web-ui-loader → CLI's web-ui-server (HTTP, loopback)   │   │
│ │  ├─ ws-cli-loader → CLI's ChainlessChainWSServer + 拦截    │   │
│ │  │   topic dispatch（ukey.status / fs.* / skill.list）     │   │
│ │  └─ auto-WSSessionManager（session-* 协议透传）            │   │
│ └────────────────────────────────────────────────────────────┘   │
│                            ▲                                      │
│                  loopback  │  loopback                            │
│ ┌──────────────────────────┴────────────────────────────────┐    │
│ │ BrowserWindow → http://127.0.0.1:NNNN/                    │    │
│ │   (web-panel SPA, vendored from packages/web-panel/dist) │    │
│ │   + window.__CC_CONFIG__ = { wsPort, wsToken, ... }      │    │
│ │   + minimal preload (web-shell.js, 真·原生 API only)     │    │
│ └──────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
```

### 关键决策（5 个，全部确认）

| # | 决策 | 选择 |
|---|---|---|
| 1 | ws-server 进程模型 | **A1 同进程**：Electron main 直接 `await import()` ESM CLI 模块，loopback 零开销。崩了再升 utility-process。 |
| 2 | 入口选择 + V6 命运 | **B2 设置 opt-in**：`ui.useWebShellExperimental=true`，复刻 V6 hard-flip 节奏，dogfood 2-3 周后 hard-flip。V6 shell 当那一天进维护模式。 |
| 3 | UKey 协议 | **混合**：日常签名走 WS + progress event（`ukey.sign.waiting_user`）；高危操作（生成密钥/重置/导出助记词）走 `window.electronAPI.ukey.*`；UKey 一次一请求，main 串行化。 |
| 4 | 桌面专属页归属 | **D3 混合**（清单见 §6）。 |
| 5 | 认证 | **E1 token + loopback**：随机生成 token 写 `__CC_CONFIG__`，loopback 信任足够。 |

---

## 3. Phase 落地（截至 2026-05-01）

| Phase | 状态 | 关键产物 |
|---|---|---|
| **0 spike** | ✅ | `web-ui-loader.js` HTTP 同进程嵌入；`ws-bridge.js` 极简 topic 协议；`handlers/ukey-status-handler.js`；`phase0-smoke.cjs`；65 单测全绿 |
| **1.1 协议合并** | ✅ | `ws-cli-loader.js`：包 `ChainlessChainWSServer` + monkey-patch `_dispatcher.dispatch`，先匹配自定义 topic，命中包成 `{ok, result}` 信封，否则 fall through CLI 原 dispatcher。镜像 id + auth gate 防绕过。`web-shell-bootstrap.js` 一行 import 切换 backend，对外 API 不变 |
| **1.2 桌面专属 topic 第一批** | ✅ | `skill.list`（pilot，绕过 SPAWN_ERROR）/ `fs.openDialog` / `fs.saveDialog`（dialog-based 安全先于性能，10 MiB 读取上限） |
| **1.3 入口选择 UX** | ✅ | `shouldRunWebShell(argv, env, settings)` 三选一开启；settings-manager 加 `ui.useWebShellExperimental`；SystemSettings.vue 加 toggle；main/index.js `_readSettingsSync` 启动读 settings.json |
| **1.4 packaging prep** | ✅ | `scripts/prepare-web-shell-vendor.js`：vendor helper。**Decision A**：vendor 目标 = `path.join(buildPath, "..")`（即 Resources/），保证 loaders 4-up REL 在 dev / packaged 都对。`tests/unit/scripts/phase1.4-path-math.test.js` 算术验证锁住。`forge.config.js#packageAfterCopy` 已修正（commit `cecb94980`，原 `vendorWebShellInto(buildPath)` overshoot 修为 parent；asar.unpack 顺势丢掉死掉的 `packages/**` glob）|
| **1.4 实战** | ⏸ | `npm run make:win` 真打包 + 安装 setup.exe 启动验证（用户机器循环）|
| **1.5 多窗口架构** | ✅ | `window-registry.js`（202 行，role-based hash route + geometry 持久化骨架）+ `handlers/window-open-handler.js`（146 行，WS topic `window.open` 桥） + 13+ 单元；`92ad62931` 接 GeometryPersister 持久化 main + 边窗 bounds，atomic settings.json 写 |
| **2 桌面专属 topic 第二批** | ✅ | `mcp.list_tools` / `mcp.call_tool` / `mcp.list_resources` / `mcp.read_resource`（commits `4b4d159f0` `45aee9665`）；流式 envelope (`da1fc0caa`) async-generator handler 每 yield 发 `<topic>.chunk`，return 发 `<topic>.result`；`llm.chat` 流式 (`3535ab03b`) + `ukey.sign` 流式 (`6e111cf16`) |
| **2 取消语义** | ✅ | commit `b6b5174cb` + `4951c95d5`：ws-cli-loader 加 `inFlightStreams<id, gen>` map；ws.close（lazy WeakSet 钩 ws.on('close')）+ `<topic>.cancel` 帧两条触发链都驱动 `gen.return()`；llm-handlers 的 generator finally 调 AbortController.abort()，signal 透到 ollama / anthropic / openai client 的 fetch（gemini 因 axios 参数顺序差异未透） |
| **配置持久化修** | ✅ | commit `436e349f1`：AppConfigManager.DEFAULT_CONFIG 加 `ui` 字段 + load/loadAsync 合并白名单加 `ui` 行；`_readSettingsSync` 层叠 app-config.json 的 `ui` 到 settings.json，让 SystemSettings toggle 真正在下次启动生效。原 V6 toggle + Web Shell toggle silent-drop bug 一起修掉 |
| **Speech port (Task #4)** | ✅ partial | `2d45ae278`：web-panel 加 `views/SpeechSettings.vue` + `utils/speech-settings-parser.js` + 路由 `/speech-settings`；引擎选择 + Web Speech / Whisper API / Whisper Local 核心配置；高级 storage / audio / 知识集成 / 性能子项保留 V5（Memory Bank 同款 deliberate scope cut）。LLM / Project 子页 web-panel 早有等价（Providers + ProjectSettings），V5 SystemSettings 三个 tab 加 a-alert 指向 web-panel |
| **1.6 hard-flip + 双向切换** | ✅ | `3296e9fb4`：复刻 V6 hard-flip (`caaddf530`) 节奏 — DEFAULT_CONFIG.ui.useWebShellExperimental `false → true`；`shouldRunWebShell` 语义 `=== true` → `!== false`（opt-out，UI toggle 显式 false 优先级高于 argv/env force-on）。`ebed2d7e8`：V6 shell `AppShellPreview.vue` topbar 加 🌐 GlobalOutlined 按钮（Modal.confirm → `electronAPI.invoke('config:set'/'system:restart')`），绕开 `titleBarStyle:"hidden"` 隐藏菜单的限制。`367ec1bbe`+`5c21633b5`：web-panel `AppLayout.vue` header-right 加 🖥️ DesktopOutlined（`shellMode.isEmbedded` 时显示），第一版 electronAPI 没用（web-shell preload 故意空），改走 `ws.sendRaw({type:"shell.switch", target:"desktop"})`。`41b17ec56`：新 handler `shell-switch-handler.js`（factory + DI），写 config + 100ms 后 relaunch+exit（让 WS 回包先 flush）；bootstrap 仅在 getAppConfig 提供时注册；8 单测覆盖两 target / 错误路径 / appConfig=null。 |
| **启动期 4 处运行时回归修** | ✅ | `4c054fa98` DatabaseManager ESM 解构（`b2a8e5a8a` 后遗留漏改，原 25+ 模块 silent skip）；`fd9c4f101` 010 migrations 路径 bug × 10 处 + 加载 `009_embedding_cache` / `009_memory_system`（embedding_cache / memory_stats / memory_sections / user_preferences 等首次真建表，LATEST_VERSION 6→7）；`5e2048329` session-core IPC channel 命名空间分离（`session-core:` 前缀，避免与 session-manager-ipc + memory-v2-ipc 6 个冲突，原冲突让 session-core 24 channel 注册被截断）；`ef2d9f65b` 渲染层内联 logo loader 抽外部 js 满足 strict CSP；`60baa217b` 登录页 splash 卡屏 + IPC 1.5s race timeout + pointer-events:none；`de7077151` `public/logo.png` 一并补齐。 |

---

## 4. 已知限制与 follow-up

### 已知限制
- `titleBarStyle:"hidden"` 被锁死 — Electron 39 在 web-shell 模式下 `default` 触发 0xC0000005 sandboxed_renderer 崩溃（注释见 `index.js:748`），所以两种壳都用 hidden + `titleBarOverlay` 自绘控件。结果：**应用菜单不可见**——`menu-manager.js` 的菜单项依旧注册（accelerator 仍工作），但用户看不见。Phase 1.6 的"切换到 web shell" / "切回桌面壳"按钮就是为绕开这一点直接塞到顶栏右侧。
- `_executeCommand` 在 Electron 内 spawn `process.execPath`（指向 Electron 而非 node）+ BIN_PATH，**execute 类消息不可用**——CLI 已加 `ELECTRON_RUN_AS_NODE=1` workaround（commit `d181e14c4`），但 skill.list 仍用同进程 topic 优先（无 spawn cost）。SpeechSettings.vue / ProjectSettings.vue 等 web-panel 配置页走 `ws.execute('config get/set ...')` 路径，embedded shell 模式下仍受这个限制；浏览器模式（CLI web-ui-server）下 OK。
- `session-*` 之前需要外部 sessionManager 注入；commit `78056d181` 改为 ws-cli-loader 自动实例化 WSSessionManager（`db: null` 内存 Map + 从 `~/.chainlesschain/config.json` 读 LLM 配置 + createSession 时重读以拿最新 apiKey）。
- ~~SystemSettings 的 `ui.useWebShellExperimental` toggle 持久化~~ — 已修，commit `436e349f1`：AppConfigManager.DEFAULT_CONFIG 补 `ui` 字段，load/loadAsync 合并白名单加 `ui` 行；`_readSettingsSync` 层叠 app-config.json 的 `ui` 到 settings.json，让 SystemSettings toggle 真在下次启动生效。
- `llm.chat` 流式取消：ws.close + `<topic>.cancel` 真停 fetch 已就位（commits `b6b5174cb` + `4951c95d5`），signal 已贯通 ollama / anthropic / openai client；**gemini-client.js** 因为参数顺序与其他 client 不同（`(messages, options, onChunk)` vs `(messages, onChunk, options)`）+ 用 axios 不是 fetch，signal 暂未透传，独立 refactor。
- **CLI session-list bug 修**（drive-by，commit pending）：`closeSession` 后 session 仍现身 `session-list`——`_serializeSessionMetadata` 漏写 `status` 字段；listSessions 的 DB 路径未过滤 closed。本次一并修：metadata 加 `status` + listSessions DB 路径 `if (metadata.status === "closed") continue;`。

### Follow-up 工作
1. **Phase 1.4 实战**：`make:win` 真跑 + 装 setup.exe 验证 web-shell 启动 + ws round-trip（vendor target 已修，理论上 packaged loaders 直接命中 `Resources/packages/`）
2. **Phase 1.5 多窗口长尾**：MVP + GeometryPersister 已落地；剩余 = role catalog 完善 + 多窗口 e2e（拖拽、跨窗口 drag-drop 在 Phase 2+，不在 1.5）
3. **gemini-client signal 透传 + 参数顺序修齐**：把 `chatStream(messages, options, onChunk)` → `(messages, onChunk, options)`，并在 axios `responseType:"stream"` 调用上加 `signal`
4. **SystemSettings 余下 tab 搬迁**：Vector / Git / Backend / Security / General / Editor / Shortcuts 等也是纯配置 UI，可继续按 Speech port 模板（parser util + dotted-path diff/save）滚动迁移
5. **AppConfigManager `project.rootPath` 等其它 whitelist 漏**：本次只修 `ui`，类似的 `project` / `enterprise` / `general` / `editor` 等 SystemSettings 写入但 DEFAULT_CONFIG 没列的字段仍是 silent-drop 状态——单独审一遍
6. **8 个 latent IPC 旧账**：6 个其他模块的 second-handler 重复注册（context:get-stats / workflow:create / compliance:generate-report / governance:create-proposal / token:get-balance / hsm:get-compliance-status），都是 IPC Registry 的 warning 但当前用降级路径，跟 session-core 一样需要分别 namespace 一下；2 个 ESM 解构遗漏（`PluginInstaller is not a constructor` / `ipcGuard.registerModule is not a function`）跟 DatabaseManager 同根因（`b2a8e5a8a` ESM 迁移漏改），按 4c054fa98 模式逐个修
7. **Electron 39 `titleBarStyle:"default"` 崩溃溯源**：现在锁死 hidden 是 workaround，菜单不可见的代价。值得查 Electron 39 changelog 看是否已知 issue；如果可修，菜单/系统菜单一键回归就不用塞顶栏自绘按钮

---

## 5. 测试矩阵

| 层 | 文件数 | 测试数 | 覆盖 |
|---|---|---|---|
| Unit (desktop web-shell) | 13 | 169 | bootstrap composition / loaders / handlers (skill / fs / mcp×4 / llm.chat / ukey.sign / window.open / **shell.switch**) / dispatcher 包装 + 流式 envelope + cancel paths（`<topic>.cancel` + ws.close → gen.return + AbortController.abort）|
| Unit (desktop config) | 3 | 26 | AppConfigManager `ui.*` round-trip（7，Phase 1.6 hard-flip 后默认翻 false→true）+ `_readSettingsSync` 纯函数 + app-config.json 层叠 overlay（12）+ `writeSettingsSync` atomic write（7）|
| Unit (desktop system) | 1 | 5 | MenuManager.openWebShellInBrowser 行为（getter null / 缺 httpUrl / openExternal reject 吞错）|
| Unit (desktop scripts) | 2 | 14 | vendor 脚本 + 路径算术（Decision A 锁定）|
| Unit (web-panel) | 42 | 1616 | 全 SPA 单测：parser utils（含 137 settings 相关）/ stores / composables / 路由形状（含 53 routes 列表 + SpeechSettings 路径）|
| Integration (desktop web-shell) | 1 | 14 | 真 HTTP+WS round-trip + skill.list / ukey.status / fs.* + 多客户端共享 registry |
| Integration (desktop) | 35 | 514 | 跨进程 + DB + IPC 域分片，全绿（46 skipped 是 env-conditional：blockchain-ui / redis）|
| Integration (web-panel CLI compat) | 3 | 58 | Phase B/D CLI 命令 envelope + 域分片，1 已知 fail 是本机 DB 损坏（`database disk image is malformed`，非代码 bug）|
| E2E (web-panel) | 2 | 75 | panel.test.js + ws-protocol-compat.test.js — 后者本次发现并修了 `session-close` 不真删 bug（v1.0 envelope `closeSession` 仅 in-memory 删，DB 持久残留导致 `session-list` 仍返回闭合 session）|
| E2E (Playwright, desktop) | 1 | 4 | Electron 启 `--web-shell` → SPA 渲染 + WS round-trip |
| One-shot smoke | 1 | — | `phase0-smoke.cjs` 端到端验证 |

总计：**~2480 测试**全绿（不计 skipped 与上游 DB 损坏导致的 1 个本机环境 fail）。

---

## 6. 桌面专属页清单（D3 混合）

**留 V5/V6 desktop renderer**（≤8 页，原生 UX 必要）：
- `HardwareWalletPage`（U-Key 全套）
- `SystemSettings` 子页：**数据库 / 性能 / P2P** 三块（涉及本地引擎重启、日志路径、native 进程）
- `BackupDashboard`（本地 FS + 定时任务）
- `LLMTestChatPage`（Ollama 直连诊断）

**搬进 web-panel**（主战场，业务/AI/社交/知识）：
- AI Chat / Skills / Cowork / Workflow / Plan Mode
- Knowledge（Notes/Search/KG）
- DID / Community / Friends / Projects
- Marketplace / Tenant / Governance
- SystemSettings 中的：
  - **LLM**：`packages/web-panel/src/views/Providers.vue`（provider 切换 / 测试 / 配置）
  - **Project**：`packages/web-panel/src/views/ProjectSettings.vue`
  - **Speech** *(2026-05-01 落地)*：`packages/web-panel/src/views/SpeechSettings.vue`（引擎选择 + Web Speech / Whisper API / Whisper Local 三块核心配置；高级 storage / audio / 知识集成 / 性能等低频子项保留 V5）。V5 三个对应 tab 加 a-alert 指向 web-panel 等价页，V5 表单仍可用（不强制重定向）。
- 其它 SystemSettings tab（Vector / Git / Backend / Security / General / Editor / Shortcuts）当前还在 V5，按 Speech 同款 parser-util + dotted-path diff/save 模板按需续迁

---

## 7. 启用方式

### 用户开关（Phase 1.6 hard-flip 后默认即 web-shell）
- **默认进入 web-shell**：全新装机或没有 `useWebShellExperimental` 字段的旧 config 都直接落到 web-shell。
- **回退到 V5/V6 桌面壳**：右上角 🖥️ DesktopOutlined 按钮（web-panel 顶栏）→ Modal 确认 → `shell.switch` WS topic 写 `useWebShellExperimental: false` + 100ms 后自动 relaunch；或 SystemSettings → 通用设置 → 关闭 "使用 Web Shell（默认）"；或直接编辑 `app-config.json` 设 `ui.useWebShellExperimental: false`。
- **从 V5/V6 切到 web-shell**：右上角 🌐 GlobalOutlined 按钮（V6 preview shell topbar） / `CmdOrCtrl+Shift+B` accelerator → Modal 确认 → `electronAPI.invoke('config:set'/'system:restart')`。
- **强制（CI / 调试）**：`npm run dev:web-shell`（dev）或 `--web-shell` argv flag（prod）/ `CHAINLESSCHAIN_WEB_SHELL=1` env。这些是 force-on 的 escape hatch，**优先级低于** UI toggle 显式 false——用户关掉的 toggle 不会被 env/argv 偷偷打开。

### 开发者命令
```bash
# 单测
cd desktop-app-vue && npx vitest run src/main/web-shell/__tests__/ tests/unit/scripts/ tests/unit/config/

# 一次性 smoke
node desktop-app-vue/src/main/web-shell/__tests__/phase0-smoke.cjs

# E2E (Playwright)
cd desktop-app-vue && npx playwright test tests/e2e/web-shell/

# Vendor dry-run（看哪些文件会被打包）
node desktop-app-vue/scripts/prepare-web-shell-vendor.js --dry-run

# 真打包
cd desktop-app-vue && npm run make:win
```
