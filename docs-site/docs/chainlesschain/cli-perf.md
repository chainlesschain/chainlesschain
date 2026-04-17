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
