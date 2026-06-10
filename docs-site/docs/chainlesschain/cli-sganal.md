# 社交图谱分析 V2 治理 CLI（cc sganal）

> **版本: CLI v0.143.0 引入 | 状态: ✅ 生产可用 | 内存态治理层 | 38 治理单元测试全绿（底层分析库另有 66 测试）**
>
> `cc sganal` 是 **Social Graph Analytics（SGAN）V2 治理**命令：在内存中治理「分析 profile」（`pending/active/stale/archived` 成熟度）与「分析 run」（`queued/running/completed/failed/cancelled` 生命周期），提供容量上限、状态机守卫与 idle/stale、stuck/fail 自动巡检。它治理的是*分析作业的登记与生命周期*，真正的图算法（中心性、社区发现等）在底层库 `social-graph-analytics.js` 中，由 `cc social` 等命令消费。

## 概述

当多个 owner 在社交图谱上跑分析作业（如中心性计算、社区发现）时，需要一层轻量治理来回答：谁注册了哪些分析配置（profile）？哪些 run 还在排队/运行？卡死的 run 何时自动失败？`cc sganal` 就是这层治理面：

- **Profile**：一个分析配置登记项，必有 `id` + `owner`，可选 `algorithm`（默认 `centrality`），按成熟度状态机流转。
- **Run**：挂在某 profile 下的一次分析执行登记，可选 `snapshot-id`（图快照标识），按生命周期状态机流转。

全部状态保存在进程内存（`Map`），**不落数据库**——适合作为编排器/测试环境中的治理原语；进程退出后状态清空。

## 核心特性

- 🗂️ **Profile 成熟度状态机**：`pending → active → stale → archived`（stale 可回 active；archived 为终态，非法转换抛错）
- 🔁 **Run 生命周期状态机**：`queued → running → completed/failed/cancelled`（queued 可直接 cancelled；三个终态不可再变）
- 🚦 **容量上限**：每 owner 活跃 profile 上限（默认 **6**）；每 profile pending run 上限（默认 **12**，pending = queued + running）
- 🕰️ **idle 自动转 stale**：`auto-stale-idle-v2` 把 `lastTouchedAt` 距今 ≥ 30 天（默认）的 active profile 翻成 stale
- ⏱️ **stuck 自动失败**：`auto-fail-stuck-v2` 把 running 超过 60 秒（默认）的 run 翻成 failed，并写 `metadata.failReason = "auto-fail-stuck"`
- 👆 **touch 保活**：`touch-profile-v2` 刷新 `lastTouchedAt`，避免被 idle 巡检翻 stale
- 📊 **治理统计**：`gov-stats-v2` 输出 profile/run 总数、按状态分布（全枚举键零初始化）与当前 4 项配置
- 📤 **全 JSON 输出**：所有子命令直接输出格式化 JSON

## 命令参考

```bash
cc sganal enums-v2                                  # 两套枚举（成熟度 + 生命周期）

# Profile 治理
cc sganal register-profile-v2 --id <id> --owner <owner> [--algorithm <alg>]   # 默认 centrality
cc sganal activate-profile-v2 <id>                  # pending/stale → active（检查 owner 上限）
cc sganal stale-profile-v2 <id>                     # active → stale
cc sganal archive-profile-v2 <id>                   # → archived（终态）
cc sganal touch-profile-v2 <id>                     # 刷新 lastTouchedAt
cc sganal get-profile-v2 <id> | list-profiles-v2

# Run 治理
cc sganal create-run-v2 --id <id> --profile-id <profileId> [--snapshot-id <sid>]
cc sganal running-run-v2 <id>                       # queued → running
cc sganal complete-run-v2 <id>                      # running → completed
cc sganal fail-run-v2 <id> [--reason <r>]           # running → failed
cc sganal cancel-run-v2 <id> [--reason <r>]         # queued/running → cancelled
cc sganal get-run-v2 <id> | list-runs-v2

# 配置与巡检
cc sganal config-v2                                 # 当前 4 项配置
cc sganal set-max-active-profiles-v2 <n>
cc sganal set-max-pending-runs-v2 <n>
cc sganal set-profile-idle-ms-v2 <ms>
cc sganal set-run-stuck-ms-v2 <ms>
cc sganal auto-stale-idle-v2                        # idle profile → stale
cc sganal auto-fail-stuck-v2                        # stuck run → failed
cc sganal gov-stats-v2                              # 治理统计
```

