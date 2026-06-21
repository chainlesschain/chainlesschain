# 压缩遥测 V2 治理 CLI（cc compt）

> **版本: CLI v0.143.0 引入 | 状态: ✅ 生产可用 | 内存态治理层 | 38 单元测试全绿**
>
> `cc compt` 是 **Compression Telemetry（COMPT）V2 治理**命令：在内存中治理「遥测 profile」（`pending/active/stale/archived` 成熟度）与「采样 sample」（`queued/recording/recorded/failed/cancelled` 生命周期），提供容量上限、状态机守卫与 idle/stuck 自动巡检。**注意：它与 `cc compact`（会话上下文压缩）完全不同**——`cc compt` 不压缩任何东西，它治理的是压缩遥测采样作业的登记与生命周期。

## 概述

CLI 的 agent 会话压缩链路（见 `src/harness/compression-telemetry.js` 的 `recordCompressionMetric` / `getCompressionTelemetrySummary`）会产生压缩效果指标。当多个 owner 需要有组织地登记「采集哪类压缩指标、哪次采样在录制中、卡死的采样何时自动失败」时，`cc compt` 提供这层治理面：

- **Profile**：一个遥测配置登记项，必有 `id` + `owner`，可选 `kind`（默认 `default`），按成熟度状态机流转。
- **Sample**：挂在某 profile 下的一次采样登记，可选 `metric`（指标名，默认空），按生命周期状态机流转：`queued → recording → recorded`（成功终态），或 `failed` / `cancelled`。

全部状态保存在进程内存（`Map`），**不落数据库**；进程退出后状态清空。

## 核心特性

- 🗂️ **Profile 成熟度状态机**：`pending → active → stale → archived`（stale 可回 active；archived 为终态，非法转换抛错）
- 🎙️ **Sample 生命周期状态机**：`queued → recording → recorded/failed/cancelled`（queued 可直接 cancelled；`recorded`/`failed`/`cancelled` 为终态）
- 🚦 **容量上限**：每 owner 活跃 profile 上限（默认 **10**）；每 profile pending sample 上限（默认 **30**，pending = queued + recording）
- 🕰️ **idle 自动转 stale**：`auto-stale-idle-v2` 把 `lastTouchedAt` 距今 ≥ 30 天（默认）的 active profile 翻成 stale
- ⏱️ **stuck 自动失败**：`auto-fail-stuck-v2` 把 recording 超过 **30 秒**（默认）的 sample 翻成 failed，并写 `metadata.failReason = "auto-fail-stuck"`
- 👆 **touch 保活**：`touch-profile-v2` 刷新 `lastTouchedAt`
- 📊 **治理统计**：`gov-stats-v2` 输出 profile/sample 总数、按状态分布（全枚举键零初始化）与当前 4 项配置
- 📤 **全 JSON 输出**：所有子命令直接输出格式化 JSON

## 命令参考

```bash
cc compt enums-v2                                   # 两套枚举（成熟度 + 生命周期）

# Profile 治理
cc compt register-profile-v2 --id <id> --owner <owner> [--kind <kind>]   # kind 默认 "default"
cc compt activate-profile-v2 <id>                   # pending/stale → active（检查 owner 上限）
cc compt stale-profile-v2 <id>                      # active → stale
cc compt archive-profile-v2 <id>                    # → archived（终态）
cc compt touch-profile-v2 <id>                      # 刷新 lastTouchedAt
cc compt get-profile-v2 <id> | list-profiles-v2

# Sample 治理
cc compt create-sample-v2 --id <id> --profile-id <profileId> [--metric <name>]
cc compt recording-sample-v2 <id>                   # queued → recording
cc compt record-sample-v2 <id>                      # recording → recorded（成功终态）
cc compt fail-sample-v2 <id> [--reason <r>]         # recording → failed
cc compt cancel-sample-v2 <id> [--reason <r>]       # queued/recording → cancelled
cc compt get-sample-v2 <id> | list-samples-v2

# 配置与巡检
cc compt config-v2                                  # 当前 4 项配置
cc compt set-max-active-profiles-v2 <n>
cc compt set-max-pending-samples-v2 <n>
cc compt set-profile-idle-ms-v2 <ms>
cc compt set-sample-stuck-ms-v2 <ms>
cc compt auto-stale-idle-v2                         # idle profile → stale
cc compt auto-fail-stuck-v2                         # stuck sample → failed
cc compt gov-stats-v2                               # 治理统计
```

