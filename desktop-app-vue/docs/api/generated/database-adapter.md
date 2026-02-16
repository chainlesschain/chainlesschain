# database-adapter

**Source**: `src/main/database/database-adapter.js`

**Generated**: 2026-02-16T13:44:34.669Z

---

## const

```javascript
const
```

* 数据库适配器
 *
 * 提供统一的接口，自动选择 sql.js 或 SQLCipher
 * 支持平滑迁移和fallback

---

## const DatabaseEngine =

```javascript
const DatabaseEngine =
```

* 数据库引擎类型

---

## class DatabaseAdapter

```javascript
class DatabaseAdapter
```

* 数据库适配器类

---

## isDevelopmentMode()

```javascript
isDevelopmentMode()
```

* 检查是否为开发模式

---

## getDevDefaultPassword()

```javascript
getDevDefaultPassword()
```

* 获取开发模式默认密码

---

## detectEngine()

```javascript
detectEngine()
```

* 检测应该使用哪个引擎
   * @returns {string} 引擎类型

---

## getEncryptedDbPath()

```javascript
getEncryptedDbPath()
```

* 获取加密数据库路径
   * @returns {string}

---

## async initialize()

```javascript
async initialize()
```

* 初始化适配器

---

## async initializeEncryption()

```javascript
async initializeEncryption()
```

* 初始化加密功能

---

## shouldMigrate()

```javascript
shouldMigrate()
```

* 检查是否需要迁移
   * @returns {boolean}

---

## async performMigration()

```javascript
async performMigration()
```

* 执行数据库迁移

---

## async getEncryptionKey()

```javascript
async getEncryptionKey()
```

* 获取加密密钥
   * @returns {Promise<Object>}

---

## async createDatabase()

```javascript
async createDatabase()
```

* 创建数据库实例
   * @returns {Object} 数据库实例（sql.js 或 SQLCipher）

---

## async createSQLCipherDatabase()

```javascript
async createSQLCipherDatabase()
```

* 创建 SQLCipher 数据库

---

## async createSqlJsDatabase()

```javascript
async createSqlJsDatabase()
```

* 创建 sql.js 数据库

---

## saveDatabase(db)

```javascript
saveDatabase(db)
```

* 保存数据库（sql.js 专用）
   * @param {Object} db - 数据库实例

---

## async close()

```javascript
async close()
```

* 关闭数据库适配器

---

## getEngine()

```javascript
getEngine()
```

* 获取当前引擎类型

---

## isEncrypted()

```javascript
isEncrypted()
```

* 是否使用加密

---

## async changePassword(oldPassword, newPassword, db)

```javascript
async changePassword(oldPassword, newPassword, db)
```

* 修改数据库加密密码
   * @param {string} oldPassword - 旧密码
   * @param {string} newPassword - 新密码
   * @param {Object} db - 数据库实例
   * @returns {Promise<Object>} 修改结果

---

## async function createDatabaseAdapter(options)

```javascript
async function createDatabaseAdapter(options)
```

* 创建数据库适配器实例
 * @param {Object} options - 选项
 * @returns {Promise<DatabaseAdapter>}

---

