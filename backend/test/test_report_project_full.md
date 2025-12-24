# 后端接口测试报告

## 测试摘要

- **测试时间**: 2025-12-24 18:11:20
- **测试时长**: 116.85秒
- **总测试数**: 19
- **通过**: 15 ✅
- **失败**: 4 ❌
- **错误**: 0 ⚠️
- **跳过**: 0 ⏭️
- **成功率**: 78.95%

## 详细结果


### ✅ PASSED (15)

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
    "timestamp": 1766571080583,
    "status": "running"
  }
}
```

---

#### 创建项目

- **接口**: `POST /api/projects/create`
- **耗时**: 115.811秒

**请求数据**:
```json
{
  "userPrompt": "Create a simple web project for testing - 8c0f3df1",
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
    "id": "60fab7fb140a2894a8f2f36f7012120a",
    "userId": "test_user_001",
    "name": "项目_1766571196202",
    "description": "Create a simple web project for testing - 8c0f3df1",
    "projectType": "web",
    "status": "active",
    "rootPath": "/data/projects/60fab7fb140a2894a8f2f36f7012120a",
    "fileCount": 0,
    "totalSize": 0,
    "templateId": null,
    "coverImageUrl": null,
    "tags": null,
    "createdAt": "2025-12-24T10:13:16.208116116",
    "updatedAt": "2025-12-24T10:13:16.208269626",
    "files": [
      {
        "id": "95f43e955b6c1ff3d88982dba587e3fc",
        "fileName": "index.html",
        "filePath": "index.html",
        "fileType": "html",
        "fileSize": 1663,
        "updatedAt": "2025-12-24T10:13:16.238367498"
      },
      {
        "id": "c046291cff95d8d6dc950295ca393ea8",
        "fileName": "styles.css",
        "filePath": "styles.css",
        "fileType": "css",
        "fileSize": 3511,
        "updatedAt": "2025-12-24T10:13:16.264879147"
      },
      {
        "id": "703cb0ac091eff5d3d6f56f67d9702a5",
        "fileName": "script.js",
        "filePath": "script.js",
        "fileType": "javascript",
        "fileSize": 1914,
        "updatedAt": "2025-12-24T10:13:16.275310796"
      }
    ]
  }
}
```

---

#### 获取项目列表

- **接口**: `GET /api/projects/list`
- **耗时**: 0.081秒

**响应数据**:
```json
{
  "code": 200,
  "message": "成功",
  "data": {
    "records": [
      {
        "id": "60fab7fb140a2894a8f2f36f7012120a",
        "userId": "test_user_001",
        "name": "项目_1766571196202",
        "description": "Create a simple web project for testing - 8c0f3df1",
        "projectType": "web",
        "status": "active",
        "rootPath": "/data/projects/60fab7fb140a2894a8f2f36f7012120a",
        "fileCount": 3,
        "totalSize": 7088,
        "templateId": null,
        "coverImageUrl": null,
        "tags": null,
        "createdAt": "2025-12-24T10:13:16.208116",
        "updatedAt": "2025-12-24T10:13:16.210355",
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
    "total": 4,
    "size": 10,
    "current": 1,
    "pages": 1
  }
}
```

---

#### 获取项目详情

- **接口**: `GET /api/projects/60fab7fb140a2894a8f2f36f7012120a`
- **耗时**: 0.058秒

**响应数据**:
```json
{
  "code": 200,
  "message": "成功",
  "data": {
    "id": "60fab7fb140a2894a8f2f36f7012120a",
    "userId": "test_user_001",
    "name": "项目_1766571196202",
    "description": "Create a simple web project for testing - 8c0f3df1",
    "projectType": "web",
    "status": "active",
    "rootPath": "/data/projects/60fab7fb140a2894a8f2f36f7012120a",
    "fileCount": 3,
    "totalSize": 7088,
    "templateId": null,
    "coverImageUrl": null,
    "tags": null,
    "createdAt": "2025-12-24T10:13:16.208116",
    "updatedAt": "2025-12-24T10:13:16.210355",
    "files": [
      {
        "id": "703cb0ac091eff5d3d6f56f67d9702a5",
        "fileName": "script.js",
        "filePath": "script.js",
        "fileType": "javascript",
        "fileSize": 1914,
        "updatedAt": "2025-12-24T10:13:16.275311"
      },
      {
        "id": "c046291cff95d8d6dc950295ca393ea8",
        "fileName": "styles.css",
        "filePath": "styles.css",
        "fileType": "css",
        "fileSize": 3511,
        "updatedAt": "2025-12-24T10:13:16.264879"
      },
      {
        "id": "95f43e955b6c1ff3d88982dba587e3fc",
        "fileName": "index.html",
        "filePath": "index.html",
        "fileType": "html",
        "fileSize": 1663,
        "updatedAt": "2025-12-24T10:13:16.238367"
      }
    ]
  }
}
```

---

#### 获取文件列表

- **接口**: `GET /api/projects/60fab7fb140a2894a8f2f36f7012120a/files`
- **耗时**: 0.055秒

**响应数据**:
```json
{
  "code": 200,
  "message": "成功",
  "data": {
    "records": [
      {
        "id": "703cb0ac091eff5d3d6f56f67d9702a5",
        "projectId": "60fab7fb140a2894a8f2f36f7012120a",
        "filePath": "script.js",
        "fileName": "script.js",
        "fileType": "javascript",
        "language": "javascript",
        "fileSize": 1914,
        "version": 1,
        "commitHash": null,
        "generatedBy": "web_engine",
        "createdAt": "2025-12-24T10:13:16.275287",
        "updatedAt": "2025-12-24T10:13:16.275311",
        "content": null
      },
      {
        "id": "c046291cff95d8d6dc950295ca393ea8",
        "projectId": "60fab7fb140a2894a8f2f36f7012120a",
        "filePath": "styles.css",
        "fileName": "styles.css",
        "fileType": "css",
        "language": "css",
        "fileSize": 3511,
        "version": 1,
        "commitHash": null,
        "generatedBy": "web_engine",
        "createdAt": "2025-12-24T10:13:16.264848",
        "updatedAt": "2025-12-24T10:13:16.264879",
        "content": null
      },
      {
        "id": "95f43e955b6c1ff3d88982dba587e3fc",
        "projectId": "60fab7fb140a2894a8f2f36f7012120a",
        "filePath": "index.html",
        "fileName": "index.html",
        "fileType": "html",
        "language": "html",
        "fileSize": 1663,
        "version": 1,
        "commitHash": null,
        "generatedBy": "web_engine",
        "createdAt": "2025-12-24T10:13:16.238306",
        "updatedAt": "2025-12-24T10:13:16.238367",
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

- **接口**: `POST /api/projects/60fab7fb140a2894a8f2f36f7012120a/files`
- **耗时**: 0.160秒

**请求数据**:
```json
{
  "fileName": "test_99c918f2.txt",
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
    "id": "43cc386a9e5b469ee880c2e112de59d4",
    "projectId": "60fab7fb140a2894a8f2f36f7012120a",
    "filePath": "/test",
    "fileName": "test_99c918f2.txt",
    "fileType": "text",
    "language": null,
    "fileSize": 17,
    "version": 1,
    "commitHash": null,
    "generatedBy": "user",
    "createdAt": "2025-12-24T10:13:16.756999558",
    "updatedAt": "2025-12-24T10:13:16.75703416",
    "content": "Test file content"
  }
}
```

---

#### 获取文件详情

- **接口**: `GET /api/projects/60fab7fb140a2894a8f2f36f7012120a/files/43cc386a9e5b469ee880c2e112de59d4`
- **耗时**: 0.064秒

**响应数据**:
```json
{
  "code": 200,
  "message": "成功",
  "data": {
    "id": "43cc386a9e5b469ee880c2e112de59d4",
    "projectId": "60fab7fb140a2894a8f2f36f7012120a",
    "filePath": "/test",
    "fileName": "test_99c918f2.txt",
    "fileType": "text",
    "language": null,
    "fileSize": 17,
    "version": 1,
    "commitHash": null,
    "generatedBy": "user",
    "createdAt": "2025-12-24T10:13:16.757",
    "updatedAt": "2025-12-24T10:13:16.757034",
    "content": "Test file content"
  }
}
```

---

#### 更新文件

- **接口**: `PUT /api/projects/60fab7fb140a2894a8f2f36f7012120a/files/43cc386a9e5b469ee880c2e112de59d4`
- **耗时**: 0.058秒

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
    "id": "43cc386a9e5b469ee880c2e112de59d4",
    "projectId": "60fab7fb140a2894a8f2f36f7012120a",
    "filePath": "/test",
    "fileName": "test_99c918f2.txt",
    "fileType": "text",
    "language": null,
    "fileSize": 15,
    "version": 2,
    "commitHash": null,
    "generatedBy": "user",
    "createdAt": "2025-12-24T10:13:16.757",
    "updatedAt": "2025-12-24T10:13:16.757034",
    "content": "Updated content"
  }
}
```

---

#### 删除文件

- **接口**: `DELETE /api/projects/60fab7fb140a2894a8f2f36f7012120a/files/43cc386a9e5b469ee880c2e112de59d4`
- **耗时**: 0.078秒

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

- **接口**: `GET /api/projects/60fab7fb140a2894a8f2f36f7012120a/collaborators`
- **耗时**: 0.045秒

**响应数据**:
```json
{
  "code": 500,
  "message": "\n### Error querying database.  Cause: org.postgresql.util.PSQLException: ERROR: column \"user_id\" does not exist\n  Position: 23\n### The error may exist in com/chainlesschain/project/mapper/ProjectCollaboratorMapper.java (best guess)\n### The error may involve defaultParameterMap\n### The error occurred while setting parameters\n### SQL: SELECT  id,project_id,user_id,collaborator_did,role,permissions,invited_by,invited_at,accepted_at,status,created_at,updated_at,sync_status,synced_at,device_id,deleted  FROM project_collaborators  WHERE deleted=0     AND (project_id = ?) ORDER BY created_at DESC\n### Cause: org.postgresql.util.PSQLException: ERROR: column \"user_id\" does not exist\n  Position: 23\n; bad SQL grammar []",
  "data": null
}
```

---

#### 获取评论列表

- **接口**: `GET /api/projects/60fab7fb140a2894a8f2f36f7012120a/comments`
- **耗时**: 0.053秒

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

- **接口**: `POST /api/projects/60fab7fb140a2894a8f2f36f7012120a/comments`
- **耗时**: 0.054秒

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

- **接口**: `GET /api/projects/60fab7fb140a2894a8f2f36f7012120a/automation/rules`
- **耗时**: 0.030秒

**响应数据**:
```json
{
  "code": 500,
  "message": "\n### Error querying database.  Cause: org.postgresql.util.PSQLException: ERROR: column \"description\" does not exist\n  Position: 33\n### The error may exist in com/chainlesschain/project/mapper/ProjectAutomationRuleMapper.java (best guess)\n### The error may involve defaultParameterMap\n### The error occurred while setting parameters\n### SQL: SELECT  id,project_id,rule_name,description,trigger_event,action_type,trigger_config,action_config,is_enabled,last_run_at,run_count,created_at,updated_at,deleted  FROM project_automation_rules  WHERE deleted=0     AND (project_id = ?) ORDER BY created_at DESC\n### Cause: org.postgresql.util.PSQLException: ERROR: column \"description\" does not exist\n  Position: 33\n; bad SQL grammar []",
  "data": null
}
```

---

#### 获取自动化统计

- **接口**: `GET /api/projects/60fab7fb140a2894a8f2f36f7012120a/automation/stats`
- **耗时**: 0.018秒

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

- **接口**: `DELETE /api/projects/60fab7fb140a2894a8f2f36f7012120a`
- **耗时**: 0.016秒

**响应数据**:
```json
{
  "code": 200,
  "message": "项目删除成功",
  "data": null
}
```

---


### ❌ FAILED (4)

#### 执行项目任务

- **接口**: `POST /api/projects/tasks/execute`
- **耗时**: 0.116秒
- **错误信息**: 状态码不匹配

**请求数据**:
```json
{
  "projectId": "60fab7fb140a2894a8f2f36f7012120a",
  "taskType": "build",
  "params": {}
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

#### 批量创建文件

- **接口**: `POST /api/projects/60fab7fb140a2894a8f2f36f7012120a/files/batch`
- **耗时**: 0.038秒
- **错误信息**: 状态码不匹配

**请求数据**:
```json
{
  "files": [
    {
      "fileName": "file1.txt",
      "filePath": "/test",
      "content": "Content 1"
    },
    {
      "fileName": "file2.txt",
      "filePath": "/test",
      "content": "Content 2"
    }
  ]
}
```

**响应数据**:
```json
{
  "code": 500,
  "message": "服务器内部错误，请稍后重试",
  "data": null
}
```

- **期望**: 200
- **实际**: 500

---

#### 添加协作者

- **接口**: `POST /api/projects/60fab7fb140a2894a8f2f36f7012120a/collaborators`
- **耗时**: 0.048秒
- **错误信息**: 状态码不匹配

**请求数据**:
```json
{
  "userId": "collaborator_001",
  "role": "developer",
  "permissions": [
    "read",
    "write"
  ]
}
```

**响应数据**:
```json
{
  "code": 400,
  "message": "参数校验失败",
  "data": {
    "collaboratorDid": "协作者DID不能为空"
  }
}
```

- **期望**: 200
- **实际**: 400

---

#### 创建自动化规则

- **接口**: `POST /api/projects/60fab7fb140a2894a8f2f36f7012120a/automation/rules`
- **耗时**: 0.039秒
- **错误信息**: 状态码不匹配

**请求数据**:
```json
{
  "name": "Auto Build Rule",
  "trigger": "on_commit",
  "actions": [
    "build",
    "test"
  ],
  "enabled": true
}
```

**响应数据**:
```json
{
  "code": 400,
  "message": "参数校验失败",
  "data": {
    "actionType": "动作类型不能为空",
    "triggerConfig": "触发配置不能为空",
    "actionConfig": "动作配置不能为空",
    "ruleName": "规则名称不能为空",
    "triggerEvent": "触发事件不能为空"
  }
}
```

- **期望**: 200
- **实际**: 400

---

