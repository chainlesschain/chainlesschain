# ChainlessChain Backend API Documentation

版本：v1.0.0
更新日期：2025-12-23

## 目录

- [概述](#概述)
- [服务架构](#服务架构)
- [认证](#认证)
- [统一响应格式](#统一响应格式)
- [错误码](#错误码)
- [项目管理 API](#项目管理-api)
- [文件管理 API](#文件管理-api)
- [Git 操作 API](#git-操作-api)
- [RAG 索引 API](#rag-索引-api)
- [代码助手 API](#代码助手-api)
- [协作管理 API](#协作管理-api)
- [评论管理 API](#评论管理-api)
- [自动化规则 API](#自动化规则-api)

---

## 概述

ChainlessChain 后端提供两个主要服务：

1. **Project Service (Java/Spring Boot)** - 端口：9090
   - 项目管理、文件管理、协作、评论、自动化规则等 CRUD 操作

2. **AI Service (Python/FastAPI)** - 端口：8001
   - Git 操作、RAG 索引、代码助手等 AI 驱动功能

---

## 服务架构

```
┌─────────────────────────────────────────────────────────┐
│                    Electron Frontend                     │
│                  (Vue3 + IPC Renderer)                   │
└─────────────────────┬───────────────────────────────────┘
                      │
        ┌─────────────┴─────────────┐
        │                           │
        ▼                           ▼
┌───────────────┐          ┌────────────────┐
│ Project Service│          │  AI Service    │
│  (Spring Boot) │          │   (FastAPI)    │
│   Port: 9090   │          │  Port: 8001    │
└───────┬────────┘          └────────┬───────┘
        │                            │
        ▼                            ▼
  ┌──────────┐              ┌─────────────┐
  │PostgreSQL│              │   Qdrant    │
  │  + Redis │              │   + Ollama  │
  └──────────┘              └─────────────┘
```

---

## 认证

### Headers

所有 API 请求都应包含以下 Header（可选）：

```http
User-DID: did:example:123456789abcdefghi
```

如果未提供，系统将使用默认值（`system` 或 `anonymous`）。

---

## 统一响应格式

### 成功响应

```json
{
  "code": 200,
  "message": "成功",
  "data": {
    // 具体数据
  }
}
```

### 分页响应

```json
{
  "code": 200,
  "message": "成功",
  "data": {
    "records": [...],
    "total": 100,
    "pageNum": 1,
    "pageSize": 20,
    "pages": 5
  }
}
```

### 错误响应

```json
{
  "code": 500,
  "message": "错误描述",
  "data": null
}
```

---

## 错误码

| 错误码 | 说明 |
|--------|------|
| 200 | 成功 |
| 201 | 创建成功 |
| 400 | 请求参数错误 |
| 401 | 未授权 |
| 403 | 禁止访问 |
| 404 | 资源不存在 |
| 500 | 服务器内部错误 |

---

## 项目管理 API

**Base URL**: `http://localhost:9090/api/projects`

### 1. 创建项目

**POST** `/create`

使用 AI 根据自然语言描述创建项目。

**请求体**:
```json
{
  "userPrompt": "创建一个待办事项管理网站",
  "projectType": "web",
  "templateId": null,
  "name": "我的待办事项",
  "userId": "user123"
}
```

**响应**:
```json
{
  "code": 200,
  "message": "项目创建成功",
  "data": {
    "id": "project_abc123",
    "name": "我的待办事项",
    "type": "web",
    "status": "active",
    "fileCount": 3,
    "files": [
      {
        "id": "file_001",
        "fileName": "index.html",
        "filePath": "index.html",
        "fileType": "html"
      }
    ]
  }
}
```

---

### 2. 获取项目详情

**GET** `/{projectId}`

**响应**:
```json
{
  "code": 200,
  "data": {
    "id": "project_abc123",
    "name": "我的待办事项",
    "type": "web",
    "description": "创建一个待办事项管理网站",
    "status": "active",
    "fileCount": 3,
    "totalSize": 15360,
    "createdAt": "2025-12-23T10:00:00",
    "files": [...]
  }
}
```

---

### 3. 获取项目列表

**GET** `/list`

**参数**:
- `userId` (可选): 用户ID
- `pageNum` (默认: 1): 页码
- `pageSize` (默认: 10): 每页数量

**响应**: 分页响应格式

---

### 4. 删除项目

**DELETE** `/{projectId}`

**响应**:
```json
{
  "code": 200,
  "message": "项目删除成功",
  "data": null
}
```

---

### 5. 执行任务

**POST** `/tasks/execute`

**请求体**:
```json
{
  "projectId": "project_abc123",
  "userPrompt": "添加一个删除按钮",
  "context": []
}
```

---

### 6. 健康检查

**GET** `/health`

**响应**:
```json
{
  "code": 200,
  "data": {
    "status": "UP",
    "timestamp": "2025-12-23T10:00:00"
  }
}
```

---

## 文件管理 API

**Base URL**: `http://localhost:9090/api/projects/{projectId}/files`

### 1. 获取文件列表

**GET** `/`

**参数**:
- `fileType` (可选): 文件类型过滤（js, py, html 等）
- `pageNum` (默认: 1)
- `pageSize` (默认: 50)

**响应**:
```json
{
  "code": 200,
  "data": {
    "records": [
      {
        "id": "file_001",
        "projectId": "project_abc123",
        "fileName": "index.html",
        "filePath": "index.html",
        "fileType": "html",
        "fileSize": 5120,
        "version": 1,
        "createdAt": "2025-12-23T10:00:00"
      }
    ],
    "total": 3
  }
}
```

---

### 2. 获取文件详情

**GET** `/{fileId}`

**响应**: 包含完整 `content` 字段

---

### 3. 创建文件

**POST** `/`

**请求体**:
```json
{
  "filePath": "src/main.js",
  "fileName": "main.js",
  "fileType": "javascript",
  "language": "javascript",
  "content": "console.log('Hello World');",
  "isBase64": false,
  "generatedBy": "user"
}
```

---

### 4. 批量创建文件

**POST** `/batch`

**请求体**: 文件创建请求数组

---

### 5. 更新文件

**PUT** `/{fileId}`

**请求体**:
```json
{
  "content": "console.log('Updated');",
  "isBase64": false,
  "commitMessage": "更新主逻辑"
}
```

---

### 6. 删除文件

**DELETE** `/{fileId}`

---

## Git 操作 API

**Base URL**: `http://localhost:8001/api/git`

### 1. 初始化仓库

**POST** `/init`

**请求体**:
```json
{
  "repo_path": "/path/to/project",
  "remote_url": "https://github.com/user/repo.git",
  "branch_name": "main"
}
```

**响应**:
```json
{
  "success": true,
  "repo_path": "/path/to/project",
  "branch": "main",
  "remote_url": "https://github.com/user/repo.git"
}
```

---

### 2. 获取状态

**GET** `/status?repo_path=/path/to/project`

**响应**:
```json
{
  "branch": "main",
  "modified": ["src/main.js"],
  "staged": ["index.html"],
  "untracked": ["README.md"],
  "remotes": {
    "origin": "https://github.com/user/repo.git"
  },
  "is_dirty": true
}
```

---

### 3. 提交更改

**POST** `/commit`

**请求体**:
```json
{
  "repo_path": "/path/to/project",
  "message": "feat: 添加新功能",
  "files": ["src/main.js"],
  "auto_generate_message": false
}
```

**响应**:
```json
{
  "success": true,
  "commit_hash": "abc123def456...",
  "short_hash": "abc123d",
  "message": "feat: 添加新功能",
  "author": "User <user@example.com>",
  "committed_date": "2025-12-23T10:00:00"
}
```

---

### 4. 推送到远程

**POST** `/push`

**请求体**:
```json
{
  "repo_path": "/path/to/project",
  "remote": "origin",
  "branch": "main"
}
```

---

### 5. 从远程拉取

**POST** `/pull`

**请求体**: 同 push

---

### 6. 获取提交历史

**GET** `/log?repo_path=/path/to/project&limit=20`

**响应**:
```json
{
  "commits": [
    {
      "hash": "abc123...",
      "short_hash": "abc123d",
      "message": "feat: 添加新功能",
      "author": "User",
      "email": "user@example.com",
      "date": "2025-12-23T10:00:00",
      "parents": ["def456..."]
    }
  ]
}
```

---

### 7. 获取差异

**GET** `/diff?repo_path=/path/to/project&commit1=abc&commit2=def`

**响应**:
```json
{
  "diff": "diff --git a/file.js...",
  "commit1": "abc",
  "commit2": "def"
}
```

---

### 8. 列出分支

**GET** `/branches?repo_path=/path/to/project`

**响应**:
```json
{
  "current": "main",
  "local": ["main", "develop"],
  "remote": ["origin/main", "origin/develop"]
}
```

---

### 9. 创建分支

**POST** `/branch/create`

**请求体**:
```json
{
  "repo_path": "/path/to/project",
  "branch_name": "feature/new-feature",
  "from_branch": "main"
}
```

---

### 10. 切换分支

**POST** `/branch/checkout`

**请求体**:
```json
{
  "repo_path": "/path/to/project",
  "branch_name": "develop"
}
```

---

### 11. 合并分支

**POST** `/merge`

**请求体**:
```json
{
  "repo_path": "/path/to/project",
  "source_branch": "feature/new-feature",
  "target_branch": "main"
}
```

**响应**:
```json
{
  "success": true,
  "source_branch": "feature/new-feature",
  "target_branch": "main",
  "result": "Fast-forward"
}
```

或冲突时：
```json
{
  "success": false,
  "has_conflicts": true,
  "message": "Merge conflict detected",
  "error": "..."
}
```

---

### 12. 解决冲突

**POST** `/resolve-conflicts`

**请求体**:
```json
{
  "repo_path": "/path/to/project",
  "resolutions": {
    "file1.js": "use_ours",
    "file2.js": "use_theirs"
  }
}
```

---

### 13. AI生成提交消息

**POST** `/generate-commit-message`

**请求体**:
```json
{
  "repo_path": "/path/to/project",
  "staged_files": ["src/main.js", "index.html"],
  "diff_content": "diff --git..."
}
```

**响应**:
```json
{
  "message": "feat(ui): 添加用户登录功能"
}
```

---

## RAG 索引 API

**Base URL**: `http://localhost:8001/api/rag`

### 1. 索引项目文件

**POST** `/index/project`

**请求体**:
```json
{
  "project_id": "project_abc123",
  "repo_path": "/path/to/project",
  "file_types": ["py", "js", "md"],
  "force_reindex": false
}
```

**响应**:
```json
{
  "success": true,
  "project_id": "project_abc123",
  "indexed_files": 25,
  "skipped_files": 3,
  "error_files": 0,
  "total_chunks": 150,
  "total_files": 28
}
```

---

### 2. 获取索引统计

**GET** `/index/stats?project_id=project_abc123`

**响应**:
```json
{
  "project_id": "project_abc123",
  "total_chunks": 150,
  "file_type_distribution": {
    "js": 50,
    "py": 80,
    "md": 20
  },
  "indexed": true
}
```

---

### 3. 增强查询

**POST** `/query/enhanced`

**请求体**:
```json
{
  "project_id": "project_abc123",
  "query": "如何实现用户登录",
  "top_k": 5,
  "use_reranker": false,
  "sources": ["project"]
}
```

**响应**:
```json
{
  "query": "如何实现用户登录",
  "total_docs": 5,
  "sources": {
    "project": 5
  },
  "context": [
    {
      "id": "uuid-001",
      "score": 0.95,
      "text": "用户登录功能代码片段...",
      "metadata": {
        "file_path": "src/auth.js",
        "file_type": "js"
      },
      "project_id": "project_abc123"
    }
  ],
  "summary": null
}
```

---

### 4. 删除项目索引

**DELETE** `/index/project/{project_id}`

---

### 5. 更新单文件索引

**POST** `/index/update-file`

**请求体**:
```json
{
  "project_id": "project_abc123",
  "file_path": "src/main.js",
  "content": "// 更新后的代码..."
}
```

---

## 代码助手 API

**Base URL**: `http://localhost:8001/api/code`

### 1. 生成代码

**POST** `/generate`

**请求体**:
```json
{
  "description": "实现一个二分查找算法",
  "language": "python",
  "style": "modern",
  "include_tests": true,
  "include_comments": true,
  "context": null
}
```

**响应**:
```json
{
  "code": "def binary_search(arr, target):\n    ...",
  "tests": "def test_binary_search():\n    ...",
  "language": "python",
  "description": "实现一个二分查找算法"
}
```

---

### 2. 代码审查

**POST** `/review`

**请求体**:
```json
{
  "code": "function add(a, b) {\n  return a + b;\n}",
  "language": "javascript",
  "focus_areas": ["security", "performance"]
}
```

**响应**:
```json
{
  "score": 8,
  "suggestions": [
    {
      "priority": "medium",
      "issue": "缺少参数类型验证",
      "advice": "建议添加参数类型检查"
    }
  ],
  "improved_code": "function add(a, b) {\n  if (typeof a !== 'number' || typeof b !== 'number') {\n    throw new TypeError('参数必须是数字');\n  }\n  return a + b;\n}",
  "raw_review": "完整审查报告..."
}
```

---

### 3. 代码重构

**POST** `/refactor`

**请求体**:
```json
{
  "code": "原始代码...",
  "language": "javascript",
  "refactor_type": "simplify",
  "target": null
}
```

**refactor_type 选项**:
- `general` - 通用优化
- `extract_function` - 提取函数
- `rename_variables` - 重命名变量
- `simplify` - 简化逻辑
- `optimize` - 性能优化
- `modernize` - 现代化改造
- `add_types` - 添加类型注解

**响应**:
```json
{
  "original_code": "...",
  "refactored_code": "重构后的代码...",
  "refactor_type": "simplify",
  "explanation": "简化了嵌套逻辑，提高了可读性",
  "language": "javascript"
}
```

---

### 4. 代码解释

**POST** `/explain`

**请求体**:
```json
{
  "code": "代码片段...",
  "language": "python"
}
```

**响应**:
```json
{
  "explanation": "这段代码实现了..."
}
```

---

### 5. 修复Bug

**POST** `/fix-bug`

**请求体**:
```json
{
  "code": "有bug的代码...",
  "language": "javascript",
  "bug_description": "点击按钮时报错"
}
```

**响应**:
```json
{
  "original_code": "...",
  "fixed_code": "修复后的代码...",
  "bug_analysis": "问题原因分析...",
  "language": "javascript"
}
```

---

### 6. 生成单元测试

**POST** `/generate-tests`

**请求体**:
```json
{
  "code": "function add(a, b) { return a + b; }",
  "language": "javascript"
}
```

**响应**:
```json
{
  "tests": "describe('add', () => {\n  it('should add two numbers', () => {\n    expect(add(1, 2)).toBe(3);\n  });\n});"
}
```

---

### 7. 性能优化

**POST** `/optimize`

**请求体**:
```json
{
  "code": "需要优化的代码...",
  "language": "python"
}
```

**响应**: 同重构 API

---

## 协作管理 API

**Base URL**: `http://localhost:9090/api/projects/{projectId}/collaborators`

### 1. 获取协作者列表

**GET** `/`

**响应**:
```json
{
  "code": 200,
  "data": [
    {
      "id": "collab_001",
      "projectId": "project_abc123",
      "collaboratorDid": "did:example:user2",
      "collaboratorName": "张三",
      "permissions": "write",
      "invitedBy": "did:example:user1",
      "invitedAt": "2025-12-23T10:00:00",
      "acceptedAt": "2025-12-23T11:00:00",
      "status": "accepted"
    }
  ]
}
```

---

### 2. 添加协作者

**POST** `/`

**Headers**:
```
User-DID: did:example:user1
```

**请求体**:
```json
{
  "collaboratorDid": "did:example:user2",
  "permissions": "write",
  "invitationMessage": "邀请你加入项目"
}
```

**permissions 选项**:
- `read` - 只读权限
- `write` - 读写权限
- `admin` - 管理员权限

---

### 3. 更新权限

**PUT** `/{collaboratorId}`

**请求体**:
```json
{
  "permissions": "admin"
}
```

---

### 4. 移除协作者

**DELETE** `/{collaboratorId}`

---

### 5. 接受邀请

**POST** `/{collaboratorId}/accept`

---

## 评论管理 API

**Base URL**: `http://localhost:9090/api/projects/{projectId}/comments`

### 1. 获取评论列表

**GET** `/`

**参数**:
- `filePath` (可选): 文件路径过滤
- `pageNum` (默认: 1)
- `pageSize` (默认: 20)

**响应**:
```json
{
  "code": 200,
  "data": {
    "records": [
      {
        "id": "comment_001",
        "projectId": "project_abc123",
        "filePath": "src/main.js",
        "lineNumber": 42,
        "authorDid": "did:example:user1",
        "authorName": "张三",
        "content": "这里的逻辑需要优化",
        "parentCommentId": null,
        "replyCount": 2,
        "createdAt": "2025-12-23T10:00:00"
      }
    ],
    "total": 10
  }
}
```

---

### 2. 添加评论

**POST** `/`

**Headers**:
```
User-DID: did:example:user1
```

**请求体**:
```json
{
  "filePath": "src/main.js",
  "lineNumber": 42,
  "content": "这里的逻辑需要优化",
  "parentCommentId": null
}
```

**说明**:
- `filePath` 为 null 表示项目级评论
- `lineNumber` 为 null 表示文件级评论（非行级）
- `parentCommentId` 不为 null 表示这是一个回复

---

### 3. 更新评论

**PUT** `/{commentId}`

**请求体**:
```json
{
  "content": "更新后的评论内容"
}
```

---

### 4. 删除评论

**DELETE** `/{commentId}`

**说明**: 删除评论时会级联删除所有回复

---

### 5. 回复评论

**POST** `/{commentId}/replies`

**请求体**:
```json
{
  "content": "我同意你的看法"
}
```

---

### 6. 获取评论回复

**GET** `/{commentId}/replies`

**响应**:
```json
{
  "code": 200,
  "data": [
    {
      "id": "comment_002",
      "parentCommentId": "comment_001",
      "content": "我同意你的看法",
      "authorDid": "did:example:user2",
      "authorName": "李四",
      "createdAt": "2025-12-23T11:00:00"
    }
  ]
}
```

---

## 自动化规则 API

**Base URL**: `http://localhost:9090/api/projects/{projectId}/automation`

### 1. 获取规则列表

**GET** `/rules`

**参数**:
- `isEnabled` (可选): true/false 过滤启用状态

**响应**:
```json
{
  "code": 200,
  "data": [
    {
      "id": "rule_001",
      "projectId": "project_abc123",
      "ruleName": "自动提交",
      "description": "文件修改后自动提交到Git",
      "triggerEvent": "file_modified",
      "actionType": "git_commit",
      "triggerConfig": "{\"pattern\": \"*.js\"}",
      "actionConfig": "{\"message\": \"自动提交\"}",
      "isEnabled": true,
      "lastRunAt": "2025-12-23T10:00:00",
      "runCount": 15,
      "createdAt": "2025-12-20T10:00:00"
    }
  ]
}
```

---

### 2. 创建规则

**POST** `/rules`

**请求体**:
```json
{
  "ruleName": "自动提交",
  "description": "文件修改后自动提交到Git",
  "triggerEvent": "file_modified",
  "actionType": "git_commit",
  "triggerConfig": {
    "pattern": "*.js",
    "debounce": 5000
  },
  "actionConfig": {
    "message": "自动提交",
    "push": false
  },
  "isEnabled": true
}
```

**triggerEvent 选项**:
- `file_created` - 文件创建时
- `file_modified` - 文件修改时
- `task_completed` - 任务完成时
- `schedule` - 定时触发

**actionType 选项**:
- `generate_file` - 生成文件
- `send_notification` - 发送通知
- `git_commit` - Git提交
- `run_script` - 运行脚本

---

### 3. 更新规则

**PUT** `/rules/{ruleId}`

**请求体**: 同创建规则（所有字段可选）

---

### 4. 删除规则

**DELETE** `/rules/{ruleId}`

---

### 5. 手动触发规则

**POST** `/rules/{ruleId}/trigger`

**响应**:
```json
{
  "code": 200,
  "data": {
    "ruleId": "rule_001",
    "triggerAt": "2025-12-23T12:00:00",
    "status": "success",
    "message": "规则执行成功（示例）"
  }
}
```

---

### 6. 启用/禁用规则

**PUT** `/rules/{ruleId}/toggle?enabled=true`

**参数**:
- `enabled`: true/false

---

### 7. 获取规则统计

**GET** `/stats`

**响应**:
```json
{
  "code": 200,
  "data": {
    "projectId": "project_abc123",
    "totalRules": 5,
    "enabledRules": 3,
    "disabledRules": 2,
    "triggerTypeDistribution": {
      "file_modified": 2,
      "schedule": 3
    },
    "actionTypeDistribution": {
      "git_commit": 2,
      "send_notification": 3
    },
    "totalRunCount": 150
  }
}
```

---

## Postman Collection

将以下内容保存为 `ChainlessChain.postman_collection.json`：

```json
{
  "info": {
    "name": "ChainlessChain API",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "variable": [
    {
      "key": "java_base_url",
      "value": "http://localhost:9090",
      "type": "string"
    },
    {
      "key": "python_base_url",
      "value": "http://localhost:8001",
      "type": "string"
    },
    {
      "key": "project_id",
      "value": "project_abc123",
      "type": "string"
    },
    {
      "key": "user_did",
      "value": "did:example:user1",
      "type": "string"
    }
  ],
  "item": [
    {
      "name": "Project Management",
      "item": [
        {
          "name": "Create Project",
          "request": {
            "method": "POST",
            "url": "{{java_base_url}}/api/projects/create",
            "header": [
              {
                "key": "Content-Type",
                "value": "application/json"
              }
            ],
            "body": {
              "mode": "raw",
              "raw": "{\n  \"userPrompt\": \"创建一个待办事项管理网站\",\n  \"projectType\": \"web\",\n  \"name\": \"我的待办事项\",\n  \"userId\": \"user123\"\n}"
            }
          }
        },
        {
          "name": "Get Project",
          "request": {
            "method": "GET",
            "url": "{{java_base_url}}/api/projects/{{project_id}}"
          }
        },
        {
          "name": "List Projects",
          "request": {
            "method": "GET",
            "url": "{{java_base_url}}/api/projects/list?pageNum=1&pageSize=10"
          }
        }
      ]
    },
    {
      "name": "File Management",
      "item": [
        {
          "name": "List Files",
          "request": {
            "method": "GET",
            "url": "{{java_base_url}}/api/projects/{{project_id}}/files"
          }
        },
        {
          "name": "Create File",
          "request": {
            "method": "POST",
            "url": "{{java_base_url}}/api/projects/{{project_id}}/files",
            "body": {
              "mode": "raw",
              "raw": "{\n  \"filePath\": \"src/main.js\",\n  \"fileName\": \"main.js\",\n  \"fileType\": \"javascript\",\n  \"content\": \"console.log('Hello');\"\n}"
            }
          }
        }
      ]
    },
    {
      "name": "Git Operations",
      "item": [
        {
          "name": "Git Status",
          "request": {
            "method": "GET",
            "url": "{{python_base_url}}/api/git/status?repo_path=/path/to/project"
          }
        },
        {
          "name": "Git Commit",
          "request": {
            "method": "POST",
            "url": "{{python_base_url}}/api/git/commit",
            "body": {
              "mode": "raw",
              "raw": "{\n  \"repo_path\": \"/path/to/project\",\n  \"message\": \"feat: 添加新功能\"\n}"
            }
          }
        }
      ]
    },
    {
      "name": "Code Assistant",
      "item": [
        {
          "name": "Generate Code",
          "request": {
            "method": "POST",
            "url": "{{python_base_url}}/api/code/generate",
            "body": {
              "mode": "raw",
              "raw": "{\n  \"description\": \"实现二分查找\",\n  \"language\": \"python\",\n  \"style\": \"modern\"\n}"
            }
          }
        },
        {
          "name": "Review Code",
          "request": {
            "method": "POST",
            "url": "{{python_base_url}}/api/code/review",
            "body": {
              "mode": "raw",
              "raw": "{\n  \"code\": \"function add(a, b) { return a + b; }\",\n  \"language\": \"javascript\"\n}"
            }
          }
        }
      ]
    }
  ]
}
```

---

## 快速开始

### 1. 启动服务

**Java服务**:
```bash
cd backend/project-service
mvn spring-boot:run
```

**Python服务**:
```bash
cd backend/ai-service
pip install -r requirements.txt
uvicorn main:app --reload --port 8001
```

### 2. 访问文档

- **Java Swagger UI**: http://localhost:9090/swagger-ui.html
- **Python FastAPI Docs**: http://localhost:8001/docs
- **Python ReDoc**: http://localhost:8001/redoc

### 3. 测试API

使用 Postman 导入上面的 Collection，或使用 curl：

```bash
# 创建项目
curl -X POST http://localhost:9090/api/projects/create \
  -H "Content-Type: application/json" \
  -d '{"userPrompt":"创建一个待办事项网站","projectType":"web","userId":"user123"}'

# 获取Git状态
curl http://localhost:8001/api/git/status?repo_path=/path/to/project

# 生成代码
curl -X POST http://localhost:8001/api/code/generate \
  -H "Content-Type: application/json" \
  -d '{"description":"实现二分查找","language":"python"}'
```

---

## 附录

### 数据库表结构

参考文件：`backend/project-service/src/main/resources/db/migration/V001__create_project_tables.sql`

### 环境变量

参考文件：`.env.example`

### 更新日志

- **v1.0.0** (2025-12-23)
  - 初始版本
  - 实现项目管理、文件管理、Git操作、RAG索引、代码助手、协作管理、评论管理、自动化规则共49个API端点

---

**文档维护者**: Claude Code
**最后更新**: 2025-12-23
