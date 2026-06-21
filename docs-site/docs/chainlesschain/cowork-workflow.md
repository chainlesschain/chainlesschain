# Cowork 动态工作流引擎

> **版本: v1.3 (CLI cowork-workflow) | 状态: ✅ 生产就绪 | 引擎 1433 行 | 表达式沙箱 664 行 | 158 测试 | ~90% 覆盖率**
>
> 在 Cowork 多智能体协作系统之上提供**声明式动态工作流**能力：把多个 Cowork 任务编排成 DAG，支持条件门控（`when`）、运行时扇出（`forEach`）、依赖并行、每步重试/超时、`while`/`until` 循环节点，以及无屏障流水线调度。所有表达式经手写解析器求值，**无 `eval`/`Function`**。

## 概述

Cowork 动态工作流引擎（`cowork-workflow.js`）让你用一份 JSON 声明把若干 Cowork 任务串成有依赖关系的工作流，由执行器自动拓扑排序、按依赖并行、在步骤间传递结果，并在失败时按策略停止或继续。它是 Cowork 系统里**真正执行多步编排**的引擎（区别于持久化骨架 `workflow-engine.js`），通过 `cc cowork workflow add/run` 暴露给用户，工作流以单文件形式持久化在 `.chainlesschain/cowork/workflows/<id>.json`。

每个步骤（step）调用一个 Cowork 模板（或自由模式），其消息可以用 `${step.<id>.<field>}` 占位符引用前序步骤的产出。引擎在此基础上叠加了一整套动态控制流：运行时条件、运行时数据扇出、循环、健壮性（重试/超时）与两种调度策略（依赖层级批次 / 无屏障流水线）。

## 核心特性

- 🧩 **DAG 编排**: `dependsOn` 声明依赖，Kahn 拓扑排序，自动检测环
- ⚡ **依赖并行**: 同层独立步骤并发执行，`maxParallel` 限并发
- 🔀 **条件门控 `when`**: 运行时按表达式跳过步骤（如 `${step.scan.status} == 'completed'`）
- 📡 **运行时扇出 `forEach`**: 对字面数组**或** `${step.x.items}` 运行时引用展开成 N 个并发子任务（`MAX_FAN_OUT=500` 上限）
- 🔁 **循环节点 `loopWhile` / `loopUntil`**: post-test 重复某步骤直到条件满足（`MAX_LOOP_ITERATIONS=100` 兜底）
- 🛡️ **每步重试 / 超时**: `retries` + `retryBackoff`（fixed/exponential）+ `timeoutMs`，瞬态失败自动重试而非整体 halt
- 🚇 **无屏障流水线**: opt-in `pipeline` 模式——每步在**自己的**依赖一完成就启动，去掉依赖层级间的空等
- 🧷 **失败策略**: 默认首失败即停（在飞任务跑完），`continueOnError` 继续并产出 `partial`
- 🔗 **结果传递**: `${step.<id>.summary/status/taskId/...}` 占位符 + forEach 父聚合，跨步骤/跨层可见
- 🔒 **安全表达式**: 手写 tokenizer + 递归下降解析器求值 `when`/循环条件，**杜绝 `eval`/`Function` 注入**
- 🗃️ **持久化 + 历史**: 工作流存 JSON，每次执行追加到 `workflow-history.jsonl`
- 🏛️ **V2 治理叠加**: profile / step 生命周期状态机 + 配额（最大活跃/挂起、空闲自动暂停、卡死自动失败）

## 系统架构

