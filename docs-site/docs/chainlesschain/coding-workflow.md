# Coding Agent 规范工作流 (Canonical Workflow)

> **版本: v2.0 | 状态: ✅ Phase 1–5 + ADR Phase A–E 全部上线 | 5 workflow skills + SessionStateManager + Sub-runtime Pool + 智能路由分类器 + 只读 IPC/Pinia store/UI 面板 | 215+ 测试通过**

## 概述

Coding Agent 规范工作流定义了一条"澄清需求 → 生成计划 → 审批 → 执行"的强制编码路径，通过持久化的 intent.md 和 plan.md 文件在阶段间传递交接物，防止"需求不清就开写"的失败模式。该工作流包含 5 个技能（deep-interview、ralplan、ralph、team、session-state），支持子运行时池和智能路由分类。

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

## 相关文档

- 设计文档:`docs/design/modules/80_规范工作流系统.md`
- ADR 讨论:`docs/design/modules/81_轻量多Agent编排系统.md`
- ADR 实施计划:`docs/implementation-plans/LIGHTWEIGHT_MULTI_AGENT_ORCHESTRATION_ADR.md`
- OMX 原版:<https://github.com/Yeachan-Heo/oh-my-codex>
- Coding Agent 系统:[coding-agent.md](./coding-agent.md)
