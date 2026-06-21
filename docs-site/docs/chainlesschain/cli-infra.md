# 去中心化基础设施 CLI（cc infra）

> **版本: Phase 74-75 | 状态: ✅ 生产可用 | Filecoin 存储交易 + 内容版本 + 抗审查路由 + V2 provider/deal 治理 | 109 单元测试全绿**
>
> `cc infra` 是 Phase 74-75「去中心化基础设施」的命令行界面：管理 Filecoin 存储交易（deal）、IPFS 内容版本链（content version）、抗审查路由（tor / domain_front / mesh_ble / mesh_wifi / direct），并叠加 V2 provider 成熟度 + deal 生命周期治理与 digov 治理 overlay。

## 概述

`cc infra` 把三类去中心化基础设施资源收进一个命令面：

1. **Filecoin 存储交易（Phase 74）**：创建/续期/状态流转存储交易，按 CID + 矿工 + FIL 价格 + epoch 时长记账。
2. **内容版本链**：以 `content_cid` 为键的版本序列（带 parent CID / DAG 结构 / peer 数 / 缓存标记）。
3. **抗审查路由（Phase 75）**：注册多类型路由并产出连通性报告（平均时延、平均可靠性、按类型分布）。
4. **V2 治理**：provider 成熟度（`onboarding/active/degraded/offline/retired`）+ deal 生命周期（`queued/active/completed/failed/canceled`），带每 operator/provider 容量上限与 idle/stuck 自动巡检；另有 digov profile/deal 治理 overlay（Iter23）。

源码位于 `packages/cli/src/commands/infra.js` + `packages/cli/src/lib/decentral-infra.js`。

## 核心特性

- 📦 **存储交易管理**：`deal-create`（必填 `--cid` + `--size`）、状态更新（`pending/active/expired/failed`）、续期计数、列表过滤
- 🌳 **内容版本链**：同一 CID 自动递增 version，支持 parent CID / DAG 结构 / peer 数，可标记本地缓存
- 🛡️ **抗审查路由**：5 种类型 `tor / domain_front / mesh_ble / mesh_wifi / direct`，3 种状态 `active / inactive / degraded`，时延 + 可靠性记录
- 📊 **连通性报告**：`connectivity` 输出总数/活跃数/平均时延/平均可靠性/按类型计数
- 🏛️ **V2 provider/deal 治理**：状态机守卫（`retired` / `completed/failed/canceled` 为终态）、心跳触摸、每 operator 活跃 provider 上限（默认 20）、每 provider 活跃 deal 上限（默认 10）
- 🤖 **自动巡检**：`auto-offline-stale-providers`（idle 超 7 天）、`auto-fail-stuck-active-deals`（active 超 24h）
- 🧾 **metadata JSON 校验**：`--metadata` 必须是合法 JSON，否则报 `--metadata must be valid JSON`
- 📤 **JSON 输出**：V1 子命令支持 `--json`；V2 子命令默认直接输出 JSON

## 命令参考

### 目录（枚举）

```bash
cc infra deal-statuses [--json]            # pending / active / expired / failed
cc infra route-types [--json]              # tor / domain_front / mesh_ble / mesh_wifi / direct
cc infra provider-maturities-v2 [--json]   # onboarding / active / degraded / offline / retired
cc infra deal-lifecycles-v2 [--json]       # queued / active / completed / failed / canceled
cc infra digov-enums-v2                    # digov profile/deal 枚举
```

### Filecoin 存储交易（Phase 74）

```bash
cc infra deal-create -c <cid> -s <bytes> [-m <miner>] [-p <fil>] [-d <epochs>] [--json]
cc infra deal-status <id> <status>         # 更新状态
cc infra deal-renew <id>                   # 续期（renewal_count + 1）
cc infra deal-show <id>
cc infra deals [-s <status>] [--limit <n>]
```

### 内容版本

