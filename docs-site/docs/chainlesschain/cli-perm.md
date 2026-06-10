# 权限引擎 V2 治理（cc perm）

> **状态: ✅ 生产可用 | Permission Engine V2 治理 overlay（CLI v0.141.0 引入）| 内存态状态机 | 38 个 V2 测试全绿**
>
> `cc perm` 是 **Permission Engine V2 治理层**的命令面：管理权限规则（perm rule）与权限检查（perm check）两套状态机的注册、激活、流转、配额与自动治理。它叠加在 `lib/permission-engine.js` 之上、独立于旧权限助手；**与 `cc permissions`（`.claude/settings.json` allow/ask/deny 规则，见 [权限规则](./cli-permissions.md)）是两套完全不同的系统**——`cc perm` 治理的是规则/检查对象的生命周期，不解析 `Tool(pattern)` 语法。

## 概述

V2 治理 overlay 把「权限规则」和「权限检查」建模为两台显式状态机，并配上配额与自动回收：

- **规则成熟度（rule maturity）**：`pending → active → disabled → retired`（disabled 可恢复 active；retired 为终态）。每个 owner 的 active 规则数有配额（默认 10），从 disabled 恢复激活**不**重复占配额。
- **检查生命周期（check lifecycle）**：`queued → evaluating → allowed | denied | cancelled`（三个均为终态）。每条规则的 pending（queued+evaluating）检查数有配额（默认 30）。
- **自动治理**：`auto-disable-idle-v2` 把超过空闲阈值（默认 30 天未 touch）的 active 规则翻成 disabled；`auto-deny-stuck-v2` 把卡在 evaluating 超过阈值（默认 60 秒）的检查自动 deny（`denyReason: "auto-deny-stuck"`）。
- 所有非法状态流转直接抛错（如 `invalid perm rule transition retired → active`），所有命令输出 JSON。

状态**全部驻留内存**（`Map`），进程退出即清空——这是治理语义层（供编排/测试/上层系统驱动），不是持久化授权存储。同一 lib 文件还导出 SQLite 持久化的旧版 RBAC（`rbac_roles`/`rbac_grants`/`rbac_direct_permissions` 三表 + 4 个内置角色 + 26 个权限 scope），但 `cc perm` 只驱动 V2 overlay。

## 核心特性

- 🔄 **双状态机**：规则 4 态（pending/active/disabled/retired）+ 检查 5 态（queued/evaluating/allowed/denied/cancelled），非法流转 fail-fast 抛错
- 📊 **配额防失控**：每 owner active 规则上限（默认 **10**）、每规则 pending 检查上限（默认 **30**），超限注册/激活/创建直接抛错
- ♻️ **disabled 恢复豁免**：disabled → active 视为恢复，不再校验 owner 配额（避免治理回收后无法复活）
- ⏱️ **空闲自动回收**：active 规则超 `permRuleIdleMs`（默认 **30 天**）未 `touch` → 自动 disabled
- 🧯 **卡死自动否决**：evaluating 检查超 `permCheckStuckMs`（默认 **60 秒**）→ 自动 denied，metadata 记 `auto-deny-stuck`
- 🧾 **完整时间戳审计**：每个对象带 `createdAt/updatedAt/activatedAt/retiredAt/lastTouchedAt`（规则）、`startedAt/settledAt`（检查），deny/cancel 可附 reason 进 metadata
- 🧰 **运行时可调参**：四个治理参数（max-active/max-pending/idle-ms/stuck-ms）均可经命令在运行时调整（必须为正整数）
- 📈 **治理统计**：`gov-stats-v2` 一次输出总量、各状态分布、当前四参数
- 🧪 **可重置**：`reset-state-v2` 清空全部内存状态并恢复默认参数（测试/演示用）

## 命令参考

所有子命令输出 JSON（`JSON.stringify(..., null, 2)`）。

### 枚举与配置

```bash
cc perm enums-v2                      # 输出规则成熟度 + 检查生命周期枚举
cc perm config-v2                     # 当前四个治理参数
cc perm set-max-active-v2 <n>         # 每 owner active 规则上限（默认 10）
cc perm set-max-pending-v2 <n>        # 每规则 pending 检查上限（默认 30）
cc perm set-idle-ms-v2 <n>            # 规则空闲阈值毫秒（默认 2592000000 = 30 天）
cc perm set-stuck-ms-v2 <n>           # 检查卡死阈值毫秒（默认 60000 = 60 秒）
```

### 规则生命周期

```bash
cc perm register-rule-v2 <id> <owner> [--scope <s>]   # 注册（pending；scope 默认 "*"）
cc perm activate-rule-v2 <id>                         # pending/disabled → active（配额校验）
cc perm disable-rule-v2 <id>                          # active → disabled
cc perm retire-rule-v2 <id>                           # → retired（终态）
cc perm touch-rule-v2 <id>                            # 刷新 lastTouchedAt（防 idle 回收；终态不可 touch）
cc perm get-rule-v2 <id>                              # 查单条（不存在 → null）
cc perm list-rules-v2                                 # 列全部
```