## 系统架构

```
┌──────────────────────────────────────────────────────────────┐
│ cc sganal <subcommand>   （commands/sganal.js，薄命令层）       │
└──────────────────────────────┬───────────────────────────────┘
                               │
            ┌──────────────────▼─────────────────────┐
            │ src/lib/social-graph-analytics.js      │
            │  （V2 治理 overlay 区段，纯内存）          │
            ├────────────────────────────────────────┤
            │ _sganPsV2: Map<id, profile>            │
            │ _sganJsV2: Map<id, run>                │
            │                                        │
            │ profile: pending ─→ active ─→ stale    │
            │             │         │  ▲      │      │
            │             ▼         ▼  └──────┘      │
            │          archived ◀──┴───(终态)        │
            │                                        │
            │ run: queued ─→ running ─→ completed    │
            │         │         ├────→ failed        │
            │         └────────→└────→ cancelled     │
            │                                        │
            │ 守卫: _sganCheckP/_sganCheckJ 转换表     │
            │ 限额: owner 活跃数 / profile pending 数  │
            │ 巡检: auto-stale-idle / auto-fail-stuck │
            ├────────────────────────────────────────┤
            │ 同文件基础分析层（degree/closeness/        │
            │ betweenness/eigenvector 中心性、影响力、  │
            │ 社区发现、最短路径）→ 由 `cc social` 消费  │
            └────────────────────────────────────────┘
```

## 配置参考

均为运行时 setter（进程内生效），无环境变量、无配置文件键：

| 配置项 | 默认值 | 设置命令 | gov-stats 字段 |
|--------|--------|---------|---------------|
| 每 owner 活跃 profile 上限 | `6` | `set-max-active-profiles-v2 <n>` | `maxActiveSganProfilesPerOwner` |
| 每 profile pending run 上限 | `12` | `set-max-pending-runs-v2 <n>` | `maxPendingSganRunsPerProfile` |
| profile idle 阈值 | `2592000000` ms（30 天） | `set-profile-idle-ms-v2 <ms>` | `sganProfileIdleMs` |
| run stuck 阈值 | `60000` ms（60 秒） | `set-run-stuck-ms-v2 <ms>` | `sganRunStuckMs` |

子命令参数：`register-profile-v2` 必填 `--id`/`--owner`，`--algorithm` 默认 `"centrality"`；`create-run-v2` 必填 `--id`/`--profile-id`，`--snapshot-id` 默认空字符串。所有 setter 校验「正整数」（`Math.floor` 后必须 > 0），非法值抛错。

## 性能指标

来自代码的运行限制（无独立基准，基准数据待补）：

- 全部操作为内存 `Map` 读写，单条 O(1)；限额计数与巡检为 O(条目数) 线性扫描
- idle 巡检判定 `now - lastTouchedAt >= 30 天`（默认）；stuck 巡检判定 `now - startedAt >= 60 秒`（默认），两者都支持注入 `now`（测试确定性）
- pending 统计同时计入 `queued` 与 `running` 两态
- `list-*` 返回深拷贝（含 metadata 浅拷贝），不会泄漏内部引用

## 测试覆盖

| 测试文件 | 数量 | 覆盖范围 |
|---------|------|---------|
| `packages/cli/__tests__/unit/lib/social-graph-analytics-v2.test.js` | **38** | `cc sganal` 对应的 V2 治理层（状态机、限额、巡检、统计） |
| `packages/cli/__tests__/unit/social-graph-analytics.test.js` | 66 | 同文件底层图分析算法（中心性/社区/最短路径等，服务 `cc social`，非本命令面） |

