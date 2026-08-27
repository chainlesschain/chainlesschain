# Agent Team：声明式任务图协作（`cc team`）

> 状态：P2-16 已完成并随 CLI `0.162.189` 首次公开；当前生产推荐版为 `0.166.5`，npm `latest` 为 `0.166.6`（2026-08-27）。`0.166.0` 新增 Graph Kernel 与 `cc team graph inspect|diff|eval`，`0.166.2` 公开真实 child 的私有消息工具，`0.166.3` 已公开 idle wake、custody handoff、SessionMessageFabric 与结构化审批，`0.166.5` 又补齐 payload union 与跨端 causal conformance；`0.166.6` 增加有界 Agent IPC，但其精确提交门禁未闭环。以下早期实现候选
> `7df6feced4670ac71d19548752d18ac4cc225025` 的三平台短门与各 120 分钟 soak
> 均成功；最终发布提交
> [`2607af0dadeb951583139942e5f2add3e95e1208`](https://github.com/chainlesschain/chainlesschain/commit/2607af0dadeb951583139942e5f2add3e95e1208)
> 又通过 [CLI CI](https://github.com/chainlesschain/chainlesschain/actions/runs/30586603353)、
> [CLI Strict Sandbox](https://github.com/chainlesschain/chainlesschain/actions/runs/30586603019)、
> [Agent Team 长期 soak](https://github.com/chainlesschain/chainlesschain/actions/runs/30564377629)
> 与 [npm 发布](https://github.com/chainlesschain/chainlesschain/actions/runs/30588174291)。本文同时保留
> 共享 FS queue、partial checkpoint、unsigned state 和不可回滚 external side effects 等边界。

## 概述

`cc team` 用依赖 DAG、独占租约、预算和隔离 worktree 协调一组 shell 或 Agent 任务。
它提供三种运行形态：

| 形态           | 命令                | 适用场景                                     |
| -------------- | ------------------- | -------------------------------------------- |
| 计划预览       | `cc team plan`      | 校验任务图并查看可并行波次，不执行任务       |
| 单协调器       | `cc team run`       | 一个 CLI 进程内运行多个 teammate 循环        |
| 耐久多进程队列 | `cc team queue ...` | 多个 OS 进程通过同一可信本地文件系统协调任务 |

> “多进程队列”不是网络队列或共识系统。所有 worker 必须能看到同一 Git 仓库和同一可信
> 队列文件，并依赖本地文件锁语义。

## 核心特性

- 只有依赖全部完成的任务才可领取；未知依赖和依赖环在运行前被拒绝。
- 同一时刻至多一个未过期、未被 fencing 的租约有权结算某个任务。
- 过期或失效的 holder 不能再提交完成状态。
- 真实并行任务可使用每任务一个 Git worktree，依赖任务会基于已验证的依赖提交继续工作。
- 团队级与单 Agent 级预算只允许收紧，不能由 worker 或恢复流程放宽。
- 结果不明确时默认进入人工裁决，不会静默重放可能产生外部副作用的任务。

这些保证不是“外部副作用 exactly-once”。租约和 fencing 能保护调度状态，但不能撤销已经
发出的网络请求、数据库写入、消息、部署或付款。

## 系统架构

```text
任务 JSON
   │
   ├─ cc team plan ── DAG 校验 / 并行波次预览
   │
   ├─ cc team run ─── 单协调器 TeamRunner
   │                     ├─ shell / Agent worker
   │                     ├─ 可选 Git worktree
   │                     └─ 本地 authority + 预算 + checkpoint
   │
   └─ cc team queue ── 可信共享文件系统队列
                         ├─ queue state + 文件锁
                         ├─ lease / renew / fence
                         ├─ 多个 OS worker
                         └─ recovery / adjudication / finalize
```

`plan` 只读校验任务图；`run` 在一个 CLI 进程内协调多个 teammate；`queue` 把控制状态持久化到可信共享本地文件系统，使多个 OS 进程可领取任务。三种模式都遵循依赖、预算和 authority 收紧规则，但只有显式启用且满足前置条件的 worktree/checkpoint 能提供文件级隔离或回滚。

## 任务图

任务文件可以是顶层数组，也可以使用 `{ "tasks": [...] }`。

```json
{
  "tasks": [
    {
      "key": "build",
      "title": "构建",
      "command": "npm run build",
      "priority": "high",
      "retrySafe": true
    },
    {
      "key": "unit-test",
      "title": "单元测试",
      "command": "npm test",
      "dependsOn": ["build"],
      "retrySafe": true
    },
    {
      "key": "lint",
      "title": "代码检查",
      "command": "npm run lint",
      "dependsOn": ["build"],
      "retrySafe": true
    }
  ]
}
```

`unit-test` 与 `lint` 会在 `build` 成功后并行执行。

### 字段

| 字段                 | 说明                                                       |
| -------------------- | ---------------------------------------------------------- |
| `key`                | 必填、稳定且唯一的任务标识                                 |
| `title`              | 可选；省略时使用 `key`                                     |
| `dependsOn` / `deps` | 依赖任务的 `key` 数组                                      |
| `priority`           | `high`、`normal` 或 `low`                                  |
| `command`            | shell 模式执行的命令                                       |
| `prompt`             | Agent 模式交给 headless Agent 的提示                       |
| `retrySafe`          | 只有确认任务可安全重复执行时才设为 `true`                  |
| `scopePaths`         | 单进程 runner 的调度冲突范围；不是文件系统权限或写入隔离   |
| `sparsePaths`        | worktree 只物化的路径                                      |
| `symlinkDirectories` | 显式共享的可写依赖目录；会削弱隔离                         |
| `agent` / `policy`   | 每任务 Agent 权限、模型和预算约束；`policy` 优先于 `agent` |

`agent` 和 `policy` 支持：

- `permissionMode`
- `model`
- `maxTurns`
- `maxBudgetUsd`
- `maxTokens`
- `maxWallMs`
- `checkpointRequired`
- `worktreeRequired`

任务级权限和预算只能等于或严于父级。单进程 runner 会报告被收紧的任务契约；分布式 Agent
队列在初始化时直接拒绝不能原样满足的契约。

分布式 `agent-worktree` 图必须提供非空 `prompt`，并拒绝 `command` 或其他不受支持的字段。
建议 shell 图和 Agent 图分开维护。

Agent 图示例：

```json
{
  "tasks": [
    {
      "key": "fix-cli",
      "title": "修复 CLI",
      "prompt": "修复指定测试并说明根因，只修改 packages/cli。",
      "retrySafe": false,
      "agent": {
        "model": "<model>",
        "maxTurns": 20,
        "maxTokens": 50000
      },
      "policy": {
        "permissionMode": "acceptEdits",
        "checkpointRequired": true,
        "worktreeRequired": true
      }
    }
  ]
}
```

## 配置参考

任务图负责声明任务、依赖和任务级策略；命令行负责选择执行模式、并发、预算、状态和隔离。任务级权限与预算只能保持或收紧父级配置。

| 配置维度   | 单协调器 `team run`                                      | 多进程 `team queue`                                    |
| ---------- | -------------------------------------------------------- | ------------------------------------------------------ |
| 输入       | `--tasks <file>`                                         | `queue init --tasks <file>`                            |
| 模式       | `--exec` / `--agent`，可选 `--worktree`                  | 固定为 `shell-worktree` 或 `agent-worktree`            |
| 并发       | `--teammates <n>`                                        | 启动多个 `queue worker` 进程                           |
| 团队预算   | `--max-tasks`、`--max-tokens`、`--max-usd`、`--max-wall` | `queue init` 的对应参数；后续 worker 不可放宽          |
| Agent 预算 | `--agent-max-*`                                          | `queue init --agent-max-*`                             |
| 租约       | `--ttl <seconds>`                                        | `--ttl-ms`、`--renew-every-ms`                         |
| 状态       | `--state <file>`、`--resume`                             | `--state` + `run-id` + 建议固定 queue/authority digest |
| 回滚       | `--managed-checkpoint` + `--checkpoint-state-dir`        | 初始化时固定，worker 只能断言不能改写                  |
| 输出       | `--json`、`--otlp <file>`                                | 各子命令支持 `--json`                                  |

状态文件和 checkpoint 目录必须位于任务不可写、仓库外部的可信路径。`run` 的 wall/lease 参数使用秒，queue 对应参数使用毫秒；详细选项见后文“参数”“公共参数”和“子命令参数”。

## 计划预览

```bash
cc team plan --tasks team-shell.json
cc team plan --tasks team-shell.json --json
```

`plan` 只输出拓扑波次，不执行 `command` 或 `prompt`。

## 单协调器运行：`cc team run`

### 执行模式

| 参数组合                             | 行为                               |
| ------------------------------------ | ---------------------------------- |
| 无 `--exec`、`--agent`、`--worktree` | dry-run；不执行任务命令            |
| `--exec --teammates 1`               | 在当前仓库目录真实执行 shell       |
| `--agent --teammates 1`              | 在当前仓库目录运行 headless Agent  |
| `--worktree`                         | 真实 shell-worktree 执行           |
| `--exec --worktree`                  | 与上项相同，但意图更明确           |
| `--agent --worktree`                 | 在每任务独立 worktree 中运行 Agent |

注意：

- `--worktree` 本身就是一种真实执行模式，不是 dry-run。
- `--exec` 与 `--agent` 互斥。
- 真实执行且 `--teammates` 大于 1 时必须启用 `--worktree`。
- 默认 `--teammates` 为 `2`；因此共享当前目录的真实执行应显式传入 `--teammates 1`。
- dry-run 不运行任务，但显式指定的 `--state` 或 `--otlp` 仍可能写文件；`--json` 仍会输出事件。

### 示例

安全预览：

```bash
cc team run --tasks team-shell.json
```

单 worker 共享当前目录执行：

```bash
cc team run --tasks team-shell.json --exec --teammates 1
```

四个 teammate、每任务独立 worktree：

```bash
cc team run \
  --tasks team-shell.json \
  --exec \
  --worktree \
  --teammates 4
```

带状态、托管 checkpoint 和顺序合并：

```bash
cc team run \
  --tasks team-shell.json \
  --exec \
  --worktree \
  --managed-checkpoint \
  --checkpoint-state-dir /srv/cc-team/checkpoints/release-001 \
  --merge \
  --teammates 4 \
  --state /srv/cc-team/state/release-001.json
```

`--state` 和 checkpoint 存储应位于任务不可写、仓库外部的可信目录。Windows 可使用等价的
受保护绝对路径。

### 参数

| 分组       | 参数                                                                                                                              |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 输入与租约 | `--tasks <file>`、`--teammates <n>`、`--ttl <seconds>`                                                                            |
| 执行器     | `--exec`、`--agent`、`--worktree`                                                                                                 |
| Agent      | `--model`、`--permission-mode`、`--agent-max-turns`、`--agent-max-budget-usd`、`--agent-max-tokens`、`--agent-max-wall <seconds>` |
| Worktree   | `--merge`、`--sparse-paths <csv>`、`--symlink-dirs <csv>`                                                                         |
| Checkpoint | `--managed-checkpoint`、`--checkpoint-state-dir <dir>`                                                                            |
| 团队预算   | `--max-tasks`、`--max-tokens`、`--max-usd`、`--max-wall <seconds>`                                                                |
| 恢复与输出 | `--state`、`--resume`、`--json`、`--otlp <file>`                                                                                  |

`--managed-checkpoint` 要求 `--worktree` 和仓库外部的可信 `--state`。
`--checkpoint-state-dir` 只能与托管 checkpoint 一起使用，并且不能与状态文件重合。

## Worktree 与合并

Worktree 是按任务创建的，不是按 teammate 创建的。一个 teammate 连续领取两个任务时会使用
两个不同的任务 worktree。

- 每个成功任务记录分支、worktree、提交和基线证据。
- 依赖任务会组合已完成依赖的已验证提交。
- `--merge` 在预览成功后顺序合并干净分支。
- 冲突或 Git 基线漂移会阻止合并，不会强制覆盖。
- 失败或被阻止的 worktree 会保留，供检查和人工恢复。
- `--sparse-paths` 控制物化范围，不代表写权限。
- `--symlink-dirs` 会把主 checkout 中的依赖目录作为可写共享目录暴露给任务，因此会削弱
  worktree 隔离。

## 受治理的 file/hunk merge review（`0.163.8`）

对多个 Agent 分支进行最终发布时，可以不用接受整条 branch。`merge-review` 先在精确 base 上生成稳定的 file/hunk id，再要求操作员用 revision、plan digest、actor 和 reason 固定选择：

```bash
cc team merge-review preview \
  --branch agent/api --branch agent/tests --json

cc team merge-review show <review-id> --json

cc team merge-review apply <review-id> \
  --revision <next-revision> \
  --plan-digest sha256:<plan-digest> \
  --file-id <file-id> \
  --hunk-id <hunk-id> \
  --actor local-operator \
  --reason "reviewed API and tests" \
  --json
```

重复 `--file-id` / `--hunk-id` 可以选择多项。`show` 会输出当前状态允许的 exact next actions；不要手工猜 revision 或 digest。发生冲突、发布后需要撤销，或状态进入 `rollback_required` 时，重新 `show` 后按最新证据回滚：

```bash
cc team merge-review rollback <review-id> \
  --revision <next-revision> \
  --evidence-digest sha256:<evidence-digest> \
  --confirm <review-id> \
  --json
```

默认状态位于 `CHAINLESSCHAIN_HOME/team-merge-reviews`。自定义 `--state-dir` 必须位于 Agent 可写仓库之外并满足 owner-only 权限。CLI 会拒绝 Git hooks、仓库本地配置、继承环境、旧 revision、过大选择、base/branch 漂移和不安全状态目录；冲突证据会持久化，不会用强制覆盖伪装成功。该机制保护 Git 文件发布，不回滚数据库、部署、消息或其它外部副作用。

## 本地状态与恢复

新运行指定 `--state` 时，目标文件必须尚不存在：

```bash
cc team run \
  --tasks team-shell.json \
  --exec \
  --worktree \
  --state /srv/cc-team/state/release-001.json
```

恢复时使用同一任务图和状态：

```bash
cc team run \
  --tasks team-shell.json \
  --exec \
  --worktree \
  --state /srv/cc-team/state/release-001.json \
  --resume
```

当前本地状态版本为 `v6`：

- `v5` 只允许通过一次 `--resume` 迁移到 `v6`。
- `v2` 至 `v4` 不再接受。
- `control-bindings`、`interrupt`、`adjudications` 和 `adjudicate` 要求 `v6`。
- 不带 `--resume` 不会覆盖已有状态文件。

恢复不会扩大原 authority：

- 执行模式、模型、worktree、merge、checkpoint 和物化配置必须匹配。
- teammate 并发、权限、团队预算和单 Agent 上限只能保持不变或收紧。
- 省略恢复参数时继承原值。
- 已耗用预算继续累计。
- 本地 `--max-wall` 保存的是已消耗的活跃运行时间；进程停止期间不计入该窗口。

因此不要把预算上限当成“暂停点”。已经耗尽的 authority 不能通过 `--resume --max-*` 抬高。

## 本地人工中断与裁决

先获取当前 CAS 绑定：

```bash
cc team control-bindings \
  --state /srv/cc-team/state/release-001.json \
  --json
```

只对输出中显示的精确运行尝试发出中断：

```bash
cc team interrupt \
  --state /srv/cc-team/state/release-001.json \
  --task build \
  --expected-state-id <state-id> \
  --expected-attempt-digest <sha256-digest> \
  --request-id tctl_takeover_build_001 \
  --reason "人工接管构建" \
  --json
```

列出待裁决案例：

```bash
cc team adjudications \
  --state /srv/cc-team/state/release-001.json \
  --json
```

刷新绑定后应用一次性决定：

```bash
cc team adjudicate \
  --state /srv/cc-team/state/release-001.json \
  --task build \
  --decision retry \
  --expected-state-id <state-id> \
  --expected-adjudication-digest <sha256-digest> \
  --reason "已确认前一次未产生外部副作用" \
  --json
```

决定语义：

| 决定     | 结果                                   |
| -------- | -------------------------------------- |
| `retry`  | 回到 pending，允许安全重跑             |
| `accept` | 操作者确认结果已经生效，标记 completed |
| `cancel` | 保持 cancelled，不再执行               |

决定与精确状态、任务尝试和证据摘要绑定。发生 stale digest 时必须重新读取绑定，不能复用旧值。
裁决后通过 `cc team run ... --resume` 继续。

## 耐久多进程队列：`cc team queue`

### 前置条件

- 仓库必须是 Git 仓库。
- 队列 `--state` 必须在任务可写仓库之外，且初始化时不存在。
- 所有 worker 必须使用相同的规范化仓库路径、状态路径和 `--run-id`。
- 状态目录应由可信操作者控制并使用严格 OS ACL。
- 队列状态是独立的 schema `v1`，不能与本地 `team run` 的 `v6` 状态互换。
- 每个队列任务始终使用自己的 worktree。
- `agent-worktree` 队列必须启用托管 checkpoint。

### Shell 队列完整流程

初始化：

```bash
cc team queue init \
  --tasks team-shell.json \
  --state /srv/cc-team/queue/release-001.json \
  --run-id release-001 \
  --repo /work/chainlesschain \
  --mode shell-worktree \
  --max-tasks 6 \
  --json
```

初始化结果会生成 `queueId` 和 `authorityDigest`。这两个值不能在 `queue init` 时由调用方提供；
保存返回值，并在所有后续命令中固定它们。

在两个终端或服务进程中分别启动一个 worker：

```bash
cc team queue worker \
  --state /srv/cc-team/queue/release-001.json \
  --run-id release-001 \
  --repo /work/chainlesschain \
  --queue-id <queue-id> \
  --authority-digest <authority-digest> \
  --worker-id worker-a
```

```bash
cc team queue worker \
  --state /srv/cc-team/queue/release-001.json \
  --run-id release-001 \
  --repo /work/chainlesschain \
  --queue-id <queue-id> \
  --authority-digest <authority-digest> \
  --worker-id worker-b
```

每次 `queue worker` 只启动一个 OS worker 进程。CLI 没有 `--workers N` 启动器。

读取同一 revision 的状态视图：

```bash
cc team queue status \
  --state /srv/cc-team/queue/release-001.json \
  --run-id release-001 \
  --repo /work/chainlesschain \
  --queue-id <queue-id> \
  --authority-digest <authority-digest> \
  --json
```

任务全部完成且没有待裁决案例后，先预览：

```bash
cc team queue finalize \
  --state /srv/cc-team/queue/release-001.json \
  --run-id release-001 \
  --repo /work/chainlesschain \
  --queue-id <queue-id> \
  --authority-digest <authority-digest> \
  --operation-id preview-release-001 \
  --finalizer-id operator-a \
  --json
```

确认预览后执行 fenced 合并：

```bash
cc team queue finalize \
  --state /srv/cc-team/queue/release-001.json \
  --run-id release-001 \
  --repo /work/chainlesschain \
  --queue-id <queue-id> \
  --authority-digest <authority-digest> \
  --operation-id merge-release-001 \
  --finalizer-id operator-a \
  --merge \
  --json
```

不带 `--merge` 的 finalization 只记录干净预览并保留 worktree。带 `--merge` 时按顺序执行
fenced merge，再以可恢复的 prepare → persist → remove → persist 流程清理。冲突、Git 漂移
或失去 finalizer lease 会阻止操作并保留证据。

### Agent 队列

Agent 图不能包含 `command`：

```bash
cc team queue init \
  --tasks team-agent.json \
  --state /srv/cc-team/queue/agent-001.json \
  --run-id agent-001 \
  --repo /work/chainlesschain \
  --mode agent-worktree \
  --managed-checkpoint \
  --checkpoint-state-dir /srv/cc-team/checkpoints/agent-001 \
  --model <model> \
  --permission-mode acceptEdits \
  --agent-max-turns 20 \
  --agent-max-tokens 50000 \
  --json
```

worker 从已固定 authority 派生执行模式。`--agent`、`--managed-checkpoint` 和
`--checkpoint-state-dir` 只是额外断言，不能改变队列：

```bash
cc team queue worker \
  --state /srv/cc-team/queue/agent-001.json \
  --run-id agent-001 \
  --repo /work/chainlesschain \
  --queue-id <queue-id> \
  --authority-digest <authority-digest> \
  --worker-id agent-worker-a \
  --agent \
  --managed-checkpoint
```

### 公共参数

所有队列子命令使用：

| 参数             | 说明                       |
| ---------------- | -------------------------- |
| `--state <file>` | 队列状态；必须位于仓库外   |
| `--run-id <id>`  | 调用方选择并固定的运行标识 |
| `--repo <dir>`   | 仓库；默认当前仓库         |
| `--json`         | 输出一个 JSON 对象         |

除 `init` 外，现有队列命令还接受：

| 参数                          | 说明                                      |
| ----------------------------- | ----------------------------------------- |
| `--queue-id <id>`             | 初始化返回的队列标识                      |
| `--authority-digest <sha256>` | 初始化返回的 64 位十六进制 authority 摘要 |

这两个 pin 在 CLI 中是可选参数，但生产操作应始终传入，以避免打开错误队列或错误 authority。

### 子命令参数

| 子命令       | 专有参数                                                                                                                                                                                                                                                                                                  |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `init`       | `--tasks`、`--mode shell-worktree\|agent-worktree`、`--max-tasks`、`--max-tokens`、`--max-usd`、`--max-wall-ms`、`--model`、`--permission-mode`、`--agent-max-turns`、`--agent-max-tokens`、`--agent-max-budget-usd`、`--agent-max-wall-ms`、`--managed-checkpoint`、`--checkpoint-state-dir`、`--ttl-ms` |
| `status`     | `--mode`，用于断言固定模式                                                                                                                                                                                                                                                                                |
| `worker`     | `--worker-id`、`--mode`、`--ttl-ms`、`--renew-every-ms`、`--max-tasks`、`--managed-checkpoint`、`--checkpoint-state-dir`、`--agent`                                                                                                                                                                       |
| `interrupt`  | `--task`、`--holder`、`--lease-id`、`--fencing-token`、`--request-id`、`--actor`、`--reason`                                                                                                                                                                                                              |
| `recover`    | `--task`、`--recovery-id`、`--evidence-digest`、`--actor`、`--reason`、`--repair-git-baseline`                                                                                                                                                                                                            |
| `adjudicate` | `--task`、`--decision retry\|accept\|cancel`、`--decision-id`、`--evidence-digest`、`--actor`、`--reason`                                                                                                                                                                                                 |
| `finalize`   | `--mode`、`--merge`、`--operation-id`、`--finalizer-id`、`--ttl-ms`                                                                                                                                                                                                                                       |

本地 `team run` 的 wall 和 lease 参数使用秒；队列的对应参数使用毫秒。

`queue worker --max-tasks` 只是该 worker 进程的本地执行上限，不会改变
`queue init --max-tasks` 固定的全局预算。

## 分布式中断、恢复与裁决

`queue status --json` 提供当前 holder、lease、fencing 和待裁决证据。控制命令必须绑定这些
精确值。

中断一个确切任务尝试：

```bash
cc team queue interrupt \
  --state /srv/cc-team/queue/release-001.json \
  --run-id release-001 \
  --repo /work/chainlesschain \
  --queue-id <queue-id> \
  --authority-digest <authority-digest> \
  --task build \
  --holder worker-a \
  --lease-id <lease-id> \
  --fencing-token <token> \
  --request-id interrupt-build-001 \
  --actor operator-a \
  --reason "人工接管"
```

恢复一个已证明被遗弃的托管 checkpoint（以下沿用前面的 `agent-001` 队列）：

```bash
cc team queue recover \
  --state /srv/cc-team/queue/agent-001.json \
  --run-id agent-001 \
  --repo /work/chainlesschain \
  --queue-id <queue-id> \
  --authority-digest <authority-digest> \
  --task fix-cli \
  --recovery-id recover-fix-cli-001 \
  --evidence-digest sha256:<64-hex> \
  --reason "worker 已失联，回滚已捕获工作区"
```

`recover` 只处理托管 checkpoint 的恢复与协调，不代表外部副作用已经确定。
`--repair-git-baseline` 只能用于证据精确绑定的已遗弃任务，不能重置其他任务或整个仓库。

裁决未知结果：

```bash
cc team queue adjudicate \
  --state /srv/cc-team/queue/release-001.json \
  --run-id release-001 \
  --repo /work/chainlesschain \
  --queue-id <queue-id> \
  --authority-digest <authority-digest> \
  --task build \
  --decision retry \
  --decision-id decide-build-001 \
  --evidence-digest sha256:<64-hex> \
  --reason "已核验外部系统，前一次操作未生效"
```

`request-id`、`recovery-id` 和 `decision-id` 应在重试 CLI 调用时保持不变，用于幂等识别；
不要为同一逻辑操作每次生成新 ID。

## 租约、重试与预算

默认任务租约 TTL 为 60 秒，默认每任务最多 3 次尝试。实际重试还受团队预算约束。

- 普通失败只有在任务声明 `retrySafe: true` 时才会自动重试。
- `retrySafe` 应只用于幂等操作，或已经具备外部幂等键和可验证结果的操作。
- 进程崩溃、人工中断、租约遗弃或无法证明副作用结果时，真实任务进入 fail-closed 裁决。
- dry-run 或明确 `retrySafe` 的遗弃任务可以自动重新领取。
- stale holder 即使后来成功返回，也不能发布完成状态。
- fencing 保护的是队列状态，不能收回 stale 进程已经发出的外部请求。

四维团队预算：

| 预算   | 本地                   | 队列初始化           | 含义               |
| ------ | ---------------------- | -------------------- | ------------------ |
| 尝试数 | `--max-tasks`          | `--max-tasks`        | 全局任务执行尝试数 |
| Token  | `--max-tokens`         | `--max-tokens`       | Agent token 总量   |
| USD    | `--max-usd`            | `--max-usd`          | Agent 估算费用     |
| 墙钟   | `--max-wall <seconds>` | `--max-wall-ms <ms>` | 团队时间上限       |

本地省略预算表示不设置该维度上限。队列省略 `--max-tasks` 时默认等于任务数，其他维度默认
不设上限；如果希望 `retrySafe` 任务有重试空间，应在初始化时显式配置更大的全局尝试预算。

启用 token 或 USD 上限时：

- 领取 Agent 任务前会预留可用额度。
- 任务级额度不能超过团队剩余额度。
- usage 缺失或模型无法定价时会 fail closed，而不是把未知消费当作零。

时间语义不同：

- 本地恢复保留已使用的活跃 wall time，但不计算 CLI 停机时间。
- 队列 wall time 在第一次成功领取任务时开始；此后即使所有 worker 停机，时间仍继续计算。
- 队列在执行器返回、checkpoint、提交和完成发布阶段都会重新检查 wall fence。
- 即使执行器忽略取消信号，超限后也不能发布完成；结果不明确时进入裁决。

## 托管 checkpoint 的范围

`--managed-checkpoint` 会让 Process Broker 管理声明范围内的任务执行，并在成功时接受
checkpoint，在失败或中止时回滚已捕获的工作区状态。

> 它不表示“捕获机器上的所有文件写入”。

Agent Team 当前 checkpoint authority 明确声明：

- `coverageTarget: "partial"`
- `writerIsolation: "unknown"`
- `externalSideEffects: true`

因此：

- 只覆盖由 Process Broker 管理、且位于声明工作区范围内的 writer。
- 未托管子进程、其他本地进程和范围外路径不在保证内。
- 网络、数据库、消息、部署、支付和其他外部系统操作不可由 checkpoint 回滚。
- worktree、Git 提交和 checkpoint 共同提供恢复证据，但不构成外部事务。
- 如果业务需要可重试外部操作，仍应使用业务幂等键、事务日志和结果核验。

分布式 `agent-worktree` 强制托管 checkpoint；分布式 shell 模式和本地 worktree 模式可以
按需启用。

## 输出与可观测性

- `cc team run --json` 输出 JSON Lines 事件流。
- `cc team run --otlp <file>` 写入 OTLP/JSON span；每次执行产生一个 `team.task` span，并带有
  `workflow.run_id` 和 `workflow.name`。
- `cc team queue ... --json` 每次命令输出一个 JSON 对象，不是 JSON Lines 事件流。
- 使用 `queue status` 获取锁内的一致状态视图。

不要用高频直接读取队列 JSON 文件代替 `queue status`。原始读取不参与锁协议；Windows 上还
可能与原子替换发生短暂争用。只读监控若必须访问原始文件，应降低频率并实现退避和重试。

CLI `0.166.5` 没有顶层 `cc team send` 子命令；消息契约仅通过真实 `cc team --agent` 子进程的私有宿主工具公开：

- `team_send`：定向发送带幂等键的有界消息。
- `team_receive`：以稳定 consumer 拉取至少一次投递。
- `team_ack`：推进 read / processed 状态，poison 消息进入 dead-letter。
- `team_followup`：向指定 teammate 追加受 lease/fence 约束的后续任务。

桥接层每次调用都会重验 holder/task/attempt/lease/fence，credential capability 不进入 prompt 且不可继承。普通 `--exec` shell worker 和 IDE 的无内容健康投影不获得消息 authority。离线恢复、跨进程限流、custody handoff、processed-before-ACK、4 MiB pending 上限与 canonical message/handoff 投影已随 `0.166.3+` 公开；仍未关闭的是更长时间的离线/poison/reorder soak、真实 provider 多 Agent 旅程、跨机器 custody 以及其他产品 adapter 的 authoritative 切换。

## 使用示例

先预览任务图，再根据任务的可信级别选择本地或分布式执行方式：

```bash
# 只验证任务图和调度计划，不执行任务
cc team plan --tasks team-tasks.json --json

# 单 teammate 执行受信任的本地 shell 任务
cc team run --tasks team-tasks.json --exec --teammates 1

# 使用隔离 worktree 并发执行
cc team run --tasks team-tasks.json --exec --worktree --teammates 4

# 查看分布式队列的一致状态快照
cc team queue status --state /trusted/state/team-queue.json --json
```

完整的队列初始化、worker 绑定、裁决与最终发布流程见前文对应章节。任务文件中的
`command` 和 `prompt` 都属于执行 authority；不要直接运行来源不明的任务图。

## 面向 CLI 使用者的硬限制

| 项目                                        | 限制                              |
| ------------------------------------------- | --------------------------------- |
| 本地 teammate                               | `1` 至 `64`；默认 `2`             |
| 本地任务图                                  | 最多 10,000 个任务                |
| 本地依赖边                                  | 最多 100,000 条                   |
| 本地任务文件 / 状态                         | 最大 64 MiB                       |
| 本地 `scopePaths`                           | 每任务最多 128 项                 |
| 本地控制日志                                | 最多 10,000 个事件、最大 8 MiB    |
| 队列任务图文件                              | 1 字节至 64 MiB                   |
| 队列状态                                    | 最大 64 MiB                       |
| 分布式 Agent prompt                         | 每任务最大 1 MiB                  |
| 分布式 `sparsePaths` / `symlinkDirectories` | 每字段每任务最多 128 项           |
| 自动任务尝试                                | 默认最多 3 次，且仍受全局预算限制 |
| 队列 worker 启动                            | 每次 `queue worker` 一个 OS 进程  |

10,000 任务、64 worker 的规模测试是同一进程内的 `TeamRunner` 异步 worker 测试，不代表
64 个分布式 OS 进程的生产保证。跨平台分布式发布 soak 使用 2 个 worker 进程验证确定性
DAG、故障和恢复流程；它也不等价于 live-model 质量测试。

## 性能指标

这里列出的是当前实现中的容量边界和已验证规模，不是对任意硬件、模型供应商或共享文件
系统的延迟 SLA：

| 指标                  | 当前边界或验证范围                                     |
| --------------------- | ------------------------------------------------------ |
| 本地 teammate 并发    | `1` 至 `64`，默认 `2`                                  |
| 本地任务图规模        | 最多 10,000 个任务、100,000 条依赖边                   |
| 任务文件与运行状态    | 单文件最大 64 MiB                                      |
| 自动任务尝试          | 默认最多 3 次，同时受团队 token、USD 和 wall time 预算 |
| 同进程规模测试        | 10,000 个任务、64 个异步 worker                        |
| 跨平台分布式发布 soak | 2 个独立 OS worker，覆盖确定性 DAG、故障和恢复         |

实际吞吐主要受任务内容、模型时延、Git 工作区大小、checkpoint 范围和共享存储锁语义影响。部署前应
使用真实任务图、目标操作系统和计划使用的模型做基准测试。

## 测试覆盖

Agent Team 的自动化测试覆盖任务契约、调度与预算、租约和分布式队列、裁决、进程 checkpoint、
worktree 隔离以及多进程最终发布。代表性测试包括：

- 单元测试：`team-task-contract.test.js`、`team-runner.test.js`、`team-budget.test.js`、
  `team-distributed-queue.test.js`、`team-adjudication.test.js`、
  `team-process-checkpoint.test.js`、`team-worktree.test.js`。
- 集成测试：`team-worktree-real-git.test.js`、`team-distributed-queue-multiprocess.test.js`、
  `team-distributed-finalization.test.js`、`team-distributed-cli.test.js`、
  `team-distributed-agent.test.js`、`team-distributed-soak.test.js`。

```bash
cd packages/cli
npm run test:unit -- team
npm run test:integration -- team
```

发布判定仍以目标提交上的 GitHub Actions 跨平台矩阵为准；本地结果用于快速回归，不能替代
发布门禁。

## 关键文件

| 文件                                                         | 职责                                       |
| ------------------------------------------------------------ | ------------------------------------------ |
| `packages/cli/src/commands/team.js`                          | `cc team` 命令、参数校验与输出协议         |
| `packages/cli/src/commands/team-distributed.js`              | `cc team queue` 分布式队列命令             |
| `packages/cli/src/lib/agent-team/team-runner.js`             | 本地 DAG 调度、并发控制与任务生命周期      |
| `packages/cli/src/lib/agent-team/team-task-contract.js`      | 任务图规范化、依赖和容量边界校验           |
| `packages/cli/src/lib/agent-team/team-distributed-queue.js`  | 分布式队列状态、锁与 revision 协议         |
| `packages/cli/src/lib/agent-team/task-lease.js`              | 租约领取、续租、过期和 fenced completion   |
| `packages/cli/src/lib/agent-team/team-budget.js`             | token、USD、wall time 与任务尝试预算       |
| `packages/cli/src/lib/agent-team/team-worktree.js`           | Git worktree 隔离与最终发布                |
| `packages/cli/src/lib/agent-team/team-process-checkpoint.js` | 托管执行、checkpoint 与回滚边界            |
| `packages/cli/src/lib/agent-team/team-adjudication.js`       | 不确定结果的证据绑定和裁决                 |
| `packages/cli/src/commands/team-merge-review.js`             | merge review 命令、严格参数和输出 envelope |
| `packages/cli/src/lib/agent-team/team-merge-review*.js`      | file/hunk 计划、状态、发布事务与受控回滚   |

## 安全考虑

### 可信输入和状态

- `command` 会被 shell 原样执行，任务图必须视为代码。
- `prompt`、权限、预算、模型和 checkpoint 配置同样属于执行 authority。
- 本地状态和队列状态可能包含命令、提示、预算和权限信息，应由严格 ACL 保护。
- 队列状态未签名。`queueId`、摘要和 revision 是一致性、误绑定和回滚检测锚点，不是来源认证。
- 能写队列状态或其可信父目录的主体属于控制面 TCB。

### 文件系统与进程边界

- 路径身份检查要求状态文件父目录及祖先可信。
- Node.js 没有完整的 `openat`/handle-relative authority，不能消除敌对可写父目录下的所有
  ABA 竞态。
- Windows 在最终检查与进程创建之间仍存在独立 TOCTOU 窗口。
- Linux 托管执行依赖受信的隔离启动器和 `bwrap` 能力。
- Windows 使用受限 token 和 kill-on-close Job 等平台原语。
- macOS 在无法证明所需进程树隔离时会 fail closed。
- POSIX 清理不能证明捕获主动 `setsid` 逃逸的后代。
- 外部强杀主 CLI 进程时，JavaScript `finally` 不保证运行；恢复必须依赖耐久状态和显式协调。

### 队列边界

- 队列依赖共享本地文件系统与文件锁，不提供复制、仲裁、BFT 或多主共识。
- 不承诺任意 NFS/SMB 实现都具有所需锁和原子替换语义。
- `scopePaths` 只影响本地调度，不限制进程实际写入。
- writable symlink 依赖目录会绕过部分 worktree 隔离。
- deterministic soak 验证故障协议，不验证实时模型质量、供应商可用性或外部 API 幂等性。

## 故障排查

| 现象                                           | 原因与处理                                                        |
| ---------------------------------------------- | ----------------------------------------------------------------- |
| `--exec` 使用默认 teammate 数时报必须 worktree | 默认并发为 2；改用 `--teammates 1` 或启用 `--worktree`            |
| `queue init` 报 unknown option `--queue-id`    | 这是预期行为；该值由初始化生成，只用于后续命令                    |
| 状态路径在仓库内被拒绝                         | 把状态和 checkpoint 存储移到任务不可写的仓库外可信目录            |
| 新运行提示状态已存在                           | 使用 `--resume`，或选择新的状态路径；CLI 不会静默覆盖             |
| v2–v4 状态无法恢复                             | 不受支持；只有 v5 可通过一次 `--resume` 迁移到 v6                 |
| 恢复时提高 cap 被拒绝                          | 恢复 authority 只能保持或收紧，不能扩权                           |
| task 卡在 adjudication                         | 先刷新 status/bindings 和证据，再显式选择 retry、accept 或 cancel |
| authority/attempt/evidence mismatch            | 状态已经变化；重新查询，不能复用旧 digest                         |
| finalization blocked                           | 检查冲突、Git 漂移、未完成任务和待裁决案例；worktree 会保留       |
| managed checkpoint fail closed                 | 检查平台隔离、可信路径和 Process Broker 前置条件                  |
| token/USD 预算下 Agent 失败                    | 检查 usage 与模型价格；未知计量在启用 cap 时不会按零处理          |
| worker 超过本地 `--max-tasks` 后退出           | 这是单 worker 上限；启动新 worker，但不能改变初始化时的全局预算   |

## 相关文档

- [Graph Kernel 使用与运维](./cli-graph-kernel.md)
- [CLI Agent 模式](./cli-agent.md)
- [CLI 安全沙箱](./cli-sandbox.md)
- [Checkpoint 与回滚](./checkpoint.md)
- [Cowork 多智能体协作](./cowork.md)
- [CLI 对标 Claude Code 优化计划](/design/CLAUDE_CODE_CLI_PARITY_OPTIMIZATION_PLAN)
