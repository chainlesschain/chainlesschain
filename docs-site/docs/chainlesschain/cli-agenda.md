# 长任务调度 — Monitor / Cron / Push（`cc agenda`）

> **版本: 第四阶段（跨端与长任务）#3 · 2026-07-09 | 状态: ✅ 生产就绪 | 一次性 wakeup + Cron 表达式 + Monitor 停止条件 + 多渠道推送 + `notify`/`schedule` 两个 Agent 工具 | 29 测试全绿**
>
> 一次性的 Agent turn 无法给自己续命定时器。`cc agenda` 补齐了这个缺口：Agent 用 `schedule` 工具把「过一会儿/按 cron/满足条件时」的意图**持久化**下来，`cc agenda run`（由 `cc loop` 或系统 cron 常驻触发）在到点时真正执行——重新拉起 `cc agent`、或跑监控命令并在命中停止条件时经 `notify` 推送通知。

## 概述

Agent 的一次执行是有始有终的：它跑完一轮就退出，没有一个常驻进程替它「三天后提醒我」「每天 9 点跑一次报告」「盯着日志出现 ERROR 就叫我」。`cc agenda` 用**持久化 + 外部触发器**这对组合解决它：

- Agent 在 turn 内调用 `schedule` 工具，把调度意图写入 `~/.chainlesschain/agent-schedule/<kind>.jsonl`（`0600`）。
- 一个常驻触发器（`cc loop --every 1m -- cc agenda run`，或系统 cron / systemd timer）周期性调用 `cc agenda run`。
- `cc agenda run` 扫描到期项并真正执行：
  - **wakeup**（一次性）/ **cron**（周期）→ 重新 spawn `cc agent -p <prompt>`（cron 完成后推进到下一次触发时间）；
  - **monitor** → 跑一条命令，输出命中 `stop_when` 正则则经 `notify` 推送并停止，否则重挂到下一个间隔，直到 `max_checks` 耗尽。

配套引入两个新的 Agent 工具——`notify`（多渠道推送）与 `schedule`（五动作调度）——让 Agent 在会话内就能安排未来的自己。

## 核心特性

- ⏰ **一次性 wakeup**: 延迟 N 之后跑一次给定 prompt——「20 分钟后检查构建结果」。
- 🗓️ **Cron 周期**: 标准 5 字段 cron 表达式（`分 时 日 月 周`，支持 `* , - /`）周期性跑 prompt；内置解析器 + `nextCronTime` 求值。
- 👁️ **Monitor 停止条件**: 命令 + 间隔 + `stop_when` 正则 + `max_checks`——盯着某个命令的输出，命中即 `notify` 并停，否则耗尽检查次数后停。
- 📣 **多渠道推送**: `notify` 工具 fan-out 到 `NotificationManager`（Telegram / 企业微信 / 钉钉 / 飞书）；`level` 映射 start/success/failure；无渠道配置返回 no-op 说明（不报错）。
- 🧰 **两个新 Agent 工具**: `schedule`（一工具五动作 wakeup/cron/monitor/list/cancel）+ `notify`（多渠道推送），均为 extension tier（`AGENT_TOOLS` 21 → 23）。
- 💾 **JSONL 持久化 + 容错**: 三类调度共享 `~/.chainlesschain/agent-schedule/<kind>.jsonl`（`0600`），逐行解析，坏行跳过不炸整表。
- 🔌 **可注入的执行副作用**: `cc agenda run` 的 spawn/命令执行/通知全部 deps 可注入——离线可单测；`--dry-run` / `--json`；任何单元失败 → 退出码 1。
- 🕹️ **无内建 daemon，显式触发**: 不偷偷起后台进程；用 `cc loop` 或系统 cron/systemd timer 常驻触发，行为透明可控。

## 系统架构

```
┌────────────────────── Agent turn 内 ──────────────────────┐
│  schedule 工具 (wakeup|cron|monitor|list|cancel)          │
│  notify 工具   (多渠道推送)                                │
│           │ 持久化意图                                      │
└───────────┼───────────────────────────────────────────────┘
            ▼
 ┌─────────────────────────────────────────────┐
 │  AgentScheduleStore (agent-schedule-store.js) │
 │  ~/.chainlesschain/agent-schedule/<kind>.jsonl│
 │  · 5 字段 cron 解析 + 求值 (* , - /)          │
 │  · 注入时钟 · 逐行容错(坏行跳过)               │
 │  · due() / markWakeupFired / advanceCron /    │
 │    recordMonitorCheck                          │
 └───────────────────┬───────────────────────────┘
                     │ due 项
 ┌───────────────────▼───────────────────────────┐
 │  cc agenda run  (commands/agenda.js)           │
 │  ├─ wakeup/cron → spawn cc agent -p <prompt>   │
 │  │                 (cron 完成 → advanceCron)     │
 │  └─ monitor → 跑命令                            │
 │       命中 stop_when → notify + 停              │
 │       未命中 → 重挂下一间隔 / max_checks 耗尽    │
 └───────────────────┬───────────────────────────┘
                     ▼
 ┌─────────────────────────────────────────────┐
 │  sendAgentNotification (agent-notify.js)      │
 │  → NotificationManager.fromEnv                │
 │    Telegram / WeCom / DingTalk / Feishu       │
 │  无渠道 → no-op note（不报错）                 │
 └─────────────────────────────────────────────┘

常驻触发：cc loop --every 1m -- cc agenda run   （或系统 cron / systemd timer）
```

