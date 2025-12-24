# 后端接口测试报告

## 测试摘要

- **测试时间**: 2025-12-24 16:57:04
- **测试时长**: 443.66秒
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
- **耗时**: 0.026秒

**响应数据**:
```json
{
  "code": 200,
  "message": "成功",
  "data": {
    "service": "project-service",
    "timestamp": 1766566624838,
    "status": "running"
  }
}
```

---

#### [SyncController] 同步服务健康检查

- **接口**: `GET /api/sync/health`
- **耗时**: 0.013秒

**响应数据**:
```json
{
  "code": 200,
  "message": "操作成功",
  "data": {
    "status": "UP",
    "timestamp": 1766566624849
  },
  "timestamp": 1766566624849,
  "success": true
}
```

---

#### [ProjectController] 获取项目列表

- **接口**: `GET /api/projects/list`
- **耗时**: 0.339秒

**响应数据**:
```json
{
  "code": 200,
  "message": "成功",
  "data": {
    "records": [],
    "total": 0,
    "size": 10,
    "current": 1,
    "pages": 0
  }
}
```

---

#### [SyncController] 批量上传数据

- **接口**: `POST /api/sync/upload`
- **耗时**: 0.076秒

**请求数据**:
```json
{
  "tableName": "notes",
  "deviceId": "device_ebc8e142",
  "records": [
    {
      "id": "note_b8c77e08",
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
    "executionTimeMs": 31,
    "successCount": 0,
    "conflicts": [],
    "conflictCount": 0
  },
  "timestamp": 1766566625552,
  "success": true
}
```

---

#### [SyncController] 增量下载数据

- **接口**: `GET /api/sync/download/notes`
- **耗时**: 0.037秒

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
    "serverTimestamp": 1766566625582,
    "stats": {
      "newCount": 0,
      "updatedCount": 0,
      "deletedCount": 0,
      "conflictCount": 0,
      "executionTimeMs": 2
    }
  },
  "timestamp": 1766566625583,
  "success": true
}
```

---

#### [SyncController] 获取同步状态

- **接口**: `GET /api/sync/status`
- **耗时**: 0.219秒

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
    "serverTime": 1766566625597,
    "isOnline": true,
    "deviceId": "device_ebc8e142"
  },
  "timestamp": 1766566625808,
  "success": true
}
```

---


### ❌ FAILED (2)

#### [ProjectController] 创建项目

- **接口**: `POST /api/projects/create`
- **耗时**: 0.283秒
- **错误信息**: 状态码不匹配

**请求数据**:
```json
{
  "name": "综合测试项目_5e24d17f",
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
- **耗时**: 0.039秒
- **错误信息**: success字段为False

**请求数据**:
```json
{
  "conflictId": "conflict_b446bfe9",
  "resolution": "use_server",
  "deviceId": "device_ebc8e142"
}
```

**响应数据**:
```json
{
  "code": 500,
  "message": "解决冲突失败: \n### Error updating database.  Cause: org.postgresql.util.PSQLException: ERROR: null value in column \"table_name\" of relation \"sync_logs\" violates not-null constraint\n  Detail: Failing row contains (71468be0250e7855bdeb95b5160c49f6, null, null, resolve_conflict, upload, success, Resolution: use_server, device_ebc8e142, 2025-12-24 08:57:05.830337, 2025-12-24 08:57:05.830422).\n### The error may exist in com/chainlesschain/project/mapper/SyncLogMapper.java (best guess)\n### The error may involve com.chainlesschain.project.mapper.SyncLogMapper.insert-Inline\n### The error occurred while setting parameters\n### SQL: INSERT INTO sync_logs  ( id,   operation, direction, status, error_message, device_id, created_at, updated_at )  VALUES (  ?,   ?, ?, ?, ?, ?, ?, ?  )\n### Cause: org.postgresql.util.PSQLException: ERROR: null value in column \"table_name\" of relation \"sync_logs\" violates not-null constraint\n  Detail: Failing row contains (71468be0250e7855bdeb95b5160c49f6, null, null, resolve_conflict, upload, success, Resolution: use_server, device_ebc8e142, 2025-12-24 08:57:05.830337, 2025-12-24 08:57:05.830422).\n; ERROR: null value in column \"table_name\" of relation \"sync_logs\" violates not-null constraint\n  Detail: Failing row contains (71468be0250e7855bdeb95b5160c49f6, null, null, resolve_conflict, upload, success, Resolution: use_server, device_ebc8e142, 2025-12-24 08:57:05.830337, 2025-12-24 08:57:05.830422).",
  "data": null,
  "timestamp": 1766566625846,
  "success": false
}
```

---