```bash
cc infra version-add -c <cid> [-p <parent-cid>] [-d <dag-json>] [-n <peers>] [--json]
cc infra version-show <id>
cc infra versions [-c <cid>] [--limit <n>]
cc infra version-cache <id>                # 标记已缓存
```

### 抗审查路由（Phase 75）

```bash
cc infra route-add -t <type> [-e <url>] [-l <ms>] [-r <0-1>] [--json]
cc infra route-status <id> <status>
cc infra route-remove <id>
cc infra route-show <id>
cc infra routes [-t <type>] [-s <status>] [--limit <n>]
cc infra connectivity                      # 连通性报告
cc infra stats                             # 存储 + 内容 + 路由三段汇总
```

### V2 provider/deal 治理

```bash
cc infra register-provider-v2 <provider-id> -o <operator> -k <kind> [-i <initial-status>] [--metadata <json>]
cc infra provider-v2 <provider-id>
cc infra set-provider-maturity-v2 <provider-id> <status> [-r <reason>] [--metadata <json>]
cc infra activate-provider | degrade-provider | offline-provider | retire-provider <provider-id> [-r]
cc infra touch-provider-heartbeat <provider-id>
cc infra enqueue-deal-v2 <deal-id> -p <provider> -o <owner> [--metadata <json>]
cc infra deal-v2 <deal-id>
cc infra set-deal-status-v2 <deal-id> <status> [-r] [--metadata <json>]
cc infra activate-deal | complete-deal | fail-deal | cancel-deal <deal-id> [-r]
cc infra active-provider-count [-o <operator>] | active-deal-count [-p <provider>]
cc infra auto-offline-stale-providers | auto-fail-stuck-active-deals
cc infra stats-v2
# 配置读写（default-* 读默认值；不带 set- 前缀读当前值）
cc infra [default-]max-active-providers-per-operator | set-max-active-providers-per-operator <n>
cc infra [default-]max-active-deals-per-provider | set-max-active-deals-per-provider <n>
cc infra [default-]provider-idle-ms | set-provider-idle-ms <ms>
cc infra [default-]deal-stuck-ms | set-deal-stuck-ms <ms>
```

### Digov 治理 overlay（Iter23）

```bash
cc infra digov-config-v2
cc infra digov-set-max-active-v2 <n> | digov-set-max-pending-v2 <n>
cc infra digov-set-idle-ms-v2 <n> | digov-set-stuck-ms-v2 <n>
cc infra digov-register-v2 <id> <owner> [--region <v>]
cc infra digov-activate-v2 | digov-stale-v2 | digov-archive-v2 | digov-touch-v2 <id>
cc infra digov-get-v2 <id> | digov-list-v2
cc infra digov-create-deal-v2 <id> <profileId> [--provider <v>]
cc infra digov-negotiating-deal-v2 | digov-complete-deal-v2 <id>
cc infra digov-fail-deal-v2 | digov-cancel-deal-v2 <id> [reason]
cc infra digov-get-deal-v2 <id> | digov-list-deals-v2
cc infra digov-auto-stale-idle-v2 | digov-auto-fail-stuck-v2 | digov-gov-stats-v2
```

## 系统架构

```
┌────────────────────────────────────────────────────────────────────┐
│ cc infra <subcommand>                                              │
│   preAction hook: 若命令树挂载 _db → ensureDecentralInfraTables(db)  │
└──────────────────────────────┬─────────────────────────────────────┘
                               │
                ┌──────────────▼───────────────┐
                │ src/lib/decentral-infra.js   │
                ├──────────────────────────────┤
   V1（落库）    │ _deals/_versions/_routes     │←──→ SQLite 镜像
                │ (内存 Map，启动 _loadAll 回灌) │     filecoin_deals
                │ deal: pending→active/expired │     content_versions
                │ version: 同 CID 递增          │     anti_censorship_routes
                │ route: 时延/可靠性聚合         │
                ├──────────────────────────────┤
   V2 治理      │ provider/deal 状态机（纯内存）  │ onboarding→active→…→retired
   （不落库）    │ 容量上限 + idle/stuck 巡检     │ queued→active→completed/…
                │ digov profile/deal overlay   │ pending→active→stale→archived
                └──────────────────────────────┘
```