### 检查生命周期

```bash
cc perm create-check-v2 <id> <ruleId> [--subject <s>] # 创建（queued；规则必须已存在，pending 配额校验）
cc perm evaluate-check-v2 <id>                        # queued → evaluating（记 startedAt）
cc perm allow-check-v2 <id>                           # evaluating → allowed（终态）
cc perm deny-check-v2 <id> [reason]                   # evaluating → denied（reason 入 metadata.denyReason）
cc perm cancel-check-v2 <id> [reason]                 # queued/evaluating → cancelled
cc perm get-check-v2 <id>                             # 查单条
cc perm list-checks-v2                                # 列全部
```

### 自动治理与统计

```bash
cc perm auto-disable-idle-v2          # 批量 disabled 空闲 active 规则 → {flipped:[ids],count}
cc perm auto-deny-stuck-v2            # 批量 denied 卡死 evaluating 检查 → {flipped:[ids],count}
cc perm gov-stats-v2                  # 总量 + 状态分布 + 当前参数
cc perm reset-state-v2                # 清空内存状态、恢复默认参数
```

## 系统架构

```
┌──────────────────────────────────────────────────────────────────┐
│ cc perm <subcommand>   (src/commands/perm.js — 薄命令面，全 JSON) │
└──────────────────────────┬───────────────────────────────────────┘
                           ▼
   src/lib/permission-engine.js — V2 治理 overlay（内存 Map × 2）
   ┌─────────────────────────────┐  ┌──────────────────────────────────┐
   │ 规则状态机                   │  │ 检查状态机                        │
   │ pending ──► active           │  │ queued ──► evaluating             │
   │    │          │ ▲            │  │   │            │                  │
   │    │          ▼ │(恢复豁免)   │  │   │            ├─► allowed (终)   │
   │    │      disabled           │  │   │            ├─► denied  (终)   │
   │    └──────────┴──► retired(终)│  │   └────────────┴─► cancelled(终) │
   └──────────┬──────────────────┘  └──────────────┬───────────────────┘
              │ 配额: maxActive/owner=10            │ 配额: maxPending/rule=30
              │ idle ≥ 30d → auto-disable           │ stuck ≥ 60s → auto-deny
              └────────────── gov-stats-v2 / reset-state-v2 ─────────────┘

（同文件另有 SQLite 持久化旧版 RBAC：rbac_roles / rbac_grants /
 rbac_direct_permissions，内置 admin/editor/viewer/agent 4 角色 +
 26 个 resource:action scope——cc perm 不驱动该层）
```

## 配置参考

无配置文件/环境变量——四个参数仅经命令在运行时设置（进程内生效）：

| 参数 | 设置命令 | 默认值 | 含义 |
|------|---------|--------|------|
| `maxActivePermRulesPerOwner` | `set-max-active-v2 <n>` | **10** | 每 owner 同时 active 的规则数上限 |
| `maxPendingPermChecksPerRule` | `set-max-pending-v2 <n>` | **30** | 每规则 queued+evaluating 检查数上限 |
| `permRuleIdleMs` | `set-idle-ms-v2 <n>` | **2592000000**（30 天） | active 规则未 touch 多久算空闲 |
| `permCheckStuckMs` | `set-stuck-ms-v2 <n>` | **60000**（60 秒） | evaluating 检查多久算卡死 |

四参数均要求正整数，否则抛 `must be positive integer`。`register-rule-v2 --scope` 默认 `"*"`；`create-check-v2 --subject` 默认空字符串。

## 性能指标

- **纯内存 O(1)/O(n) 操作**：单对象操作为 Map 查找 O(1)；配额计数与自动治理扫描为全量线性扫描 O(规则数/检查数)，无任何 I/O。
- **默认治理阈值**：idle 30 天、stuck 60 秒、active 配额 10/owner、pending 配额 30/rule（以上为代码常量，可运行时调整）。
- **无持久化开销**：状态不落盘，进程重启归零（设计如此）。
- 无吞吐基准——治理对象量级通常为个位/十位数。基准数据待补。

## 测试覆盖

| 测试文件 | 数量 | 覆盖 |
|----------|------|------|
| `packages/cli/__tests__/unit/lib/permission-engine-v2.test.js` | **38** | V2 全面：枚举冻结、参数 get/set 与校验、规则/检查全部流转与非法流转、配额（含 disabled 恢复豁免）、auto-disable-idle / auto-deny-stuck（注入 now 确定性）、gov-stats、reset |
| `packages/cli/__tests__/unit/permission-engine.test.js` | 36 | 同 lib 的旧版 SQLite RBAC（角色/授予/直接权限/checkPermission 通配），非 `cc perm` 命令面 |

