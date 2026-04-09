# 81 轻量多 Agent 编排系统 (Lightweight Multi-Agent Orchestration)

> **版本**: v2.0 (已实施) | **日期**: 2026-04-09 | **状态**: Phase A–E 全部落地
> **ADR 原文**: [LIGHTWEIGHT_MULTI_AGENT_ORCHESTRATION_ADR](../../implementation-plans/LIGHTWEIGHT_MULTI_AGENT_ORCHESTRATION_ADR.md)
> **前置模块**: [80 规范工作流系统](./80_规范工作流系统.md)

## 1. 背景

当前仓库已经存在多条与 agent 编排相关的实现路径：

- **轻量文件驱动工作流**
  - `session-state-manager.js`
  - `workflow-hook-runner.js`
  - `workflow-command-runner.js`
- **Canonical workflow 技能**
  - `deep-interview` / `ralplan` / `ralph` / `team`
- **真实并行子运行时**
  - `sub-runtime-pool.js`
- **较重的旧编排层**
  - `agent-coordinator.js`
  - `pipeline-orchestrator.js`

问题不在于"缺少编排器"，而在于"已经有多套编排思路并行演化"：

1. **状态分散** — workflow/cowork/coding-agent/pipeline 各自维护状态模型
2. **执行入口分散** — 自然语言工作流/IPC 工作流/多 agent 页/独立 pipeline
3. **并行粒度过粗** — `$team` 按 `plan.md` 编号步骤平均分配，缺少作用域与依赖拆分
4. **完成定义不统一** — 有的强调"生成结果"，有的强调"工作流状态"，但未统一落到"验证证据"

本模块的目标不是新增第 4 套 orchestrator，而是**收敛主线**。

## 2. 目标与非目标

### 目标

- 一条主线覆盖从需求澄清、计划、执行到验证
- 对 monorepo 多模块改动可控并行
- 默认可恢复、可审计、可验证
- 对桌面端 UI 和 CLI 共用同一套状态模型

### 非目标

- ❌ 不做 OMC 风格的大量 magic keywords
- ❌ 不在首版引入远程 agent / P2P 团队执行
- ❌ 不引入常驻 daemon 式 agent swarm
- ❌ 不再创建新的重型 orchestration service

## 3. 决策

采用"**轻量文件驱动编排主线**"作为 ChainlessChain 的默认多 agent 编排方案。

1. 以 `workflow-command-runner` 为**统一**工作流入口
2. 以 `.chainlesschain/sessions/<sessionId>/` 为**唯一**编排状态源
3. 以 `$deep-interview → $ralplan → $ralph / $team → verify → fix-loop` 为 canonical workflow
4. 以 `sub-runtime-pool` 为**默认**并行执行器，不新增另一套并行 runtime
5. `agent-coordinator` 和 `pipeline-orchestrator` **暂不扩张**为新的主线，仅作为后续可复用能力来源

## 4. 架构

### 4.1 主线流程（5 段式）

```
intake
  → plan
  → execute
  → verify
  → complete
  → fix-loop → execute
  → failed
```

相比模块 80 的 4 段式（intake 隐式、verify 缺失），新增：

- **intake** 阶段 — 显式判断"直接执行"还是"进入需求澄清"
- **verify** 阶段 — 执行验证命令，产出结构化 `verify.json`
- **fix-loop** 阶段 — 仅回流失败任务，有限次数重试

### 4.2 分层架构

```
┌────────────────────────────────────────────────┐
│  用户入口 (AI Chat / CLI / IPC)                  │
└────────────────┬───────────────────────────────┘
                 │
                 ▼ 统一入口
┌────────────────────────────────────────────────┐
│  workflow-command-runner                        │
└────────────────┬───────────────────────────────┘
                 │
                 ▼ 调用 5 段式 canonical workflow
┌────────────────────────────────────────────────┐
│  intake → plan → execute → verify → fix-loop   │
└────────┬────────────────┬──────────────────────┘
         │                │
         ▼                ▼
┌────────────┐    ┌──────────────────────────┐
│   $ralph   │    │ $team + sub-runtime-pool │
│  (单任务)   │    │  (按 scopePaths 并行)     │
└──────┬─────┘    └────────┬─────────────────┘
       │                   │
       ▼                   ▼
┌────────────────────────────────────────────────┐
│  SessionStateManager (唯一状态源)                 │
│  .chainlesschain/sessions/<sessionId>/ 读写      │
└────────────────┬───────────────────────────────┘
                 │
                 ▼
┌────────────────────────────────────────────────┐
│  Verification Gate                              │
│  必须 verify.json + 关键验证通过才能 complete     │
└────────────────────────────────────────────────┘
```

