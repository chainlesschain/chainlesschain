# 去中心化推理网络 CLI（cc inference）

> **版本: Phase 67 | 状态: ✅ 生产可用 | V1 调度 + V2 状态机 + 双层治理 overlay | 172 单元测试全绿**
>
> `cc inference` 是 Phase 67「去中心化推理网络」的命令行界面：管理推理节点注册/心跳/状态，提交与调度推理任务（支持 standard/encrypted/federated 三种隐私模式），并叠加两层 V2 治理 overlay（节点成熟度 + 任务生命周期、infnetgov profile/request 治理）。

## 概述

去中心化推理网络把推理任务分发到多个注册节点上执行。`cc inference` 提供四层能力：

1. **V1 节点注册表 + 任务调度器**（SQLite 持久化）：节点注册/心跳/状态，任务提交时自动指派给 task_count 最小的在线节点。
2. **V2 调度面（Phase 67）**：显式状态机 `queued → dispatched → running → complete/failed`，每节点并发上限、心跳超时自动下线、合格节点筛选。
3. **节点/作业治理 V2**（内存态）：节点成熟度 `pending/active/degraded/decommissioned` + 作业生命周期 `queued/running/completed/failed/cancelled`，带每 operator 活跃上限与 idle/stuck 自动巡检。
4. **Infnetgov 治理 overlay（Iter28）**：profile 成熟度 `pending/active/stale/archived` + request 生命周期 `queued/inferring/inferred/failed/cancelled`。

源码位于 `packages/cli/src/commands/inference.js` + `packages/cli/src/lib/inference-network.js`。

## 核心特性

- 🖥️ **节点注册表**：注册（endpoint / capabilities / GPU 显存）、注销、心跳（offline 节点心跳后自动回 online）、状态更新（`online/offline/busy/degraded`）
- 📋 **任务调度**：V1 `submit` 自动指派最低负载在线节点（无可用节点则 `queued`）；V2 `submit-v2` 只入队，`dispatch-v2` 显式派发（指定节点或最低负载）
- 🔒 **三种隐私模式**：`standard` / `encrypted` / `federated`（非法模式直接拒绝）
- 🚦 **状态机守卫**：V2 任务转换表 `queued→dispatched→running→complete/failed`，`set-task-status` 走通用守卫，非法转换抛错
- 🧮 **并发上限**：每节点并发任务上限（默认 4），派发时超限节点被跳过
- 💓 **心跳超时自动下线**：`auto-offline` 把心跳超过阈值（默认 90000ms）的节点标记 offline
- 🏛️ **双层治理 overlay**：节点/作业治理（operator 活跃上限、idle 自动降级、stuck 作业自动失败）+ infnetgov profile/request 治理
- 📤 **JSON 输出**：绝大多数子命令支持 `--json`

## 命令参考

### 目录（枚举）

```bash
cc inference node-statuses [--json]       # online / offline / busy / degraded
cc inference task-statuses [--json]       # queued / dispatched / running / complete / failed
cc inference privacy-modes [--json]       # standard / encrypted / federated
cc inference node-statuses-v2 / task-statuses-v2 / privacy-modes-v2   # V2 同 V1 枚举
cc inference enums-v2                     # 节点成熟度 + 作业生命周期枚举
cc inference infnetgov-enums-v2           # infnetgov profile/request 枚举
```

### V1 节点与任务

```bash
cc inference register <node-id> [-e <url>] [-c <cap1,cap2>] [-g <mb>] [--json]
cc inference unregister <id> | heartbeat <id> | node-status <id> <status>
cc inference show-node <id> | nodes [-s <status>] [-c <cap>] [--limit <n>]
cc inference submit <model> [-i <input>] [-p <1-10>] [-m <mode>]   # 自动指派
cc inference complete <task-id> [-o <output>] [-d <ms>]
cc inference fail-task <task-id> [-e <error>]
cc inference show-task <task-id> | tasks [-s] [-m] [-p] [--limit]
cc inference stats                        # 节点/任务汇总 + 平均时延
```

### V2 调度面

