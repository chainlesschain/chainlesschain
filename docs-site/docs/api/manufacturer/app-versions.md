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
