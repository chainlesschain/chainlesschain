# 命名定时/触发任务 — Cron / Once / Webhook / GitHub（`cc routine`）

> **版本: 第四阶段（跨端与长任务）· 2026-07-11 | 状态: ✅ 生产就绪 | 四种触发（cron / once / webhook / github）+ 附加运行历史 + 每次运行的结果/用量/成本汇总 | Claude-Code Routines 平价（自托管）**
>
> `cc routine` 是 `cc agenda` 之上的**持久化命名层**：给一个反复要跑的 Agent 任务起个名字、绑一种触发方式、随时启用/停用，并保留一份**只增不改的运行历史**（含每次的输出、token 用量与成本）。

## 概述

`cc agenda` 解决的是「Agent 在 turn 内安排一次性/周期性意图」的问题，但那些意图是**匿名、临时**的。`cc routine` 把它升级成一等公民：

- **命名 + 可管理**：每条 routine 有 `name` 和 `id`，可 `enable` / `disable` / `remove`，而不是一次性烧掉。
- **四种触发**：`cron`（周期）、`once`（一次性 ISO/epoch 时间，触发后自动停用）、`webhook`（外部经 `cc routine trigger` 触发）、`github`（轮询 owner/repo 的新事件触发）。
- **运行历史**：每次触发都在 `runs.jsonl` 追加 `start` / `end` 两行，记录状态、退出码、末尾输出摘要、`usage`、`costUsd`、耗时；完整 Agent 输出落到 `logs/<runId>.log`。
- **同样是显式驱动**：cron/once/github 只有在你实际跑 `cc routine run`（配合 `cc loop`、系统 cron 或 agenda wakeup）时才触发——没有偷跑的常驻 daemon。

一次触发 = 一次 `cc agent -p <prompt> --output-format json` 的完整自主 Agent 调用；成本与用量从该次 agent 的 JSON 结果信封中抽取并归档。

## 核心特性

- 🏷️ **命名 routine**：`create <name> --prompt <text> --<trigger>`；`id` 形如 `rt-<base36>-<hex>`，查找时支持完整 id / id 前缀 / 精确 name 三种写法。
- 🗓️ **cron 周期**：标准 5 字段表达式，复用 `cc agenda` 同一套 `parseCron` / `nextCronTime` 引擎；**追赶不重放**——即便错过 N 个周期，也只触发一次（跳到下一个触发点）。
- ⏱️ **once 一次性**：`--at <ISO 或 epoch ms>`；到点触发后 `enabled` 自动置 `false` 自我停用。
- 🌐 **webhook 外部触发**：`--webhook` 声明的 routine 从不被驱动自动触发，只能经 `cc routine trigger <id>` 触发——它本身就是「API/webhook 入口」，把任意 HTTP 接收器接到这条命令即可。
- 🐙 **github 事件触发**：`--github owner/repo [--events PushEvent,PullRequestEvent]`；驱动经 `gh api` 轮询仓库事件，出现符合类型的新事件（按事件 id 高水位去重）即触发。
- 📜 **只增运行历史**：`cc routine runs [id]` 合并 start/end 行，未闭合的记为 `running`，最新在前；坏行逐行跳过不炸整表。`cc routine logs <runId>` 打印该次完整输出。
- 💾 **纯文件持久化 + 容错**：`~/.chainlesschain/routines/`（`0700`），`routines.json` + `runs.jsonl` + `logs/*.log`；无 SQLite 依赖。
- 🔁 **与 agenda 同源同驱动**：`cc loop --every 1m -- cc routine run` 常驻触发，行为透明。

## 系统架构

```
┌──────────────── cc routine create <name> ────────────────┐
│  --prompt <text>  +  恰好一种触发：                        │
│  --cron / --at / --webhook / --github(--events)          │
└───────────────────────────┬──────────────────────────────┘
                            ▼
 ┌──────────────────────────────────────────────────────┐
 │  RoutineStore (routine-store.js)                       │
 │  ~/.chainlesschain/routines/                           │
 │   ├─ routines.json   定义 map（id → routine）          │
 │   ├─ runs.jsonl      只增运行历史（start/end 两行）     │
 │   └─ logs/<runId>.log 每次运行完整输出                  │
 │  · due()  cron/once 到期判定（共享 nextCronTime）       │
 │  · pollGithubRoutine()  gh 事件高水位去重               │
 │  · fireRoutine()  记 start → runAgent → 记 end          │
 └───────────────┬──────────────────────────────────────┘
                 │
   ┌─────────────┼───────────────────────────┐
   ▼             ▼                            ▼
cc routine run   cc routine trigger <id>   github 轮询
(cron/once 到期  (webhook 入口，            (--paginate=false,
 + github 轮询)   手动/外部触发)             8s 超时)
                 │
                 ▼
      cc agent -p <prompt> --output-format json
      → 解析末行 JSON：result / usage / total_cost_usd
      → 归档为一次 run（ok/failed，摘要=末 3 行）

常驻触发：cc loop --every 1m -- cc routine run   （或系统 cron / agenda wakeup）
```

## 命令参考

`list` 是默认子命令（`cc routine` 等同于 `cc routine list`）。

