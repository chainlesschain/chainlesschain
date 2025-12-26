# PC端前后端联调测试计划

**版本**: v1.0
**创建日期**: 2025-12-26
**测试范围**: Desktop App (Electron + Vue3) ↔ Backend Services (project-service + ai-service)

---

## 目录

1. [测试环境准备](#测试环境准备)
2. [测试用例清单](#测试用例清单)
3. [测试执行计划](#测试执行计划)
4. [测试数据准备](#测试数据准备)
5. [问题跟踪](#问题跟踪)

---

## 测试环境准备

### 1.1 服务启动检查清单

| 服务 | 端口 | 启动命令 | 健康检查 | 状态 |
|------|------|----------|----------|------|
| **PostgreSQL** | 5432 | `docker-compose up -d postgres` | `pg_isready -h localhost -p 5432` | ⬜ |
| **Redis** | 6379 | `docker-compose up -d redis` | `redis-cli ping` | ⬜ |
| **Qdrant** | 6333 | `docker-compose up -d qdrant` | `curl http://localhost:6333/health` | ⬜ |
| **Ollama** | 11434 | `docker-compose up -d ollama` | `curl http://localhost:11434/api/tags` | ⬜ |
| **project-service** | 9090 | `cd backend/project-service && mvn spring-boot:run` | `curl http://localhost:9090/api/projects/health` | ⬜ |
| **ai-service** | 8001 | `cd backend/ai-service && uvicorn main:app --port 8001` | `curl http://localhost:8001/health` | ⬜ |
| **Desktop App** | 5173 | `cd desktop-app-vue && npm run dev` | 手动打开应用 | ⬜ |

### 1.2 环境变量配置

```bash
# Backend (project-service)
DB_HOST=localhost
DB_PORT=5432
DB_NAME=chainlesschain
DB_USER=chainlesschain
DB_PASSWORD=chainlesschain_pwd_2024

REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=chainlesschain_redis_2024

PROJECT_SERVICE_PORT=9090

# Backend (ai-service)
OLLAMA_HOST=http://localhost:11434
QDRANT_HOST=http://localhost:6333
AI_SERVICE_PORT=8001

# Desktop App
PROJECT_SERVICE_URL=http://localhost:9090
AI_SERVICE_URL=http://localhost:8001
```

### 1.3 数据库初始化

```bash
# 确保数据库表已创建
cd backend/project-service
mvn flyway:migrate  # 如果使用Flyway
# 或手动执行SQL脚本
```

### 1.4 LLM模型准备

```bash
# 拉取Ollama模型
docker exec chainlesschain-ollama ollama pull qwen2:7b
```

---

## 测试用例清单

### 模块1: 项目管理 (Project Management)

#### 1.1 创建项目 - 普通模式

**测试用例ID**: TC-PM-001
**优先级**: P0（核心功能）
**前置条件**:
- 用户已登录桌面应用
- project-service 和 ai-service 正常运行

**测试步骤**:
1. 打开桌面应用，进入"我的项目"页面
2. 点击"创建项目"按钮或在输入框输入需求
3. 输入项目需求: "创建一个个人博客网站"
4. 选择项目类型: "Web"（可选）
5. 点击"创建"按钮

**前端操作路径**:
```
ProjectsPage.vue → ConversationInput → handleConversationalCreate()
→ IPC: 'project:create' → main/index.js
→ HTTP POST http://localhost:8001/api/projects/create
```

**后端API**:
- **Method**: POST
- **URL**: `/api/projects/create`
- **Request Body**:
```json
{
  "user_prompt": "创建一个个人博客网站",
  "project_type": "web"
}
```

**预期结果**:
- ✅ 返回HTTP 200
- ✅ 响应包含项目ID、名称、类型、文件列表
- ✅ 前端显示创建成功消息
- ✅ 项目列表中出现新创建的项目
- ✅ 数据库中插入项目记录

**验证点**:
```sql
-- 验证PostgreSQL
SELECT * FROM projects WHERE user_id = 'test_user' ORDER BY created_at DESC LIMIT 1;
SELECT * FROM project_files WHERE project_id = '<project_id>';
```

**测试状态**: ⬜ 未测试 | ⬜ 通过 | ⬜ 失败

---

#### 1.2 创建项目 - 流式模式（SSE）

**测试用例ID**: TC-PM-002
**优先级**: P0（核心功能）

**测试步骤**:
1. 在"我的项目"页面输入需求
2. 观察流式进度显示

**前端操作路径**:
```
ProjectsPage.vue → handleConversationalCreate()
→ IPC: 'project:create' (with streaming: true)
→ HTTP POST http://localhost:8001/api/projects/create/stream (SSE)
```

**后端API**:
- **Method**: POST
- **URL**: `/api/projects/create/stream`
- **Response**: Server-Sent Events (SSE)

**预期SSE事件序列**:
1. `type: "progress"` - 意图识别阶段
2. `type: "progress"` - 任务规划阶段
3. `type: "progress"` - 代码生成阶段
4. `type: "content"` - 生成的文件内容（多次）
5. `type: "complete"` - 项目创建完成

**前端验证**:
- ✅ StreamProgressModal 正确显示进度
- ✅ 每个阶段的进度百分比正确更新
- ✅ 显示正在生成的文件名称
- ✅ 完成后自动跳转到项目详情页

**测试状态**: ⬜ 未测试 | ⬜ 通过 | ⬜ 失败

---

#### 1.3 获取项目列表

**测试用例ID**: TC-PM-003
**优先级**: P0

**测试步骤**:
1. 打开桌面应用
2. 进入"我的项目"页面
3. 观察项目列表加载

**前端操作路径**:
```
ProjectsPage.vue → onMounted() → loadProjects()
→ IPC: 'project:list'
→ HTTP GET http://localhost:9090/api/projects/list?userId=xxx&pageNum=1&pageSize=100
```

**后端API**:
- **Method**: GET
- **URL**: `/api/projects/list`
- **Query Params**: `userId`, `pageNum`, `pageSize`

**预期结果**:
- ✅ 返回分页数据结构: `{ records: [], total: 0, current: 1, size: 100 }`
- ✅ 项目按创建时间倒序排列
- ✅ 前端正确渲染项目卡片
- ✅ 分页组件正常工作

**测试数据**:
- 创建至少 25 个测试项目，验证分页功能

**测试状态**: ⬜ 未测试 | ⬜ 通过 | ⬜ 失败

---

#### 1.4 获取项目详情

**测试用例ID**: TC-PM-004
**优先级**: P0

**测试步骤**:
1. 在项目列表中点击某个项目卡片
2. 进入项目详情页

**前端操作路径**:
```
ProjectCard.vue → @view → handleViewProject(projectId)
→ router.push(`/projects/${projectId}`)
→ ProjectDetailPage.vue → onMounted()
→ IPC: 'project:get'
→ HTTP GET http://localhost:9090/api/projects/{projectId}
```

**后端API**:
- **Method**: GET
- **URL**: `/api/projects/{projectId}`

**预期结果**:
- ✅ 返回项目详细信息
- ✅ 包含文件列表
- ✅ 前端正确显示项目名称、描述、类型
- ✅ 文件树正确渲染

**测试状态**: ⬜ 未测试 | ⬜ 通过 | ⬜ 失败

---

#### 1.5 更新项目信息

**测试用例ID**: TC-PM-005
**优先级**: P1

**测试步骤**:
1. 进入项目详情页
2. 修改项目名称或描述
3. 点击保存

**前端操作路径**:
```
ProjectDetailPage.vue → handleSaveProject()
→ IPC: 'project:update'
→ HTTP PUT http://localhost:9090/api/projects/{projectId}
```

**后端API**:
- **Method**: PUT
- **URL**: `/api/projects/{projectId}`
- **Request Body**:
```json
{
  "name": "新项目名称",
  "description": "新描述"
}
```

**预期结果**:
- ✅ 返回更新后的项目信息
- ✅ 前端显示成功消息
- ✅ 数据库记录已更新
- ✅ 更新时间字段（updated_at）自动更新

**测试状态**: ⬜ 未测试 | ⬜ 通过 | ⬜ 失败

---

#### 1.6 删除项目

**测试用例ID**: TC-PM-006
**优先级**: P1

**测试步骤**:
1. 在项目列表中选择一个项目
2. 点击删除按钮
3. 确认删除操作

**前端操作路径**:
```
ProjectCard.vue → @delete → handleDeleteProject(projectId)
→ Modal.confirm() → IPC: 'project:delete'
→ HTTP DELETE http://localhost:9090/api/projects/{projectId}
```

**后端API**:
- **Method**: DELETE
- **URL**: `/api/projects/{projectId}`

**预期结果**:
- ✅ 返回HTTP 200
- ✅ 项目从列表中消失
- ✅ 数据库中项目状态更新为已删除或物理删除
- ✅ 相关文件记录处理正确（级联删除或标记删除）

**验证点**:
```sql
SELECT * FROM projects WHERE id = '<project_id>';
SELECT * FROM project_files WHERE project_id = '<project_id>';
```

**测试状态**: ⬜ 未测试 | ⬜ 通过 | ⬜ 失败

---

#### 1.7 导出项目

**测试用例ID**: TC-PM-007
**优先级**: P2

**测试步骤**:
1. 进入项目详情页
2. 点击"导出"按钮
3. 选择导出格式（ZIP）
4. 下载文件

**前端操作路径**:
```
ProjectDetailPage.vue → handleExportProject()
→ IPC: 'project:exportDocument'
→ HTTP POST http://localhost:9090/api/projects/{projectId}/export
```

**后端API**:
- **Method**: POST
- **URL**: `/api/projects/{projectId}/export`
- **Query Params**: `format=zip`, `includeHistory=true`, `includeComments=false`

**预期结果**:
- ✅ 返回ZIP文件下载链接或文件流
- ✅ ZIP包含所有项目文件
- ✅ 文件结构保持正确
- ✅ 如果includeHistory=true，包含版本历史

**测试状态**: ⬜ 未测试 | ⬜ 通过 | ⬜ 失败

---

### 模块2: 文件管理 (File Management)

#### 2.1 获取文件列表

**测试用例ID**: TC-FM-001
**优先级**: P0

**测试步骤**:
1. 打开项目详情页
2. 观察文件树加载

**前端操作路径**:
```
ProjectDetailPage.vue → onMounted() → loadProjectFiles()
→ IPC: 'project:get-files'
→ HTTP GET http://localhost:9090/api/projects/{projectId}/files
```

**后端API**:
- **Method**: GET
- **URL**: `/api/projects/{projectId}/files`
- **Query Params**: `fileType` (可选), `pageNum`, `pageSize`

**预期结果**:
- ✅ 返回文件列表（分页）
- ✅ 包含文件名、路径、类型、大小、更新时间
- ✅ 前端正确构建文件树结构
- ✅ 支持按文件类型筛选

**测试状态**: ⬜ 未测试 | ⬜ 通过 | ⬜ 失败

---

#### 2.2 获取单个文件内容

**测试用例ID**: TC-FM-002
**优先级**: P0

**测试步骤**:
1. 在文件树中点击某个文件
2. 观察文件内容加载到编辑器

**前端操作路径**:
```
FileTree.vue → handleFileClick(file)
→ IPC: 'project:get-file' (或直接HTTP)
→ HTTP GET http://localhost:9090/api/projects/{projectId}/files/{fileId}
```

**后端API**:
- **Method**: GET
- **URL**: `/api/projects/{projectId}/files/{fileId}`

**预期结果**:
- ✅ 返回文件详情（包含内容）
- ✅ 内容正确渲染在编辑器中
- ✅ 支持代码高亮（根据文件类型）

**测试状态**: ⬜ 未测试 | ⬜ 通过 | ⬜ 失败

---

#### 2.3 创建文件

**测试用例ID**: TC-FM-003
**优先级**: P0

**测试步骤**:
1. 在项目详情页点击"新建文件"
2. 输入文件名和路径
3. 输入初始内容
4. 点击保存

**前端操作路径**:
```
ProjectDetailPage.vue → handleCreateFile()
→ IPC: 'project:save-files'
→ HTTP POST http://localhost:9090/api/projects/{projectId}/files
```

**后端API**:
- **Method**: POST
- **URL**: `/api/projects/{projectId}/files`
- **Request Body**:
```json
{
  "file_name": "index.html",
  "file_path": "/",
  "content": "<!DOCTYPE html>...",
  "file_type": "html"
}
```

**预期结果**:
- ✅ 文件创建成功
- ✅ 返回新文件的ID和详情
- ✅ 文件树中出现新文件
- ✅ 数据库中插入记录

**验证点**:
```sql
SELECT * FROM project_files WHERE project_id = '<project_id>' AND file_name = 'index.html';
```

**测试状态**: ⬜ 未测试 | ⬜ 通过 | ⬜ 失败

---

#### 2.4 批量创建文件

**测试用例ID**: TC-FM-004
**优先级**: P1

**测试步骤**:
1. 使用AI生成多个文件（如创建项目时）
2. 验证所有文件正确保存

**前端操作路径**:
```
AI Engine → 生成多个文件
→ IPC: 'project:save-files' (批量)
→ HTTP POST http://localhost:9090/api/projects/{projectId}/files/batch
```

**后端API**:
- **Method**: POST
- **URL**: `/api/projects/{projectId}/files/batch`
- **Request Body**:
```json
{
  "files": [
    {
      "file_name": "index.html",
      "file_path": "/",
      "content": "...",
      "file_type": "html"
    },
    {
      "file_name": "style.css",
      "file_path": "/css",
      "content": "...",
      "file_type": "css"
    }
  ]
}
```

**预期结果**:
- ✅ 所有文件创建成功
- ✅ 返回创建的文件列表
- ✅ 数据库中批量插入记录
- ✅ 事务处理正确（全部成功或全部回滚）

**测试状态**: ⬜ 未测试 | ⬜ 通过 | ⬜ 失败

---

#### 2.5 更新文件内容

**测试用例ID**: TC-FM-005
**优先级**: P0

**测试步骤**:
1. 在编辑器中修改文件内容
2. 点击保存或自动保存

**前端操作路径**:
```
FileEditor.vue → handleSave()
→ IPC: 'project:update-file'
→ HTTP PUT http://localhost:9090/api/projects/{projectId}/files/{fileId}
```

**后端API**:
- **Method**: PUT
- **URL**: `/api/projects/{projectId}/files/{fileId}`
- **Request Body**:
```json
{
  "content": "新的文件内容",
  "version": 2
}
```

**预期结果**:
- ✅ 文件内容更新成功
- ✅ 版本号递增
- ✅ 更新时间更新
- ✅ 前端显示保存成功提示

**并发控制测试**:
- 测试两个用户同时编辑同一文件（乐观锁）

**测试状态**: ⬜ 未测试 | ⬜ 通过 | ⬜ 失败

---

#### 2.6 删除文件

**测试用例ID**: TC-FM-006
**优先级**: P1

**测试步骤**:
1. 在文件树中右键点击文件
2. 选择"删除"
3. 确认删除

**前端操作路径**:
```
FileTree.vue → handleDeleteFile(fileId)
→ IPC: 'project:delete-file'
→ HTTP DELETE http://localhost:9090/api/projects/{projectId}/files/{fileId}
```

**后端API**:
- **Method**: DELETE
- **URL**: `/api/projects/{projectId}/files/{fileId}`

**预期结果**:
- ✅ 文件删除成功
- ✅ 文件树中移除该文件
- ✅ 数据库记录删除或标记为已删除

**测试状态**: ⬜ 未测试 | ⬜ 通过 | ⬜ 失败

---

#### 2.7 搜索文件

**测试用例ID**: TC-FM-007
**优先级**: P2

**测试步骤**:
1. 在项目详情页使用搜索框
2. 输入关键词
3. 查看搜索结果

**前端操作路径**:
```
ProjectDetailPage.vue → handleSearch(keyword)
→ IPC: 'project:search-files'
→ HTTP GET http://localhost:9090/api/projects/{projectId}/files/search?query=xxx
```

**后端API**:
- **Method**: GET
- **URL**: `/api/projects/{projectId}/files/search`
- **Query Params**: `query`, `fileType`, `pageNum`, `pageSize`

**预期结果**:
- ✅ 返回匹配的文件列表
- ✅ 支持文件名和内容搜索
- ✅ 搜索结果高亮显示
- ✅ 支持分页

**测试状态**: ⬜ 未测试 | ⬜ 通过 | ⬜ 失败

---

#### 2.8 文件版本历史

**测试用例ID**: TC-FM-008
**优先级**: P2

**测试步骤**:
1. 打开文件详情
2. 点击"查看历史版本"
3. 选择某个历史版本
4. 点击"恢复到此版本"

**前端操作路径**:
```
VersionHistoryDrawer.vue → loadVersionHistory()
→ HTTP GET http://localhost:9090/api/projects/{projectId}/files/{fileId}/versions

→ handleRestore(versionId)
→ HTTP POST http://localhost:9090/api/projects/{projectId}/files/{fileId}/versions/{versionId}/restore
```

**后端API**:
- **Method**: GET
- **URL**: `/api/projects/{projectId}/files/{fileId}/versions`
- **Method**: POST
- **URL**: `/api/projects/{projectId}/files/{fileId}/versions/{versionId}/restore`

**预期结果**:
- ✅ 显示版本列表（包含时间、作者、更改摘要）
- ✅ 能够查看历史版本内容
- ✅ 恢复版本成功
- ✅ 恢复后创建新版本（保留历史）

**测试状态**: ⬜ 未测试 | ⬜ 通过 | ⬜ 失败

---

### 模块3: AI功能 (AI Features)

#### 3.1 AI对话 - 流式响应

**测试用例ID**: TC-AI-001
**优先级**: P0

**测试步骤**:
1. 打开AI聊天页面或项目内聊天面板
2. 输入问题："帮我写一个Python排序算法"
3. 观察流式响应

**前端操作路径**:
```
ChatPanel.vue → handleSendMessage(message)
→ IPC: 'llm:chat-stream'
→ HTTP POST http://localhost:8001/api/chat/stream (SSE)
```

**后端API**:
- **Method**: POST
- **URL**: `/api/chat/stream`
- **Request Body**:
```json
{
  "messages": [
    {"role": "user", "content": "帮我写一个Python排序算法"}
  ],
  "model": "qwen2:7b",
  "temperature": 0.7
}
```
- **Response**: Server-Sent Events

**预期结果**:
- ✅ 逐字返回AI回复（流式）
- ✅ 前端实时显示打字效果
- ✅ 支持Markdown渲染
- ✅ 代码块正确高亮
- ✅ 对话历史正确保存

**性能要求**:
- 首字延迟 < 2秒
- 流式响应流畅，无卡顿

**测试状态**: ⬜ 未测试 | ⬜ 通过 | ⬜ 失败

---

#### 3.2 RAG查询 - 基础检索

**测试用例ID**: TC-AI-002
**优先级**: P0

**测试步骤**:
1. 打开已索引的项目
2. 在聊天框输入："这个项目的主要功能是什么？"
3. 观察RAG增强的回复

**前端操作路径**:
```
ChatPanel.vue → handleSendMessage() (with RAG enabled)
→ IPC: 'rag:retrieve'
→ HTTP POST http://localhost:8001/api/rag/query
```

**后端API**:
- **Method**: POST
- **URL**: `/api/rag/query`
- **Query Params**: `query`, `project_id`

**预期结果**:
- ✅ 返回相关文档片段
- ✅ 包含相似度得分
- ✅ AI回复基于检索到的上下文
- ✅ 响应中引用了具体文件

**测试数据准备**:
- 创建包含至少10个文件的项目
- 提前索引项目内容

**测试状态**: ⬜ 未测试 | ⬜ 通过 | ⬜ 失败

---

#### 3.3 RAG索引 - 项目文件索引

**测试用例ID**: TC-AI-003
**优先级**: P0

**测试步骤**:
1. 打开项目详情页
2. 点击"重建索引"按钮
3. 观察索引进度

**前端操作路径**:
```
RAGIndexPanel.vue → handleRebuildIndex()
→ IPC: 'rag:rebuild-index'
→ HTTP POST http://localhost:8001/api/rag/index/project
```

**后端API**:
- **Method**: POST
- **URL**: `/api/rag/index/project`
- **Request Body**:
```json
{
  "project_id": "xxx",
  "repo_path": "/path/to/project",
  "file_types": ["js", "py", "md"],
  "force_reindex": true
}
```

**预期结果**:
- ✅ 索引任务启动成功
- ✅ 前端显示索引进度
- ✅ 索引完成后显示统计信息（文件数、向量数）
- ✅ Qdrant中存储向量数据

**验证点**:
```bash
# 检查Qdrant集合
curl http://localhost:6333/collections/project_<project_id>
```

**测试状态**: ⬜ 未测试 | ⬜ 通过 | ⬜ 失败

---

#### 3.4 RAG增强查询 - 带重排序

**测试用例ID**: TC-AI-004
**优先级**: P1

**测试步骤**:
1. 启用重排序功能
2. 执行RAG查询
3. 对比有无重排序的结果差异

**前端操作路径**:
```
RAGSettings.vue → enableReranking(true)
→ IPC: 'rag:set-reranking-enabled'

ChatPanel → 查询时使用增强模式
→ HTTP POST http://localhost:8001/api/rag/query/enhanced
```

**后端API**:
- **Method**: POST
- **URL**: `/api/rag/query/enhanced`
- **Request Body**:
```json
{
  "project_id": "xxx",
  "query": "如何实现用户登录？",
  "top_k": 5,
  "use_reranker": true,
  "sources": ["project"]
}
```

**预期结果**:
- ✅ 返回重排序后的结果
- ✅ 结果相关性更高
- ✅ 包含重排序得分

**测试状态**: ⬜ 未测试 | ⬜ 通过 | ⬜ 失败

---

#### 3.5 代码生成

**测试用例ID**: TC-AI-005
**优先级**: P0

**测试步骤**:
1. 在项目详情页点击"AI助手"
2. 输入："生成一个用户登录表单组件（Vue3）"
3. 点击生成

**前端操作路径**:
```
CodeAssistantPanel.vue → handleGenerateCode()
→ IPC: 'code:generate'
→ HTTP POST http://localhost:8001/api/code/generate
```

**后端API**:
- **Method**: POST
- **URL**: `/api/code/generate`
- **Request Body**:
```json
{
  "description": "生成一个用户登录表单组件（Vue3）",
  "language": "javascript",
  "style": "modern",
  "include_tests": false,
  "include_comments": true
}
```

**预期结果**:
- ✅ 返回生成的代码
- ✅ 代码语法正确
- ✅ 包含注释说明
- ✅ 前端可以直接插入到文件

**测试状态**: ⬜ 未测试 | ⬜ 通过 | ⬜ 失败

---

#### 3.6 代码审查

**测试用例ID**: TC-AI-006
**优先级**: P1

**测试步骤**:
1. 选择一个代码文件
2. 点击"AI审查"
3. 查看审查报告

**前端操作路径**:
```
FileEditor.vue → handleCodeReview()
→ IPC: 'code:review'
→ HTTP POST http://localhost:8001/api/code/review
```

**后端API**:
- **Method**: POST
- **URL**: `/api/code/review`
- **Request Body**:
```json
{
  "code": "function add(a, b) { return a + b; }",
  "language": "javascript",
  "focus_areas": ["performance", "security", "style"]
}
```

**预期结果**:
- ✅ 返回审查报告（问题列表、建议）
- ✅ 按严重程度分类（error, warning, info）
- ✅ 提供修改建议
- ✅ 前端正确展示报告

**测试状态**: ⬜ 未测试 | ⬜ 通过 | ⬜ 失败

---

#### 3.7 代码重构

**测试用例ID**: TC-AI-007
**优先级**: P2

**测试步骤**:
1. 选择代码片段
2. 点击"重构" → 选择重构类型
3. 查看重构结果

**前端操作路径**:
```
CodeAssistantPanel.vue → handleRefactor(code, type)
→ IPC: 'code:refactor'
→ HTTP POST http://localhost:8001/api/code/refactor
```

**后端API**:
- **Method**: POST
- **URL**: `/api/code/refactor`
- **Request Body**:
```json
{
  "code": "原始代码",
  "language": "javascript",
  "refactor_type": "modularity",
  "target": "提取函数"
}
```

**预期结果**:
- ✅ 返回重构后的代码
- ✅ 保持功能一致性
- ✅ 代码质量提升
- ✅ 提供重构说明

**测试状态**: ⬜ 未测试 | ⬜ 通过 | ⬜ 失败

---

### 模块4: Git操作 (Git Operations)

#### 4.1 Git初始化

**测试用例ID**: TC-GIT-001
**优先级**: P1

**测试步骤**:
1. 创建新项目（未初始化Git）
2. 点击"初始化Git仓库"
3. 配置远程仓库URL（可选）

**前端操作路径**:
```
GitSettings.vue → handleGitInit()
→ IPC: 'project:git-init'
→ HTTP POST http://localhost:8001/api/git/init
```

**后端API**:
- **Method**: POST
- **URL**: `/api/git/init`
- **Request Body**:
```json
{
  "repo_path": "/path/to/project",
  "remote_url": "https://github.com/user/repo.git",
  "branch_name": "main"
}
```

**预期结果**:
- ✅ Git仓库初始化成功
- ✅ 创建.git目录
- ✅ 如果提供remote_url，添加origin远程
- ✅ 前端显示Git状态图标

**测试状态**: ⬜ 未测试 | ⬜ 通过 | ⬜ 失败

---

#### 4.2 Git状态查询

**测试用例ID**: TC-GIT-002
**优先级**: P0

**测试步骤**:
1. 修改某个文件
2. 观察Git状态更新

**前端操作路径**:
```
GitStatusDialog.vue → loadGitStatus()
→ IPC: 'project:git-status'
→ HTTP GET http://localhost:8001/api/git/status?repo_path=xxx
```

**后端API**:
- **Method**: GET
- **URL**: `/api/git/status`
- **Query Params**: `repo_path`

**预期结果**:
- ✅ 返回工作区状态
- ✅ 列出已修改、新增、删除的文件
- ✅ 显示当前分支名称
- ✅ 前端正确渲染状态图标

**测试状态**: ⬜ 未测试 | ⬜ 通过 | ⬜ 失败

---

#### 4.3 Git提交

**测试用例ID**: TC-GIT-003
**优先级**: P0

**测试步骤**:
1. 修改文件并保存
2. 打开Git面板
3. 输入提交信息或使用AI生成
4. 点击提交

**前端操作路径**:
```
GitStatusDialog.vue → handleCommit(message, files)
→ IPC: 'project:git-commit'
→ HTTP POST http://localhost:8001/api/git/commit
```

**后端API**:
- **Method**: POST
- **URL**: `/api/git/commit`
- **Request Body**:
```json
{
  "repo_path": "/path/to/project",
  "message": "feat: 添加用户登录功能",
  "files": ["src/Login.vue", "src/api/auth.js"],
  "auto_generate_message": false
}
```

**预期结果**:
- ✅ 提交成功
- ✅ 返回commit hash
- ✅ 工作区变为干净状态
- ✅ 提交历史中出现新记录

**测试状态**: ⬜ 未测试 | ⬜ 通过 | ⬜ 失败

---

#### 4.4 AI生成提交信息

**测试用例ID**: TC-GIT-004
**优先级**: P1

**测试步骤**:
1. 修改多个文件
2. 点击"AI生成提交信息"
3. 查看生成的提交信息
4. 确认并提交

**前端操作路径**:
```
GitStatusDialog.vue → handleGenerateCommitMessage()
→ IPC: 'project:git-generate-commit-message'
→ HTTP POST http://localhost:8001/api/git/generate-commit-message
```

**后端API**:
- **Method**: POST
- **URL**: `/api/git/generate-commit-message`
- **Request Body**:
```json
{
  "repo_path": "/path/to/project",
  "staged_files": ["file1.js", "file2.css"],
  "diff": "git diff内容"
}
```

**预期结果**:
- ✅ 返回符合约定式提交的消息
- ✅ 消息格式：`<type>(<scope>): <subject>`
- ✅ 准确描述更改内容
- ✅ 前端自动填充到输入框

**测试状态**: ⬜ 未测试 | ⬜ 通过 | ⬜ 失败

---

#### 4.5 Git推送

**测试用例ID**: TC-GIT-005
**优先级**: P1

**测试步骤**:
1. 完成本地提交
2. 点击"推送到远程"
3. 输入凭据（如需要）

**前端操作路径**:
```
GitStatusDialog.vue → handlePush()
→ IPC: 'project:git-push'
→ HTTP POST http://localhost:8001/api/git/push
```

**后端API**:
- **Method**: POST
- **URL**: `/api/git/push`
- **Request Body**:
```json
{
  "repo_path": "/path/to/project",
  "remote": "origin",
  "branch": "main"
}
```

**预期结果**:
- ✅ 推送成功
- ✅ 远程仓库更新
- ✅ 前端显示成功消息
- ✅ 本地和远程状态同步

**错误处理测试**:
- 测试网络断开情况
- 测试权限不足情况
- 测试冲突情况

**测试状态**: ⬜ 未测试 | ⬜ 通过 | ⬜ 失败

---

#### 4.6 Git拉取

**测试用例ID**: TC-GIT-006
**优先级**: P1

**测试步骤**:
1. 远程仓库有新提交
2. 点击"从远程拉取"
3. 观察本地更新

**前端操作路径**:
```
GitStatusDialog.vue → handlePull()
→ IPC: 'project:git-pull'
→ HTTP POST http://localhost:8001/api/git/pull
```

**后端API**:
- **Method**: POST
- **URL**: `/api/git/pull`
- **Request Body**:
```json
{
  "repo_path": "/path/to/project",
  "remote": "origin",
  "branch": "main"
}
```

**预期结果**:
- ✅ 拉取成功
- ✅ 本地文件更新
- ✅ 如果有冲突，提示用户解决
- ✅ 前端刷新文件列表

**测试状态**: ⬜ 未测试 | ⬜ 通过 | ⬜ 失败

---

#### 4.7 分支管理

**测试用例ID**: TC-GIT-007
**优先级**: P2

**测试步骤**:
1. 查看分支列表
2. 创建新分支"feature/login"
3. 切换到新分支
4. 合并分支

**前端操作路径**:
```
GitStatusDialog.vue → handleBranchOperation()

# 列出分支
→ HTTP GET http://localhost:8001/api/git/branches?repo_path=xxx

# 创建分支
→ HTTP POST http://localhost:8001/api/git/branch/create

# 切换分支
→ HTTP POST http://localhost:8001/api/git/branch/checkout

# 合并分支
→ HTTP POST http://localhost:8001/api/git/merge
```

**后端API（多个）**:
- **GET** `/api/git/branches`
- **POST** `/api/git/branch/create`
- **POST** `/api/git/branch/checkout`
- **POST** `/api/git/merge`

**预期结果**:
- ✅ 分支列表正确显示
- ✅ 新分支创建成功
- ✅ 分支切换正常
- ✅ 合并操作正确

**测试状态**: ⬜ 未测试 | ⬜ 通过 | ⬜ 失败

---

#### 4.8 AI辅助冲突解决

**测试用例ID**: TC-GIT-008
**优先级**: P2

**测试步骤**:
1. 制造Git冲突（本地和远程修改同一文件）
2. 拉取时检测到冲突
3. 点击"AI解决冲突"
4. 查看建议方案并应用

**前端操作路径**:
```
GitConflictResolver.vue → handleAIResolve()
→ IPC: 'project:git-resolve-conflicts'
→ HTTP POST http://localhost:8001/api/git/resolve-conflicts
```

**后端API**:
- **Method**: POST
- **URL**: `/api/git/resolve-conflicts`
- **Request Body**:
```json
{
  "repo_path": "/path/to/project",
  "file_path": "src/App.vue",
  "auto_resolve": true,
  "strategy": "merge_both"
}
```

**预期结果**:
- ✅ AI分析冲突内容
- ✅ 提供合并建议
- ✅ 生成解决后的代码
- ✅ 用户确认后应用更改

**测试状态**: ⬜ 未测试 | ⬜ 通过 | ⬜ 失败

---

### 模块5: 协作功能 (Collaboration)

#### 5.1 添加协作者

**测试用例ID**: TC-COLLAB-001
**优先级**: P2

**测试步骤**:
1. 打开项目设置
2. 点击"添加协作者"
3. 输入用户DID
4. 设置权限（读/写/管理员）

**前端操作路径**:
```
ProjectSettings.vue → handleAddCollaborator()
→ IPC: 'project:add-collaborator'
→ HTTP POST http://localhost:9090/api/projects/{projectId}/collaborators
```

**后端API**:
- **Method**: POST
- **URL**: `/api/projects/{projectId}/collaborators`
- **Request Body**:
```json
{
  "collaborator_did": "did:key:z6Mk...",
  "permission": "write",
  "role": "developer"
}
```
- **Headers**: `User-DID: <current_user_did>`

**预期结果**:
- ✅ 协作者添加成功
- ✅ 返回协作者信息
- ✅ 数据库中插入记录
- ✅ 前端列表中显示新协作者

**测试状态**: ⬜ 未测试 | ⬜ 通过 | ⬜ 失败

---

#### 5.2 评论功能

**测试用例ID**: TC-COLLAB-002
**优先级**: P2

**测试步骤**:
1. 打开文件
2. 选择代码行
3. 添加评论："这里需要优化性能"
4. @提及其他协作者

**前端操作路径**:
```
FileEditor.vue → handleAddComment()
→ IPC: 'project:add-comment'
→ HTTP POST http://localhost:9090/api/projects/{projectId}/comments
```

**后端API**:
- **Method**: POST
- **URL**: `/api/projects/{projectId}/comments`
- **Request Body**:
```json
{
  "file_path": "src/utils/helper.js",
  "line_number": 42,
  "content": "这里需要优化性能 @did:key:z6Mk...",
  "parent_id": null
}
```
- **Headers**: `User-DID: <current_user_did>`

**预期结果**:
- ✅ 评论创建成功
- ✅ 前端显示评论气泡
- ✅ 支持回复评论
- ✅ @提及的用户收到通知

**测试状态**: ⬜ 未测试 | ⬜ 通过 | ⬜ 失败

---

### 模块6: 自动化 (Automation)

#### 6.1 创建自动化规则

**测试用例ID**: TC-AUTO-001
**优先级**: P2

**测试步骤**:
1. 打开自动化面板
2. 创建规则："当文件保存时，自动格式化代码"
3. 配置触发器和动作

**前端操作路径**:
```
AutomationRulesPanel.vue → handleCreateRule()
→ IPC: 'automation:createRule'
→ HTTP POST http://localhost:9090/api/projects/{projectId}/automation/rules
```

**后端API**:
- **Method**: POST
- **URL**: `/api/projects/{projectId}/automation/rules`
- **Request Body**:
```json
{
  "name": "自动格式化代码",
  "trigger": {
    "type": "file_save",
    "conditions": {
      "file_extension": ["js", "vue"]
    }
  },
  "actions": [
    {
      "type": "format_code",
      "params": {"formatter": "prettier"}
    }
  ],
  "is_enabled": true
}
```

**预期结果**:
- ✅ 规则创建成功
- ✅ 触发器正确注册
- ✅ 保存文件时自动执行
- ✅ 前端显示执行日志

**测试状态**: ⬜ 未测试 | ⬜ 通过 | ⬜ 失败

---

#### 6.2 手动触发规则

**测试用例ID**: TC-AUTO-002
**优先级**: P2

**测试步骤**:
1. 选择一条自动化规则
2. 点击"立即执行"

**前端操作路径**:
```
AutomationRulesPanel.vue → handleTriggerRule(ruleId)
→ IPC: 'automation:manualTrigger'
→ HTTP POST http://localhost:9090/api/projects/{projectId}/automation/rules/{ruleId}/trigger
```

**后端API**:
- **Method**: POST
- **URL**: `/api/projects/{projectId}/automation/rules/{ruleId}/trigger`

**预期结果**:
- ✅ 规则立即执行
- ✅ 返回执行结果
- ✅ 前端显示执行状态
- ✅ 统计数据更新

**测试状态**: ⬜ 未测试 | ⬜ 通过 | ⬜ 失败

---

### 模块7: 数据同步 (Data Sync)

#### 7.1 增量数据上传

**测试用例ID**: TC-SYNC-001
**优先级**: P1

**测试步骤**:
1. 在桌面应用修改数据（如新建项目、更新文件）
2. 触发同步
3. 观察数据上传到后端

**前端操作路径**:
```
SyncManager.vue → handleSync()
→ IPC: 'sync:start'
→ HTTP POST http://localhost:9090/api/sync/upload
```

**后端API**:
- **Method**: POST
- **URL**: `/api/sync/upload`
- **Request Body**:
```json
{
  "device_id": "desktop-001",
  "sync_data": {
    "projects": [
      {
        "action": "update",
        "id": "proj-123",
        "data": {...},
        "timestamp": 1704067200000
      }
    ],
    "files": [
      {
        "action": "create",
        "data": {...},
        "timestamp": 1704067200000
      }
    ]
  }
}
```

**预期结果**:
- ✅ 数据上传成功
- ✅ 后端正确处理增量更新
- ✅ 返回同步确认
- ✅ 本地同步时间戳更新

**测试状态**: ⬜ 未测试 | ⬜ 通过 | ⬜ 失败

---

#### 7.2 增量数据下载

**测试用例ID**: TC-SYNC-002
**优先级**: P1

**测试步骤**:
1. 在另一设备修改数据
2. 桌面应用触发同步拉取
3. 观察本地数据更新

**前端操作路径**:
```
SyncManager.vue → handlePullUpdates()
→ IPC: 'sync:download'
→ HTTP GET http://localhost:9090/api/sync/download/projects?lastSyncedAt=xxx&deviceId=xxx
```

**后端API**:
- **Method**: GET
- **URL**: `/api/sync/download/{tableName}`
- **Query Params**: `lastSyncedAt` (毫秒时间戳), `deviceId`

**预期结果**:
- ✅ 返回自上次同步以来的变更
- ✅ 包含新增、修改、删除的记录
- ✅ 前端正确应用变更
- ✅ 本地数据库更新

**测试状态**: ⬜ 未测试 | ⬜ 通过 | ⬜ 失败

---

#### 7.3 同步冲突解决

**测试用例ID**: TC-SYNC-003
**优先级**: P1

**测试步骤**:
1. 两个设备同时修改同一项目
2. 触发同步
3. 检测到冲突
4. 选择解决策略

**前端操作路径**:
```
SyncConflictDialog.vue → handleResolveConflict(strategy)
→ IPC: 'sync:resolve-conflict'
→ HTTP POST http://localhost:9090/api/sync/resolve-conflict
```

**后端API**:
- **Method**: POST
- **URL**: `/api/sync/resolve-conflict`
- **Request Body**:
```json
{
  "conflict_id": "conflict-123",
  "resolution_strategy": "use_remote",
  "table_name": "projects",
  "record_id": "proj-123"
}
```

**预期结果**:
- ✅ 冲突解决成功
- ✅ 根据策略保留正确版本
- ✅ 前端数据更新
- ✅ 冲突记录归档

**测试策略**:
- `use_local`: 保留本地版本
- `use_remote`: 使用远程版本
- `merge`: 合并两个版本

**测试状态**: ⬜ 未测试 | ⬜ 通过 | ⬜ 失败

---

### 模块8: 健康检查和监控 (Health & Monitoring)

#### 8.1 服务健康检查

**测试用例ID**: TC-HEALTH-001
**优先级**: P1

**测试步骤**:
1. 桌面应用启动时
2. 检查所有后端服务状态

**前端操作路径**:
```
App.vue → onMounted() → checkServicesHealth()
→ IPC: 'services:health-check'

# project-service
→ HTTP GET http://localhost:9090/api/projects/health

# ai-service
→ HTTP GET http://localhost:8001/health
```

**后端API**:
- **project-service**: `GET /api/projects/health`
- **ai-service**: `GET /health`

**预期结果**:
- ✅ 所有服务返回健康状态
- ✅ 响应包含版本号、运行时间
- ✅ 前端显示服务状态指示器
- ✅ 服务异常时显示警告

**健康检查响应示例**:
```json
{
  "status": "healthy",
  "version": "1.0.0",
  "uptime": 3600,
  "dependencies": {
    "database": "healthy",
    "redis": "healthy",
    "ollama": "healthy"
  }
}
```

**测试状态**: ⬜ 未测试 | ⬜ 通过 | ⬜ 失败

---

## 测试执行计划

### 阶段1: 基础功能测试（第1-2天）

**目标**: 验证核心CRUD操作

| 测试用例ID | 模块 | 优先级 | 预计时间 | 执行顺序 |
|-----------|------|--------|---------|---------|
| TC-PM-001 | 项目管理 - 创建项目 | P0 | 30分钟 | 1 |
| TC-PM-003 | 项目管理 - 获取列表 | P0 | 20分钟 | 2 |
| TC-PM-004 | 项目管理 - 获取详情 | P0 | 20分钟 | 3 |
| TC-FM-001 | 文件管理 - 获取文件列表 | P0 | 20分钟 | 4 |
| TC-FM-002 | 文件管理 - 获取单个文件 | P0 | 15分钟 | 5 |
| TC-FM-003 | 文件管理 - 创建文件 | P0 | 30分钟 | 6 |
| TC-FM-005 | 文件管理 - 更新文件 | P0 | 30分钟 | 7 |
| TC-PM-005 | 项目管理 - 更新项目 | P1 | 20分钟 | 8 |
| TC-PM-006 | 项目管理 - 删除项目 | P1 | 20分钟 | 9 |
| TC-FM-006 | 文件管理 - 删除文件 | P1 | 15分钟 | 10 |

**总计**: 约3.5小时

---

### 阶段2: AI功能测试（第3-4天）

**目标**: 验证AI对话、RAG、代码助手

| 测试用例ID | 模块 | 优先级 | 预计时间 | 执行顺序 |
|-----------|------|--------|---------|---------|
| TC-AI-001 | AI对话 - 流式响应 | P0 | 45分钟 | 1 |
| TC-AI-002 | RAG查询 - 基础检索 | P0 | 45分钟 | 2 |
| TC-AI-003 | RAG索引 - 项目索引 | P0 | 30分钟 | 3 |
| TC-AI-005 | 代码生成 | P0 | 30分钟 | 4 |
| TC-PM-002 | 项目创建 - 流式模式 | P0 | 60分钟 | 5 |
| TC-AI-004 | RAG增强查询 | P1 | 30分钟 | 6 |
| TC-AI-006 | 代码审查 | P1 | 30分钟 | 7 |
| TC-AI-007 | 代码重构 | P2 | 30分钟 | 8 |

**总计**: 约4.5小时

---

### 阶段3: Git和协作测试（第5天）

**目标**: 验证版本控制和协作功能

| 测试用例ID | 模块 | 优先级 | 预计时间 | 执行顺序 |
|-----------|------|--------|---------|---------|
| TC-GIT-001 | Git初始化 | P1 | 20分钟 | 1 |
| TC-GIT-002 | Git状态查询 | P0 | 15分钟 | 2 |
| TC-GIT-003 | Git提交 | P0 | 30分钟 | 3 |
| TC-GIT-004 | AI生成提交信息 | P1 | 30分钟 | 4 |
| TC-GIT-005 | Git推送 | P1 | 30分钟 | 5 |
| TC-GIT-006 | Git拉取 | P1 | 30分钟 | 6 |
| TC-GIT-007 | 分支管理 | P2 | 45分钟 | 7 |
| TC-GIT-008 | AI冲突解决 | P2 | 45分钟 | 8 |
| TC-COLLAB-001 | 添加协作者 | P2 | 20分钟 | 9 |
| TC-COLLAB-002 | 评论功能 | P2 | 30分钟 | 10 |

**总计**: 约4.5小时

---

### 阶段4: 高级功能测试（第6天）

**目标**: 验证文件版本、搜索、导出、自动化

| 测试用例ID | 模块 | 优先级 | 预计时间 | 执行顺序 |
|-----------|------|--------|---------|---------|
| TC-FM-004 | 文件管理 - 批量创建 | P1 | 30分钟 | 1 |
| TC-FM-007 | 文件管理 - 搜索文件 | P2 | 30分钟 | 2 |
| TC-FM-008 | 文件管理 - 版本历史 | P2 | 45分钟 | 3 |
| TC-PM-007 | 项目导出 | P2 | 30分钟 | 4 |
| TC-AUTO-001 | 创建自动化规则 | P2 | 45分钟 | 5 |
| TC-AUTO-002 | 手动触发规则 | P2 | 20分钟 | 6 |

**总计**: 约3小时

---

### 阶段5: 数据同步和监控测试（第7天）

**目标**: 验证多设备同步、冲突解决、健康检查

| 测试用例ID | 模块 | 优先级 | 预计时间 | 执行顺序 |
|-----------|------|--------|---------|---------|
| TC-SYNC-001 | 增量数据上传 | P1 | 45分钟 | 1 |
| TC-SYNC-002 | 增量数据下载 | P1 | 45分钟 | 2 |
| TC-SYNC-003 | 同步冲突解决 | P1 | 60分钟 | 3 |
| TC-HEALTH-001 | 服务健康检查 | P1 | 30分钟 | 4 |

**总计**: 约3小时

---

### 阶段6: 回归测试和问题修复（第8-10天）

**目标**: 修复发现的问题，执行完整回归测试

- 修复阶段1-5发现的所有问题
- 重新测试失败的用例
- 执行完整功能回归测试
- 性能和压力测试（可选）

---

## 测试数据准备

### 1. 用户数据

```sql
-- 创建测试用户
INSERT INTO users (id, username, email, did) VALUES
  ('user-001', 'testuser1', 'test1@example.com', 'did:key:z6MkTest1...'),
  ('user-002', 'testuser2', 'test2@example.com', 'did:key:z6MkTest2...');
```

### 2. 项目数据

准备以下类型的测试项目：
- **Web项目**: 博客、作品集、企业站
- **Document项目**: 商务报告、学术论文
- **Data项目**: 数据分析、可视化

### 3. 文件数据

每个项目包含：
- **小文件**: <1KB (配置文件)
- **中等文件**: 1KB-100KB (代码文件)
- **大文件**: 100KB-1MB (Markdown文档)

### 4. Git仓库

准备：
- 已初始化的Git仓库
- 多个提交历史
- 多个分支
- 冲突场景（用于测试冲突解决）

### 5. RAG索引数据

准备：
- 包含至少50个文件的项目
- 多种文件类型（JS, PY, MD, HTML, CSS）
- 足够的文本内容用于检索测试

---

## 问题跟踪

### 问题记录表格

| 问题ID | 测试用例ID | 严重程度 | 问题描述 | 重现步骤 | 状态 | 修复人 | 修复日期 |
|-------|-----------|---------|---------|---------|------|--------|---------|
| BUG-001 | TC-PM-001 | Critical | 项目创建失败，返回500错误 | 1. 输入需求... 2. 点击创建... | Open | - | - |
| BUG-002 | TC-AI-001 | Medium | 流式响应偶尔断开 | ... | Fixed | 张三 | 2025-12-27 |

### 严重程度定义

- **Critical**: 核心功能完全不可用，阻塞测试
- **High**: 重要功能异常，影响用户体验
- **Medium**: 功能可用但存在问题
- **Low**: 小问题，不影响主要功能

---

## 测试环境

### 硬件要求

- **CPU**: 4核以上
- **内存**: 16GB以上（Docker服务较多）
- **磁盘**: 50GB可用空间

### 软件版本

| 软件 | 版本 |
|------|------|
| Node.js | 18.x+ |
| Java | 17 |
| Python | 3.9+ |
| PostgreSQL | 16 |
| Redis | 7 |
| Docker | 最新版 |

---

## 测试报告

测试完成后，生成测试报告，包含：

1. **测试概要**
   - 总测试用例数
   - 通过/失败/未执行数量
   - 通过率

2. **详细结果**
   - 每个测试用例的执行结果
   - 截图和日志

3. **问题汇总**
   - 所有发现的问题列表
   - 按严重程度分类

4. **建议**
   - 需要改进的地方
   - 优化建议

---

## 附录

### A. 常用测试命令

```bash
# 启动所有服务
docker-compose up -d
cd backend/project-service && mvn spring-boot:run &
cd backend/ai-service && uvicorn main:app --port 8001 &
cd desktop-app-vue && npm run dev

# 查看日志
docker-compose logs -f
tail -f backend/project-service/logs/app.log
tail -f backend/ai-service/logs/app.log

# 数据库操作
psql -U chainlesschain -d chainlesschain -h localhost
SELECT * FROM projects ORDER BY created_at DESC LIMIT 10;

# 清理测试数据
DELETE FROM projects WHERE user_id = 'user-001';
DELETE FROM project_files WHERE project_id NOT IN (SELECT id FROM projects);
```

### B. 测试工具推荐

- **API测试**: Postman, curl
- **数据库工具**: DBeaver, pgAdmin
- **抓包工具**: Wireshark（分析HTTP/SSE流量）
- **性能测试**: Apache JMeter, k6

### C. 联系人

| 角色 | 姓名 | 邮箱 |
|------|------|------|
| 测试负责人 | - | - |
| 后端开发 | - | - |
| 前端开发 | - | - |

---

**文档结束**
