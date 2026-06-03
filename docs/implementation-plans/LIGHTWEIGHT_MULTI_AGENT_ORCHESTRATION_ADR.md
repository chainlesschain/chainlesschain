# ChainlessChain 轻量多 Agent 编排 ADR

## 1. 文档信息

- 项目: `chainlesschain`
- 主题: 在现有 Coding Agent / Cowork / Workflow 基础上收敛出一条轻量、可验证、可迭代的多 agent 编排主线
- 日期: `2026-04-09`
- 状态: **已实施** — Phase A / B / C / D / E 五阶段全部落地,共 123+ 单元/集成/E2E 测试绿
- 最后更新: `2026-04-09` — Phase E (intake classifier + routingHint 持久化 + UI 可视化) 关闭 ADR

## 2. 背景

当前仓库已经存在多条与 agent 编排相关的实现路径：

- 轻量文件驱动工作流
  - `desktop-app-vue/src/main/ai-engine/code-agent/session-state-manager.js`
  - `desktop-app-vue/src/main/ai-engine/code-agent/workflow-hook-runner.js`
  - `desktop-app-vue/src/main/ai-engine/code-agent/workflow-command-runner.js`
- Coding Agent canonical workflow 技能
  - `desktop-app-vue/src/main/ai-engine/cowork/skills/builtin/deep-interview/`
  - `desktop-app-vue/src/main/ai-engine/cowork/skills/builtin/ralplan/`
  - `desktop-app-vue/src/main/ai-engine/cowork/skills/builtin/ralph/`
  - `desktop-app-vue/src/main/ai-engine/cowork/skills/builtin/team/`
- 真实并行子运行时
  - `desktop-app-vue/src/main/ai-engine/code-agent/sub-runtime-pool.js`
- 较重的旧编排层
  - `desktop-app-vue/src/main/ai-engine/agents/agent-coordinator.js`
  - `desktop-app-vue/src/main/ai-engine/cowork/pipeline-orchestrator.js`

问题不在于“缺少编排器”，而在于“已经有多套编排思路并行演化”，具体表现为：

1. 状态分散
   - `workflow`、`cowork`、`coding-agent`、`pipeline` 各自维护自己的状态模型。
2. 执行入口分散
   - 有自然语言工作流命令、有 IPC 工作流、有多 agent 协作页、有独立 pipeline。
3. 并行执行粒度过粗
   - `$team` 当前主要按 `plan.md` 的编号步骤平均分配，缺少基于代码作用域和依赖的拆分。
4. 完成定义不统一
   - 有些路径强调“生成结果”，有些路径强调“工作流状态”，但未统一落到“验证证据”。

因此，本 ADR 的目标不是新增第 4 套 orchestrator，而是收敛主线。

## 3. 决策

采用“轻量文件驱动编排主线”作为 ChainlessChain 的默认多 agent 编排方案。

核心决策如下：

1. 以 `workflow-command-runner` 为统一工作流入口。
2. 以 `.chainlesschain/sessions/<sessionId>/` 为唯一编排状态源。
3. 以 `$deep-interview -> $ralplan -> $ralph / $team -> verify -> fix-loop` 为 canonical workflow。
4. 以 `sub-runtime-pool` 为默认并行执行器，不新增另一套并行 runtime。
5. `agent-coordinator` 和 `pipeline-orchestrator` 暂不扩张为新的主线，只作为后续可复用能力来源。

## 4. 设计目标

### 4.1 主目标

- 一条主线覆盖从需求澄清、计划、执行到验证
- 对 monorepo 多模块改动可控并行
- 默认可恢复、可审计、可验证
- 对桌面端 UI 和 CLI 都能共用同一套状态模型

### 4.2 非目标

- 不做 OMC 风格的大量 magic keywords
- 不在首版引入远程 agent / P2P 团队执行
- 不引入常驻 daemon 式 agent swarm
- 不再创建新的重型 orchestration service

## 5. 主线流程

