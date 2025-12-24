# ChainlessChain 后端接口测试套件

这是 ChainlessChain 项目的后端接口自动化测试套件，用于测试所有后端服务的 API 接口。

## 📁 目录结构

```
backend/test/
├── __init__.py                    # 包初始化文件
├── config.py                      # 测试配置
├── test_utils.py                  # 通用测试工具类
├── test_project_service.py        # Project Service 测试
├── test_ai_service_comprehensive.py  # AI Service 完整测试（可选）
├── report_generator.py            # 测试报告生成器
├── run_all_tests.py               # 主测试运行器
├── requirements.txt               # Python 依赖
├── README.md                      # 本文件
└── reports/                       # 测试报告输出目录
    ├── test_report_YYYYMMDD_HHMMSS.html
    ├── test_report_YYYYMMDD_HHMMSS.json
    └── test_report_YYYYMMDD_HHMMSS.md
```

## 🚀 快速开始

### 1. 安装依赖

```bash
cd backend/test
pip install -r requirements.txt
```

### 2. 配置环境变量（可选）

创建 `.env` 文件或设置环境变量：

```bash
# 服务端点
PROJECT_SERVICE_URL=http://localhost:9090
AI_SERVICE_URL=http://localhost:8001

# 测试选项
SKIP_LLM_TESTS=false              # 是否跳过需要LLM的测试
SKIP_DB_TESTS=false               # 是否跳过需要数据库的测试
RUN_AI_TESTS=false                # 是否运行AI Service测试
TEST_MODE=full                    # 测试模式: full/smoke/integration
```

### 3. 启动后端服务

在运行测试之前，确保后端服务已启动：

```bash
# 启动 Docker 服务（Ollama, Qdrant, PostgreSQL, Redis）
docker-compose up -d

# 启动 Project Service
cd backend/project-service
mvn spring-boot:run

# 启动 AI Service
cd backend/ai-service
uvicorn main:app --reload --port 8001
```

### 4. 运行测试

#### 运行所有测试

```bash
python run_all_tests.py
```

#### 运行单个服务测试

```bash
# 只测试 Project Service
python test_project_service.py

# 只测试 AI Service（需要完整实现）
python test_ai_service_comprehensive.py
```

#### 启用 AI Service 测试

```bash
# Windows
set RUN_AI_TESTS=true
python run_all_tests.py

# Linux/Mac
RUN_AI_TESTS=true python run_all_tests.py
```

## 📊 测试报告

测试完成后，会在 `reports/` 目录下生成三种格式的报告：

1. **HTML 报告** (`test_report_YYYYMMDD_HHMMSS.html`)
   - 可视化的测试结果
   - 包含详细的错误信息
   - 支持浏览器查看

2. **JSON 报告** (`test_report_YYYYMMDD_HHMMSS.json`)
   - 机器可读的测试结果
   - 适合集成到 CI/CD 流程

3. **Markdown 报告** (`test_report_YYYYMMDD_HHMMSS.md`)
   - 适合版本控制和文档
   - 可以直接在 GitHub 查看

## 🧪 测试覆盖

### Project Service (30个测试)

#### 项目管理 (6个)
- ✅ GET `/api/projects/health` - 健康检查
- ✅ POST `/api/projects/create` - 创建项目
- ✅ GET `/api/projects/{projectId}` - 获取项目详情
- ✅ GET `/api/projects/list` - 获取项目列表
- ✅ POST `/api/projects/tasks/execute` - 执行任务
- ✅ DELETE `/api/projects/{projectId}` - 删除项目

#### 文件管理 (6个)
- ✅ POST `/api/projects/{projectId}/files` - 创建文件
- ✅ POST `/api/projects/{projectId}/files/batch` - 批量创建文件
- ✅ GET `/api/projects/{projectId}/files` - 获取文件列表
- ✅ GET `/api/projects/{projectId}/files/{fileId}` - 获取文件详情
- ✅ PUT `/api/projects/{projectId}/files/{fileId}` - 更新文件
- ✅ DELETE `/api/projects/{projectId}/files/{fileId}` - 删除文件

#### 协作者管理 (5个)
- ✅ GET `/api/projects/{projectId}/collaborators` - 获取协作者列表
- ✅ POST `/api/projects/{projectId}/collaborators` - 添加协作者
- ✅ PUT `/api/projects/{projectId}/collaborators/{collaboratorId}` - 更新权限
- ✅ POST `/api/projects/{projectId}/collaborators/{collaboratorId}/accept` - 接受邀请
- ✅ DELETE `/api/projects/{projectId}/collaborators/{collaboratorId}` - 移除协作者

#### 评论管理 (6个)
- ✅ GET `/api/projects/{projectId}/comments` - 获取评论列表
- ✅ POST `/api/projects/{projectId}/comments` - 添加评论
- ✅ PUT `/api/projects/{projectId}/comments/{commentId}` - 更新评论
- ✅ DELETE `/api/projects/{projectId}/comments/{commentId}` - 删除评论
- ✅ POST `/api/projects/{projectId}/comments/{commentId}/replies` - 回复评论
- ✅ GET `/api/projects/{projectId}/comments/{commentId}/replies` - 获取评论回复

