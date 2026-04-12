# 数据库演进与迁移框架

> **版本: v4.0.0-alpha | 状态: ✅ 生产就绪 | 4 IPC Handlers | 3 数据库表 | 版本化迁移 + 流式查询构建 + 索引优化**

## 概述

数据库演进框架为 SQLite/SQLCipher 提供版本化迁移管理、流式查询构建和自动索引优化三大能力。MigrationManager 支持正向/回滚迁移并记录完整变更历史，QueryBuilder 提供防注入的链式 SQL 构建，IndexOptimizer 基于查询日志自动推荐和创建索引以优化性能。

## 核心特性

- 🔄 **MigrationManager**: 版本化迁移（up/down），原子执行，变更历史追踪
- 🔧 **QueryBuilder**: 流式 SQL 构建，参数化查询，防注入，支持 JOIN/子查询
- 📈 **IndexOptimizer**: 基于查询日志分析慢查询，自动推荐索引，一键创建
- 📋 **查询日志**: 记录所有查询的执行计划和耗时，辅助性能调优

## 系统架构

```
┌─────────────────────────────────────────────────┐
│              应用层 (IPC Handlers)                │
│  migration-status │ run-migration │ index-suggest│
├───────────────────┴───────────────┴─────────────┤
│          Database Evolution Framework            │
├────────────────┬──────────────┬──────────────────┤
│ Migration      │ Query        │ Index            │
│ Manager        │ Builder      │ Optimizer        │
│ (up/down/回滚) │ (链式SQL构建) │ (慢查询分析)    │
├────────────────┴──────────────┴──────────────────┤
│            SQLite / SQLCipher (AES-256)           │
├──────────┬────────────┬──────────────────────────┤
│_migrations│ _query_log │ _index_suggestions       │
└──────────┴────────────┴──────────────────────────┘
```

## 迁移执行流程

```
migrations/
├── 001_create_notes.js         ← up(): CREATE TABLE / down(): DROP TABLE
├── 002_add_tags.js             ← up(): ALTER TABLE  / down(): ALTER TABLE
├── 003_create_embeddings.js
├── 004_add_indexes.js
└── 005_enterprise_tables.js

MigrationManager.migrate()
  │
  ├─ 读取 _migrations 表，获取已执行版本列表
  ├─ 扫描 migrations/ 目录，找出待执行迁移
  ├─ 按版本号升序执行:
  │   ├─ BEGIN TRANSACTION
  │   ├─ 执行 migration.up(db)
  │   ├─ INSERT INTO _migrations (version, name, applied_at)
  │   └─ COMMIT (失败则 ROLLBACK)
  └─ 返回执行结果

MigrationManager.rollback(targetVersion)
  │
  ├─ 获取需回滚的版本列表 (降序)
  ├─ 逐版本执行:
  │   ├─ BEGIN TRANSACTION
  │   ├─ 执行 migration.down(db)
  │   ├─ DELETE FROM _migrations WHERE version = ?
  │   └─ COMMIT
  └─ 返回回滚结果
```

## 查看迁移状态

```javascript
const status = await window.electron.ipcRenderer.invoke("db:migration-status");
// status = {
//   currentVersion: 5,
//   appliedMigrations: [
//     { version: 1, name: "create_notes", appliedAt: "2026-01-15T10:00:00Z", durationMs: 45 },
//     { version: 2, name: "add_tags", appliedAt: "2026-01-15T10:00:01Z", durationMs: 12 },
//     { version: 3, name: "create_embeddings", appliedAt: "2026-02-01T08:30:00Z", durationMs: 78 },
//     { version: 4, name: "add_indexes", appliedAt: "2026-02-15T09:00:00Z", durationMs: 156 },
//     { version: 5, name: "enterprise_tables", appliedAt: "2026-03-01T10:00:00Z", durationMs: 234 },
//   ],
//   pendingMigrations: [],
//   lastApplied: "2026-03-01T10:00:00Z",
// }
```

## 执行迁移

```javascript
const result = await window.electron.ipcRenderer.invoke("db:run-migration", {
  direction: "up", // "up" | "down"
  targetVersion: null, // null = 最新, 或指定版本号
  dryRun: false, // true = 仅预览不执行
});
// result = {
//   success: true,
//   direction: "up",
//   executed: [
//     { version: 6, name: "add_analytics", durationMs: 89 },
//   ],
//   fromVersion: 5,
//   toVersion: 6,
// }
```

