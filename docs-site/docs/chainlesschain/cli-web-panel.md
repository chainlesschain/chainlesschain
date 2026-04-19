# Vue3 Web 管理面板 (ui -- v5.0.2.12)

> **版本**: v5.0.2.12 | 参考 [ClawPanel](https://github.com/qingchencloud/clawpanel) 设计，构建为独立 Vue3 前端应用。

> **v5.0.2.6 起**：通过 `npm install -g chainlesschain` 安装的用户**无需手动构建**，面板已内置于包中，直接运行 `chainlesschain ui` 即可。

## 概述

`chainlesschain ui` 启动一个本地 HTTP 服务器，提供基于 Vue3 + Ant Design Vue 的 Web 管理面板。面板通过 WebSocket 连接到 `chainlesschain serve` 的 WS 服务端，将 CLI 的全部能力以可视化界面呈现，无需记忆命令行语法即可完成 AI 对话、技能管理、LLM 配置、安全管理、P2P 网络等操作。

面板包含 23 个功能模块，支持 4 种颜色主题（深色/浅色/海蓝/绿野），并根据运行目录自动区分项目级和全局两种工作模式。

## 核心特性

- **23 个功能模块**: 覆盖仪表板、AI 对话、技能管理、LLM 配置、服务状态、运行日志、笔记管理、MCP 工具、记忆系统、定时任务、后台任务、安全中心、P2P 网络、Git 与数据、项目管理、钱包管理、组织管理、使用分析、模板中心、权限管理、RSS 订阅、备份恢复、身份认证
- **4 种颜色主题**: 通过 CSS 自定义属性驱动，主题偏好自动持久化到 localStorage
- **实时 WebSocket 连接**: 指数退避自动重连，`waitConnected` 保证首次连接就绪后再发送请求
- **响应式设计**: 七组侧边栏导航，适配不同屏幕尺寸
- **项目级 / 全局模式**: 自动检测当前目录是否含 `.chainlesschain/`，切换对应的工作模式
- **流式 AI 对话**: 支持 Chat/Agent 双模式，逐 token 流式渲染，工具调用可视化
- **Markdown 渲染**: marked.js + highlight.js 实现代码高亮
- **纯函数解析层**: `parsers.js` 集中处理技能/状态/笔记/MCP/记忆/Cron 等数据的解析逻辑

## 系统架构

```
浏览器 (Vue3 SPA)
    │
    ├── HTTP GET (静态资源)
    │       ▼
    │   ┌───────────────────────┐
    │   │  HTTP Server          │
    │   │  (web-ui-server.js)   │
    │   │  ├── 静态文件服务      │
    │   │  └── 运行时配置注入    │
    │   └───────────────────────┘
    │
    └── WebSocket (ws://127.0.0.1:18800)
            ▼
        ┌───────────────────────┐
        │  WS Server            │
        │  (ws-server.js)       │
        │  └── CLI Runtime      │
        └───────────────────────┘
```

- **HTTP Server** (`web-ui-server.js`): 提供 Vue3 构建产物的静态文件服务，启动时将 WS 端口、token、项目路径等运行时配置注入到 HTML 页面的 `window.__CC_CONFIG__` 中
- **WS 连接** (`ws.js` store): 浏览器端通过 WebSocket 连接到 CLI 的 WS 服务端，所有命令执行和数据获取都通过 WS 协议完成
- **Pinia Stores**: `ws.js`（连接管理）、`theme.js`（主题）、`chat.js`（会话）、`skills.js`（技能）、`providers.js`（LLM）、`tasks.js`（任务）、`dashboard.js`（统计）
- **三路面板检测**: 优先使用 `--web-panel-dir` 指定目录，其次查找源码构建产物 `packages/web-panel/dist/`，最后使用 npm 包内置产物 `src/assets/web-panel/`，全部未找到时回退到经典单页 HTML

`chainlesschain ui` 现已升级为完整的 Vue3 管理面板，包含 **23 个功能模块**，支持 **4 种颜色主题**，并清晰区分项目级和全局两种工作模式。

## 快速开始

```bash
# npm 安装用户：直接启动，无需构建
chainlesschain ui

# 项目级面板（在含 .chainlesschain/ 的目录下运行）
cd /your/project
chainlesschain ui

# 全局面板（任意目录）
chainlesschain ui

# 高级选项
chainlesschain ui --port 9000 --ws-port 9001
chainlesschain ui --token mysecret
chainlesschain ui --web-panel-dir /custom/dist   # 指定 dist 目录
```

启动后访问：`http://127.0.0.1:18810`

## 二十三个功能模块

侧边栏分七组：**概览**（仪表板/对话/服务/日志）、**配置**（技能/LLM 配置/MCP 工具）、**数据**（笔记/记忆/定时任务/后台任务）、**高级**（安全中心/权限管理/P2P 网络/备份同步/Git 与数据/项目管理）、**企业**（钱包管理/组织管理/使用分析/模板中心）、**扩展**（RSS 订阅/身份认证）。

### 🏠 仪表板 (Dashboard)

- **4 个状态卡片**：WebSocket 连接、活跃 LLM、技能数量、AI 会话数
- **项目/全局差异化展示**：项目模式显示蓝色项目信息卡片，全局模式显示紫色引导提示
- 快速操作按钮（新建对话、浏览技能、LLM 配置）
- 运行信息表格（端口、认证状态、版本）

### 💬 AI 对话 (Chat)

- **Chat / Agent 双模式**切换
- **流式响应渲染**：逐 token 显示 + 打字光标动画
- **工具调用可视化**：折叠卡片展示 input/output
- **交互式 Q&A**：选项按钮或自由输入框
- **Markdown + 代码高亮**（marked.js + highlight.js）
- 左侧会话列表，支持历史切换

### 🧩 技能管理 (Skills)

- 138+ 技能分类浏览（CLI / Agent / LLM / 混合 / 内置）
- 搜索框实时过滤
- 执行模式标签一目了然
- "运行"按钮 → 跳转 Chat 视图并执行 `/skill run <name>`

### 🔌 LLM 配置 (Providers)

- **10 个 Provider 可视化**（Anthropic、OpenAI、Ollama、DeepSeek、Gemini、火山引擎、通义千问、Kimi、MiniMax、Mistral）
- 活跃 Provider 绿色高亮边框 + "活跃"标签
- 一键切换活跃 Provider
- 连接测试
- Ollama 本地模型列表

### 🐳 服务状态 (Services)

- Docker 服务启停操作
- 端口状态一览（Vite、Signaling、WS Server 等）
- 服务健康状态实时显示

### 📋 运行日志 (Logs)

- 多颜色行分类（错误红、成功绿、警告黄、缩进灰）
- 实时刷新
- 关键字过滤

### 📝 笔记管理 (Notes)

- 笔记列表浏览（标题、标签、预览）
- 搜索与过滤
- 新建、查看、删除笔记

### 🔧 MCP 工具 (MCP Tools)

- MCP 服务器列表（名称、命令、描述）
- 每台服务器的工具列表
- 工具搜索

### 🧠 记忆系统 (Memory)

- 三层记忆统计（短期 / 长期 / 核心）
- 记忆条目列表浏览
- 记忆层切换

### ⏰ 定时任务 (Cron)

- 定时任务列表（名称、Cron 表达式、启用状态）
- 启用/禁用切换
- 手动执行

### ⚡ 后台任务 (Tasks)

- 任务列表浏览（状态、进度）
- 任务详情查看
- 任务历史分页
- 实时 `task:notification` 接收
- 任务停止操作

### 🔒 安全中心 (Security)

- **DID 身份管理**：身份列表、创建新 DID、默认标记、签名验证弹窗
- **文件加解密**：AES-256-GCM 加密/解密，文件路径输入
- **审计日志**：事件列表（管道分隔/时间戳前缀两种格式）、统计卡片
- 命令：`did list/create/sign`、`encrypt/decrypt file`、`audit log/stats`

### 📡 P2P 网络 (P2P)

- **设备列表**：Peer ID、名称、在线/离线状态
- **配对设备**：设备名称输入、确认弹窗
- **发送消息**：选择 Peer、消息输入
- **同步状态**：在线/离线、待同步数、推送/拉取操作
- 命令：`p2p peers/pair/send`、`sync status/push/pull`

### 🔀 Git 与数据 (Git)

- **Git 仓库**（Tab 1）：分支显示、变更文件计数、自动提交（带确认弹窗）
- **导入导出**（Tab 2）：Markdown/PDF/Evernote 导入、静态站点导出
- 命令：`git status/auto-commit`、`import markdown/pdf/evernote`、`export site`

### 📁 项目管理 (Projects)

- **项目状态卡片**：系统运行状态、LLM 提供商、初始化状态、配置加载
- **6 个项目模板**：code-project、medical-triage、agriculture-expert、general-assistant、ai-media-creator、ai-doc-creator
- **环境诊断**：`doctor` 命令输出
- 命令：`status`、`config list`、`init --template`、`doctor`

### 💰 钱包管理 (Wallet)

- **钱包列表**：地址、名称、默认标记、余额
- **资产管理**：Token/NFT/数据资产注册与查看
- **转账历史**：转账操作、交易记录分页
- 命令：`wallet list/create/set-default/assets/transfer/history --json`

### 🏢 组织管理 (Organization)

- **组织列表**：创建组织、详情查看
- **成员管理**：邀请、角色分配（admin/member/viewer）、团队管理
- **审批管理**：提交、批准、拒绝审批请求
- 命令：`org list/create/show/members/invite/teams/approvals --json`

### 📊 使用分析 (Analytics)

- **Token 用量统计**：按时段筛选（今天/本周/本月/全部）
- **Provider 分布表**：按 provider/model 切片的调用量与成本
- **缓存状态**：命中数、节省 Token 数、过期清理
- 命令：`tokens show/breakdown/recent/cache --json`

### 📋 模板中心 (Templates)

- **9 个项目模板**：一键初始化（code-project、medical-triage 等）
- **BI 模板**：从 CLI 动态加载
- **Prompt 模板**：localStorage 持久化，支持分类与复制
- 命令：`init --template`、`bi templates --json`

### 🔐 权限管理 (Permissions)

- **RBAC 角色列表**：角色、权限标签、用户数
- **权限检查**：输入用户 ID 与权限名快速验证
- **审计日志**：事件列表与统计卡片
- 命令：`auth roles/check`、`audit log/stats --json`

### 📰 RSS 订阅 (RssFeed)

- **订阅源管理**：添加/刷新/删除 RSS 源
- **文章阅读**：按源筛选、可展开摘要、标记已读
- **统计卡片**：订阅数、文章数、未读数、最后刷新
- 命令：`rss add/list/articles/refresh/remove --json`

### 💾 备份恢复 (Backup)

- **备份管理**：创建备份、备份列表、一键恢复
- **数据同步**：同步状态、推送/拉取、冲突管理
- **IPFS 存储**：节点状态、文件固定/取消固定
- 命令：`backup create/list/restore`、`sync status/push/pull`、`ipfs status/pins --json`

### 🔑 身份认证 (WebAuthn)

- **WebAuthn 凭证**：注册、列表、删除
- **SSO 配置**：OIDC/SAML/LDAP 提供商设置
- **双因素认证**：TOTP 启用/禁用、恢复码生成
- 命令：`webauthn list/register/delete`、`sso status`、`auth 2fa enable/disable --json`

## 颜色主题

面板支持 4 种颜色主题，可在顶部导航栏右上角切换：

| 主题 | 图标 | 特点 |
|------|------|------|
| 深色 (Dark) | 🌑 | 默认主题，深灰背景 |
| 浅色 (Light) | ☀️ | 白色背景，适合日间使用 |
| 海蓝 (Blue) | 🌊 | 深蓝背景，科技感强 |
| 绿野 (Green) | 🌿 | 深绿背景，护眼模式 |

主题偏好自动持久化到 `localStorage`（key: `cc_theme`），重新打开面板时恢复上次选择。所有颜色通过 CSS 自定义属性（`--bg-base`、`--bg-card`、`--text-primary` 等）驱动，Ant Design 组件使用对应的深色/浅色算法。

## 项目级 vs 全局模式

| 特性 | 项目模式 🔵 | 全局模式 🟣 |
|------|-----------|-----------|
| 侧边栏横幅 | 蓝色 + 文件夹图标 + 项目名 | 紫色 + 地球图标 + "全局模式" |
| 仪表板顶部 | 蓝色项目信息卡片（含路径） | 紫色提示：如何切换到项目级 |
| Chat 作用域 | 会话绑定 `projectRoot` | 无项目绑定 |
| Header 范围标签 | 蓝色 🗂 项目名 | 紫色 🌐 全局会话 |

在含 `.chainlesschain/` 目录的项目下运行 → **项目级面板**；在其他目录运行 → **全局面板**。

## 命令选项

```
Usage: chainlesschain ui [options]

Options:
  -p, --port <port>           HTTP 服务器端口 (默认: 18810)
  --ws-port <port>            WebSocket 服务器端口 (默认: 18800)
  -H, --host <host>           绑定地址 (默认: 127.0.0.1)
  --no-open                   不自动打开浏览器
  --token <token>             WebSocket 认证 token
  --web-panel-dir <dir>       指定 dist/ 目录（默认自动检测）
  -h, --help                  显示帮助信息
```

## 构建说明

**npm 安装用户**（`npm install -g chainlesschain`）：**无需任何构建**，面板已在发布时通过 `prepublishOnly` 自动内置到包中。

**源码用户**（从 GitHub 克隆仓库）：需手动构建一次：

```bash
# 从项目根目录构建（推荐）
npm run build:web-panel

# 或在 packages/web-panel/ 内手动构建
cd packages/web-panel
npm install --legacy-peer-deps
npm run build
```

> **注意**：安装时需加 `--legacy-peer-deps`，因为 `@vitejs/plugin-vue@5.x` 与 Vite 7 存在 peer dep 声明不匹配问题。

## 技术架构

```
packages/web-panel/           Vue3 + Vite + Ant Design Vue
├── src/stores/ws.js          WebSocket 连接管理（指数退避重连 + waitConnected）
├── src/stores/theme.js       主题状态管理（4 主题 + localStorage 持久化）
├── src/stores/chat.js        会话与消息状态
├── src/stores/skills.js      技能列表与过滤
├── src/stores/providers.js   LLM Provider 管理
├── src/stores/tasks.js       后台任务状态
├── src/stores/dashboard.js   Dashboard 统计状态
├── src/utils/parsers.js      纯函数解析层（技能/状态/笔记/MCP/记忆/Cron）
├── src/style.css             全局 CSS 变量驱动主题系统
├── src/views/                23 个页面视图
│   ├── Security.vue          安全中心（DID/加密/审计）
│   ├── P2P.vue               P2P 网络（设备/消息/同步）
│   ├── Git.vue               Git 与数据（仓库/导入导出）
│   ├── Projects.vue          项目管理（模板/诊断）
│   ├── Wallet.vue            钱包管理（资产/转账）
│   ├── Organization.vue      组织管理（成员/审批）
│   ├── Analytics.vue         使用分析（Token/成本）
│   ├── Templates.vue         模板中心（项目/BI/Prompt）
│   ├── Permissions.vue       权限管理（RBAC/审计）
│   ├── RssFeed.vue           RSS 订阅（源/文章）
│   ├── Backup.vue            备份恢复（同步/IPFS）
│   ├── WebAuthn.vue          身份认证（SSO/2FA）
│   └── ...                   其余 11 个基础页面
└── src/components/
    ├── AppLayout.vue         七组侧边栏（概览/配置/数据/高级/企业/扩展）+ 主题切换器
    └── MarkdownRenderer.vue  Markdown 渲染（主题感知）
```

**运行时配置注入**：

```html
<!-- index.html 构建时含占位符 -->
<script>window.__CC_CONFIG__ = __CC_CONFIG_PLACEHOLDER__;</script>
```

服务器启动时将 `__CC_CONFIG_PLACEHOLDER__` 替换为：

```json
{
  "wsPort": 18800,
  "wsToken": null,
  "wsHost": "127.0.0.1",
  "projectRoot": "/path/to/project",
  "projectName": "my-project",
  "mode": "project"
}
```

配置值经过 Unicode 转义（`<` → `\u003c`），防止 XSS 攻击。

## 自动检测与降级

`chainlesschain ui` 启动时按以下优先级自动查找面板（三路检测）：

```
1. --web-panel-dir <dir>          显式指定目录
2. packages/web-panel/dist/       源码用户本地构建产物
3. <npm包>/src/assets/web-panel/  npm 安装内置产物（v5.0.2.6+）
↓ 三路均未找到
经典 HTML（AI 对话基础功能，自动回退）
```

## 关键 Bug 修复（v5.0.2.11）

### v1.0 Coding Agent Envelope 协议不兼容（v5.0.2.9）

**根因**：v1.0 Envelope 协议使用 `createCodingAgentEvent()` 构建响应，`msg.id` 是新生成的 `eventId`（非请求 ID），客户端用 `msg.id` 匹配 pending promise 永远匹配不上，导致所有 session 操作超时。

**修复**（`ws.js`）：
- 优先用 `msg.requestId` 匹配 pending，fallback 到 `msg.id`
- `flattenEnvelope()` 将 `payload` 合并到顶层
- `normalizeRuntimeEvent()` 同时处理 dot-case 和 kebab-case 类型

**修复**（`chat.js`）：
- `DOT_TO_LEGACY_TYPE` 映射表：`assistant.delta` → `response-token`、`assistant.final` → `response-complete` 等
- `handleSessionMsg()` 自动规范化 v1.0 类型到 legacy 类型

**修复**（`agent-runtime.js`）：
- `startServer()` 加载 config 并传给 sessionManager，解决 LLM 默认配置缺失

## 关键 Bug 修复（v5.0.2.8）

### 技能列表始终显示 0

**根因**：WebSocket 服务端发送 `{ stdout, stderr, exitCode }` 字段，但客户端的 `execute()` 方法读取 `result.output`（始终为 `undefined`），导致所有 CLI 命令输出为空。

**修复**（`ws.js`）：

```js
const output = result.output ?? result.stdout ?? ''   // 兼容新旧服务端
const stderr = result.stderr ?? ''
return { output: output || stderr, exitCode: result.exitCode ?? 0 }
```

### Provider 列表不含国产模型

**根因**：旧版使用 `qianwen`、`moonshot`、`baidu` 等非 CLI 键名，活跃/配置状态永远无法匹配。

**修复**：按 CLI `llm-providers.js` 实际键名重写为 `volcengine`、`dashscope`、`kimi`、`minimax`、`mistral` 等 10 个 Provider。

## 与旧版对比

| 特性 | v5.0.2.6 | v5.0.2.8 | v5.0.2.11 | v5.0.2.12 |
|------|-----------|-----------|-----------|-----------|
| 功能模块数 | 4 | 10 | 15 | **23**（+钱包/组织/分析/模板/权限/RSS/备份/认证）|
| 颜色主题 | 仅深色 | **4 种** | 4 种 | 4 种 |
| Provider 列表 | 不含国产模型 | **10 个** | 10 个 + **LLM 参数设置面板** | 10 个 |
| 技能数量显示 | ❌ 始终为 0 | ✅ 正确 | ✅ 正确 | ✅ 正确 |
| v1.0 Envelope 协议 | — | ❌ 超时 | ✅ requestId 关联 + payload flatten | ✅ |
| Chat 流式消息 | — | ❌ dot-case 不兼容 | ✅ DOT_TO_LEGACY_TYPE 映射 | ✅ |
| Desktop 功能迁移 | — | — | ✅ DID/P2P/Git/Projects | ✅ 企业+扩展 8 页 |
| 侧边栏分组 | 1 组 | 3 组 | 4 组 | **7 组** |

## 测试覆盖率

| 文件 | 类型 | 测试数 |
|------|------|--------|
| `parsers.test.js` | 单元 | 85 |
| `theme.test.js` | 单元 | 17 |
| `ws-store.test.js` | 单元 | 12 |
| `chat-store.test.js` | 单元 | 15 |
| `tasks-store.test.js` | 单元 | 8 |
| `dashboard-store.test.js` | 单元 | 6 |
| `new-pages.test.js` | 单元 | 83 |
| `batch-pages.test.js` | 单元 | 309 |
| `web-ui-server.test.js` | 集成 | 23 |
| `cli-commands.test.js` | 集成 | 17 |
| `ws-protocol-compat.test.js` | E2E | 12 |
| `panel.test.js` | E2E | 46 |
| **Web Panel 合计** | | **621** |

## 配置参考

```bash
# CLI 启动参数
chainlesschain ui [options]
  -p, --port <port>         # HTTP 端口 (默认 18810)
  --ws-port <port>          # WebSocket 端口 (默认 18800)
  -H, --host <host>         # 绑定地址 (默认 127.0.0.1)
  --no-open                 # 不自动打开浏览器
  --token <token>           # WebSocket 认证 token
  --web-panel-dir <dir>     # 自定义 dist/ 目录

# 环境变量
CC_UI_PORT=18810            # 等同于 --port
CC_UI_WS_PORT=18800         # 等同于 --ws-port
CC_UI_TOKEN=<token>         # 等同于 --token
CC_UI_WEB_PANEL_DIR=<dir>   # 等同于 --web-panel-dir

# 面板运行时配置（由 web-ui-server.js 注入到 window.__CC_CONFIG__）
{
  "wsUrl": "ws://127.0.0.1:18800",
  "token": "<token>",
  "projectRoot": "<cwd>",
  "mode": "project" | "global"
}
```

## 性能指标

| 操作 | 目标 | 实际 | 状态 |
| --- | --- | --- | --- |
| 面板首屏加载 (本地) | < 1.5s | ~0.8s (Vite 构建产物) | ✅ |
| WebSocket 连接建立 | < 100ms | ~40ms (loopback) | ✅ |
| 页面切换渲染 | < 100ms | ~35ms (Vue Router) | ✅ |
| 技能列表加载 (138 技能) | < 300ms | ~160ms | ✅ |
| 流式 Chat 渲染 (每 token) | < 20ms | ~8ms | ✅ |
| 主题切换过渡 | < 500ms | ~400ms (CSS 变量) | ✅ |

## 使用示例

```bash
# 默认启动（127.0.0.1:18810）
chainlesschain ui

# 指定端口 + token，不自动打开浏览器
chainlesschain ui --port 9000 --ws-port 9001 --token mysecret --no-open

# 局域网访问（绑定 0.0.0.0）
chainlesschain ui --host 0.0.0.0 --token strong-token

# 开发模式：使用自定义 dist 目录
chainlesschain ui --web-panel-dir packages/web-panel/dist

# 仅启动 UI，复用已运行的 WS 服务
chainlesschain serve --port 18800 --token t1 &
chainlesschain ui --ws-port 18800 --token t1

# 项目级面板（含 .chainlesschain/ 目录自动识别）
cd /path/to/project && chainlesschain ui
```

## 故障排查

### 端口冲突

**症状**: `Error: listen EADDRINUSE :::18810` 或 `:::18800`

**解决方案**:

```bash
# 使用自定义端口
chainlesschain ui --port 9000 --ws-port 9001

# 检查占用进程
# Windows
netstat -ano | findstr :18810
# Linux/macOS
lsof -i :18810
```

### WebSocket 连接失败

**症状**: 面板加载后仪表板显示 "WebSocket 未连接"，所有数据为空

**排查步骤**:

1. 检查浏览器控制台是否有 WS 连接错误
2. 确认 WS 端口（默认 18800）未被防火墙阻止
3. 如果使用了 `--token`，确认面板启动时也传入了相同的 token
4. 检查 `--ws-port` 是否与实际 WS 服务端口一致
5. 面板内置指数退避重连机制，等待几秒后观察是否自动恢复

### 面板未找到 / 回退到经典 HTML

**症状**: 启动时提示 "Vue3 panel not found, falling back to classic HTML"

**解决方案**:

```bash
# npm 安装用户：重新安装
npm install -g chainlesschain

# 源码用户：手动构建
npm run build:web-panel

# 显式指定 dist 目录
chainlesschain ui --web-panel-dir /path/to/packages/web-panel/dist
```

### 主题切换不生效

**症状**: 切换主题后页面颜色未改变

**排查步骤**:

1. 检查浏览器 localStorage 中 `cc_theme` 的值
2. 尝试清除 localStorage 后刷新页面
3. 确认未使用浏览器扩展覆盖页面样式

### 技能列表显示 0

**症状**: 技能管理页面技能数量为 0

**原因**: 这是 v5.0.2.8 之前的已知 Bug，WS 响应字段不匹配。升级到 v5.0.2.8+ 即可解决。如仍出现，检查 WS 连接状态和 CLI 版本。

## 安全考虑

### XSS 防护

运行时配置通过 `window.__CC_CONFIG__` 注入到 HTML `<script>` 标签中。为防止 XSS 攻击，JSON 值经过 Unicode 转义处理：

- `<` 转义为 `\u003c`
- `>` 转义为 `\u003e`
- `&` 转义为 `\u0026`

这确保即使配置值中包含恶意 HTML 标签，也不会被浏览器解析执行。

### Token 认证

通过 `--token` 参数设置认证 token 后，WS 连接建立时需先通过认证才能执行任何命令。建议在非本机访问场景下始终启用 token。

### 本地绑定

默认绑定 `127.0.0.1`，仅允许本机访问。如需远程访问，需显式指定 `--host 0.0.0.0` 并配合 `--token` 使用。

### 命令注入防护

WS 服务端使用安全的命令分词器（`tokenizeCommand`）解析命令字符串，不使用 `shell: true`，从根本上防止 shell 注入攻击。

## 关键文件

| 文件 | 说明 |
|------|------|
| `packages/cli/src/commands/ui.js` | `ui` 命令注册与参数解析 |
| `packages/cli/src/lib/web-ui-server.js` | HTTP 服务器（静态文件服务 + 运行时配置注入 + 经典 HTML 回退） |
| `packages/cli/src/lib/web-ui-envelope.js` | Envelope 协议内联源码 |
| `packages/web-panel/` | Vue3 前端应用源码 |
| `packages/web-panel/src/stores/ws.js` | WebSocket 连接管理（指数退避重连） |
| `packages/web-panel/src/stores/theme.js` | 主题状态管理（4 主题 + localStorage 持久化） |
| `packages/web-panel/src/stores/chat.js` | 会话与消息状态 |
| `packages/web-panel/src/utils/parsers.js` | 纯函数解析层（技能/状态/笔记/MCP/记忆/Cron） |
| `packages/web-panel/src/views/` | 23 个页面视图组件 |
| `packages/web-panel/src/components/AppLayout.vue` | 七组侧边栏布局 + 主题切换器 |
| `packages/web-panel/src/style.css` | 全局 CSS 变量驱动的主题系统 |

## 相关文档

- [设计文档 -- 模块 75](../design/modules/75-web-panel) -- 完整技术架构文档
- [WebSocket 服务器 (serve)](./cli-serve) -- WS 协议详情与服务端配置
- [技能系统 (skill)](./cli-skill) -- 技能管理详情
- [AI Orchestration](./cli-orchestrate) -- 多 AI 后端调度
- [Coding Agent](./coding-agent) -- 编程 Agent 会话