数据流要点：V1 三类资源同时保存在内存 Map 与 SQLite 表中（启动时回灌）；V2 治理与 digov overlay 为**纯内存**实现（命令直接传 `db=null`），进程结束即失。

## 配置参考

均为运行时 setter（进程内生效），无环境变量：

| 配置项                              | 默认值                   | 设置命令                                    | 来源常量                                       |
| ----------------------------------- | ------------------------ | ------------------------------------------- | ---------------------------------------------- |
| 每 operator 活跃 provider 上限      | `20`                     | `set-max-active-providers-per-operator <n>` | `DI_DEFAULT_MAX_ACTIVE_PROVIDERS_PER_OPERATOR` |
| 每 provider 活跃 deal 上限          | `10`                     | `set-max-active-deals-per-provider <n>`     | `DI_DEFAULT_MAX_ACTIVE_DEALS_PER_PROVIDER`     |
| provider idle 阈值                  | `604800000` ms（7 天）   | `set-provider-idle-ms <ms>`                 | `DI_DEFAULT_PROVIDER_IDLE_MS`                  |
| deal stuck 阈值                     | `86400000` ms（24 小时） | `set-deal-stuck-ms <ms>`                    | `DI_DEFAULT_DEAL_STUCK_MS`                     |
| digov: 每 owner 活跃 profile 上限   | `6`                      | `digov-set-max-active-v2 <n>`               | `_digovMaxActive`                              |
| digov: 每 profile pending deal 上限 | `15`                     | `digov-set-max-pending-v2 <n>`              | `_digovMaxPending`                             |
| digov: idle 阈值                    | `2592000000` ms（30 天） | `digov-set-idle-ms-v2 <n>`                  | `_digovIdleMs`                                 |
| digov: stuck 阈值                   | `60000` ms               | `digov-set-stuck-ms-v2 <n>`                 | `_digovStuckMs`                                |

V1 schema 默认值（SQLite 列级）：deal `status='pending'`、`renewal_count=0`；version `version=1`、`cached=0`、`peer_count=0`；route `status='active'`、`reliability=1.0`。

## 性能指标

来自代码的运行限制（基准数据待补）：

- `deals` / `versions` / `routes` 列表均支持 `--limit` 截断
- `connectivity` 报告为内存内全量聚合（总数 / 活跃数 / `avgLatencyMs` / `avgReliability` / `byType`），复杂度 O(路由数)
- 自动巡检阈值：provider idle **7 天**、deal stuck **24 小时**（可调）；digov idle **30 天**、stuck **60 秒**
- V1 表均带 `CREATE TABLE IF NOT EXISTS`，重复 ensure 无副作用

## 测试覆盖

共 **109** 个测试：

| 测试文件                                                            | 数量 | 覆盖范围                                                          |
| ------------------------------------------------------------------- | ---- | ----------------------------------------------------------------- |
| `packages/cli/__tests__/unit/decentral-infra.test.js`               | 65   | 建表、deal/version/route CRUD 与统计、V2 provider/deal 治理状态机 |
| `packages/cli/__tests__/unit/lib/decentral-infra-v2-iter23.test.js` | 44   | digov profile/deal 治理 overlay                                   |

```bash
cd packages/cli
npx vitest run __tests__/unit/decentral-infra.test.js __tests__/unit/lib/decentral-infra-v2-iter23.test.js
```

## 安全考虑