```bash
cd packages/cli
npx vitest run __tests__/unit/lib/social-graph-analytics-v2.test.js
```

## 安全考虑

- **状态机硬守卫**：所有转换查 `_sganPTrans` / `_sganJTrans` 转换表，非法转换抛 `invalid sgan profile/run transition <from> → <to>`；`archived` 与三个 run 终态不可逆
- **容量限流**：激活 profile 时检查 owner 活跃上限，创建 run 时检查 profile pending 上限，防止单 owner 占满治理面
- **重复注册防护**：相同 `id` 的 profile/run 二次注册抛 `already exists`
- **输入校验**：`id`/`owner`/`profile-id` 缺失抛错；阈值 setter 拒绝非正整数
- **无持久化面**：纯内存实现，不写磁盘/数据库，无注入面；代价是无跨进程审计痕迹（见故障排除）

## 故障排除

| 现象 | 可能原因 | 处理 |
|------|---------|------|
| `invalid sgan profile transition pending → stale` | 跳过了 active 阶段 | 先 `activate-profile-v2`，stale 只能从 active 进入 |
| 激活 profile 报上限错误 | 该 owner 已有 6 个 active profile | `set-max-active-profiles-v2` 调高，或 archive/stale 闲置 profile |
| `create-run-v2` 报 pending 上限 | 该 profile 下 queued + running 的 run 已达 12 | 等 run 完结，或 `set-max-pending-runs-v2` 调高 |
| `auto-fail-stuck-v2` 返回 `{"flipped":[],"count":0}` | 没有 run 处于 running 超过 60s | 预期行为；`set-run-stuck-ms-v2` 调小阈值可验证 |
| active profile 莫名变 stale | 超过 30 天未 touch，被 idle 巡检翻转 | 周期性 `touch-profile-v2` 保活，或调大 `set-profile-idle-ms-v2` |
| 重启后 profile/run 全部消失 | 治理层为纯内存实现 | 预期行为；需要持久治理时改用数据库后端的命令面（如 `cc infra` V1） |
| run 被自动失败后想知道原因 | 巡检写入 `metadata.failReason` | `get-run-v2 <id>` 查看 `metadata.failReason: "auto-fail-stuck"` |

## 关键文件

| 文件 | 说明 |
|------|------|
| `packages/cli/src/commands/sganal.js` | `cc sganal` 全部子命令注册（薄层，直调 lib） |
| `packages/cli/src/lib/social-graph-analytics.js` | SGAN V2 治理 overlay（约 712 行起）+ 底层图分析算法 |
| `packages/cli/__tests__/unit/lib/social-graph-analytics-v2.test.js` | 38 治理单元测试 |
| `packages/cli/__tests__/unit/social-graph-analytics.test.js` | 66 底层分析算法测试（`cc social` 命令面） |

## 使用示例

```bash
# 1) 注册并激活一个分析 profile
cc sganal register-profile-v2 --id p1 --owner alice --algorithm centrality
cc sganal activate-profile-v2 p1

# 2) 提交一次分析 run 并走完生命周期
cc sganal create-run-v2 --id r1 --profile-id p1 --snapshot-id snap-2026-06
cc sganal running-run-v2 r1
cc sganal complete-run-v2 r1

# 3) 失败/取消路径
cc sganal create-run-v2 --id r2 --profile-id p1
cc sganal cancel-run-v2 r2 --reason "不需要了"

# 4) 巡检：把卡死的 run 自动失败、把闲置 profile 转 stale
cc sganal set-run-stuck-ms-v2 30000      # 阈值调到 30s
cc sganal auto-fail-stuck-v2
cc sganal auto-stale-idle-v2

# 5) 看全景
cc sganal config-v2
cc sganal gov-stats-v2
```

## 相关文档

- [社交 CLI（cc social，底层图分析算法消费方）](./cli-social.md)
- [V2 治理体系总览](./cli-v2-governance.md)
- [功能总览](./overview.md)
- [压缩遥测治理 CLI（cc compt，同构治理模式）](./cli-compt.md)
