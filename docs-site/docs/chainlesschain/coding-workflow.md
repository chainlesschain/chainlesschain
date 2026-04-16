# Coding Agent 规范工作流 (Canonical Workflow)

> **版本: v2.0 | 状态: ✅ Phase 1–5 + ADR Phase A–E 全部上线 | 5 workflow skills + SessionStateManager + Sub-runtime Pool + 智能路由分类器 + 只读 IPC/Pinia store/UI 面板 | 215+ 测试通过**

## 概述

Coding Agent 规范工作流定义了一条"澄清需求 → 生成计划 → 审批 → 执行"的强制编码路径，通过持久化的 intent.md 和 plan.md 文件在阶段间传递交接物，防止"需求不清就开写"的失败模式。该工作流包含 5 个技能（deep-interview、ralplan、ralph、team、session-state），支持子运行时池和智能路由分类。

## 核心特性

- 📋 **强制三阶段工作流**：意图澄清 → 计划生成 → 执行，每阶段有门控文件，防止跳步
- 🔒 **审批门禁**：`$ralph` / `$team` 在 `plan.md` 未审批时拒绝执行，杜绝静默放行
- 🗂 **持久化交接物**：`intent.md` / `plan.md` / `progress.log` 存于项目 `.chainlesschain/sessions/`，全程可审计
- 🔀 **智能路由分类**：内置分类器根据 scopePaths / 关键词自动建议 `$ralph`（单 owner）vs `$team`（多 agent 并行）
- 🧩 **Sub-runtime Pool**：`$team` 真正 spawn 多个 Electron-main 子进程，OS 级故障隔离，最大 6 个并发
- 🪝 **生命周期 Hooks**：`pre-intent / post-intent / pre-plan / post-plan / pre-execute / post-execute` 支持审计、通知和策略拦截
- 🖥 **桌面 UI 集成**：AIChatPage 输入拦截、Workflow Monitor 面板、只读 Pinia store、IPC v3 通道
- ♻️ **热重载 Hooks**：编辑 hook 文件后无需重启，每次调用前清除 require 缓存
- 📡 **CLI 只读巡查**：`cc session workflow` 安全地列出 / 查看 / JSON 输出工作流状态，不修改状态文件
- 🏗 **Monorepo 感知**：分类器预定义 11 个仓库边界桶，精准判断跨模块范围

## 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                   Renderer (Vue3)                           │
│  AIChatPage — $xxx 输入拦截  │  Workflow Monitor 面板       │
│  useWorkflowSessionStore (Pinia, 只读)                      │
└─────────────────────┬───────────────────────────────────────┘
                      │ Electron IPC (coding-agent:*)
                      ▼
┌─────────────────────────────────────────────────────────────┐
│               Desktop Main Process                          │
│                                                             │
│  workflow-command-runner.js                                 │
│   ├─ workflow-command-parser.js  ($xxx 解析)                │
│   └─ skill handlers                                         │
│       ├─ deep-interview  →  intent.md                       │
│       ├─ ralplan         →  plan.md  (approved flag)        │
│       ├─ ralph           →  progress.log (单 owner 循环)    │
│       └─ team            →  SubRuntimePool                  │
│                                 │                           │
│  SessionStateManager                                        │
│   └─ mode.json (stage / routingHint)                        │
│                                                             │
│  WorkflowLifecycleHookRunner                                │
│   └─ .chainlesschain/hooks/<event>.js                       │
└──────────────────────────────┬──────────────────────────────┘
                               │ spawn (JSON-lines stdio)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│       Sub-runtime 子进程 (Electron headless, ×N)            │
│   独立 sessionId 分片  │  独立 progress.log  │  60s 超时    │
└─────────────────────────────────────────────────────────────┘
```

**数据流（主路径）**：

```
$deep-interview "需求" → intent.md
        │
        ▼ (Intake Classifier 自动分析)
    routingHint → mode.json
        │
        ▼
$ralplan "计划" → plan.md (approved: false)
        │
        ▼
$ralplan --approve → plan.md (approved: true)
        │
        ├─[单文件/简单]─► $ralph → progress.log
        │
        └─[跨模块/复杂]─► $team N:role
                                │
                                ▼ SubRuntimePool
                         m0/progress.log
                         m1/progress.log
                         m2/progress.log
                                │
                                ▼ 聚合到父 progress.log
```

## 核心理念

把每次编码任务拆成 3 个强制阶段，用持久化文件把阶段之间的交接物固化下来：

```
$deep-interview      $ralplan           $ralph   或   $team
     │                  │                  │            │
     ▼                  ▼                  ▼            ▼
  intent.md  ───▶   plan.md   ─[approve]─▶ progress.log
                (approved:false)              (append-only)