- **metadata JSON 校验**：`--metadata` 经 `JSON.parse` 验证，非法输入立即报错，不会把脏字符串写进状态
- **状态机硬守卫**：provider 转换表（`retired` 终态不可复活）、deal 转换表（`queued→active→completed/failed/canceled`），非法状态值与非法转换都抛错
- **容量限流**：激活 provider 时检查 operator 活跃上限（默认 20），激活 deal 时检查 provider 活跃上限（默认 10），防单点资源垄断
- **阈值校验**：所有 idle/stuck/上限 setter 拒绝非正整数
- **抗审查路由仅元数据**：`route-add` 只登记路由元信息（类型/端点/时延/可靠性），不主动发起网络连接

## 故障排除

| 现象                                  | 可能原因                                   | 处理                                                                                   |
| ------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------- |
| `--metadata must be valid JSON`       | metadata 参数不是合法 JSON                 | 用单引号包裹并校验，如 `--metadata '{"region":"ap"}'`                                  |
| `Unknown provider: <id>` 且退出码 1   | provider 未注册或进程已重启（V2 为内存态） | 先 `register-provider-v2`；V2 数据不跨进程持久                                         |
| 激活 provider 报上限错误              | operator 活跃 provider 已达 20             | `set-max-active-providers-per-operator` 调高或 retire 闲置 provider                    |
| `auto-offline-stale-providers` 返回空 | 没有 provider 心跳超过 7 天阈值            | 预期行为；`touch-provider-heartbeat` 可刷新心跳，`set-provider-idle-ms` 可调小阈值验证 |
| deal 状态更新 `Failed: ...`           | 目标状态非法或 deal 不存在                 | `cc infra deal-statuses` 查合法值；`deal-show <id>` 确认存在                           |
| `version-add` 版本号不递增            | `-c` 传的 CID 与已有版本不同               | 版本号按 `content_cid` 维度递增，确认 CID 一致                                         |
| V1 数据「丢失」                       | 命令树未挂载 `_db` 时不落库                | V2/digov 子命令不依赖 DB；V1 持久化依赖宿主注入数据库句柄                              |

## 关键文件

| 文件                                                                | 说明                                                              |
| ------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `packages/cli/src/commands/infra.js`                                | `cc infra` 全部子命令注册（V1 + V2 治理 + digov overlay）         |
| `packages/cli/src/lib/decentral-infra.js`                           | 实现层（schema、deal/version/route、provider/deal 状态机、digov） |
| `packages/cli/__tests__/unit/decentral-infra.test.js`               | 65 单元测试（V1 + V2 治理）                                       |
| `packages/cli/__tests__/unit/lib/decentral-infra-v2-iter23.test.js` | 44 单元测试（digov overlay）                                      |

## 使用示例

```bash
# 1) 创建并续期一笔 Filecoin 存储交易
cc infra deal-create -c bafybeib... -s 1048576 -m f01234 -p 0.05 -d 518400
cc infra deal-status <deal-id> active
cc infra deal-renew <deal-id>
cc infra deals -s active

# 2) 内容版本链
cc infra version-add -c bafybeib... -n 5
cc infra version-add -c bafybeib... -p bafybeib...      # version 自动递增
cc infra version-cache <version-id>
cc infra versions -c bafybeib...

# 3) 抗审查路由 + 连通性报告
cc infra route-add -t tor -e socks5://127.0.0.1:9050 -l 320 -r 0.92
cc infra route-add -t direct -e https://relay.example.com -l 45 -r 0.99
cc infra connectivity
cc infra stats

# 4) V2 provider/deal 治理
cc infra register-provider-v2 prov-1 -o op-a -k storage
cc infra activate-provider prov-1
cc infra enqueue-deal-v2 d-1 -p prov-1 -o alice
cc infra activate-deal d-1
cc infra auto-fail-stuck-active-deals    # active 超 24h 自动 failed
cc infra stats-v2
```

## 相关文档

- [去中心化存储（系统设计）](./decentralized-storage.md)
- [IPFS 存储](./ipfs-storage.md)
- [抗审查通信](./anti-censorship.md)
- [V2 治理体系总览](./cli-v2-governance.md)
- [功能总览](./overview.md)
- [推理网络 CLI（cc inference）](./cli-inference.md)
