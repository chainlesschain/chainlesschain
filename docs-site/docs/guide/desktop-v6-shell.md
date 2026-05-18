# 桌面版 V6 对话壳（Chat-First Shell）

> 面向个人办公 + 企业定制的插件化对话壳。v5.0.2.x → v6.0 演进，预览路由 `/v2`（P0–P6 落地）与 `/v6-preview`（P7 Claude-Desktop 风格外观预览）并存。

## 0. P7 预览（`/v6-preview`，Claude-Desktop 风格外观）

2026-04-20 起，桌面版新增 `/v6-preview` 路由，把外观向 Claude Desktop 对齐，并在左栏底部固化 4 颗 "去中心化" 入口，用来强化桌面版与 CLI 版的定位差（个人办公 · 隐私 · 去中心化协作/交易/社交 + 硬件级安全）。

- **路由**：`/v6-preview`，与 `/v2` 并行，不替换任何既有入口
- **三区骨架**：左栏 `ConversationList` 会话历史 + `DecentralEntries` 四颗按钮 + 主题切换；中区极简留白 + 气泡对话 + 底部单行 composer（Ctrl/Cmd+Enter 发送）；右侧 `ArtifactDrawer` 从右滑入
- **4 颗固化入口**：P2P 协作（`TeamOutlined`）/ 去中心化交易（`SwapOutlined`）/ 去中心化社交（`GlobalOutlined`）/ U-Key 安全（`SafetyCertificateOutlined`）；绑定 4 个 `builtin:openP2P|openTrade|openSocial|openUKey` handler，点击后在右抽屉挂载轻量预览 widget（`shell-preview/widgets/*PreviewWidget.vue`），widget 含概览 + 按钮 `router.push` 到既有 `/main/*` 完整页（P2PMessaging / TradingHub / Chat / ThresholdSecurity）
- **4 主题**：dark / light / blue / green（从 `packages/web-panel/src/stores/theme.js` 移植），通过 `[data-theme-preview]` 属性切换 + localStorage 持久化
- **会话持久化（P9a）**：`stores/conversation-preview.ts` Pinia store 将会话 / 消息 / 活跃 id 持久化到 `localStorage`（key `cc.preview.conversations`，**`version: 3` schema**）；重启预览壳自动 `restore()`，**首次启动或 schema/JSON 损坏时空白起步**（无 demo / 欢迎会话），第一次发送或显式 `createBlank()` 才生成会话
- **品牌与平台细节（2026-04-29 起）**：左上角品牌位 = `assets/logo.png` + "ChainlessChain"（取代旧 demo 时期的 "ClaudeBox" 字样）；macOS 红黄绿圆点仅在 `darwin` 平台显示，Windows / Linux 隐藏；底部 composer 把"进度 / 模型 / 技能 / 工具 / 终端"5 颗 runtime chip 收成单颗"模型"按钮 + 顶部齿轮按钮，两者均跳 `/settings/system?tab=llm`，未配置模型时按钮显示"未配置模型"
- **桌面 web-shell Phase 0/1（2026-04-30 起）**：以 `/v6-preview` 风格为目标，桌面版另起一条"Electron 主进程内嵌 ws-server，BrowserWindow 直接加载 web-panel dist"的实现路径，作为长期把桌面与 Web 端完全打通的基线。Phase 0 落地 `desktop-app-vue/src/main/web-shell/{web-shell-bootstrap,web-ui-loader,ws-cli-loader,ws-bridge}.js`；Phase 1.1 接入 `handlers/skill-list-handler.js` + `handlers/fs-handlers.js` 与 SystemSettings 里的持久化 opt-in 开关；Phase 1.4 通过 `desktop-app-vue/scripts/prepare-web-shell-vendor.js` 把 web-panel dist + ws 静态资产写到 forge build vendor 目录
- **相关文件**：`desktop-app-vue/src/renderer/shell-preview/{AppShellPreview,ConversationList,DecentralEntries,ArtifactDrawer}.vue` + `themes.css` + `desktop-app-vue/src/renderer/stores/{theme-preview,conversation-preview}.ts` + `shell-preview/widgets/*PreviewWidget.vue`
- **测试**：`stores/__tests__/theme-preview.test.ts`（10）+ `shell/__tests__/slash-dispatch.test.ts`（8）+ `shell-preview/widgets/__tests__/widget-registry.test.ts`（5）+ `stores/__tests__/conversation-preview.test.ts`（23）+ `router/__tests__/v6-shell-default.test.ts`（9），合计 55 例全绿
- **设计文档**：[桌面版 UI ClaudeDesktop 重构计划](../design/desktop-ui-refactor.md) 与 `docs/design/modules/97_桌面版UI_ClaudeDesktop重构计划.md`



## 1. 概述

ChainlessChain 桌面端从 v5.0.2.34 起把 UI 整体切到 "**对话优先 + 插件化平台**" 的新壳（v6）。

- **v5 旧壳** — 功能导向的 dashboard（侧栏堆十几个模块入口，用户打开哪个就 "进入哪个页面"）。
- **v6 新壳** — 对话优先，一切操作都以 "说一句话" 发起；界面被冻结成三区（左空间 / 中对话 / 右 Artifact）+ 一条状态栏；任何新增能力都走 "插件 → 扩展点贡献" 的路径，核心不再增加页面。

新壳在路由 `/v2` 预览；主窗口默认路由在 `v6.0` 正式版切换。当前版本 `/` 与 `/v2` 并存，方便用户对比。

