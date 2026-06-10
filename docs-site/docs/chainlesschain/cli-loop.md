# 定时循环执行（cc loop）

> **状态: ✅ 生产可用 | Claude-Code `/loop` 平价（固定间隔 MVP）| 纯函数驱动核 + 时钟注入 | 46 测试全绿（34 单元 + 4 集成 + 8 E2E）**
>
> `cc loop` 在固定间隔上**反复运行一件事**——一个 agent prompt 或一条外部命令——直到停止条件触发或 Ctrl-C。它刻意保持轻量：不同于 `cc ccron`（内存 profile 治理，不真正执行）和 `cc automation`（DB-backed 流程/触发器引擎），它只是一个带停止条件、可持久化恢复的定时重跑器。

## 概述

很多任务的形态是「隔一会儿再看一眼」：盯 CI 是否转绿、轮询部署状态、反复跑测试直到通过。`cc loop` 把这件事变成一行命令。两种模式由字面量 `--` 分隔符消歧：

- **prompt 模式**（无 `--`）：操作数是一个 PROMPT，每轮经 `cc agent -p <prompt>` 自我派生子进程运行；prompt 之后的未知 flag（如 `--think`、`--provider`）原样透传给 `cc agent`。
- **exec 模式**（有 `--`）：`--` 之后的操作数是一条**外部命令**，以 `shell: true` 运行（自动解析 Windows `.cmd` shim）。

每轮结束后按顺序评估停止条件（`done` > `exit-zero` > `match` > `max-iterations` > `signal`），轮间睡 `--every` 间隔（最后一轮后不睡）。`--dynamic` 让每轮的输出自己决定节奏：以 `[[loop:next <interval>]]` / `[[loop:stop]]` 控制指令收尾。`--save`/`--resume` 把循环持久化为可续跑会话，迭代计数跨恢复**累计**。

## 核心特性

- ⏲️ **人类可读间隔**：`--every 30s / 5m / 1.5h / 500ms`，裸数字按**秒**解释（`--every 30` ≡ `30s`）
- 🎯 **四种停止条件**：`--max-iterations N`（跑满 N 轮）、`--until-exit-zero`（某轮退出码 0，如测试转绿）、`--until <regex>`（某轮输出匹配 JS 正则）、Ctrl-C（当前轮跑完后优雅停止）
- 🤖 **`--dynamic` 自定步调**：prompt 模式自动在 prompt 末尾追加协议说明；每轮输出末尾最多一条指令：`[[loop:next 30s]]`（下一轮延时）或 `[[loop:stop]]`（任务完成停止）；`stop` 优先于 `next`，畸形 interval 被忽略回退到 `--every`
- 💾 **可持久化/续跑**：`--save [id]` 写入 `loop_config` 事件（省略 id 自动生成）；`--resume <id>` 加载保存的配置继续，轮次编号与 `--max-iterations` **跨恢复累计**；resume 时命令行显式传的 flag 覆盖保存值（经 `getOptionValueSource` 判别）
- 📺 **tee 输出**：需要读取输出时（`--until` 正则或 `--dynamic`）子进程 stdout/stderr 同时实时透传给用户并捕获用于匹配
- 🧹 **SIGINT 优雅停止**：第一次 Ctrl-C 中止轮间等待 + 向当前子进程转发 SIGINT，当前轮收尾后退出
- 🔢 **退出码镜像**：因停止条件结束时进程退出码 = 最后一轮的退出码；被中断（Ctrl-C）视为干净停止（0）
- 📤 **JSON 摘要**：`--json` 循环结束时输出 `{ iterations, stoppedBy, lastExitCode, elapsed, sessionId? }`
- 🔌 **flag 透传**：`allowUnknownOption` —— prompt 模式下未知 flag 全部转给 `cc agent`

## 命令参考

```bash
cc loop "check if CI passed, summarize failures"        # prompt 模式（默认每 5m）
cc loop --every 30s -- npm test                         # exec 模式：外部命令
cc loop --every 1m --max-iterations 10 -- npm test      # 最多 10 轮
cc loop --until-exit-zero --every 30s -- npm test       # 测试通过即停
cc loop --until "DONE" --every 1m "poll the deploy"     # 输出匹配正则即停
cc loop "review the diff" --think --provider openai     # 多余 flag 透传给 cc agent
cc loop --dynamic "watch the deploy; stop when live"    # agent 自定步调
cc loop --save ci-watch --every 1m -- npm test          # 持久化为可续跑循环
cc loop --resume ci-watch --max-iterations 20           # 续跑（计数累计，flag 可覆盖）
```