### `cc routine create <name>`

创建一条命名 routine。必须提供 `--prompt`，且 `--cron / --at / --webhook / --github` **恰好选一个**（否则报错 `pick exactly one trigger`）。

```bash
cc routine create "nightly report" \
  --prompt "汇总昨天的提交和未合并 PR，生成中文日报" \
  --cron "0 3 * * *"
```

| 旗标              | 说明                                                             | 默认 |
| ----------------- | ---------------------------------------------------------------- | ---- |
| `--prompt <text>` | 要跑的 Agent prompt（**必填**）                                  | —    |
| `--cron <expr>`   | 5 字段 cron，驱动到期触发                                        | —    |
| `--at <time>`     | 一次性 ISO 时间 / epoch 毫秒，驱动触发后自我停用                 | —    |
| `--webhook`       | 只经 `cc routine trigger <id>` 外部触发                          | 关   |
| `--github <repo>` | 轮询 `owner/name` 新事件触发（驱动经 `gh` 拉取）                 | —    |
| `--events <list>` | GitHub 事件类型过滤，逗号分隔（如 `PushEvent,PullRequestEvent`） | 全部 |
| `--json`          | 机器可读输出                                                     | 关   |

### `cc routine list`（默认）

列出全部 routine，带运行次数 / 成功失败 / 累计成本 / 最近一次汇总。

```bash
cc routine
cc routine list --json
```

### `cc routine enable <id>` / `disable <id>` / `remove <id>`

- `enable` / `disable`：启停某条 routine（`disable` 保留定义但不再触发）。
- `remove`：删除定义（**运行历史保留**）。注意删除命令是 `remove`，没有 `rm` 别名。

```bash
cc routine disable nightly      # id 前缀或精确 name 均可
cc routine remove one-shot
```

### `cc routine trigger <id>`

**立即**触发一条 routine——这是 webhook 类型的触发入口，也可手动强制触发任意类型。

```bash
cc routine trigger ci           # 支持 id / id 前缀 / name
```

### `cc routine run`

驱动器：触发所有到期的 cron/once routine，并轮询所有 github routine。由常驻触发器周期调用。

```bash
cc routine run
cc routine run --json
# 输出 fired <id> → <runId>，或 "Nothing due."
```

### `cc routine runs [id]` / `cc routine logs <runId>`

查看运行历史与单次完整输出。

```bash
cc routine runs                 # 全部 routine，最新在前
cc routine runs deploy -n 50    # 指定 routine，最多 50 行
cc routine logs run-abc123      # 某次运行的完整 Agent 输出
```

| 旗标              | 说明               | 默认 |
| ----------------- | ------------------ | ---- |
| `-n, --limit <n>` | 最大行数（`runs`） | `20` |
| `--json`          | 机器可读输出       | 关   |

## 配置参考

| 项           | 机制                                                  | 默认       | 备注                                          |
| ------------ | ----------------------------------------------------- | ---------- | --------------------------------------------- |
| 存储根目录   | `~/.chainlesschain/routines/`（`0700`）               | —          | `routines.json` + `runs.jsonl` + `logs/*.log` |
| 环境变量     | **无**（不读任何 `CC_*` / `process.env`）             | —          | 存储路径从 `os.homedir()` 硬派生              |
| cron 语法    | 标准 5 字段 `分 时 日 月 周`                          | —          | 与 `cc agenda` 共享解析引擎                   |
| github 触发  | 依赖已认证的 `gh` CLI（`gh api repos/<repo>/events`） | —          | `gh` 出错则解析为空（不触发）                 |
| 常驻触发     | `cc loop --every` / 系统 cron / agenda wakeup         | 无（手动） | 无内建 daemon                                 |
| 一次触发上限 | 每次触发 spawn 一个 `cc agent` 子进程                 | —          | github 轮询 8s 超时                           |

## 性能指标

| 维度        | 特性                                                             |
| ----------- | ---------------------------------------------------------------- |
| 定义存取    | `routines.json` 全量读写，O(routine 数)                          |
| 历史读取    | `runs.jsonl` 逐行合并 start/end，至多聚合 1000 行做汇总          |
| cron 求值   | 纯逻辑 `nextCronTime`，注入时钟 → 确定性                         |
| 追赶语义    | cron 落后 N 周期只触发一次（跳到下一触发点），不重放             |
| 容错        | 运行历史坏行逐行跳过；崩溃的 runner 记为 `failed`（exitCode -1） |
| github 去重 | 事件 id 高水位字符串比较，仅触发新事件；非目标类型也推进高水位   |

## 测试覆盖

| 测试文件                               | 覆盖                                                                                                                                                                                                                                                                             |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `__tests__/unit/routine-store.test.js` | 定义 CRUD（create/list/按 id 前缀或 name 查/enable/disable/remove）· 触发合法性（种类/cron/once/github repo）· `due()` 到期判定 · `fireRoutine` 记账（start/end、日志落盘、once 自停用、崩溃 runner→failed、`summarize()` 聚合、坏行容错）· `pollGithubRoutine` 高水位与事件过滤 |

> 覆盖集中在 store/lib 层（`RoutineStore`），命令层为薄封装。