## 2. 核心特性

| 特性 | 说明 |
|---|---|
| Chat-First | 所有交互（查笔记、发消息、签交易、调 LLM、管理空间）都从 Composer 的一句话开始 |
| 三区冻结布局 | 左 Spaces / 中 Conversation + Composer / 右 Artifacts，三区固定不可拖拽，避免 UI 漂移 |
| 插件化扩展 | 7 类 UI 扩展点 + 5 类企业能力贡献点，按 `priority` 降序选胜者 |
| 企业级 3 路径定制 | 私有 Registry / `.ccprofile` 签名包 / MDM 推送，不改内核即可整体换品牌 + 换 LLM + 换存储 |
| 签名验证链 | 所有企业插件 ed25519 签名 + 每插件 sha256，客户端 `trustedPublicKeys` 白名单拉起 |
| AdminConsole | `Ctrl+Shift+A` / `/admin` / 状态栏齿轮三路径打开，4 标签页实时显示生效贡献 |

## 3. 系统架构

```
┌──────────────── Electron 主窗口 ────────────────┐
│                                                 │
│  ┌─────────┬──────────────────────┬──────────┐  │
│  │ Shell   │ ConversationStream   │ Artifact │  │
│  │ Sidebar │ ──────────────────── │ Panel    │  │
│  │ (Spaces)│ ShellComposer (/, @) │ (optional)│ │
│  └─────────┴──────────────────────┴──────────┘  │
│  ┌────────────── ShellStatusBar ──────────────┐ │
│  │ U-Key · DID · P2P · LLM · Cost · Widgets… │ │
│  └────────────────────────────────────────────┘ │
│                                                 │
└─────────────────────────────────────────────────┘
        ▲                                ▲
        │ renderer: Vue3 + Pinia         │ IPC
        ▼                                ▼
┌───────────────── Electron 主进程 ──────────────────┐
│ PluginManager (builtin + registry + profile + MDM)│
│ ExtensionPointRegistry (7 UI × 5 provider)        │
│ .ccprofile / MDMManager / PluginRegistry          │
└────────────────────────────────────────────────────┘
```

核心分层：

- **Shell 骨架**（`src/renderer/shell/*.vue`）— 冻结的三区 + 状态栏，只负责布局与事件总线，不含业务。
- **扩展点注册表**（`src/main/plugin-system/extension-point-registry.js`）— 收集所有插件贡献，按 `priority` 降序对外暴露。
- **分发层**（`src/renderer/shell/slash-dispatch.ts` + `widget-registry.ts`）— 把 plugin 声明的字符串 `handler` / `component` 映射到运行时行为。
- **企业覆盖链**（Registry / `.ccprofile` / MDM）— 让企业 Profile（priority 100）盖过默认（priority 10）。

## 4. 系统定位

ChainlessChain 桌面 v6 壳定位为"**个人 AI 工作站 + 企业可整包交付的 Electron 平台**"：

- **给个人用户**：用一个统一的对话入口替代十几个功能页面，降低认知成本；所有数据留在本地（SQLCipher AES-256 + U-Key 硬件签名）。
- **给企业 IT**：无需 fork 源代码，直接签发 `.ccprofile`（或走 MDM）就能替换品牌、LLM、存储、审计链路，客户端代码零修改。
- **给插件开发者**：`plugin.json` 声明一次贡献（UI 扩展点 + 能力贡献），既能进社区市场，又能被企业打包复用。

它不是 Web 应用，也不是通用 LLM 客户端 —— 它是"**对话驱动 + 硬件安全 + 企业可定制**"这三角中间的唯一完整实现。

## 5. 核心功能

### 5.1 三区布局

| 区域 | 作用 | 关键组件 |
|---|---|---|
| **左：工作区侧栏** | 切换不同"空间"（个人 / 工作 / 金融 / 社交 / 学习…），每个空间携带 RAG 预设 + 对话历史 + 联系人过滤 | `ShellSidebar` |
| **中：对话 + 输入框** | 所有交互以对话为主干，`/` 触发命令，`@` 引用对象，Enter 发送 | `ConversationStream` + `ShellComposer` |
| **右：Artifact 面板** | 可选产物区（笔记、签名、交易、P2P 会话、凭证…），支持 U-Key 签名内联 | `ArtifactPanel` |
| **底：状态栏** | 28px 高，显示 U-Key / DID / P2P / LLM / 累计成本 + 插件自定义 widget | `ShellStatusBar` |

### 5.2 命令与快捷键

- `Ctrl+K` — 打开 Command Palette（跨全局搜索）
- `Ctrl+Shift+A` — 打开 **AdminConsole**
- Composer 输入 `/` — 弹出命令面板，内置 `/admin`
- Composer 输入 `@` — 弹出引用面板（笔记 / 空间 / DID…）

### 5.3 AdminConsole（Ctrl+Shift+A）

4 个标签页：

| 标签 | 内容 |
|---|---|
| **概览** | 当前生效的品牌 / Slogan / 主题 ID + 5 个激活的企业能力（LLM / Auth / Storage / Crypto / Audit）一览 |
| **UI 扩展点** | 7 类 UI 贡献明细（Spaces / Artifacts / Slash / Mention / StatusBar / Home / Composer Slots） |
| **企业能力** | 5 类能力贡献的 JSON 详情 |
| **调试** | 手动刷新扩展点注册表 |

