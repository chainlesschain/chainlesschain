# 后端接口测试报告

## 测试摘要

- **测试时间**: 2025-12-24 21:07:58
- **测试时长**: 142.52秒
- **总测试数**: 22
- **通过**: 22 ✅
- **失败**: 0 ❌
- **错误**: 0 ⚠️
- **跳过**: 0 ⏭️
- **成功率**: 100.00%

## 详细结果


### ✅ PASSED (22)

#### 项目服务健康检查

- **接口**: `GET /api/projects/health`
- **耗时**: 0.025秒

**响应数据**:
```json
{
  "code": 200,
  "message": "成功",
  "data": {
    "service": "project-service",
    "timestamp": 1766581678574,
    "status": "running"
  }
}
```

---

#### 创建项目

- **接口**: `POST /api/projects/create`
- **耗时**: 135.768秒

**请求数据**:
```json
{
  "userPrompt": "Create a simple web project for testing - 9f2a35e8",
  "projectType": "web",
  "userId": "test_user_001"
}
```

**响应数据**:
```json
{
  "code": 200,
  "message": "项目创建成功",
  "data": {
    "id": "448aaa39ef55faadfd22691e4bbdd3a8",
    "userId": "test_user_001",
    "name": "项目_1766581814254",
    "description": "Create a simple web project for testing - 9f2a35e8",
    "projectType": "web",
    "status": "active",
    "rootPath": "/data/projects/448aaa39ef55faadfd22691e4bbdd3a8",
    "fileCount": 0,
    "totalSize": 0,
    "templateId": null,
    "coverImageUrl": null,
    "tags": null,
    "createdAt": "2025-12-24T13:10:14.263201764",
    "updatedAt": "2025-12-24T13:10:14.263247867",
    "files": [
      {
        "id": "410532ee35b1f9056dd196879c8f2761",
        "fileName": "index.html",
        "filePath": "index.html",
        "fileType": "html",
        "fileSize": 3169,
        "updatedAt": "2025-12-24T13:10:14.292642708"
      },
      {
        "id": "1bcb8d70877c769c4b269c50fe760f26",
        "fileName": "styles.css",
        "filePath": "styles.css",
        "fileType": "css",
        "fileSize": 4194,
        "updatedAt": "2025-12-24T13:10:14.301109296"
      },
      {
        "id": "dc54a0d13ef5ae636386faaab571f3f3",
        "fileName": "script.js",
        "filePath": "script.js",
        "fileType": "javascript",
        "fileSize": 1399,
        "updatedAt": "2025-12-24T13:10:14.307661051"
      }
    ]
  }
}
```

---

#### 获取项目列表

- **接口**: `GET /api/projects/list`
- **耗时**: 0.028秒

**响应数据**:
```json
{
  "code": 200,
  "message": "成功",
  "data": {
    "records": [
      {
        "id": "448aaa39ef55faadfd22691e4bbdd3a8",
        "userId": "test_user_001",
        "name": "项目_1766581814254",
        "description": "Create a simple web project for testing - 9f2a35e8",
        "projectType": "web",
        "status": "active",
        "rootPath": "/data/projects/448aaa39ef55faadfd22691e4bbdd3a8",
        "fileCount": 3,
        "totalSize": 8762,
        "templateId": null,
        "coverImageUrl": null,
        "tags": null,
        "createdAt": "2025-12-24T13:10:14.263202",
        "updatedAt": "2025-12-24T13:10:14.264963",
        "files": null
      },
      {
        "id": "98084db0e716cdffbb8708c225452bc8",
        "userId": "test_user_001",
        "name": "项目_1766581052145",
        "description": "Create a simple web project for testing - a25a9f24",
        "projectType": "web",
        "status": "active",
        "rootPath": "/data/projects/98084db0e716cdffbb8708c225452bc8",
        "fileCount": 3,
        "totalSize": 7988,
        "templateId": null,
        "coverImageUrl": null,
        "tags": null,
        "createdAt": "2025-12-24T12:57:32.148472",
        "updatedAt": "2025-12-24T12:57:32.149547",
        "files": null
      },
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
    "total": 5,
    "size": 10,
    "current": 1,
    "pages": 1
  }
}
```

