---
layout: home

hero:
  name: ChainlessChain
  text: 去中心化个人 AI 管理平台
  tagline: v5.0.2.34 | CLI 0.151.0 · 109 命令 · V2 规范层（iter16-iter21 · 156+ 治理表面，iter17-iter21 新增 40 lib surface）· 14000+ 测试
  image:
    src: /logo.png
    alt: ChainlessChain Logo
  actions:
    - theme: brand
      text: 快速开始
      link: /guide/getting-started
    - theme: alt
      text: 查看文档
      link: /guide/introduction
    - theme: alt
      text: GitHub
      link: https://github.com/chainlesschain

features:
  - icon: 🔐
    title: 安全优先
    details: 支持本地优先、权限控制、会话持久化与远程访问保护。
  - icon: 🤖
    title: AI 原生
    details: 支持多 Provider、多模型、Agent 工作流、压缩策略与会话恢复。
  - icon: 🧭
    title: CLI + Web Panel
    details: 同时提供 Headless CLI、Web 管理面板、任务监控与会话管理。
  - icon: 🧪
    title: 工程化验证
    details: 单元、集成、E2E 与文档持续对齐，减少设计与实现偏移。
---

> 2026-04-08 更新：文档站已对齐 CLI Agent Runtime 重构、统一 runtime event、session record、后台任务增强、Worktree 合并助手、压缩观测、会话迁移，以及 **Coding Agent Phase 5 最小 Harness + 真实 interrupt**。
>
> 2026-04-19 更新：CLI V2 规范层 iter17–iter21 累计新增 40 个 lib 治理表面（chat-core / claude-code-bridge / compliance-manager / cowork-learning / cowork-workflow / privacy-computing / token-incentive / hardening-manager / aiops / multimodal / instinct-manager / tenant-saas / quantization / trust-security / nl-programming / perception / code-agent / collaboration-governance / community-governance / did-manager / sso-manager / org-manager / scim-manager / sync-manager / agent-network / browser-automation / dlp-engine / evomap-governance / federation-hardening / ipfs-storage / p2p-manager / wallet-manager / activitypub-bridge / matrix-bridge / nostr-bridge / bi-engine / memory-manager / session-manager / hook-manager / workflow-engine），统一遵循 4 状态 profile maturity + 5 状态 lifecycle 模型；CLI 版本升级到 `0.151.0`。

## 当前验证结果

- CLI 单元（`__tests__/unit`，含全部 V2 治理表面）：`14255/14255` (332 文件)
- CLI 集成（`__tests__/integration`）：`696/696` (40 文件)
- CLI E2E（`__tests__/e2e`）：`565/565` (38 文件)
- CLI 定向单元（含 `agent-core` / `ws-agent-handler` / `interaction-adapter` / `abort-utils` 真实 interrupt 主线）：`175/175`
- CLI `ws-session-workflow` 集成：`20/20`
- CLI `coding-agent-envelope-roundtrip` E2E：`7/7`
- Desktop Coding Agent 主链路（bridge / ipc-v3 / session-service / permission-gate / tool-adapter / 集成 / store / AIChatPage）：`9 files, 197/197`
- Phase 5 最小 harness 定向回归：`5 files, 84/84`
- AIChatPage harness 面板 + dot-case 事件页面回归：`69/69`
- Web Panel 定向单元测试：`27/27`
- Web Panel 构建：通过
- Docs Site 构建：通过

**2026-04-08 文档对齐回归（修改文件全量定向）**：

| 类型 | 范围 | 通过 |
| --- | --- | --- |
| CLI 单元 | agent-core / sub-agent-registry / ws-agent-handler | 126/126 |
| Desktop main 单元 | coding-agent-bridge / coding-agent-ipc-v3 / coding-agent-session-service | 77/77 |
| Renderer 单元 | coding-agent store / AIChatPage | 81/81 |
| CLI 集成 | ws-session-workflow | 32/32 |
| Desktop 集成 | coding-agent-lifecycle | 18/18 |
| CLI E2E | coding-agent-envelope-roundtrip | 7/7 |
| **小计** | **6 套** | **341/341** |

## 快速开始

### 方式一：CLI 安装

```bash
npm install -g chainlesschain
chainlesschain setup
chainlesschain start
```

