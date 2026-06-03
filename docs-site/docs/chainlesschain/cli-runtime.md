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

## 核心特性

- **插件生命周期** — load / unload / enable / disable，多态迁移
- **semver 推断更新类型** — 从 1.0.0 → 1.1.0 → 2.0.0 自动分 patch / minor / major
- **回滚到上一版本** — 保留历史一版，`rollback` 一键恢复
- **LWW 状态同步** — 最后写入者获胜，便于跨实例状态一致性
- **Profiling** — cpu / memory / io 三种采样，可配置 duration
- **平台信息** — OS / Node / Electron 版本一键查询
- **V2 治理层** — 87 V2 tests 覆盖 4 态 plugin maturity + 5 态 runtime-task lifecycle（`universal_runtime_v2_phase63_cli.md`）

---

## 系统架构

```
┌─────────────────────────────────────────────────────┐
│        chainlesschain runtime (Phase 63)             │
├─────────────────────────────────────────────────────┤
│  Plugin Mgr          │  Hot Update                  │
│  load/unload/status  │  semver → patch/minor/major  │
│                      │  rollback (last version)     │
├─────────────────────────────────────────────────────┤
│  Profiling                                          │
│  cpu / memory / io, duration, samples               │
├─────────────────────────────────────────────────────┤
│  State Sync (LWW)    │  Platform / Health / Metrics │
│  set/get/delete      │  os / node / heap / eloop    │
├─────────────────────────────────────────────────────┤
│  SQLite: runtime_plugins / updates / profiles /     │
│          state_kv                                    │
└─────────────────────────────────────────────────────┘
```

---

## 配置参考

| 配置项            | 含义                    | 默认          |
| ----------------- | ----------------------- | ------------- |
| `maxPlugins`      | 最大插件数              | 20            |
| `profile_duration` | 默认采样时长            | 10s           |
| `profile_types`   | cpu / memory / io       |               |
| `update_types`    | patch / minor / major   | 自动推断      |
| `health_levels`   | healthy / degraded / unhealthy |          |
| V2 caps           | per-owner active-plugin / running-task | 见备忘录 |

查看：`chainlesschain runtime plugin-statuses`、`runtime update-types`、`runtime health-levels`、`runtime profile-types`。

---

## 性能指标

| 操作                        | 典型耗时          |
| --------------------------- | ----------------- |
| plugin-load                 | < 20 ms           |
| plugin-unload               | < 10 ms           |
| hot-update（元数据登记）    | < 15 ms           |
| rollback                    | < 10 ms           |
| state-set / state-get       | < 5 ms            |
| profile（10s cpu 采样）     | ~10000 ms         |
| health 检查                 | < 10 ms           |
| V2 runtime-task dispatch    | < 50 ms           |

---

## 测试覆盖率

```
__tests__/unit/universal-runtime.test.js — 87 tests (896 lines)
```

覆盖：plugin load/unload/status、semver 推断边界（1.0.0→1.0.1 / 1.0.0→1.1.0 / 1.0.0→2.0.0）、
rollback 历史回退、state-set LWW 覆盖 semantics、state-delete 级联、profile 三种类型、
platform / health / metrics 输出格式、configure 合法 key 校验。
V2 surface：87 V2 tests（见 `universal_runtime_v2_phase63_cli.md`）。

---

## 安全考虑

1. **entry 路径校验** — `plugin-load --entry` 应限制在受信目录；CLI 不强制验证路径，调用方负责
2. **hot-update 不丢数据** — 更新前记录上一版本 entry，rollback 可恢复；实际 unload/load 由上层做
3. **state-sync LWW 可能丢失数据** — 并发写时旧值会被覆盖；关键数据应带版本号
4. **profile 开销** — cpu 采样会占用主进程一定资源；生产环境建议限时使用
5. **configure 限幅** — `maxPlugins` 等参数应设合理上限，避免 DoS

---

## 故障排查

**Q: `plugin-load` 报 already loaded?**

1. 用 `plugin-show <id>` 确认当前状态
2. 先 `plugin-unload` 再重新 load
3. 或用 `hot-update` 直接升级

**Q: `rollback` 报 no previous version?**

至少需要一次 `hot-update` 才有前一版本记录。

**Q: `state-get` 返回旧值?**

LWW 保证最近写入者获胜，但跨进程同步可能有延迟；用 `state-list` 比较时间戳。

**Q: `profile` 卡住?**

profile 会阻塞到 `--duration` 结束；建议用短时长（1-5s）先验证。

---

## 关键文件

- `packages/cli/src/commands/runtime.js` — Commander 子命令（~807 行）
- `packages/cli/src/lib/universal-runtime.js` — 插件 + 热更 + 状态 + profile
- `packages/cli/__tests__/unit/universal-runtime.test.js` — 单测（87 tests）
- 数据表：`runtime_plugins` / `runtime_updates` / `runtime_profiles` / `runtime_state`
- 设计文档：`docs/design/modules/63_统一应用运行时.md`

---

## 使用示例

```bash
# 1. 加载插件 + 热更新 + 回滚
chainlesschain runtime plugin-load my-plugin --version 1.0.0 --entry ./plugins/my.js
chainlesschain runtime hot-update my-plugin --version 1.1.0   # minor
chainlesschain runtime hot-update my-plugin --version 2.0.0   # major
chainlesschain runtime rollback my-plugin                     # 回 1.1.0

# 2. 采样与健康
chainlesschain runtime profile --type cpu --duration 5s
chainlesschain runtime health
chainlesschain runtime metrics --json

# 3. LWW 状态同步
chainlesschain runtime state-set theme dark
chainlesschain runtime state-set user-id alice
chainlesschain runtime state-list

# 4. 配置与统计
chainlesschain runtime configure maxPlugins 30
chainlesschain runtime stats --json
```

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
- [Plugin Ecosystem →](/chainlesschain/cli-ecosystem)
- [Perf Tuning →](/chainlesschain/cli-perf)
- [Doctor →](/chainlesschain/cli-doctor)