仅 `admin` 权限账户可见。

### 5.4 企业定制 3 路径

1. **私有 Registry** — 企业内网跑 Plugin Registry，签名发布品牌 / 主题 / LLM / 审计插件；客户端凭 `trustedPublicKeys` 白名单拉取并验签。
2. **.ccprofile（Enterprise Profile）** — 把一批插件打包成一个签名文件（ed25519 over canonicalized-JSON + 每插件 sha256），一键换品牌 + 主题 + LLM + 存储 + 审计。
3. **MDM 推送** — 企业 IT 通过中央 MDM 服务器指派 profile；客户端启动时拉取 → 校验 → 解包到覆盖目录，高 `priority` 贡献自动胜出内置默认。

## 6. 技术架构

| 层 | 技术 | 说明 |
|---|---|---|
| Shell 渲染器 | Vue 3.4 + TypeScript 5.9.3 + Ant Design Vue 4.1 | `src/renderer/shell/*.vue`，ES6 import |
| 状态管理 | Pinia 2.1.7 | 51 个 store；壳只用 `shell` / `space` / `conversation` 三个 |
| Shell 扩展桥 | IPC + `window.electronAPI.plugin.*` | `getRegistered*` / `getActive*` 共 12 个只读查询通道 |
| 插件系统（主进程） | Node CommonJS | `src/main/plugin-system/` 下 `PluginManager` / `PluginLoader` / `PluginRegistry` / `ExtensionPointRegistry` |
| 企业覆盖 | MDM Manager + Profile Installer | `src/main/mdm/*.js`，ed25519 签名 + 每插件 sha256 校验 |
| 内置插件载入 | `loadFirstPartyPlugins()` | `src/main/plugins-builtin/`，跳过 DB / 沙箱 / 权限 |
| Shell Dispatcher | `slash-dispatch.ts` + `widget-registry.ts` | P6 新增，字符串 handler/component → 运行时回调 |

## 7. 系统特点

- **冻结三区** — 用户看到的"外框"稳定不变，插件只能往三区里面贡献内容，不能改框架；这让企业 Profile 的效果可预期。
- **Priority-only 选胜** — 所有扩展点只看 `priority` 数字，`priority: 100` 永远盖过 `priority: 10`；没有 "merge" 语义，避免多插件混战。
- **签名优先于信任** — 即使是内置插件，企业覆盖版本也必须 ed25519 签名才能胜出；`trustedPublicKeys` 可按租户颁发。
- **13 个内置插件零开销** — 内置 plugin 不走 DB / 沙箱 / 权限链路，直接 `require()`；启动开销 < 40ms。
- **主进程与渲染器双语法** — 主进程严格 CJS（`require/module.exports`），渲染器严格 ES6（`import`），通过 IPC 桥连接，两侧都能独立测试。

## 8. 应用场景

| 场景 | 做法 |
|---|---|
| **个人 second brain** | 默认 `spaces-personal` + `notes` + 本地 Ollama，所有数据留本地加密盘 |
| **研发团队研发机** | 企业推一个 `.ccprofile` 把 LLM 切到内网 OpenAI-compatible 网关 + 审计 sink 切到公司 SIEM |
| **金融 / 医疗合规桌面** | Profile 把 `crypto-ukey-default` 换成硬件 HSM provider + 所有出站走 `chain-gateway`（链上存证） |
| **教育 / 培训** | Profile 下发特定 prompt / 技能包（`chat-core` 覆盖），U-Key 绑定学生身份 |
| **政府 / 国企桌面分发** | MDM 强制推 profile + 禁止用户安装第三方插件（`trustedPublicKeys` 仅允许官方 key） |

## 9. 竞品对比

| 能力 | v6 Shell | Claude / ChatGPT 桌面 | VSCode + Copilot | Obsidian |
|---|---|---|---|---|
| Chat-first UI | ✅ | ✅ | ❌（IDE-first） | ❌ |
| 本地数据加密（SQLCipher + 硬件签名） | ✅ | ❌ | ❌ | 部分 |
| 企业整包换肤（不改源码） | ✅ `.ccprofile` + MDM | ❌ | ⚠️ 扩展可自定义 | ⚠️ 插件 |
| 插件 UI 扩展点 | ✅ 7 类 | ❌ | ✅ 多 | ✅ 多 |
| LLM 提供方可热换 | ✅ Provider 贡献 | ❌ 锁厂商 | ⚠️ 有限 | ⚠️ 插件 |
| Audit / 合规 sink 可替换 | ✅ | ❌ | ❌ | ❌ |
| DID / 去中心化身份 | ✅ | ❌ | ❌ | ❌ |
| 签名验证链（ed25519 + sha256） | ✅ | ❌ | ❌ | ❌ |

## 10. 配置参考

### 10.1 用户端配置

位置：`%APPDATA%\chainlesschain-desktop-vue\.chainlesschain\config.json`

```json
{
  "shell": {
    "route": "/v2",                  // 进入 v6 壳；"/" 为旧 dashboard
    "defaultSpace": "personal",
    "statusBar": { "visible": true },
    "artifactPanel": { "defaultOpen": false }
  },
  "plugins": {
    "trustedPublicKeys": [
      "ed25519:BASE64-PUBLIC-KEY-OF-COMPANY"
    ],
    "registryUrl": "https://plugins.acme.corp/v1",
    "mdmProfileUrl": "https://mdm.acme.corp/api/profile"
  }
}
```