## 获取索引建议

```javascript
const suggestions = await window.electron.ipcRenderer.invoke(
  "db:index-suggestions",
);
// suggestions = {
//   analyzed: 1024,
//   slowQueries: 12,
//   suggestions: [
//     {
//       table: "notes",
//       columns: ["created_at", "category"],
//       reason: "频繁出现在 WHERE + ORDER BY，扫描行数 > 10000",
//       estimatedImprovement: "85%",
//       createSQL: "CREATE INDEX idx_notes_created_category ON notes(created_at, category)",
//       autoApply: false,
//     },
//     {
//       table: "embeddings",
//       columns: ["note_id"],
//       reason: "JOIN 查询缺少索引，平均耗时 230ms",
//       estimatedImprovement: "70%",
//       createSQL: "CREATE INDEX idx_embeddings_note_id ON embeddings(note_id)",
//       autoApply: false,
//     },
//   ],
// }
```

## 查看查询统计

```javascript
const stats = await window.electron.ipcRenderer.invoke("db:query-stats");
// stats = {
//   totalQueries: 45632,
//   avgDurationMs: 3.2,
//   slowQueries: 12,
//   slowThresholdMs: 100,
//   topSlowest: [
//     { query: "SELECT * FROM notes WHERE ...", avgMs: 230, count: 45 },
//     { query: "SELECT * FROM embeddings JOIN ...", avgMs: 180, count: 128 },
//   ],
//   tableStats: {
//     notes: { reads: 12000, writes: 3400 },
//     embeddings: { reads: 8900, writes: 1200 },
//   },
// }
```

## 数据库设计

### `_migrations` 表

| 字段        | 类型                | 说明                 |
| ----------- | ------------------- | -------------------- |
| version     | INTEGER PRIMARY KEY | 迁移版本号           |
| name        | TEXT                | 迁移名称             |
| applied_at  | TEXT                | 执行时间 (ISO 8601)  |
| duration_ms | INTEGER             | 执行耗时             |
| checksum    | TEXT                | 迁移文件哈希，防篡改 |

### `_query_log` 表

| 字段           | 类型                | 说明           |
| -------------- | ------------------- | -------------- |
| id             | INTEGER PRIMARY KEY | 自增 ID        |
| query_hash     | TEXT                | 查询模板哈希   |
| query_template | TEXT                | 参数化查询模板 |
| duration_ms    | REAL                | 执行耗时       |
| rows_scanned   | INTEGER             | 扫描行数       |
| rows_returned  | INTEGER             | 返回行数       |
| created_at     | TEXT                | 记录时间       |

### `_index_suggestions` 表

| 字段       | 类型                | 说明                   |
| ---------- | ------------------- | ---------------------- |
| id         | INTEGER PRIMARY KEY | 自增 ID                |
| table_name | TEXT                | 目标表                 |
| columns    | TEXT                | 建议索引列 (JSON 数组) |
| reason     | TEXT                | 建议原因               |
| create_sql | TEXT                | 创建索引 SQL           |
| applied    | INTEGER             | 是否已应用 (0/1)       |
| created_at | TEXT                | 建议时间               |

## QueryBuilder 使用示例

```javascript
const { QueryBuilder } = require("./database/query-builder");

// SELECT 查询
const notes = new QueryBuilder("notes")
  .select("id", "title", "content", "created_at")
  .where("category", "=", "work")
  .where("created_at", ">", "2026-01-01")
  .orderBy("created_at", "DESC")
  .limit(20)
  .offset(0)
  .execute(db);

// JOIN 查询
const notesWithTags = new QueryBuilder("notes")
  .select("notes.id", "notes.title", "tags.name AS tag_name")
  .leftJoin("note_tags", "notes.id", "note_tags.note_id")
  .leftJoin("tags", "note_tags.tag_id", "tags.id")
  .where("notes.category", "=", "work")
  .execute(db);
```

## 配置选项

```json
{
  "databaseEvolution": {
    "migrationsDir": "migrations",
    "autoMigrate": true,
    "queryLog": {
      "enabled": true,
      "slowThresholdMs": 100,
      "retentionDays": 30,
      "maxEntries": 100000
    },
    "indexOptimizer": {
      "enabled": true,
      "analyzeIntervalMs": 3600000,
      "autoApply": false,
      "minQueryCount": 10,
      "minImprovementPercent": 50
    }
  }
}
```