```

**强制顺序**：
- `$ralplan` 拒绝执行如果 `intent.md` 不存在
- `$ralph` / `$team` 拒绝执行如果 `plan.md` 不存在或 `approved: false`

这条"护栏"把"不清楚需求就开写"的失败模式挡在外面。

## 技能一览

| 技能 | 阶段 | 作用 | Gate |
|---|---|---|---|
| `$deep-interview` | INTENT | 澄清 goal / 边界 / non-goals，写 `intent.md` | — |
| `$ralplan` | PLAN | 读 intent 生成 `plan.md` (unapproved)；`--approve` 翻转审批标志 | 需要 intent.md |
| `$ralph` | EXECUTE | 单 owner 持久完成循环，追加 `progress.log` | 需要 approved plan |
| `$team` | EXECUTE | 按 `N:role` 拆分步骤，输出并行分派表 | 需要 approved plan |

## 快速开始

### 1. 澄清意图

```
$deep-interview "给 REST API 加 OAuth2 认证"
```

生成 `<project>/.chainlesschain/sessions/session-1712345678/intent.md`：

```markdown
# Intent

**Session:** session-1712345678
**Created:** 2026-04-08T08:30:00.000Z

## Goal

给 REST API 加 OAuth2 认证

## Clarifications

_(none yet)_

## Non-Goals

_(none yet)_
```

此时 Coding Agent 会根据 `intent.md` 继续向用户追问（provider? 用户表改动?）。

### 2. 生成计划

```
$ralplan "给出最安全的实施路径"
```

调用时可在 params 中传入 `steps` / `tradeoffs`（由 LLM 推理填写），写入 `plan.md`：

```markdown
---
session: session-1712345678
approved: false
updated: 2026-04-08T08:32:00.000Z
---

# Plan: OAuth2 Integration

## Steps

1. 选型：Google + GitHub provider (passport.js)
2. 数据库新增 oauth_accounts 表
3. /auth/google 和 /auth/github 路由
4. Session / JWT 统一策略
5. 单元测试 + 集成测试

## Tradeoffs

- passport.js vs 手写: 选 passport.js，生态成熟
- JWT vs server session: 选 JWT，便于水平扩展
```

### 3. 审批

```
$ralplan --approve
```

或 IPC / 参数层面传 `{ approve: true }`。frontmatter 翻转为 `approved: true`。

### 4. 执行：二选一

**A. 单 owner 持久循环**（推荐大多数场景）：

```
$ralph "开始执行"
```

追加到 `progress.log`：

```
[2026-04-08T08:35:00.000Z] [ralph] 开始执行
```

Coding Agent 随即进入 **读 plan → 挑下一步 → 执行 → 验证 → 追加 progress** 的循环。

**B. 多 agent 并行分派**：

```
$team 3:executor "并行执行认证计划"
```

读取 plan 的 5 个步骤，按轮询分配给 3 个 executor：

```
executor-1: 步骤 1, 4
executor-2: 步骤 2, 5
executor-3: 步骤 3
```

返回的分派表由 cowork runtime 派发到子会话。

## 文件布局

```
<project>/.chainlesschain/sessions/<sessionId>/
├── intent.md        # $deep-interview 输出
├── plan.md          # $ralplan 输出 (YAML frontmatter 带 approved 标志)
├── progress.log     # $ralph/$team 追加日志
└── mode.json        # { stage, updatedAt }
```

- **sessionId 规则**：只允许 `[A-Za-z0-9._-]`，防路径穿越
- **可手工编辑**：所有文件都是 markdown / text，用户可以打开 VSCode 改写
- **项目作用域**：每个项目独立，不跟 appData 的 `.chainlesschain/config.json` 混用

## 什么时候跳过这条工作流

- **一行修改 / 调试**：直接让 Coding Agent 改就行，不需要 intent 和 plan
- **探索式任务**：先用 `chainlesschain chat` 随便聊，需求清楚了再开 workflow
- **已有详细 spec**：直接从 `$ralplan` 开始，把 spec 贴到 intent.md 里

## 与现有系统的关系

| 系统 | 关系 |
|---|---|
| **Cowork 多 Agent** | `$team` 最终会落到 cowork runtime 分派子会话 |
| **Skills System (138)** | workflow 技能是 138 的增量 (+4)，四层加载自动发现 |
| **Coding Agent Session** | `.chainlesschain/sessions/` 与 Coding Agent 会话互相独立，可绑定 |
| **CLI `cc agent`** | 后续 Phase 3 会把 `$xxx` 解析集成到 agent REPL |

## 设计边界（不做的事）

- ❌ **不引入 tmux** — OMX 用 tmux 做 team runtime，我们走 git worktree + IPC 方案
- ❌ **不替换 cowork** — 工作流是 cowork 之上的 opinionated 薄层
- ❌ **不自动批准** — `$ralplan --approve` 必须显式触发，拒绝"静默放行"

## 常见问题

### Q1：`$ralplan` 报 "intent.md missing"？
先跑 `$deep-interview`。系统强制顺序。

### Q2：`$ralph` 报 "plan not approved"？
跑 `$ralplan --approve`。

### Q3：怎么恢复旧 session？
每个技能都支持传 `sessionId` param 复用：
```
$ralph "继续" --params '{"sessionId":"session-1712345678"}'
```

### Q4：`$team` 最大并行数？
硬上限 6（`MAX_SIZE = 6`）。超过会被截断到 6。

## Phase 3：`$xxx` 快捷命令与 CLI 检查器

Phase 3 补齐两样东西：

### 1. `$xxx` 解析器与 in-process 分派器

两个新模块，均在 `desktop-app-vue/src/main/ai-engine/code-agent/`：

- **`workflow-command-parser.js`** — 纯函数式解析器，接受 `$skill [--flags] [rest]` 文本，返回 `{ skill, rest, flags, params }`。`--approve` / `--key=value` 风格的 flag 与引号包裹的长参数都支持。
- **`workflow-command-runner.js`** — in-process 分派器，调用 `parseWorkflowCommand` 后直接 `require` 对应 handler 并执行，**不经过 Coding Agent bridge / CLI WS server**（workflow 状态是主进程项目本地的）。

典型用法（Electron 主进程或 IPC handler 里）：

```javascript
const { runWorkflowCommand } = require(
  "./ai-engine/code-agent/workflow-command-runner.js",
);