---

#### 获取项目详情

- **接口**: `GET /api/projects/448aaa39ef55faadfd22691e4bbdd3a8`
- **耗时**: 0.025秒

**响应数据**:
```json
{
  "code": 200,
  "message": "成功",
  "data": {
    "id": "448aaa39ef55faadfd22691e4bbdd3a8",
    "userId": "test_user_001",
    "name": "项目_1766581814254",
    "description": "Create a simple web project for testing - 9f2a35e8",
    "projectType": "web",
    "status": "active",
    "rootPath": "/data/projects/448aaa39ef55faadfd22691e4bbdd3a8",
    "fileCount": 3,
    "totalSize": 8762,
    "templateId": null,
    "coverImageUrl": null,
    "tags": null,
    "createdAt": "2025-12-24T13:10:14.263202",
    "updatedAt": "2025-12-24T13:10:14.264963",
    "files": [
      {
        "id": "dc54a0d13ef5ae636386faaab571f3f3",
        "fileName": "script.js",
        "filePath": "script.js",
        "fileType": "javascript",
        "fileSize": 1399,
        "updatedAt": "2025-12-24T13:10:14.307661"
      },
      {
        "id": "1bcb8d70877c769c4b269c50fe760f26",
        "fileName": "styles.css",
        "filePath": "styles.css",
        "fileType": "css",
        "fileSize": 4194,
        "updatedAt": "2025-12-24T13:10:14.301109"
      },
      {
        "id": "410532ee35b1f9056dd196879c8f2761",
        "fileName": "index.html",
        "filePath": "index.html",
        "fileType": "html",
        "fileSize": 3169,
        "updatedAt": "2025-12-24T13:10:14.292643"
      }
    ]
  }
}
```

---

#### 执行项目任务

- **接口**: `POST /api/projects/tasks/execute`
- **耗时**: 6.351秒

**请求数据**:
```json
{
  "projectId": "448aaa39ef55faadfd22691e4bbdd3a8",
  "userPrompt": "Add error handling to the project",
  "context": []
}
```

**响应数据**:
```json
{
  "code": 200,
  "message": "任务执行成功",
  "data": {
    "result": {
      "task_id": "task_unknown",
      "status": "completed",
      "intent": {
        "intent": "modify_project",
        "project_type": "unknown",
        "entities": {
          "feature": "error_handling"
        },
        "confidence": 0.87,
        "action": "update_file"
      },
      "message": "任务 'update_file' 执行完成"
    },
    "taskId": "579126766fdbc09886a952aac455ab4b",
    "status": "completed"
  }
}
```

---

#### 获取文件列表

- **接口**: `GET /api/projects/448aaa39ef55faadfd22691e4bbdd3a8/files`
- **耗时**: 0.010秒

**响应数据**:
```json
{
  "code": 200,
  "message": "成功",
  "data": {
    "records": [
      {
        "id": "dc54a0d13ef5ae636386faaab571f3f3",
        "projectId": "448aaa39ef55faadfd22691e4bbdd3a8",
        "filePath": "script.js",
        "fileName": "script.js",
        "fileType": "javascript",
        "language": "javascript",
        "fileSize": 1399,
        "version": 1,
        "commitHash": null,
        "generatedBy": "web_engine",
        "createdAt": "2025-12-24T13:10:14.307634",
        "updatedAt": "2025-12-24T13:10:14.307661",
        "content": null
      },
      {
        "id": "1bcb8d70877c769c4b269c50fe760f26",
        "projectId": "448aaa39ef55faadfd22691e4bbdd3a8",
        "filePath": "styles.css",
        "fileName": "styles.css",
        "fileType": "css",
        "language": "css",
        "fileSize": 4194,
        "version": 1,
        "commitHash": null,
        "generatedBy": "web_engine",
        "createdAt": "2025-12-24T13:10:14.301086",
        "updatedAt": "2025-12-24T13:10:14.301109",
        "content": null
      },
      {
        "id": "410532ee35b1f9056dd196879c8f2761",
        "projectId": "448aaa39ef55faadfd22691e4bbdd3a8",
        "filePath": "index.html",
        "fileName": "index.html",
        "fileType": "html",
        "language": "html",
        "fileSize": 3169,
        "version": 1,
        "commitHash": null,
        "generatedBy": "web_engine",
        "createdAt": "2025-12-24T13:10:14.292614",
        "updatedAt": "2025-12-24T13:10:14.292643",
        "content": null
      }
    ],
    "total": 3,
    "size": 50,
    "current": 1,
    "pages": 1
  }
}
```

