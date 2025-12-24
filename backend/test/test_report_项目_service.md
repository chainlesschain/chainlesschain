# 后端接口测试报告

## 测试摘要

- **测试时间**: 2025-12-24 18:06:34
- **测试时长**: 115.44秒
- **总测试数**: 8
- **通过**: 6 ✅
- **失败**: 2 ❌
- **错误**: 0 ⚠️
- **跳过**: 0 ⏭️
- **成功率**: 75.00%

## 详细结果


### ✅ PASSED (6)

#### [ProjectController] 健康检查

- **接口**: `GET /api/projects/health`
- **耗时**: 0.068秒

**响应数据**:
```json
{
  "code": 200,
  "message": "成功",
  "data": {
    "service": "project-service",
    "timestamp": 1766570794763,
    "status": "running"
  }
}
```

---

#### [SyncController] 同步服务健康检查

- **接口**: `GET /api/sync/health`
- **耗时**: 0.010秒

**响应数据**:
```json
{
  "code": 200,
  "message": "操作成功",
  "data": {
    "status": "UP",
    "timestamp": 1766570794783
  },
  "timestamp": 1766570794783,
  "success": true
}
```

---

#### [ProjectController] 获取项目列表

- **接口**: `GET /api/projects/list`
- **耗时**: 0.152秒

**响应数据**:
```json
{
  "code": 200,
  "message": "成功",
  "data": {
    "records": [
      {
        "id": "c3321ce9449321ae1577d084941cce41",
        "userId": "test_user_001",
        "name": "项目_1766568483219",
        "description": "Create a simple web project for testing - 70c0510d",
        "projectType": "web",
        "status": "active",
        "rootPath": "/data/projects/c3321ce9449321ae1577d084941cce41",
        "fileCount": 3,
        "totalSize": 6992,
        "templateId": null,
        "coverImageUrl": null,
        "tags": null,
        "createdAt": "2025-12-24T09:28:03.220587",
        "updatedAt": "2025-12-24T09:28:03.22169",
        "files": null
      },
      {
        "id": "52a960ef87b4a815a360883904a208ff",
        "userId": "test_user_001",
        "name": "项目_1766567835251",
        "description": "Create a simple web project for testing - d437629d",
        "projectType": "web",
        "status": "active",
        "rootPath": "/data/projects/52a960ef87b4a815a360883904a208ff",
        "fileCount": 3,
        "totalSize": 8229,
        "templateId": null,
        "coverImageUrl": null,
        "tags": null,
        "createdAt": "2025-12-24T09:17:15.254895",
        "updatedAt": "2025-12-24T09:17:15.259883",
        "files": null
      },
      {
        "id": "6f73d21388ebbbd5eaee1156a260c0f9",
        "userId": "test_user_001",
        "name": "项目_1766567402188",
        "description": "Create a simple web project for testing - 5ee97d2c",
        "projectType": "web",
        "status": "active",
        "rootPath": "/data/projects/6f73d21388ebbbd5eaee1156a260c0f9",
        "fileCount": 3,
        "totalSize": 5913,
        "templateId": null,
        "coverImageUrl": null,
        "tags": null,
        "createdAt": "2025-12-24T09:10:02.203302",
        "updatedAt": "2025-12-24T09:10:02.209816",
        "files": null
      }
    ],
    "total": 3,
    "size": 10,
    "current": 1,
    "pages": 1
  }
}
```

---

#### [SyncController] 批量上传数据

- **接口**: `POST /api/sync/upload`
- **耗时**: 0.038秒

**请求数据**:
```json
{
  "tableName": "notes",
  "deviceId": "device_4f137ecb",
  "records": [
    {
      "id": "note_68a839b0",
      "title": "测试笔记",
      "content": "这是测试内容",
      "updated_at": 1703001600000
    }
  ]
}
```

**响应数据**:
```json
{
  "code": 200,
  "message": "操作成功",
  "data": {
    "failedCount": 1,
    "executionTimeMs": 20,
    "successCount": 0,
    "conflicts": [],
    "conflictCount": 0
  },
  "timestamp": 1766570795044,
  "success": true
}
```

