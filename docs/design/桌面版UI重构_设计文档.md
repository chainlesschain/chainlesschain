# 桌面版 UI 重构设计文档

> 对话优先 + 插件化平台（面向个人办公 + 企业定制）

---

## 文档信息

| 项 | 内容 |
|---|---|
| 文档类型 | 设计文档（Design Document） |
| 模块 | desktop-app-vue（Electron + Vue 3） |
| 适用版本 | v5.0.2.x → v6.0 |
| 状态 | P0–P9c + Phase 3.3c / 3.4 落地 + 回归扩面全绿（Implementation Complete · Regression Green） |
| 最近更新 | 2026-04-21 |
| 关联文档 | `docs/design/系统设计_主文档.md`、`docs/guides/桌面版UI重构_用户指南.md` |

### 修订历史

| 版本 | 日期 | 作者 | 变更摘要 |
|---|---|---|---|
| v0.1 | 2026-04-20 | ChainlessChain 团队 | 初稿：三区对话壳 + 插件化平台 + 企业 Profile |
| v0.2 | 2026-04-20 | ChainlessChain 团队 | P0–P5 实现完成：7 UI + 2 Brand + 5 能力扩展点全部落地，Profile/MDM 端到端联调通过 |
| v0.3 | 2026-04-20 | ChainlessChain 团队 | P6：Slash 命令分发器 + 状态栏 Widget 注册表 + 内置 AdminShortcut；插件声明的 `handler`/`component` 现在会真正生效 |
| v0.4 | 2026-04-20 | ChainlessChain 团队 | P7–P9b：`/v6-preview` 预览壳 + 4 主题 + 4 颗去中心化入口 + 会话 localStorage 持久化 + `llm-preview-bridge` 桥接 `window.electronAPI.llm.chat` |
| v0.5 | 2026-04-20 | ChainlessChain 团队 | 发布前测试回归闭环：92 单测 + 5 集成测 + `vue-tsc --noEmit` + `vite build` 全绿；E2E 跟随既有 `describe.skip` 约定；本轮回归无 bug 溢出 |
| v0.6 | 2026-04-21 | ChainlessChain 团队 | Phase 3.3c 补齐 5 个 thin store 单测（rag / wallet / git-hooks / workflow-designer / analytics-dashboard，83 例）+ Phase 3.4 路由守卫 9 例 + 600 store 回归 + 13 plugin 扩展点集成全绿；修复两个 drift（`logger.ts` IPC `.catch()` 防御、`electron.d.ts` 补齐 `ConfigAPI` 类型） |

---

## 1. 概述

### 1.1 背景

`desktop-app-vue/` 当前已累积 **97 个 Vue 页面、51 个 Pinia Store、9 个路由分组**，功能覆盖 AI 对话、知识库、多智能体协作、DID 身份、P2P 消息、钱包交易、企业管理等。随着模块膨胀，出现以下问题：

1. **信息架构碎片化**：去中心化身份、P2P、ZKP、钱包等"王牌能力"散落在独立侧栏页面，无法贯穿日常动线。
2. **与 CLI / Web 面板定位重叠**：Web 面板已有 26 个轻量模块作为 CLI Runtime 的浏览器驾驶舱，桌面版 97 页多为其重型镜像。
3. **企业定制能力薄弱**：无插件化的品牌、主题、认证、存储、合规扩展点；企业无法在不改核心代码的前提下交付定制版本。
4. **差异化特性被埋没**：硬件级安全（U-Key）、DID、去中心化协作/交易/社交理应作为贯穿体验的基石，当前却作为独立页面被动展示。

### 1.2 目标

1. 将桌面版定位明确为**"个人办公主力客户端"**，以对话为主干、去中心化能力为动词、硬件安全为环境。
2. 将整个 UI 壳设计为**插件化平台**（类 VSCode / Backstage / Obsidian 模型），首批内置模块全部以 first-party 插件形式存在。
3. 为企业定制提供**Profile 分发机制**（品牌包 + 插件清单 + 策略 + 预置 Space），支持私有 Registry 和 MDM 下发。
4. **复用而非重写现有插件基建**：既有 CLI file-drop 插件系统与 Desktop DB-backed 插件系统将作为基础，通过增量扩展点方式升级。

### 1.3 范围

**纳入范围：**

