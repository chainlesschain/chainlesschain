# 后端接口测试报告

## 测试摘要

- **测试时间**: 2025-12-24 14:24:43
- **测试时长**: 209.48秒
- **总测试数**: 8
- **通过**: 0 ✅
- **失败**: 0 ❌
- **错误**: 8 ⚠️
- **跳过**: 0 ⏭️
- **成功率**: 0.00%

## 详细结果


### ⚠️ ERROR (8)

#### [ProjectController] 健康检查

- **接口**: `GET /api/projects/health`
- **耗时**: 0.032秒
- **错误信息**: 无法连接到服务器

---

#### [SyncController] 同步服务健康检查

- **接口**: `GET /api/sync/health`
- **耗时**: 0.017秒
- **错误信息**: 无法连接到服务器

---

#### [ProjectController] 创建项目

- **接口**: `POST /api/projects/create`
- **耗时**: 0.014秒
- **错误信息**: 无法连接到服务器

**请求数据**:
```json
{
  "name": "综合测试项目_d9e9922d",
  "description": "这是一个全面的自动化测试项目",
  "projectType": "web",
  "userId": "test_user_comprehensive",
  "template": "react"
}
```

---

#### [ProjectController] 获取项目列表

- **接口**: `GET /api/projects/list`
- **耗时**: 0.007秒
- **错误信息**: 无法连接到服务器

---

#### [SyncController] 批量上传数据

- **接口**: `POST /api/sync/upload`
- **耗时**: 0.010秒
- **错误信息**: 无法连接到服务器

**请求数据**:
```json
{
  "tableName": "notes",
  "deviceId": "device_8668f2e6",
  "records": [
    {
      "id": "note_0c729e37",
      "title": "测试笔记",
      "content": "这是测试内容",
      "updated_at": 1703001600000
    }
  ]
}
```

---

#### [SyncController] 增量下载数据

- **接口**: `GET /api/sync/download/notes`
- **耗时**: 0.007秒
- **错误信息**: 无法连接到服务器

---

#### [SyncController] 获取同步状态

- **接口**: `GET /api/sync/status`
- **耗时**: 0.004秒
- **错误信息**: 无法连接到服务器

---

#### [SyncController] 解决同步冲突

- **接口**: `POST /api/sync/resolve-conflict`
- **耗时**: 0.007秒
- **错误信息**: 无法连接到服务器

**请求数据**:
```json
{
  "conflictId": "conflict_9a564e95",
  "resolution": "use_server",
  "deviceId": "device_8668f2e6"
}
```

---