```
┌─────────────────────────────────────────────────────────────────┐
│                      executeWorkflow(options)                     │
│                                                                   │
│  validateWorkflow ──► id/name/steps · dependsOn 存在性 · 环检测   │
│        │              retry/timeout/loop 字段合法性               │
│        ▼                                                          │
│   ┌─────────────────────────┐        ┌──────────────────────────┐ │
│   │  批次模式 (默认)         │   或    │  流水线模式 (pipeline:true)│ │
│   │  planBatches → 依赖层级   │        │  runPipeline             │ │
│   │  每层 Promise.all 屏障   │        │  每步 deps 完成即启动     │ │
│   │  层 N 全完 → 层 N+1      │        │  maxParallel 限并发 step  │ │
│   └───────────┬─────────────┘        └─────────────┬────────────┘ │
│               └──────────────┬─────────────────────┘              │
│                              ▼                                    │
│                       runStepNode(step)                          │
│          when-gate ─► loop ─► forEach ─► plain                    │
│                              │                                    │
│                     runStepWithRetry  (retries + timeoutMs)       │
│                              │                                    │
│                       _deps.runTask   (注入 = runCoworkTask)      │
│                              ▼                                    │
│        resultsById (Map)  ──►  ${step.<id>.<field>} 占位替换      │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
        record { workflowId, status, steps[], startedAt, finishedAt }
                    └──► .chainlesschain/cowork/workflow-history.jsonl
```

**批次 vs 流水线**：批次模式按依赖层级同步——层 N 的每个步骤都完成后才进入层 N+1，一个慢步骤会拖住整层后续无关工作；流水线模式让每个步骤在它**自己的**依赖一满足就启动，墙钟时间约等于最长依赖链而非各层最慢之和。两者产出**相同的 outcome 集**，只是去掉了层间空等。

`_deps.runTask` 由 CLI 注入（`runCoworkTask`），避免与 `cowork-task-runner.js` 的循环依赖；单测里替换为 stub 实现确定性测试。

## 步骤 Schema 完整参考

每个工作流是 `{ id, name, steps: [...] }`；`pipeline: true` 可放在工作流顶层。每个 step 字段：

| 字段            | 类型                         | 必填 | 说明                                                                                     |
| --------------- | ---------------------------- | ---- | ---------------------------------------------------------------------------------------- |
| `id`            | string                       | ✅   | 步骤唯一标识（工作流内不重复）                                                           |
| `message`       | string                       | ✅   | 任务消息，可含 `${step.<id>.<field>}` / `${item}` / `${self.<field>}` / `${iter}` 占位符 |
| `templateId`    | string                       | —    | Cowork 模板 id（缺省为自由模式 `null`）                                                  |
| `files`         | string[]                     | —    | 传给任务的文件列表                                                                       |
| `dependsOn`     | string[]                     | —    | 依赖的步骤 id（必须存在，不能成环）                                                      |
| `when`          | string                       | —    | 条件表达式；为假则跳过（状态 `skipped`，summary `when-condition false`）                 |
| `forEach`       | array \| string              | —    | 数组字面量，或 `${step.<id>.items}` 运行时引用，展开成并发子任务（与 `loop*` 互斥）      |
| `retries`       | int ≥ 0                      | —    | 首次外的额外尝试次数                                                                     |
| `timeoutMs`     | number > 0                   | —    | 每次尝试的超时                                                                           |
| `retryDelayMs`  | number ≥ 0                   | —    | 每次重试前的基础延迟                                                                     |
| `retryBackoff`  | `"fixed"` \| `"exponential"` | —    | 退避策略（默认 `fixed`；指数 = base · 2^(尝试-1)）                                       |
| `loopWhile`     | string                       | —    | 循环条件：表达式为真则继续（与 `loopUntil` 互斥、与 `forEach` 互斥）                     |
| `loopUntil`     | string                       | —    | 循环条件：表达式为真则停止                                                               |
| `maxIterations` | int > 0                      | —    | 循环上限（钳制到 `MAX_LOOP_ITERATIONS=100`）                                             |

**步骤产出（outcome）** 形如 `{ id, status, taskId, result }`，`status ∈ { completed, failed, skipped, partial }`：

