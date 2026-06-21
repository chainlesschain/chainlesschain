# 目标 / OKR 系统（cc goal）

> **版本: Phase 0+1+2 全量落地 | 状态: ✅ 生产可用 | 跨会话持久 | 33 单元测试全绿**
>
> `cc goal` 提供**跨会话持久的目标 / OKR（Objectives & Key Results）**能力——一个长期目标可在多个会话之间持续推进，并在每一轮 agent 循环中作为临时系统提示注入。它是对 Claude Code 的**能力扩展**（Claude Code 无对应物），而非补齐项。

## 概述

`cc goal` 让 AI agent 拥有「长期记性」：你设定一个目标（Objective）与若干关键结果（Key Results），目标随 `<home>/goals/<id>.json` 持久化在主目录，因此**不绑定单次会话、不依赖数据库 schema**。当你以 `cc agent --goal <id>` 运行时，目标会被合成为每轮对话的临时系统提示后缀注入到模型上下文，引导 agent 朝目标推进；可选的 `--goal-assess` 会在运行结束后让模型自评本轮是否推进了目标，并把进度/关键结果/漂移标记写回存储。

它与相邻概念边界清晰：

| 概念          | 作用域         | 用途                               |
| ------------- | -------------- | ---------------------------------- |
| `cc session`  | 短期上下文     | 单次会话的消息历史                 |
| `cc memory`   | 事实           | 跨会话的事实/偏好记忆              |
| `cc planmode` | 单次运行       | 一次运行的计划                     |
| `cc workflow` | 执行状态       | 工作流的执行进度                   |
| **`cc goal`** | **跨会话目标** | **长期目标 + OKR，逐轮注入 agent** |

## 核心特性

- 🎯 **跨会话持久**：目标存于主目录 `<home>/goals/<id>.json`，跨任意多次会话存活，无需数据库
- 📊 **OKR 模型**：Objective + 多个 Key Result，KR 推导整体进度，`current ≥ target` 自动判定完成，百分比自动 clamp
- 🔁 **逐轮注入**：通过 agent-core 的 `prepareCall` seam 把目标合成为**临时**系统提示后缀（每轮临时注入，**不写入历史**）
- 🧩 **组合而非替换**：`composePrepareCall` 把目标上下文与默认的回合上下文（`defaultPrepareCall`）**叠加**，绝不替换
- 🔗 **会话绑定**：`cc agent --goal <id>` 显式绑定会把会话挂到目标上，`--continue`/`--resume` 时自动保持目标
- 🤖 **智能解析（active）**：未显式指定时按「显式 id > 绑定到当前会话的活跃目标 > 唯一的活跃目标 > 无（歧义则为 null）」优先级解析
- 🧠 **运行后自评（Phase 2，可选）**：`--goal-assess` 让模型从 transcript 判断是否推进，写回进度 / KR 当前值与完成 / agent 备注 / 漂移标记（容错解析，永不改变运行结果）
- 🚩 **漂移与陈旧提示**：>14 天无进度给出 stale 提示；运行未推进时追加 `no-progress` 漂移标记（上限 20 条）
- 📤 **全 JSON 输出**：每个子命令支持 `--json`，便于脚本/自动化消费

## 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│  cc goal <子命令>        cc agent --goal [id] [--goal-assess]  │
└───────────────┬───────────────────────┬─────────────────────┘
                │                        │
        ┌───────▼────────┐      ┌────────▼─────────────────────┐
        │ goal-store.js  │      │ goal-context.js              │
        │ 文件存储        │      │ buildGoalContext(goal)       │
        │ <home>/goals/  │      │   → 简洁系统后缀（目标+未完成 │
        │   <id>.json    │◄─────┤     KR，上限 8 条）           │
        │ resolveActive  │      │ goalPrepareCall(goal)        │
        │ Goal(...)      │      │ composePrepareCall([fns])    │
        └────────────────┘      └────────┬─────────────────────┘
                                         │ options.prepareCall（临时系统后缀，不入历史）
                            ┌────────────▼───────────────────────┐
                            │ agent-core.js（agent 循环）          │
                            │  agent-repl.js（Phase 0：REPL 解析）  │
                            │  headless-runner.js / -stream.js     │
                            │   （Phase 1：--goal [id]）            │
                            │  goal-assess.js（Phase 2：运行后自评）│
                            └─────────────────────────────────────┘