### 10.2 企业 Profile 样例（`.ccprofile`）

```json
{
  "name": "acme-corporate",
  "version": "1.0.0",
  "priority": 100,
  "plugins": [
    { "id": "brand-acme", "sha256": "abc…" },
    { "id": "ai-openai-gateway", "sha256": "def…" },
    { "id": "audit-splunk", "sha256": "ghi…" }
  ],
  "signature": "ed25519:BASE64-SIG-OVER-CANONICALIZED-JSON"
}
```

下发后启动时 `MDMManager.applyPinnedProfile()` → `PluginManager.setMDMExtractDir(dir)` → 解包到覆盖目录 → `ExtensionPointRegistry` 按 priority 重选胜者。

## 11. 性能指标

在 Windows 10 Pro / i7-11700 / 32GB / SSD 的参考机器上实测：

| 指标 | 目标 | 实测（v5.0.2.34） |
|---|---|---|
| 冷启动到 Shell 可交互 | ≤ 3000 ms | **~2400 ms** |
| 13 个内置插件载入 | ≤ 80 ms | **~38 ms** |
| `Ctrl+Shift+A` → AdminConsole 显示 | ≤ 100 ms | **~32 ms**（jsdom 测量 + 人工校对） |
| `/admin + Enter` 到模态打开 | ≤ 200 ms | **~55 ms** |
| ExtensionPointRegistry 7 × 贡献查询 | ≤ 20 ms | **~6 ms** |
| `.ccprofile` ed25519 验签 | ≤ 50 ms | **~12 ms** |
| 渲染器完整构建（`npm run build`） | — | **4m 52s**（仅 pre-existing chunk-size 警告） |

## 12. 测试覆盖

| 层 | 文件 | 用例 | 状态 |
|---|---|---|---|
| 单元 — 分发器 | `tests/unit/renderer/shell/slash-dispatch.test.ts` | 7 | ✅ |
| 单元 — Widget 注册表 | `tests/unit/renderer/shell/widget-registry.test.ts` | 5 | ✅ |
| 单元 — AdminShortcut 组件 | `tests/unit/renderer/shell/AdminShortcut.test.ts` | 2 | ✅ |
| 集成 — 扩展点主进程链路 | `tests/integration/plugin-extension-points.integration.test.js` | 5 | ✅ |
| 深度集成 — AppShell 交互 | `tests/unit/renderer/shell/AppShell.interaction.test.ts` | 3 | ✅ |
| E2E — AdminConsole | `tests/e2e/v6-shell/admin-console.e2e.test.ts` | 3 | `describe.skip`（待 admin 登录 helper） |
| **合计** | 6 文件 | **22 + 3 skip** | **单元 + 集成 13.6s 全绿** |

端到端烟雾：合成 Acme 品牌插件 → `.ccprofile` → 假 MDM server → 客户端拉取校验解包 → `getActiveBrandTheme()` 返回 `acme-corporate@100` 胜过默认 `chainlesschain-default@10`。

## 13. 安全考虑

| 威胁 | 缓解 |
|---|---|
| **恶意插件注入 UI** | 必须 ed25519 签名 + `trustedPublicKeys` 白名单；内置插件虽跳过沙箱但源码随安装包走 |
| **Profile 篡改** | `.ccprofile` 签名 over canonicalized-JSON + 每插件 sha256；任一字节修改即验签失败 |
| **MDM 服务器被替换** | `mdmProfileUrl` 锁 TLS + 返回内容仍需 `trustedPublicKeys` 验签 |
| **AdminConsole 被未授权打开** | 三路径统一检查 `admin` 权限；无权限账户的 `Ctrl+Shift+A` / `/admin` 都会静默拒绝 |
| **扩展点越权** | UI 贡献只能渲染，不能直接访问 IPC；能力贡献经 `ProviderHost` 二次包装后才暴露给壳 |
| **本地数据泄漏** | SQLCipher AES-256 + U-Key 硬件解锁；插件只能通过 `data-storage` provider 访问，无法直开 DB |
| **xss via Composer** | Composer 只接受文本 + 严格转义；`/` 和 `@` 命令解析走白名单 |

## 14. 故障排除

### 14.1 `Ctrl+Shift+A` 没反应

- 确认当前路由是 `/v2`（旧 `/` dashboard 未接全局快捷键）
- 确认当前账户有 `admin` 权限：`window.electronAPI.auth.whoami()` 返回含 `admin`
- 打开 DevTools 看 console 是否有 `registerSlashHandler` 报错

### 14.2 状态栏齿轮按钮不见

- `getStatusBarWidgets()` 是否返回 `admin-console:admin-shortcut`？若无，检查 `admin-console` 插件是否成功载入（`PluginManager.listPlugins()`）
- `resolveWidgetComponent("builtin:AdminShortcut")` 是否返回 null？若是，检查 `src/renderer/shell/widgets/index.ts` 是否被 AppShell 引入

### 14.3 企业 Profile 不生效

- `AdminConsole → 概览` 看当前 theme priority；若仍是 `chainlesschain-default@10`，profile 没解包成功
- 查主进程日志搜 `MDMManager.applyPinnedProfile` / `verifyProfileSignature`
- 确认 `config.json` 的 `trustedPublicKeys` 包含签发方 key

### 14.4 `/admin` 命令回车后无动作

