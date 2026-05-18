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

## 系统架构

```
┌─────────────────────────────────────────────────────────┐
│             chainlesschain dbevo (Phase 80)              │
├─────────────────────────────────────────────────────────┤
│  Migration Mgr        │  Query Log       │  Index Opt   │
│  register / validate  │  log + slow-tag  │  analyze +   │
│  up / down / history  │  + stats         │  suggest +   │
│                       │                  │  apply       │
├─────────────────────────────────────────────────────────┤
│  SQLite:                                                 │
│  _migrations (version, up, down, checksum, status)       │
│  _query_log (sql, duration_ms, is_slow, source)          │
│  _index_suggestions (table, columns, type, applied)      │
└─────────────────────────────────────────────────────────┘
```

数据流：`register` → `up` 标记 applied → `query-log` 持续写入 → `analyze` 扫描
慢查询生成 `_index_suggestions` → `apply <id>` 执行 `CREATE INDEX`。

## 配置参考

| 配置项                     | 含义                     | 默认       |
| -------------------------- | ------------------------ | ---------- |
| `slow_query_threshold_ms`  | 慢查询阈值               | 100 ms     |
| `min_count_for_suggestion` | 生成建议的最少命中次数   | 3          |
| 迁移状态                   | success / failed / rolled_back |        |
| 迁移方向                   | up / down                |            |
| 建议类型                   | create_index / composite_index / covering_index | |

调整阈值：`chainlesschain dbevo slow-threshold 50`。

## 性能指标

| 操作                          | 典型耗时         |
| ----------------------------- | ---------------- |
| register（含 checksum）       | < 10 ms          |
| up / down 单个版本            | 依赖 SQL 复杂度  |
| query-log 写入                | < 2 ms           |
| analyze（1000 条慢查询）      | < 100 ms         |
| apply (`CREATE INDEX`)        | 依赖表大小       |
| history 查询（默认 limit 20） | < 5 ms           |

## 测试覆盖率

```
__tests__/unit/dbevo.test.js — 80 tests (1078 lines)
```

覆盖：register/validate（gap、missing_down）、up/down 顺序、回滚、
query-log 慢查询标记、analyze 生成建议、apply 幂等、并发执行保护、
checksum 一致性校验。
V2 surface 见 `dbevo_v2_phase80_cli.md`（80 V2 tests）。

## 安全考虑

1. **checksum 防篡改** — 每个 `register` 自动计算 SQL 内容 hash，校验时比对防止历史迁移被改写
2. **down 缺失检测** — `validate` 会标记缺少 `down` 的版本，生产环境建议所有迁移可回滚
3. **参数化 SQL** — `query-log` 支持 `-p` 参数 JSON，避免 SQL 注入污染日志
4. **apply 二次确认** — `apply <suggestion-id>` 执行 `CREATE INDEX`，生产环境建议先 `suggestion-show` 确认
5. **gap 检测** — `validate` 检测版本号跳跃，防止分支迁移被误合入

## 故障排查

**Q: `up` 报 "migration X failed"?**

1. 查看 `history` 的 error 字段
2. 使用 `down` 回滚到前一版本
3. 修复 SQL 后重新 `register`（注意 checksum 变更）

**Q: `analyze` 没有生成建议?**

1. 确认至少有 `--min-count` 次慢查询命中同一模式（默认 3）
2. 检查当前 `slow-threshold`——阈值过高可能过滤掉慢查询
3. `query-stats` 看当前 top 5 慢查询是否符合预期

**Q: `apply` 后查询没变快?**

1. SQLite 需 `ANALYZE` 更新统计信息才会使用新索引
2. 检查实际执行计划（`EXPLAIN QUERY PLAN`）
3. 复合索引列顺序很关键——可能需要手写 `CREATE INDEX` 而非 `apply` 建议

## 关键文件

- `packages/cli/src/commands/dbevo.js` — Commander 子命令（~672 行）
- `packages/cli/src/lib/dbevo.js` — Migration + QueryLog + IndexOptimizer
- `packages/cli/__tests__/unit/dbevo.test.js` — 单测（80 tests）
- 数据表：`_migrations` / `_query_log` / `_index_suggestions`
- 设计文档：`docs/design/modules/45_数据库演进与迁移框架.md`

## 使用示例

```bash
# 1. 注册迁移 + 校验 + 执行
chainlesschain dbevo register 001 -u "CREATE TABLE users (id TEXT PRIMARY KEY)" -d "DROP TABLE users"
chainlesschain dbevo validate
chainlesschain dbevo up

# 2. 回滚到初始
chainlesschain dbevo down -t 000

# 3. 日常查询日志 → 生成索引建议
chainlesschain dbevo slow-threshold 50
chainlesschain dbevo query-log "SELECT * FROM users WHERE email = ?" 220 -s "auth" -p '["a@b.com"]'
chainlesschain dbevo analyze
chainlesschain dbevo suggestions -p

# 4. 应用建议
sid=$(chainlesschain dbevo suggestions -p --json | jq -r '.[0].id')
chainlesschain dbevo apply $sid

# 5. 全局统计
chainlesschain dbevo stats --json
```

## 相关文档

- 设计文档: `docs/design/modules/45_数据库演进与迁移框架.md`
- 管理器: `packages/cli/src/lib/dbevo.js`
- 命令: `packages/cli/src/commands/dbevo.js`
- [DB Evolution V2 →](/chainlesschain/dbevo_v2_phase80_cli)
- [Perf Tuning →](/chainlesschain/cli-perf)
