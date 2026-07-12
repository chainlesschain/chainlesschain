# 后台 Agent — 分离式长时运行（`cc agent --bg` / `daemon` / `attach` / `logs`）

> **版本: 第四阶段（跨端与长任务）· 状态: ✅ 生产就绪 | 分离式 Agent 会话：`--bg` 立即返回 id → `logs` 看输出 / `attach` 交互接管 / `daemon` 检视与停止 | 每会话独立 worker 进程 + 心跳 + 本地控制通道 + phase 状态机 |**
>
> 后台 Agent 让你把一次 `cc agent` 对话**分离（detached）**跑：启动器立刻返回一个会话 id，一个专属 worker 进程在后台监督它、写心跳与状态文件、并托管一个本地控制通道，你随后可以随时 `logs` 看输出、`attach` 交互续跑、`daemon` 检视/重命名/恢复/删除/停止。

## 概述

前台 `cc agent` 跑完一轮就占着你的终端。后台 Agent 把它挪到后台：

- `cc agent --bg`（别名 `--background`）—— 分离启动，**立即**返回 `bg-<ts>-<hex>` 会话 id。
- 每个会话由一个 detached **worker 进程**监督：写 `<id>.json` 状态（`0600`）、每 5s 一次心跳、把 Agent 子进程的 stdout/stderr 汇入 `<id>.log`，并托管一个本地 NDJSON 控制通道（POSIX domain socket / Windows named pipe）。
- 用 `cc logs` 看输出、`cc attach` 交互接管、`cc daemon` 家族做检视与生命周期管理。
- worker 维护一个 **phase 状态机**（`starting` / `working` / `idle` / `needs_input` / `waiting_permission`），配合监督器的 liveness 对账（`running` / `completed` / `failed` / `stopped` / `lost`），让仪表板准确区分「在干活」「空闲挂起」「真的在等你拍板」。

## 核心特性

- 🚀 **分离启动**：`--bg` 立即返回 id，Agent 在后台独立进程跑，`unref` 不拖住终端。
- 🫀 **心跳 + liveness 对账**：worker 每 5s 心跳；心跳过期（默认 120s）/ pid 已死 / pid 被 OS 复用 → 标记 `lost`（带 `lostReason`），并回收孤儿孙进程。
- 🧭 **phase 状态机**：`idle`（跑完一轮、挂起、通道开着）不会被误标成「需要输入」——后者只留给真正阻塞人的决策（`needs_input` / `waiting_permission`）。
- 🔌 **交互接管**：通道可用 + TTY 时 `attach` 进交互 REPL（发续跑 prompt、`/stop`、`/status`、Ctrl-C 分离）；否则退化为日志跟随。
- 📜 **日志跟随**：`logs` 打印尾部；`attach --no-follow` 只打印初始尾巴即退；跟随时按字节偏移读、处理日志轮转/截断。
- 🔁 **续跑已结束会话**：`daemon resume <id> <prompt>` 在同一对话上开一个新的后台运行。
- 🧹 **生命周期管理**：`daemon status/view/rename/resume/rm/stop`，`stop --any` 一键停全部。
- 🔐 **本地能力令牌**：worker 生成 16 字节随机 token 存进 `0600` 状态文件；客户端首帧须 `{type:hello, token}` 校验，错 token / 错首帧 / 5s 静默即断开。

## 系统架构