- `desktop-app-vue/` 的渲染进程 UI 壳、路由、状态栏、输入框、Artifact 面板
- `desktop-app-vue/src/main/plugins/` 的扩展点注册表与 IPC 契约
- 企业 Profile 打包格式、私有 Registry 客户端、品牌覆盖层
- 97 个既有页面的分类归并或降级为插件的策略

**排除范围：**

- CLI (`packages/cli/`) 与 Web 面板 (`packages/web-panel/`) 的独立重构（仅共享插件契约，各自 UI 不在本文档内）
- 后端服务 (`backend/`) 的改动
- 移动端 (`mobile-app/`)
- 具体插件内部实现细节（另行立项）

### 1.4 术语

| 术语 | 含义 |
|---|---|
| Space | 个人空间，一组独立 RAG 知识库 + 提示词 + 联系人圈 + 权限策略（类比 Claude Projects） |
| Artifact | 对话中产生的可签名、可路由、可加密的去中心化对象（文档、签名、交易、P2P 线程、ZKP 凭证等） |
| Slash | 输入框 `/` 触发的动作面板（skills + CLI 命令的子集） |
| Mention | 输入框 `@` 触发的对象引用面板（联系人、笔记、交易、合约） |
| Profile | 企业可分发的定制包：品牌 + 插件清单 + 策略 + 预置 Space |
| Ambient Security | "环境级安全"——U-Key/DID/加密状态常驻界面，不作为独立页面 |
| First-party Plugin | 由 ChainlessChain 官方内置、与第三方插件同契约的核心模块 |

---

## 2. 现状分析

### 2.1 三端 UI 现状对照

| 维度 | CLI (`cc`) | Web 面板 | 桌面版（当前） |
|---|---|---|---|
| 入口规模 | 109 命令 | 26 视图 | 97 页 / 51 Store |
| 定位 | 脚本 / 自动化 | 轻量远程驾驶舱 | 功能最全，但臃肿 |
| 交互模型 | REPL + slash | 后台模块堆叠 | 侧栏驱动的多页应用 |
| 差异化能力 | headless | 即开即用 | 硬件调用、离线 RAG、系统集成 |

### 2.2 已有插件基建

| 层 | 文件 | 能力 |
|---|---|---|
| CLI 插件 | `packages/cli/src/lib/plugin-autodiscovery.js`、`plugin-ecosystem.js`、`commands/plugin.js` | 从 `~/.chainlesschain/plugins/` 自动扫描加载；契约：`{ name, tools, hooks, commands }` |
| 桌面插件 | `desktop-app-vue/src/main/plugins/plugin-manager.js`（1100+ LOC）、`plugin-api.js`（650+ LOC）、`plugin-loader.js`（430+ LOC）、`plugin-registry.js`、`plugin-ipc.js`、`plugin-sandbox.js` | DB 表 `plugins` 存储；8 个扩展点（已落地 `ui.page`/`ui.menu`/`ui.component`/`ai.function-tool`；4 个 stub） |
| Skill 加载器 | `src/main/ai-engine/cowork/skills/skill-loader.js` | 四层优先级：`bundled < marketplace < managed < workspace` |
| Marketplace UI | `PluginMarketplace.vue`、`PluginMarketplacePage.vue`、`PluginDetailPage.vue`、`InstalledPluginsPage.vue` | 分类、搜索、分页、安装管理 |
| DB Migration | `src/main/database/migrations/001_plugin_system.sql` | 7 表：plugins / permissions / dependencies / extensions / settings / event_logs / api_stats |

### 2.3 企业定制缺口

| 维度 | 缺失内容 |
|---|---|
| 品牌 | 无 logo / favicon / 应用名 / 登录页 / Design Token 覆盖机制 |
| 导航 | 插件页被关到 `/plugin/{id}/*`，无一级导航权 |
| Artifact | 硬编码渲染，不可扩展 |
| Slash / @ | 无统一入口，无扩展接口 |
| 认证 | 无插件化 `auth.provider`（LDAP / Azure AD / 企业 SSO） |
| 存储 / 加密 | 无 `data.storage` / `data.crypto` 扩展点以接企业 KMS / 对象存储 |
| 合规 | 无 `compliance.audit-sink`（SIEM）、`compliance.policy`（DLP / 分级 / 保留） |
| 多租户 | 无 `tenant.scope` 数据分区 |
| 分发 | 仅本地安装；无私有 Registry、无签名校验、无 Profile 打包 |

