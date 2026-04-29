# 桌面 Web 壳 — 架构与落地设计文档

> 版本：v1（Phase 1.4 prep 落地，2026-04-30）
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
3. **独有特性强项化**：把已投入的 7600+ 测试、139 skills、114 store、原生集成转化为差异化卖点——不是"和 web 一样"，是"web + 原生"。

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

## 3. Phase 落地（截至 2026-04-30）

| Phase | 状态 | 关键产物 |
|---|---|---|
| **0 spike** | ✅ | `web-ui-loader.js` HTTP 同进程嵌入；`ws-bridge.js` 极简 topic 协议；`handlers/ukey-status-handler.js`；`phase0-smoke.cjs`；65 单测全绿 |
| **1.1 协议合并** | ✅ | `ws-cli-loader.js`：包 `ChainlessChainWSServer` + monkey-patch `_dispatcher.dispatch`，先匹配自定义 topic，命中包成 `{ok, result}` 信封，否则 fall through CLI 原 dispatcher。镜像 id + auth gate 防绕过。`web-shell-bootstrap.js` 一行 import 切换 backend，对外 API 不变 |
| **1.2 桌面专属 topic 第一批** | ✅ | `skill.list`（pilot，绕过 SPAWN_ERROR）/ `fs.openDialog` / `fs.saveDialog`（dialog-based 安全先于性能，10 MiB 读取上限） |
| **1.3 入口选择 UX** | ✅ | `shouldRunWebShell(argv, env, settings)` 三选一开启；settings-manager 加 `ui.useWebShellExperimental`；SystemSettings.vue 加 toggle；main/index.js `_readSettingsSync` 启动读 settings.json |
| **1.4 packaging prep** | ✅ prep | `scripts/prepare-web-shell-vendor.js`：Phase 1.4 vendor helper。**Decision A**：vendor 目标 = `path.join(buildPath, "..")`（即 Resources/），保证 loaders 4-up REL 在 dev / packaged 都对。`tests/unit/scripts/phase1.4-path-math.test.js` 算术验证锁住。`forge.config.js#packageAfterCopy` 已接 |
| **1.4 实战** | ⏸ | `npm run make:win` 真打包 + 安装 setup.exe 启动验证（用户机器循环）|
| **1.5 多窗口架构** | ⏸ | 设计 memo 已落（`memory/desktop_web_shell_multi_window_design.md`）：同源多 BrowserWindow + role-based hash route + geometry 持久化 |

---

## 4. 已知限制与 follow-up

### 已知限制
- `_executeCommand` 在 Electron 内 spawn `process.execPath`（指向 Electron 而非 node）+ BIN_PATH，**execute 类消息不可用**——CLI 已加 `ELECTRON_RUN_AS_NODE=1` workaround（commit `d181e14c4`），但 skill.list 仍用同进程 topic 优先（无 spawn cost）。
- `session-*` 之前需要外部 sessionManager 注入；commit `78056d181` 改为 ws-cli-loader 自动实例化 WSSessionManager（`db: null` 内存 Map + 从 `~/.chainlesschain/config.json` 读 LLM 配置 + createSession 时重读以拿最新 apiKey）。
- SystemSettings 的 `ui.useWebShellExperimental` toggle 持久化路径走 `config:set` → AppConfigManager，但 AppConfigManager DEFAULT_CONFIG 没有 `ui` 字段，load 时 whitelist 合并会丢——**V6 toggle 同条 bug**，统一修在 Phase 1.4+ 单独 ticket，不阻塞 dogfood（env/argv 仍 OK）。

### Follow-up 工作
1. **Phase 1.4 实战**：`make:win` 真跑 + 装 setup.exe 验证 web-shell 启动 + ws round-trip
2. **Phase 1.5 多窗口**：按 `desktop_web_shell_multi_window_design.md` 模板实施
3. **桌面专属 topic 第二批**：`ollama.chat` 流式 / `ukey.sign` + progress / `mcp.list_tools` + `mcp.call_tool`（接 main/mcp/ 40 文件）
4. **AppConfigManager `ui` 字段持久化修**：解决 V6 toggle + web-shell toggle 共同的 silent-drop bug

---

## 5. 测试矩阵

| 层 | 文件数 | 测试数 | 覆盖 |
|---|---|---|---|
| Unit (web-shell) | 6 | 79 | bootstrap composition / loaders / handlers / dispatcher 包装 / 路径常量 |
| Unit (config) | 1 | 6 | `_readSettingsSync` 纯函数 |
| Unit (scripts) | 2 | 14 | vendor 脚本 + 路径算术（Decision A 锁定）|
| Integration (web-shell-bootstrap) | 1 | 14 | 真 HTTP+WS round-trip + skill.list / ukey.status / fs.* 错误信封 + 多客户端共享 registry |
| E2E (Playwright) | 1 | 4 | Electron 启 `--web-shell` → SPA 渲染 + WS round-trip |
| One-shot smoke | 1 | — | `phase0-smoke.cjs` 端到端验证 |

总计：**117+ 测试**覆盖 web-shell 关键路径。

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
- SystemSettings 中的 LLM / Speech / Project 子页（本质是配置 UI，P1 SFC 拆分已铺路）

---

## 7. 启用方式

### 用户开关（dogfood）
- 设置项：System Settings → 通用设置 → "启用 Web Shell（实验）" toggle，重启生效
- 命令行：`npm run dev:web-shell`（dev）或 `--web-shell` argv flag（prod）
- 环境变量：`CHAINLESSCHAIN_WEB_SHELL=1`

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