- 检查 `getSlashCommands()` 是否包含 `{trigger: "/admin", handler: "builtin:openAdminConsole"}`
- 检查 `slash-dispatch` 是否注册过 `builtin:openAdminConsole`：`listRegisteredHandlers()` 应含此 id

### 14.5 构建卡在 chunk-size 警告

v6 壳本身不产生新警告；构建期 "Some chunks are larger than 500kB" 是预先存在的 Ant Design Vue + Pinia 打包特征，可忽略。

## 15. 关键文件

### 15.1 Shell 渲染器

```
desktop-app-vue/src/renderer/shell/
  AppShell.vue                # 三区主壳 + AdminConsole 挂载
  ShellSidebar.vue            # 左侧 spaces
  ConversationStream.vue      # 中间对话流
  ShellComposer.vue           # 输入框 + / + @
  ArtifactPanel.vue           # 右侧 artifact
  ShellStatusBar.vue          # 底部状态栏
  CommandPalette.vue          # Ctrl+K 全局搜索
  AdminConsole.vue            # 管理控制台模态
  slash-dispatch.ts           # P6 — slash handler 注册表
  widget-registry.ts          # P6 — widget component 注册表
  widgets/
    index.ts                  # 内置 widget 自动注册
    AdminShortcut.vue         # builtin:AdminShortcut 实现
```

### 15.2 主进程插件系统

```
desktop-app-vue/src/main/plugin-system/
  plugin-manager.js           # PluginManager + getPluginManager
  plugin-loader.js            # 内置 / registry / profile 三路加载
  plugin-registry.js          # 社区市场 registry client
  extension-point-registry.js # 7 UI × 5 provider 注册 + priority 选胜
  mdm-manager.js              # MDM profile 拉取 + 验签 + 解包
  profile-verifier.js         # ed25519 + sha256 校验
```

### 15.3 13 个内置插件

```
desktop-app-vue/src/main/plugins-builtin/
  chat-core/           notes/            spaces-personal/
  cowork-runner/       brand-default/    ai-ollama-default/
  auth-local/          data-sqlite-default/  crypto-ukey-default/
  compliance-default/  admin-console/    chain-gateway/
  did-core/
```

## 16. 使用示例

### 16.1 打开 AdminConsole 三路径

```
# 快捷键
Ctrl + Shift + A

# 命令
在 Composer 输入框键入: /admin  然后回车

# 状态栏
点击右下角齿轮图标 (tooltip: "管理控制台 (Ctrl+Shift+A)")
```

### 16.2 编写一个 slash 命令插件

`plugin.json`：
```json
{
  "id": "my-notes",
  "version": "1.0.0",
  "contributes": {
    "ui": {
      "slash": [
        {
          "trigger": "/note",
          "handler": "my-notes:createNote",
          "description": "快速新建笔记",
          "icon": "FileAddOutlined"
        }
      ]
    }
  }
}
```

渲染器代码：
```typescript
import { registerSlashHandler } from "@/shell/slash-dispatch";

registerSlashHandler("my-notes:createNote", async (ctx) => {
  // ctx.args 是 /note 后面的文本
  await window.electronAPI.notes.create({ title: ctx.args });
});
```

### 16.3 用 `.ccprofile` 换默认 LLM

1. 把企业 OpenAI-compatible 网关包装成插件 `ai-acme-gateway`（贡献 `provider.llm`，priority 100）。
2. 用 ed25519 私钥对 canonicalized-JSON profile 签名：
   ```bash
   cc profile build --out acme.ccprofile \
     --plugin ai-acme-gateway \
     --priority 100 \
     --sign-key company.pem
   ```
3. 分发 `acme.ccprofile` 给员工，客户端启动自动解包；AdminConsole → "概览" 可见 LLM provider 从 `ai-ollama-default@10` 切到 `ai-acme-gateway@100`。

### 16.4 通过 MDM 强制推送

企业 IT 在 `https://mdm.acme.corp/api/profile` 暴露签名后的 `.ccprofile`；客户端 `config.json` 里填 `mdmProfileUrl`，每次启动自动拉取校验。

## 17. 相关文档

- [设计文档 · 桌面版 UI 重构](/design/desktop-ui-refactor) — v0.3（P0–P6 完成）完整阶段规划 + 实现文件映射 + 验证记录
- [系统架构](/guide/architecture)
- [技术栈](/guide/tech-stack)
- [快速开始](/guide/getting-started)
- [社交协议生态](/guide/social-protocols) — v6 Shell 与 Nostr / Matrix / ActivityPub 桥的组合
- [CLI 命令行工具](/chainlesschain/cli) — 用 `cc profile build` / `cc profile verify` 构造和验证 `.ccprofile`

---

**版本历史**

| 版本 | 日期 | 说明 |
|---|---|---|
| v0.1 | 2026-03 | P0–P5 骨架 + 扩展点 + AdminConsole UI |
| v0.2 | 2026-04 | 企业覆盖链（Profile / MDM）全链打通 |
| v0.3 | 2026-04-20 | **P6 分发器 + Widget 注册表** — plugin 声明的 handler/component 真正接上行为 |
| v0.4 | 2026-04-20 | **P7–P9b 预览壳** — `/v6-preview` + 4 主题 + 4 颗去中心化入口 + 会话持久化 + 真 LLM 桥（58 新单测全绿）|
| v0.5 | 2026-04-20 | **测试回归闭环** — 92 单测 + 5 集成测 + `vue-tsc --noEmit` + `vite build` 全绿，E2E 按约定 `describe.skip`（见 §18.7）|
| v0.6 | 2026-04-30 | **桌面 web-shell Phase 0/1** — Electron 内嵌 ws-server + BrowserWindow 加载 web-panel dist；Phase 1.1 skill.list + fs dialogs handler + SystemSettings opt-in；Phase 1.4 forge 打包 vendor prep；详见 §19 |

