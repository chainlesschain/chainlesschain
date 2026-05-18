# 自治运维 AIOps (ops)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## 核心特性

- **异常检测**: 基于 Z-Score / IQR 算法的指标异常检测，自动创建事件
- **事件生命周期**: open -> acknowledged -> resolved -> closed 四阶段管理
- **修复剧本**: 创建触发条件 + 步骤列表的自动修复剧本，追踪成功/失败次数
- **指标基线**: 按指标名维护均值/标准差/四分位数基线
- **事后复盘**: 为已解决事件生成 postmortem (影响/根因/时间线)

## 概述

ChainlessChain CLI 自治运维模块 (Phase 25) 是 Desktop 端 AIOps 系统的 CLI 移植。CLI 端提供 Z-Score / IQR 异常检测、事件生命周期管理、修复剧本 CRUD 和事后复盘生成。严重性分 P0-P3 四级。

## 命令参考

### ops severities — 严重性等级

```bash
chainlesschain ops severities
chainlesschain ops severities --json
```

列出严重性等级: `P0`, `P1`, `P2`, `P3`。

### ops statuses — 事件状态目录

```bash
chainlesschain ops statuses
chainlesschain ops statuses --json
```

列出事件状态: `open`, `acknowledged`, `resolved`, `closed`。

### ops algorithms — 检测算法目录

```bash
chainlesschain ops algorithms
chainlesschain ops algorithms --json
```

列出异常检测算法: `z_score`, `iqr`。

### ops rollback-types — 回滚类型目录

```bash
chainlesschain ops rollback-types
chainlesschain ops rollback-types --json
```

列出回滚类型: `git`, `docker`, `config`, `service`, `custom`。

### ops baseline-update — 更新指标基线

```bash
chainlesschain ops baseline-update cpu_usage -v "45,52,48,50,47,53"
chainlesschain ops baseline-update memory_mb -v "1024,1100,980,1050,1020" --json
```

从逗号分隔的数值列表更新指标基线。自动计算均值、标准差、Q1、Q3 和样本数。

### ops baseline-show — 查看指标基线

```bash
chainlesschain ops baseline-show cpu_usage
chainlesschain ops baseline-show cpu_usage --json
```

显示指标的完整基线: 均值、标准差、Q1、Q3、样本数。

### ops baselines — 列出所有基线

```bash
chainlesschain ops baselines
chainlesschain ops baselines --json
```

列出所有已记录的指标基线。

### ops detect — 异常检测

```bash
chainlesschain ops detect cpu_usage 95
chainlesschain ops detect memory_mb 2048 -a iqr --json
```

检测指标值是否异常。`-a` 指定算法 (`z_score` 或 `iqr`，默认 `z_score`)。异常时自动创建事件并返回事件 ID 和严重性。

### ops incident-create — 手动创建事件

```bash
chainlesschain ops incident-create -m disk_usage -s P1 -d "磁盘使用率超过 90%"
chainlesschain ops incident-create -s P2 --json
```

手动创建事件。`-m` 关联指标，`-s` 严重性 (默认 P3)，`-d` 描述。

### ops incident-show — 查看事件详情

```bash
chainlesschain ops incident-show <incident-id>
chainlesschain ops incident-show <incident-id> --json
```

显示事件: ID、严重性、状态、关联指标、描述。

### ops incident-ack / incident-resolve / incident-close — 事件状态推进

```bash
chainlesschain ops incident-ack <incident-id> [--json]
chainlesschain ops incident-resolve <incident-id> [--json]
chainlesschain ops incident-close <incident-id> [--json]
```

按顺序推进事件状态: `open` -> `acknowledged` -> `resolved` -> `closed`。

### ops incidents — 列出事件

```bash
chainlesschain ops incidents
chainlesschain ops incidents -s P0 -S open --limit 20 --json
```

列出事件。`-s` 按严重性过滤，`-S` 按状态过滤，`--limit` 限制结果数。

### ops playbook-create — 创建修复剧本

```bash
chainlesschain ops playbook-create -n "重启服务"
chainlesschain ops playbook-create -n "磁盘清理" -t '{"metric":"disk_usage","threshold":90}' -s '["df -h","docker system prune"]' --json
```

创建修复剧本。`-n` (必填) 名称，`-t` 触发条件 JSON，`-s` 步骤列表 JSON。

### ops playbook-show — 查看剧本详情

```bash
chainlesschain ops playbook-show <playbook-id>
chainlesschain ops playbook-show <playbook-id> --json
```

显示剧本: 名称、启用状态、成功/失败次数、触发条件、步骤。

### ops playbook-toggle / playbook-record — 剧本操作

```bash
chainlesschain ops playbook-toggle <playbook-id> on [--json]   # 启用
chainlesschain ops playbook-toggle <playbook-id> off [--json]  # 禁用
chainlesschain ops playbook-record <playbook-id> success [--json]
chainlesschain ops playbook-record <playbook-id> failure [--json]
```

`toggle` 启用或禁用剧本，`record` 记录执行结果 (`success`/`failure`)，累计成功/失败次数。

### ops playbooks — 列出剧本

```bash
chainlesschain ops playbooks
chainlesschain ops playbooks -e --limit 10 --json    # 仅启用
chainlesschain ops playbooks -d --json               # 仅禁用
```

列出修复剧本。`-e` 仅启用，`-d` 仅禁用。

### ops postmortem — 生成事后复盘

```bash
chainlesschain ops postmortem <incident-id>
chainlesschain ops postmortem <incident-id> --json
```

为已解决/已关闭的事件生成 postmortem: 严重性、关联指标、影响范围、根因分析、解决时间 (TTR)、确认时间 (TTA)。