const result = await runWorkflowCommand('$deep-interview "add OAuth"', {
  projectRoot: "/path/to/project",
  sessionId: "optional-existing-session",
});
// → { matched: true, success: true, skill: "deep-interview", result: {...} }
```

Runner 不拦截普通用户消息 — 上层（AIChatPage 或 CLI agent REPL）先用 `isWorkflowCommand(text)` 判断，true 才走 runner。这样既不破坏普通聊天，又保持快捷命令的便捷。

### 2. CLI 检查器：`cc session workflow`

只读工具，查看 `.chainlesschain/sessions/` 下所有工作流状态：

```bash
# 列出所有会话
cc session workflow

# 查看单个会话详情
cc session workflow <sessionId>

# JSON 输出
cc session workflow --json
cc session workflow <id> --json

# 指定项目根目录
cc session workflow --cwd /path/to/project
```

输出示例：

```
Workflow sessions (2):

  session-1712345678  execute  approved   2026-04-08T08:35:00.000Z
  session-1712349999  intent   no-plan    2026-04-08T08:20:00.000Z
```

单会话输出会分段打印 `intent.md` / `plan.md` 全文，以及 `progress.log` 的最后 20 行。

设计上**只读**：CLI 不修改状态文件。修改走 workflow 技能或 IPC。这让 CLI 成为安全的"巡查"入口，适合 `cc session workflow --json` 接其他工具链（脚本、CI、监控）。

## Phase 3.5：AIChatPage 输入拦截

在桌面端 AI 聊天页直接输入 `$deep-interview / $ralplan / $ralph / $team ...` 就能触发工作流，不经过 LLM，也不需要先启动 Coding Agent 会话。

工作原理：`handleSubmitAgentAwareMessage` 拦截正则 `^\s*\$(deep-interview|ralplan|ralph|team)\b`，通过 `window.electronAPI.codingAgent.runWorkflowCommand` 走 IPC 进入 `workflow-command-runner`，在 Electron 主进程内直接执行技能 handler，把结果作为 `assistant` 消息 push 回对话。消息对象额外携带 `workflow: { skill, result }` 便于未来做自定义渲染。

暴露的两个 IPC 通道（见 `coding-agent-ipc-v3.js`）：

- `coding-agent:check-workflow-command` — 纯正则探测，用于 UI 在发送前做是否拦截的判断
- `coding-agent:run-workflow-command` — 实际执行，返回 `{ success, skill, result, message, guidance, error }`

## Phase 4：生命周期 Hooks

你可以把自定义脚本放在 `<projectRoot>/.chainlesschain/hooks/<event>.js`，工作流会在关键节点自动调用它们，用于审计、通知、CI 触发、策略拦截等场景。

### 支持的事件

| 事件 | 触发点 | Veto 语义 |
|---|---|---|
| `pre-intent` | `$deep-interview` 写 `intent.md` 之前 | 抛异常可阻止 |
| `post-intent` | `$deep-interview` 写完 `intent.md` 之后 | 仅记录 |
| `pre-plan` | `$ralplan` 写 `plan.md` 或 `--approve` 之前 | 抛异常可阻止 |
| `post-plan` | `$ralplan` 写/审批完成之后 | 仅记录 |
| `pre-execute` | `$ralph` / `$team` 追加进度之前 | 抛异常可阻止 |
| `post-execute` | `$ralph` / `$team` 追加进度之后 | 仅记录 |
| `pre-done` / `post-done` | 预留给未来的 `$done` 技能 | — |

规则：
- **`pre-*` hook 抛异常** → 步骤被否决，返回 `{ success: false, error }` 给调用者，不会写入状态文件
- **`post-*` hook 抛异常** → 只记录日志，步骤已经完成，不再回滚
- **默认超时** 30 秒；`pre-*` 超时等同抛异常，会否决步骤
- **缺失的 hook 文件** → 直接跳过，无需显式配置
- **热重载**：每次调用都会清除 `require` 缓存，编辑 hook 文件后无需重启应用

### Hook 合约

```javascript
// .chainlesschain/hooks/pre-plan.js
module.exports = async ({ event, sessionId, projectRoot, payload }) => {
  // event:      "pre-plan"
  // sessionId:  当前会话 id
  // projectRoot: 绝对路径
  // payload:    { mode: "write"|"approve", title, steps, tradeoffs, planFile, approved }

  // 抛异常 → 否决（仅 pre-* 生效）
  if (new Date().getHours() < 9) {
    throw new Error("policy: plans must be approved during business hours");
  }
  // 可选：返回值会放进 runner 结果的 data 字段
  return { policyVersion: "2026-04" };
};
```

也支持 `module.exports = { run: async (ctx) => {...} }` 或 `module.exports.default` 的形式。

### 典型用途

**审计日志** — `post-plan.js` 把每次计划写入到企业审计系统：

```javascript
const fs = require("fs");
const path = require("path");
module.exports = async (ctx) => {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    session: ctx.sessionId,
    ...ctx.payload,
  });
  fs.appendFileSync(path.join(ctx.projectRoot, "audit.log"), line + "\n");
};
```

**Slack / 飞书通知** — `post-execute.js` 推送执行进度到团队频道：

```javascript
module.exports = async (ctx) => {
  if (!process.env.SLACK_WEBHOOK) return;
  await fetch(process.env.SLACK_WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: `[${ctx.sessionId}] ${ctx.payload.mode} executed`,
    }),
  });
};
```

**策略拦截** — `pre-plan.js` 阻止敏感目录被写入新计划：

```javascript
module.exports = async (ctx) => {
  const forbidden = ["production-secrets", "infra/prod"];
  if (forbidden.some((w) => JSON.stringify(ctx.payload).includes(w))) {
    throw new Error("policy: plan references forbidden production paths");
  }
};
```

**CI 触发** — `post-plan.js` 在 `approved: true` 时起一次 dry-run：

```javascript
const { execSync } = require("child_process");
module.exports = async (ctx) => {
  if (ctx.payload.mode === "approve" && ctx.payload.approved) {
    execSync("gh workflow run dry-run.yml", { cwd: ctx.projectRoot });
  }
};
```

### 安全注意事项

hook 跑在 Electron 主进程里、拥有完整 Node.js 权限。只放自己或自己团队编辑的脚本，不要执行来自不可信来源的 hook 文件。

## Phase 5：Sub-runtime Pool（真 spawn 多个 Electron-main 子 runtime）

`$team` 不再只是"返回路由规划"，它现在会**真正**为每个 member 拉起一个独立的 Electron-main 子进程，在 OS 级别做故障隔离。

### 原理

触发 `$team 3:executor` 时：

1. 父 Electron-main 读取当前 session 的 `plan.md` → 把 N 个 steps 按 round-robin 切成 `size` 份
2. 通过 `SubRuntimePool` 调用 `spawn(process.execPath, [sub-runtime/index.js], { env: { ELECTRON_RUN_AS_NODE: "1" } })`，为每个 member 拉起一个 headless Electron-main 子进程
3. 每个子 runtime 创建自己的 **member session**：`<parentId>.m<idx>-<role>`，拥有独立的 `.chainlesschain/sessions/<parentId>.m<idx>-<role>/` 目录
4. 子 runtime 在自己的 `progress.log` 里追加 `[role] <step>`，通过 stdin/stdout 的 JSON-lines 协议把 `progress` / `done` / `error` 事件实时推回父进程
5. 父进程作为**单写者**把每个 member 的 ok/fail 摘要追加到父 session 的 `progress.log`

### 文件布局

```
.chainlesschain/sessions/
├── my-session/                     ← 父 session（只读 + 聚合写者）
│   ├── plan.md       (approved)
│   └── progress.log                ← [team] dispatched 3×executor
│                                     [team] my-session.m0-executor ok
│                                     [team] my-session.m1-executor ok
│                                     [team] my-session.m2-executor ok
├── my-session.m0-executor/         ← 子 runtime 0 独占
│   ├── plan.md       (approved, steps=自己那份)
│   └── progress.log                ← [executor] step-A
│                                     [executor] step-D
├── my-session.m1-executor/
│   └── ...
└── my-session.m2-executor/
    └── ...