## 故障排查

| 问题 | 可能原因 | 解决方案 |
| --- | --- | --- |
| 迁移执行失败 | SQL 语法错误或表已存在 | 使用 `dryRun: true` 预览变更，检查迁移文件 SQL 语法 |
| 回滚后数据丢失 | down() 方法使用了 DROP TABLE | 回滚前先备份数据库，down() 中尽量用 ALTER 而非 DROP |
| 索引建议不准确 | 查询日志样本不足 | 确保 `minQueryCount` 阈值合理，积累足够查询日志后再分析 |
| 慢查询未被记录 | queryLog 未启用或阈值过高 | 确认 `queryLog.enabled: true`，调低 `slowThresholdMs` |
| 迁移版本冲突 | 多人开发时版本号重复 | 使用时间戳作为版本号前缀，合并前检查版本唯一性 |

## 安全考虑

- **原子执行**: 每个迁移在事务中执行，失败自动回滚，不留半成品状态
- **校验和防篡改**: 迁移文件记录 checksum，执行前校验防止文件被篡改
- **参数化查询**: QueryBuilder 强制使用参数化查询，从根本上防止 SQL 注入
- **只读建议**: IndexOptimizer 默认 `autoApply: false`，需人工确认后才创建索引
- **加密存储**: 底层使用 SQLCipher (AES-256) 加密，迁移数据同样受保护
- **日志脱敏**: 查询日志记录模板而非实际参数值，避免敏感数据泄漏

## 使用示例

### 创建与执行迁移

```javascript
// 创建新迁移文件（自动生成版本号前缀）
// 文件内容需包含 up(db) 和 down(db) 两个方法
// migrations/006_add_user_preferences.js

// 预览待执行的迁移（不实际执行）
const preview = await window.electron.ipcRenderer.invoke('db:run-migration', {
  direction: 'up', targetVersion: null, dryRun: true
});
// preview.executed 列出将要执行的迁移，确认无误后正式执行

// 正式执行所有待迁移
const result = await window.electron.ipcRenderer.invoke('db:run-migration', {
  direction: 'up', targetVersion: null, dryRun: false
});
```

### 回滚迁移

```javascript
// 回滚到指定版本（执行 down() 方法，按版本降序逐个回滚）
const rollback = await window.electron.ipcRenderer.invoke('db:run-migration', {
  direction: 'down', targetVersion: 4, dryRun: false
});
// 回滚前建议先备份数据库文件，down() 中使用 DROP TABLE 会导致数据丢失
```

### 索引优化与查询分析

```javascript
// 获取索引建议（基于查询日志中的慢查询自动分析）
const suggestions = await window.electron.ipcRenderer.invoke('db:index-suggestions');
// 每条建议包含 createSQL 字段，可直接执行

// 查看查询统计，定位性能瓶颈
const stats = await window.electron.ipcRenderer.invoke('db:query-stats');
// topSlowest 列出平均耗时最高的查询，结合 tableStats 的读写比判断优化方向
```

### QueryBuilder 链式查询

```javascript
const { QueryBuilder } = require('./database/query-builder');

// 带分页的条件查询（参数化防注入）
const results = new QueryBuilder('notes')
  .select('id', 'title', 'created_at')
  .where('category', '=', 'work')
  .where('created_at', '>', '2026-01-01')
  .orderBy('created_at', 'DESC')
  .limit(20).offset(40)
  .execute(db);
```

## 关键文件

| 文件 | 职责 |
| --- | --- |
| `desktop-app-vue/src/main/database/migration-manager.js` | 版本化迁移管理（up/down/rollback） |
| `desktop-app-vue/src/main/database/query-builder.js` | 流式 SQL 构建器（链式 API） |
| `desktop-app-vue/src/main/database/index-optimizer.js` | 索引优化器（慢查询分析+自动推荐） |
| `desktop-app-vue/src/main/database.js` | SQLite/SQLCipher 数据库核心 |
| `desktop-app-vue/src/main/ipc/ipc-database.js` | 数据库 IPC Handler |

## 相关文档

- [数据库核心](/chainlesschain/database) — SQLite/SQLCipher 加密数据库
- [性能优化](/chainlesschain/performance) — 应用整体性能调优
- [企业知识图谱](/chainlesschain/enterprise-knowledge-graph) — 基于数据库的知识管理
```
