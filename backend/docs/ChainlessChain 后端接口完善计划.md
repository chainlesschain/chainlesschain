# ChainlessChain 后端接口完善计划

## 一、项目概况

### 当前状态
- **前端**：已实现200+ IPC调用，功能完整
- **Java后端**：仅6个基础API，数据库12张表已建但多数未使用
- **Python后端**：AI功能完善，需扩展Git/代码助手/RAG索引

### 用户需求
- **优先功能**（P0）：文件管理、Git操作、RAG索引、代码助手
- **次要功能**（P1）：协作、评论、自动化规则、统计、日志
- **实施策略**：分离实现（Git/RAG/代码助手→Python，CRUD→Java）

## 二、核心API设计

### P0优先级（立即实施）

#### 1. 项目文件管理（Java）
**端点**：`/api/projects/{projectId}/files`

关键接口：
- `GET /` - 获取文件列表（支持分页和文件类型过滤）
- `GET /{fileId}` - 获取文件详情
- `POST /` - 创建文件
- `PUT /{fileId}` - 更新文件内容
- `DELETE /{fileId}` - 删除文件
- `POST /batch` - 批量创建文件（AI生成后使用）

**关键文件**：
- `backend/project-service/src/main/java/com/chainlesschain/project/controller/ProjectFileController.java`（新建）
- `backend/project-service/src/main/java/com/chainlesschain/project/service/ProjectFileService.java`（新建）

#### 2. Git操作（Python）
**端点**：`/api/git/*`

关键接口（13个）：
- `POST /init` - 初始化仓库
- `GET /status` - 获取状态
- `POST /commit` - 提交（支持AI生成消息）
- `POST /push` - 推送
- `POST /pull` - 拉取
- `GET /log` - 提交历史
- `GET /diff` - 查看差异
- `POST /branch/create` - 创建分支
- `POST /branch/checkout` - 切换分支
- `POST /merge` - 合并分支
- `POST /resolve-conflicts` - AI辅助解决冲突
- `POST /generate-commit-message` - AI生成提交消息

**关键文件**：
- `backend/ai-service/src/git/git_manager.py`（新建）
- `backend/ai-service/src/git/commit_message_generator.py`（新建）
- `backend/ai-service/main.py`（扩展路由）

#### 3. RAG索引（Python）
**端点**：`/api/rag/index/*`

关键接口：
- `POST /project` - 索引项目文件
- `GET /stats` - 索引统计
- `POST /query/enhanced` - 增强查询（多源+重排）
- `DELETE /project/{project_id}` - 删除索引
- `POST /update-file` - 更新单文件索引

**关键文件**：
- `backend/ai-service/src/indexing/file_indexer.py`（新建）
- `backend/ai-service/src/rag/rag_engine.py`（扩展）

#### 4. 代码助手（Python）
**端点**：`/api/code/*`

关键接口（7个）：
- `POST /generate` - 生成代码
- `POST /review` - 审查代码
- `POST /refactor` - 重构代码
- `POST /explain` - 解释代码
- `POST /fix-bug` - 修复Bug
- `POST /generate-tests` - 生成测试
- `POST /optimize` - 性能优化

**关键文件**：
- `backend/ai-service/src/code/code_generator.py`（新建）
- `backend/ai-service/src/code/code_reviewer.py`（新建）
- `backend/ai-service/src/code/code_refactorer.py`（新建）

### P1优先级（短期实施）

#### 5. 协作管理（Java）
- `GET /api/projects/{projectId}/collaborators` - 获取协作者
- `POST /api/projects/{projectId}/collaborators` - 添加协作者
- `PUT /api/projects/{projectId}/collaborators/{id}` - 更新权限
- `DELETE /api/projects/{projectId}/collaborators/{id}` - 移除协作者

#### 6. 评论批注（Java）
- `GET /api/projects/{projectId}/comments` - 获取评论
- `POST /api/projects/{projectId}/comments` - 添加评论
- `POST /api/projects/{projectId}/comments/{id}/replies` - 回复评论