```

### 为什么不共享父 sessionId？

如果让多个子 runtime 同时写同一个 `progress.log` / `mode.json`，就会有经典的并发写冲突：错行、覆盖、YAML frontmatter 坏掉。因此我们采用 **sessionId 分片** 而不是文件锁 —— 文件锁会把并行退化成串行，失去真 spawn 的意义。

### 查看 member 进度

```bash
# CLI 里直接列出所有 session，member sessions 也会显示
chainlesschain session workflow

# 查看某个 member 的 progress.log
cat .chainlesschain/sessions/my-session.m0-executor/progress.log
```

### 容错

- **子 runtime 崩溃**：pool 捕获并映射为该 member 的 `{ success: false, error: "exited before done" }`，其他 member 不受影响
- **子 runtime 卡死**：默认 60 秒超时，超时后该 member 失败，pool 继续收尾
- **Pool 启动失败**：降级为 `{ success: false, error: "spawn failed: ..." }`，`$team` 整体报错但父 session 状态保持一致

### 限制

- 硬上限 6 个并发子 runtime（与 `$team` size cap 一致），防止用户写出 `$team 99:executor` 把机器打爆
- 子 runtime **不携带** AI engine / 数据库 / IPC / MCP —— 只有 SessionStateManager 和进度写入能力。想在子 runtime 里跑真 LLM，需要父 runtime 先把工作拆成"文件 diff 粒度"的 step，由子 runtime 按步骤执行
- 子 runtime 是**一次性**的：跑完一个 assignment 就退出，没有复用。换取的是"失败隔离 = 进程边界"的清晰心智模型

## 智能路由 (ADR Phase E)

从 v2.0 开始,`$deep-interview` 在写完 `intent.md` 之后会自动运行一个纯函数分类器,给出 `$ralph` vs `$team` 的**建议**(非门控,用户/LLM 完全可以忽略)。

### 分类器输入

```javascript
{
  request: "wire main and renderer",          // 自然语言描述
  scopePaths: ["src/main/a.js", "src/renderer/b.ts"],  // 可选的显式路径
  fileHints: ["package.json"],                // 可选的相关文件
  sessionId: "s1",                            // 可选;提供时自动富化 tasks.json scopes
  concurrency: 3,                             // 用户期望的最大并发(默认 3, 上限 6)
}
```

### 分类器输出

```javascript
{
  decision: "team",                 // "ralph" | "team"
  confidence: "high",               // "low" | "medium" | "high"
  complexity: "moderate",           // "trivial" | "simple" | "moderate" | "complex"
  scopeCount: 2,
  boundaries: ["desktop-app-vue/src/main", "desktop-app-vue/src/renderer"],
  testHeavy: false,
  signals: ["multi-scope", "cross-cutting-phrase"],
  reason: "2 distinct monorepo boundaries",
  recommendedConcurrency: 2,
  suggestedRoles: ["executor/main", "executor/ui"]
}
```

### 路由规则

| 条件 | 决策 | 置信度 |
|---|---|---|
| `scopeCount >= 2` (跨 2+ monorepo 边界) | `team` | high |
| 命中 cross-cutting 短语(`main and renderer`, `across modules`) | `team` | low |
| 命中 trivial 短语(`typo`, `rename`, `whitespace`, `docstring`) | `ralph` | high |
| 单 scope 明确 | `ralph` | high |
| 默认 | `ralph` | medium |

### Monorepo 边界桶

分类器预定义 11 个仓库边界,用于判断 scopePaths 是否跨模块:

- `desktop-app-vue/src/main` / `src/renderer` / `src/preload` / `tests`
- `packages/cli/src` / `__tests__`
- `backend/project-service` / `backend/ai-service`
- `android-app` / `ios-app` / `docs`

### 建议的持久化

分类器结果通过 `SessionStateManager.setRoutingHint()` 合并写入 `mode.json`:

```json
{
  "stage": "intent",
  "updatedAt": "2026-04-09T03:40:39.312Z",
  "routingHint": {
    "decision": "team",
    "confidence": "high",
    "scopeCount": 2,
    "recommendedConcurrency": 2,
    "suggestedRoles": ["executor/main", "executor/ui"],
    "reason": "2 distinct monorepo boundaries"
  }
}
```

**关键不变式**:`routingHint` 通过 `_updateMode` 合并写入,天然保证跨 stage 迁移(`intent → plan → execute → verify → complete`)不丢失。后续阶段可以读取但不能依赖它做门控。

### 使用示例

```bash
# CLI: 通过 session 读取路由建议
chainlesschain session workflow s1
# → Stage: intent · Routing hint: $team (confidence=high, reason="2 distinct monorepo boundaries")