---

## 3. 总体设计

### 3.1 设计原则

1. **个人办公优先**：以"今日 / 空间 / 联系人 / Artifact"为主干，把 AI 当作驱动对象的手段，不是目的。
2. **对话即入口（Chat-first）**：参考 Claude Desktop，单列对话 + 右侧 Artifact 分屏，取消多层侧栏。
3. **环境级安全（Ambient Security）**：U-Key / DID / 加密常驻状态栏与输入框，不作为独立页面。
4. **去中心化做成动词**：发消息默认 P2P、存文件默认加密 + 可选 IPFS、签名默认硬件；用户不需跳模块。
5. **万物皆插件**：UI 壳只做平台，Chat / Notes / Wallet 等内置模块与第三方插件同契约。
6. **企业通过 Profile 定制**：不改核心代码，通过可分发包覆盖品牌、插件、策略、预置内容。

### 3.2 架构总览

```
┌───────────────────────────────────────────────────────────────────┐
│                       Desktop Shell (极简壳)                        │
│   ┌─────────────┬─────────────────────────┬───────────────────┐   │
│   │  左导航      │   中对话流（主角）        │  右 Artifact       │   │
│   │  (Spaces /   │   (Chat + Composer)     │  (动态渲染)         │   │
│   │   联系人 /   │                          │                    │   │
│   │   今日)      │                          │                    │   │
│   └─────────────┴─────────────────────────┴───────────────────┘   │
│   Status Bar: [U-Key] [DID] [P2P] [LLM] [Cost] [Tenant]             │
├───────────────────────────────────────────────────────────────────┤
│                    扩展点注册表 (Extension Registry)                 │
│  ui.space │ ui.artifact │ ui.slash │ ui.mention │ ui.status-bar ... │
│  ai.tool  │ ai.skill-pack │ data.storage │ data.crypto │ auth.*    │
│  brand.*  │ compliance.* │ tenant.scope                              │
├───────────────────────────────────────────────────────────────────┤
│                   Plugin Manager + Sandbox + IPC                    │
├───────────────────────────────────────────────────────────────────┤
│        First-party Plugins         │      Third-party / Enterprise  │
│  chat-core · spaces · notes · ...  │  org-sso · brand-xx · kms-xx   │
└───────────────────────────────────────────────────────────────────┘
```

### 3.3 信息架构

```
Shell
├─ 左栏
│  ├─ 新会话
│  ├─ 今日 (ui.home-widget 聚合：待办、未读 P2P、钱包动态、AI 晨会)
│  ├─ Spaces (ui.space 模板：工作 / 财务 / 社交 / 学习 / 自定义)
│  └─ 联系人 (DID 圈子)
├─ 中栏：单列对话流 + 输入框 (Slash + Mention + Composer Slot)
├─ 右栏：Artifact 面板（按需展开，生成时自动展开）
└─ 状态栏：ui.status-bar 小组件聚合
```

### 3.4 核心概念

**Spaces**：每个 Space 是一个带独立 RAG / 提示词 / 联系人圈 / 权限 / 默认钱包的"身份上下文"。切 Space 即切身份。

**Artifacts**：对话中产生的对象。与 Claude Desktop 的代码 / 文档 Artifact 不同，ChainlessChain 的 Artifact 是**可签名、可路由、可加密**的去中心化对象：

| Artifact 类型 | 触发 | 可执行动作 |
|---|---|---|
| Note / Doc | AI 生成文档 | 存本地 / 发 IPFS / 共享给 DID |
| Signed Message | 起草声明 | U-Key 签名 / 发布到社区 |
| Transaction | "给 Alice 转 100" | 预览 → U-Key 签 → 广播 |
| P2P Thread | "联系 Bob" | 展开聊天线程 |
| Credential (VC / ZKP) | "证明我 >18 岁" | 生成 ZKP → 发给验证方 |
| Knowledge Graph | "梳理这些笔记" | 可视化 / 回填 Space RAG |

**Slash / Mention**：统一交互入口，取消深菜单查找。
- `/` = 动作（138 skills + 109 CLI 命令子集）
- `@` = 对象引用（联系人、笔记、交易、合约）

---

## 4. 详细设计

### 4.1 Shell 组件结构