### 4.3 状态机

```
                 ┌─────────┐
                 │ intake  │
                 └────┬────┘
                      │
                      ▼
                 ┌─────────┐
                 │  plan   │── not approved ──┐
                 └────┬────┘                  │
                      │ approved              │
                      ▼                       │
                 ┌─────────┐                  │
            ┌───▶│ execute │                  │
            │    └────┬────┘                  │
            │         │                       │
            │         ▼                       │
            │    ┌─────────┐                  │
            │    │ verify  │                  │
            │    └────┬────┘                  │
            │         │                       │
            │    ┌────┴────┐                  │
            │    │         │                  │
            │    ▼         ▼                  │
            │ failed?   passed                │
            │    │         │                  │
            │    ▼         ▼                  │
            │ ┌─────────┐ ┌────────┐          │
            └─│ fix-loop│ │complete│          │
              └─────────┘ └────────┘          │
                 retries > N                  │
                      │                       │
                      ▼                       │
                 ┌─────────┐                  │
                 │ failed  │◀─────────────────┘
                 └─────────┘
```

## 5. 文件与状态模型

沿用模块 80 的 `SessionStateManager`，在现有文件集合基础上扩展：

### 5.1 session 目录结构

```
.chainlesschain/sessions/<sessionId>/
├── intent.md          # 目标/边界/非目标/必要澄清
├── plan.md            # 人类可读计划 (含 approved frontmatter)
├── tasks.json         # ⭐ 新增 - 机器可读任务图
├── progress.log       # 追加式执行日志
├── verify.json        # ⭐ 新增 - 验证命令/结果/证据
├── summary.md         # 最终完成摘要
├── artifacts/         # ⭐ 新增 - 测试报告/diff/截图
└── mode.json          # 当前阶段 + 更新时间 + 重试计数
```

### 5.2 `tasks.json` 最小结构

```json
{
  "sessionId": "sess-123",
  "version": 1,
  "stage": "execute",
  "tasks": [
    {
      "id": "task-main-ipc",
      "title": "实现 main 进程 IPC 改动",
      "ownerRole": "executor/main",
      "scopePaths": ["desktop-app-vue/src/main"],
      "dependsOn": [],
      "verifyCommands": ["npm run test:jest -- tests/unit/..."],
      "doneWhen": ["对应 IPC handler 已实现", "单测通过"],
      "status": "pending"
    }
  ]
}
```

### 5.3 `verify.json` 最小结构

```json
{
  "sessionId": "sess-123",
  "status": "failed",
  "checks": [
    { "id": "unit-main", "command": "npm run test:jest -- tests/unit/...", "status": "passed" },
    { "id": "lint", "command": "npm run lint", "status": "failed", "summary": "2 errors in src/main/..." }
  ],
  "nextAction": "fix-loop"
}
```

## 6. Agent 角色与并行策略

### 6.1 4 基础角色

- `planner`
- `executor`
- `tester`
- `reviewer`

### 6.2 角色 + 作用域标签

不横向扩展大量角色，改用"角色 + 作用域标签"表达文件所有权：

- `executor/ui`
- `executor/main`
- `executor/backend`
- `tester/unit`
- `tester/e2e`

### 6.3 单/多 Agent 选择规则

- 单文件或同目录小改动 → `$ralph`
- 涉及 **2 个以上**清晰边界目录 → `$team`
- 验证量 **>** 实现量 → 执行 agent 数量让位给 `tester`

### 6.4 并发上限

| 类型 | 值 | 说明 |
|------|----|----|
| 默认并发 | **3** | `executor/main` + `executor/ui` + `tester` |
| 硬上限 | **6** | 仅保留，不作为默认 |

原因：Electron + Vue + backend + tests 的大 monorepo，Windows/Electron 子进程成本较高，预加载/主进程 IPC/共享状态文件冲突面大。

### 6.5 分配原则

`$team` 不再 round-robin 平均分桶：

1. 先按 `scopePaths` 分配所有权
2. 再按 `dependsOn` 拓扑排序
3. 无依赖且作用域不重叠的任务并行
4. 存在共享文件的任务强制串行

## 7. 验证门禁

### 7.1 Gate 规则

