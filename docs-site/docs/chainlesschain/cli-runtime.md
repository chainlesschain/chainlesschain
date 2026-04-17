# 统一应用运行时 CLI（Phase 63）

> `chainlesschain runtime` — 插件生命周期、热更新、状态同步与运行时监控。
>
> 覆盖插件加载/卸载、semver 推断热更新与回滚、LWW 状态同步、模拟 profiling。

---

## 目录

- [概述](#概述)
- [目录/枚举](#目录枚举)
- [插件生命周期](#插件生命周期)
- [热更新 & 回滚](#热更新--回滚)
- [Profiling](#profiling)
- [状态同步](#状态同步)
- [平台 & 健康 & 指标](#平台--健康--指标)
- [配置](#配置)
- [统计](#统计)

---

## 概述

Universal Runtime 提供跨平台插件运行时抽象，支持插件热加载/卸载、
基于 semver 的热更新与回滚、LWW（Last-Writer-Wins）分布式状态同步、
以及运行时性能采样。

---

## 目录/枚举

```bash
chainlesschain runtime plugin-statuses   # 插件生命周期状态
chainlesschain runtime update-types      # 更新类型（patch/minor/major）
chainlesschain runtime health-levels     # 健康等级
chainlesschain runtime profile-types     # 采样类型（cpu/memory/io）
```

---

## 插件生命周期

```bash
# 加载插件
chainlesschain runtime plugin-load my-plugin --version 1.0.0 --entry ./plugins/my-plugin.js

# 卸载插件
chainlesschain runtime plugin-unload my-plugin

# 设置插件状态
chainlesschain runtime plugin-status my-plugin disabled

# 查看插件详情
chainlesschain runtime plugin-show my-plugin

# 列出所有插件
chainlesschain runtime plugins
chainlesschain runtime plugins --json
```

---

## 热更新 & 回滚

```bash
# 应用热更新（自动从 semver 推断 patch/minor/major）
chainlesschain runtime hot-update my-plugin --version 1.1.0

# 回滚到上一版本
chainlesschain runtime rollback my-plugin

# 查看更新历史
chainlesschain runtime updates
chainlesschain runtime updates --json
```

---

## Profiling

```bash
# 采集运行时性能样本
chainlesschain runtime profile --type cpu --duration 10s

# 查看采样详情
chainlesschain runtime profile-show <id>

# 列出采样记录
chainlesschain runtime profiles
```

---

## 状态同步

```bash
# 设置同步状态值（LWW — Last Writer Wins）
chainlesschain runtime state-set theme dark

# 获取状态值
chainlesschain runtime state-get theme

# 列出所有同步状态键
chainlesschain runtime state-list

# 删除状态条目
chainlesschain runtime state-delete theme
```

---

## 平台 & 健康 & 指标

```bash
chainlesschain runtime platform    # 显示平台信息（OS / Node / Electron 版本等）
chainlesschain runtime health      # 运行时健康检查
chainlesschain runtime metrics     # 运行时指标（内存、CPU、事件循环延迟等）
```

---

## 配置

```bash
chainlesschain runtime configure maxPlugins 20    # 更新运行时配置
chainlesschain runtime config                      # 查看当前配置
```

---

## 统计

```bash
chainlesschain runtime stats          # 运行时统计概览
chainlesschain runtime stats --json
```

---

## 相关文档

- 设计文档：`docs/design/modules/63_统一应用运行时.md`
- CLI 总索引：`docs/CLI_COMMANDS_REFERENCE.md`
