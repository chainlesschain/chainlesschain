# file-permission-manager

**Source**: `src/main/file/file-permission-manager.js`

**Generated**: 2026-02-16T22:06:51.485Z

---

## const

```javascript
const
```

* 文件权限管理器 - Phase 2
 * 负责文件权限、共享、访问控制等功能

---

## constructor(db, organizationManager)

```javascript
constructor(db, organizationManager)
```

* @param {Object} db - Better-SQLite3数据库实例
   * @param {Object} organizationManager - 组织管理器实例

---

## async grantPermission(permissionData, granterDID)

```javascript
async grantPermission(permissionData, granterDID)
```

* 授予文件权限
   * @param {Object} permissionData - 权限数据
   * @param {string} granterDID - 授权者DID
   * @returns {Object} 权限信息

---

## async revokePermission(file_id, member_did, revokerDID)

```javascript
async revokePermission(file_id, member_did, revokerDID)
```

* 撤销文件权限
   * @param {string} file_id - 文件ID
   * @param {string} member_did - 成员DID
   * @param {string} revokerDID - 撤销者DID
   * @returns {Object} 结果

---

## async checkPermission(fileId, userDID, requiredPermission)

```javascript
async checkPermission(fileId, userDID, requiredPermission)
```

* 检查用户对文件的权限
   * @param {string} fileId - 文件ID
   * @param {string} userDID - 用户DID
   * @param {string} requiredPermission - 需要的权限
   * @returns {boolean} 是否有权限

---

## getPermission(permissionId)

```javascript
getPermission(permissionId)
```

* 获取权限信息
   * @param {string} permissionId - 权限ID
   * @returns {Object} 权限信息

---

## getFilePermissions(fileId)

```javascript
getFilePermissions(fileId)
```

* 获取文件的所有权限
   * @param {string} fileId - 文件ID
   * @returns {Array} 权限列表

---

## getUserPermissions(userDID)

```javascript
getUserPermissions(userDID)
```

* 获取用户的文件权限列表
   * @param {string} userDID - 用户DID
   * @returns {Array} 权限列表

---

## async shareFile(shareData, sharerDID)

```javascript
async shareFile(shareData, sharerDID)
```

* 共享文件
   * @param {Object} shareData - 共享数据
   * @param {string} sharerDID - 分享者DID
   * @returns {Object} 共享信息

---

## async unshareFile(shareId, revokerDID)

```javascript
async unshareFile(shareId, revokerDID)
```

* 取消文件共享
   * @param {string} shareId - 共享ID
   * @param {string} revokerDID - 撤销者DID
   * @returns {Object} 结果

---

## getShare(shareId)

```javascript
getShare(shareId)
```

* 获取共享信息
   * @param {string} shareId - 共享ID
   * @returns {Object} 共享信息

---

## getFileShares(fileId)

```javascript
getFileShares(fileId)
```

* 获取文件的所有共享
   * @param {string} fileId - 文件ID
   * @returns {Array} 共享列表

---

## async getSharedFilesForUser(userDID, orgId = null)

```javascript
async getSharedFilesForUser(userDID, orgId = null)
```

* 获取用户可访问的共享文件
   * @param {string} userDID - 用户DID
   * @param {string} orgId - 组织ID（可选）
   * @returns {Array} 文件列表

---

## cleanupExpiredShares()

```javascript
cleanupExpiredShares()
```

* 清理过期的共享
   * @returns {number} 清理数量

---

## _hasRequiredPermission(grantedPermission, requiredPermission)

```javascript
_hasRequiredPermission(grantedPermission, requiredPermission)
```

* 判断权限等级
   * @private

---

