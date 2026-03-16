# 数据备份API

数据备份API提供设备数据的加密备份、查询和恢复功能。

## 接口列表

| 接口 | 方法 | 路径 | 说明 |
|------|------|------|------|
| [创建备份](#创建备份) | POST | `/api/backups` | 创建数据备份 |
| [备份列表](#备份列表) | GET | `/api/backups` | 查询备份列表 |
| [备份详情](#备份详情) | GET | `/api/backups/{id}` | 获取备份详情 |
| [恢复备份](#恢复备份) | POST | `/api/backups/{id}/restore` | 恢复数据到设备 |
| [删除备份](#删除备份) | DELETE | `/api/backups/{id}` | 删除备份 |
| [备份统计](#备份统计) | GET | `/api/backups/stats` | 备份统计信息 |

---

## 创建备份

为指定设备创建加密数据备份。

### 请求

```http
POST /api/backups
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体**:

```json
{
  "deviceId": "DEV-1701589200123",
  "type": "FULL",
  "encryptionPassword": "backup-password-123",
  "expiresInDays": 730,
  "description": "设备升级前完整备份"
}
```

**参数说明**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| deviceId | string | 是 | 设备ID |
| type | string | 否 | 备份类型：FULL（完整）/INCREMENTAL（增量），默认FULL |
| encryptionPassword | string | 是 | 加密密码（AES-256-GCM） |
| expiresInDays | number | 否 | 有效期天数，默认730（2年） |
| description | string | 否 | 备份说明 |

### 响应

**成功响应** (200):

```json
{
  "code": 200,
  "message": "备份创建成功",
  "data": {
    "backupId": "bak-1701589200123",
    "deviceId": "DEV-1701589200123",
    "type": "FULL",
    "status": "COMPLETED",
    "size": 15728640,
    "encrypted": true,
    "expiresAt": "2026-12-02T10:30:00Z",
    "createdAt": "2024-12-02T10:30:00Z"
  }
}
```

---

## 备份列表

分页查询备份记录。

### 请求

```http
GET /api/backups?deviceId=DEV-1701589200123&page=1&pageSize=20
Authorization: Bearer <token>
```

**查询参数**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| deviceId | string | 否 | 按设备ID过滤 |
| type | string | 否 | 按备份类型过滤 |
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
        "backupId": "bak-1701589200123",
        "deviceId": "DEV-1701589200123",
        "type": "FULL",
        "status": "COMPLETED",
        "size": 15728640,
        "encrypted": true,
        "expiresAt": "2026-12-02T10:30:00Z",
        "createdAt": "2024-12-02T10:30:00Z"
      }
    ],
    "total": 5,
    "page": 1,
    "pageSize": 20
  }
}
```

---

## 备份详情

获取指定备份的详细信息。

### 请求

```http
GET /api/backups/{id}
Authorization: Bearer <token>
```

### 响应

**成功响应** (200):

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "backupId": "bak-1701589200123",
    "deviceId": "DEV-1701589200123",
    "type": "FULL",
    "status": "COMPLETED",
    "size": 15728640,
    "encrypted": true,
    "description": "设备升级前完整备份",
    "expiresAt": "2026-12-02T10:30:00Z",
    "createdAt": "2024-12-02T10:30:00Z",
    "contents": {
      "notes": 42,
      "conversations": 15,
      "settings": true,
      "keys": true
    }
  }
}
```

---

## 恢复备份

将备份数据恢复到指定设备。需要提供备份加密密码进行验证。

### 请求

```http
POST /api/backups/{id}/restore
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体**:

```json
{
  "targetDeviceId": "DEV-1701589200456",
  "encryptionPassword": "backup-password-123",
  "overwrite": false
}
```

**参数说明**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| targetDeviceId | string | 是 | 目标设备ID |
| encryptionPassword | string | 是 | 备份加密密码 |
| overwrite | boolean | 否 | 是否覆盖目标设备现有数据，默认false |

### 响应

**成功响应** (200):

```json
{
  "code": 200,
  "message": "数据恢复成功",
  "data": {
    "backupId": "bak-1701589200123",
    "targetDeviceId": "DEV-1701589200456",
    "restoredItems": {
      "notes": 42,
      "conversations": 15,
      "settings": true,
      "keys": true
    },
    "completedAt": "2024-12-02T10:35:00Z"
  }
}
```

**错误响应**:

```json
{
  "code": 2003,
  "message": "备份密码验证失败",
  "data": null
}
```

---

## 删除备份

删除指定的备份记录和备份文件。

### 请求

```http
DELETE /api/backups/{id}
Authorization: Bearer <token>
```

### 响应

**成功响应** (200):

```json
{
  "code": 200,
  "message": "备份删除成功",
  "data": null
}
```

---

## 备份统计

获取备份相关的统计数据。

### 请求

```http
GET /api/backups/stats
Authorization: Bearer <token>
```

### 响应

**成功响应** (200):

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "totalBackups": 25,
    "totalSize": 524288000,
    "byType": {
      "FULL": 15,
      "INCREMENTAL": 10
    },
    "expiringSoon": 3,
    "oldestBackup": "2024-06-01T08:00:00Z",
    "latestBackup": "2024-12-02T10:30:00Z"
  }
}
```

---

## 错误码

| 错误码 | 说明 |
|--------|------|
| 2001 | 设备不存在 |
| 2002 | 备份不存在 |
| 2003 | 备份密码验证失败 |
| 2004 | 备份已过期 |
| 2005 | 备份正在进行中，请稍后 |
| 2006 | 存储空间不足 |
| 2007 | 目标设备状态不允许恢复 |
