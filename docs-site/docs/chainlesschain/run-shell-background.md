# 后台 Shell 执行（run_shell / check_shell）

> **版本: Claude-Code run_in_background + BashOutput 平价 | 状态: ✅ 生产可用 | 工具数 16→17 | 12 单元测试全绿**
>
> `run_shell` 支持 `run_in_background:true` 把长命令（构建 / 全量测试 / `npm run dev`）放到后台执行，立即返回 `bg_<n>` task_id 而不阻塞 agent 循环；新增 `check_shell` 工具增量轮询后台任务的状态、退出码与新输出，并可 `kill`。这对标 Claude Code 的 `run_in_background` + `BashOutput`。

## 概述

此前 `run_shell` 全同步执行（`execSync`）且硬编码 60s 超时，遇到构建、全量测试、`npm run dev` 这类长命令会**卡死整个 agent 循环**。现在 `run_shell { run_in_background: true }` 会 `spawn` 一个后台进程并立即返回 task_id，agent 可继续做别的事，之后用 `check_shell` 轮询进度——拿到自上次以来的新输出、退出码，或在需要时 `kill` 掉它。前台执行的超时也变为可配置。

## 核心特性

- 🚀 **后台执行**：`run_shell { run_in_background: true }` → `spawn(shell:true)`，立即返回 `bg_<n>` task_id，不阻塞 agent
- 📡 **增量轮询**：`check_shell` 返回自上次以来的**新**输出（消费式 cursor）+ status + exitCode
- 🛑 **可终止**：`check_shell { kill: true }` 终止后台任务
- 📋 **列出全部**：`check_shell` 不带 task_id → 列出所有后台任务
- ⏱️ **前台超时可配**：`run_shell { timeout }` 默认 60s，硬上限 10min；后台任务无超时
- 🔒 **同等门禁**：后台执行仍走完整的 shell 策略 + ApprovalGate 审批，安全不打折
- 🧹 **生命周期兜底**：REPL/headless 退出时自动清理残留后台任务，dev server 不会跨越 agent 生命周期
- 💾 **有界缓冲**：每个任务尾部缓冲上限 1MB（`MAX_BG_BUFFER`），增量游标读取

## 系统架构

```
run_shell { command, run_in_background: true }
   │  （仍过 shell-policy + ApprovalGate）
   ▼
spawn(shell:true) ──→ _backgroundShellTasks Map（模块级）
   │                    ├─ 进程句柄 + exitCode
   │                    ├─ 尾部缓冲（bounded 1MB, MAX_BG_BUFFER）
   │                    └─ 增量 cursor（_readBgStream）
   └─→ 立即返回 { task_id: "bg_<n>" }

check_shell { task_id }            → status / exitCode / 自上次以来新输出
check_shell { task_id, kill:true } → 终止任务
check_shell {}                     → 列出全部后台任务

完成判定：监听 `close` 事件（不是 `exit`）
  —— exit 在 stdout flush 前触发，会漏掉末段输出

退出清理：killAllBackgroundShellTasks()
  ├─ REPL rl.on('close')（runtime shutdown 前）
  └─ headless runAgentHeadless 的 finally（best-effort）
```

> **关键设计**：完成判定用 `close` 而非 `exit`——`exit` 会在 stdout flush 之前触发，导致轮询看到「已完成」但末段输出还没进缓冲（真 bug，已修）。

### 增量语义

`check_shell` 每次只返回**自上次以来**的新输出（消费式 cursor）。调用方需跨轮累加——agent 靠 message history 天然保留历次输出，无需额外处理。

## 工具参考

| 工具          | 参数                                        | 说明                                                                                    |
| ------------- | ------------------------------------------- | --------------------------------------------------------------------------------------- |
| `run_shell`   | `command`, `run_in_background?`, `timeout?` | `run_in_background:true` 后台执行返 task_id；否则前台（`timeout` 默认 60s，上限 10min） |
| `check_shell` | `task_id?`, `kill?`                         | 轮询某任务的新输出/状态；`kill:true` 终止；无 `task_id` 列全部（只读，plan-mode 允许）  |

## 配置参考

| 项              | 默认                        | 说明                                              |
| --------------- | --------------------------- | ------------------------------------------------- |
| 前台 `timeout`  | 60s                         | 可配，硬上限 10min（`_resolveShellTimeout`）      |
| 后台超时        | 无                          | 后台任务不设超时，由 agent 主动 `kill` 或退出清理 |
| `MAX_BG_BUFFER` | 1MB                         | 每任务尾部缓冲上限，超出按尾部保留                |
| 门禁            | shell-policy + ApprovalGate | 后台执行与前台同等审批                            |

