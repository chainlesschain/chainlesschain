# 应用版本管理API

应用版本管理API提供多平台APP版本的创建、发布、更新和查询功能。

## 接口列表

| 接口 | 方法 | 路径 | 说明 |
|------|------|------|------|
| [创建版本](#创建版本) | POST | `/api/app-versions` | 创建新的应用版本 |
| [版本列表](#版本列表) | GET | `/api/app-versions` | 分页查询版本列表 |
| [版本详情](#版本详情) | GET | `/api/app-versions/{id}` | 获取版本详情 |
| [更新版本状态](#更新版本状态) | PUT | `/api/app-versions/{id}/status` | 更新版本发布状态 |
| [删除版本](#删除版本) | DELETE | `/api/app-versions/{id}` | 删除草稿版本 |
| [检查更新](#检查更新) | GET | `/api/app-versions/check-update` | 客户端检查更新 |
| [下载统计](#下载统计) | GET | `/api/app-versions/{id}/stats` | 查询下载统计 |

---

## 创建版本

创建一个新的应用版本记录。

### 请求

```http
POST /api/app-versions
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体**:

```json
{
  "appName": "ChainlessChain Desktop",
  "version": "5.0.2",
  "platform": "WINDOWS",
  "releaseNotes": "1. 修复了已知问题\n2. 性能优化",
  "minVersion": "4.0.0",
  "forceUpdate": false
}
```

**参数说明**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| appName | string | 是 | 应用名称 |
| version | string | 是 | 版本号（语义化版本） |
| platform | string | 是 | 平台：WINDOWS/MACOS/LINUX/ANDROID/IOS |
| releaseNotes | string | 否 | 版本说明 |
| minVersion | string | 否 | 最低兼容版本 |
| forceUpdate | boolean | 否 | 是否强制更新，默认false |

### 响应

**成功响应** (200):

```json
{
  "code": 200,
  "message": "版本创建成功",
  "data": {
    "id": "ver-1701589200123",
    "appName": "ChainlessChain Desktop",
    "version": "5.0.2",
    "platform": "WINDOWS",
    "status": "DRAFT",
    "forceUpdate": false,
    "createdAt": "2024-12-02T10:30:00Z"
  }
}
```

---

## 版本列表

分页查询应用版本列表。

### 请求

```http
GET /api/app-versions?platform=WINDOWS&status=PUBLISHED&page=1&pageSize=20
Authorization: Bearer <token>
```

**查询参数**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| platform | string | 否 | 按平台过滤 |
| status | string | 否 | 按状态过滤：DRAFT/TESTING/PUBLISHED/DEPRECATED |
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
        "id": "ver-1701589200123",
        "appName": "ChainlessChain Desktop",
        "version": "5.0.2",
        "platform": "WINDOWS",
        "status": "PUBLISHED",
        "downloads": 1520,
        "forceUpdate": false,
        "publishedAt": "2024-12-03T09:00:00Z"
      }
    ],
    "total": 15,
    "page": 1,
    "pageSize": 20
  }
}
```

---

## 版本详情

获取指定版本的详细信息。

### 请求

```http
GET /api/app-versions/{id}
Authorization: Bearer <token>
```

### 响应

**成功响应** (200):

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "id": "ver-1701589200123",
    "appName": "ChainlessChain Desktop",
    "version": "5.0.2",
    "platform": "WINDOWS",
    "status": "PUBLISHED",
    "releaseNotes": "1. 修复了已知问题\n2. 性能优化",
    "minVersion": "4.0.0",
    "forceUpdate": false,
    "fileUrl": "/files/chainlesschain-5.0.2-win.exe",
    "fileSize": 85600000,
    "checksum": "sha256:abcdef1234567890...",
    "downloads": 1520,
    "createdAt": "2024-12-02T10:30:00Z",
    "publishedAt": "2024-12-03T09:00:00Z"
  }
}
```

---

## 更新版本状态

更新版本的发布状态。

### 请求

```http
PUT /api/app-versions/{id}/status
Authorization: Bearer <token>
Content-Type: application/json
```

**请求体**:

```json
{
  "status": "PUBLISHED"
}
```

**状态流转**:

| 当前状态 | 可转为 | 说明 |
|---------|--------|------|
| DRAFT | TESTING | 提交测试 |
| TESTING | PUBLISHED | 正式发布 |
| TESTING | DRAFT | 退回修改 |
| PUBLISHED | DEPRECATED | 废弃版本 |

### 响应

**成功响应** (200):

```json
{
  "code": 200,
  "message": "版本状态更新成功",
  "data": {
    "id": "ver-1701589200123",
    "status": "PUBLISHED",
    "publishedAt": "2024-12-03T09:00:00Z"
  }
}
```

---

## 删除版本

删除草稿状态的版本。只有DRAFT状态的版本可以删除。

### 请求

```http
DELETE /api/app-versions/{id}
Authorization: Bearer <token>
```

### 响应

**成功响应** (200):

```json
{
  "code": 200,
  "message": "版本删除成功",
  "data": null
}
```

**错误响应**:

```json
{
  "code": 3003,
  "message": "只有草稿状态的版本可以删除",
  "data": null
}
```

---

## 检查更新

客户端检查是否有新版本可用。此接口不需要认证。

### 请求

```http
GET /api/app-versions/check-update?platform=WINDOWS&currentVersion=5.0.1
```

**查询参数**:

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| platform | string | 是 | 客户端平台 |
| currentVersion | string | 是 | 当前版本号 |

### 响应

**有更新** (200):

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "hasUpdate": true,
    "latestVersion": "5.0.2",
    "forceUpdate": false,
    "releaseNotes": "1. 修复了已知问题\n2. 性能优化",
    "downloadUrl": "/files/chainlesschain-5.0.2-win.exe",
    "fileSize": 85600000
  }
}
```

**无更新** (200):

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "hasUpdate": false
  }
}
```

---

## 下载统计

查询指定版本的下载统计数据。

### 请求

```http
GET /api/app-versions/{id}/stats
Authorization: Bearer <token>
```

### 响应

**成功响应** (200):

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "versionId": "ver-1701589200123",
    "totalDownloads": 1520,
    "dailyDownloads": [
      { "date": "2024-12-03", "count": 320 },
      { "date": "2024-12-04", "count": 450 },
      { "date": "2024-12-05", "count": 750 }
    ]
  }
}
```

---

## 错误码

| 错误码 | 说明 |
|--------|------|
| 3001 | 版本号已存在 |
| 3002 | 版本不存在 |
| 3003 | 版本状态不允许此操作 |
| 3004 | 不支持的平台类型 |
| 3005 | 安装包文件未上传 |
| 3006 | 版本号格式无效 |

## 附录：规范章节补全（v5.0.3.108）

> 为对齐项目用户文档标准结构，下列章节补齐若干未在正文中单独列出的视角。已在正文覆盖的章节在此段仅作简述并标注 `见上文` 指引。

### 1. 概述

见正文「接口列表」。应用版本管理 API 提供多平台 APP 版本的创建 / 发布 / 更新 / 查询、客户端检查更新与下载统计，基于 REST + JWT。

### 2. 核心特性

- 7 接口：创建 / 列表 / 详情 / 更新状态 / 删除 / 检查更新 / 下载统计
- 5 平台版本管理（DRAFT → TESTING → PUBLISHED → DEPRECATED）
- 客户端 check-update 拉最新版
- 下载量统计

### 3. 系统架构

```
客户端 ──Bearer JWT──► REST /api/app-versions[/{id}[/status|/stats]|/check-update]
                          ▼
              后端（Spring Boot）
                          ▼
              MySQL（app_versions / app_downloads）+ 安装包存储 + Nginx
```

### 4. 系统定位

厂家管理系统的**多平台版本下发接口**，是 [应用发布](/manufacturer/app-publish) / [应用更新](/manufacturer/app-update) 功能页的 API 侧。

### 5. 核心功能

见正文「接口列表」：`POST/GET /api/app-versions`、`GET /{id}`、`PUT /{id}/status`、`DELETE /{id}`、`GET /check-update`、`GET /{id}/stats`。

### 6. 技术架构

Spring Boot REST + JWT；版本元数据存 `app_versions`，下载记录存 `app_downloads`；统一响应 `{code, message, data}`；安装包上传见 [应用上传](/manufacturer/app-upload)。

### 7. 系统特点

- 版本状态机防误发；已发布版本不可改包
- check-update 支持灰度 / 强更字段
- 单平台单版本唯一安装包

### 8. 应用场景

客户端自动更新对接、CI 发布脚本调用、下载量监控集成。

### 9. 竞品对比

| 维度 | 本 API | 手工分发 |
|---|---|---|
| 多平台统一 | ✅ 5 平台 | ⚠️ |
| 客户端 check-update | ✅ | ❌ |
| 下载统计 | ✅ | ❌ |

### 10. 配置参考

Base URL：`http://localhost:8080/api`（生产 `https://api.chainlesschain.com/api`）；`Authorization: Bearer <token>`；强更 / 灰度在版本状态更新时配置。

### 11. 性能指标

版本元数据接口毫秒级；check-update 可经 Redis 缓存最新版；上传接口限流 10 次/小时；下载吞吐取决于 Nginx。

### 12. 测试覆盖

版本状态机流转、check-update 路由、下载统计、删除限制（仅草稿）由后端集成测试覆盖；端点契约由 Swagger 描述。

### 13. 安全考虑

- 创建 / 发布 / 删除需 ADMIN 权限 + JWT（见 [权限](/manufacturer/permissions)）
- 安装包 SHA-256 完整性校验
- 操作写 `device_logs` 审计
- 错误码 3001–3006 + HTTP 401/403/429

### 14. 故障排除

| 现象 | 错误码 | 处理 |
|---|---|---|
| 版本号已存在 | 3001 | 换版本号（SemVer） |
| 版本不存在 | 3002 | 核对版本 ID |
| 状态不允许操作 | 3003 | 确认当前状态可流转 |
| 不支持平台 | 3004 | 用 5 平台之一 |
| 安装包未上传 | 3005 | 先上传安装包 |
| 版本号格式无效 | 3006 | 遵循 SemVer |

### 15. 关键文件

| 资源 | 说明 |
|---|---|
| `app_versions` / `app_downloads` 表 | 版本 / 下载数据 |
| `/api/app-versions*` | 版本管理 REST API（7 接口） |
| Swagger UI | `http://localhost:8080/api/swagger-ui.html` |

### 16. 使用示例

见正文各端点请求示例。客户端检查更新：`GET /api/app-versions/check-update?platform=windows`。

### 17. 相关文档

- [应用发布（功能页）](/manufacturer/app-publish)
- [应用更新（功能页）](/manufacturer/app-update)
- [API 简介](/api/introduction)