| 组件 | 职责 | 扩展点 |
|---|---|---|
| `AppShell.vue` | 三区布局、快捷键、Command Palette 触发 | — |
| `Sidebar.vue` | 会话列表、Spaces、联系人、今日入口 | `ui.home-widget`、`ui.space` |
| `ConversationStream.vue` | 消息列表、DID Chip、流式渲染 | `ui.component`（消息内嵌） |
| `Composer.vue` | 输入框、附件、Slash、Mention、Composer Slot | `ui.slash`、`ui.mention`、`ui.composer-slot` |
| `ArtifactPanel.vue` | 右栏 Artifact 渲染 + 动作栏 | `ui.artifact` |
| `StatusBar.vue` | 底部状态栏（U-Key / DID / P2P / LLM / Cost） | `ui.status-bar` |
| `CommandPalette.vue` | `Ctrl+K` 全局面板 | 汇总 `ui.slash` + 系统命令 |

### 4.2 扩展点清单

在既有 8 个扩展点的基础上新增 / 升级如下：

#### 4.2.1 UI 层

| 扩展点 | 状态 | 说明 |
|---|---|---|
| `ui.page` | ✅ 已有（升级） | 允许进入一级导航，新增 `nav: "primary" \| "plugin"` 字段 |
| `ui.menu` | ✅ 已有 | 保持不变 |
| `ui.component` | ✅ 已有 | Slot 注入，保持不变 |
| `ui.space` | ★ 新增 | 注册 Space 模板（RAG 预设 + 提示词 + 联系人圈 + 权限） |
| `ui.artifact` | ★ 新增 | Artifact 类型 + 渲染器 + 动作按钮 |
| `ui.slash` | ★ 新增 | `/` 命令注册 |
| `ui.mention` | ★ 新增 | `@` 自动补全源注册 |
| `ui.status-bar` | ★ 新增 | 状态栏小组件（U-Key 指示灯本身使用该扩展） |
| `ui.home-widget` | ★ 新增 | 今日页卡片 |
| `ui.composer-slot` | ★ 新增 | 输入框行内槽（签名 UI、成本估算） |

#### 4.2.2 能力层

| 扩展点 | 状态 | 说明 |
|---|---|---|
| `ai.function-tool` | ✅ 已有 | 保持不变 |
| `ai.llm-provider` | ⚠ stub → 落地 | 接入第三方 LLM |
| `ai.skill-pack` | ★ 新增 | 打包一组 Skill 作为插件（桥接 SkillLoader） |
| `data.importer` | ⚠ stub → 落地 | 数据导入 |
| `data.exporter` | ⚠ stub → 落地 | 数据导出 |
| `data.storage` | ★ 新增 | 本地 / IPFS / S3 / 企业对象存储 |
| `data.crypto` | ★ 新增 | 软件 / U-Key / 企业 KMS / HSM |
| `auth.provider` | ★ 新增 | LDAP / Azure AD / 企业 SSO |
| `net.transport` | ★ 新增 | P2P / 企业内网 / 代理 |
| `lifecycle.hook` | ⚠ stub → 落地 | 启动 / 关闭钩子 |

#### 4.2.3 企业 / 品牌层

| 扩展点 | 状态 | 说明 |
|---|---|---|
| `brand.theme` | ★ 新增 | Design Token + 配色 + 字体覆盖 |
| `brand.identity` | ★ 新增 | logo / favicon / 应用名 / 登录页 |
| `compliance.audit-sink` | ★ 新增 | 审计事件外发（SIEM / Splunk） |
| `compliance.policy` | ★ 新增 | DLP / 分级 / 保留策略 |
| `tenant.scope` | ★ 新增 | 组织 / 团队 / 部门维度数据分区 |

### 4.3 插件契约

```jsonc
{
  "id": "string, unique",
  "name": "string",
  "version": "semver",
  "vendor": "string",
  "requires": {
    "cc": ">=5.0.2",
    "ukey": "optional | required | none"
  },
  "permissions": ["llm:query", "storage:write", "network:p2p", "crypto:sign"],
  "contributes": {
    "spaces":      [{ "id": "string", "template": "object" }],
    "artifacts":   [{ "type": "string", "renderer": "ref", "actions": "array" }],
    "slash":       [{ "trigger": "string", "handler": "ref" }],
    "mentions":    [{ "prefix": "string", "source": "ref" }],
    "pages":       [{ "route": "string", "nav": "primary|plugin" }],
    "tools":       ["..."],
    "skills":      ["..."],
    "theme":       { "tokens": "object", "logo": "path", "loginPage": "ref" },
    "auth":        { "providerId": "string", "strategy": "ref" },
    "storage":     { "id": "string", "adapter": "ref" },
    "crypto":      { "id": "string", "adapter": "ref" },
    "statusBar":   ["..."],
    "homeWidget":  ["..."],
    "composerSlot":["..."]
  }
}
```

