# 后端接口测试报告

## 测试摘要

- **测试时间**: 2025-12-24 20:35:42
- **测试时长**: 178.82秒
- **总测试数**: 22
- **通过**: 21 ✅
- **失败**: 1 ❌
- **错误**: 0 ⚠️
- **跳过**: 0 ⏭️
- **成功率**: 95.45%

## 详细结果


### ✅ PASSED (21)

#### 项目服务健康检查

- **接口**: `GET /api/projects/health`
- **耗时**: 0.033秒

**响应数据**:
```json
{
  "code": 200,
  "message": "成功",
  "data": {
    "service": "project-service",
    "timestamp": 1766579742885,
    "status": "running"
  }
}
```

---

#### 创建项目

- **接口**: `POST /api/projects/create`
- **耗时**: 117.130秒

**请求数据**:
```json
{
  "userPrompt": "Create a simple web project for testing - c692f0bd",
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
    "id": "0bc94a2f840f38eb92ef00426cd214e8",
    "userId": "test_user_001",
    "name": "项目_1766579859742",
    "description": "Create a simple web project for testing - c692f0bd",
    "projectType": "web",
    "status": "active",
    "rootPath": "/data/projects/0bc94a2f840f38eb92ef00426cd214e8",
    "fileCount": 0,
    "totalSize": 0,
    "templateId": null,
    "coverImageUrl": null,
    "tags": null,
    "createdAt": "2025-12-24T12:37:39.750030292",
    "updatedAt": "2025-12-24T12:37:39.750099697",
    "files": [
      {
        "id": "90c6a23f57010275cdd0b67af5ff466e",
        "fileName": "index.html",
        "filePath": "index.html",
        "fileType": "html",
        "fileSize": 1800,
        "updatedAt": "2025-12-24T12:37:39.786282284"
      },
      {
        "id": "e4742bd104bba2b02ce1abd8253bea2e",
        "fileName": "styles.css",
        "filePath": "styles.css",
        "fileType": "css",
        "fileSize": 3620,
        "updatedAt": "2025-12-24T12:37:39.810801437"
      },
      {
        "id": "a3f199d4c9c6bfe24d66bccf1eaee553",
        "fileName": "script.js",
        "filePath": "script.js",
        "fileType": "javascript",
        "fileSize": 1425,
        "updatedAt": "2025-12-24T12:37:39.820532032"
      }
    ]
  }
}
```

---

#### 获取项目列表

- **接口**: `GET /api/projects/list`
- **耗时**: 0.076秒

