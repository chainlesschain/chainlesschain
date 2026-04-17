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

## 相关文档

- 设计文档: `docs/design/modules/25_自治运维系统.md`
- 管理器: `packages/cli/src/lib/aiops.js`
- 命令: `packages/cli/src/commands/ops.js`