#### 自动化规则管理 (7个)
- ✅ GET `/api/projects/{projectId}/automation/rules` - 获取规则列表
- ✅ POST `/api/projects/{projectId}/automation/rules` - 创建规则
- ✅ PUT `/api/projects/{projectId}/automation/rules/{ruleId}` - 更新规则
- ✅ DELETE `/api/projects/{projectId}/automation/rules/{ruleId}` - 删除规则
- ✅ POST `/api/projects/{projectId}/automation/rules/{ruleId}/trigger` - 手动触发规则
- ✅ PUT `/api/projects/{projectId}/automation/rules/{ruleId}/toggle` - 启用/禁用规则
- ✅ GET `/api/projects/{projectId}/automation/stats` - 获取规则统计

### AI Service (33个测试 - 可选)

#### 基础接口 (2个)
- ✅ GET `/` - 根路径
- ✅ GET `/health` - 健康检查

#### 意图识别 (1个)
- ✅ POST `/api/intent/classify` - 意图识别

#### 项目创建 (3个)
- ✅ POST `/api/projects/create` - 创建项目
- ✅ POST `/api/projects/create/stream` - 流式创建项目
- ✅ POST `/api/tasks/execute` - 执行任务

#### RAG (6个)
- ✅ POST `/api/rag/query` - RAG查询
- ✅ POST `/api/rag/index/project` - 索引项目
- ✅ GET `/api/rag/index/stats` - 获取索引统计
- ✅ POST `/api/rag/query/enhanced` - 增强查询
- ✅ POST `/api/rag/index/update-file` - 更新文件索引
- ✅ DELETE `/api/rag/index/project/{project_id}` - 删除项目索引

#### 聊天 (1个)
- ✅ POST `/api/chat/stream` - 流式对话

#### Git操作 (10个)
- ✅ POST `/api/git/init` - 初始化仓库
- ✅ GET `/api/git/status` - 获取状态
- ✅ POST `/api/git/commit` - 提交更改
- ✅ POST `/api/git/push` - 推送到远程
- ✅ POST `/api/git/pull` - 从远程拉取
- ✅ GET `/api/git/log` - 获取提交历史
- ✅ GET `/api/git/diff` - 获取差异
- ✅ GET `/api/git/branches` - 列出分支
- ✅ POST `/api/git/branch/create` - 创建分支
- ✅ POST `/api/git/branch/checkout` - 切换分支
- ✅ POST `/api/git/merge` - 合并分支
- ✅ POST `/api/git/resolve-conflicts` - 解决冲突
- ✅ POST `/api/git/generate-commit-message` - AI生成提交消息

#### 代码助手 (7个)
- ✅ POST `/api/code/generate` - 生成代码
- ✅ POST `/api/code/review` - 代码审查
- ✅ POST `/api/code/refactor` - 代码重构
- ✅ POST `/api/code/explain` - 代码解释
- ✅ POST `/api/code/fix-bug` - 修复Bug
- ✅ POST `/api/code/generate-tests` - 生成单元测试
- ✅ POST `/api/code/optimize` - 性能优化

## 🔧 自定义测试

你可以通过修改 `config.py` 来自定义测试行为：

```python
# 修改超时时间
DEFAULT_TIMEOUT = 30
LONG_RUNNING_TIMEOUT = 120

# 跳过特定测试
SKIP_LLM_TESTS = True  # 跳过需要LLM的测试
SKIP_DB_TESTS = True   # 跳过需要数据库的测试

# 更改报告格式
REPORT_FORMAT = "html"  # html, json, markdown
```

## 📝 添加新测试

1. 继承 `APITester` 类
2. 使用 `test_endpoint` 方法添加测试用例
3. 在 `run_all_tests.py` 中导入你的测试类

示例：

```python
from test_utils import APITester

class MyServiceTester(APITester):
    def __init__(self):
        super().__init__("http://localhost:8080", "my-service")

    def test_my_endpoint(self):
        self.test_endpoint(
            test_name="测试我的端点",
            method="GET",
            endpoint="/api/my-endpoint",
            expected_status=200
        )
```

## 🐛 故障排除

### 测试失败：无法连接到服务器

- 确保后端服务已启动
- 检查服务端点配置是否正确
- 验证端口没有被占用

### LLM 相关测试超时

- 设置 `SKIP_LLM_TESTS=true` 跳过这些测试
- 或增加 `LONG_RUNNING_TIMEOUT` 的值

### 数据库相关测试失败

- 确保数据库服务已启动（PostgreSQL, Redis）
- 检查数据库连接配置
- 或设置 `SKIP_DB_TESTS=true`

## 📄 许可证

本测试套件是 ChainlessChain 项目的一部分。
