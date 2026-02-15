# permission-dialog-manager

**Source**: `src/main/plugins/permission-dialog-manager.js`

**Generated**: 2026-02-15T07:37:13.802Z

---

## const

```javascript
const
```

* PermissionDialogManager - 权限对话框管理器
 *
 * 职责：
 * - 管理权限请求和响应
 * - 协调主进程和渲染进程之间的权限授权流程
 * - 维护待处理的权限请求队列

---

## const RISK_LEVELS =

```javascript
const RISK_LEVELS =
```

* 权限风险等级定义

---

## const PERMISSION_CATEGORIES =

```javascript
const PERMISSION_CATEGORIES =
```

* 权限分类信息

---

## const PERMISSION_DETAILS =

```javascript
const PERMISSION_DETAILS =
```

* 权限详细信息

---

## setMainWindow(window)

```javascript
setMainWindow(window)
```

* 设置主窗口引用
   * @param {BrowserWindow} window - 主窗口

---

## async requestPermissions(manifest)

```javascript
async requestPermissions(manifest)
```

* 请求用户授权权限
   * @param {Object} manifest - 插件manifest
   * @returns {Promise<Object>} 授权结果 { granted: boolean, permissions: Object }

---

## handlePermissionResponse(requestId, response)

```javascript
handlePermissionResponse(requestId, response)
```

* 处理用户的权限响应
   * @param {string} requestId - 请求ID
   * @param {Object} response - 用户响应
   * @param {boolean} response.granted - 是否授权
   * @param {Object} response.permissions - 各权限的授权状态
   * @param {boolean} response.remember - 是否记住选择

---

## cancelRequest(requestId)

```javascript
cancelRequest(requestId)
```

* 取消权限请求
   * @param {string} requestId - 请求ID

---

## getPermissionDetails(permissions)

```javascript
getPermissionDetails(permissions)
```

* 获取权限详情信息
   * @param {string[]} permissions - 权限列表
   * @returns {Object[]} 权限详情列表

---

## groupPermissionsByCategory(permissionDetails)

```javascript
groupPermissionsByCategory(permissionDetails)
```

* 按分类分组权限
   * @param {Object[]} permissionDetails - 权限详情列表
   * @returns {Object} 按分类分组的权限

---

## getPermissionCategories()

```javascript
getPermissionCategories()
```

* 获取所有权限分类
   * @returns {Object} 权限分类信息

---

## getRiskLevels()

```javascript
getRiskLevels()
```

* 获取风险等级定义
   * @returns {Object} 风险等级信息

---

## cleanup()

```javascript
cleanup()
```

* 清理所有待处理的请求

---

## function getPermissionDialogManager()

```javascript
function getPermissionDialogManager()
```

* 获取PermissionDialogManager单例
 * @returns {PermissionDialogManager}

---