## 性能指标

- **不阻塞循环**：后台命令 `spawn` 后立即返回，agent 循环继续，长任务并行推进。
- **增量读取**：`check_shell` 只传新增输出，避免重复回传整段日志。
- **有界内存**：尾部缓冲 1MB 上限，长输出任务不会无限占用内存。

## 测试覆盖率

共 **12** 个测试：

```bash
cd packages/cli
npx vitest run __tests__/unit/agent-core-run-shell-background.test.js
```

| 覆盖                                                                  | 数量 |
| --------------------------------------------------------------------- | ---- |
| 后台 spawn / 增量轮询 / kill / 列出 / `close` 完成判定 / timeout 解析 | 10   |
| disposer 契约（kill 全部返回 count / 空时返回 0）                     | 2    |

> 工具总数断言 16→17（`agent-core.test` / `parity-open-agents` / `sub-agent-isolation` 三处）。轮询测试 helper 必须**跨轮累加**输出，否则末轮为空（消费式 cursor 语义）。

## 安全考虑

- **同等门禁**：后台执行仍走完整 shell 策略 + ApprovalGate，硬 shell 黑名单（curl/rm 等）依然生效，后台不绕过任何审批。
- **生命周期兜底**：`killAllBackgroundShellTasks()` 接 REPL `rl.on('close')` + headless finally，agent 退出时清理残留后台进程，dev server 不会成为孤儿进程。
- **主动终止**：主机制是 agent 主动 `check_shell { kill: true }`（与 Claude Code 一致），disposer 仅作 backstop。
- **有界缓冲**：尾部缓冲上限防止恶意/失控的海量输出耗尽内存。

## 故障排查

| 现象                                  | 可能原因                              | 处理                                                                  |
| ------------------------------------- | ------------------------------------- | --------------------------------------------------------------------- |
| 轮询看到「已完成」但末段输出缺失      | 误用 `exit` 而非 `close` 判定（已修） | 当前实现用 `close`；自定义勿改回 `exit`                               |
| `check_shell` 末轮输出为空            | 消费式 cursor，调用方未累加           | 跨轮累加（agent 靠 message history 自动保留）                         |
| 后台 dev server 在 agent 退出后仍在跑 | 未主动 kill 且未触发 disposer         | disposer 已接 REPL/headless 退出；或主动 `check_shell{kill:true}`     |
| 前台长命令仍 60s 超时                 | 未传 `timeout`                        | 前台传 `run_shell{timeout}`（上限 10min），或改用 `run_in_background` |
| 后台任务输出被截断                    | 超过 1MB 尾部缓冲                     | 预期：保留尾部；需要全量请重定向到文件再读                            |

## 关键文件

| 文件                                                                  | 说明                                                                                                                                                   |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/cli/src/ai/agent-core.js`                                   | `_backgroundShellTasks` Map / `run_shell` 后台分支 / `check_shell` case / `_readBgStream` / `listBackgroundShellTasks` / `killAllBackgroundShellTasks` |
| `coding-agent-contract-shared.cjs`                                    | `run_shell` schema（+`run_in_background`/`timeout`）+ `check_shell` 工具 schema                                                                        |
| `coding-agent-policy.cjs`                                             | `check_shell` 只读 / plan-mode 允许                                                                                                                    |
| `packages/cli/src/repl/agent-repl.js` · `runtime/headless-runner.js`  | disposer 接线（退出清理）                                                                                                                              |
| `packages/cli/__tests__/unit/agent-core-run-shell-background.test.js` | 12 单元测试                                                                                                                                            |

## 使用示例

agent 在工具循环中使用（示意）：

```jsonc
// 1) 后台跑全量测试，立即拿到 task_id
run_shell { "command": "npm test", "run_in_background": true }
// → { "task_id": "bg_1" }

// 2) 继续做别的事，过一会儿轮询新输出
check_shell { "task_id": "bg_1" }
// → { "status": "running", "stdout": "...新增日志...", "exitCode": null }

// 3) 完成后拿退出码
check_shell { "task_id": "bg_1" }
// → { "status": "exited", "exitCode": 0, "stdout": "...末段..." }

// 4) 需要时终止
check_shell { "task_id": "bg_1", "kill": true }

// 5) 列出所有后台任务
check_shell {}

// 前台长命令：调高超时（上限 10min）
run_shell { "command": "npm run build", "timeout": 300000 }
```

## 相关文档

- [CLI Agent 智能代理](./cli-agent.md)
- [联网搜索 (web_search)](./web-search.md)
- [权限系统](./permissions.md)
- [钩子系统](./hooks.md)
- [计划模式](./plan-mode.md)