- 重试发生时 `result.attempts` = 总尝试次数（单次尝试不加该字段，保持形状稳定）
- 循环节点 `result` 带 `iterations` / `loopExhausted` / `loopStop`（`condition`\|`cap`\|`failed`\|`bad-condition`）
- `forEach` 子任务以 `<id>[k]` 进入 steps 列表，父节点聚合 `{ summary(换行拼接), children }` 写入 `resultsById` 供下游 `${step.<id>.summary}` 引用

## 表达式引擎（workflow-expr）

`when`、循环条件经 `workflow-expr.js` 求值——**手写 tokenizer + 递归下降解析器，不使用 `eval`/`Function`**：

```
expr    := or
or      := and ( "||" and )*
and     := not ( "&&" not )*
not     := "!" not | cmp
cmp     := primary ( OP primary )?     OP ∈ { == != < <= > >= contains }
primary := "(" expr ")" | ref | string | number | bool | null
ref     := "${step." ID "." ID "}"  |  "${item}"
```

引用字段：`status` / `taskId` / `summary` / `tokenCount` / `iterationCount` / `toolsUsed` / `items`，以及对 `result` 的通用回退。循环条件额外支持 `${self.<field>}`（本步骤最近一次迭代结果，首轮为空）与 `${iter}`（1-based 迭代号）——二者在 `message` 中也可替换。

```js
// when 示例
"${step.scan.status} == 'completed'";
"${step.lint.summary} contains 'error'";
// 循环示例
"${iter} < 5"; // loopWhile：跑满 5 轮
"${self.summary} contains 'SUCCESS'"; // loopUntil：轮询直到成功
```

## 配置参考

`executeWorkflow(options)` 选项：

| 选项                      | 默认                         | 说明                                        |
| ------------------------- | ---------------------------- | ------------------------------------------- |
| `workflow`                | —                            | 工作流定义对象（必填）                      |
| `cwd`                     | `process.cwd()`              | 历史文件写入目录                            |
| `maxParallel`             | `4`                          | 最大并发步骤（批次内 / 流水线并发 step 数） |
| `continueOnError`         | `false`                      | 失败后是否继续                              |
| `pipeline`                | `workflow.pipeline ?? false` | 无屏障调度开关                              |
| `llmOptions`              | `{}`                         | 透传给每个任务                              |
| `onStepStart(evt)`        | —                            | 步骤开始回调 `{ stepId, message }`          |
| `onStepComplete(outcome)` | —                            | 步骤完成回调                                |

引擎常量：

```js
export const MAX_FAN_OUT = 500; // 单个 forEach 最大展开数
export const MAX_LOOP_ITERATIONS = 100; // 单个 loop 步骤迭代上限
```

**持久化路径**：

```
.chainlesschain/cowork/workflows/<id>.json     # 每个工作流一个文件
.chainlesschain/cowork/workflow-history.jsonl  # 每次执行一行 record
```

## 性能指标

| 维度             | 指标                        | 说明                                   |
| ---------------- | --------------------------- | -------------------------------------- |
| 调度并发         | `maxParallel`（默认 4）     | 批次内 / 流水线同时在飞的步骤数        |
| forEach 扇出上限 | `MAX_FAN_OUT = 500`         | 超限抛错，防止失控并发                 |
| 循环迭代上限     | `MAX_LOOP_ITERATIONS = 100` | 防止 `while`/`until` 死循环            |
| 流水线墙钟       | ≈ 最长依赖链                | 对比批次的「各层最慢之和」，去层间空等 |
| 重试退避         | fixed / exponential         | 指数退避 = `retryDelayMs · 2^(尝试-1)` |
| 超时粒度         | 每次尝试                    | 超时计入重试，仍受 `retries` 约束      |

**何时选流水线**：依赖链不均衡（部分步骤明显更慢）、独立分支多时收益最大；纯线性或同质工作流两者墙钟相近。

## 测试覆盖

