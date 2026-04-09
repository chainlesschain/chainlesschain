# 轻量多 Agent 编排 - 用户使用指南

> **版本**: v1.0 (提议) | **日期**: 2026-04-09 | **状态**: ADR 提议中
> **ADR 原文**: [LIGHTWEIGHT_MULTI_AGENT_ORCHESTRATION_ADR](../implementation-plans/LIGHTWEIGHT_MULTI_AGENT_ORCHESTRATION_ADR.md)

---

## 📋 目录

1. [概述](#概述)
2. [核心特性](#核心特性)
3. [系统架构](#系统架构)
4. [使用示例](#使用示例)
5. [故障排查](#故障排查)
6. [安全考虑](#安全考虑)
7. [关键文件](#关键文件)

---

## 概述

ChainlessChain 当前已有多条与 agent 编排相关的实现（workflow / cowork / coding-agent / pipeline），各自维护状态模型与入口，导致状态分散、完成定义不统一、并行粒度过粗。

"轻量多 Agent 编排"不再新增第四套 orchestrator，而是**收敛主线**：以 `workflow-command-runner` 为统一入口，以 `.chainlesschain/sessions/<sessionId>/` 为唯一状态源，以 `sub-runtime-pool` 为默认并行执行器，把 canonical workflow 从 4 段式扩展为 **5 段式**：

```
intake → plan → execute → verify → complete
                              ↓
                           fix-loop → execute
                              ↓
                           failed
```

**核心思想**：
- 不追求"更强的多 agent 功能面"
- 追求"更少的主线、更硬的验证、更清晰的状态归属"
- 完成态必须附带 `verify.json`，禁止仅凭 agent 自述标记完成

---

## 核心特性

### 1. 统一状态源 — `.chainlesschain/sessions/<sessionId>/`

所有阶段产物归一到一个 session 目录：

| 文件 | 用途 |
|------|------|
| `intent.md` | 目标、边界、非目标、必要澄清 |
| `plan.md` | 面向人类的实现计划（含 `approved: true/false` frontmatter） |
| `tasks.json` | 面向编排器的机器可读任务图 |
| `progress.log` | 追加式执行日志 |
| `verify.json` | 验证命令、结果、证据、失败原因 |
| `summary.md` | 最终完成摘要 |
| `artifacts/` | 测试报告、diff 摘要、截图等 |
| `mode.json` | 当前阶段、更新时间、重试计数 |

### 2. 五段式 Canonical Workflow

- **intake** — 判断是否直接执行，或进入需求澄清
- **plan** — 写入 `intent.md`、`plan.md`，生成机器可读 `tasks.json`
- **execute** — 小任务走 `$ralph`，跨模块任务走 `$team`
- **verify** — 执行验证命令，产出结构化 `verify.json`
- **fix-loop** — 仅回流失败任务，最多重试有限次数

### 3. 基于作用域与依赖的并行拆分

`$team` 不再做 round-robin 平均分桶，改为：

1. 先按 `scopePaths` 分配所有权
2. 再按 `dependsOn` 拓扑排序
3. 无依赖且作用域不重叠的任务并行
4. 存在共享文件的任务强制串行

**默认并发上限**: `3`（`executor/main` + `executor/ui` + `tester`），硬上限 `6`。

### 4. 4 角色 × 作用域标签

首版只保留 4 个基础角色：`planner` / `executor` / `tester` / `reviewer`。多模块场景通过"角色 + 作用域标签"区分：

- `executor/ui` / `executor/main` / `executor/backend`
- `tester/unit` / `tester/e2e`

### 5. 验证门禁 — Verification Gate

完成定义从"生成了结果"切换到"收集了验证证据"：

- 未生成 `verify.json` → **不能进入** `complete`
- 关键验证失败 → **只能进入** `fix-loop` 或 `failed`
- **不允许**仅凭 agent 自述标记完成

### 6. 可恢复、可审计、可验证

session 状态持久化到磁盘，桌面端 UI 与 CLI 读取同一份状态，任何阶段中断都可从文件恢复。

---

## 系统架构

### 分层结构

```
┌─────────────────────────────────────────────────┐
│  用户入口 (AI Chat / CLI)                        │
└─────────────────┬───────────────────────────────┘
                  │ 自然语言指令
                  ▼
┌─────────────────────────────────────────────────┐
│  workflow-command-runner  (统一工作流入口)        │
└─────────────────┬───────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────┐
│  Canonical Workflow 5 阶段                       │
│  intake → plan → execute → verify → fix-loop    │
└─────┬───────────────┬───────────────────────────┘
      │               │
      ▼               ▼
┌──────────┐    ┌──────────────────────────┐
│ $ralph   │    │ $team + sub-runtime-pool │
│ (单任务)  │    │ (按 scopePaths 并行)      │
└─────┬────┘    └──────────┬───────────────┘
      │                    │
      ▼                    ▼
┌─────────────────────────────────────────────────┐
│  SessionStateManager                             │
│  .chainlesschain/sessions/<sessionId>/ 读写      │
└─────────────────┬───────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────┐
│  Verification Gate                               │
│  verify.json + 验证矩阵                          │
└─────────────────────────────────────────────────┘
```

### 最小验证矩阵

| 改动范围 | 必须验证 |
|---------|---------|
| `desktop-app-vue/src/renderer` | renderer 单测 + 必要时 lint |
| `desktop-app-vue/src/main` | unit/integration + IPC 回归 |
| `tests/e2e` 或关键流程 | 对应 Playwright 测试 |
| 跨 workspace 改动 | 至少一次根级 lint + 一类目标测试 |

### 收敛策略

| 模块 | 定位 |
|------|------|
| `workflow-command-runner` | ✅ **保留强化** — 统一入口 |
| `session-state-manager` | ✅ **保留强化** — 唯一状态源 |
| `workflow-hook-runner` | ✅ **保留强化** — 生命周期扩展点 |
| `sub-runtime-pool` | ✅ **保留强化** — 真实并行执行器 |
| `agent-coordinator` | ⬇ **降级** — 仅作为能力提供者（任务分析/匹配/聚合） |
| `pipeline-orchestrator` | ⬇ **降级** — 保留模板与审批门，不维护主线状态 |
| P2P agent network | ⏸ **暂不处理** |
| 远程 team sync | ⏸ **暂不处理** |

---

## 使用示例

### 示例 1: 小范围改动（单 agent 路径）

```
User: 修复 desktop-app-vue/src/main/utils/logger.js 的时区 bug

AI Chat 流程:
1. intake   → 判定为小范围单文件改动
2. plan     → 写入 intent.md + plan.md (approved:true)
3. execute  → $ralph 直接执行
4. verify   → 运行 tests/unit/utils/logger.test.js
5. complete → 生成 verify.json + summary.md
```

### 示例 2: 跨模块改动（多 agent 并行）

```
User: 在 MCP Settings 页面加一个"导出配置"按钮，要带主进程 IPC + 单测

AI Chat 流程:
1. intake   → 判定跨 main/renderer
2. plan     → 生成 tasks.json:
              - task-main-ipc    (scope: src/main/mcp)
              - task-ui-button   (scope: src/renderer/components/MCPSettings.vue)
              - task-unit-test   (scope: tests/unit/mcp, depends: [task-main-ipc])
3. execute  → $team 分派到 sub-runtime-pool:
              - executor/main  并行跑 task-main-ipc
              - executor/ui    并行跑 task-ui-button
              - tester/unit    在 task-main-ipc 完成后串行跑 task-unit-test
4. verify   → 按最小验证矩阵执行
5. complete → 生成 verify.json
```

### 示例 3: 验证失败自动回流

```
verify 阶段报告 lint 失败 →
  mode.json.stage = "fix-loop"
  retries += 1 (最多 N 次)
  仅对失败任务重跑 $ralph → verify → complete | failed
```

### 示例 4: `tasks.json` 最小结构

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

### 示例 5: `verify.json` 最小结构

```json
{
  "sessionId": "sess-123",
  "status": "failed",
  "checks": [
    { "id": "unit-main", "command": "npm run test:jest -- tests/unit/...", "status": "passed" },
    { "id": "lint", "command": "npm run lint", "status": "failed", "summary": "2 errors in desktop-app-vue/src/main/..." }
  ],
  "nextAction": "fix-loop"
}
```

---

## 故障排查

### Issue: session 状态不一致 — 同一需求出现在多个子系统

**症状**: workflow 显示完成，但 coding-agent 仍有活跃会话

**原因**: 旧的 `agent-coordinator` 或 `pipeline-orchestrator` 仍维护独立主线状态

**解决**: 本 ADR 实施后，确保所有编排路径都通过 `SessionStateManager` 读写；`agent-coordinator` 降级为能力提供者，不再产生独立 session。

---

### Issue: 并行子运行时写冲突

**症状**: 两个 executor 同时修改 `package.json`，后者覆盖前者

**原因**: `tasks.json` 未声明 `scopePaths`，或 dispatch 前未做作用域冲突检测

**解决**:
1. 在 `tasks.json` 中为每个任务显式声明 `scopePaths`
2. `$team` dispatch 前检测作用域重叠，有共享文件的任务强制串行
3. 参考 `sub-runtime-pool.js` 的作用域冲突检测逻辑

---

### Issue: 验证成本过高，全量测试跑不完

**症状**: verify 阶段耗时远超执行阶段

**原因**: 盲目全量验证

**解决**:
1. 按最小验证矩阵针对性选择测试
2. 任务级验证 + 最终汇总验证组合
3. `verifyCommands` 字段精确到文件/目录级别，而非全项目

---

### Issue: 完成态被 agent 自述标记

**症状**: session 显示 complete 但未生成 `verify.json`

**原因**: 验证门禁未生效

**解决**:
1. 在 `SessionStateManager.writeSummary()` 前强制检查 `verify.json` 存在
2. 关键验证失败时自动切换到 `fix-loop` 阶段，不允许直接 complete

---

### Issue: UI 展示与 CLI 状态不同步

**症状**: WorkflowMonitor 显示 running，CLI 查询显示 complete

**原因**: UI 直接读取了旧的 store 状态，未消费统一 session 文件

**解决**: 桌面端 UI 应直接读取 `.chainlesschain/sessions/<sessionId>/mode.json`，不维护独立状态缓存。

---

## 安全考虑

### 1. SessionId 路径穿越防护

- `sessionId` 必须通过 `safeSessionId` 正则校验：`^[A-Za-z0-9._-]+$`
- 禁止 `..`、`/`、`\` 等路径分隔符
- 继承自 G4: sessionId 安全门

### 2. 验证门禁防绕过

- 完成状态写入必须由 `SessionStateManager` 托管，agent 不能直接写 `mode.json`
- `verify.json` 缺失或关键失败时，拒绝 `complete` 状态转移
- 所有状态转移记录到 `progress.log`，便于审计

### 3. 子运行时权限隔离

- `sub-runtime-pool` 的每个子进程继承 `coding-agent-permission-gate` 权限策略
- 并行 executor 的工具白名单与父 session 一致
- 禁止子 agent 绕过权限审批直接调用高危工具

### 4. 作用域冲突与文件锁

- `scopePaths` 作为软锁，dispatch 前检测重叠
- 共享 `package.json` / `yarn.lock` / 配置文件的任务强制串行
- 并行写入冲突由作用域检测预防，而非事后回滚

### 5. 验证命令执行安全

- `verifyCommands` 在子进程中执行，继承受限 PATH
- 禁止动态拼接 shell 命令，使用参数数组形式
- 超时熔断：验证命令默认 5 分钟超时，防止 hang

### 6. 重试次数上限

- `fix-loop` 最多重试 N 次（建议 3 次），防止无限循环消耗 token
- 每次重试写入 `mode.json.retries`，超限自动进入 `failed`

---

## 关键文件

### 保留并强化

| 文件 | 职责 |
|------|------|
| `desktop-app-vue/src/main/ai-engine/code-agent/workflow-command-runner.js` | 统一工作流入口 |
| `desktop-app-vue/src/main/ai-engine/code-agent/session-state-manager.js` | 唯一状态源（读写 session 目录） |
| `desktop-app-vue/src/main/ai-engine/code-agent/workflow-hook-runner.js` | 生命周期扩展点 |
| `desktop-app-vue/src/main/ai-engine/code-agent/sub-runtime-pool.js` | 真实并行执行器 |

### Canonical Workflow 技能

| 文件 | 职责 |
|------|------|
| `desktop-app-vue/src/main/ai-engine/cowork/skills/builtin/deep-interview/` | 需求澄清 |
| `desktop-app-vue/src/main/ai-engine/cowork/skills/builtin/ralplan/` | 计划生成与审批 |
| `desktop-app-vue/src/main/ai-engine/cowork/skills/builtin/ralph/` | 单任务执行 |
| `desktop-app-vue/src/main/ai-engine/cowork/skills/builtin/team/` | 多 agent 并行分派 |

### 降级为能力提供者

| 文件 | 新定位 |
|------|-------|
| `desktop-app-vue/src/main/ai-engine/agents/agent-coordinator.js` | 仅提供任务分析/匹配/聚合能力，不维护主线状态 |
| `desktop-app-vue/src/main/ai-engine/cowork/pipeline-orchestrator.js` | 仅保留模板与审批门，作为上层产品功能 |

### 运行时产物

| 路径 | 说明 |
|------|------|
| `.chainlesschain/sessions/<sessionId>/intent.md` | 目标与边界 |
| `.chainlesschain/sessions/<sessionId>/plan.md` | 实现计划 (含 `approved` frontmatter) |
| `.chainlesschain/sessions/<sessionId>/tasks.json` | 机器可读任务图 |
| `.chainlesschain/sessions/<sessionId>/verify.json` | 验证证据 |
| `.chainlesschain/sessions/<sessionId>/progress.log` | 追加式日志 |
| `.chainlesschain/sessions/<sessionId>/summary.md` | 完成摘要 |
| `.chainlesschain/sessions/<sessionId>/mode.json` | 当前阶段 + 重试计数 |
| `.chainlesschain/sessions/<sessionId>/artifacts/` | 测试报告/diff/截图 |

### 相关文档

- **ADR 原文**: [docs/implementation-plans/LIGHTWEIGHT_MULTI_AGENT_ORCHESTRATION_ADR.md](../implementation-plans/LIGHTWEIGHT_MULTI_AGENT_ORCHESTRATION_ADR.md)
- **设计文档**: [docs/design/modules/81_轻量多Agent编排系统.md](../design/modules/81_轻量多Agent编排系统.md)
- **前置模块**: [80_规范工作流系统.md](../design/modules/80_规范工作流系统.md)
