# permission-gate

**Source**: `src/main/remote/permission-gate.js`

**Generated**: 2026-02-15T10:10:53.379Z

---

## const

```javascript
const
```

* 权限验证器 - 基于 DID 的命令授权系统
 *
 * 功能：
 * - DID 签名验证
 * - 时间戳验证（防重放攻击）
 * - 命令权限级别检查（4 级权限体系）
 * - U-Key 二次验证（Level 4 命令）
 * - 设备权限管理
 * - 频率限制（Rate Limiting）
 *
 * 权限级别：
 * Level 1 (Public):  查询状态、读取数据
 * Level 2 (Normal):  AI 对话、文件操作
 * Level 3 (Admin):   系统控制、配置修改
 * Level 4 (Root):    核心功能、安全设置（需要 U-Key）
 *
 * @module remote/permission-gate

---

## const PERMISSION_LEVELS =

```javascript
const PERMISSION_LEVELS =
```

* 权限级别常量

---

## const DEFAULT_COMMAND_PERMISSIONS =

```javascript
const DEFAULT_COMMAND_PERMISSIONS =
```

* 默认命令权限映射

---

## class PermissionGate

```javascript
class PermissionGate
```

* 权限验证器类

---

## async initialize()

```javascript
async initialize()
```

* 初始化权限验证器

---

## async ensureTables()

```javascript
async ensureTables()
```

* 确保数据库表存在

---

## async verify(auth, method)

```javascript
async verify(auth, method)
```

* 验证命令权限（核心方法）

---

## async verifySignature(auth, method)

```javascript
async verifySignature(auth, method)
```

* 验证 DID 签名

---

## async verifyUKey()

```javascript
async verifyUKey()
```

* 验证 U-Key（Level 4 命令）

---

## getCommandPermissionLevel(method)

```javascript
getCommandPermissionLevel(method)
```

* 获取命令权限级别

---

## async getDevicePermissionLevel(did)

```javascript
async getDevicePermissionLevel(did)
```

* 获取设备权限级别

---

## async setDevicePermissionLevel(did, level, options =

```javascript
async setDevicePermissionLevel(did, level, options =
```

* 设置设备权限级别

---

## async checkRateLimit(did, method, permissionLevel)

```javascript
async checkRateLimit(did, method, permissionLevel)
```

* 检查频率限制

---

## async loadDevicePermissions()

```javascript
async loadDevicePermissions()
```

* 加载设备权限

---

## async logAudit(did, method, permissionLevel, granted, reason)

```javascript
async logAudit(did, method, permissionLevel, granted, reason)
```

* 记录审计日志

---

## getAuditLogs(options =

```javascript
getAuditLogs(options =
```

* 获取审计日志

---

## registerCommandPermission(method, level)

```javascript
registerCommandPermission(method, level)
```

* 注册自定义命令权限

---

## startCleanup()

```javascript
startCleanup()
```

* 启动定期清理

---

## cleanup()

```javascript
cleanup()
```

* 清理过期数据

---

## stopCleanup()

```javascript
stopCleanup()
```

* 停止定期清理

---

## updateDeviceActivity(did)

```javascript
updateDeviceActivity(did)
```

* 更新设备最后活动时间

---

## startAutoRevokeCheck()

```javascript
startAutoRevokeCheck()
```

* 启动设备自动撤销检查

---

## checkInactiveDevices()

```javascript
checkInactiveDevices()
```

* 检查并降级不活跃设备

---

## stopAutoRevokeCheck()

```javascript
stopAutoRevokeCheck()
```

* 停止设备自动撤销检查

---

## getStats()

```javascript
getStats()
```

* 获取统计信息

---

## getInactiveDevices(days = 7)

```javascript
getInactiveDevices(days = 7)
```

* 获取不活跃设备列表

---

## async revokeDevice(did, reason = "Manual revocation")

```javascript
async revokeDevice(did, reason = "Manual revocation")
```

* 手动撤销设备权限

---

## shutdown()

```javascript
shutdown()
```

* 停止所有定时器

---

