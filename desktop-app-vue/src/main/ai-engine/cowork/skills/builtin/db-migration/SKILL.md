---
name: db-migration
display-name: DB Migration
description: 数据库迁移技能 - Schema检查、迁移脚本生成、漂移检测、索引优化
version: 1.0.0
category: database
user-invocable: true
tags: [database, migration, schema, sqlite, postgresql, index, seed]
capabilities:
  [
    schema-inspection,
    migration-generation,
    drift-detection,
    index-optimization,
    seed-generation,
  ]
tools:
  - file_reader
  - file_writer
  - code_analyzer
instructions: |
  Use this skill for database schema management tasks. Inspect current schema from
  SQLite (database.js) or PostgreSQL, generate migration scripts with up/down logic,
  detect schema drift between code definitions and actual database state, suggest
  index optimizations, and generate seed/fixture data. Always generate both 'up'
  and 'down' migration scripts for reversibility.
examples:
  - input: "/db-migration --inspect"
    output: "SQLite schema: 15 tables, 120 columns. Key tables: notes(12 cols), chat_conversations(8 cols)..."
  - input: "/db-migration --generate 'add tags column to notes table'"
    output: "Generated migration 004_add_tags_to_notes.sql with ALTER TABLE ADD COLUMN and rollback"
  - input: "/db-migration --drift"
    output: "Drift detected: database.js defines 15 tables, actual DB has 13. Missing: memory_sections, memory_stats"
os: [win32, darwin, linux]
author: ChainlessChain
---

# 数据库迁移技能

## 描述

管理数据库 Schema 演进：检查当前结构、生成迁移脚本、检测代码与数据库的漂移、优化索引、生成测试数据。支持 SQLite 和 PostgreSQL。

## 使用方法

```
/db-migration [操作] [选项]
```

## 操作

### Schema 检查

```
/db-migration --inspect
```

分析当前数据库结构:
- 表列表及列信息
- 主键和外键关系
- 索引和约束
- 数据量统计

### 生成迁移脚本

```
/db-migration --generate "描述变更内容"
```

从自然语言描述生成 SQL 迁移:
- UP 脚本（应用变更）
- DOWN 脚本（回滚变更）
- 数据安全检查（避免数据丢失）
- 向后兼容性验证

### 漂移检测

```
/db-migration --drift
```

对比代码中的 Schema 定义与实际数据库:
- 缺失的表/列
- 类型不匹配
- 索引差异
- 修复建议

### 索引优化

```
/db-migration --optimize-indexes
```

分析查询模式建议索引优化:
- 缺失索引（频繁查询但无索引）
- 冗余索引（重复或未使用）
- 复合索引建议
- EXPLAIN ANALYZE 输出分析

### 生成种子数据

```
/db-migration --seed <table_name>
```

为表生成测试数据:
- 符合约束的随机数据
- 外键关系维护
- 可配置数量

## 支持的数据库

| 数据库 | Schema 来源 | 说明 |
| ------ | ---------- | ---- |
| SQLite | database.js, *.db | ChainlessChain 主数据库 |
| PostgreSQL | Spring Boot entities, DDL | 后端服务数据库 |

## 输出格式

### 迁移脚本

```sql
-- Migration: 004_add_tags_to_notes
-- Created: 2026-02-16
-- Description: Add tags column to notes table

-- UP
ALTER TABLE notes ADD COLUMN tags TEXT DEFAULT '[]';
CREATE INDEX idx_notes_tags ON notes(tags);

-- DOWN
DROP INDEX IF EXISTS idx_notes_tags;
ALTER TABLE notes DROP COLUMN tags;
```

## 示例

检查 Schema:

```
/db-migration --inspect
```

生成迁移:

```
/db-migration --generate "add embedding_model column to embedding_cache"
```

检测漂移:

```
/db-migration --drift
```
