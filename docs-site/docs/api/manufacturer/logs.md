# 日志查询API

日志查询API提供系统操作日志的查询和统计功能，用于安全审计和问题排查。

## 接口列表

| 接口                          | 方法 | 路径               | 说明             |
| ----------------------------- | ---- | ------------------ | ---------------- |
| [查询日志列表](#查询日志列表) | GET  | `/api/logs`        | 分页查询操作日志 |
| [日志详情](#日志详情)         | GET  | `/api/logs/{id}`   | 获取日志详情     |
| [日志统计](#日志统计)         | GET  | `/api/logs/stats`  | 日志统计信息     |
| [导出日志](#导出日志)         | POST | `/api/logs/export` | 导出日志到文件   |

---

## 查询日志列表

分页查询系统操作日志，支持多条件过滤。

### 请求

```http
GET /api/logs?page=1&pageSize=20&action=DEVICE_REGISTER&level=INFO
Authorization: Bearer <token>
```

**查询参数**:

| 参数      | 类型   | 必填 | 说明                      |
| --------- | ------ | ---- | ------------------------- |
| page      | number | 否   | 页码，默认1               |
| pageSize  | number | 否   | 每页条数，默认20，最大100 |
| action    | string | 否   | 操作类型过滤              |
| level     | string | 否   | 日志级别：INFO/WARN/ERROR |
| userId    | string | 否   | 操作人ID                  |
| startDate | string | 否   | 开始时间（ISO 8601）      |
| endDate   | string | 否   | 结束时间（ISO 8601）      |
| keyword   | string | 否   | 关键词搜索                |

### 响应

**成功响应** (200):

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "items": [
      {
        "id": "log-1701589200123",
        "action": "DEVICE_REGISTER",
        "level": "INFO",
        "userId": "admin",
        "username": "管理员",
        "description": "注册设备 UK20240001",
        "ipAddress": "192.168.1.100",
        "userAgent": "Mozilla/5.0...",
        "timestamp": "2024-12-02T10:30:00Z"
      }
    ],
    "total": 1580,
    "page": 1,
    "pageSize": 20
  }
}
```

---

## 日志详情

获取单条日志的详细信息，包括请求参数和响应结果。

### 请求

```http
GET /api/logs/{id}
Authorization: Bearer <token>
```

### 响应

**成功响应** (200):

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "id": "log-1701589200123",
    "action": "DEVICE_REGISTER",
    "level": "INFO",
    "userId": "admin",
    "username": "管理员",
    "description": "注册设备 UK20240001",
    "ipAddress": "192.168.1.100",
    "userAgent": "Mozilla/5.0...",
    "requestMethod": "POST",
    "requestPath": "/api/devices/register",
    "requestBody": "{\"deviceType\":\"UKEY\",\"serialNumber\":\"UK20240001\"...}",
    "responseCode": 200,
    "duration": 125,
    "timestamp": "2024-12-02T10:30:00Z"
  }
}
```

---

## 日志统计

获取指定时间范围内的日志统计数据。

### 请求

```http
GET /api/logs/stats?startDate=2024-12-01&endDate=2024-12-31
Authorization: Bearer <token>
```

**查询参数**:

| 参数      | 类型   | 必填 | 说明                 |
| --------- | ------ | ---- | -------------------- |
| startDate | string | 否   | 开始日期，默认近30天 |
| endDate   | string | 否   | 结束日期，默认今天   |

### 响应

**成功响应** (200):

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "totalLogs": 1580,
    "byLevel": {
      "INFO": 1200,
      "WARN": 280,
      "ERROR": 100
    },
    "byAction": {
      "DEVICE_REGISTER": 150,
      "DEVICE_ACTIVATE": 120,
      "USER_LOGIN": 500,
      "BACKUP_CREATE": 80,
      "APP_PUBLISH": 30
    },
    "topUsers": [
      { "userId": "admin", "username": "管理员", "count": 800 },
      { "userId": "dealer01", "username": "经销商A", "count": 350 }
    ],
    "dailyTrend": [
      { "date": "2024-12-01", "count": 52 },
      { "date": "2024-12-02", "count": 68 }
    ]
  }
}
```

---

## 导出日志

将日志导出为CSV或Excel文件。

### 请求

```http
POST /api/logs/export
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体**:

```json
{
  "format": "csv",
  "startDate": "2024-12-01",
  "endDate": "2024-12-31",
  "action": "DEVICE_REGISTER",
  "level": "INFO"
}
```

**参数说明**:

| 参数      | 类型   | 必填 | 说明                        |
| --------- | ------ | ---- | --------------------------- |
| format    | string | 否   | 导出格式：csv/xlsx，默认csv |
| startDate | string | 否   | 开始日期                    |
| endDate   | string | 否   | 结束日期                    |
| action    | string | 否   | 操作类型过滤                |
| level     | string | 否   | 日志级别过滤                |

### 响应

成功时返回文件下载：

```http
HTTP/1.1 200 OK
Content-Type: text/csv; charset=utf-8
Content-Disposition: attachment; filename="logs-2024-12.csv"
```

---

## 操作类型列表