---

## 18. P7–P9b 预览壳（`/v6-preview`）

`/v2` 是已合并主干的 V6 壳。与之并行的 `/v6-preview` 是 **Claude-Desktop 风格外观探索**，不替换任何现网入口，沿用 P6 `slash-dispatch` 分发器。设计文档见 [97 桌面版 UI · Claude-Desktop 重构](/design/modules/97-claude-desktop-refactor)。

### 18.1 P7 · 4 主题体系

| 主题 | 适用场景 |
|---|---|
| `dark` | 默认，低光环境 |
| `light` | 日间、演示 |
| `blue` | 品牌方蓝色 |
| `green` | 品牌方绿色 |

- 源：`src/renderer/stores/theme-preview.ts` Pinia store + `[data-theme-preview]` 属性驱动 + localStorage 持久化
- 非法主题值自动回退到 `dark`
- 4 颗左栏底部入口：P2P / Trade / Social / U-Key，分别绑定 `builtin:openP2P` / `openTrade` / `openSocial` / `openUKey` handler

### 18.2 P8 · 4 颗入口 → Preview Widget

| 入口 | Widget | 跳转目标（`/main/*`） |
|---|---|---|
| P2P | `P2pPreviewWidget.vue` | `P2PMessaging` / `device-pairing` |
| Trade | `TradePreviewWidget.vue` | `TradingHub` / `Marketplace` / `Contracts` |
| Social | `SocialPreviewWidget.vue` | `Chat` / `social-collab` / `SocialInsights` |
| U-Key | `UKeyPreviewWidget.vue` | `ThresholdSecurity` / `DatabaseSecurity` / `hsm-adapter` |

骨架统一为"概览 hero + kv 指标卡 + 2–3 按钮跳转完整页"，注册在 `shell-preview/widgets/index.ts`。点击入口打开 `ArtifactDrawer` 挂载对应 widget，`toggleArtifact` / `closeDrawer` 同步清理 `activeEntryId`。

### 18.3 P9a · 会话持久化

`useConversationPreviewStore`（`src/renderer/stores/conversation-preview.ts`）把预览壳的会话列表 + 消息 + 活跃 id 持久化到 `localStorage`：

- Key: `cc.preview.conversations`，schema `version: 1`
- 非法 version / 损坏 JSON / 非数组 conversations / `activeId` 指向不存在会话 → 自动 re-seed 欢迎会话
- Actions：`restore` / `select` / `createBlank` / `appendMessage` / `remove` / `clearAll` — 每次写操作立即 `_persist()` 到 localStorage

### 18.4 P9b · 真 LLM 桥

`src/renderer/shell-preview/services/llm-preview-bridge.ts` 薄桥：

- `isAvailable()` — 查 `window.electronAPI.llm.checkStatus()`
- `sendChat(messages)` — 调 `window.electronAPI.llm.chat({ messages, enableRAG:false, enableCache:false, ... })`，从 `{ content }` / `{ message:{ content } }` / `{ reply }` 三种返回形状提取文本
- `toBridgeMessages(history, nextUser?)` — `BubbleMessage[]` → `{role,content}[]`
- 任何失败（electronAPI 未就绪 / checkStatus 拒绝 / chat 抛错 / 返回空）都走 `BridgeResult = { ok: false, reason }` 兜底，不抛。

`AppShellPreview.sendDraft()`：追加用户气泡 → `isGenerating=true` → 调 bridge → 成功追加 assistant / 失败显示 `LLM 调用失败：${reason}` / 不可用显示 `LLM 服务不可用，请检查火山引擎/Ollama 配置` → `finally` 翻 `isGenerating=false`。typing 三点动画气泡（`data-testid="cc-preview-typing"`）+ 发送按钮 `loading` 态全流程联动。

### 18.5 P7–P9b 测试覆盖

| 测试文件 | 例数 |
|---|---|
| `stores/__tests__/theme-preview.test.ts` | 11 |
| `shell/__tests__/slash-dispatch.test.ts` | 8 |
| `shell-preview/widgets/__tests__/widget-registry.test.ts` | 5 |
| `stores/__tests__/conversation-preview.test.ts` | 15 |
| `shell-preview/services/__tests__/llm-preview-bridge.test.ts` | 19 |
| **合计** | **58 例全绿**（~15s，5 个测试文件） |

### 18.6 何时启用

- **`/v2`** — 当前稳定壳，P6 已合并，对公用户默认路由
- **`/v6-preview`** — Claude-Desktop 外观 + 4 主题 + 真 LLM 桥的预览路由，P9b 完成；面向开发者与早期试用

### 18.7 v5.0.2.34 测试回归（2026-04-20）

发布前完整回归，均在 Windows + Node 环境：