既有 DB 表基本可复用，`extensions` 表需扩展 `type` 枚举以容纳新扩展点。

### 4.4 First-party 插件拆分

当前 97 页按职责归并为以下内置插件（每个插件独立 semver、可独立启用 / 禁用）：

| 插件 ID | 覆盖的旧页 |
|---|---|
| `chat-core` | AIChatPage / SessionManagerPage |
| `spaces-personal` | HomePage / ProjectsPage（合并） |
| `notes` | KnowledgeListPage / KnowledgeDetailPage |
| `rag-local` | KnowledgeGraphPage（数据层） |
| `memory-instinct` | MemoryDashboardPage / PermanentMemoryPage |
| `cowork-runner` | CoworkDashboard / CoworkAnalytics |
| `did-identity` | DIDManagement / IdentityLinkingPage |
| `p2p-messaging` | P2PMessaging / FriendsPage / ChannelPage |
| `wallet` | Wallet / TradingHub / HardwareWalletPage |
| `ukey-crypto` | — （状态栏 + Composer Slot） |
| `ipfs-storage` | （作为 `data.storage` 插件实现） |
| `audit-local` | EnterpriseAuditPage |
| `skills-manager` | SkillManager |
| `mcp-manager` | MCPSettings / MCPServerMarketplace |
| `plugin-manager` | PluginMarketplace 等 |

剩余低频页在 P4 阶段评估下线或归并。

---

## 5. 企业定制方案

### 5.1 Enterprise Profile

Profile 是**可分发的定制单元**，打包为 `.ccprofile`（zip）：

```
my-enterprise.ccprofile
├─ profile.json         # 元数据：id、版本、目标渠道、强制度
├─ plugins/             # 启用 / 禁用 / 替换清单 + 插件包
├─ brand/               # logo、loading、字体、theme-tokens.json、登录页
├─ policies/            # DLP 规则、保留策略、审计目标
├─ spaces/              # 预置 Space 模板（如"法务"、"财务审批"）
├─ skills/              # 企业专属 Skill 包
└─ signature.asc        # 签名（企业分发强制）
```

### 5.2 分发路径

| 场景 | 方式 |
|---|---|
| 个人用户 | 公有 Marketplace，纯插件，不用 Profile |
| 小企业试用 | 从 URL 导入 Profile，签名校验通过后启用 |
| 大企业 | 私有 Registry（管理员配置），MDM 下发 `.ccprofile`，启动强制加载 |
| 开发联调 | `cc plugin link ./my-plugin` 或 `--profile ./dev.ccprofile` 热重载 |

### 5.3 Profile 强制度

| 模式 | 行为 |
|---|---|
| `overlay`（默认） | 覆盖默认值，用户可另行启用公有插件 |
| `exclusive` | 仅允许 Profile 内的插件；禁用公有 Marketplace |
| `locked` | 用户无权切 Space、禁用插件、修改主题 |

### 5.4 管理员控制台

作为系统插件 `admin-console` 交付：
- 租户 / 组织 / 团队管理
- 插件白 / 黑名单
- 策略编辑器（DLP / 分级 / 保留）
- 审计事件查看 / 导出
- 强制 Profile 切换

---

## 6. 安全设计

| 风险 | 措施 |
|---|---|
| 恶意插件访问 U-Key | 默认禁用 `crypto:sign`；首次调用需**硬件确认**（非对话框） |
| 数据外泄 | `data.storage` / `net.transport` 插件需显式声明出境域名；`compliance.policy` 可拦截 |
| 供应链攻击 | 企业 Profile 强制签名；公有 Marketplace 沿用既有 `plugin-ecosystem v2` 启发式审查，未来接入 LLM 审查 |
| 权限滥用 | 细粒度 RBAC + 首次调用确认 + 审计日志；组织级可禁用特定权限 |
| 插件升级破坏 | 每插件独立 semver；Profile pin 版本；灰度回滚 |
| 沙箱逃逸 | 复用 `PluginSandbox`；UI 插件强制 iframe / Shadow DOM 隔离（新增） |