## 系统架构

```
┌──────────────────────────────────────────────────────────────┐
│ cc compt <subcommand>   （commands/compt.js，薄命令层）         │
└──────────────────────────────┬───────────────────────────────┘
                               │
            ┌──────────────────▼─────────────────────┐
            │ src/lib/compression-telemetry.js       │
            │  （V2 治理 overlay，纯内存）              │
            ├────────────────────────────────────────┤
            │ _comptPsV2: Map<id, profile>           │
            │ _comptJsV2: Map<id, sample>            │
            │                                        │
            │ profile: pending ─→ active ─→ stale    │
            │              │        │  ▲      │      │
            │              ▼        ▼  └──────┘      │
            │           archived ◀─┴───(终态)        │
            │                                        │
            │ sample: queued ─→ recording ─→ recorded│
            │            │          ├─────→ failed   │
            │            └─────────→└─────→ cancelled│
            │                                        │
            │ 守卫: _comptCheckP/_comptCheckJ 转换表   │
            │ 限额: owner 活跃数 / profile pending 数  │
            │ 巡检: auto-stale-idle / auto-fail-stuck │
            ├────────────────────────────────────────┤
            │ re-export: ../harness/                 │
            │   compression-telemetry.js             │
            │   (recordCompressionMetric /           │
            │    getCompressionTelemetrySummary /    │
            │    resetCompressionTelemetry)          │
            │   ← agent 压缩链路内部用，不经 cc compt   │
            └────────────────────────────────────────┘
```

## 配置参考

均为运行时 setter（进程内生效），无环境变量、无配置文件键：

| 配置项                         | 默认值                   | 设置命令                         | gov-stats 字段                     |
| ------------------------------ | ------------------------ | -------------------------------- | ---------------------------------- |
| 每 owner 活跃 profile 上限     | `10`                     | `set-max-active-profiles-v2 <n>` | `maxActiveComptProfilesPerOwner`   |
| 每 profile pending sample 上限 | `30`                     | `set-max-pending-samples-v2 <n>` | `maxPendingComptSamplesPerProfile` |
| profile idle 阈值              | `2592000000` ms（30 天） | `set-profile-idle-ms-v2 <ms>`    | `comptProfileIdleMs`               |
| sample stuck 阈值              | `30000` ms（30 秒）      | `set-sample-stuck-ms-v2 <ms>`    | `comptSampleStuckMs`               |

子命令参数：`register-profile-v2` 必填 `--id`/`--owner`，`--kind` 默认 `"default"`；`create-sample-v2` 必填 `--id`/`--profile-id`，`--metric` 默认空字符串。所有 setter 校验「正整数」（`Math.floor` 后必须 > 0），非法值抛错。

## 性能指标

来自代码的运行限制（无独立基准，基准数据待补）：

- 全部操作为内存 `Map` 读写，单条 O(1)；限额计数与巡检为 O(条目数) 线性扫描
- idle 巡检判定 `now - lastTouchedAt >= 30 天`（默认）；stuck 巡检判定 `now - startedAt >= 30 秒`（默认，比 sganal 的 60 秒更激进，匹配采样的短时特征），两者都支持注入 `now`（测试确定性）
- pending 统计同时计入 `queued` 与 `recording` 两态
- `list-*` 返回深拷贝（含 metadata 浅拷贝），不会泄漏内部引用

## 测试覆盖

| 测试文件                                                           | 数量   | 覆盖范围                                                |
| ------------------------------------------------------------------ | ------ | ------------------------------------------------------- |
| `packages/cli/__tests__/unit/lib/compression-telemetry-v2.test.js` | **38** | `cc compt` 对应的 V2 治理层（状态机、限额、巡检、统计） |

```bash
cd packages/cli
npx vitest run __tests__/unit/lib/compression-telemetry-v2.test.js
```