```bash
cd packages/cli
npx vitest run __tests__/unit/lib/permission-engine-v2.test.js
```

## 安全考虑

- **状态机 fail-fast**：所有非法流转（如对 retired 规则 activate、对 allowed 检查再 deny）立即抛错，杜绝静默状态腐蚀。
- **配额护栏**：owner 级 active 配额与规则级 pending 配额防止规则/检查无界增长（资源失控、审批洪泛）。
- **卡死默认否决**：超时检查被自动 **deny**（而非 allow）——治理回收方向是收紧而非放行，并在 metadata 留 `auto-deny-stuck` 痕迹。
- **终态不可篡改**：retired 规则不可 touch/复活，settled 检查不可再流转；deny/cancel 的 reason 进 metadata 留审计线索。
- **内存态边界要自知**：`cc perm` 状态不持久化、不参与实际工具调用拦截——真正在 agent 工具循环里把关的是 [`cc permissions`](./cli-permissions.md) 规则与 shell 硬黑名单；勿把 V2 overlay 当成持久授权存储使用。
- **返回值防御性拷贝**：所有读写都返回浅拷贝（含 metadata 拷贝），外部修改返回对象不会污染内部状态。

## 故障排除

| 现象 | 可能原因 | 处理 |
|------|---------|------|
| `invalid perm rule transition X → Y` | 流转不在状态机允许集合内（如 retired → active） | 按 `enums-v2` 输出的状态机走；retired/settled 为终态 |
| `max active perm rules for owner <o> reached` | 该 owner active 规则已达上限（默认 10） | `retire`/`disable` 旧规则，或 `set-max-active-v2` 调高；disabled → active 恢复不占配额 |
| `max pending perm checks for rule <r> reached` | 该规则 queued+evaluating 检查已达上限（默认 30） | 先 settle（allow/deny/cancel）存量检查，或 `auto-deny-stuck-v2` 清卡死项 |
| `perm rule <id> not found` / `perm check <id> not found` | id 不存在，或进程重启后内存态已清空 | `list-rules-v2`/`list-checks-v2` 核对；内存态不跨进程是设计行为 |
| `... already registered / already exists` | id 重复注册 | 换 id，或 `reset-state-v2`（会清空一切） |
| `cannot touch terminal perm rule <id>` | 对 retired 规则 touch | 终态规则不可续命；需要就重新 register |
| 规则被莫名 disabled | 超过 idle 阈值后跑过 `auto-disable-idle-v2` | 活跃规则定期 `touch-rule-v2`；或 `activate-rule-v2` 恢复（不占配额） |
| `<param> must be positive integer` | set-* 命令传了 0/负数/非数字 | 传正整数 |
| 想配置 agent 的 allow/ask/deny 却找不到子命令 | 用错命令——那是 `cc permissions`（全名），`perm` 被 V2 治理占用 | 见 [权限规则（cc permissions）](./cli-permissions.md) |

## 关键文件

| 文件 | 说明 |
|------|------|
| `packages/cli/src/commands/perm.js` | `cc perm` 命令面（24 个子命令，薄封装，全 JSON 输出） |
| `packages/cli/src/lib/permission-engine.js` | V2 治理 overlay（状态机、配额、自动治理、统计）+ 旧版 SQLite RBAC |
| `packages/cli/__tests__/unit/lib/permission-engine-v2.test.js` | V2 单测（38） |
| `packages/cli/__tests__/unit/permission-engine.test.js` | 旧版 RBAC lib 单测（36） |

## 使用示例

```bash
# 1) 看状态机与当前参数
cc perm enums-v2
cc perm config-v2

# 2) 注册并激活一条规则
cc perm register-rule-v2 rule-deploy ops-team --scope "deploy:*"
cc perm activate-rule-v2 rule-deploy

# 3) 跑一次完整的权限检查生命周期
cc perm create-check-v2 chk-001 rule-deploy --subject did:example:alice
cc perm evaluate-check-v2 chk-001
cc perm allow-check-v2 chk-001          # 或 deny-check-v2 chk-001 "outside window"

# 4) 治理巡检：回收空闲规则、否决卡死检查
cc perm auto-disable-idle-v2
cc perm auto-deny-stuck-v2

# 5) 总览
cc perm gov-stats-v2
#    → { totalPermRulesV2, totalPermChecksV2, rulesByStatus, checksByStatus, ... }

# 6) 调紧治理参数（演示环境把卡死阈值降到 5 秒）
cc perm set-stuck-ms-v2 5000

# 7) 演示/测试后清场
cc perm reset-state-v2
```

## 相关文档

- [权限规则（cc permissions）](./cli-permissions.md)
- [CLI Agent 智能代理](./cli-agent.md)
- [桌面权限系统（RBAC）](./permissions.md)
- [审计系统](./cli-audit.md)
- [认证（cc auth）](./cli-auth.md)