```

注入点是 agent-core 的 `options.prepareCall`——每回合生成临时系统提示后缀，**不持久化到消息历史**。`headless-runner.js` 在循环结束后挂载 `--goal-assess` 自评钩子（best-effort，发出 `goal_assessment` 事件，从不改变运行结果）。

### 解析优先级（`resolveActiveGoal`）

1. 显式 `--goal <id>`（任何状态）
2. 绑定到当前会话的活跃目标
3. 唯一的活跃目标
4. 以上皆无或存在歧义 → `null`（不注入）

## 命令参考

```bash
cc goal set <objective> [--title <t>] [--kr <text>...] [--json]   # 创建目标（别名 add）
cc goal list [--json]                                             # 列出目标（别名 ls，最新在前）
cc goal show <id> [--json]                                        # 查看目标全文
cc goal kr add <id> <text> [--json]                               # 添加关键结果
cc goal kr set <id> <krId> [--current <n>] [--done] [--json]      # 更新 KR 当前值 / 标记完成
cc goal progress <id> [--pct <n>] [--note <text>] [--json]        # 记录进度百分比 / 追加备注
cc goal link <id> [sessionId] [--json]                            # 关联会话（默认最近会话）
cc goal unlink <id> [sessionId] [--json]                          # 解除会话关联
cc goal pause|resume|close|abandon <id> [--json]                  # 生命周期状态流转
cc goal rm <id> [--json]                                          # 删除目标
cc goal active [--json]                                           # 显示将绑定到运行的目标（含解析顺序）
```

绑定到 agent 运行：

```bash
cc agent --goal <id>            # 绑定指定目标（并把会话挂到该目标）
cc agent --goal                 # 无值 → 自动解析活跃目标
cc agent --goal <id> --goal-assess   # 运行后让模型自评进度并写回
```

## 配置参考

- **存储根**：默认 `<home>/goals/<id>.json`；`goal-store` 提供 `opts.root` 覆盖（仅用于测试，`getHomeDir()` 忽略环境变量，因此实机 CLI 写真实存储——脚本测试后请自行清理）。
- **KR 上限注入**：`buildGoalContext` 仅注入目标 Objective + 未完成 KR，**上限 8 条**，避免上下文膨胀。
- **陈旧阈值**：超过 **14 天**无进度的目标在 `list`/`active` 中给出 stale 提示。
- **漂移标记上限**：`addDriftFlags` 追加 `{at, kind, detail}`，**上限 20 条**；运行未推进时记 `no-progress`。
- **自评开关**：`--goal-assess` 默认关闭（有 token 成本），仅 opt-in 时在运行结束触发。

## 性能指标

- **零数据库开销**：目标以单文件 JSON 持久化，读写为单次文件 I/O，无 schema/迁移成本。
- **注入开销极小**：每回合注入的是一段简洁文本后缀（目标 + ≤8 条未完成 KR），对上下文体积影响可忽略。
- **自评单次调用**：`--goal-assess` 仅在运行结束发起一次模型调用，且为 best-effort——失败不影响运行产出。

## 测试覆盖率

共 **33** 个单元测试，全绿：

| 测试文件                     | 数量 | 覆盖                                                                    |
| ---------------------------- | ---- | ----------------------------------------------------------------------- |
| `goal-store.test.js`         | 21   | 创建/进度/KR 推导/自动完成/clamp/`resolveActiveGoal` 优先级/漂移标记    |
| `goal-context.test.js`       | 6    | `buildGoalContext` 后缀 / `goalPrepareCall` / `composePrepareCall` 叠加 |
| `agent-goal-binding.test.js` | 6    | `--goal` 解析、会话绑定、`--continue`/`--resume` 保持目标               |

```bash
cd packages/cli
npx vitest run test/goal-store.test.js test/goal-context.test.js test/agent-goal-binding.test.js
```

> 测试通过 `deps.resolveActiveGoal` / `deps.getGoal` / `deps.assessGoalProgress` / `deps.assessChat` 等注入 seam，使断言不触碰真实存储与真实模型。

## 安全考虑

- **本地优先**：目标存于用户主目录，不上云、不进入 P2P，纯本地数据。
- **不污染历史**：目标上下文以**临时系统后缀**逐轮注入，**不写入会话消息历史**，因此切换/解绑目标不会留下残留上下文。
- **自评隔离失败**：`--goal-assess` 的写回逐子项隔离（`applyAssessment`），单项失败不影响其它；整个自评钩子 best-effort，**从不改变运行结果**。
- **容错解析**：`parseAssessment` 提取首个配平的 `{...}`，对 Markdown 代码围栏与散文具备容错，避免模型输出格式异常导致崩溃。

## 故障排查

| 现象                                | 可能原因                                     | 处理                                                                            |
| ----------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------- |
| `cc agent --goal`（无值）未注入目标 | 存在多个活跃目标 → 解析歧义返回 null         | 用 `cc goal active` 查看解析结果，或显式 `--goal <id>`                          |
| `--continue`/`--resume` 丢了目标    | 之前是自动解析（未显式绑定，会话未挂到目标） | 用 `cc agent --goal <id>` 显式绑定一次，使会话挂到目标                          |
| 进度一直不动且出现 stale 提示       | >14 天无进度                                 | 用 `cc goal progress <id> --pct <n> --note <text>` 记录进度，或 `pause`/`close` |
| 自评没有写回进度                    | 未加 `--goal-assess`（默认关闭）             | 运行时显式加 `--goal-assess`（注意 token 成本）                                 |
| 测试写到了真实存储                  | `getHomeDir()` 忽略环境变量，实机写真实目录  | 测试用 `opts.root` 覆盖；实机 smoke 后手动清理 `<home>/goals/`                  |

## 关键文件

| 文件                                                                 | 说明                                                                                                   |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `packages/cli/src/lib/goal-store.js`                                 | 文件存储（`<home>/goals/<id>.json`）、KR 推导进度、自动完成、`resolveActiveGoal` 优先级                |
| `packages/cli/src/lib/goal-context.js`                               | `buildGoalContext` / `goalPrepareCall` / `composePrepareCall`（与 `defaultPrepareCall` 叠加）          |
| `packages/cli/src/lib/goal-assess.js`                                | Phase 2 运行后自评：`buildAssessPrompt` / `parseAssessment` / `applyAssessment` / `assessGoalProgress` |
| `packages/cli/src/commands/goal.js`                                  | `cc goal` 命令树，注册于 `index.js`                                                                    |
| `packages/cli/src/repl/agent-repl.js`                                | Phase 0：REPL 解析活跃目标并叠加 prepareCall                                                           |
| `packages/cli/src/runtime/headless-runner.js` · `headless-stream.js` | Phase 1：`--goal [id]` flag + 会话绑定 + `goal_id` 初始化事件；Phase 2 自评钩子                        |

## 使用示例

```bash
# 1) 创建一个带关键结果的目标
cc goal set "把 CLI 测试覆盖率提到 95%" \
  --title "提升测试覆盖率" \
  --kr "语句覆盖率 ≥ 95%" \
  --kr "新增 200 个用例" \
  --kr "0 个 flaky 测试"

# 2) 让 agent 朝该目标推进（绑定会话）
cc agent --goal <id> -p "继续推进我的覆盖率目标，先补 goal-store 的边界用例"

# 3) 记录关键结果进度
cc goal kr set <id> <krId> --current 180          # 更新 KR 当前值
cc goal progress <id> --pct 72 --note "已补完 goal-store 边界用例"

# 4) 运行结束让模型自评是否推进
cc agent --goal <id> --goal-assess -p "跑一轮并自评进度"

# 5) 查看将绑定到下一次运行的目标（含解析顺序）
cc goal active --json

# 6) 完成或归档
cc goal close <id>
```

## 相关文档

- [CLI Agent 智能代理](./cli-agent.md)
- [钩子系统](./hooks.md)
- [权限系统](./permissions.md)
- [计划模式](./plan-mode.md)
- [会话管理器](./session-manager.md)
- [永久记忆系统](./permanent-memory.md)