| Gate | 位置 | 逻辑 |
|------|------|------|
| V1: 必须 verify.json | `SessionStateManager.writeSummary` | 未生成 `verify.json` 不能进入 complete |
| V2: 关键验证失败 | verify runner 结束时 | 只能进入 `fix-loop` 或 `failed` |
| V3: 禁止自述完成 | completion handler | 不允许仅凭 agent 自述标记完成 |
| V4: 重试次数上限 | fix-loop 入口 | `mode.json.retries` > N 时自动进入 `failed` |

### 7.2 最小验证矩阵

| 改动范围 | 必须验证 |
|---------|---------|
| `desktop-app-vue/src/renderer` | renderer 单测 + 必要时 lint |
| `desktop-app-vue/src/main` | unit/integration + IPC 回归 |
| `tests/e2e` 或关键流程 | 对应 Playwright 测试 |
| 跨 workspace 改动 | 至少一次根级 lint + 一类目标测试 |

## 8. 对现有模块的收敛策略

### 8.1 保留并强化

| 模块 | 职责 |
|------|------|
| `workflow-command-runner` | 统一自然语言工作流入口 |
| `session-state-manager` | 唯一状态源 |
| `workflow-hook-runner` | 生命周期扩展点 |
| `sub-runtime-pool` | 真实并行执行器 |

### 8.2 降级为能力提供者

| 模块 | 新定位 |
|------|-------|
| `agent-coordinator` | 保留任务分析/能力匹配/结果聚合能力，不再维护独立主线状态 |
| `pipeline-orchestrator` | 保留模板和审批门思路，后续作为上层产品功能消费 canonical workflow |

### 8.3 不立即处理

- P2P agent network
- 远程 team sync
- 去中心化 agent 邀请与联邦运行

这些能力保留，但不进入轻量主线。

## 9. 与 UI 的关系

桌面端逐步统一为"**session 视角**"而非"模块视角"。

最小 UI 能力：

1. 展示当前 session 的阶段
2. 展示 `tasks.json` 中的 ready / running / blocked / completed 任务
3. 展示最近一次 `verify.json`
4. 对失败任务支持"仅重跑失败项"

**不**在首版新做复杂编排画布。已有 `WorkflowMonitor` 和相关 store 可后续复用，但第一步应先消费统一 session 状态。

## 10. 实施顺序

### Phase A: 状态补齐 ✅

**目标**: 在现有 `.chainlesschain/sessions/` 中新增 `tasks.json` 和 `verify.json`，扩展 `mode.json`。

**交付**:
- `SessionStateManager` 新增读写接口 (`readTasks` / `writeTasks` / `readVerify` / `writeVerify`)
- 对应单测

### Phase B: `$team` 拆分升级 ✅

**目标**: 从"平均分步骤"改成"按作用域和依赖分配"。

**交付**:
- `team/handler.js` 读取 `tasks.json`
- `SubRuntimePool.dispatch()` 接受结构化任务分配
- 作用域冲突检测

### Phase C: 验证阶段落地 ✅

**目标**: 将验证从执行提示升级为结构化阶段。

**交付**:
- verify runner
- `verify.json` 写入逻辑
- 验证失败自动回流到 `fix-loop`

### Phase D: UI 收敛 ✅

**目标**: AI Chat / Workflow Monitor 展示 session 级状态。

**交付**:
- session stage 可视化
- task readiness 展示
- verify 结果展示

### Phase E: 智能路由 ✅

**目标**: 根据请求复杂度自动选择 `$ralph` 或 `$team`。

**交付**:
- **Intake classifier** (`desktop-app-vue/src/main/ai-engine/code-agent/intake-classifier.js`) —
  纯函数，输入 `{ request, scopePaths, fileHints, sessionId }`,输出
  `{ decision: "ralph"|"team", confidence, complexity, scopeCount, boundaries, testHeavy,
  signals, reason, recommendedConcurrency, suggestedRoles }`。
  支持 monorepo 边界检测 (`desktop-app-vue/src/main`, `desktop-app-vue/src/renderer`,
  `packages/cli`, `backend/*` 等)。
- **路由规则**: 多作用域 (≥2 个不同 boundary) → `$team`; 单作用域/简单意图 → `$ralph`。
  **非强制门控** — 仅作为 `routingHint` 建议,最终仍由用户 / 上层决策选择执行命令。
- **持久化**: `$deep-interview` 在写入 `intent.md` 后调用 classifier,将 hint 通过
  `SessionStateManager.setRoutingHint()` 合并写入 `mode.json` 的 `routingHint` 字段。
  `_updateMode` 为 merge-write,hint 自动跨阶段存活。