```
 cc agent --bg -p "<task>"
        │  launchBackgroundAgent()   lib/background-agent-supervisor.js
        │   ① assertUsableCwd（cwd 已删/未挂载 → fail fast）
        │   ② 生成 id bg-<ts>-<hex>，先写状态(running)+job 文件(0600)
        │   ③ spawn worker（detached, stdio ignore, windowsHide, unref）
        ▼
 ┌───────────────────────────────────────────────────────────┐
 │ worker  src/workers/background-agent-worker.js             │
 │  读 job → 删 job 文件 → 开 log fd → 起控制通道              │
 │  每 5s 心跳；phase 持久化                                    │
 │  startTurn：spawn `node <cliEntry> <argv>`                  │
 │    env.CC_BACKGROUND_AGENT_ID=<id>, stdio→log.fd, detached  │
 │  maybeContinue：队列有 prompt → 下一轮；有客户端 → idle 挂起 │
 │  背压 MAX_PROMPT_QUEUE=100                                   │
 └───────────────────────────────┬───────────────────────────┘
   状态/日志：~/.chainlesschain/background-agents/
     <id>.json（状态 0600） · <id>.log · <id>.job.<pid>.json（瞬态）
   通道：POSIX <id>.sock / Windows \\.\pipe\cc-bg-<id>
        │
        ├── cc logs <id>          打印尾部 N 行后退出
        ├── cc attach <id>        通道可用+TTY → 交互 REPL；否则日志跟随
        └── cc daemon status|view|rename|resume|rm|stop
             liveness 对账 effectiveBackgroundAgentState → running/…/lost
```

## 命令参考

### `cc agent --bg`（别名 `--background`）

分离启动一个后台 Agent，立即返回 id。

```bash
cc agent --bg -p "重构 auth 模块并补测试"
# Background agent started: bg-1752345678901-a1b2c3
#   cc agents logs bg-…    cc agents stop bg-…
```

- 需要任务（位置文本 / `-p` / 管道 stdin），否则报 `--bg requires a task`。
- 不能与 `--worktree` 同用。
- `--output-format json` 时打印状态 JSON。

### `cc logs <id>`

打印后台 Agent 的近期输出后退出（不跟随）。

```bash
cc logs bg-1752345678901-a1b2c3 -n 200
```

| 旗标              | 说明 | 默认  |
| ----------------- | ---- | ----- |
| `-n, --lines <n>` | 行数 | `100` |

### `cc attach <id>`

接入一个后台 Agent——通道可用时交互，否则日志流。

```bash
cc attach bg-1752345678901-a1b2c3
cc attach bg-1752345678901-a1b2c3 --no-input     # 只看日志，永不发 prompt
cc attach bg-1752345678901-a1b2c3 --no-follow    # 打印初始尾巴即退
```

| 旗标              | 说明                       | 默认  |
| ----------------- | -------------------------- | ----- |
| `-n, --lines <n>` | 初始打印行数               | `100` |
| `--no-follow`     | 打印初始尾巴即退（不跟随） | 跟随  |
| `--no-input`      | 只读日志流，永不发 prompt  | 可发  |

> 交互 REPL 内：普通文本 = 发续跑 prompt；`/stop` / `/status` / `/detach`(`/exit`/`/quit`)；Ctrl-C 分离（不停 Agent）。

### `cc daemon`

检视与停止后台 Agent 监督会话。

```bash
cc daemon status                 # 列出运行中的会话
cc daemon status --all --json    # 含已完成/失败/停止/丢失
cc daemon view bg-… -n 40        # 单会话详情
cc daemon view                   # 无 id → 交互 TTY 仪表板
cc daemon rename bg-… "auth 重构"
cc daemon resume bg-… "现在更新 changelog"   # 同对话上开新后台运行
cc daemon stop bg-…              # 停一个
cc daemon stop --any             # 停全部运行中
cc daemon rm bg-…                # 删已结束会话的记录+日志
```

| 子命令                    | 关键旗标                                      | 说明                                 |
| ------------------------- | --------------------------------------------- | ------------------------------------ |
| `status`                  | `--all`、`--json`                             | 列出会话（`--all` 含终态）           |
| `view [id]`               | `-n, --lines <n>`（默认 `40`）、`--json`      | 单会话详情；无 id → TTY 仪表板       |
| `rename <id> <title...>`  | `--json`                                      | 重命名会话                           |
| `resume <id> <prompt...>` | `--json`                                      | 在同一对话上开一个新的后台运行       |
| `rm <id>`                 | `--force`（先停再删）、`--keep-log`、`--json` | 删记录（+日志）                      |
| `stop [id]`               | `--any`（停全部）、`--json`                   | 停一个或全部（须给 `id` 或 `--any`） |