**响应数据**:
```json
{
  "code": 200,
  "message": "成功",
  "data": {
    "records": [
      {
        "id": "0bc94a2f840f38eb92ef00426cd214e8",
        "userId": "test_user_001",
        "name": "项目_1766579859742",
        "description": "Create a simple web project for testing - c692f0bd",
        "projectType": "web",
        "status": "active",
        "rootPath": "/data/projects/0bc94a2f840f38eb92ef00426cd214e8",
        "fileCount": 3,
        "totalSize": 6845,
        "templateId": null,
        "coverImageUrl": null,
        "tags": null,
        "createdAt": "2025-12-24T12:37:39.75003",
        "updatedAt": "2025-12-24T12:37:39.752841",
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

- **接口**: `GET /api/projects/0bc94a2f840f38eb92ef00426cd214e8`
- **耗时**: 0.028秒

**响应数据**:
```json
{
  "code": 200,
  "message": "成功",
  "data": {
    "id": "0bc94a2f840f38eb92ef00426cd214e8",
    "userId": "test_user_001",
    "name": "项目_1766579859742",
    "description": "Create a simple web project for testing - c692f0bd",
    "projectType": "web",
    "status": "active",
    "rootPath": "/data/projects/0bc94a2f840f38eb92ef00426cd214e8",
    "fileCount": 3,
    "totalSize": 6845,
    "templateId": null,
    "coverImageUrl": null,
    "tags": null,
    "createdAt": "2025-12-24T12:37:39.75003",
    "updatedAt": "2025-12-24T12:37:39.752841",
    "files": [
      {
        "id": "a3f199d4c9c6bfe24d66bccf1eaee553",
        "fileName": "script.js",
        "filePath": "script.js",
        "fileType": "javascript",
        "fileSize": 1425,
        "updatedAt": "2025-12-24T12:37:39.820532"
      },
      {
        "id": "e4742bd104bba2b02ce1abd8253bea2e",
        "fileName": "styles.css",
        "filePath": "styles.css",
        "fileType": "css",
        "fileSize": 3620,
        "updatedAt": "2025-12-24T12:37:39.810801"
      },
      {
        "id": "90c6a23f57010275cdd0b67af5ff466e",
        "fileName": "index.html",
        "filePath": "index.html",
        "fileType": "html",
        "fileSize": 1800,
        "updatedAt": "2025-12-24T12:37:39.786282"
      }
    ]
  }
}
```

---

#### 执行项目任务

- **接口**: `POST /api/projects/tasks/execute`
- **耗时**: 60.180秒

**请求数据**:
```json
{
  "projectId": "0bc94a2f840f38eb92ef00426cd214e8",
  "userPrompt": "Add error handling to the project",
  "context": []
}
```

**响应数据**:
```json
{
  "code": 500,
  "message": "执行任务失败: java.util.concurrent.TimeoutException: Did not observe any item or terminal signal within 60000ms in 'flatMap' (and no fallback has been configured)",
  "data": null
}
```

---

#### 获取文件列表

- **接口**: `GET /api/projects/0bc94a2f840f38eb92ef00426cd214e8/files`
- **耗时**: 0.042秒

**响应数据**:
```json
{
  "code": 200,
  "message": "成功",
  "data": {
    "records": [
      {
        "id": "a3f199d4c9c6bfe24d66bccf1eaee553",
        "projectId": "0bc94a2f840f38eb92ef00426cd214e8",
        "filePath": "script.js",
        "fileName": "script.js",
        "fileType": "javascript",
        "language": "javascript",
        "fileSize": 1425,
        "version": 1,
        "commitHash": null,
        "generatedBy": "web_engine",
        "createdAt": "2025-12-24T12:37:39.820513",
        "updatedAt": "2025-12-24T12:37:39.820532",
        "content": null
      },
      {
        "id": "e4742bd104bba2b02ce1abd8253bea2e",
        "projectId": "0bc94a2f840f38eb92ef00426cd214e8",
        "filePath": "styles.css",
        "fileName": "styles.css",
        "fileType": "css",
        "language": "css",
        "fileSize": 3620,
        "version": 1,
        "commitHash": null,
        "generatedBy": "web_engine",
        "createdAt": "2025-12-24T12:37:39.810779",
        "updatedAt": "2025-12-24T12:37:39.810801",
        "content": null
      },
      {
        "id": "90c6a23f57010275cdd0b67af5ff466e",
        "projectId": "0bc94a2f840f38eb92ef00426cd214e8",
        "filePath": "index.html",
        "fileName": "index.html",
        "fileType": "html",
        "language": "html",
        "fileSize": 1800,
        "version": 1,
        "commitHash": null,
        "generatedBy": "web_engine",
        "createdAt": "2025-12-24T12:37:39.786212",
        "updatedAt": "2025-12-24T12:37:39.786282",
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

- **接口**: `POST /api/projects/0bc94a2f840f38eb92ef00426cd214e8/files`
- **耗时**: 0.054秒

**请求数据**:
```json
{
  "fileName": "test_23aab2be.txt",
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
    "id": "26f51abe4b0f1a6a10263a3ac1ffaaf9",
    "projectId": "0bc94a2f840f38eb92ef00426cd214e8",
    "filePath": "/test",
    "fileName": "test_23aab2be.txt",
    "fileType": "text",
    "language": null,
    "fileSize": 17,
    "version": 1,
    "commitHash": null,
    "generatedBy": "user",
    "createdAt": "2025-12-24T12:38:40.35776217",
    "updatedAt": "2025-12-24T12:38:40.357869678",
    "content": "Test file content"
  }
}
```

---

#### 获取文件详情

- **接口**: `GET /api/projects/0bc94a2f840f38eb92ef00426cd214e8/files/26f51abe4b0f1a6a10263a3ac1ffaaf9`
- **耗时**: 0.023秒

**响应数据**:
```json
{
  "code": 200,
  "message": "成功",
  "data": {
    "id": "26f51abe4b0f1a6a10263a3ac1ffaaf9",
    "projectId": "0bc94a2f840f38eb92ef00426cd214e8",
    "filePath": "/test",
    "fileName": "test_23aab2be.txt",
    "fileType": "text",
    "language": null,
    "fileSize": 17,
    "version": 1,
    "commitHash": null,
    "generatedBy": "user",
    "createdAt": "2025-12-24T12:38:40.357762",
    "updatedAt": "2025-12-24T12:38:40.35787",
    "content": "Test file content"
  }
}
```

---

#### 更新文件

- **接口**: `PUT /api/projects/0bc94a2f840f38eb92ef00426cd214e8/files/26f51abe4b0f1a6a10263a3ac1ffaaf9`
- **耗时**: 0.064秒

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
    "id": "26f51abe4b0f1a6a10263a3ac1ffaaf9",
    "projectId": "0bc94a2f840f38eb92ef00426cd214e8",
    "filePath": "/test",
    "fileName": "test_23aab2be.txt",
    "fileType": "text",
    "language": null,
    "fileSize": 15,
    "version": 2,
    "commitHash": null,
    "generatedBy": "user",
    "createdAt": "2025-12-24T12:38:40.357762",
    "updatedAt": "2025-12-24T12:38:40.35787",
    "content": "Updated content"
  }
}
```

---

#### 批量创建文件

- **接口**: `POST /api/projects/0bc94a2f840f38eb92ef00426cd214e8/files/batch`
- **耗时**: 0.098秒

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
      "id": "e6fbb0ae2e81c8a58bfe6a6543fff952",
      "projectId": "0bc94a2f840f38eb92ef00426cd214e8",
      "filePath": "/test",
      "fileName": "file1.txt",
      "fileType": "text",
      "language": null,
      "fileSize": 9,
      "version": 1,
      "commitHash": null,
      "generatedBy": "user",
      "createdAt": "2025-12-24T12:38:40.523710697",
      "updatedAt": "2025-12-24T12:38:40.523745999",
      "content": "Content 1"
    },
    {
      "id": "851db4df498e4d6ea1c351560d2b2629",
      "projectId": "0bc94a2f840f38eb92ef00426cd214e8",
      "filePath": "/test",
      "fileName": "file2.txt",
      "fileType": "text",
      "language": null,
      "fileSize": 9,
      "version": 1,
      "commitHash": null,
      "generatedBy": "user",
      "createdAt": "2025-12-24T12:38:40.556524996",
      "updatedAt": "2025-12-24T12:38:40.5565867",
      "content": "Content 2"
    }
  ]
}
```

---

#### 删除文件

- **接口**: `DELETE /api/projects/0bc94a2f840f38eb92ef00426cd214e8/files/26f51abe4b0f1a6a10263a3ac1ffaaf9`
- **耗时**: 0.257秒

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

- **接口**: `GET /api/projects/0bc94a2f840f38eb92ef00426cd214e8/collaborators`
- **耗时**: 0.095秒

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

- **接口**: `POST /api/projects/0bc94a2f840f38eb92ef00426cd214e8/collaborators`
- **耗时**: 0.179秒

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
    "id": "7c8bfc4379643997d1c3fb620c0c2184",
    "projectId": "0bc94a2f840f38eb92ef00426cd214e8",
    "collaboratorDid": "did:example:collaborator001",
    "collaboratorName": "did:example:collaborator001",
    "role": "developer",
    "permissions": "read,write",
    "invitedBy": "system",
    "invitedAt": "2025-12-24T12:38:41.018545865",
    "acceptedAt": null,
    "status": "pending",
    "createdAt": "2025-12-24T12:38:41.043801434",
    "updatedAt": "2025-12-24T12:38:41.04388194"
  }
}
```

---

#### 接受协作邀请

- **接口**: `POST /api/projects/0bc94a2f840f38eb92ef00426cd214e8/collaborators/7c8bfc4379643997d1c3fb620c0c2184/accept`
- **耗时**: 0.053秒

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

- **接口**: `DELETE /api/projects/0bc94a2f840f38eb92ef00426cd214e8/collaborators/7c8bfc4379643997d1c3fb620c0c2184`
- **耗时**: 0.042秒

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

- **接口**: `GET /api/projects/0bc94a2f840f38eb92ef00426cd214e8/comments`
- **耗时**: 0.070秒

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

- **接口**: `POST /api/projects/0bc94a2f840f38eb92ef00426cd214e8/comments`
- **耗时**: 0.089秒

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

- **接口**: `GET /api/projects/0bc94a2f840f38eb92ef00426cd214e8/automation/rules`
- **耗时**: 0.102秒

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

- **接口**: `POST /api/projects/0bc94a2f840f38eb92ef00426cd214e8/automation/rules`
- **耗时**: 0.070秒

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

- **接口**: `GET /api/projects/0bc94a2f840f38eb92ef00426cd214e8/automation/stats`
- **耗时**: 0.028秒

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

- **接口**: `DELETE /api/projects/0bc94a2f840f38eb92ef00426cd214e8`
- **耗时**: 0.047秒

**响应数据**:
```json
{
  "code": 200,
  "message": "项目删除成功",
  "data": null
}
```

---


### ❌ FAILED (1)

#### 更新协作者

- **接口**: `PUT /api/projects/0bc94a2f840f38eb92ef00426cd214e8/collaborators/7c8bfc4379643997d1c3fb620c0c2184`
- **耗时**: 0.060秒
- **错误信息**: 状态码不匹配

**请求数据**:
```json
{
  "role": "admin",
  "permissions": [
    "read",
    "write",
    "delete"
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

