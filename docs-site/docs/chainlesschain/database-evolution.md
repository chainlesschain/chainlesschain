# 数据库演进与迁移框架

> **版本: v4.0.0-alpha | 状态: ✅ 生产就绪 | 4 IPC Handlers | 3 数据库表 | 版本化迁移 + 流式查询构建 + 索引优化**

ChainlessChain 数据库演进框架为 SQLite/SQLCipher 提供版本化迁移管理、流式查询构建和自动索引优化能力。MigrationManager 支持正向/回滚迁移并记录完整变更历史，QueryBuilder 提供类型安全的链式 SQL 构建，IndexOptimizer 基于查询日志自动推荐和创建索引。

## 核心特性

- 🔄 **MigrationManager**: 版本化迁移（up/down），原子执行，变更历史追踪
- 🔧 **QueryBuilder**: 流式 SQL 构建，参数化查询，防注入，支持 JOIN/子查询
- 📈 **IndexOptimizer**: 基于查询日志分析慢查询，自动推荐索引，一键创建
- 📋 **查询日志**: 记录所有查询的执行计划和耗时，辅助性能调优

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
