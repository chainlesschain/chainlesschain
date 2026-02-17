# database-migration

**Source**: `src/main/database/database-migration.js`

**Generated**: 2026-02-17T10:13:18.250Z

---

## const

```javascript
const
```

* 数据库迁移工具
 *
 * 负责从 sql.js 迁移到 SQLCipher
 * 支持数据完整性校验和回滚

---

## const MigrationStatus =

```javascript
const MigrationStatus =
```

* 迁移状态

---

## class DatabaseMigrator

```javascript
class DatabaseMigrator
```

* 数据库迁移器类

---

## async initSqlJs()

```javascript
async initSqlJs()
```

* 初始化 sql.js

---

## needsMigration()

```javascript
needsMigration()
```

* 检查是否需要迁移
   * @returns {boolean}

---

## async createBackup()

```javascript
async createBackup()
```

* 创建备份

---

## getTables(db)

```javascript
getTables(db)
```

* 获取表结构
   * @param {Object} db - 数据库实例
   * @returns {Array} 表列表

---

## getIndexes(db)

```javascript
getIndexes(db)
```

* 获取索引定义
   * @param {Object} db - 数据库实例
   * @returns {Array} 索引列表

---

## getTableData(db, tableName)

```javascript
getTableData(db, tableName)
```

* 获取表数据
   * @param {Object} db - 数据库实例
   * @param {string} tableName - 表名
   * @returns {Array} 数据行

---

## async migrate()

```javascript
async migrate()
```

* 执行迁移

---

## async verifyMigration(sourceDb, targetDb, tables)

```javascript
async verifyMigration(sourceDb, targetDb, tables)
```

* 验证迁移的数据完整性
   * @param {Object} sourceDb - 源数据库
   * @param {Object} targetDb - 目标数据库
   * @param {Array} tables - 表列表

---

## async rollback()

```javascript
async rollback()
```

* 回滚迁移

---

## deleteBackup()

```javascript
deleteBackup()
```

* 删除备份

---

## async function migrateDatabase(options)

```javascript
async function migrateDatabase(options)
```

* 快速迁移函数
 * @param {Object} options - 迁移选项
 * @returns {Promise<Object>} 迁移结果

---