| 测试文件                                                       | 用例数 | 覆盖                                                                                   |
| -------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------- |
| `__tests__/unit/cowork-workflow.test.js`                       | 87     | 校验 / 拓扑 / 批次 / 占位 / forEach / when / 重试-超时 / 循环 / 流水线（含无屏障证明） |
| `__tests__/unit/lib/cowork-workflow-v2.test.js`                | 44     | V2 治理状态机 + 配额 + 自动暂停/失败                                                   |
| `__tests__/unit/cowork-workflow-ws.test.js`                    | 10     | WebSocket 桥接                                                                         |
| `__tests__/integration/cowork-evolution-workflow.test.js`      | 12     | 进化工作流端到端                                                                       |
| `__tests__/integration/cowork-workflow-ws-integration.test.js` | 5      | WS 集成                                                                                |

```bash
cd packages/cli
npx vitest run __tests__/unit/cowork-workflow.test.js     # 87 passed
```

关键测试包含**无屏障证明**：构造 A（快）/ B（慢）/ C（依赖 A），断言流水线模式下 C 在 B 仍 pending 时就已启动——批次模式无法做到。

## 安全考虑

1. **表达式注入防护**：`when` / 循环条件**绝不**经 `eval` 或 `Function`，而是手写 tokenizer + 递归下降解析器，只支持白名单运算符与受限引用语法；非法表达式抛错而非执行任意代码。
2. **扇出/循环兜底**：`MAX_FAN_OUT=500` 与 `MAX_LOOP_ITERATIONS=100` 硬上限，防止恶意/错误定义触发失控并发或死循环。
3. **超时隔离**：`timeoutMs` 让单步挂起不会无限阻塞整条工作流；超时后放弃该次尝试（`runTask` 无取消契约，被放弃的任务为 best-effort，late rejection 已被吞掉避免 unhandledRejection）。
4. **校验先行**：`saveWorkflow` / `executeWorkflow` 入口即 `validateWorkflow`——id/name/steps、`dependsOn` 存在性、环检测、retry/timeout/loop 字段合法性全部前置拦截。
5. **失败收敛**：默认 `continueOnError:false` 时首失败即停止调度新步骤，避免在错误状态上继续放大副作用。

## 故障排除

| 现象                                          | 原因                                  | 处理                                                             |
| --------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------- |
| `Invalid workflow: workflow contains a cycle` | `dependsOn` 成环                      | 检查依赖关系，去掉回边                                           |
| `... dependsOn unknown step 'x'`              | 依赖了不存在的 step id                | 修正 id 拼写或补上该 step                                        |
| `forEach ref did not resolve to an array`     | `${step.x.items}` 没解析成数组        | 确认前序步骤 `result.items` 是数组                               |
| `forEach expansion exceeds MAX_FAN_OUT`       | 展开超 500                            | 在上游收窄数据，或分批                                           |
| 步骤 `result.loopExhausted: true`             | 循环到达 `maxIterations` 仍未满足条件 | 放宽条件 / 调高 `maxIterations`（≤100）/ 检查循环体是否真在推进  |
| `result.loopStop: "bad-condition"`            | 循环条件表达式非法                    | 校对 `${self.*}`/`${iter}` 语法与运算符                          |
| 步骤一直失败不重试                            | 没设 `retries`                        | 加 `retries` + 可选 `retryDelayMs`/`retryBackoff`                |
| `_deps.runTask is not injected`               | 直接调引擎未注入 runner               | CLI 路径自动注入；自定义集成需先 `_deps.runTask = runCoworkTask` |
| 工作流被慢步骤拖住                            | 批次模式层间屏障                      | 加 `--pipeline` 或工作流顶层 `"pipeline": true`                  |

## 关键文件