建议将当前 4 段式 canonical workflow 扩展为 5 段式：

1. `intake`
   - 判断是否直接执行，或进入需求澄清
2. `plan`
   - 写入 `intent.md`、`plan.md`，并生成机器可读任务图
3. `execute`
   - 小任务走 `$ralph`
   - 跨模块任务走 `$team`
4. `verify`
   - 执行验证命令，产出结构化验证结果
5. `fix-loop`
   - 仅回流失败任务，最多重试有限次数

推荐的状态机如下：

```text
intake
  -> plan
  -> execute
  -> verify
  -> complete
  -> fix-loop -> execute
  -> failed
```

## 6. 状态与文件模型

沿用现有 `SessionStateManager`，但将状态文件从当前最小集合扩展为：

```text
.chainlesschain/sessions/<sessionId>/
  intent.md
  plan.md
  tasks.json
  progress.log
  verify.json
  summary.md
  artifacts/
  mode.json
```

### 6.1 文件职责

- `intent.md`
  - 记录目标、边界、非目标、必要澄清
- `plan.md`
  - 面向人类阅读的实现计划，保留 `approved: true|false`
- `tasks.json`
  - 面向编排器执行的任务图
- `progress.log`
  - 追加式执行日志
- `verify.json`
  - 验证命令、结果、证据、失败原因
- `summary.md`
  - 最终面向用户/开发者的完成摘要
- `artifacts/`
  - 测试报告、日志摘录、diff 摘要、截图等
- `mode.json`
  - 当前阶段、更新时间、重试计数

