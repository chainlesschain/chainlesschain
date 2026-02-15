# sqlcipher-wrapper

**Source**: `src/main/database/sqlcipher-wrapper.js`

**Generated**: 2026-02-15T10:10:53.427Z

---

## const

```javascript
const
```

* SQLCipher 数据库包装器
 *
 * 提供与 sql.js 兼容的 API，使用 better-sqlite3-multiple-ciphers 实现
 * 支持 AES-256 加密

---

## const SQLCIPHER_CONFIG =

```javascript
const SQLCIPHER_CONFIG =
```

* SQLCipher 配置

---

## class StatementWrapper

```javascript
class StatementWrapper
```

* Statement 包装器类
 * 模拟 sql.js 的 Statement API

---

## bind(params)

```javascript
bind(params)
```

* 绑定参数并执行
   * @param {Array|Object} params - 参数
   * @returns {boolean} 是否有结果

---

## get(...params)

```javascript
get(...params)
```

* 执行并获取单行
   * @param {...any} params - 参数
   * @returns {Array|null}

---

## all(...params)

```javascript
all(...params)
```

* 执行并获取所有行
   * @param {...any} params - 参数
   * @returns {Array}

---

## run(...params)

```javascript
run(...params)
```

* 执行 (INSERT/UPDATE/DELETE)
   * @param {...any} params - 参数
   * @returns {Object} 执行结果

---

## step()

```javascript
step()
```

* 单步执行
   * @returns {boolean}

---

## getColumnNames()

```javascript
getColumnNames()
```

* 获取列名
   * @returns {Array<string>}

---

## getAsObject()

```javascript
getAsObject()
```

* 获取当前行
   * @returns {Array|null}

---

## reset()

```javascript
reset()
```

* 重置语句

---

## free()

```javascript
free()
```

* 释放语句

---

## finalize()

```javascript
finalize()
```

* 完成并释放

---

## class SQLCipherWrapper

```javascript
class SQLCipherWrapper
```

* SQLCipher 数据库包装器类
 * 提供与 sql.js 兼容的 API

---

## open()

```javascript
open()
```

* 打开数据库

---

## _setupEncryption(key)

```javascript
_setupEncryption(key)
```

* 设置数据库加密
   * @param {string} key - 十六进制格式的密钥

---

## prepare(sql)

```javascript
prepare(sql)
```

* 准备 SQL 语句
   * @param {string} sql - SQL 语句
   * @returns {StatementWrapper}

---

## exec(sql)

```javascript
exec(sql)
```

* 执行 SQL 语句（直接执行，不返回结果）
   * @param {string} sql - SQL 语句

---

## run(sql, params = [])

```javascript
run(sql, params = [])
```

* 执行 SQL 语句（兼容 sql.js API）
   * @param {string} sql - SQL 语句
   * @param {Array} params - 参数
   * @returns {Array} 结果集

---

## export()

```javascript
export()
```

* 导出数据库到 Buffer
   * @returns {Buffer}

---

## getHandle()

```javascript
getHandle()
```

* 获取原始数据库对象
   * @returns {Database}

---

## close()

```javascript
close()
```

* 关闭数据库

---

## rekey(newKey)

```javascript
rekey(newKey)
```

* 重新设置密钥
   * @param {string} newKey - 新密钥（十六进制）

---

## removeEncryption()

```javascript
removeEncryption()
```

* 移除加密

---

## backup(backupPath)

```javascript
backup(backupPath)
```

* 创建备份
   * @param {string} backupPath - 备份文件路径

---

## function createEncryptedDatabase(dbPath, key, options =

```javascript
function createEncryptedDatabase(dbPath, key, options =
```

* 创建加密数据库
 * @param {string} dbPath - 数据库路径
 * @param {string} key - 加密密钥（十六进制）
 * @param {Object} options - 其他选项
 * @returns {SQLCipherWrapper}

---

## function createUnencryptedDatabase(dbPath, options =

```javascript
function createUnencryptedDatabase(dbPath, options =
```

* 创建未加密数据库
 * @param {string} dbPath - 数据库路径
 * @param {Object} options - 其他选项
 * @returns {SQLCipherWrapper}

---