| Flag | 说明 | 默认 |
|------|------|------|
| `--every <dur>` | 轮间间隔（`30s`/`5m`/`1.5h`/`500ms`，裸数字=秒） | `5m` |
| `-n, --max-iterations <n>` | N 轮后停止（须为正整数；resume 时跨恢复累计） | — |
| `--until-exit-zero` | 某轮退出码 0 即停 | off |
| `--until <regex>` | 某轮输出匹配该 JS 正则即停 | — |
| `--dynamic` | 每轮经 `[[loop:next]]`/`[[loop:stop]]` 自定步调 | off |
| `--save [id]` | 持久化为可续跑会话（id 可省略，自动生成） | off |
| `--resume <id>` | 续跑一个 `--save` 过的循环会话 | — |
| `--json` | 结束时打印 JSON 摘要 | off |

## 系统架构

```
┌────────────────────────────────────────────────────────────────────┐
│ cc loop [parts...] [flags] [-- external command]                    │
│ (src/commands/loop.js — 命令层：拼装迭代 + SIGINT 接线)              │
└────────┬───────────────────────────────────────┬───────────────────┘
         │ 无 `--` → prompt 模式                  │ 有 `--` → exec 模式
         ▼                                       ▼
  spawn(node BIN agent -p <prompt> ...flags)   spawn(<joined cmd>, shell:true)
         │  （--dynamic 时 prompt 追加协议后缀）   │
         └────────────────┬──────────────────────┘
                          │ spawnIteration：tee + 捕获输出，
                          │ `close`（非 `exit`）事件判定完成；spawn 失败 → 127
                          ▼
        ┌────────────────────────────────────────────┐
        │ runLoop (src/lib/loop.js — 纯驱动核)        │
        │  每轮后评估：done > exit-zero > match        │
        │  > max-iterations > signal                  │
        │  轮间 sleep(nextDelayMs ?? intervalMs)       │
        │  （makeSleep：timer 绝不 unref，SIGINT 经     │
        │   AbortSignal 提前唤醒）                     │
        └──────────────────┬─────────────────────────┘
                           │ --save/--resume
                           ▼
        <home>/sessions/<id>.jsonl （jsonl-session-store）
          loop_config（一次）/ loop_iteration（每轮，只记
          n/exitCode/durationMs/done/nextDelayMs，不存输出体）/ loop_end
```

## 配置参考

- **间隔解析**（`parseDuration`）：支持 `ms`/`s`/`m`/`h` 后缀，可带小数（`1.5h`）；裸数字按秒；非法值直接报错退出。
- **resume 配置优先级**：保存的 `loop_config` 提供 `execMode/operands/every/maxIterations/untilExitZero/until/dynamic`；命令行**显式**重传的同名 flag（`getOptionValueSource === "cli"`）覆盖保存值。
- **输出捕获条件**：仅当 `--until <regex>` 或 `--dynamic` 时才 pipe 子进程输出（否则 `stdio: inherit` 零开销直通）。
- **会话存储**：`<home>/sessions/<id>.jsonl`（`~/.chainlesschain/`，受 `CHAINLESSCHAIN_HOME` 影响）；每轮只持久化紧凑记录（无输出体），续跑只需计数 + 配置。
- **环境透传**：子进程继承 `process.env`。
- 本命令无独立配置文件键；prompt 模式的 LLM 配置走 `cc agent` 自身的配置链。

## 性能指标

- **默认间隔 5m**；间隔下限 0（`parseDuration` 钳制为 ≥ 0 整数毫秒）。
- **停止条件在每轮之后评估**：任务保证至少跑一轮才可能停。
- **会话体积 O(轮数)**：`loop_iteration` 事件不含输出体，长循环会话文件保持很小。
- **spawn 失败语义**：子进程 `error` 事件 → 该轮 `exitCode 127`（不中断循环，交给停止条件判断）。
- 无吞吐类基准——本命令是定时驱动器，开销由被包裹的命令/agent 决定。基准数据待补。

## 测试覆盖

共 **46** 个测试（统计 `it(`/`test(`）：

| 测试文件 | 数量 | 覆盖 |
|----------|------|------|
| `packages/cli/__tests__/unit/loop-core.test.js` | 23 | `parseDuration`/`formatDuration`/`parseLoopDirectives`/`summarizeLoopEvents`/`runLoop` 停止条件与计数（时钟注入，零 timer 零子进程） |
| `packages/cli/__tests__/unit/loop-command.test.js` | 11 | 命令层：模式消歧、flag 解析、save/resume 接线 |
| `packages/cli/__tests__/integration/loop-workflow.test.js` | 4 | 持久化 → 续跑工作流 |
| `packages/cli/__tests__/e2e/loop-command.test.js` | 8 | 真实子进程端到端（含 headless 管道下进程存活回归） |

```bash
cd packages/cli
npx vitest run __tests__/unit/loop-core.test.js __tests__/unit/loop-command.test.js
```

## 安全考虑