```bash
cc inference submit-v2 <model> [-i] [-p] [-m]      # 只入队，不指派
cc inference dispatch-v2 <task-id> [-n <node-id>]  # 指定节点或最低负载
cc inference start-task <task-id>                  # dispatched → running
cc inference complete-v2 <task-id> [-o] [-d]       # running → complete
cc inference fail-v2 <task-id> [-e]                # 非终态 → failed
cc inference set-task-status <task-id> <status> [-o] [-d] [-e]   # 通用状态机守卫
cc inference auto-offline                          # 心跳过期节点 → offline
cc inference eligible-nodes [-c <cap>] [-m <mode>] # 在线 + 未超并发上限
cc inference stats-v2                              # 全枚举键零初始化统计
cc inference max-concurrent-tasks / set-max-concurrent-tasks <n> / default-max-concurrent-tasks
cc inference heartbeat-timeout / set-heartbeat-timeout <ms>
cc inference active-task-count <node-id>
```

### 节点/作业治理 V2（内存态）

```bash
cc inference config-set-v2 [--max-active <n>] [--max-pending <n>] [--idle-ms <n>] [--stuck-ms <n>]
cc inference register-node-v2 <id> --operator <op> [--model <m>]
cc inference activate-node-v2 | degrade-node-v2 | decommission-node-v2 | touch-node-v2 <id>
cc inference get-node-v2 <id> | list-nodes-v2
cc inference create-job-v2 <id> --node-id <nid> [--prompt <p>]
cc inference start-job-v2 | complete-job-v2 | fail-job-v2 [--reason] | cancel-job-v2 [--reason] <id>
cc inference get-job-v2 <id> | list-jobs-v2
cc inference auto-degrade-nodes-v2 | auto-fail-jobs-v2 | gov-stats-v2 [--json]
```

### Infnetgov 治理 overlay（Iter28）

```bash
cc inference infnetgov-config-v2
cc inference infnetgov-set-max-active-v2 <n> | infnetgov-set-max-pending-v2 <n>
cc inference infnetgov-set-idle-ms-v2 <n> | infnetgov-set-stuck-ms-v2 <n>
cc inference infnetgov-register-v2 <id> <owner> [--node <v>]
cc inference infnetgov-activate-v2 | infnetgov-stale-v2 | infnetgov-archive-v2 | infnetgov-touch-v2 <id>
cc inference infnetgov-get-v2 <id> | infnetgov-list-v2
cc inference infnetgov-create-request-v2 <id> <profileId> [--requestId <v>]
cc inference infnetgov-inferring-request-v2 | infnetgov-complete-request-v2 <id>
cc inference infnetgov-fail-request-v2 | infnetgov-cancel-request-v2 <id> [reason]
cc inference infnetgov-get-request-v2 <id> | infnetgov-list-requests-v2
cc inference infnetgov-auto-stale-idle-v2 | infnetgov-auto-fail-stuck-v2 | infnetgov-gov-stats-v2
```

## 系统架构

```
┌────────────────────────────────────────────────────────────────────┐
│ cc inference <subcommand>                                          │
│   preAction hook: 若命令树挂载 _db → ensureInferenceTables(db)       │
└──────────────────────────────┬─────────────────────────────────────┘
                               │
                ┌──────────────▼───────────────┐
                │ src/lib/inference-network.js │
                ├──────────────────────────────┤
   V1/V2 调度    │ _nodes / _tasks (内存 Map)    │←──→ SQLite 镜像写入
                │ submit: 最低 task_count 在线   │     inference_nodes
                │ dispatch-v2: 在线+未超并发上限  │     inference_tasks
                │ auto-offline: 心跳 > 90s      │     (idx_infn_status /
                │ 状态机: queued→dispatched→    │      idx_inft_status)
                │        running→complete/fail │
                ├──────────────────────────────┤
   治理 V2      │ _innV2/_ijsV2 (纯内存 Map)    │  节点成熟度 + 作业生命周期
   infnetgov   │ _infnetgovPsV2/_infnetgovJsV2 │  profile + request 治理
                │ （不落 SQLite，进程结束即失）   │
                └──────────────────────────────┘
```

数据流要点：V1/V2 调度面把状态同时保存在内存 Map 与 SQLite 表中（启动时 `_loadAll` 从表回灌内存）；两层治理 overlay 是**纯内存**实现，不依赖数据库。

## 配置参考

均为运行时 setter（进程内生效），无环境变量：