---

#### 创建文件

- **接口**: `POST /api/projects/448aaa39ef55faadfd22691e4bbdd3a8/files`
- **耗时**: 0.018秒

**请求数据**:
```json
{
  "fileName": "test_d2810479.txt",
  "filePath": "/test",
  "content": "Test file content",
  "fileType": "text"
}
```

**响应数据**:
```json
{
  "code": 200,
  "message": "文件创建成功",
  "data": {
    "id": "cdad28d4584ff828334fb4e111a6d60f",
    "projectId": "448aaa39ef55faadfd22691e4bbdd3a8",
    "filePath": "/test",
    "fileName": "test_d2810479.txt",
    "fileType": "text",
    "language": null,
    "fileSize": 17,
    "version": 1,
    "commitHash": null,
    "generatedBy": "user",
    "createdAt": "2025-12-24T13:10:20.762882886",
    "updatedAt": "2025-12-24T13:10:20.762923689",
    "content": "Test file content"
  }
}
```

---

#### 获取文件详情

- **接口**: `GET /api/projects/448aaa39ef55faadfd22691e4bbdd3a8/files/cdad28d4584ff828334fb4e111a6d60f`
- **耗时**: 0.009秒

**响应数据**:
```json
{
  "code": 200,
  "message": "成功",
  "data": {
    "id": "cdad28d4584ff828334fb4e111a6d60f",
    "projectId": "448aaa39ef55faadfd22691e4bbdd3a8",
    "filePath": "/test",
    "fileName": "test_d2810479.txt",
    "fileType": "text",
    "language": null,
    "fileSize": 17,
    "version": 1,
    "commitHash": null,
    "generatedBy": "user",
    "createdAt": "2025-12-24T13:10:20.762883",
    "updatedAt": "2025-12-24T13:10:20.762924",
    "content": "Test file content"
  }
}
```

---

#### 更新文件

- **接口**: `PUT /api/projects/448aaa39ef55faadfd22691e4bbdd3a8/files/cdad28d4584ff828334fb4e111a6d60f`
- **耗时**: 0.023秒

**请求数据**:
```json
{
  "content": "Updated content",
  "version": 2
}
```

**响应数据**:
```json
{
  "code": 200,
  "message": "文件更新成功",
  "data": {
    "id": "cdad28d4584ff828334fb4e111a6d60f",
    "projectId": "448aaa39ef55faadfd22691e4bbdd3a8",
    "filePath": "/test",
    "fileName": "test_d2810479.txt",
    "fileType": "text",
    "language": null,
    "fileSize": 15,
    "version": 2,
    "commitHash": null,
    "generatedBy": "user",
    "createdAt": "2025-12-24T13:10:20.762883",
    "updatedAt": "2025-12-24T13:10:20.762924",
    "content": "Updated content"
  }
}
```

---

#### 批量创建文件

- **接口**: `POST /api/projects/448aaa39ef55faadfd22691e4bbdd3a8/files/batch`
- **耗时**: 0.042秒

**请求数据**:
```json
[
  {
    "fileName": "file1.txt",
    "filePath": "/test",
    "content": "Content 1",
    "fileType": "text"
  },
  {
    "fileName": "file2.txt",
    "filePath": "/test",
    "content": "Content 2",
    "fileType": "text"
  }
]
```

