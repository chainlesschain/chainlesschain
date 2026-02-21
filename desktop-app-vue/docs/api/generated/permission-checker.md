# permission-checker

**Source**: `src/main/plugins/permission-checker.js`

**Generated**: 2026-02-21T22:04:25.802Z

---

## class PermissionChecker

```javascript
class PermissionChecker
```

* PermissionChecker - 权限检查器
 *
 * 职责：
 * - 运行时权限验证
 * - 权限组管理
 * - 权限审计日志

---

## hasPermission(pluginId, permission)

```javascript
hasPermission(pluginId, permission)
```

* 检查插件是否有权限
   * @param {string} pluginId - 插件ID
   * @param {string} permission - 权限名称
   * @returns {boolean} 是否有权限

---

## hasPermissions(pluginId, permissions)

```javascript
hasPermissions(pluginId, permissions)
```

* 检查多个权限（需要全部满足）
   * @param {string} pluginId - 插件ID
   * @param {string[]} permissions - 权限列表
   * @returns {boolean} 是否全部有权限

---

## hasAnyPermission(pluginId, permissions)

```javascript
hasAnyPermission(pluginId, permissions)
```

* 检查任意权限（至少满足一个）
   * @param {string} pluginId - 插件ID
   * @param {string[]} permissions - 权限列表
   * @returns {boolean} 是否至少有一个权限

---

## requirePermission(pluginId, permission)

```javascript
requirePermission(pluginId, permission)
```

* 要求权限（如果没有则抛出错误）
   * @param {string} pluginId - 插件ID
   * @param {string} permission - 权限名称
   * @throws {Error} 如果没有权限

---

## requirePermissions(pluginId, permissions)

```javascript
requirePermissions(pluginId, permissions)
```

* 要求多个权限
   * @param {string} pluginId - 插件ID
   * @param {string[]} permissions - 权限列表
   * @throws {Error} 如果缺少任何权限

---

## checkPermissionLevel(pluginId, permission, minLevel)

```javascript
checkPermissionLevel(pluginId, permission, minLevel)
```

* 检查权限等级
   * @param {string} pluginId - 插件ID
   * @param {string} permission - 权限名称
   * @param {number} minLevel - 最小权限等级
   * @returns {boolean} 是否满足权限等级

---

## getGrantedPermissions(pluginId)

```javascript
getGrantedPermissions(pluginId)
```

* 获取插件的所有已授予权限
   * @param {string} pluginId - 插件ID
   * @returns {string[]} 已授予的权限列表

---

## getMissingPermissions(pluginId, requiredPermissions)

```javascript
getMissingPermissions(pluginId, requiredPermissions)
```

* 获取插件缺少的权限
   * @param {string} pluginId - 插件ID
   * @param {string[]} requiredPermissions - 需要的权限列表
   * @returns {string[]} 缺少的权限

---

## isValidPermission(permission)

```javascript
isValidPermission(permission)
```

* 验证权限名称格式
   * @param {string} permission - 权限名称
   * @returns {boolean} 是否有效

---

## getPermissionCategory(permission)

```javascript
getPermissionCategory(permission)
```

* 获取权限的分类
   * @param {string} permission - 权限名称
   * @returns {string|null} 分类名称

---

## getPermissionAction(permission)

```javascript
getPermissionAction(permission)
```

* 获取权限的操作
   * @param {string} permission - 权限名称
   * @returns {string|null} 操作名称

---

## hasPermissionGroup(pluginId, group)

```javascript
hasPermissionGroup(pluginId, group)
```

* 检查插件是否有整个权限组
   * @param {string} pluginId - 插件ID
   * @param {string} group - 权限组名称
   * @returns {boolean} 是否有整个权限组

---

## async logPermissionCheck(pluginId, permission, granted, reason = "")

```javascript
async logPermissionCheck(pluginId, permission, granted, reason = "")
```

* 记录权限检查日志（用于审计）
   * @param {string} pluginId - 插件ID
   * @param {string} permission - 权限名称
   * @param {boolean} granted - 是否授予
   * @param {string} reason - 原因

---

## getAllPermissions()

```javascript
getAllPermissions()
```

* 获取所有可用的权限列表
   * @returns {Object} 权限列表（按分类）

---

## getPermissionDescription(permission)

```javascript
getPermissionDescription(permission)
```

* 获取权限描述
   * @param {string} permission - 权限名称
   * @returns {string} 描述

---