---

## 7. 与其他端的关系

| 维度 | CLI | Web 面板 | 桌面版 |
|---|---|---|---|
| 插件内核 | 已有 file-drop | 继承桌面插件子集（无 UI.composer-slot 等） | 完整新内核 |
| 共享扩展点 | `ai.*`、`data.*`、`net.*`、`auth.*`、`compliance.*` | 同左 | 同左 |
| 专属扩展点 | REPL 命令 | 轻量 UI 槽 | 全量 UI 槽 + 硬件 |

**一次编写能力类插件，三端可用**；UI 类插件仅在支持的端生效。

---

## 8. 迁移方案

| 阶段 | 交付内容 | 风险 | 依赖 |
|---|---|---|---|
| **P0** | `AppShell`（三区） + 新扩展点注册表（`ui.status-bar` / `ui.home-widget` / `ui.artifact` / `ui.slash` / `ui.mention` / `ui.space` / `ui.composer-slot`） + Command Palette；旧页面挂成懒路由保留 | 低 | — |
| **P1** | Chat / Notes / Spaces / Cowork-Runner 改写为 first-party 插件，验证契约 | 中 | P0 |
| **P2** | Artifact 框架 + 5 种核心 Artifact（Note / Sign / TX / P2P / VC），签名内联化 | 中 | P1 |
| **P3** | `brand.theme` / `brand.identity` + Profile 打包器 + 私有 Registry 客户端 | 中 | P2 |
| **P4** | `auth.provider` / `data.storage` / `data.crypto` / `compliance.*` 插件化；落地 `ai.llm-provider` stub | 高 | P3，需硬件 / KMS 回归 |
| **P5** | `admin-console` 插件 + 企业 MDM 集成 + 下线重复旧页 + Design Token 统一 | 中 | P4 |
| **P6** | Slash 命令分发器 + 状态栏 Widget 组件注册表 + `builtin:AdminShortcut`；插件声明的 `handler` / `component` 字符串现在能被真正执行 | 低 | P5 |
| **P7** | Claude Desktop 风格外观重塑：左栏改为 Space 分组的"会话历史列表"+ 固化 4 颗"去中心化"入口（P2P / Trade / Social / U-Key），中区留白气泡对话，右区改为 Artifact 抽屉式（从右滑入），移植 Web Panel 4 主题（dark/light/blue/green）。新路由 `/v6-preview` 与 `/v2` 并存，不替换任何现网入口 | 低 | P6 |

P0 完成后可得到"类 Claude Desktop"观感；P3 完成后具备企业定制交付能力；P6 完成后插件贡献的动作点击/快捷键即可真正触发行为；**P7 完成后桌面版与 Claude Desktop 的外观对齐，并在左栏底部永远固化去中心化四大差异化能力入口**。每阶段独立可发版，不阻塞 CLI / Web 面板迭代。

### 8.1 实现落点一览（P0–P6）

| 阶段 | 关键文件 / 目录 | 备注 |
|---|---|---|
| P0 | `src/renderer/shell/` (AppShell / Sidebar / Composer / StatusBar / ArtifactPanel / ConversationStream) + `src/main/plugins/plugin-manager.js`（7 个 v6 扩展点） | 路由 `/v2` 预览 |
| P1 | `src/main/plugins-builtin/{chat-core,notes,spaces-personal,cowork-runner}/plugin.json` | 通过 `loadFirstPartyPlugins()` 加载 |
| P2 | `src/renderer/types/artifact.ts` + `src/renderer/stores/artifacts.ts` + `src/renderer/shell/artifacts/*.vue` | 7 种渲染器 + U-Key 签名占位 |
| P3 | `src/main/enterprise/profile-packager.js` + `src/main/enterprise/registry-client.js` + `src/renderer/shell/theme-applier.ts` | ed25519 + sha256 + 私有 Registry |
| P4 | `src/main/plugins-builtin/{ai-ollama-default,auth-local,data-sqlite-default,crypto-ukey-default,compliance-default}/plugin.json` | 5 个能力默认 stub |
| P5 | `src/main/plugins-builtin/admin-console/` + `src/renderer/shell/AdminConsole.vue` + `src/main/enterprise/mdm-manager.js` + `src/renderer/shell/design-tokens.css` | Ctrl+Shift+A 打开 |
| P6 | `src/renderer/shell/slash-dispatch.ts` + `src/renderer/shell/widget-registry.ts` + `src/renderer/shell/widgets/{AdminShortcut.vue,index.ts}` | 13 first-party 插件共用同一分发与注册机制 |
| P7 ✅ | `src/renderer/shell-preview/{AppShellPreview,ConversationList,DecentralEntries,ArtifactDrawer}.vue` + `themes.css` + `src/renderer/stores/theme-preview.ts` + 路由 `/v6-preview` | 已落地，详见 [`docs/design/modules/97_桌面版UI_ClaudeDesktop重构计划.md`](./modules/97_桌面版UI_ClaudeDesktop重构计划.md)；单测：`stores/__tests__/theme-preview.test.ts`（11 例）+ `shell/__tests__/slash-dispatch.test.ts`（8 例）|

