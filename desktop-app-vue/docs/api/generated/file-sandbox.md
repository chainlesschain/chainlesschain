# file-sandbox

**Source**: `src/main/ai-engine/cowork/file-sandbox.js`

**Generated**: 2026-02-22T01:23:36.773Z

---

## const

```javascript
const
```

* FileSandbox - 文件沙箱系统
 *
 * 基于 Claude Cowork 的文件夹权限模型，实现安全的文件访问控制。
 *
 * 核心功能：
 * 1. 文件夹权限管理
 * 2. 路径验证和安全检查
 * 3. 操作审计
 * 4. 敏感文件检测
 *
 * @module ai-engine/cowork/file-sandbox

---

## const Permission =

```javascript
const Permission =
```

* 权限类型

---

## const SENSITIVE_PATTERNS = [

```javascript
const SENSITIVE_PATTERNS = [
```

* 敏感文件模式（默认拒绝访问）

---

## const DANGEROUS_OPERATIONS = [

```javascript
const DANGEROUS_OPERATIONS = [
```

* 危险操作模式

---

## class FileSandbox extends EventEmitter

```javascript
class FileSandbox extends EventEmitter
```

* FileSandbox 类

---

## setDatabase(db)

```javascript
setDatabase(db)
```

* 设置数据库实例
   * @param {Object} db - 数据库实例

---

## async requestAccess(teamId, folderPath, permissions = [Permission.READ], options =

```javascript
async requestAccess(teamId, folderPath, permissions = [Permission.READ], options =
```

* 请求访问权限（弹出授权对话框）
   * @param {string} teamId - 团队 ID
   * @param {string} folderPath - 文件夹路径
   * @param {Array<string>} permissions - 权限列表 ['read', 'write']
   * @param {Object} options - 选项
   * @returns {Promise<boolean>} 是否授权

---

## async grantAccess(teamId, folderPath, permissions = [Permission.READ], options =

```javascript
async grantAccess(teamId, folderPath, permissions = [Permission.READ], options =
```

* 授予访问权限
   * @param {string} teamId - 团队 ID
   * @param {string} folderPath - 文件夹路径
   * @param {Array<string>} permissions - 权限列表
   * @param {Object} options - 选项

---

## async revokeAccess(teamId, folderPath)

```javascript
async revokeAccess(teamId, folderPath)
```

* 撤销访问权限
   * @param {string} teamId - 团队 ID
   * @param {string} folderPath - 文件夹路径

---

## hasPermission(teamId, filePath, permission = Permission.READ)

```javascript
hasPermission(teamId, filePath, permission = Permission.READ)
```

* 检查是否有权限
   * @param {string} teamId - 团队 ID
   * @param {string} filePath - 文件路径
   * @param {string} permission - 权限类型
   * @returns {boolean}

---

## getAllowedPaths(teamId)

```javascript
getAllowedPaths(teamId)
```

* 获取团队的所有允许路径
   * @param {string} teamId - 团队 ID
   * @returns {Array<Object>}

---

## checkPathSafety(filePath)

```javascript
checkPathSafety(filePath)
```

* 检查路径是否安全
   * @param {string} filePath - 文件路径
   * @returns {Object} { safe: boolean, reason?: string }

---

## isSensitivePath(filePath)

```javascript
isSensitivePath(filePath)
```

* 检查是否为敏感路径
   * @param {string} filePath - 文件路径
   * @returns {boolean}

---

## isDangerousOperation(operation)

```javascript
isDangerousOperation(operation)
```

* 检查操作是否危险
   * @param {string} operation - 操作描述
   * @returns {boolean}

---

## async validateAccess(teamId, filePath, permission = Permission.READ)

```javascript
async validateAccess(teamId, filePath, permission = Permission.READ)
```

* 验证文件访问
   * @param {string} teamId - 团队 ID
   * @param {string} filePath - 文件路径
   * @param {string} permission - 权限类型
   * @returns {Promise<Object>} { allowed: boolean, reason?: string }

---

## async readFile(teamId, agentId, filePath, options =

```javascript
async readFile(teamId, agentId, filePath, options =
```

* 安全读取文件
   * @param {string} teamId - 团队 ID
   * @param {string} agentId - 代理 ID
   * @param {string} filePath - 文件路径
   * @param {Object} options - 选项
   * @returns {Promise<string>} 文件内容

---

## async writeFile(teamId, agentId, filePath, content, options =

```javascript
async writeFile(teamId, agentId, filePath, content, options =
```

* 安全写入文件
   * @param {string} teamId - 团队 ID
   * @param {string} agentId - 代理 ID
   * @param {string} filePath - 文件路径
   * @param {string} content - 文件内容
   * @param {Object} options - 选项

---

## async deleteFile(teamId, agentId, filePath)

```javascript
async deleteFile(teamId, agentId, filePath)
```

* 安全删除文件
   * @param {string} teamId - 团队 ID
   * @param {string} agentId - 代理 ID
   * @param {string} filePath - 文件路径

---

## async listDirectory(teamId, agentId, dirPath)

```javascript
async listDirectory(teamId, agentId, dirPath)
```

* 列出目录
   * @param {string} teamId - 团队 ID
   * @param {string} agentId - 代理 ID
   * @param {string} dirPath - 目录路径
   * @returns {Promise<Array>} 文件列表

---

## async _auditOperation(teamId, agentId, operation, resourcePath, success, errorMessage = null)

```javascript
async _auditOperation(teamId, agentId, operation, resourcePath, success, errorMessage = null)
```

* 记录操作审计
   * @private

---

## getAuditLog(filters =

```javascript
getAuditLog(filters =
```

* 获取审计日志
   * @param {Object} filters - 过滤条件
   * @param {number} limitParam - 限制数量
   * @returns {Array}

---

## _log(message, level = 'info')

```javascript
_log(message, level = 'info')
```

* 日志输出
   * @private

---

## async cleanupExpiredPermissions()

```javascript
async cleanupExpiredPermissions()
```

* 清理过期权限

---

## getStats()

```javascript
getStats()
```

* 获取统计信息
   * @returns {Object}

---

## reset()

```javascript
reset()
```

* 重置沙箱

---

## async grantPermission(teamId, folderPath, permissions = ['read'], options =

```javascript
async grantPermission(teamId, folderPath, permissions = ['read'], options =
```

* 授予权限（别名：grantAccess）
   * @param {string} teamId - 团队ID
   * @param {string} folderPath - 文件夹路径
   * @param {Array<string>} permissions - 权限列表
   * @param {object} options - 选项
   * @returns {Promise<object>} 结果

---

## async revokePermission(teamId, folderPath, permissions = [])

```javascript
async revokePermission(teamId, folderPath, permissions = [])
```

* 撤销权限（别名：revokeAccess）
   * @param {string} teamId - 团队ID
   * @param {string} folderPath - 文件夹路径
   * @param {Array<string>} permissions - 权限列表
   * @returns {Promise<void>}

---

## async recordAuditLog(logData)

```javascript
async recordAuditLog(logData)
```

* 记录审计日志（别名：_auditOperation）
   * @param {object} logData - 日志数据
   * @returns {Promise<void>}

---

