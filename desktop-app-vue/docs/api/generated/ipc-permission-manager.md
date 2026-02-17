# ipc-permission-manager

**Source**: `src/main/security/ipc-permission-manager.js`

**Generated**: 2026-02-17T10:13:18.196Z

---

## const

```javascript
const
```

* IPC Permission Manager
 *
 * IPC通信权限控制中间件
 * - 基于角色的访问控制 (RBAC)
 * - IP白名单/黑名单
 * - 速率限制 (Rate Limiting)
 * - 审计日志

---

## const PermissionLevel =

```javascript
const PermissionLevel =
```

* 权限级别

---

## const IPC_PERMISSIONS =

```javascript
const IPC_PERMISSIONS =
```

* IPC通道权限配置
 * 定义每个IPC通道所需的权限级别

---

## const RATE_LIMIT_CONFIG =

```javascript
const RATE_LIMIT_CONFIG =
```

* 速率限制配置

---

## async initialize()

```javascript
async initialize()
```

* 初始化权限管理器

---

## setUserPermissionLevel(level)

```javascript
setUserPermissionLevel(level)
```

* 设置用户权限级别

---

## authenticate()

```javascript
authenticate()
```

* 用户认证通过后调用

---

## logout()

```javascript
logout()
```

* 用户登出

---

## checkPermission(channel)

```javascript
checkPermission(channel)
```

* 检查IPC通道权限

---

## getRequiredPermissionLevel(channel)

```javascript
getRequiredPermissionLevel(channel)
```

* 获取通道所需的权限级别

---

## hasPermission(userLevel, requiredLevel)

```javascript
hasPermission(userLevel, requiredLevel)
```

* 检查用户是否有足够的权限

---

## checkRateLimit(channel)

```javascript
checkRateLimit(channel)
```

* 速率限制检查

---

## sanitizeArgs(channel, args)

```javascript
sanitizeArgs(channel, args)
```

* 参数验证和清理

---

## sanitizeObject(obj)

```javascript
sanitizeObject(obj)
```

* 清理对象中的危险内容

---

## middleware(channel, args)

```javascript
middleware(channel, args)
```

* IPC调用中间件 - 在主进程的ipcMain.handle之前调用

---

## addAuditLog(entry)

```javascript
addAuditLog(entry)
```

* 添加审计日志

---

## getAuditLog(limit = 100)

```javascript
getAuditLog(limit = 100)
```

* 获取审计日志

---

## async saveAuditLog()

```javascript
async saveAuditLog()
```

* 保存审计日志到文件

---

## async loadAuditLog()

```javascript
async loadAuditLog()
```

* 加载审计日志

---

## startCleanupTask()

```javascript
startCleanupTask()
```

* 启动定期清理任务

---

## getStatistics()

```javascript
getStatistics()
```

* 获取统计信息

---

## function getIPCPermissionManager()

```javascript
function getIPCPermissionManager()
```

* 获取权限管理器实例

---