| 配置项                                | 默认值                         | 设置命令                       | 来源常量                                          |
| ------------------------------------- | ------------------------------ | ------------------------------ | ------------------------------------------------- |
| 每节点最大并发任务                    | `4`                            | `set-max-concurrent-tasks <n>` | `INFERENCE_DEFAULT_MAX_CONCURRENT_TASKS_PER_NODE` |
| 心跳超时                              | `90000` ms                     | `set-heartbeat-timeout <ms>`   | `INFERENCE_DEFAULT_HEARTBEAT_TIMEOUT_MS`          |
| 最大节点数                            | `100`                          | 不可配置                       | `DEFAULT_CONFIG.maxNodes`                         |
| 默认隐私模式                          | `standard`                     | 按任务 `-m` 覆盖               | `DEFAULT_CONFIG.defaultPrivacyMode`               |
| 优先级范围                            | `1-10`（默认 5，越界自动钳制） | 按任务 `-p`                    | `DEFAULT_CONFIG.maxPriority`                      |
| 治理: 每 operator 活跃节点上限        | `12`                           | `config-set-v2 --max-active`   | `_inMaxActivePerOperator`                         |
| 治理: 每节点 pending 作业上限         | `25`                           | `config-set-v2 --max-pending`  | `_inMaxPendingJobsPerNode`                        |
| 治理: 节点 idle 阈值                  | `86400000` ms（24h）           | `config-set-v2 --idle-ms`      | `_inIdleMs`                                       |
| 治理: 作业 stuck 阈值                 | `600000` ms（10min）           | `config-set-v2 --stuck-ms`     | `_ijStuckMs`                                      |
| infnetgov: 每 owner 活跃 profile 上限 | `8`                            | `infnetgov-set-max-active-v2`  | `_infnetgovMaxActive`                             |
| infnetgov: 每 profile pending 上限    | `25`                           | `infnetgov-set-max-pending-v2` | `_infnetgovMaxPending`                            |
| infnetgov: idle 阈值                  | `2592000000` ms（30 天）       | `infnetgov-set-idle-ms-v2`     | `_infnetgovIdleMs`                                |
| infnetgov: stuck 阈值                 | `60000` ms                     | `infnetgov-set-stuck-ms-v2`    | `_infnetgovStuckMs`                               |

所有 setter 校验「正整数」，非法值抛错（CLI 以 `exitCode=1` 退出）。

## 性能指标

来自代码的运行限制（基准数据待补）：

- 节点注册上限 **100**（超出返回 `max_nodes_reached`）
- `nodes` / `tasks` 列表默认 **limit 50**，按 `last_heartbeat` / `created_at` 倒序
- 派发选择为 O(节点数 × 任务数) 的内存扫描（`_pickLeastLoadedOnline` + `getActiveTasksPerNode`）
- `stats` 的 `avgDurationMs` 为已完成任务 `duration_ms` 均值；`complete` 未传 `-d` 时自动用 `completed_at - started_at`（V2）或 `- created_at` 兜底

## 测试覆盖

共 **172** 个测试，全部为真实断言（无 stub）：

| 测试文件                                                              | 数量 | 覆盖范围                                                         |
| --------------------------------------------------------------------- | ---- | ---------------------------------------------------------------- |
| `packages/cli/__tests__/unit/inference-network.test.js`               | 83   | 建表、V1 节点/任务/统计、V2 调度面（并发上限、心跳超时、状态机） |
| `packages/cli/__tests__/unit/lib/inference-network-v2.test.js`        | 45   | 节点成熟度 + 作业生命周期治理                                    |
| `packages/cli/__tests__/unit/lib/inference-network-v2-iter28.test.js` | 44   | infnetgov profile/request 治理 overlay                           |

```bash
cd packages/cli
npx vitest run __tests__/unit/inference-network.test.js __tests__/unit/lib/inference-network-v2.test.js __tests__/unit/lib/inference-network-v2-iter28.test.js
```

## 安全考虑

- **隐私模式白名单**：`submitTask`/`submitTaskV2` 校验 `VALID_PRIVACY_MODES`，非法模式拒绝（`invalid_privacy_mode` / 抛错）
- **状态机硬守卫**：V2 所有转换查 `TASK_TRANSITIONS_V2` 转换表，终态（`complete`/`failed`）不可再变；治理层同理（`decommissioned`/`archived` 为终态）
- **重复注册防护**：同 `node_id` 二次注册返回 `duplicate_node`；治理 profile 重复 id 抛 `already exists`
- **容量限流**：每 operator 活跃节点上限、每节点/profile pending 上限在 create/activate 时强制执行，防资源耗尽
- **输入钳制**：优先级钳制到 1-10；所有阈值 setter 拒绝非正整数