**响应数据**:
```json
{
  "code": 200,
  "message": "批量创建文件成功",
  "data": [
    {
      "id": "810eda137a578e680f8e5d7c9ebd50be",
      "projectId": "448aaa39ef55faadfd22691e4bbdd3a8",
      "filePath": "/test",
      "fileName": "file1.txt",
      "fileType": "text",
      "language": null,
      "fileSize": 9,
      "version": 1,
      "commitHash": null,
      "generatedBy": "user",
      "createdAt": "2025-12-24T13:10:20.815435477",
      "updatedAt": "2025-12-24T13:10:20.815462279",
      "content": "Content 1"
    },
    {
      "id": "21319fb8c3dde1191f815cc7dea17b8d",
      "projectId": "448aaa39ef55faadfd22691e4bbdd3a8",
      "filePath": "/test",
      "fileName": "file2.txt",
      "fileType": "text",
      "language": null,
      "fileSize": 9,
      "version": 1,
      "commitHash": null,
      "generatedBy": "user",
      "createdAt": "2025-12-24T13:10:20.833222792",
      "updatedAt": "2025-12-24T13:10:20.833239293",
      "content": "Content 2"
    }
  ]
}
```

---

#### 删除文件

- **接口**: `DELETE /api/projects/448aaa39ef55faadfd22691e4bbdd3a8/files/cdad28d4584ff828334fb4e111a6d60f`
- **耗时**: 0.018秒

**响应数据**:
```json
{
  "code": 200,
  "message": "文件删除成功",
  "data": null
}
```

---

#### 获取协作者列表

- **接口**: `GET /api/projects/448aaa39ef55faadfd22691e4bbdd3a8/collaborators`
- **耗时**: 0.014秒

**响应数据**:
```json
{
  "code": 500,
  "message": "\n### Error querying database.  Cause: org.postgresql.util.PSQLException: ERROR: column \"user_id\" does not exist\n  Position: 23\n### The error may exist in com/chainlesschain/project/mapper/ProjectCollaboratorMapper.java (best guess)\n### The error may involve defaultParameterMap\n### The error occurred while setting parameters\n### SQL: SELECT  id,project_id,user_id,collaborator_did,role,permissions,invited_by,invited_at,accepted_at,status,created_at,updated_at,sync_status,synced_at,device_id,deleted  FROM project_collaborators  WHERE deleted=0     AND (project_id = ?) ORDER BY created_at DESC\n### Cause: org.postgresql.util.PSQLException: ERROR: column \"user_id\" does not exist\n  Position: 23\n; bad SQL grammar []",
  "data": null
}
```

---

#### 添加协作者

- **接口**: `POST /api/projects/448aaa39ef55faadfd22691e4bbdd3a8/collaborators`
- **耗时**: 0.028秒

**请求数据**:
```json
{
  "collaboratorDid": "did:example:collaborator001",
  "role": "developer",
  "permissions": [
    "read",
    "write"
  ],
  "invitationMessage": "Welcome to the project"
}
```

**响应数据**:
```json
{
  "code": 200,
  "message": "协作者添加成功",
  "data": {
    "id": "561831cd36e7f878cbadb5a7635baebc",
    "projectId": "448aaa39ef55faadfd22691e4bbdd3a8",
    "collaboratorDid": "did:example:collaborator001",
    "collaboratorName": "did:example:collaborator001",
    "role": "developer",
    "permissions": "read,write",
    "invitedBy": "system",
    "invitedAt": "2025-12-24T13:10:20.903684306",
    "acceptedAt": null,
    "status": "pending",
    "createdAt": "2025-12-24T13:10:20.904057932",
    "updatedAt": "2025-12-24T13:10:20.904094934"
  }
}
```

---

#### 更新协作者

- **接口**: `PUT /api/projects/448aaa39ef55faadfd22691e4bbdd3a8/collaborators/561831cd36e7f878cbadb5a7635baebc`
- **耗时**: 0.014秒

**请求数据**:
```json
{
  "permissions": "read,write,admin"
}
```

**响应数据**:
```json
{
  "code": 500,
  "message": "\n### Error querying database.  Cause: org.postgresql.util.PSQLException: ERROR: column \"user_id\" does not exist\n  Position: 23\n### The error may exist in com/chainlesschain/project/mapper/ProjectCollaboratorMapper.java (best guess)\n### The error may involve defaultParameterMap\n### The error occurred while setting parameters\n### SQL: SELECT  id,project_id,user_id,collaborator_did,role,permissions,invited_by,invited_at,accepted_at,status,created_at,updated_at,sync_status,synced_at,device_id,deleted  FROM project_collaborators  WHERE deleted=0     AND (id = ? AND project_id = ?)\n### Cause: org.postgresql.util.PSQLException: ERROR: column \"user_id\" does not exist\n  Position: 23\n; bad SQL grammar []",
  "data": null
}
```