> 没有 `daemon list`——`daemon status` 就是列表。`cc agents background|bg|logs|view|stop` 是重叠的另一套入口（`--bg` 成功提示即指向 `cc agents logs/stop`）。

## 配置参考

| 项               | 环境变量                                 | 默认                                              | 说明                                            |
| ---------------- | ---------------------------------------- | ------------------------------------------------- | ----------------------------------------------- |
| 会话目录         | `CC_BACKGROUND_AGENTS_DIR`               | `~/.chainlesschain/background-agents/`            | `<id>.json`（0600）+ `<id>.log` + 瞬态 job 文件 |
| 心跳过期阈值     | `CC_BACKGROUND_AGENT_HEARTBEAT_STALE_MS` | `120000`（120s）                                  | 超过即候选 `lost`                               |
| 心跳间隔         | —（常量）                                | `5000`（5s）                                      | worker 写心跳节奏                               |
| pid 身份容差     | —（常量）                                | `60000`                                           | 防 pid 复用误杀                                 |
| Agent 子进程 env | `CC_BACKGROUND_AGENT_ID`（worker 注入）  | —                                                 | 子进程知道自己属于哪个后台会话                  |
| 控制通道         | —                                        | POSIX `<id>.sock` / Windows `\\.\pipe\cc-bg-<id>` | 本地 NDJSON                                     |

## 性能指标

| 维度     | 特性                                                                     |
| -------- | ------------------------------------------------------------------------ |
| 启动     | 先写状态+job 再 spawn worker；`unref` 不拖住父进程                       |
| 心跳     | 每 5s；过期 120s 触发 liveness 对账                                      |
| liveness | pid 存活 + 创建时间探测（`isSameProcess`）防 pid 复用误判                |
| 日志     | 追加式 UTF-8 文件；尾读按字节偏移，处理轮转/截断                         |
| 背压     | prompt 队列上限 100，溢出拒绝为错误                                      |
| 状态写入 | 字段感知合并 + 原子 tmp+rename；终态压过并发 running、最新 rename/pin 胜 |

## 测试覆盖

| 测试文件                                                       | 行数 | 覆盖                         |
| -------------------------------------------------------------- | ---- | ---------------------------- |
| `__tests__/unit/background-agent-supervisor.test.js`           | 778  | 启动/监督/liveness 对账/停止 |
| `__tests__/unit/background-agent-ws-protocol.test.js`          | 471  | WS/通道协议                  |
| `__tests__/unit/background-session-transport.test.js`          | 175  | 交互通道传输 + token 握手    |
| `__tests__/unit/background-session-command.test.js`            | 126  | 命令层（logs/attach/daemon） |
| `__tests__/unit/background-agent-phase.test.js`                | 118  | phase 状态机 + 分组          |
| `__tests__/integration/background-stability-realspawn.test.js` | —    | 真 spawn 稳定性              |

> 约 12 个测试文件触及 background；其中 5–6 个是本 cluster 核心。（注意 `background-task-*` 是另一套「通用后台任务」子系统，不属本 cluster。）

## 安全考虑

- **本地控制通道**：worker 只在 Windows named pipe / POSIX domain socket 上托管 NDJSON 服务，不监听网络端口。
- **能力令牌模型**：worker 生成 16 字节随机 token，存进 **`0600`** 状态文件（与通道路径同处）。客户端首帧须发 `{type:hello, token}`；错 token / 错首帧 / 5s 静默即断开。**在 Windows 上 named pipe 对本机其他用户可达——「持有状态文件即持有能力」**，故所有会话文件均 `0600`。
- **帧上限**：单帧 1MB（`MAX_LINE_BYTES`），无法解析的输入直接断开连接。
- **pid 复用硬化**：`stop` / 回收前用 `isSameProcess`（进程创建时间探测）再核对——绝不杀掉继承了复用 pid 的无关进程，遇到就标 `lost` 而非误杀。
- **停止策略**：Windows `taskkill /PID <pid> /T /F`；POSIX 对 worker 进程组发 `SIGTERM`（`-pid`），并对分离的 Agent 子进程做身份守卫的组级 SIGTERM。

