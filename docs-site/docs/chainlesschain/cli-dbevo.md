# 数据库演进框架 (dbevo)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## 核心特性

- **版本化迁移**: 注册、验证、执行 up/down 迁移，支持回滚和历史追踪
- **查询日志分析**: 记录查询耗时，自动标记慢查询，统计 top slow 查询
- **索引优化建议**: 基于慢查询启发式分析，生成 CREATE INDEX 建议并追踪应用状态
- **迁移校验**: 检测版本间隙和缺失的 down 迁移

## 概述

ChainlessChain CLI 数据库演进模块 (Phase 80) 是 Desktop 端 MigrationManager + IndexOptimizer 的 CLI 移植。三大功能域: 迁移管理 (注册/执行/回滚/校验)、查询日志 (耗时追踪/慢查询标记)、索引优化 (慢查询分析/建议生成/应用追踪)。

## 命令参考

### dbevo migration-statuses / directions / suggestion-types — 枚举目录

```bash
chainlesschain dbevo migration-statuses [--json]   # success, failed, rolled_back
chainlesschain dbevo directions [--json]            # up, down
chainlesschain dbevo suggestion-types [--json]      # create_index, composite_index, covering_index
```

列出迁移状态、迁移方向和索引建议类型的枚举值。

### dbevo register — 注册迁移版本

```bash
chainlesschain dbevo register 001 -u "CREATE TABLE users (id TEXT PRIMARY KEY)"
chainlesschain dbevo register 002 -u "ALTER TABLE users ADD email TEXT" -d "DROP TABLE users" --description "添加邮箱字段" --json
```

注册迁移版本。`-u` (必填) up SQL，`-d` down SQL (可选，用于回滚)，`--description` 描述。自动计算 checksum。

### dbevo registered — 列出已注册迁移

```bash
chainlesschain dbevo registered
chainlesschain dbevo registered --json
```

显示所有已注册的迁移版本、描述、是否有 down SQL 及 checksum。

### dbevo validate — 校验迁移完整性

```bash
chainlesschain dbevo validate
chainlesschain dbevo validate --json
```

检测版本间隙 (gap) 和缺失的 down 迁移 (missing_down)。

### dbevo status — 迁移状态概览

```bash
chainlesschain dbevo status
chainlesschain dbevo status --json
```

显示当前版本、已注册数、已执行数、待执行数及待执行版本列表。

### dbevo up — 执行迁移

```bash
chainlesschain dbevo up
chainlesschain dbevo up -t 003 --json
```

向上执行待定迁移。`-t` 指定目标版本 (只执行到该版本)。

### dbevo down — 回滚迁移

```bash
chainlesschain dbevo down
chainlesschain dbevo down -t 001 --json
```

向下回滚迁移。`-t` 指定回滚到的目标版本。需要对应版本有 down SQL。

### dbevo history — 迁移历史

```bash
chainlesschain dbevo history
chainlesschain dbevo history --limit 20 --json
```

显示迁移执行历史: 方向 (UP/DOWN)、版本、状态、耗时和执行时间。

### dbevo query-log — 记录查询日志

```bash
chainlesschain dbevo query-log "SELECT * FROM users" 45
chainlesschain dbevo query-log "SELECT * FROM notes WHERE tag = ?" 230 -s "note-service" -p '["work"]' --json
```

记录一条查询及其执行耗时 (毫秒)。`-s` 查询来源，`-p` 参数 JSON。超过慢查询阈值会标记为 SLOW。

### dbevo query-stats — 查询统计

```bash
chainlesschain dbevo query-stats
chainlesschain dbevo query-stats --json
```

显示查询总数、慢查询数、当前阈值、平均/最大耗时及 top 5 慢查询。

### dbevo slow-threshold — 设置慢查询阈值

```bash
chainlesschain dbevo slow-threshold 200
chainlesschain dbevo slow-threshold 50 --json
```

设置慢查询阈值 (毫秒)，默认 100ms。

### dbevo query-clear — 清空查询日志

```bash
chainlesschain dbevo query-clear
chainlesschain dbevo query-clear --json
```

清空所有查询日志记录。

### dbevo analyze — 分析慢查询

```bash
chainlesschain dbevo analyze
chainlesschain dbevo analyze --min-count 3 --json
```

分析慢查询并生成索引建议。`--min-count` 指定生成建议所需的最少查询次数。

### dbevo suggestions — 列出索引建议

```bash
chainlesschain dbevo suggestions
chainlesschain dbevo suggestions -a --json   # 仅已应用
chainlesschain dbevo suggestions -p --json   # 仅待应用
```

列出索引建议: 状态、表名、列名、建议类型、关联查询数。

### dbevo suggestion-show — 查看建议详情

```bash
chainlesschain dbevo suggestion-show <suggestion-id>
chainlesschain dbevo suggestion-show <suggestion-id> --json
```

显示建议详情: 表名、列名、类型、预估改善百分比、关联查询数、是否已应用。

### dbevo apply — 应用索引建议

```bash
chainlesschain dbevo apply <suggestion-id>
chainlesschain dbevo apply <suggestion-id> --json
```

应用一条索引建议，执行生成的 CREATE INDEX SQL。

### dbevo stats — 统计信息

```bash
chainlesschain dbevo stats
chainlesschain dbevo stats --json
```

显示汇总统计: 已注册/已执行/待执行迁移数及当前版本、查询日志总数/慢查询数/阈值、建议总数/待应用/已应用。

## 数据存储

所有数据持久化到 SQLite (`_migrations` / `_query_log` / `_index_suggestions` 三张表)，首次执行子命令时自动建表。

## 相关文档

- 设计文档: `docs/design/modules/45_数据库演进与迁移框架.md`
- 管理器: `packages/cli/src/lib/dbevo.js`
- 命令: `packages/cli/src/commands/dbevo.js`
