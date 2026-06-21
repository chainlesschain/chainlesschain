# 用户管理API

用户管理API提供用户账号的创建、查询、编辑、权限分配和状态管理功能。

## 接口列表

| 接口                  | 方法   | 路径                             | 说明         |
| --------------------- | ------ | -------------------------------- | ------------ |
| [创建用户](#创建用户) | POST   | `/api/users`                     | 创建新用户   |
| [用户列表](#用户列表) | GET    | `/api/users`                     | 分页查询用户 |
| [用户详情](#用户详情) | GET    | `/api/users/{id}`                | 获取用户详情 |
| [更新用户](#更新用户) | PUT    | `/api/users/{id}`                | 更新用户信息 |
| [锁定用户](#锁定用户) | POST   | `/api/users/{id}/lock`           | 锁定用户账号 |
| [解锁用户](#解锁用户) | POST   | `/api/users/{id}/unlock`         | 解锁用户账号 |
| [删除用户](#删除用户) | DELETE | `/api/users/{id}`                | 删除用户     |
| [重置密码](#重置密码) | POST   | `/api/users/{id}/reset-password` | 重置用户密码 |

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

| 参数        | 类型   | 必填 | 说明                                |
| ----------- | ------ | ---- | ----------------------------------- |
| username    | string | 是   | 用户名（唯一）                      |
| password    | string | 是   | 密码（至少8位，含大小写和特殊字符） |
| displayName | string | 是   | 显示名称                            |
| email       | string | 否   | 邮箱地址                            |
| phone       | string | 否   | 手机号码                            |
| role        | string | 是   | 角色：ADMIN/DEALER/USER             |

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

| 参数     | 类型   | 必填 | 说明                               |
| -------- | ------ | ---- | ---------------------------------- |
| role     | string | 否   | 按角色过滤：ADMIN/DEALER/USER      |
| status   | string | 否   | 按状态过滤：ACTIVE/LOCKED/DISABLED |
| keyword  | string | 否   | 搜索用户名或显示名称               |
| page     | number | 否   | 页码，默认1                        |
| pageSize | number | 否   | 每页条数，默认20                   |

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

| 角色     | 代码   | 权限范围                     |
| -------- | ------ | ---------------------------- |
| 管理员   | ADMIN  | 所有功能                     |
| 经销商   | DEALER | 设备管理、备份恢复、查看日志 |
| 普通用户 | USER   | 查看设备、查看备份           |

## 错误码

| 错误码 | 说明               |
| ------ | ------------------ |
| 8001   | 用户名已存在       |
| 8002   | 用户不存在         |
| 8003   | 密码强度不足       |
| 8004   | 不能删除管理员账号 |
| 8005   | 用户已被锁定       |
| 8006   | 邮箱格式无效       |
| 8007   | 权限不足           |

## 附录：规范章节补全（v5.0.3.108）

> 为对齐项目用户文档标准结构，下列章节补齐若干未在正文中单独列出的视角。已在正文覆盖的章节在此段仅作简述并标注 `见上文` 指引。

### 1. 概述

见正文「接口列表」。用户管理 API 提供用户账号的创建 / 查询 / 编辑 / 锁定解锁 / 删除 / 重置密码与角色权限管理，基于 REST + JWT。

### 2. 核心特性

- 8 接口：创建 / 列表 / 详情 / 更新 / 锁定 / 解锁 / 删除 / 重置密码
- 三角色 RBAC（ADMIN / DEALER / USER）
- 用户名唯一 + 密码强度校验
- 锁定即时失效会话

### 3. 系统架构

```
客户端 ──Bearer JWT──► REST /api/users[/{id}[/lock|/unlock|/reset-password]]
                          ▼
              后端（Spring Boot + Spring Security）
                          ▼
              MySQL（users：角色 / 状态 / 哈希密码）
```

### 4. 系统定位

厂家管理系统的**账号与权限接口**，是 [用户管理](/manufacturer/user-management) / [权限管理](/manufacturer/permissions) 功能页的 API 侧。

### 5. 核心功能

见正文「接口列表」：`POST/GET /api/users`、`GET/PUT /{id}`、`POST /{id}/lock`、`POST /{id}/unlock`、`DELETE /{id}`、`POST /{id}/reset-password`。角色见正文「角色说明」。

### 6. 技术架构

Spring Boot + Spring Security；账号存 `users`；密码哈希存储；统一响应 `{code, message, data}`；RBAC 逐请求鉴权。

### 7. 系统特点

- 用户名创建后不可改
- 删除受保护（最后管理员 / 自己）
- 重置后临时密码首登强制改

### 8. 应用场景

经销商账号批量开通自动化、HR 系统对接离职锁定、权限审计集成。

### 9. 竞品对比

| 维度            | 本 API         | 共享账号 |
| --------------- | -------------- | -------- |
| 一人一号 + 角色 | ✅             | ❌       |
| 状态管理        | ✅             | ❌       |
| 审计            | ✅ device_logs | ❌       |

### 10. 配置参考

Base URL：`http://localhost:8080/api`（生产 `https://api.chainlesschain.com/api`）；`Authorization: Bearer <token>`；角色枚举 ADMIN / DEALER / USER。

### 11. 性能指标

用户接口毫秒级；列表分页查询；修改类接口限流 30 次/分钟；登录相关 5 次/分钟。

### 12. 测试覆盖

用户名唯一 / 密码强度、状态流转、删除保护、角色权限矩阵由后端集成测试覆盖；端点契约由 Swagger 描述。

### 13. 安全考虑

- 用户管理需 ADMIN 权限 + JWT
- 删除需二次确认（功能页）；建议停用而非删除
- 密码哈希存储；重置后强制改
- 错误码 8001–8007 + HTTP 401/403/429

### 14. 故障排除

| 现象         | 错误码 | 处理               |
| ------------ | ------ | ------------------ |
| 用户名已存在 | 8001   | 换用户名           |
| 用户不存在   | 8002   | 核对用户 ID        |
| 密码强度不足 | 8003   | 满足复杂度要求     |
| 不能删管理员 | 8004   | 保留至少一个管理员 |
| 用户已锁定   | 8005   | 先解锁             |
| 邮箱格式无效 | 8006   | 校正邮箱           |
| 权限不足     | 8007   | 需 ADMIN           |

### 15. 关键文件

| 资源          | 说明                                        |
| ------------- | ------------------------------------------- |
| `users` 表    | 账号 / 角色 / 状态                          |
| `/api/users*` | 用户管理 REST API（8 接口）                 |
| Swagger UI    | `http://localhost:8080/api/swagger-ui.html` |

### 16. 使用示例

见正文各端点请求示例。重置密码：`POST /api/users/{id}/reset-password`。

### 17. 相关文档

- [用户管理（功能页）](/manufacturer/user-management)
- [权限管理（功能页）](/manufacturer/permissions)
- [认证授权](/api/authentication)