#### 7. 自动化规则（Java）
- `GET /api/projects/{projectId}/automation/rules` - 获取规则
- `POST /api/projects/{projectId}/automation/rules` - 创建规则
- `POST /api/projects/{projectId}/automation/rules/{id}/trigger` - 手动触发

### P2优先级（中期实施）
- 项目统计API
- 操作日志API
- 模板管理API
- 市场化API

## 三、实施计划

### 阶段1（1-2周）：文件管理 + Git
**目标**：支持文件CRUD和Git基本操作

**Java侧**：
1. 创建 `ProjectFileController` 和 `ProjectFileService`
2. 扩展 `AiServiceClient` 添加Git调用方法

**Python侧**：
1. 实现 `GitManager` 类（使用GitPython库）
2. 实现 `CommitMessageGenerator`（LLM生成提交消息）
3. 在 `main.py` 添加13个Git路由

**Electron侧**：
1. 修改 `project:get-files`、`project:update-file` 调用Java API
2. 修改 `project:git-*` 系列IPC调用Python API

### 阶段2（2-3周）：RAG索引 + 代码助手
**目标**：智能检索和代码生成

**Python侧**：
1. 实现 `FileIndexer` 类（文件遍历、分块、嵌入）
2. 扩展 `RAGEngine` 支持项目级索引和多源查询
3. 实现代码助手三个核心类（Generator、Reviewer、Refactorer）
4. 添加约12个新路由

**Electron侧**：
1. 修改RAG和代码相关IPC调用Python API

### 阶段3（1-2周）：协作 + 评论 + 自动化
**目标**：团队协作功能

**Java侧**：
1. 创建3个Controller（Collaborator、Comment、Automation）
2. 创建对应Service和Mapper
3. 补充Entity类

### 阶段4（1周）：统计 + 日志 + 模板
**目标**：完善辅助功能

**Java侧**：
1. 实现统计自动更新（数据库触发器）
2. 完成日志记录和查询
3. 完善模板CRUD

## 四、技术要点

### 服务间通信
- **Java→Python**：使用 `WebClient`（已有），扩展 `AiServiceClient`
- **Electron→后端**：修改IPC handler，从本地实现改为HTTP调用

### 数据库变更
```sql
-- 添加自动化规则运行跟踪
ALTER TABLE project_automation_rules
ADD COLUMN last_run_at TIMESTAMP,
ADD COLUMN run_count INT DEFAULT 0;

-- 确保文件表有内容字段
ALTER TABLE project_files
ADD COLUMN IF NOT EXISTS content TEXT;
```

### RESTful规范
- 统一响应：`{code: 200, message: "成功", data: {...}}`
- HTTP状态码：200成功、201创建、404未找到、500错误
- 分页参数：`pageNum`、`pageSize`

## 五、关键文件清单

### 需新建
1. `ProjectFileController.java` - 文件管理API
2. `CollaboratorController.java` - 协作管理API
3. `AutomationController.java` - 自动化规则API
4. `git_manager.py` - Git操作核心
5. `code_generator.py` - 代码生成核心
6. `file_indexer.py` - 文件索引核心

### 需修改
1. `AiServiceClient.java` - 扩展Git/代码调用
2. `main.py` - 新增约30个路由
3. `desktop-app-vue/src/main/index.js` - 修改IPC调用后端

## 六、验收标准

### 阶段1
- ✅ 前端能通过后端完成文件CRUD
- ✅ Git提交消息能AI自动生成
- ✅ Git推送拉取正常工作

### 阶段2
- ✅ 项目文件能自动索引到Qdrant
- ✅ RAG查询返回混合结果（项目+知识库）
- ✅ 代码生成功能返回高质量代码

### 阶段3
- ✅ 能添加协作者并管理权限
- ✅ 能在文件上添加行级批注
- ✅ 自动化规则能正常触发

### 完成标志
- 所有前端200+个API调用都有对应后端实现
- Electron主进程不再处理业务逻辑，纯粹作为IPC桥接层