### 8.2 验证

- **单元测试**：`tests/unit/renderer/shell/{slash-dispatch,widget-registry,AdminShortcut,AppShell.interaction}.test.ts` — 17 例覆盖注册 / 触发 / 键盘快捷键 / 覆盖语义。
- **集成测试**：`tests/integration/plugin-extension-points.integration.test.js` — 把一个 priority=100 的 `acme-override` 插件放到 `mdmExtractDir`，验证 `getActiveBrandTheme()` / `getActiveLLMProvider()` 返回的正是该高优先级贡献。
- **E2E 占位**：`tests/e2e/v6-shell/admin-console.e2e.test.ts` 遵循项目 `describe.skip` 约定，等 E2E helper 提供带 admin 权限的登录后启用。
- **端到端烟雾**（P5 阶段）：合成 Acme 品牌插件 → `.ccprofile` pack → 假 MDM server 指派 → `MDMManager.applyPinnedProfile()` 解包 → `PluginManager` 加载 → `getActiveBrandTheme()` 返回 `acme-corporate@100`，日志显示 `registered themes (desc priority): acme-corporate@100 > chainlesschain-default@10`。

---

## 9. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| 97 页同时重构成本高 | 阻塞日常迭代 | P0 不动旧页，以挂载方式渐进替换 |
| 插件契约迭代不兼容 | 社区 / 企业插件失效 | 契约 semver 化；`plugin-manager v2` 与 v1 并存一个大版本 |
| 企业 Profile 签名信任链未建立 | 供应链风险 | 与现有 `plugin-ecosystem v2` 的 ecogov-v2 治理集成 |
| U-Key 硬件回归测试成本 | P4 进度风险 | 尽早与 `ukey-crypto` 插件联调，准备模拟器 |
| 多租户数据库改造 | DB 迁移复杂 | P4 之前租户字段默认 `default`；不强制多租户 |

---

## 10. 待决事项

| # | 待决问题 | 需输入方 |
|---|---|---|
| 1 | 品牌覆盖深度：仅换 logo / 配色，还是允许换整套布局？ | 产品 |
| 2 | Profile 强制度默认值：`overlay` / `exclusive` / `locked`？ | 产品 + 企业客户 |
| 3 | 多租户：单机多租户 vs 每设备单一租户？ | 架构 |
| 4 | 公有 Marketplace 默认开启策略？企业版是否强制私有 Registry？ | 安全 |
| 5 | `plugin-manager` 升级：增量扩展（兼容旧）vs 立 v2 契约（干净但需迁移）？ | 工程 |

---

## 附录 A：目录约定（提议）

```
desktop-app-vue/
├─ src/
│  ├─ main/
│  │  └─ plugins/
│  │     ├─ plugin-manager.js          # 既有，增量升级
│  │     ├─ extension-registry.js      # 新增：统一扩展点注册
│  │     └─ profile-loader.js          # 新增：Profile 加载与校验
│  └─ renderer/
│     ├─ shell/                        # 新增：AppShell / Sidebar / Composer ...
│     ├─ plugins-builtin/              # 新增：first-party 插件源
│     └─ views/                        # 既有 97 页（渐进迁移）
└─ profiles/
   └─ default.ccprofile                # 默认 Profile
```

## 附录 B：相关文档

- 用户指南：`docs/guides/桌面版UI重构_用户指南.md`
- 系统设计主文档：`docs/design/系统设计_主文档.md`
- 安全机制：`docs/design/安全机制设计.md`
- 既有插件实现：`desktop-app-vue/src/main/plugins/`