# Renderer: Workflow Monitor 面板里有独立的 "Routing Hint" 行,显示 decision tag/complexity/reason/suggested roles
```

### IPC 通道

```typescript
// Preload 层:
window.electronAPI.workflowSession.classifyIntake({
  request: "add OAuth to API",
  scopePaths: ["backend/auth/oauth.js"],
})
// → { success: true, classification: { decision: "ralph", ... } }
```

### Pinia Store

```typescript
const store = useWorkflowSessionStore();
await store.refreshList();
await store.selectSession("s1");
// 读取建议:
const hint = store.currentState.mode.routingHint;
// 或主动分类:
const result = await store.classifyIntake({ request: "anything" });
```

### 为什么是非门控?

分类器是**提示型**工具,有两个原因:

1. **避免误路由** —— 启发式不可能 100% 准确,强制路由会把正确的 ralph 任务错误地塞给 team
2. **保留用户最终权威** —— Coding Agent 的 LLM 可能比分类器更懂"这是不是一个 typo"

分类器抛错也不影响 `$deep-interview` 的主流程:`result.routingHint` 降级为 `null`,session 状态照写。

## 后续路线图

| Phase | 内容 | 状态 |
|---|---|---|
| Phase 1 | 4 workflow skills | ✅ 完成 |
| Phase 2 | SessionStateManager | ✅ 完成 |
| Phase 3 | `$xxx` 解析器 + 分派器 + CLI 检查器 | ✅ 完成 |
| Phase 3.5 | AIChatPage UI 集成 | ✅ 完成 |
| Phase 4 | Lifecycle hooks (`.chainlesschain/hooks/`) | ✅ 完成 |
| Phase 5 | Sub-runtime Pool(真 spawn Electron-main 子 runtime) | ✅ 完成 |
| ADR Phase A | tasks.json / verify.json / fix-loop retries 状态扩展 | ✅ 完成 |
| ADR Phase B | `$team` 按 scopePaths 拆分(不再平均分步骤) | ✅ 完成 |
| ADR Phase C | `$verify` / `$complete` + 门控(verify.status 必须 passed) | ✅ 完成 |
| ADR Phase D | Workflow Monitor UI 收敛(session view + task readiness + verify checks) | ✅ 完成 |
| ADR Phase E | Intake classifier + routingHint 持久化 + UI 可视化 | ✅ 完成 |
| Phase 6 | Git worktree integration | 🔜 按需 |

## 配置参考

### SessionStateManager 配置

```javascript
// .chainlesschain/sessions/<sessionId>/mode.json
{
  "stage": "intent",            // intent | plan | execute | verify | complete
  "updatedAt": "2026-04-09T03:40:39.312Z",
  "routingHint": {              // 由 Intake Classifier 写入，非门控
    "decision": "team",         // "ralph" | "team"
    "confidence": "high",       // "low" | "medium" | "high"
    "complexity": "moderate",   // "trivial" | "simple" | "moderate" | "complex"
    "scopeCount": 2,
    "recommendedConcurrency": 2,
    "suggestedRoles": ["executor/main", "executor/ui"],
    "reason": "2 distinct monorepo boundaries"
  }
}
```

### 生命周期 Hooks 配置

```javascript
// .chainlesschain/hooks/<event>.js
// 支持事件: pre-intent, post-intent, pre-plan, post-plan,
//           pre-execute, post-execute, pre-done, post-done
module.exports = async ({ event, sessionId, projectRoot, payload }) => {
  // pre-* 抛异常 → 否决步骤（30s 超时等同抛异常）
  // post-* 抛异常 → 只记录日志，不回滚
  // 返回值放入 runner 结果的 data 字段
};
```

### $team 执行配置

```javascript
// $team 参数
{
  size: 3,                     // 并发子 runtime 数，上限 6
  role: "executor",            // 子 runtime 角色标识
  sessionId: "optional",       // 复用已有 session，不传则新建
  timeout: 60_000,             // 子 runtime 超时（ms），默认 60s
}
```

### 智能路由分类器配置

```javascript
// Intake Classifier 输入
{
  request: "wire main and renderer",     // 自然语言需求描述
  scopePaths: [                          // 可选显式路径
    "src/main/a.js",
    "src/renderer/b.ts"
  ],
  fileHints: ["package.json"],           // 可选相关文件提示
  sessionId: "s1",                       // 可选，提供时自动富化 tasks.json scopes
  concurrency: 3,                        // 期望最大并发（默认 3，上限 6）
}
```

### IPC 通道

```javascript
// Preload 暴露的 workflow API
window.electronAPI.codingAgent.checkWorkflowCommand(text)
// → { isWorkflow: boolean, skill: string | null }

