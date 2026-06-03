# 性能自动调优 CLI（Phase 22）

> `chainlesschain perf` — 实时指标采集、规则评估、调优建议与应用。
>
> 真实 OS 采样 + 环形缓冲 + 5 条规则 + 迟滞阈值 + 冷却时间。

---

## 概述

性能自动调优模块从操作系统实时采集 CPU/内存/事件循环延迟等指标，
基于 5 条内置规则生成调优建议。支持迟滞阈值防止震荡、冷却时间防止频繁变更。
CLI 端仅生成报告和建议，不自动应用变更。

---

## 核心特性

- **真实 OS 采样** — 使用 Node `os` / `process` 指标（loadavg、heap、event-loop lag）
- **环形缓冲历史** — 固定长度滑动窗口，便于求均值/方差
- **5 条内置规则** — 覆盖 CPU、内存、GC、事件循环、并发度调优
- **迟滞阈值** — 进出规则状态的上下限不同，避免阈值附近震荡
- **冷却时间** — 同规则上次触发后 N 秒内不会重复生成建议
- **recommendations 队列** — apply/dismiss 手动确认，history 可审计

---

## 系统架构

```
┌────────────────────────────────────────────────────┐
│          chainlesschain perf (Phase 22)             │
├────────────────────────────────────────────────────┤
│  Collector          │  Rule Evaluator              │
│  real OS sample +   │  5 rules × hysteresis +      │
│  ring buffer        │  cooldown                    │
├────────────────────────────────────────────────────┤
│  Recommendations    │  History                     │
│  pending queue      │  applied / dismissed audit   │
│  apply / dismiss    │                              │
├────────────────────────────────────────────────────┤
│  Alerts             │  Report Generator            │
│  threshold-based    │  综合性能报告                 │
├────────────────────────────────────────────────────┤
│  SQLite: perf_samples / perf_recommendations /     │
│          perf_alerts                               │
└────────────────────────────────────────────────────┘
```

---

## 配置参考

| 配置项                 | 含义                  | 默认       |
| ---------------------- | --------------------- | ---------- |
| `sample_interval_ms`   | 采样间隔              | 1000 ms    |
| `ring_buffer_size`     | 环形缓冲容量          | 300 samples |
| `cooldown_ms`          | 规则冷却时间          | 60000 ms   |
| `hysteresis`           | 迟滞阈值偏差          | ±5%        |
| 规则状态               | enabled / disabled    |            |
| 性能级别               | normal/warning/critical |          |

查看：`chainlesschain perf levels`、`perf rule-statuses`、`perf config`。

---

## 性能指标

| 操作                    | 典型耗时         |
| ----------------------- | ---------------- |
| collect 单次采样        | < 10 ms          |
| evaluate（5 规则）      | < 10 ms          |
| recommendations 查询    | < 5 ms           |
| report 综合生成         | < 50 ms          |
| clear-history           | < 10 ms          |
| 内置环形缓冲容量        | 300 samples      |

---

## 测试覆盖率

```
__tests__/unit/perf-tuning.test.js — 43 tests (473 lines)
```

覆盖：collect 真实采样、ring buffer 环绕、5 条规则各自触发条件、
迟滞阈值防震荡、cooldown 时间窗、recommendations apply/dismiss、alerts 生成。

---

## 安全考虑

1. **只读采样** — CLI 侧不修改系统参数，仅生成建议；真实变更需上层调用方完成
2. **建议人工确认** — apply/dismiss 均为用户主动触发，避免自动调优误伤
3. **指标本地化** — 采样结果仅存本地 SQLite，不上传
4. **冷却防噪音** — cooldown 防止相同规则短时间刷屏，保护 operator 注意力
5. **历史不可删除** — `history` 记录所有应用/忽略操作，便于审计

---

## 故障排查

**Q: `evaluate` 没有生成新建议?**

1. 是否所有规则都在冷却期内（上次触发 < 60s）
2. `rule-show` 查看规则是否被 disabled
3. 指标是否在迟滞阈值之间（未超出上限也未回到下限）

**Q: `collect` 采到的数据不准?**

1. 事件循环延迟测量在高负载 CLI 进程中可能偏高
2. 对比 `perf metrics` 与 OS 工具（htop/Activity Monitor）排查
3. 增大 `ring_buffer_size` 让统计平滑

**Q: apply 建议后没有实际效果?**

CLI 侧 apply 只是标记 recommendation 为已应用；实际配置需要上层调用方读取并修改运行时参数。

---

## 关键文件

- `packages/cli/src/commands/perf.js` — Commander 子命令（~433 行）
- `packages/cli/src/lib/perf-tuning.js` — 采样器 + 规则评估
- `packages/cli/__tests__/unit/perf-tuning.test.js` — 单测（43 tests）
- 数据表：`perf_samples` / `perf_recommendations` / `perf_alerts`
- 设计文档：`docs/design/modules/22_性能自动调优.md`

---

## 使用示例

```bash
# 1. 采样 + 评估
chainlesschain perf collect
chainlesschain perf metrics --json
chainlesschain perf evaluate

# 2. 查看并应用建议
chainlesschain perf recommendations
rid=$(chainlesschain perf recommendations --json | jq -r '.[0].id')
chainlesschain perf apply $rid

# 3. 规则管理
chainlesschain perf rules
chainlesschain perf rule-disable <rule-id>

# 4. 告警 + 报告
chainlesschain perf alerts
chainlesschain perf report

# 5. 清理 + 统计
chainlesschain perf clear-history
chainlesschain perf stats --json
```

---

## 目录/枚举

```bash
chainlesschain perf levels          # 列出性能级别
chainlesschain perf rule-statuses   # 列出规则状态
```

---

## 规则管理

```bash
chainlesschain perf rules                   # 列出所有调优规则
chainlesschain perf rule-show <rule-id>      # 查看规则详情
chainlesschain perf rule-enable <rule-id>    # 启用规则
chainlesschain perf rule-disable <rule-id>   # 禁用规则
```

---

## 指标采集

```bash
# 采集一次指标样本
chainlesschain perf collect

# 查看当前指标
chainlesschain perf metrics
chainlesschain perf metrics --json

# 查看采样历史
chainlesschain perf samples --limit 20

# 清除历史数据
chainlesschain perf clear-history
```

---

## 评估与建议

```bash
# 基于当前指标评估所有规则
chainlesschain perf evaluate

# 查看待处理建议
chainlesschain perf recommendations
chainlesschain perf recommendations --json

# 应用建议
chainlesschain perf apply <recommendation-id>

# 忽略建议
chainlesschain perf dismiss <recommendation-id>

# 查看已应用/已忽略的历史
chainlesschain perf history
```

---

## 告警 & 配置

```bash
chainlesschain perf alerts            # 查看性能告警
chainlesschain perf config            # 查看调优配置
chainlesschain perf config --json
```

---

## 统计 & 报告

```bash
chainlesschain perf stats             # 性能调优统计
chainlesschain perf stats --json
chainlesschain perf report            # 生成综合性能报告
```

---

## 相关文档

- 设计文档：`docs/design/modules/22_性能自动调优.md`
- CLI 总索引：`docs/CLI_COMMANDS_REFERENCE.md`
- [Ops / AIOps →](/chainlesschain/cli-ops)
- [DB Evolution →](/chainlesschain/cli-dbevo)
- [Runtime →](/chainlesschain/cli-runtime)