| 环节 | 命令 | 结果 |
|---|---|---|
| 单元测试（Shell + Preview + Stores） | `npx vitest run tests/unit/renderer/shell src/renderer/shell/__tests__ src/renderer/shell-preview/**/__tests__ src/renderer/stores/__tests__/theme-preview.test.ts src/renderer/stores/__tests__/conversation-preview.test.ts` | **92 / 92 全绿** · 9 个文件 · 25.97s |
| 集成测试（扩展点 × MDM） | `npx vitest run tests/integration/plugin-extension-points.integration.test.js` | **5 / 5 全绿** · 104ms |
| 类型检查 | `npx vue-tsc --noEmit` | **0 错误** |
| 渲染进程构建 | `npx vite build` | **成功** · `dist/renderer/index.html` 已产出 |
| E2E（`tests/e2e/v6-shell/admin-console.e2e.test.ts`） | — | **按约定 `describe.skip`**（等 `login()` 辅助函数预置 admin 权限后再开启）|

> 🟢 单测、集成、类型、构建四关无 bug 溢出；E2E 依赖项目未完成的 helper，跟随既有 skip 约定。本轮回归未触发任何代码修复。

### 18.8 v5.0.2.43 测试回归（2026-04-21）

Phase 3.3c 收尾 + Phase 3.4 软开关并入后的回归扩面。本轮把 5 个没有单测覆盖的 thin store 补齐，并顺带处理两个历史 drift：

| 环节 | 命令 | 结果 |
|---|---|---|
| 新增 store 单测 | `npx vitest run src/renderer/stores/__tests__/{rag,wallet,git-hooks,workflow-designer,analytics-dashboard}.test.ts` | **83 / 83 全绿**（rag 12 · wallet 13 · git-hooks 14 · analytics 20 · workflow 24） |
| Store 全量 | `npx vitest run src/renderer/stores/__tests__/` | **600 / 600 全绿** · 23 个文件 · 约 42s |
| 插件扩展点集成 | `npx vitest run tests/integration/plugin-extension-points.integration.test.js` | **13 / 13 全绿** |
| Phase 3.4 路由守卫 | `npx vitest run src/renderer/router/__tests__/v6-shell-default.test.ts` | **9 / 9 全绿** |
| 类型检查 | `npx vue-tsc --noEmit` | **0 错误** |
| E2E 结构检查 | `npm run test:e2e:check` | **66 / 66 结构正确** · 10 模块分组 |
| E2E Playwright 全量 | — | **本轮未执行**（需常驻 Electron runtime，留待 UI 走查）|

**Phase 3.3c 新增 store 对应关系**

| Store | 对应 Panel | 主要 IPC |
|---|---|---|
| `stores/rag.ts` | `shell/KnowledgeGraphPanel.vue` | `rag:get-stats` · `rag:rebuild-index` |
| `stores/wallet.ts` | `shell/WalletPanel.vue` | `wallet:get-all` · `wallet:set-default` |
| `stores/git-hooks.ts` | `shell/GitHooksPanel.vue` | `git-hooks:run-pre-commit` · `run-impact` · `run-auto-fix` · `get-config` · `set-config` · `get-history` · `get-stats` |
| `stores/workflow-designer.ts` | `shell/WorkflowDesignerPanel.vue` | `workflow:list` · `workflow:create` · `workflow:execute` · `workflow:step:*` 事件流 |
| `stores/analytics-dashboard.ts` | `shell/AnalyticsDashboardPanel.vue` | `analytics:get-dashboard-summary` · `get-time-series` · `get-top-n` · `export-{csv,json}` · `realtime-update` 事件流 |

**本轮 bug 修复**：

1. `src/renderer/utils/logger.ts:121` — `electronAPI.invoke('logger:write', ...)` 在 mock/未挂载场景下可能返回 `undefined`，直接 `.catch()` 会抛 `Cannot read properties of undefined (reading 'catch')` 污染测试日志。修复：用 `Promise.resolve(result).catch(...)` 包裹，兼容返回非 Promise 值。
2. `src/renderer/types/electron.d.ts` — `ElectronAPI` 接口缺 `config` 成员，但 `preload/index.js:367` 早已暴露该对象，`main.ts:69` 使用时触发 TS2339。修复：补齐 `ConfigAPI` 接口（`getAll / get / update / set / reset / exportEnv`）。

> 🟢 新增 83 单测 + 9 路由单测 + 13 集成全部通过；类型检查零错误；E2E 结构健康 80%。两处 drift 已在回归中暴露并修复。

---

## 19. 桌面 web-shell：Electron 内嵌 web-panel（Phase 0/1，2026-04-30）

桌面版与 V6 preview 壳并行新开一条实现路径：**Electron 主进程内嵌 ws-server，BrowserWindow 直接加载已经在浏览器里跑通的 `packages/web-panel/dist`**。这条路径让桌面与 `cc ui` 的 Web Panel 共用同一份渲染代码，桌面版独占的能力（U-Key、文件对话框、本地 SkillToolSystem）通过 ipcMain handler → ws-bridge 暴露给 web-panel。

### 19.1 路径选型

- **A 路（已起步）**：Electron 主进程拉起 `web-shell-bootstrap` → 起 `web-ui-loader`（HTTP 静态托管 web-panel dist）+ `ws-cli-loader`（沿用 `packages/cli/src/gateways/ws/ws-server.js`）+ `ws-bridge`（把 `ipcMain.handle` 透出成 WS topic）。BrowserWindow 直接 `loadURL` 到本地 HTTP。
- **B 路（按需引入）**：把 web-panel + ws-server 抽成共享包，让 desktop / cli ui 直接 `import` 同一份源码。Phase 0/1 暂未启用。