- **IPC 通道**: `workflow-session:classify-intake` — 只读渠道,允许 Renderer 在已有
  session 上二次触发 classifier,自动从 `tasks.json` 的 `scopePaths` 聚合作用域。
- **Renderer 可视化**: `CanonicalWorkflowPanel.vue` 显示 `routingHint` (decision tag /
  complexity / confidence / scopeCount / recommendedConcurrency / reason /
  suggestedRoles)。Pinia store `useWorkflowSessionStore` 暴露 `classifyIntake()` action
  和 `lastClassification` state。
- **非致命降级**: classifier 抛错不会阻塞 `$deep-interview` 的成功写入 —
  `routingHint` 会被记为 `null`,happy path 不变。
- **测试覆盖**: Phase E 共 123+ 测试绿 — intake-classifier 单测 20, workflow-session-ipc
  18, workflow-skills handler 55, store 13, integration 10, E2E 集成 7。

## 11. 风险与缓解

### 11.1 状态重复

**风险**: `workflow` / `pipeline` / `coding-agent` 继续各自维护完成状态，持续产生不一致。

**缓解**: 明确 session state 为唯一主线，所有路径通过 `SessionStateManager` 读写。

### 11.2 子运行时写冲突

**风险**: 并行执行时多 agent 改同一路径产生冲突。

**缓解**:
- 在 `tasks.json` 中引入 `scopePaths`
- dispatch 前先做作用域冲突检测
- 共享文件任务强制串行

### 11.3 验证成本过高

**风险**: 仓库测试面大，盲目全量验证会拖慢执行。

**缓解**:
- 采用目标验证矩阵
- 允许任务级验证和最终汇总验证组合
- `verifyCommands` 精确到文件/目录级别

## 12. 成功标准

满足以下条件，可认为轻量编排主线成立：

1. ✅ 用户在 AI Chat 中可以从一个 session 走完 `plan → execute → verify → fix-loop`
2. ✅ `$team` 可基于结构化任务图并行执行，不再只依赖编号步骤
3. ✅ 完成态必须附带 `verify.json`
4. ✅ UI 与 CLI 读取同一份 session 状态
5. ✅ 新需求不再默认创建新的 orchestration 子系统

## 13. 关键文件

### 保留并强化

- `desktop-app-vue/src/main/ai-engine/code-agent/workflow-command-runner.js`
- `desktop-app-vue/src/main/ai-engine/code-agent/session-state-manager.js`
- `desktop-app-vue/src/main/ai-engine/code-agent/workflow-hook-runner.js`
- `desktop-app-vue/src/main/ai-engine/code-agent/sub-runtime-pool.js`

### Canonical Workflow 技能

- `desktop-app-vue/src/main/ai-engine/cowork/skills/builtin/deep-interview/`
- `desktop-app-vue/src/main/ai-engine/cowork/skills/builtin/ralplan/`
- `desktop-app-vue/src/main/ai-engine/cowork/skills/builtin/ralph/`
- `desktop-app-vue/src/main/ai-engine/cowork/skills/builtin/team/`

### 降级为能力提供者

- `desktop-app-vue/src/main/ai-engine/agents/agent-coordinator.js`
- `desktop-app-vue/src/main/ai-engine/cowork/pipeline-orchestrator.js`

### 运行时产物

- `.chainlesschain/sessions/<sessionId>/{intent.md,plan.md,tasks.json,verify.json,progress.log,summary.md,mode.json,artifacts/}`

## 14. 相关文档

- **ADR 原文**: [docs/implementation-plans/LIGHTWEIGHT_MULTI_AGENT_ORCHESTRATION_ADR.md](../../implementation-plans/LIGHTWEIGHT_MULTI_AGENT_ORCHESTRATION_ADR.md)
- **用户指南**: [docs/features/LIGHTWEIGHT_MULTI_AGENT_ORCHESTRATION.md](../../features/LIGHTWEIGHT_MULTI_AGENT_ORCHESTRATION.md)
- **前置模块**: [80 规范工作流系统](./80_规范工作流系统.md)

## 15. 结论

ChainlessChain 当前最需要的不是"更强的多 agent 功能面"，而是"**更少的主线、更硬的验证、更清晰的状态归属**"。

因此，本模块选择：

- 不新增第 4 套编排器
- 直接沿现有 canonical workflow 扩展
- 用 `tasks.json + verify.json` 把"计划"和"完成"都结构化
- 用 `sub-runtime-pool` 承担真实并行执行

这是当前代码现实下**成本最低、收益最高、最容易持续演进**的一条路径。