## 命令参考

### `cc agenda list`

列出全部已排期的 wakeup / cron / monitor 条目。

```bash
cc agenda list
cc agenda list --json
```

### `cc agenda run`

触发全部到期条目（由常驻触发器周期性调用）。

```bash
cc agenda run                 # 触发到期项
cc agenda run --dry-run       # 只显示会触发什么，不执行
cc agenda run --json          # 机器可读结果
```

| 旗标        | 说明                             | 默认 |
| ----------- | -------------------------------- | ---- |
| `--dry-run` | 只列出到期项，不执行副作用       | 关   |
| `--json`    | 机器可读输出                     | 关   |

> 任何一个到期单元执行失败 → 进程退出码为 1（可作 CI/守护脚本的健康信号）。

### `cc agenda cancel`

按 id 取消一个已排期条目。

```bash
cc agenda cancel <id>
```

### 常驻触发（推荐）

`cc agenda` 不内建后台守护进程。用以下任一方式周期性触发：

```bash
# 用内建 cc loop 每分钟触发一次
cc loop --every 1m -- cc agenda run

# 或系统 cron（Linux/macOS）
* * * * * cc agenda run

# 或 systemd timer / Windows 计划任务
```

## Agent 工具参考

以下两个工具供 Agent 在 turn 内调用（不是顶层 CLI 命令）。

### `schedule` — 一工具五动作

| action    | 参数                                                     | 效果                                                     |
| --------- | -------------------------------------------------------- | -------------------------------------------------------- |
| `wakeup`  | `prompt`, `delay`（秒/时长）                             | 延迟后跑一次 `cc agent -p <prompt>`                      |
| `cron`    | `prompt`, `cron`（5 字段表达式）                         | 按 cron 周期跑 prompt                                    |
| `monitor` | `command`, `interval`, `stop_when`（正则）, `max_checks` | 周期跑命令，输出命中正则则 `notify` 并停                |
| `list`    | —                                                        | 列出已排期条目                                          |
| `cancel`  | `id`                                                     | 取消一个条目                                            |

### `notify` — 多渠道推送

| 参数      | 说明                                                        |
| --------- | ----------------------------------------------------------- |
| `message` | 通知正文                                                    |
| `level`   | `start` / `success` / `failure`（映射 NotificationManager 的对应通道语义）|
| 返回      | `{ delivered, failed, channels }`；无渠道配置时返回 no-op note |

**策略**：两个工具均为 riskLevel **LOW**、`planModeBehavior: blocked`（有外部/未来副作用，不进 plan mode 预演）、非 read-only。`notify` 面向用户自己的通知渠道，走 auto 流。

## 配置参考

| 项           | 机制                                                | 默认        | 备注                                      |
| ------------ | --------------------------------------------------- | ----------- | ----------------------------------------- |
| 调度存储     | `~/.chainlesschain/agent-schedule/<kind>.jsonl`     | —           | `0600`，三类各一 JSONL，逐行容错          |
| 通知渠道     | `NotificationManager.fromEnv`（环境变量配置）       | 无（no-op） | Telegram / WeCom / DingTalk / Feishu      |
| cron 语法    | 标准 5 字段 `分 时 日 月 周`                         | —           | 支持 `*` `,` `-` `/`                      |
| 常驻触发     | `cc loop --every` / 系统 cron / systemd timer       | 无（手动）  | 无内建 daemon                             |

## 性能指标

| 维度       | 特性                                                        |
| ---------- | ----------------------------------------------------------- |
| 触发开销   | `cc agenda run` 单次扫描三个 JSONL，O(条目数)              |
| 容错       | 单行损坏跳过，不影响其余条目（逐行解析）                    |
| cron 求值  | 纯逻辑 `nextCronTime`，注入时钟 → 确定性可测               |
| monitor 界 | 命中 `stop_when` 即停，否则至多 `max_checks` 次检查后停    |
| 副作用隔离 | spawn/命令/通知全部 deps 可注入，`--dry-run` 零副作用      |

> 真机 smoke：`cc agenda list` / `cc agenda run` / `cc agenda --help` 全通。

## 测试覆盖

共 **29 测试**，全绿。