## 故障排除

| 现象                           | 原因                                 | 处理                                                           |
| ------------------------------ | ------------------------------------ | -------------------------------------------------------------- |
| `--bg requires a task`         | 没给任务                             | 加 `-p "<task>"` 或位置文本 / 管道 stdin                       |
| `--bg` 与 `--worktree` 报错    | 两者互斥                             | 二选一                                                         |
| 会话显示 `lost`                | 心跳过期 / pid 已死 / pid 被复用     | 看 `lostReason`；`cc logs <id>` 查最后输出；必要时 `daemon rm` |
| `attach` 进不去交互只跟日志    | 通道不可用 / 非 TTY / 会话非 running | 正常退化；用可交互终端在会话 running 时 attach                 |
| `daemon stop` 说要 id 或 --any | 未指定目标                           | 给 `<id>` 或 `--any`                                           |
| `rm` 拒删运行中会话            | 会话仍在跑                           | 加 `--force`（先停再删），或 `--keep-log` 只删记录             |
| cwd 已删导致启动失败           | `assertUsableCwd` fail fast          | 换一个存在的工作目录再启动                                     |

## 关键文件

| 文件                                                   | 行数 | 职责                                    |
| ------------------------------------------------------ | ---- | --------------------------------------- |
| `packages/cli/src/lib/background-agent-supervisor.js`  | 845  | 启动/监督/状态读写/liveness 对账/停止   |
| `packages/cli/src/commands/background-session.js`      | 683  | `logs` / `attach` / `daemon` 命令层     |
| `packages/cli/src/lib/background-session-transport.js` | 315  | 交互接管的本地 NDJSON 通道 + token 握手 |
| `packages/cli/src/workers/background-agent-worker.js`  | 276  | detached worker：心跳 / 轮次 / phase    |
| `packages/cli/src/lib/background-agent-phase.js`       | 100  | phase 状态机 + 仪表板分组               |
| `packages/cli/src/commands/agent.js`                   | —    | `--bg` 旗标 + 处理                      |
| `packages/cli/src/repl/bg-dashboard.js`                | —    | 交互 TTY 仪表板（`daemon view` 无 id）  |

## 使用示例（完整生命周期）

```bash
# 1. 分离启动（立即返回 id）
cc agent --bg -p "重构 auth 模块并补测试"

# 2. 列出运行中的会话（--all 看终态）
cc daemon status
cc daemon status --all --json

# 3. 看近期输出（不跟随）
cc logs bg-1752345678901-a1b2c3 -n 200

# 4. 交互接管（发续跑 prompt；/stop、/status、Ctrl-C 分离）
cc attach bg-1752345678901-a1b2c3
#    或只看日志、绝不发输入：
cc attach bg-1752345678901-a1b2c3 --no-input

# 5. 单会话详情 / 无 id 进 TTY 仪表板
cc daemon view bg-1752345678901-a1b2c3 -n 40
cc daemon view

# 6. 重命名、续跑、停止、清理
cc daemon rename bg-1752345678901-a1b2c3 "auth 重构"
cc daemon resume bg-1752345678901-a1b2c3 "现在更新 changelog"
cc daemon stop bg-1752345678901-a1b2c3        # 或 cc daemon stop --any
cc daemon rm bg-1752345678901-a1b2c3          # 运行中加 --force；保留日志加 --keep-log
```

## 相关文档

- [CLI Agent 模式](./cli-agent.md) — 前台对应命令，`--bg` 是进入本 cluster 的入口
- [用户自定义子 Agent `cc agents`](./cli-agent.md) — `.claude/agents/*.md`，并重叠注册 `cc agents background|logs|view|stop`
- [长任务调度 `cc agenda`](./cli-agenda.md) — 定时/周期触发的姊妹能力
- [命名定时/触发任务 `cc routine`](./cli-routine.md) — 命名 + 运行历史的调度层
- [跨端远程控制 `cc remote-control`](./cli-remote-control.md) — WS/移动端接入同一传输通道