## 安全考虑

- **状态机硬守卫**：所有转换查 `_comptPTrans` / `_comptJTrans` 转换表，非法转换抛 `invalid compt profile/sample transition <from> → <to>`；`archived` 与三个 sample 终态不可逆
- **容量限流**：激活 profile 时检查 owner 活跃上限（默认 10），创建 sample 时检查 profile pending 上限（默认 30）
- **重复注册防护**：相同 `id` 的 profile/sample 二次注册抛 `already exists`
- **输入校验**：`id`/`owner`/`profile-id` 缺失抛错；阈值 setter 拒绝非正整数
- **无持久化面**：纯内存实现，不写磁盘/数据库；治理面只登记元数据（id/owner/kind/metric），不接触被压缩的会话内容本身

## 故障排除

| 现象                                                 | 可能原因                                           | 处理                                                                                                     |
| ---------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 想压缩会话却用了 `cc compt`                          | 与 `cc compact` 混淆                               | 会话上下文压缩用 `cc compact <session-id>`；`cc compt` 只做遥测采样治理                                  |
| `invalid compt sample transition queued → recorded`  | 跳过了 recording 阶段                              | 先 `recording-sample-v2` 再 `record-sample-v2`                                                           |
| 激活 profile 报上限错误                              | 该 owner 已有 10 个 active profile                 | `set-max-active-profiles-v2` 调高，或 archive/stale 闲置 profile                                         |
| `create-sample-v2` 报 pending 上限                   | 该 profile 下 queued + recording 的 sample 已达 30 | 让采样走完终态，或 `set-max-pending-samples-v2` 调高                                                     |
| sample 莫名变 failed                                 | recording 超 30s 被 `auto-fail-stuck-v2` 翻转      | `get-sample-v2 <id>` 看 `metadata.failReason: "auto-fail-stuck"`；长采样先 `set-sample-stuck-ms-v2` 调大 |
| 重启后 profile/sample 全部消失                       | 治理层为纯内存实现                                 | 预期行为；跨进程持久不在本命令面范围内                                                                   |
| `auto-stale-idle-v2` 返回 `{"flipped":[],"count":0}` | 没有 active profile 闲置超 30 天                   | 预期行为；`set-profile-idle-ms-v2` 调小阈值可验证                                                        |

## 关键文件

| 文件                                                               | 说明                                                             |
| ------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `packages/cli/src/commands/compt.js`                               | `cc compt` 全部子命令注册（薄层，直调 lib）                      |
| `packages/cli/src/lib/compression-telemetry.js`                    | COMPT V2 治理 overlay + re-export harness 遥测原语               |
| `packages/cli/src/harness/compression-telemetry.js`                | 底层压缩指标采集（`recordCompressionMetric` 等，agent 内部链路） |
| `packages/cli/__tests__/unit/lib/compression-telemetry-v2.test.js` | 38 治理单元测试                                                  |

## 使用示例

```bash
# 1) 注册并激活一个遥测 profile
cc compt register-profile-v2 --id tp1 --owner alice --kind session-compaction
cc compt activate-profile-v2 tp1

# 2) 一次采样走完成功路径
cc compt create-sample-v2 --id s1 --profile-id tp1 --metric tokens-saved
cc compt recording-sample-v2 s1
cc compt record-sample-v2 s1          # → recorded

# 3) 失败/取消路径
cc compt create-sample-v2 --id s2 --profile-id tp1
cc compt cancel-sample-v2 s2 --reason "采样窗口已过"

# 4) 巡检：把卡在 recording 的采样自动失败
cc compt auto-fail-stuck-v2           # recording 超 30s → failed
cc compt auto-stale-idle-v2           # 闲置 30 天的 profile → stale

# 5) 看全景
cc compt config-v2
cc compt gov-stats-v2
```

## 相关文档

- [V2 治理体系总览](./cli-v2-governance.md)
- [功能总览](./overview.md)
- [社交图谱分析治理 CLI（cc sganal，同构治理模式）](./cli-sganal.md)
- [CLI Agent 智能代理（压缩遥测的产生方）](./cli-agent.md)