| 操作类型          | 说明     |
| ----------------- | -------- |
| USER_LOGIN        | 用户登录 |
| USER_LOGOUT       | 用户登出 |
| USER_CREATE       | 创建用户 |
| USER_UPDATE       | 更新用户 |
| DEVICE_REGISTER   | 设备注册 |
| DEVICE_ACTIVATE   | 设备激活 |
| DEVICE_LOCK       | 设备锁定 |
| DEVICE_UNLOCK     | 设备解锁 |
| DEVICE_DEACTIVATE | 设备注销 |
| APP_CREATE        | 创建版本 |
| APP_PUBLISH       | 发布版本 |
| BACKUP_CREATE     | 创建备份 |
| BACKUP_RESTORE    | 恢复备份 |
| PERMISSION_CHANGE | 权限变更 |

## 错误码

| 错误码 | 说明                         |
| ------ | ---------------------------- |
| 7001   | 日志不存在                   |
| 7002   | 日期范围无效                 |
| 7003   | 导出数据量过大（最大10万条） |
| 7004   | 不支持的导出格式             |

## 附录：规范章节补全（v5.0.3.108）

> 为对齐项目用户文档标准结构，下列章节补齐若干未在正文中单独列出的视角。已在正文覆盖的章节在此段仅作简述并标注 `见上文` 指引。

### 1. 概述

见正文「接口列表」。日志查询 API 提供操作日志的分页查询 / 详情 / 统计 / 导出，基于 REST + JWT，用于安全审计与问题排查。

### 2. 核心特性

- 4 接口：查询列表 / 详情 / 统计 / 导出
- 多维过滤（操作类型 / 级别 / 操作人 / 时间 / 关键词）
- 统计聚合（按级别 / 类型 / 活跃用户 / 每日趋势）
- 导出 CSV / xlsx（≤10 万条）

### 3. 系统架构

```
客户端 ──Bearer JWT──► REST /api/logs[/{id}|/stats|/export]
                          ▼
              后端（Spring Boot 3.2.1 + MyBatis Plus）
                          ▼
              MySQL（device_logs）
```

### 4. 系统定位

厂家管理系统的**审计日志只读查询接口**，是 [操作日志](/manufacturer/operation-logs) 功能页的 API 侧。

### 5. 核心功能

见正文「接口列表」：`GET /api/logs`（分页）、`GET /api/logs/{id}`（详情）、`GET /api/logs/stats`（统计）、`POST /api/logs/export`（导出）。操作类型枚举见正文「操作类型列表」。

### 6. 技术架构

Spring Boot REST + JWT 鉴权；统一响应 `{code, message, data}`；分页 `page/pageSize`（≤100）；时间 ISO 8601。

### 7. 系统特点

- 日志只读（不可改 / 删）
- 多维过滤 + 聚合统计
- 导出限 10 万条 / 次

### 8. 应用场景

第三方审计 / SIEM 系统拉取日志、合规导出归档、运营监控集成。

### 9. 竞品对比

| 维度            | 本 API        | 直连数据库查日志 |
| --------------- | ------------- | ---------------- |
| 鉴权 / 权限     | ✅ JWT + RBAC | ❌               |
| 统一分页 / 过滤 | ✅            | ⚠️ 手写 SQL      |
| 统计聚合        | ✅ 内置       | ⚠️               |

### 10. 配置参考

Base URL：开发 `http://localhost:8080/api`、生产 `https://api.chainlesschain.com/api`；请求头 `Authorization: Bearer <token>`；分页 `pageSize` 最大 100。

### 11. 性能指标

查询接口限流 100 次/分钟；导出 ≤10 万条；分页 + 时间 / 级别索引；超限返回 `429`（含 `X-RateLimit-*` 头）。

### 12. 测试覆盖

端点契约由 Swagger / OpenAPI 描述；过滤 / 分页 / 统计 / 导出限制由后端集成测试覆盖。

### 13. 安全考虑

- 所有接口需 JWT；RBAC（ADMIN 全量、DEALER 仅查看）
- 导出文件可能含敏感信息——注意外发安全
- 错误码 7001–7004 + HTTP 401/403/429

### 14. 故障排除

| 现象         | 错误码 / 状态       | 处理                           |
| ------------ | ------------------- | ------------------------------ |
| 日志不存在   | 7001                | 核对日志 ID                    |
| 日期范围无效 | 7002                | 用 ISO 8601 且 start ≤ end     |
| 导出失败     | 7003 / 7004         | 缩小范围 ≤10 万条；用 csv/xlsx |
| 401 / 403    | Token 过期 / 无权限 | 刷新 Token / 确认角色          |

### 15. 关键文件

| 资源             | 说明                                        |
| ---------------- | ------------------------------------------- |
| `device_logs` 表 | 日志数据源                                  |
| `/api/logs*`     | 日志查询 REST API（4 接口）                 |
| Swagger UI       | `http://localhost:8080/api/swagger-ui.html` |

### 16. 使用示例

见正文各端点 `curl` / 请求示例。统计：`GET /api/logs/stats?startDate=2024-12-01&endDate=2024-12-31`。

### 17. 相关文档

- [操作日志（功能页）](/manufacturer/operation-logs)
- [API 简介](/api/introduction)
- [认证授权](/api/authentication)
