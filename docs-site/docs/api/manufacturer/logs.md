# 日志查询API

日志查询API提供系统操作日志的查询和统计功能，用于安全审计和问题排查。

## 接口列表

| 接口 | 方法 | 路径 | 说明 |
|------|------|------|------|
| [查询日志列表](#查询日志列表) | GET | `/api/logs` | 分页查询操作日志 |
| [日志详情](#日志详情) | GET | `/api/logs/{id}` | 获取日志详情 |
| [日志统计](#日志统计) | GET | `/api/logs/stats` | 日志统计信息 |
| [导出日志](#导出日志) | POST | `/api/logs/export` | 导出日志到文件 |

---

## 查询日志列表

分页查询系统操作日志，支持多条件过滤。

### 请求

```http
GET /api/logs?page=1&pageSize=20&action=DEVICE_REGISTER&level=INFO
Authorization: Bearer <token>
```

**查询参数**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| page | number | 否 | 页码，默认1 |
| pageSize | number | 否 | 每页条数，默认20，最大100 |
| action | string | 否 | 操作类型过滤 |
| level | string | 否 | 日志级别：INFO/WARN/ERROR |
| userId | string | 否 | 操作人ID |
| startDate | string | 否 | 开始时间（ISO 8601） |
| endDate | string | 否 | 结束时间（ISO 8601） |
| keyword | string | 否 | 关键词搜索 |

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

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| startDate | string | 否 | 开始日期，默认近30天 |
| endDate | string | 否 | 结束日期，默认今天 |

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

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| format | string | 否 | 导出格式：csv/xlsx，默认csv |
| startDate | string | 否 | 开始日期 |
| endDate | string | 否 | 结束日期 |
| action | string | 否 | 操作类型过滤 |
| level | string | 否 | 日志级别过滤 |

### 响应

成功时返回文件下载：

```http
HTTP/1.1 200 OK
Content-Type: text/csv; charset=utf-8
Content-Disposition: attachment; filename="logs-2024-12.csv"
```

---

## 操作类型列表

| 操作类型 | 说明 |
|---------|------|
| USER_LOGIN | 用户登录 |
| USER_LOGOUT | 用户登出 |
| USER_CREATE | 创建用户 |
| USER_UPDATE | 更新用户 |
| DEVICE_REGISTER | 设备注册 |
| DEVICE_ACTIVATE | 设备激活 |
| DEVICE_LOCK | 设备锁定 |
| DEVICE_UNLOCK | 设备解锁 |
| DEVICE_DEACTIVATE | 设备注销 |
| APP_CREATE | 创建版本 |
| APP_PUBLISH | 发布版本 |
| BACKUP_CREATE | 创建备份 |
| BACKUP_RESTORE | 恢复备份 |
| PERMISSION_CHANGE | 权限变更 |

## 错误码

| 错误码 | 说明 |
|--------|------|
| 7001 | 日志不存在 |
| 7002 | 日期范围无效 |
| 7003 | 导出数据量过大（最大10万条） |
| 7004 | 不支持的导出格式 |