### 6.2 `tasks.json` 最小结构

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
      "scopePaths": [
        "desktop-app-vue/src/main"
      ],
      "dependsOn": [],
      "verifyCommands": [
        "npm run test:jest -- tests/unit/..."
      ],
      "doneWhen": [
        "对应 IPC handler 已实现",
        "单测通过"
      ],
      "status": "pending"
    }
  ]
}
```

## 7. Agent 角色

首版只保留 4 个基础角色：

- `planner`
- `executor`
- `tester`
- `reviewer`

对于本仓库的多模块特征，不建议继续横向扩展大量角色，而是采用“角色 + 作用域标签”：

- `executor/ui`
- `executor/main`
- `executor/backend`
- `tester/unit`
- `tester/e2e`

这样可以复用现有 `$team` 的角色校验思路，同时把文件所有权表达清楚。

## 8. 执行策略

### 8.1 单 agent 与多 agent 选择

默认规则：

- 单文件或同一目录内的小改动: `$ralph`
- 涉及 2 个以上清晰边界目录: `$team`
- 涉及验证量明显大于实现量: 执行 agent 数量优先让位给 `tester`

### 8.2 并发上限

建议默认并发上限设为 `3`：

- `executor/main`
- `executor/ui`
- `tester`

原因：

- 本仓库是 Electron + Vue + backend + tests 的大 monorepo
- Windows / Electron 子进程成本较高
- 预加载、主进程 IPC、共享状态文件的冲突面较大

`6` 可作为硬上限保留，但不作为默认值。

### 8.3 分配原则

`$team` 不应继续只做 round-robin 平均分桶，应改为：

1. 先按 `scopePaths` 分配所有权
2. 再按 `dependsOn` 拓扑排序
3. 无依赖且作用域不重叠的任务并行
4. 存在共享文件的任务强制串行

## 9. 验证门禁

编排的完成定义必须从“生成了结果”切换到“收集了验证证据”。

建议在现有 `coding-agent-permission-gate` 之外，新增完成门禁：

- 未生成 `verify.json`，不能进入 `complete`
- 关键验证失败，只能进入 `fix-loop` 或 `failed`
- 不允许仅凭 agent 自述标记完成

### 9.1 最小验证矩阵

- 修改 `desktop-app-vue/src/renderer`
  - 相关 renderer 单测
  - 必要时跑 lint
- 修改 `desktop-app-vue/src/main`
  - 相关 unit/integration
  - IPC 回归
- 修改 `tests/e2e` 或关键流程
  - 对应 Playwright 测试
- 跨 workspace 改动
  - 至少一次根级 lint
  - 至少一类目标测试

### 9.2 `verify.json` 最小结构

```json
{
  "sessionId": "sess-123",
  "status": "failed",
  "checks": [
    {
      "id": "unit-main",
      "command": "npm run test:jest -- tests/unit/...",
      "status": "passed"
    },
    {
      "id": "lint",
      "command": "npm run lint",
      "status": "failed",
      "summary": "2 errors in desktop-app-vue/src/main/..."
    }
  ],
  "nextAction": "fix-loop"
}
```

## 10. 对现有模块的收敛策略

### 10.1 保留并强化

- `workflow-command-runner`
  - 统一自然语言工作流入口
- `session-state-manager`
  - 唯一状态源
- `workflow-hook-runner`
  - 生命周期扩展点
- `sub-runtime-pool`
  - 真实并行执行器

### 10.2 降级为能力提供者

- `agent-coordinator`
  - 保留任务分析、能力匹配、结果聚合能力
  - 不再维护独立主线状态
- `pipeline-orchestrator`
  - 保留模板和审批门思路
  - 后续可作为上层产品功能消费 canonical workflow

### 10.3 不立即处理

- P2P agent network
- 远程 team sync
- 去中心化 agent 邀请和联邦运行

这些能力保留，但不进入轻量主线。

## 11. 与 UI 的关系

桌面端建议逐步统一为“session 视角”而不是“模块视角”。

最小 UI 能力：

1. 展示当前 session 的阶段
2. 展示 `tasks.json` 中的 ready/running/blocked/completed 任务
3. 展示最近一次 `verify.json`
4. 对失败任务支持“仅重跑失败项”

不建议首版新做复杂编排画布。已有 `WorkflowMonitor` 和相关 store 可后续复用，但第一步应先消费统一 session 状态。

## 12. 实施顺序

### Phase A: 状态补齐 ✅

目标：

- 在现有 `.chainlesschain/sessions/` 中新增 `tasks.json` 和 `verify.json`
- 扩展 `mode.json` 以记录 `verify` / `fix-loop`

交付：

- `SessionStateManager` 新增读写接口
- 对应单测

### Phase B: `$team` 拆分升级 ✅

目标：

- 从“平均分步骤”改成“按作用域和依赖分配”

交付：

- `team/handler.js` 读取 `tasks.json`
- `SubRuntimePool.dispatch()` 接受结构化任务分配

### Phase C: 验证阶段落地 ✅

目标：

- 将验证从执行提示升级为结构化阶段

交付：

- verify runner
- `verify.json`
- 验证失败自动回流到 `fix-loop`

### Phase D: UI 收敛 ✅

目标：

- AI Chat / Workflow Monitor 展示 session 级状态

交付：

- session stage 可视化
- task readiness 展示
- verify 结果展示

### Phase E: 智能路由 ✅

目标：

- 根据请求复杂度自动选择 `$ralph` 或 `$team`
- 提示型、非门控 —— 用户/LLM 可以忽略建议

交付（已完成）：

- **intake classifier** —— 纯函数启发式
  - 文件: `desktop-app-vue/src/main/ai-engine/code-agent/intake-classifier.js`
  - 输入: `{ request, scopePaths, fileHints, sessionId, tasks, concurrency }`
  - 输出: `{ decision, confidence, complexity, scopeCount, boundaries, testHeavy, signals, reason, recommendedConcurrency, suggestedRoles }`
  - 路由规则:
    1. `scopeCount >= 2` → `team` (high confidence)
    2. 文本命中 cross-cutting phrases (`main and renderer` / `across modules` / `both X and Y`) → `team` (low confidence)
    3. 命中 trivial phrases (`typo` / `rename` / `whitespace` / `docstring`) → `ralph` (high)
    4. 单 scope 明确 → `ralph` (high)
    5. 默认 → `ralph` (medium)
  - Monorepo 边界桶: `desktop-app-vue/src/main`, `desktop-app-vue/src/renderer`, `packages/cli/src`, `backend/project-service`, `android-app` 等 11 个预定义边界

- **IPC 通道** —— read-only 暴露
  - 文件: `desktop-app-vue/src/main/ai-engine/code-agent/workflow-session-ipc.js`
  - 新增通道: `workflow-session:classify-intake`
  - 当 `input.sessionId` 存在时自动富化 `tasks.json` 中的 `scopePaths`

- **`$deep-interview` 集成 + 持久化**
  - 文件: `desktop-app-vue/src/main/ai-engine/cowork/skills/builtin/deep-interview/handler.js`
  - 写完 `intent.md` 后调用 `classifyIntake()`,将结果通过 `SessionStateManager.setRoutingHint(sessionId, hint)` 合并写入 `mode.json`
  - 分类器抛错为非致命,结果降级为 `routingHint: null`
  - 返回值 `result.routingHint` 同时暴露给 `message` 和 `guidance` 字段

- **Renderer 集成**
  - Preload: `src/preload/index.js` 新增 `workflowSession.classifyIntake`
  - Pinia: `src/renderer/stores/workflow-session.ts` 新增 `classifyIntake` action + `lastClassification` 状态
  - UI: `src/renderer/components/workflow/CanonicalWorkflowPanel.vue` 新增 `routingHint` 展示面板 (decision tag、complexity/confidence chip、scopeCount、reason、suggestedRoles)

- **跨阶段不变式**
  - `_updateMode` merge-write 天然保证 `routingHint` 跨 stage 迁移(`intent → plan → execute → verify`)不丢失
  - Classifier 永不写 session 状态 —— 仅由 `$deep-interview` 作为副作用持久化
  - 所有写路径仍走 skill handler,Gates V1/V3/V4 保持唯一授权路径

- **测试覆盖** —— 共 123+ tests 全绿
  - Unit: `intake-classifier.test.js` (20) + `workflow-session-ipc.test.js` (18) + `workflow-session.test.ts` (13) + `workflow-skills.test.js` deep-interview 分组 (7)
  - Integration: `coding-workflow.integration.test.js` Phase E 分组 (5)
  - E2E: `canonical-workflow-phase-e.integration.test.js` (7) —— handler → fs → IPC → preload shim → Pinia store 全链路

## 13. 风险

### 13.1 状态重复

如果 `workflow`、`pipeline`、`coding-agent` 继续各自维护完成状态，后续会持续产生不一致。

缓解：

- 明确 session state 为唯一主线

### 13.2 子运行时写冲突

并行执行时多 agent 改同一路径会产生冲突。

缓解：

- 在 `tasks.json` 中引入 `scopePaths`
- dispatch 前先做作用域冲突检测

### 13.3 验证成本过高

仓库测试面较大，盲目全量验证会拖慢执行。

缓解：

- 采用目标验证矩阵
- 允许任务级验证和最终汇总验证组合

## 14. 成功标准

满足以下条件，可认为轻量编排主线成立：

1. 用户在 AI Chat 中可以从一个 session 走完 `plan -> execute -> verify -> fix-loop`
2. `$team` 可基于结构化任务图并行执行，不再只依赖编号步骤
3. 完成态必须附带 `verify.json`
4. UI 与 CLI 读取同一份 session 状态
5. 新需求不再默认创建新的 orchestration 子系统

## 15. 结论

ChainlessChain 当前最需要的不是“更强的多 agent 功能面”，而是“更少的主线、更硬的验证、更清晰的状态归属”。

因此，本 ADR 选择：

- 不新增第 4 套编排器
- 直接沿现有 canonical workflow 扩展
- 用 `tasks.json + verify.json` 把“计划”和“完成”都结构化
- 用 `sub-runtime-pool` 承担真实并行执行

这是当前代码现实下成本最低、收益最高、最容易持续演进的一条路径。
