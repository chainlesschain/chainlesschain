# 动态 Worktree 批处理（`cc batch`）

> **版本: 第四阶段（跨端与长任务）#4 · 2026-07-09 | 状态: ✅ 生产就绪 | 独立单元 fan-out + 每单元 git worktree 并发 + 测试 + 冲突预览 + `--decompose` 自动拆分 | 17 测试（15 单元 + 2 真-git 集成）**
>
> `cc batch` 把一个大改动拆成 N 个**互相独立**的单元（UNIT），每个单元跑在自己的 git worktree 里（有界并发），各自跑测试，最后汇总每个单元的 agent 状态 / 测试结果 / diff 统计 / 合并冲突预览。这是 Claude Code `/batch` 的形态，构建在 `cc team` 用的同一套 worktree 隔离原语之上。

## 概述

有些改动天然可以并行：把 20 处 `foo()` 调用迁移到 `bar()`、给 8 个模块各补一份 README、把一批文件逐个格式化——这些子任务**互相不依赖**，本可以 N 路并发推进。但如果让它们在同一个工作区里并发编辑，会互相踩踏。

`cc batch` 的做法是：每个单元开一个独立的 git worktree，在里面跑一个无头 agent 完成该单元、跑该单元的测试、提交，然后**顺序集成**——逐个预览合并回 base，干净的合并、冲突的**如实报告不覆盖**。

与 [`cc team`](./cli-team.md) 的区别很明确：

- **`cc team`** 面向**有依赖关系**的任务图（DAG）——任务之间有先后，用独占 lease + 依赖门控调度。
- **`cc batch`** 假设单元**互相独立**——没有依赖图，纯 fan-out + 聚合；并且支持 `--decompose <goal> --parts N` 让一个 agent 先把大目标**自动拆成**单元表再跑。

## 核心特性

- 🧩 **独立单元 fan-out**: 每个单元 `{key, prompt, test?}` 在自己的 git worktree 里跑无头 agent，互不干扰。
- 🌲 **每单元 Worktree 隔离**: 复用 `worktree-isolator`（`cc team --worktree` 同款原语），并发编辑不争工作区。
- 🚦 **有界并发保序**: `--concurrency N` 的 worker pool（`mapPool`），至多 N 个单元在跑，结果保持输入顺序。
- 🤖 **自动拆分**: `--decompose <goal> --parts N` 让 agent 用 `--json-schema` 结构化输出把目标拆成单元表；`--plan-only` 只出表不跑。
- 🧪 **每单元测试 → 红单元不合并**: 单元可带自己的 `test`，或用 `--test` 设默认；测试失败的单元标 `test-failed`、**永不合并**进 base。
- 🔀 **顺序集成 + 冲突预览**: 逐个 preview→merge，后一个分支与已合并者冲突时**如实报告不强合**；`--merge` 才真正合并干净分支。
- 📊 **每单元汇总**: agent 状态（done/test-failed/no-changes/error）+ diff 统计（文件/增/删）+ 集成结果（clean/merged/conflicts）。
- 🚧 **保留分支供检查**: 未合并的分支**保留**供人工检查/手动合并；已合并的删分支。
- 🚦 **CI 门**: 存在 test-failed 或 error 时退出码为 1。

## 系统架构

```
┌───────────────────────────────────────────────────────────────┐
│                          cc batch                              │
│                   (commands/batch.js — CLI)                    │
│  解析 --units 文件 / --decompose 自动拆分 → 真实 deps 接线：     │
│  worktree-isolator · cc agent -p · git numstat · git commit    │
└──────────────────────────┬────────────────────────────────────┘
                           │ units + deps
             ┌─────────────▼──────────────┐
             │   runBatch (agent-batch.js) │
             │   纯 fan-out + 聚合          │
             │   全 deps 注入 → 离线可测    │
             └─────────────┬──────────────┘
                           │
          mapPool(units, concurrency, worker)   ← 有界并发保序
                           │
     ┌─────────────────────┼─────────────────────┐
     ▼                     ▼                     ▼
 ┌────────┐          ┌────────┐            ┌────────┐
 │ unit a │          │ unit b │    ...     │ unit N │  各自 worktree
 │ 建 wt   │          │ 建 wt   │            │ 建 wt   │
 │ 跑 agent│          │ 跑 agent│            │ 跑 agent│
 │ 跑 test │          │ 跑 test │            │ 跑 test │
 │ diffStat│          │ diffStat│            │ diffStat│
 │ commit  │          │ commit  │            │ commit  │
 └────┬────┘          └────┬────┘            └────┬────┘
      └────────────────────┼──────────────────────┘
                           ▼
          顺序集成（SEQUENTIAL integration）：
          for each committed & passing unit:
            preview merge → clean? --merge → 合并
                          → conflict → 报告不强合
                           │
                           ▼
                 summarize + teardown（未合并分支保留）
```

