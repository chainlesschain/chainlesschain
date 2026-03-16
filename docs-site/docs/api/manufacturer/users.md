# 用户管理API

用户管理API提供用户账号的创建、查询、编辑、权限分配和状态管理功能。

## 接口列表

| 接口 | 方法 | 路径 | 说明 |
|------|------|------|------|
| [创建用户](#创建用户) | POST | `/api/users` | 创建新用户 |
| [用户列表](#用户列表) | GET | `/api/users` | 分页查询用户 |
| [用户详情](#用户详情) | GET | `/api/users/{id}` | 获取用户详情 |
| [更新用户](#更新用户) | PUT | `/api/users/{id}` | 更新用户信息 |
| [锁定用户](#锁定用户) | POST | `/api/users/{id}/lock` | 锁定用户账号 |
| [解锁用户](#解锁用户) | POST | `/api/users/{id}/unlock` | 解锁用户账号 |
| [删除用户](#删除用户) | DELETE | `/api/users/{id}` | 删除用户 |
| [重置密码](#重置密码) | POST | `/api/users/{id}/reset-password` | 重置用户密码 |

---

## 创建用户

创建一个新的系统用户。

### 请求

```http
POST /api/users
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体**:

```json
{
  "username": "dealer01",
  "password": "SecurePass123!",
  "displayName": "经销商A",
  "email": "dealer01@example.com",
  "phone": "13800138001",
  "role": "DEALER"
}
```

**参数说明**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| username | string | 是 | 用户名（唯一） |
| password | string | 是 | 密码（至少8位，含大小写和特殊字符） |
| displayName | string | 是 | 显示名称 |
| email | string | 否 | 邮箱地址 |
| phone | string | 否 | 手机号码 |
| role | string | 是 | 角色：ADMIN/DEALER/USER |

### 响应

**成功响应** (200):

```json
{
  "code": 200,
  "message": "用户创建成功",
  "data": {
    "userId": "user-1701589200123",
    "username": "dealer01",
    "displayName": "经销商A",
    "email": "dealer01@example.com",
    "role": "DEALER",
    "status": "ACTIVE",
    "createdAt": "2024-12-02T10:30:00Z"
  }
}
```

**错误响应**:

```json
{
  "code": 8001,
  "message": "用户名已存在",
  "data": null
}
```

---

## 用户列表

分页查询用户列表，支持按角色和状态过滤。

### 请求

```http
GET /api/users?role=DEALER&status=ACTIVE&page=1&pageSize=20
Authorization: Bearer <token>
```

**查询参数**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| role | string | 否 | 按角色过滤：ADMIN/DEALER/USER |
| status | string | 否 | 按状态过滤：ACTIVE/LOCKED/DISABLED |
| keyword | string | 否 | 搜索用户名或显示名称 |
| page | number | 否 | 页码，默认1 |
| pageSize | number | 否 | 每页条数，默认20 |

### 响应

**成功响应** (200):

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "items": [
      {
        "userId": "user-1701589200123",
        "username": "dealer01",
        "displayName": "经销商A",
        "email": "dealer01@example.com",
        "role": "DEALER",
        "status": "ACTIVE",
        "lastLoginAt": "2024-12-02T09:00:00Z",
        "createdAt": "2024-11-01T08:00:00Z"
      }
    ],
    "total": 25,
    "page": 1,
    "pageSize": 20
  }
}
```

---

## 用户详情

获取指定用户的详细信息。

### 请求

```http
GET /api/users/{id}
Authorization: Bearer <token>
```

### 响应

**成功响应** (200):

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "userId": "user-1701589200123",
    "username": "dealer01",
    "displayName": "经销商A",
    "email": "dealer01@example.com",
    "phone": "13800138001",
    "role": "DEALER",
    "status": "ACTIVE",
    "permissions": ["device:read", "device:register", "backup:create"],
    "lastLoginAt": "2024-12-02T09:00:00Z",
    "loginCount": 42,
    "createdAt": "2024-11-01T08:00:00Z",
    "updatedAt": "2024-12-02T09:00:00Z"
  }
}
```

---

## 更新用户

更新用户基本信息。

### 请求

```http
PUT /api/users/{id}
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体**:

```json
{
  "displayName": "经销商A（华东）",
  "email": "dealer01-new@example.com",
  "phone": "13800138002",
  "role": "DEALER"
}
```

### 响应

**成功响应** (200):

```json
{
  "code": 200,
  "message": "用户信息更新成功",
  "data": {
    "userId": "user-1701589200123",
    "displayName": "经销商A（华东）",
    "updatedAt": "2024-12-02T11:00:00Z"
  }
}
```

---

## 锁定用户

锁定用户账号，禁止登录。

### 请求

```http
POST /api/users/{id}/lock
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体**:

```json
{
  "reason": "多次异常登录"
}
```

### 响应

**成功响应** (200):

```json
{
  "code": 200,
  "message": "用户已锁定",
  "data": {
    "userId": "user-1701589200123",
    "status": "LOCKED",
    "lockedAt": "2024-12-02T10:30:00Z"
  }
}
```

---

## 解锁用户

解锁已锁定的用户账号。

### 请求

```http
POST /api/users/{id}/unlock
Authorization: Bearer <token>
```

### 响应

**成功响应** (200):

```json
{
  "code": 200,
  "message": "用户已解锁",
  "data": {
    "userId": "user-1701589200123",
    "status": "ACTIVE",
    "unlockedAt": "2024-12-02T11:00:00Z"
  }
}
```

---

## 删除用户

删除用户账号。管理员不能删除自己的账号。

### 请求

```http
DELETE /api/users/{id}
Authorization: Bearer <token>
```

### 响应

**成功响应** (200):

```json
{
  "code": 200,
  "message": "用户删除成功",
  "data": null
}
```

---

## 重置密码

管理员重置用户密码。

### 请求

```http
POST /api/users/{id}/reset-password
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体**:

```json
{
  "newPassword": "NewSecurePass456!"
}
```

### 响应

**成功响应** (200):

```json
{
  "code": 200,
  "message": "密码重置成功",
  "data": null
}
```

---

## 角色说明

| 角色 | 代码 | 权限范围 |
|------|------|---------|
| 管理员 | ADMIN | 所有功能 |
| 经销商 | DEALER | 设备管理、备份恢复、查看日志 |
| 普通用户 | USER | 查看设备、查看备份 |

## 错误码

| 错误码 | 说明 |
|--------|------|
| 8001 | 用户名已存在 |
| 8002 | 用户不存在 |
| 8003 | 密码强度不足 |
| 8004 | 不能删除管理员账号 |
| 8005 | 用户已被锁定 |
| 8006 | 邮箱格式无效 |
| 8007 | 权限不足 |
