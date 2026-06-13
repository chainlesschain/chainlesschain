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

## 附录：规范章节补全（v5.0.3.108）

> 为对齐项目用户文档标准结构，下列章节补齐若干未在正文中单独列出的视角。已在正文覆盖的章节在此段仅作简述并标注 `见上文` 指引。

### 1. 概述

见正文「接口列表」。数据备份 API 提供设备数据的加密备份创建 / 查询 / 恢复 / 删除 / 统计，基于 REST + JWT。

### 2. 核心特性

- 6 接口：创建 / 列表 / 详情 / 恢复 / 删除 / 统计
- AES-256-GCM 加密备份（密码验证）
- 完整 / 增量备份类型
- 恢复需密码校验，删除需权限

### 3. 系统架构

```
客户端 ──Bearer JWT──► REST /api/backups[/{id}[/restore]|/stats]
                          ▼
              后端（Spring Boot）→ AES-256-GCM 加解密
                          ▼
              MySQL（key_backups）+ 备份文件存储
```

### 4. 系统定位

厂家管理系统的**加密备份 / 恢复接口**，是 [数据备份](/manufacturer/data-backup) / [数据恢复](/manufacturer/data-restore) 功能页的 API 侧。

### 5. 核心功能

见正文「接口列表」：`POST /api/backups`、`GET /api/backups`、`GET /api/backups/{id}`、`POST /api/backups/{id}/restore`、`DELETE /api/backups/{id}`、`GET /api/backups/stats`。

### 6. 技术架构

Spring Boot REST + JWT；加密 AES-256-GCM + PBKDF2；备份元数据存 `key_backups`；统一响应 `{code, message, data}`。

### 7. 系统特点

- 备份 / 恢复全程密码校验，系统不存明文密码
- 增量备份依赖基础完整备份
- 恢复目标设备须为「已激活」

### 8. 应用场景

售后数据迁移自动化、定时备份脚本、容灾恢复集成。

### 9. 竞品对比

| 维度 | 本 API | 手工拷贝 |
|---|---|---|
| 加密 | ✅ AES-256-GCM | ❌ |
| 密码校验恢复 | ✅ | ❌ |
| 增量 / 统计 | ✅ | ❌ |

### 10. 配置参考

Base URL：`http://localhost:8080/api`（生产 `https://api.chainlesschain.com/api`）；`Authorization: Bearer <token>`；备份默认有效期 730 天（功能页可配）。

### 11. 性能指标

备份 / 恢复随数据量线性增长（加解密 I/O 密集）；修改类接口限流 30 次/分钟；建议业务低峰执行。

### 12. 测试覆盖

加解密往返、密码校验、增量依赖、恢复目标状态校验由后端集成测试覆盖；端点契约由 Swagger 描述。

### 13. 安全考虑

- AES-256-GCM + 密码验证；密码遗失则数据不可恢复
- 删除 / 恢复需对应权限（ADMIN / DEALER）+ JWT
- 操作写 `device_logs` 审计
- 错误码 2001–2007 + HTTP 401/403/429

### 14. 故障排除

| 现象 | 错误码 | 处理 |
|---|---|---|
| 设备 / 备份不存在 | 2001 / 2002 | 核对 ID |
| 密码验证失败 | 2003 | 用正确备份密码 |
| 备份已过期 | 2004 | 延长有效期或重建 |
| 备份进行中 | 2005 | 稍后重试 |
| 存储不足 | 2006 | 清理过期备份 |
| 目标设备状态不允许 | 2007 | 确认设备「已激活」 |

### 15. 关键文件

| 资源 | 说明 |
|---|---|
| `key_backups` 表 | 备份元数据 |
| `/api/backups*` | 备份 REST API（6 接口） |
| Swagger UI | `http://localhost:8080/api/swagger-ui.html` |

### 16. 使用示例

见正文各端点请求示例。恢复：`POST /api/backups/{id}/restore`（带密码）。

### 17. 相关文档

- [数据备份（功能页）](/manufacturer/data-backup)
- [数据恢复（功能页）](/manufacturer/data-restore)
- [API 简介](/api/introduction)
