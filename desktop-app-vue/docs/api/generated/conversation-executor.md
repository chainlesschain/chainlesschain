# conversation-executor

**Source**: `src\main\ai-engine\conversation-executor.js`

**Generated**: 2026-01-27T06:44:03.883Z

---

## const

```javascript
const
```

* 文件操作执行器
 * 执行AI解析出的文件操作

---

## async function executeOperations(operations, projectPath, database = null)

```javascript
async function executeOperations(operations, projectPath, database = null)
```

* 执行文件操作列表
 *
 * @param {Array} operations - 文件操作列表
 * @param {string} projectPath - 项目根目录路径
 * @param {Object} database - 数据库实例（用于记录操作日志）
 * @returns {Promise<Array>} 执行结果列表

---

## async function executeOperation(operation, projectPath, database)

```javascript
async function executeOperation(operation, projectPath, database)
```

* 执行单个文件操作
 *
 * @param {Object} operation - 文件操作
 * @param {string} projectPath - 项目根目录
 * @param {Object} database - 数据库实例
 * @returns {Promise<Object>} 执行结果

---

## async function createFile(filePath, content, operation, database)

```javascript
async function createFile(filePath, content, operation, database)
```

* 创建文件
 *
 * @param {string} filePath - 文件绝对路径
 * @param {string} content - 文件内容
 * @param {Object} operation - 操作对象
 * @param {Object} database - 数据库实例
 * @returns {Promise<Object>} 执行结果

---

## async function updateFile(filePath, content, operation, database)

```javascript
async function updateFile(filePath, content, operation, database)
```

* 更新文件
 *
 * @param {string} filePath - 文件绝对路径
 * @param {string} content - 新文件内容
 * @param {Object} operation - 操作对象
 * @param {Object} database - 数据库实例
 * @returns {Promise<Object>} 执行结果

---

## async function deleteFile(filePath, operation, database)

```javascript
async function deleteFile(filePath, operation, database)
```

* 删除文件
 *
 * @param {string} filePath - 文件绝对路径
 * @param {Object} operation - 操作对象
 * @param {Object} database - 数据库实例
 * @returns {Promise<Object>} 执行结果

---

## async function readFile(filePath, operation, database)

```javascript
async function readFile(filePath, operation, database)
```

* 读取文件
 *
 * @param {string} filePath - 文件绝对路径
 * @param {Object} operation - 操作对象
 * @param {Object} database - 数据库实例
 * @returns {Promise<Object>} 执行结果

---

## async function fileExists(filePath)

```javascript
async function fileExists(filePath)
```

* 检查文件是否存在
 *
 * @param {string} filePath - 文件路径
 * @returns {Promise<boolean>}

---

## async function backupFile(filePath)

```javascript
async function backupFile(filePath)
```

* 备份文件
 *
 * @param {string} filePath - 源文件路径
 * @returns {Promise<string>} 备份文件路径

---

## async function logOperation(database, logData)

```javascript
async function logOperation(database, logData)
```

* 记录操作日志到数据库
 *
 * @param {Object} database - 数据库实例
 * @param {Object} logData - 日志数据
 * @returns {Promise<void>}

---

## async function ensureLogTable(database)

```javascript
async function ensureLogTable(database)
```

* 确保日志表存在
 *
 * @param {Object} database - 数据库实例
 * @returns {Promise<void>}

---