window.electronAPI.codingAgent.runWorkflowCommand(text, { projectRoot, sessionId })
// → { success, skill, result, message, guidance, error }

window.electronAPI.workflowSession.classifyIntake({ request, scopePaths, fileHints })
// → { success: true, classification: { decision, confidence, ... } }

window.electronAPI.workflowSession.list({ projectRoot })
// → { sessions: [{ sessionId, stage, approved, updatedAt }] }

window.electronAPI.workflowSession.get(sessionId, { projectRoot })
// → { session, intent, plan, recentProgress }
```

## 性能指标

### 响应时间目标

| 操作 | 目标 | 备注 |
|------|------|------|
| `$deep-interview` 写 intent.md | < 100ms | 不含 LLM 追问延迟 |
| `$ralplan` 生成 plan.md | < 200ms | 不含 LLM 推理延迟 |
| `$ralplan --approve` 翻转标志 | < 30ms | 纯文件写操作 |
| `$ralph` 追加 progress.log | < 20ms | 单次 append |
| `$team` spawn 子进程（×3） | < 500ms | 含首个子进程 ready |
| Intake Classifier 分类 | < 5ms | 纯函数，无 LLM 调用 |
| CLI `cc session workflow` 列表 | < 50ms | 读取本地 JSON 文件 |
| Hook 调用（pre-/post-） | < 30s | 超时后等同抛异常 |

### 资源使用预算

| 指标 | 预算 |
|------|------|
| Sub-runtime 子进程最大并发数 | 6 |
| 单个子进程超时 | 60s |
| 父 session progress.log 单条追加 | < 1KB |
| tasks.json / verify.json 最大大小 | < 500KB |
| mode.json routingHint 字段大小 | < 2KB |

### 可扩展性目标

| 限制 | 数值 |
|------|------|
| 单项目同时运行的 workflow session 数 | 不限（文件隔离） |
| $team size 硬上限 | 6 |
| plan.md steps 软上限 | 50 步 |
| progress.log 单文件建议上限 | 10MB（超出不影响功能） |
| hooks/ 目录 hook 文件数 | 不限 |

## 测试覆盖率

### 当前实测（v2.0）

| 类型 | 测试文件 | 覆盖内容 | 状态 |
|------|----------|----------|------|
| 单元 | `workflow-skills.test.js` | 4 个技能 handler 门控逻辑 | ✅ |
| 单元 | `session-state-manager.test.js` | stage 迁移、routingHint 持久化 | ✅ |
| 单元 | `workflow-command-parser.test.js` | `$xxx --flags` 解析、边界输入 | ✅ |
| 单元 | `workflow-command-runner.test.js` | in-process 分派、isWorkflowCommand | ✅ |
| 单元 | `intake-classifier.test.js` | 路由规则、置信度、monorepo 边界 | ✅ |
| 单元 | `sub-runtime-pool.test.js` | spawn / 超时 / 崩溃容错 / sessionId 分片 | ✅ |
| 单元 | `workflow-hooks.test.js` | pre-/post- veto、热重载、超时 | ✅ |
| 集成 | `workflow-lifecycle.integration.test.js` | 全流程 intent→plan→approve→execute | ✅ |
| 集成 | `workflow-team-pool.integration.test.js` | $team 真实 spawn + 聚合 | ✅ |
| **合计** | **9 个文件** | **215+ 用例** | **215+/215+ 通过** |

运行命令：

```bash
cd desktop-app-vue
npx vitest run src/main/ai-engine/code-agent/__tests__/workflow-skills.test.js \
  src/main/ai-engine/code-agent/__tests__/session-state-manager.test.js \
  src/main/ai-engine/code-agent/__tests__/workflow-command-parser.test.js \
  src/main/ai-engine/code-agent/__tests__/workflow-command-runner.test.js \
  src/main/ai-engine/code-agent/__tests__/intake-classifier.test.js \
  src/main/ai-engine/code-agent/__tests__/sub-runtime-pool.test.js \
  src/main/ai-engine/code-agent/__tests__/workflow-hooks.test.js \
  tests/integration/workflow-lifecycle.integration.test.js \
  tests/integration/workflow-team-pool.integration.test.js