| 文件                                                  | 行数 | 职责                                                                         |
| ----------------------------------------------------- | ---- | ---------------------------------------------------------------------------- |
| `packages/cli/src/lib/cowork-workflow.js`             | 1433 | 引擎：校验 / 拓扑 / 批次 / 流水线 / runStepNode / 重试-超时 / 循环 / V2 治理 |
| `packages/cli/src/lib/workflow-expr.js`               | 664  | 安全表达式沙箱（tokenizer + 递归下降 + `evaluate`/`resolveReference`）       |
| `packages/cli/src/commands/cowork.js`                 | 3667 | `cc cowork workflow` 子命令（add/list/show/remove/run + V2 治理命令）        |
| `packages/cli/__tests__/unit/cowork-workflow.test.js` | 1322 | 87 个引擎单测                                                                |

## 使用示例

### CLI 命令

```bash
# 从 JSON 定义文件添加工作流
cc cowork workflow add ./my-workflow.json

# 列出 / 查看 / 删除
cc cowork workflow list
cc cowork workflow show my-workflow
cc cowork workflow remove my-workflow

# 端到端执行（批次模式，默认）
cc cowork workflow run my-workflow

# 失败后继续 + 提高并发
cc cowork workflow run my-workflow --continue-on-error --max-parallel 8

# 无屏障流水线调度
cc cowork workflow run my-workflow --pipeline
```

### DAG + 条件门控 + 结果传递

```json
{
  "id": "review-pipeline",
  "name": "代码评审流水线",
  "steps": [
    { "id": "scan", "message": "扫描改动文件并列出风险点" },
    {
      "id": "deep",
      "message": "对高风险点深入分析：${step.scan.summary}",
      "dependsOn": ["scan"],
      "when": "${step.scan.summary} contains '风险'"
    }
  ]
}
```

### 运行时扇出 forEach

```json
{
  "id": "fan-out",
  "name": "逐文件处理",
  "steps": [
    { "id": "list", "message": "列出需要处理的文件，结果放入 items 数组" },
    {
      "id": "process",
      "message": "处理文件 ${item}",
      "dependsOn": ["list"],
      "forEach": "${step.list.items}"
    },
    {
      "id": "merge",
      "message": "合并结果：${step.process.summary}",
      "dependsOn": ["process"]
    }
  ]
}
```

### 每步重试 / 超时

```json
{
  "id": "robust",
  "name": "健壮任务",
  "steps": [
    {
      "id": "fetch",
      "message": "拉取远端数据",
      "retries": 3,
      "timeoutMs": 30000,
      "retryDelayMs": 1000,
      "retryBackoff": "exponential"
    }
  ]
}
```

### while / until 循环节点

```json
{
  "id": "poll",
  "name": "轮询直到就绪",
  "steps": [
    {
      "id": "wait",
      "message": "第 ${iter} 次检查构建状态",
      "loopUntil": "${self.summary} contains 'SUCCESS'",
      "maxIterations": 10
    },
    {
      "id": "deploy",
      "message": "构建就绪（${step.wait.summary}），开始部署",
      "dependsOn": ["wait"]
    }
  ]
}
```

### 无屏障流水线（工作流级开启）

```json
{
  "id": "pipe",
  "name": "无屏障流水线",
  "pipeline": true,
  "steps": [
    { "id": "fast", "message": "快任务" },
    { "id": "slow", "message": "慢任务（独立分支）" },
    {
      "id": "after-fast",
      "message": "用 ${step.fast.summary}",
      "dependsOn": ["fast"]
    }
  ]
}
```

> `after-fast` 在 `fast` 一完成就启动，无需等待无关的 `slow`。

## 相关文档

- → [Cowork 多智能体协作系统](/chainlesschain/cowork) — 团队 / 任务 / 技能 / 沙箱总览
- → [多智能体协作 (CLI)](/chainlesschain/cli-cowork) — `cc cowork` 命令行参考
- → [协作高级功能](/chainlesschain/cowork-advanced) — Orchestrate / Pipeline / 编排进阶
- → [协作路线图](/chainlesschain/cowork-roadmap) — 演进规划
- → [CLI 命令行工具](/chainlesschain/cli) — 完整命令索引