- **exec 模式即 shell 执行**：`--` 之后的命令以 `shell: true` 运行，拥有当前用户全部权限——只循环你自己写的命令；prompt 模式内 agent 的工具调用仍受 `cc agent` 自身的权限规则/审批门（见 [权限规则](./cli-permissions.md)）约束。
- **SIGINT 双保险**：中断时既 abort 轮间等待，也向仍在运行的子进程转发 SIGINT，不留孤儿进程。
- **持久化不含输出体**：`loop_iteration` 只记元数据（轮次/退出码/耗时），命令输出不落盘，避免敏感输出意外持久化。
- **正则由用户提供**：`--until` 的正则在本地 `new RegExp` 编译，非法正则启动即报错退出（不会跑到一半才炸）。
- **`--dynamic` 指令解析是白名单式**：只识别 `[[loop:next <dur>]]` / `[[loop:stop]]` 两条指令，畸形 interval 静默回退 `--every`，输出无法注入其他行为。

## 故障排除

| 现象 | 可能原因 | 处理 |
|------|---------|------|
| `nothing to loop: ...` | 没给 prompt 也没给 `-- <command>` | `cc loop "提示词"` 或 `cc loop -- npm test` |
| `invalid duration: ...` | `--every` 格式非法 | 用 `30s`/`5m`/`1.5h`/`500ms` 或裸秒数 |
| headless/CI 下第一轮后进程就退出了 | 轮间 timer 被 unref（历史 bug，已修，e2e 锁死回归） | 升级 CLI；`makeSleep` 的 timer 绝不能 `unref()` |
| `--until` 匹配不生效 | 该正则匹配的是**捕获的输出**；只在 capture 开启时（`--until`/`--dynamic`）才有输出可匹配 | 确认正则按 JS 语法写、目标文本确实打印到 stdout/stderr |
| `--dynamic` 指令被忽略 | 指令没按 `[[loop:next 30s]]`/`[[loop:stop]]` 格式独立出现在输出末尾，或 interval 畸形 | 检查输出末行；畸形 interval 回退 `--every` 是预期行为 |
| `no such loop session: <id>` / `has no loop to resume` | 会话不存在，或该会话不是 `--save` 创建（无 `loop_config` 事件） | `cc session list` 核对；只有 `cc loop --save` 的会话可 resume |
| resume 后 `--max-iterations` 立即停止 | 计数跨恢复**累计**：已完成 8 轮 + `--max-iterations 8` → 直接到顶 | 传更大的值（如 `--max-iterations 20`）扩展预算 |
| 循环结束退出码非 0 | 退出码镜像最后一轮的退出码 | 预期行为；Ctrl-C 中断则恒为 0 |

## 关键文件

| 文件 | 说明 |
|------|------|
| `packages/cli/src/commands/loop.js` | 命令层（模式消歧、spawnIteration tee、SIGINT、save/resume 接线） |
| `packages/cli/src/lib/loop.js` | 纯驱动核（`runLoop`/`parseDuration`/`parseLoopDirectives`/`summarizeLoopEvents`/`makeSleep`） |
| `packages/cli/src/harness/jsonl-session-store.js` | 循环持久化（`loop_config`/`loop_iteration`/`loop_end` 事件） |
| `packages/cli/__tests__/unit/loop-core.test.js` | 驱动核单测（23） |
| `packages/cli/__tests__/e2e/loop-command.test.js` | 端到端测试（8） |

## 使用示例

```bash
# 1) 盯测试直到转绿（每 30 秒跑一次）
cc loop --until-exit-zero --every 30s -- npm test

# 2) 每分钟让 agent 看一眼 CI，总结失败原因
cc loop --every 1m "check if CI passed on main, summarize any failures"

# 3) 轮询部署，输出出现 DONE 就停
cc loop --until "DONE" --every 1m -- ./scripts/check-deploy.sh

# 4) agent 自定步调：自己决定下次多久后再看、何时收工
cc loop --dynamic "watch the deploy of release v5.0.3; stop when it's live"
#    （agent 输出末行 [[loop:next 2m]] 或 [[loop:stop]] 控制循环）

# 5) 持久化 + 隔天续跑（轮次累计）
cc loop --save ci-watch --every 5m --max-iterations 10 -- npm test
#    ... Ctrl-C 下班 ...
cc loop --resume ci-watch --max-iterations 30     # 从第 N+1 轮继续

# 6) 脚本消费结束摘要
cc loop --every 10s --max-iterations 3 --json -- node -e "process.exit(0)"
#    → { "iterations": 3, "stoppedBy": "max-iterations", "lastExitCode": 0, ... }
```

## 相关文档

- [CLI Agent 智能代理](./cli-agent.md)
- [会话管理（cc session）](./cli-session.md)
- [工作流自动化](./cli-automation.md)
- [权限规则（cc permissions）](./cli-permissions.md)
- [Hooks 系统](./hooks.md)