## 命令参考

### `cc batch`

```bash
# 1) 跑一份声明好的单元表
cc batch --units units.json

# 2) 带默认测试 + 并发 + 合并
cc batch --units units.json --test "npm test" --concurrency 4 --merge

# 3) 让 agent 先把目标拆成单元再跑
cc batch --decompose "把所有 foo() 调用迁移到 bar()" --parts 8

# 4) 只拆分不执行（预览单元表）
cc batch --decompose "..." --parts 8 --plan-only
```

| 旗标                | 说明                                                            | 默认   |
| ------------------- | --------------------------------------------------------------- | ------ |
| `--units <file>`    | 单元 JSON（`{ units: [{key, prompt, test?}] }`，也接受裸数组）  | —      |
| `--decompose <goal>`| 让 agent 先把目标拆成单元表（结构化输出）                       | —      |
| `--parts <n>`       | `--decompose` 目标单元数                                        | `6`    |
| `--plan-only`       | 配合 `--decompose`：打印单元表并退出（不跑）                    | 关     |
| `--concurrency <n>` | 同时运行的最大 worktree 数                                      | `4`    |
| `--test <cmd>`      | 每个单元的默认测试命令（单元自带的 `test` 优先）               | 无     |
| `--merge`           | 把干净且测试通过的分支顺序合并回 base                          | 关     |
| `--model <model>`   | agent 运行使用的模型                                            | 默认   |
| `--json`            | 机器可读输出                                                    | 关     |

必须提供 `--units` 或 `--decompose` 之一，否则退出码 4。

## 单元表格式

```json
{
  "units": [
    {
      "key": "migrate-auth",
      "prompt": "把 src/auth/ 下所有 foo() 调用改成 bar()，保持行为不变",
      "test": "npm test -w auth"
    },
    {
      "key": "migrate-api",
      "prompt": "把 src/api/ 下所有 foo() 调用改成 bar()，保持行为不变"
    }
  ]
}
```

| 字段     | 必填 | 说明                                                    |
| -------- | ---- | ------------------------------------------------------- |
| `key`    | 否   | 单元标识（缺省 `unit-1`/`unit-2`…；重复 key 报错）      |
| `prompt` | 是   | 交给该单元无头 agent 的完整指令（自包含，不依赖其它单元）|
| `test`   | 否   | 该单元的测试命令（覆盖 `--test` 默认）                  |

## 单元状态

| 状态          | 含义                                        | 是否参与集成           |
| ------------- | ------------------------------------------- | ---------------------- |
| `done`        | agent 完成、有改动、测试通过（或无测试）    | 是（`--merge` 时合并） |
| `test-failed` | 测试失败                                    | **否**（永不合并）     |
| `no-changes`  | agent 没产生任何改动                        | 否（跳过）             |
| `error`       | agent 执行抛错                              | 否                     |

## 配置参考

| 项       | 机制            | 默认 | 备注                                          |
| -------- | --------------- | ---- | --------------------------------------------- |
| 并发度   | `--concurrency` | 4    | 同时运行的 worktree 上限（保序 worker pool）  |
| 默认测试 | `--test`        | 无   | 单元自带 `test` 优先                          |
| 合并     | `--merge`       | 关   | 只合并干净且测试通过的分支；冲突报告不强合    |
| 拆分粒度 | `--parts`       | 6    | `--decompose` 目标单元数                      |
| 分支命名 | `batch/<key>`   | —    | 未合并分支保留供检查，已合并的删分支          |

## 性能指标

| 维度         | 特性                                                              |
| ------------ | ----------------------------------------------------------------- |
| 并发         | `mapPool` 有界并发保序——至多 `--concurrency` 个单元在跑           |
| 隔离         | 每单元独立 git worktree，并行编辑零争用                           |
| 集成安全     | 顺序 preview→merge，后分支与已合并者冲突时**检出报告**（非静默覆盖）|
| 红单元       | 测试失败的单元永不合并进 base                                     |
| 空单元       | 无改动单元跳过提交与集成                                          |
| 退出码       | 存在 test-failed 或 error → 1（可作 CI 门）                       |

> 真机 smoke：`cc batch --help` / 缺参错误路径全通。

## 测试覆盖

共 **17 测试**（15 单元 + 2 真-git 集成），全绿。