### 方式二：源码运行

```bash
git clone https://github.com/chainlesschain/chainlesschain.git
cd chainlesschain
npm install
npm run dev:desktop-vue
```

## 文档导航

- [产品概览](/guide/introduction)
- [快速开始](/guide/getting-started)
- [CLI 文档](/chainlesschain/cli)
- [Agent 架构优化](/chainlesschain/agent-optimization)
- [Web 管理界面](/chainlesschain/cli-ui)
- [WebSocket 服务](/chainlesschain/cli-serve)
- [设计文档索引](/design/)

## 当前推荐阅读

如果你是从本轮 Runtime / Web Panel / 协议演进切入，建议优先看下面几页：

- [WebSocket 服务](/chainlesschain/cli-serve)
- [Web 管理界面](/chainlesschain/cli-ui)
- [Agent 架构优化](/chainlesschain/agent-optimization)
- [设计模块 69：WebSocket 服务器接口](/design/modules/69-websocket-server)
- [设计模块 73：Web 管理界面](/design/modules/73-web-ui)
- [设计模块 75：Web 管理面板](/design/modules/75-web-panel)
- [设计模块 78：CLI Agent Runtime 重构计划](/design/modules/78-cli-agent-runtime)
- [设计模块 79：Coding Agent 系统](/design/modules/79-coding-agent)
- [Coding Agent 用户文档](/chainlesschain/coding-agent)
- [Minimal Coding Agent 实施计划](/chainlesschain/minimal-coding-agent-plan)

## 本轮重点能力

### CLI Agent Runtime 重构

- 命令入口正在统一收口到 `Runtime / Gateway / Harness` 分层。
- WebSocket 协议处理已拆到 `gateways/ws`，由 dispatcher 统一分发。
- Web Panel 已通过 `onRuntimeEvent()` 开始消费统一 runtime event。
- `session-created`、`session-resumed`、`session-list-result` 现在都带标准 `record`。

### 后台任务增强

- 支持任务历史分页查询、任务详情输出摘要和多节点恢复策略基础能力。
- 任务完成后通过 `task:notification` 实时推送到 Web Panel。

### Worktree 合并助手

- 支持 `worktree-diff` 预览、`worktree-merge` 一键合并。
- 冲突结果包含文件级摘要、自动化候选项和预览入口。

### 压缩策略观测

- 支持 `windowMs`、`provider`、`model` 三个维度筛选。
- Dashboard 展示命中率、节省 Token、策略分布和变体分布。

### 会话迁移

- 支持旧 JSON 会话迁移到 JSONL。
- 支持 dry-run 报告、抽样校验和失败重试。

### Coding Agent Phase 5 最小 Harness 与真实 Interrupt

- `coding-agent:interrupt` 已从 `close-session` 别名收口为**真实中断**语义：CLI runtime 通过共享 `abort-utils.js` + `AbortController` 终止当前正在执行的 turn，同时保留 session 可继续使用。
- `CodingAgentSessionService.getHarnessStatus()` 一次性聚合 `sessions` / `worktrees` / `backgroundTasks` 三类概览。
- 新增五条 IPC：`harness-status` / `list-background-tasks` / `get-background-task` / `get-background-task-history` / `stop-background-task`，Desktop main → bridge → IPC v3 → preload → renderer store 全链路打通。
- Desktop 聊天页 (`AIChatPage.vue`) 新增 **Coding Agent Harness** 面板，展示会话 / worktree / 后台任务概览，支持 Refresh、View Details（详情 + 历史）、Stop Task。
- AIChatPage 已迁移到点分小写事件协议：`tool.call.*` / `assistant.final` / `approval.*` / `approval.high-risk.*`。

## 当前架构主线

本轮文档已经把下面这条主线补齐到可阅读状态：

- CLI 入口正在统一收口到 `Runtime / Gateway / Harness`
- WebSocket 层从“大一统消息处理器”演进为 `gateways/ws`
- Web Panel 主干页面开始通过 `onRuntimeEvent()` 消费统一事件
- session / task / worktree / telemetry 开始共享标准 `record`

如果你想从设计层继续深入，可以直接进入 [设计文档索引](/design/)，再顺着 69、73、75、78 四个模块继续看。