## 故障排除

| 现象                                                  | 可能原因                                  | 处理                                                                                 |
| ----------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------ |
| `Failed: max_nodes_reached`                           | 已注册节点达 100 上限                     | `cc inference unregister <id>` 清理无用节点                                          |
| `Failed: duplicate_node`                              | 同 `node_id` 已注册                       | `cc inference nodes` 查重；换 node-id 或先注销                                       |
| `submit` 后状态是 `queued` 而非 `dispatched`          | 当前没有 `online` 节点                    | 注册节点或 `heartbeat <id>` 把 offline 节点拉回 online                               |
| `dispatch-v2` 报 `No eligible online nodes available` | 在线节点全部达到并发上限（默认 4）        | `set-max-concurrent-tasks` 调高，或等任务完成                                        |
| `Invalid transition: ... → ...`                       | 违反 V2 状态机顺序                        | 按 `queued→dispatched→running→complete/failed` 顺序操作；用 `show-task` 确认当前状态 |
| `auto-offline` 总返回 `No stale nodes.`               | 心跳都在 90s 阈值内                       | 预期行为；可 `set-heartbeat-timeout` 调小阈值验证                                    |
| 治理 V2 数据重启后丢失                                | 治理 overlay 是纯内存实现                 | 预期行为：节点/作业治理与 infnetgov 不落库                                           |
| V1 子命令报数据库相关错误                             | 命令树未挂载 `_db`（`_dbFromCtx` 取不到） | 治理类（`*-v2`、`infnetgov-*`）子命令不依赖 DB，可正常使用                           |

## 关键文件

| 文件                                                                  | 说明                                                                |
| --------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `packages/cli/src/commands/inference.js`                              | `cc inference` 全部子命令注册（V1 + V2 + 治理 + infnetgov overlay） |
| `packages/cli/src/lib/inference-network.js`                           | 调度引擎与治理实现（schema、状态机、并发/心跳、双层治理）           |
| `packages/cli/__tests__/unit/inference-network.test.js`               | 83 单元测试（V1 + V2 调度面）                                       |
| `packages/cli/__tests__/unit/lib/inference-network-v2.test.js`        | 45 单元测试（节点/作业治理）                                        |
| `packages/cli/__tests__/unit/lib/inference-network-v2-iter28.test.js` | 44 单元测试（infnetgov overlay）                                    |

## 使用示例

```bash
# 1) 注册两个推理节点
cc inference register gpu-node-1 -e http://10.0.0.1:8080 -c llama,qwen -g 24576
cc inference register gpu-node-2 -c llama -g 8192

# 2) V1 一步提交（自动指派最低负载在线节点）
cc inference submit llama3-8b -i "总结这段文本" -p 8 -m encrypted
cc inference stats

# 3) V2 显式调度链
cc inference submit-v2 qwen2-7b -i "翻译" --json     # queued
cc inference dispatch-v2 <task-id>                   # → dispatched（最低负载）
cc inference start-task <task-id>                    # → running
cc inference complete-v2 <task-id> -o "结果" -d 1234  # → complete

# 4) 心跳运维
cc inference heartbeat <node-id>
cc inference auto-offline          # 心跳 > 90s 的节点标 offline
cc inference eligible-nodes -c llama

# 5) 治理 overlay
cc inference register-node-v2 n1 --operator op-a --model llama3
cc inference activate-node-v2 n1
cc inference create-job-v2 j1 --node-id n1 --prompt "hello"
cc inference start-job-v2 j1
cc inference auto-fail-jobs-v2     # running 超 10min 的作业自动 failed
cc inference gov-stats-v2 --json
```

## 相关文档

- [推理网络（系统设计）](./inference-network.md)
- [V2 治理体系总览](./cli-v2-governance.md)
- [功能总览](./overview.md)
- [基础设施 CLI（cc infra）](./cli-infra.md)
- [代币激励](./token-incentive.md)