| 测试文件                             | 数量 | 覆盖                                                                            |
| ------------------------------------ | ---- | ------------------------------------------------------------------------------- |
| `agent-schedule-store.test.js`       | 12   | cron 解析 / `nextCronTime` / wakeup due / cron 推进 / monitor 命中+maxChecks / 坏正则 / 坏行容错 / list+cancel |
| `agent-notify.test.js`               | 5    | 多渠道 fan-out / level 映射 / 无渠道 no-op / delivered+failed 汇总              |
| `agenda-command.test.js`             | 8    | list/run/cancel / dry-run / json / 到期触发 spawn / monitor notify / 失败退出码 |
| `agent-core-schedule-notify.test.js` | 4    | `schedule`/`notify` 工具 dispatch（executeToolInner）+ 参数格式化               |

## 安全考虑

- **持久化即执行**：`schedule` 写入的意图会被 `cc agenda run` **真正执行**（spawn agent / 跑 shell 命令）。调度存储以 `0600` 落盘，仅属主可读写；不要把不可信内容写进 monitor 的 `command`。
- **plan mode 屏蔽**：`schedule` 和 `notify` 有外部/未来副作用，`planModeBehavior: blocked`——plan mode 预演时不会真的排期或推送。
- **无渠道不静默失败**：`notify` 在没有配置任何通知渠道时返回明确的 no-op note，而不是假装发送成功。
- **触发透明**：没有内建后台 daemon 偷跑；触发完全由用户显式的 `cc loop` 或系统 cron 掌控，便于审计与停用。

## 故障排除

| 现象                          | 原因                             | 处理                                                       |
| ----------------------------- | -------------------------------- | ---------------------------------------------------------- |
| 排期了但从不触发              | 没有常驻触发器调用 `cc agenda run` | 起 `cc loop --every 1m -- cc agenda run` 或系统 cron       |
| `notify` 返回 no-op           | 未配置任何通知渠道               | 按 [`cc notification`](./cli-notification.md) 配置渠道环境变量 |
| cron 从不匹配                 | cron 表达式写错                  | 用标准 5 字段 `分 时 日 月 周`；`cc agenda list` 看解析结果 |
| monitor 一直不停              | `stop_when` 正则从不命中         | 检查正则；到 `max_checks` 会自动停                         |
| `cc agenda run` 退出码 1      | 某个到期单元执行失败             | 看输出定位失败单元；`--dry-run` 先预演                     |
| 调度列表少了一条              | JSONL 某行损坏被跳过             | 检查 `~/.chainlesschain/agent-schedule/<kind>.jsonl` 该行 |

## 关键文件

| 文件                                                       | 职责                                                          |
| ---------------------------------------------------------- | ------------------------------------------------------------- |
| `packages/cli/src/commands/agenda.js`                      | `cc agenda list/run/cancel`——到期触发 spawn/monitor/notify    |
| `packages/cli/src/lib/agent-schedule-store.js`             | `AgentScheduleStore` + `parseCron` + `nextCronTime` + JSONL 持久化 |
| `packages/cli/src/lib/agent-notify.js`                     | `sendAgentNotification`——包 `NotificationManager.fromEnv`     |
| `packages/cli/src/runtime/coding-agent-contract-shared.cjs` | `notify` / `schedule` 工具契约                                |
| `packages/cli/src/runtime/coding-agent-policy.cjs`         | `notify` / `schedule` 策略元数据（LOW / blocked / 非只读）    |
| `packages/cli/src/runtime/agent-core.js`                   | `executeToolInner` 中 `notify` / `schedule` 的 dispatch       |

## 使用示例

### 1. Agent 安排一次性提醒（turn 内）

```
（Agent 调用 schedule 工具）
schedule(action="wakeup", delay="20m",
         prompt="检查刚才那个构建有没有过，没过就贴出失败日志")
```

### 2. Agent 安排每日报告

```
schedule(action="cron", cron="0 9 * * *",
         prompt="汇总昨天的 git 提交并生成一段中文日报")
```

### 3. Agent 盯日志直到出现 ERROR

```
schedule(action="monitor", command="tail -n 50 app.log",
         interval="30s", stop_when="ERROR|FATAL", max_checks=120)
# 命中 ERROR/FATAL → notify 推送到已配置渠道并停止
```

### 4. 常驻触发并查看

```bash
cc loop --every 1m -- cc agenda run      # 常驻触发器
cc agenda list                           # 看已排期的条目
cc agenda run --dry-run                  # 预演本轮会触发什么
```

## 相关文档

- [CLI Agent 模式](./cli-agent.md) — `cc agent -p` 无头执行（wakeup/cron 触发的底层）
- [`cc loop` 循环执行](./cli-loop.md) — 常驻触发 `cc agenda run` 的推荐方式
- [通知系统 `cc notification`](./cli-notification.md) — 多渠道推送渠道配置（`notify` 工具底层）
- [编码 Agent 工具集](./coding-agent.md) — Agent 工具契约与策略（`notify`/`schedule` 所在）
- [跨端远程控制 `cc remote-control`](./cli-remote-control.md) — 第四阶段姊妹能力
- [CLI 对标 Claude Code 优化计划](/design/CLAUDE_CODE_CLI_PARITY_OPTIMIZATION_PLAN) Phase 6（异步 Hooks / Monitors）