### ops stats — 统计信息

```bash
chainlesschain ops stats
chainlesschain ops stats --json
```

显示 AIOps 汇总统计: 事件总数/平均解决时间/按严重性分布、剧本总数/启用数/成功数/失败数、基线指标数。

## 数据存储

所有数据持久化到 SQLite (`ops_incidents` / `ops_playbooks` / `ops_baselines` 三张表)，首次执行子命令时自动建表。

## 系统架构

```
┌───────────────────────────────────────────────────────┐
│            chainlesschain ops (Phase 25)               │
├───────────────────────────────────────────────────────┤
│  Baseline Mgr      │  Detectors                       │
│  mean/std/Q1/Q3    │  z_score / iqr                   │
│  per-metric        │  → anomaly → auto-incident       │
├───────────────────────────────────────────────────────┤
│  Incident Lifecycle                                    │
│  open → acknowledged → resolved → closed               │
│  severities: P0 / P1 / P2 / P3                         │
├───────────────────────────────────────────────────────┤
│  Playbooks         │  Postmortem                      │
│  trigger + steps   │  TTA / TTR / impact / root-cause │
│  enable/disable    │                                  │
├───────────────────────────────────────────────────────┤
│  SQLite: ops_incidents / ops_playbooks / ops_baselines │
└───────────────────────────────────────────────────────┘
```

数据流：`baseline-update` 训练基线 → `detect` 触发异常 → 自动创建 incident（严重性由
Z-score 幅度决定）→ `incident-ack/resolve/close` → `postmortem` 生成复盘。

## 配置参考

| 配置项                    | 含义                    | 默认        |
| ------------------------- | ----------------------- | ----------- |
| `z_score_threshold`       | Z-score 异常阈值        | 3.0         |
| `iqr_multiplier`          | IQR 倍数                | 1.5         |
| severities                | P0 / P1 / P2 / P3       |             |
| statuses                  | open/acknowledged/resolved/closed |  |
| algorithms                | z_score / iqr           |             |
| rollback-types            | git/docker/config/service/custom |   |

查看：`chainlesschain ops severities`、`ops algorithms`、`ops rollback-types`。

## 性能指标

| 操作                        | 典型耗时         |
| --------------------------- | ---------------- |
| baseline-update（100 点）   | < 10 ms          |
| detect（单次判定）          | < 5 ms           |
| incident 创建               | < 15 ms          |
| playbook record             | < 5 ms           |
| postmortem（含聚合）        | < 30 ms          |
| stats 聚合                  | < 20 ms          |

## 测试覆盖率

```
__tests__/unit/aiops.test.js — 107 tests (1271 lines)
```

覆盖：baseline 统计计算、z_score / iqr 两种算法边界值、incident 状态机全路径、
playbook CRUD + record、postmortem 生成、TTA/TTR 计算、severities P0-P3 分级、
非法状态转换拒绝。

## 安全考虑

1. **基线污染保护** — `baseline-update` 应来自可信指标源，异常样本可能拉偏均值；可用中位数基线作为备选
2. **playbook 步骤审计** — 步骤以 JSON 存储，执行方式由上层决定，CLI 侧仅记录
3. **事件不可直接 close** — 状态机强制 open → ack → resolve → close 顺序
4. **postmortem 仅对已解决事件** — 防止对未处理事件误生成报告
5. **severity 分级审计** — 严重性由算法自动给出，手动 `incident-create` 需显式指定

## 故障排查

**Q: `detect` 总判定为正常，但实际有异常?**

1. 检查 `baseline-show <metric>` 的 mean/std——样本不足时 std 偏小，Z-score 不敏感
2. 切换算法 `-a iqr`（对少量样本更稳健）
3. 减少 `z_score_threshold`（如 2.5）使更敏感

**Q: incident 无法 ack?**

状态机强制：必须处于 `open` 才能 ack；`resolved` 不能再 ack。用 `incident-show` 确认当前状态。

**Q: `postmortem` 报 incident not resolved?**

复盘要求事件已 resolved 或 closed；未解决事件先运行 `incident-resolve <id>`。

## 关键文件

- `packages/cli/src/commands/ops.js` — Commander 子命令（~762 行）
- `packages/cli/src/lib/aiops.js` — 异常检测 + 事件 + playbook + postmortem
- `packages/cli/__tests__/unit/aiops.test.js` — 单测（107 tests）
- 数据表：`ops_incidents` / `ops_playbooks` / `ops_baselines`
- 设计文档：`docs/design/modules/25_自治运维系统.md`

## 使用示例

```bash
# 1. 训练基线 + 检测异常
chainlesschain ops baseline-update cpu_usage -v "45,52,48,50,47,53,49,51"
chainlesschain ops detect cpu_usage 95     # 自动创建 incident

# 2. 事件推进
iid=$(chainlesschain ops incidents --json | jq -r '.[0].id')
chainlesschain ops incident-ack $iid
chainlesschain ops incident-resolve $iid

# 3. 生成复盘
chainlesschain ops postmortem $iid

# 4. 修复 playbook
chainlesschain ops playbook-create -n "磁盘清理" \
  -t '{"metric":"disk_usage","threshold":90}' \
  -s '["df -h","docker system prune"]'
chainlesschain ops playbook-record <pid> success

# 5. 全局统计
chainlesschain ops stats --json
```

## 相关文档

- 设计文档: `docs/design/modules/25_自治运维系统.md`
- 管理器: `packages/cli/src/lib/aiops.js`
- 命令: `packages/cli/src/commands/ops.js`
- [Perf Tuning →](/chainlesschain/cli-perf)
- [Federation Hardening →](/chainlesschain/cli-federation)