| 测试文件                    | 数量 | 覆盖                                                                          |
| --------------------------- | ---- | ----------------------------------------------------------------------------- |
| `agent-batch.test.js`       | 8+2  | fan-out / test-failed 不合并 / 冲突不覆盖 / no-changes / agent 错误 / 并发上限 / 事件 / 单元校验 + `mapPool` 保序 + `normalizeUnits` 默认 key |
| `batch-command.test.js`     | 7    | 缺参 / units 文件端到端 / 测试失败 exit 1 / decompose plan-only / 坏文件      |
| `batch-worktree.test.js`（集成）| 2 | **真 git**：两独立单元真合入 main（a.txt/b.txt）；两单元改 README 同一行 → 第二个真合并冲突被如实报告 merged=1/conflicted=1、base 未覆盖 |

## 安全考虑

- **agent 权限模式**：每个单元跑 `cc agent -p --permission-mode acceptEdits`——单元 prompt 应视为可信输入，勿把来源不明的单元表交给它跑。
- **测试即闸门**：测试失败的单元**永不合并**进 base，避免红代码被静默并入；`--merge` 只合并干净且通过的分支。
- **冲突不静默覆盖**：顺序集成阶段，后一个分支与已合并者冲突时**只报告不强合**，绝不覆盖 base——冲突分支保留供人工解决。
- **分支保留**：未合并的分支不删除，供人工检查/手动合并，避免工作丢失。
- **提交用 `--no-verify`**：worktree 内提交跳过 pre-commit 钩子（隔离环境的中间提交），最终集成回 base 时仍走正常路径。

## 故障排除

| 现象                          | 原因                       | 处理                                                    |
| ----------------------------- | -------------------------- | ------------------------------------------------------- |
| `Provide --units or --decompose` | 两个都没给                 | 提供 `--units <file>` 或 `--decompose <goal>`           |
| `duplicate unit key`          | 单元表有重复 `key`         | 改成唯一 key（或省略让其自动编号）                     |
| `unit "x" has no prompt`      | 某单元缺 `prompt`          | 补上自包含的 `prompt`                                  |
| 某单元 `no-changes`           | agent 没做任何改动         | 检查该单元 prompt 是否可执行；空单元自动跳过集成       |
| 合并报冲突未合并              | 两单元改了同一处           | 预期——冲突分支被报告不强合，手工解决 `batch/<key>` 再合 |
| 退出码 1                      | 有 test-failed 或 error 单元 | 看汇总定位失败单元，修复后重跑                          |
| decompose 输出解析失败        | agent 未按 schema 输出     | 重试；或改用 `--units` 手写单元表                       |

## 关键文件

| 文件                                            | 职责                                                              |
| ----------------------------------------------- | ---------------------------------------------------------------- |
| `packages/cli/src/commands/batch.js`            | `cc batch` CLI 编排——单元解析 / `--decompose` / 真实 deps 接线   |
| `packages/cli/src/lib/agent-batch.js`           | `runBatch`——纯 fan-out + 聚合 + 顺序集成（全 deps 注入）         |
| `packages/cli/src/harness/worktree-isolator.js` | 底层 git worktree 创建/移除/预览/合并原语（与 `cc team` 共享）   |

## 使用示例

### 1. 跑一份声明好的单元表并合并

```bash
cc batch --units units.json --test "npm test" --merge
#   batch: 3 units, concurrency 4
#   ✓ migrate-auth (4 files)
#   ✓ migrate-api (2 files)
#   ✗ test migrate-ui (1 files)
#
#   Batch summary:
#   3 units — 2 done, 1 test-failed, 0 errored, 0 no-change
#   merged 2, conflicts 0
```

### 2. 让 agent 自动把目标拆成单元

```bash
cc batch --decompose "给 packages/ 下每个子包补一份 README" --parts 8 --plan-only
# 打印拆好的 8 个单元表，人工过目后再去掉 --plan-only 真跑
```

### 3. 高并发迁移 + CI 门

```bash
cc batch --units migration.json --concurrency 6 --test "npm test" --json
# 逐单元 JSON 结果；有 test-failed/error 时退出码 1，可作流水线闸门
```

## 相关文档

- [Agent Team `cc team`](./cli-team.md) — 有依赖 DAG 的任务图编排（`cc batch` 的姊妹能力，共享 worktree 隔离原语）
- [CLI Agent 模式](./cli-agent.md) — `cc agent -p` 无头执行（每个单元的底层执行器）
- [编码 Agent 工具集](./coding-agent.md) — Agent 工具契约与权限模式
- [CLI 对标 Claude Code 优化计划](/design/CLAUDE_CODE_CLI_PARITY_OPTIMIZATION_PLAN) Phase 4（Agent Team / Worktree 隔离）