## 安全考虑

- **触发即执行完整 Agent**：每次触发都以 routine 存的 `prompt` 跑一次 `cc agent -p ... --output-format json`——即一次拥有该 agent 全部工具/权限的自主执行。能创建/触发 routine 的人即可让 agent 执行任意任务。
- **webhook 触发本身无鉴权**：`cc routine trigger <id>` 就是「API/webhook 入口」，代码明确要求由你自建的 HTTP 接收器负责鉴权——**本命令不做任何 token / 签名 / HMAC 校验**。任何能本地运行 `cc routine trigger` 的进程都能触发。把它接到网络入口时，鉴权是你的责任。
- **github 触发是轮询而非签名 webhook**：鉴权委托给 `gh` CLI 自身的认证；事件新鲜度是事件 id 的字符串比较（假设 id 单调递增），不验证 GitHub webhook 密钥。
- **磁盘明文**：目录/日志以 `0700`（仅属主）创建，但 `routines.json`（含 prompt）与 `logs/*.log`（含完整 agent 输出，可能含敏感结果）以明文落盘。
- **无自跑 daemon**：cron/once 仅在你实际运行 `cc routine run` 时触发，可审计、可随时停用。

## 故障排除

| 现象                                 | 原因                                 | 处理                                                   |
| ------------------------------------ | ------------------------------------ | ------------------------------------------------------ |
| cron routine 从不触发                | 没有常驻触发器调用 `cc routine run`  | 起 `cc loop --every 1m -- cc routine run` 或系统 cron  |
| `create` 报 pick exactly one trigger | 未选或多选触发方式                   | `--cron / --at / --webhook / --github` 恰好选一个      |
| github routine 不触发                | `gh` 未安装/未认证，或事件类型被过滤 | `gh auth status` 确认；检查 `--events` 过滤是否过窄    |
| once routine 只跑了一次              | 设计如此——触发后 `enabled` 置 false  | 需重复请用 `--cron`                                    |
| 运行历史少了一条                     | `runs.jsonl` 某行损坏被跳过          | 检查 `~/.chainlesschain/routines/runs.jsonl` 对应行    |
| 某次运行状态 `running` 不消失        | 只有 start 行、无 end 行（进程中断） | 该次触发未正常结束；重新 `trigger` 或查 `logs <runId>` |
| webhook routine 收不到触发           | 期待驱动自动触发                     | webhook 类型**只**经 `cc routine trigger <id>` 触发    |

## 关键文件

| 文件                                           | 职责                                                                                                                         |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `packages/cli/src/commands/routine.js`         | `cc routine create/list/enable/disable/remove/trigger/run/runs/logs`；`defaultRunAgent`（spawn `cc agent`）；github 事件拉取 |
| `packages/cli/src/lib/routine-store.js`        | `RoutineStore` 类：定义 CRUD、`due()`、`fireRoutine`、`pollGithubRoutine`、运行历史与汇总                                    |
| `packages/cli/src/lib/agent-schedule-store.js` | 共享的 `parseCron` / `nextCronTime` cron 引擎                                                                                |
| `packages/cli/src/commands/agenda.js`          | 姊妹驱动（临时调度层）                                                                                                       |

## 使用示例

### 1. 每日 03:00 cron 日报

```bash
cc routine create "nightly report" \
  --prompt "汇总昨天的提交和未合并 PR，生成中文日报" \
  --cron "0 3 * * *"
```

### 2. 一次性定时任务（触发后自停用）

```bash
cc routine create "one shot" \
  --prompt "起草这次发版的 release notes" \
  --at 2026-07-12T09:00:00Z
```

### 3. webhook 外部触发

```bash
cc routine create "ci hook" --prompt "分析失败的构建并给出修复建议" --webhook
# 把任意 HTTP 接收器接到下面这条命令（自行加鉴权）：
cc routine trigger ci
```

### 4. GitHub 事件触发（需已认证 gh）

```bash
cc routine create "deploy watch" \
  --prompt "审查 acme/app 的新推送并总结影响" \
  --github acme/app --events PushEvent,PullRequestEvent
```

### 5. 常驻驱动 + 查看历史

```bash
cc loop --every 1m -- cc routine run   # 常驻触发器
cc routine list --json                 # 看全部 routine 与成本汇总
cc routine runs deploy -n 50           # 某条 routine 的运行历史
cc routine logs run-abc123             # 某次运行完整输出
cc routine disable nightly             # 保留但停用
```

## 相关文档

- [长任务调度 `cc agenda`](./cli-agenda.md) — 临时调度层（wakeup/cron/monitor），`cc routine` 的姊妹与底层 cron 引擎来源
- [`cc loop` 循环执行](./cli-loop.md) — 常驻触发 `cc routine run` 的推荐方式
- [CLI Agent 模式](./cli-agent.md) — 每次触发实际执行的 `cc agent -p ... --output-format json`
- [后台 Agent — daemon / attach / logs](./cli-background-agents.md) — 分离式长时运行的姊妹能力
- [跨端远程控制 `cc remote-control`](./cli-remote-control.md) — 第四阶段跨端能力