---

#### [SyncController] 增量下载数据

- **接口**: `GET /api/sync/download/notes`
- **耗时**: 0.010秒

**响应数据**:
```json
{
  "code": 200,
  "message": "操作成功",
  "data": {
    "newRecords": [],
    "updatedRecords": [],
    "deletedIds": [],
    "conflicts": [],
    "serverTimestamp": 1766570795055,
    "stats": {
      "newCount": 0,
      "updatedCount": 0,
      "deletedCount": 0,
      "conflictCount": 0,
      "executionTimeMs": 1
    }
  },
  "timestamp": 1766570795055,
  "success": true
}
```

---

#### [SyncController] 获取同步状态

- **接口**: `GET /api/sync/status`
- **耗时**: 0.069秒

**响应数据**:
```json
{
  "code": 200,
  "message": "操作成功",
  "data": {
    "pendingCounts": {
      "projects": 0,
      "project_files": 0,
      "project_conversations": 0,
      "project_collaborators": 0,
      "project_comments": 0,
      "project_tasks": 0
    },
    "serverTime": 1766570795061,
    "isOnline": true,
    "deviceId": "device_4f137ecb"
  },
  "timestamp": 1766570795124,
  "success": true
}
```

---


### ❌ FAILED (2)

#### [ProjectController] 创建项目

- **接口**: `POST /api/projects/create`
- **耗时**: 0.070秒
- **错误信息**: 状态码不匹配

**请求数据**:
```json
{
  "name": "综合测试项目_3c7c8ba6",
  "description": "这是一个全面的自动化测试项目",
  "projectType": "web",
  "userId": "test_user_comprehensive",
  "template": "react"
}
```

**响应数据**:
```json
{
  "code": 400,
  "message": "参数校验失败",
  "data": {
    "userPrompt": "用户提示不能为空"
  }
}
```

- **期望**: 200
- **实际**: 400

---

#### [SyncController] 解决同步冲突

- **接口**: `POST /api/sync/resolve-conflict`
- **耗时**: 0.067秒
- **错误信息**: success字段为False

**请求数据**:
```json
{
  "conflictId": "conflict_491c4f55",
  "resolution": "use_server",
  "deviceId": "device_4f137ecb"
}
```

**响应数据**:
```json
{
  "code": 500,
  "message": "解决冲突失败: \n### Error updating database.  Cause: org.postgresql.util.PSQLException: ERROR: null value in column \"table_name\" of relation \"sync_logs\" violates not-null constraint\n  Detail: Failing row contains (3ef7afe431d4aad949fcb3b7c4e1899c, null, null, resolve_conflict, upload, success, Resolution: use_server, device_4f137ecb, 2025-12-24 10:06:35.132439, 2025-12-24 10:06:35.13247).\n### The error may exist in com/chainlesschain/project/mapper/SyncLogMapper.java (best guess)\n### The error may involve com.chainlesschain.project.mapper.SyncLogMapper.insert-Inline\n### The error occurred while setting parameters\n### SQL: INSERT INTO sync_logs  ( id,   operation, direction, status, error_message, device_id, created_at, updated_at )  VALUES (  ?,   ?, ?, ?, ?, ?, ?, ?  )\n### Cause: org.postgresql.util.PSQLException: ERROR: null value in column \"table_name\" of relation \"sync_logs\" violates not-null constraint\n  Detail: Failing row contains (3ef7afe431d4aad949fcb3b7c4e1899c, null, null, resolve_conflict, upload, success, Resolution: use_server, device_4f137ecb, 2025-12-24 10:06:35.132439, 2025-12-24 10:06:35.13247).\n; ERROR: null value in column \"table_name\" of relation \"sync_logs\" violates not-null constraint\n  Detail: Failing row contains (3ef7afe431d4aad949fcb3b7c4e1899c, null, null, resolve_conflict, upload, success, Resolution: use_server, device_4f137ecb, 2025-12-24 10:06:35.132439, 2025-12-24 10:06:35.13247).",
  "data": null,
  "timestamp": 1766570795191,
  "success": false
}
```

---