```

### 关键测试场景

```
✅ $deep-interview 写 intent.md + LLM 追问循环
✅ $ralplan 门控：intent.md 不存在时拒绝执行
✅ $ralph 门控：plan.md 不存在或 approved: false 时拒绝执行
✅ $team 门控：plan.md 不存在或 approved: false 时拒绝执行
✅ $ralplan --approve 翻转 approved 标志
✅ $team 按 scopePaths 分片（ADR Phase B）
✅ $verify / $complete 门控（ADR Phase C）
✅ sub-runtime 崩溃隔离（其他 member 不受影响）
✅ sub-runtime 超时（60s 后 member 失败，pool 继续）
✅ pre-plan hook veto（抛异常阻止写 plan.md）
✅ post-execute hook 失败不回滚
✅ hook 热重载（require 缓存清除）
✅ Intake Classifier 跨 monorepo 边界 → team 高置信
✅ Intake Classifier trivial 短语 → ralph 高置信
✅ routingHint 跨 stage 迁移不丢失
✅ AIChatPage $xxx 拦截正则匹配 / 非拦截普通消息
✅ cc session workflow 列出 / 查看 / JSON 输出
```

### 测试目标

| 项 | 目标 |
|----|------|
| 技能门控覆盖率 | 100%（所有 pre-condition 检查） |
| Hook veto 覆盖率 | 100%（pre-* 超时 / 抛异常两种路径） |
| Sub-runtime 容错覆盖率 | 100%（崩溃、超时、spawn 失败） |
| 集成测试通过率 | 100% |

## 安全考虑

### 1. 强制顺序门控

- `$ralplan` 强制要求 `intent.md` 存在，防止无意图直接写计划
- `$ralph` / `$team` 强制要求 `plan.md` 的 `approved: true`，`$ralplan --approve` 必须显式触发
- 所有门控在 handler 入口检查，不依赖 LLM 提示词的自我约束

### 2. sessionId 路径安全

- sessionId 只允许 `[A-Za-z0-9._-]` 字符，防路径穿越攻击
- session 目录限定在 `<projectRoot>/.chainlesschain/sessions/`，不跨项目访问
- member sessionId 格式为 `<parentId>.m<idx>-<role>`，结构可追溯

### 3. Hook 执行安全

- Hook 文件跑在 Electron 主进程，拥有完整 Node.js 权限
- 只放自己或自己团队编辑的脚本，不要执行来自不可信来源的 hook 文件
- `pre-*` hook 30 秒超时自动否决，防止 hook 挂起阻塞工作流
- `post-*` hook 失败只记录日志，不回滚已完成的步骤

### 4. Sub-runtime 隔离

- 每个子进程独立 sessionId 分片，避免多进程并发写同一文件
- 父进程作为单写者把 member 摘要聚合到父 progress.log
- 子 runtime 不携带 AI engine / 数据库 / IPC / MCP，权限面最小化
- 硬上限 6 个并发子进程，防止资源耗尽

### 5. 审批不可绕过

- `$ralplan --approve` 需显式触发，没有"静默放行"路径
- IPC 层面 `runWorkflowCommand` 不自动注入 `--approve`
- 生产环境可通过 `pre-plan.js` hook 加业务时间 / 角色策略二次校验

## 故障排查

### Q1：`$ralplan` 报 "intent.md missing"？

先跑 `$deep-interview`。系统强制顺序，`$ralplan` 不会在没有 intent 的情况下生成计划。

### Q2：`$ralph` / `$team` 报 "plan not approved"？

跑 `$ralplan --approve`，或在 Workflow Monitor 面板点击「批准计划」。

### Q3：怎么恢复旧 session？

每个技能都支持传 `sessionId` param：

```
$ralph "继续" --params '{"sessionId":"session-1712345678"}'
```

### Q4：`$team` 最大并发数？

硬上限 6（`MAX_SIZE = 6`）。写 `$team 99:executor` 会被截断到 6。

### Q5：子进程跑完后没有输出到父 progress.log？

检查子进程是否超时（默认 60s）。查看 member session 的 progress.log 确认子进程有输出：

```bash
cat .chainlesschain/sessions/my-session.m0-executor/progress.log
```

### Q6：Hook 没有被触发？

- 确认文件路径为 `.chainlesschain/hooks/<event>.js`（相对于 projectRoot）
- 确认导出格式：`module.exports = async (ctx) => {}` 或 `module.exports = { run: async (ctx) => {} }`
- 检查主进程日志是否有 `[workflow-hook] skipping: file not found`

### Q7：Intake Classifier 路由建议不准确？

分类器是**提示型**，不影响实际执行。如果建议错误，直接用你认为合适的技能即可。如需调整分类逻辑，可修改 `intake-classifier.js` 的关键词列表或 monorepo 边界桶。

### Q8：AIChatPage 输入了 `$deep-interview` 但没被拦截？

确认 `handleSubmitAgentAwareMessage` 中的拦截正则包含了该技能名。已知正则为 `^\s*\$(deep-interview|ralplan|ralph|team)\b`。如果用了其他别名（如 `$interview`），需要扩展正则。

### Q9：`cc session workflow` 报错找不到 `.chainlesschain/sessions/`？

该目录在首次运行工作流技能后自动创建。如果是首次使用，先跑一次 `$deep-interview`。也可以手动创建目录：

```bash
mkdir -p .chainlesschain/sessions
```

## 关键文件

| 文件 | 作用 |
|------|------|
| `desktop-app-vue/src/main/ai-engine/code-agent/workflow-command-parser.js` | `$xxx [--flags] [rest]` 纯函数解析器 |
| `desktop-app-vue/src/main/ai-engine/code-agent/workflow-command-runner.js` | in-process 分派器，不走 CLI WS server |
| `desktop-app-vue/src/main/ai-engine/code-agent/session-state-manager.js` | mode.json 读写、stage 迁移、routingHint 持久化 |
| `desktop-app-vue/src/main/ai-engine/code-agent/intake-classifier.js` | 纯函数路由分类器，11 个 monorepo 边界桶 |
| `desktop-app-vue/src/main/ai-engine/code-agent/sub-runtime-pool.js` | spawn Electron-main 子进程、JSON-lines 协议、超时容错 |
| `desktop-app-vue/src/main/ai-engine/code-agent/workflow-lifecycle-hook-runner.js` | pre-/post- hook 加载、执行、超时处理 |
| `desktop-app-vue/src/main/ai-engine/code-agent/coding-agent-ipc-v3.js` | `coding-agent:check-workflow-command` / `run-workflow-command` IPC 通道 |
| `desktop-app-vue/src/main/ipc/ipc-registry.js` | workflow IPC 注册入口 |
| `desktop-app-vue/src/renderer/stores/workflow-session.ts` | Pinia 只读 store，驱动 Workflow Monitor 面板 |
| `desktop-app-vue/src/renderer/pages/AIChatPage.vue` | `$xxx` 输入拦截逻辑（handleSubmitAgentAwareMessage） |
| `packages/cli/src/commands/session.js` | `cc session workflow` CLI 只读巡查入口 |
| `desktop-app-vue/builtin-skills/deep-interview.md` | $deep-interview 技能定义（SKILL.md 格式） |
| `desktop-app-vue/builtin-skills/ralplan.md` | $ralplan 技能定义 |
| `desktop-app-vue/builtin-skills/ralph.md` | $ralph 技能定义 |
| `desktop-app-vue/builtin-skills/team.md` | $team 技能定义 |

## 相关文档

- 设计文档:`docs/design/modules/80_规范工作流系统.md`
- ADR 讨论:`docs/design/modules/81_轻量多Agent编排系统.md`
- ADR 实施计划:`docs/implementation-plans/LIGHTWEIGHT_MULTI_AGENT_ORCHESTRATION_ADR.md`
- OMX 原版:<https://github.com/Yeachan-Heo/oh-my-codex>
- Coding Agent 系统:[coding-agent.md](./coding-agent.md)