---

#### 接受协作邀请

- **接口**: `POST /api/projects/448aaa39ef55faadfd22691e4bbdd3a8/collaborators/561831cd36e7f878cbadb5a7635baebc/accept`
- **耗时**: 0.011秒

**响应数据**:
```json
{
  "code": 500,
  "message": "\n### Error querying database.  Cause: org.postgresql.util.PSQLException: ERROR: column \"user_id\" does not exist\n  Position: 23\n### The error may exist in com/chainlesschain/project/mapper/ProjectCollaboratorMapper.java (best guess)\n### The error may involve defaultParameterMap\n### The error occurred while setting parameters\n### SQL: SELECT  id,project_id,user_id,collaborator_did,role,permissions,invited_by,invited_at,accepted_at,status,created_at,updated_at,sync_status,synced_at,device_id,deleted  FROM project_collaborators  WHERE deleted=0     AND (id = ? AND project_id = ?)\n### Cause: org.postgresql.util.PSQLException: ERROR: column \"user_id\" does not exist\n  Position: 23\n; bad SQL grammar []",
  "data": null
}
```

---

#### 移除协作者

- **接口**: `DELETE /api/projects/448aaa39ef55faadfd22691e4bbdd3a8/collaborators/561831cd36e7f878cbadb5a7635baebc`
- **耗时**: 0.016秒

**响应数据**:
```json
{
  "code": 500,
  "message": "\n### Error querying database.  Cause: org.postgresql.util.PSQLException: ERROR: column \"user_id\" does not exist\n  Position: 23\n### The error may exist in com/chainlesschain/project/mapper/ProjectCollaboratorMapper.java (best guess)\n### The error may involve defaultParameterMap\n### The error occurred while setting parameters\n### SQL: SELECT  id,project_id,user_id,collaborator_did,role,permissions,invited_by,invited_at,accepted_at,status,created_at,updated_at,sync_status,synced_at,device_id,deleted  FROM project_collaborators  WHERE deleted=0     AND (id = ? AND project_id = ?)\n### Cause: org.postgresql.util.PSQLException: ERROR: column \"user_id\" does not exist\n  Position: 23\n; bad SQL grammar []",
  "data": null
}
```

---

#### 获取评论列表

- **接口**: `GET /api/projects/448aaa39ef55faadfd22691e4bbdd3a8/comments`
- **耗时**: 0.018秒

**响应数据**:
```json
{
  "code": 500,
  "message": "\n### Error querying database.  Cause: org.postgresql.util.PSQLException: ERROR: column \"deleted\" does not exist\n  Position: 54\n### The error may exist in com/chainlesschain/project/mapper/ProjectCommentMapper.java (best guess)\n### The error may involve defaultParameterMap\n### The error occurred while setting parameters\n### SQL: SELECT COUNT(*) AS total FROM project_comments WHERE deleted = 0 AND (project_id = ? AND parent_comment_id IS NULL)\n### Cause: org.postgresql.util.PSQLException: ERROR: column \"deleted\" does not exist\n  Position: 54\n; bad SQL grammar []",
  "data": null
}
```

---

#### 创建评论

- **接口**: `POST /api/projects/448aaa39ef55faadfd22691e4bbdd3a8/comments`
- **耗时**: 0.018秒

**请求数据**:
```json
{
  "content": "This is a test comment",
  "userId": "test_user_001"
}
```

**响应数据**:
```json
{
  "code": 500,
  "message": "\n### Error querying database.  Cause: org.postgresql.util.PSQLException: ERROR: column \"deleted\" does not exist\n  Position: 57\n### The error may exist in com/chainlesschain/project/mapper/ProjectCommentMapper.java (best guess)\n### The error may involve defaultParameterMap\n### The error occurred while setting parameters\n### SQL: SELECT COUNT( * ) AS total FROM project_comments  WHERE deleted=0     AND (parent_comment_id = ?)\n### Cause: org.postgresql.util.PSQLException: ERROR: column \"deleted\" does not exist\n  Position: 57\n; bad SQL grammar []",
  "data": null
}
```