详见 design memo `desktop_web_shell_strategy.md` 与 `desktop_web_shell_multi_window_design.md`（多窗口架构同源 BrowserWindow + 共享 WS + role-based URL + geometry 持久化）。

### 19.2 Phase 0（HTTP+WS shell 起步）

| 模块 | 路径 | 作用 |
|---|---|---|
| `web-shell-bootstrap.js` | `desktop-app-vue/src/main/web-shell/` | 单入口拉起 web-ui-loader + ws-cli-loader + ws-bridge，给主进程 `index.js` 调用 |
| `web-ui-loader.js` | 同上 | 用 Node http 起本地静态服务，serve `packages/web-panel/dist`（开发态指向源码、生产态指向 vendor 目录） |
| `ws-cli-loader.js` | 同上 | 沿用 CLI 已有 `ws-server.js`；新增 WSSessionManager 自动实例化以支持 `session-*` topic |
| `ws-bridge.js` | 同上 | 把指定 ipcMain handler 透出成 WS 消息（envelope `{type, requestId, payload}`） |

### 19.3 Phase 1.1（首批 desktop-only handler）

- `handlers/skill-list-handler.js` — 桌面 SkillToolSystem 暴露 `skill.list`，让 web-panel `stores/skills.js` 拉到桌面态的 139 内置技能。
- `handlers/fs-handlers.js` — 桌面端 `dialog.showOpenDialog` / `dialog.showSaveDialog` 暴露给 web-panel，让浏览器里的"打开文件" / "另存为"按钮在桌面下走原生对话框。
- SystemSettings 新增"使用 Web Shell（实验）"开关，状态由 `settings-manager.js` 持久化，opt-in 后下次启动直接进 web-shell。
- `preload/web-shell.js` 桥出一个独立 `electronAPI` 命名空间，避免和 V6 preview 壳的 preload 冲突。

### 19.4 Phase 1.4（forge 打包 vendor prep）

- `scripts/prepare-web-shell-vendor.js` — 在 `forge.config.js` 的 `packagerConfig.afterCopy` 钩子里调用，把 `packages/web-panel/dist`（web-panel 构建产物）+ `packages/cli/src/gateways/ws/*` 等运行时所需文件复制进 `<buildPath>/../vendor/web-shell/`，路径数学单测覆盖（`tests/unit/scripts/phase1.4-path-math.test.js`，189 行）。
- 修复点：原版把 vendor 目录写到了 `buildPath` 内部（会被 forge 二次清理），现已校正回 `buildPath` 父目录。

### 19.5 顺带收尾

- `index.js` 改造：所有 web-shell 相关 ipc 集中走 web-shell-bootstrap，主窗口 `BrowserWindow` 默认 `titleBarStyle: 'hidden'` + 注入 CSS 清掉 native overlay 残留。
- `LoginPage.vue`：dev-credential hint 仅在非生产环境显示；登录成功后按 `ui.useV6ShellByDefault` 走 V6 hard-flip。
- `web-ui-server.js`：`.app-header` 强化 CSS 优先级以盖过 Ant Design Vue 默认值。

### 19.6 测试覆盖

| 测试文件 | 覆盖范围 |
|---|---|
| `web-shell-bootstrap.test.js` | bootstrap 顺序 + 启动/停止幂等 |
| `web-ui-loader.test.js` | HTTP 静态托管 + 路径解析 + 404 |
| `ws-cli-loader.test.js` | WS 启停 + WSSessionManager 自动实例化 |
| `ws-bridge.test.js` | envelope 协议 + ipcMain handler 透出 |
| `fs-handlers.test.js` | dialog 桥的成功/取消路径 |
| `skill-list-handler.test.js` | 桌面 SkillToolSystem 输出形状 |
| `phase0-smoke.cjs` | 端到端冒烟（HTTP 200 + WS handshake） |
| `tests/unit/scripts/phase1.4-path-math.test.js` | vendor 目录路径数学 |
| `tests/unit/scripts/prepare-web-shell-vendor.test.js` | afterCopy hook 真实文件复制 |

### 19.7 Phase 1.5 多窗口架构 MVP（2026-04-30 增量）

桌面 web-shell 的多窗口骨架已落 MVP：

- **`desktop-app-vue/src/main/window-registry.js`**（202 行）：role-based hash route + geometry 持久化的 WindowRegistry 骨架，同源多 BrowserWindow 由 role 标识统一管理，每个 role 的 size/position 都持久化到 `settings.json` 单独命名空间。
- **`desktop-app-vue/src/main/web-shell/handlers/window-open-handler.js`**（146 行）：新增 WS topic `window.open`，让 web-panel 渲染层可以通过 envelope `{type: "window.open", payload: { role, url, hash, options }}` 让主进程拉一个新 BrowserWindow，统一走 WindowRegistry 注入 geometry + 复用同源 ws-server。
- **测试覆盖**：`tests/unit/window-registry.test.js`（13）+ `web-shell/__tests__/window-open-handler.test.js`（13），共 26 例新单测全绿。

剩余工作：role catalog（约定哪些 role 可以打开 / 是否单例 / 默认大小）+ WindowRegistry 接 web-panel 真路由 + 多窗口 e2e。

> 后续 Phase 2/3：完整 IPC handler 迁移、多窗口共享 WS、与 V6 preview 壳并存到 Phase 3 末。