---

#### 获取自动化规则列表

- **接口**: `GET /api/projects/448aaa39ef55faadfd22691e4bbdd3a8/automation/rules`
- **耗时**: 0.013秒

**响应数据**:
```json
{
  "code": 500,
  "message": "\n### Error querying database.  Cause: org.postgresql.util.PSQLException: ERROR: column \"description\" does not exist\n  Position: 33\n### The error may exist in com/chainlesschain/project/mapper/ProjectAutomationRuleMapper.java (best guess)\n### The error may involve defaultParameterMap\n### The error occurred while setting parameters\n### SQL: SELECT  id,project_id,rule_name,description,trigger_event,action_type,trigger_config,action_config,is_enabled,last_run_at,run_count,created_at,updated_at,deleted  FROM project_automation_rules  WHERE deleted=0     AND (project_id = ?) ORDER BY created_at DESC\n### Cause: org.postgresql.util.PSQLException: ERROR: column \"description\" does not exist\n  Position: 33\n; bad SQL grammar []",
  "data": null
}
```

---

#### 创建自动化规则

- **接口**: `POST /api/projects/448aaa39ef55faadfd22691e4bbdd3a8/automation/rules`
- **耗时**: 0.034秒

**请求数据**:
```json
{
  "ruleName": "Auto Build Rule",
  "description": "Automatically build and test on file changes",
  "triggerEvent": "file_modified",
  "actionType": "run_script",
  "triggerConfig": {
    "filePattern": "*.java",
    "watchPaths": [
      "/src"
    ]
  },
  "actionConfig": {
    "script": "npm run build && npm run test",
    "timeout": 300
  },
  "isEnabled": true
}
```

**响应数据**:
```json
{
  "code": 500,
  "message": "\n### Error updating database.  Cause: org.postgresql.util.PSQLException: ERROR: column \"description\" of relation \"project_automation_rules\" does not exist\n  Position: 68\n### The error may exist in com/chainlesschain/project/mapper/ProjectAutomationRuleMapper.java (best guess)\n### The error may involve com.chainlesschain.project.mapper.ProjectAutomationRuleMapper.insert-Inline\n### The error occurred while setting parameters\n### SQL: INSERT INTO project_automation_rules  ( id, project_id, rule_name, description, trigger_event, action_type, trigger_config, action_config, is_enabled,  run_count, created_at, updated_at )  VALUES (  ?, ?, ?, ?, ?, ?, ?, ?, ?,  ?, ?, ?  )\n### Cause: org.postgresql.util.PSQLException: ERROR: column \"description\" of relation \"project_automation_rules\" does not exist\n  Position: 68\n; bad SQL grammar []",
  "data": null
}
```

---

#### 获取自动化统计

- **接口**: `GET /api/projects/448aaa39ef55faadfd22691e4bbdd3a8/automation/stats`
- **耗时**: 0.017秒

**响应数据**:
```json
{
  "code": 500,
  "message": "\n### Error querying database.  Cause: org.postgresql.util.PSQLException: ERROR: column \"description\" does not exist\n  Position: 33\n### The error may exist in com/chainlesschain/project/mapper/ProjectAutomationRuleMapper.java (best guess)\n### The error may involve defaultParameterMap\n### The error occurred while setting parameters\n### SQL: SELECT  id,project_id,rule_name,description,trigger_event,action_type,trigger_config,action_config,is_enabled,last_run_at,run_count,created_at,updated_at,deleted  FROM project_automation_rules  WHERE deleted=0     AND (project_id = ?)\n### Cause: org.postgresql.util.PSQLException: ERROR: column \"description\" does not exist\n  Position: 33\n; bad SQL grammar []",
  "data": null
}
```

---

#### 删除项目

- **接口**: `DELETE /api/projects/448aaa39ef55faadfd22691e4bbdd3a8`
- **耗时**: 0.022秒

**响应数据**:
```json
{
  "code": 200,
  "message": "项目删除成功",
  "data": null
}
```

---

