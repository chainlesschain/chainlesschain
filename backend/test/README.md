# ChainlessChain 后端接口测试

自动化测试后端服务的所有API接口，生成详细的测试报告。

## 测试服务

### 1. 项目服务 (Spring Boot)
- **端口**: 9090
- **技术栈**: Spring Boot 3.1.11 + MyBatis Plus
- **测试范围**:
  - 健康检查
  - 项目管理 (CRUD)
  - 文件管理
  - 协作者管理
  - 评论管理
  - 自动化规则

### 2. AI服务 (FastAPI)
- **端口**: 8001
- **技术栈**: FastAPI + Python
- **测试范围**:
  - 健康检查
  - 意图识别
  - 项目创建
  - RAG检索
  - Git操作
  - 代码助手 (生成/审查/重构/解释等)

## 安装依赖

```bash
pip install -r requirements.txt
```

## 运行测试

### 测试所有服务
```bash
python run_tests.py
```

### 仅测试项目服务
```bash
python run_tests.py --service project
```

### 仅测试AI服务
```bash
python run_tests.py --service ai
```

### 自定义服务URL
```bash
python run_tests.py --project-url http://localhost:9090 --ai-url http://localhost:8001
```

### 单独运行测试
```bash
# 仅测试项目服务
python test_project_service.py

# 仅测试AI服务
python test_ai_service.py
```

## 测试报告

测试完成后会自动生成以下报告：

- `test_report.md` - Markdown格式的详细测试报告
- `test_report.json` - JSON格式的测试数据（便于自动化分析）

## 测试结果示例

```
================================================================================
综合测试摘要
================================================================================

项目服务:
  总数: 15, 通过: 12, 失败: 2, 错误: 1
  成功率: 80.00%, 耗时: 5.23s

AI服务:
  总数: 10, 通过: 9, 失败: 0, 错误: 1
  成功率: 90.00%, 耗时: 8.15s

整体统计:
  总测试数: 25
  总通过: 21
  总失败: 2
  总错误: 2
  整体成功率: 84.00%
================================================================================
```

## 文件结构

```
backend/test/
├── README.md                   # 本文档
├── requirements.txt            # Python依赖
├── test_framework.py           # 测试框架和工具函数
├── test_project_service.py     # 项目服务测试
├── test_ai_service.py          # AI服务测试
├── run_tests.py                # 主测试运行脚本
├── test_report.md              # 测试报告（生成）
└── test_report.json            # 测试数据（生成）
```

## 前置条件

运行测试前，请确保：

1. **启动项目服务** (端口 9090)
   ```bash
   cd backend/project-service
   mvn spring-boot:run
   ```

2. **启动AI服务** (端口 8001)
   ```bash
   cd backend/ai-service
   python -m uvicorn main:app --reload --port 8001
   ```

3. **启动依赖服务** (Docker)
   ```bash
   docker-compose up -d
   ```
   - PostgreSQL (5432)
   - Redis (6379)
   - Qdrant (6333)
   - Ollama (11434)

## 测试覆盖的接口

### 项目服务接口 (共30+个)

**项目管理**
- `GET /api/projects/health` - 健康检查
- `POST /api/projects/create` - 创建项目
- `GET /api/projects/{projectId}` - 获取项目详情
- `GET /api/projects/list` - 获取项目列表
- `POST /api/projects/tasks/execute` - 执行任务
- `DELETE /api/projects/{projectId}` - 删除项目

**文件管理**
- `GET /api/projects/{projectId}/files` - 获取文件列表
- `POST /api/projects/{projectId}/files` - 创建文件
- `GET /api/projects/{projectId}/files/{fileId}` - 获取文件详情
- `PUT /api/projects/{projectId}/files/{fileId}` - 更新文件
- `DELETE /api/projects/{projectId}/files/{fileId}` - 删除文件
- `POST /api/projects/{projectId}/files/batch` - 批量创建文件

**协作者管理**
- `GET /api/projects/{projectId}/collaborators` - 获取协作者列表
- `POST /api/projects/{projectId}/collaborators` - 添加协作者
- `PUT /api/projects/{projectId}/collaborators/{id}` - 更新权限
- `DELETE /api/projects/{projectId}/collaborators/{id}` - 移除协作者
- `POST /api/projects/{projectId}/collaborators/{id}/accept` - 接受邀请

**评论管理**
- `GET /api/projects/{projectId}/comments` - 获取评论列表
- `POST /api/projects/{projectId}/comments` - 添加评论
- `PUT /api/projects/{projectId}/comments/{id}` - 更新评论
- `DELETE /api/projects/{projectId}/comments/{id}` - 删除评论
- `POST /api/projects/{projectId}/comments/{id}/replies` - 回复评论
- `GET /api/projects/{projectId}/comments/{id}/replies` - 获取回复

**自动化规则**
- `GET /api/projects/{projectId}/automation/rules` - 获取规则列表
- `POST /api/projects/{projectId}/automation/rules` - 创建规则
- `PUT /api/projects/{projectId}/automation/rules/{id}` - 更新规则
- `DELETE /api/projects/{projectId}/automation/rules/{id}` - 删除规则
- `POST /api/projects/{projectId}/automation/rules/{id}/trigger` - 触发规则
- `PUT /api/projects/{projectId}/automation/rules/{id}/toggle` - 切换状态
- `GET /api/projects/{projectId}/automation/stats` - 获取统计

### AI服务接口 (共30+个)

**基础接口**
- `GET /` - 根路径
- `GET /health` - 健康检查

**意图识别**
- `POST /api/intent/classify` - 意图识别

**项目管理**
- `POST /api/projects/create` - 创建项目
- `POST /api/projects/create/stream` - 流式创建项目
- `POST /api/tasks/execute` - 执行任务

**RAG相关**
- `POST /api/rag/query` - RAG知识检索
- `POST /api/rag/index/project` - 索引项目文件
- `GET /api/rag/index/stats` - 获取索引统计
- `POST /api/rag/query/enhanced` - 增强RAG查询
- `DELETE /api/rag/index/project/{project_id}` - 删除项目索引
- `POST /api/rag/index/update-file` - 更新文件索引

**Git操作**
- `POST /api/git/init` - 初始化仓库
- `GET /api/git/status` - 获取状态
- `POST /api/git/commit` - 提交更改
- `POST /api/git/push` - 推送
- `POST /api/git/pull` - 拉取
- `GET /api/git/log` - 获取日志
- `GET /api/git/diff` - 获取差异
- `GET /api/git/branches` - 列出分支
- `POST /api/git/branch/create` - 创建分支
- `POST /api/git/branch/checkout` - 切换分支
- `POST /api/git/merge` - 合并分支
- `POST /api/git/resolve-conflicts` - 解决冲突
- `POST /api/git/generate-commit-message` - 生成提交消息

**代码助手**
- `POST /api/code/generate` - 生成代码
- `POST /api/code/review` - 代码审查
- `POST /api/code/refactor` - 代码重构
- `POST /api/code/explain` - 代码解释
- `POST /api/code/fix-bug` - 修复Bug
- `POST /api/code/generate-tests` - 生成测试
- `POST /api/code/optimize` - 性能优化

**聊天**
- `POST /api/chat/stream` - 流式对话

## 问题排查

### 连接错误
- 确认服务已启动并监听正确端口
- 检查防火墙设置
- 验证URL配置是否正确

### 测试超时
- 增加超时时间（修改 `APITester` 的 `timeout` 参数）
- 检查服务性能和响应速度

### 断言失败
- 查看详细报告了解失败原因
- 检查API响应格式是否符合预期
- 验证请求参数是否正确

## 贡献

如需添加新的测试用例：

1. 在对应的测试类中添加新方法
2. 方法名以 `test_` 开头
3. 使用 `self.run_test()` 执行测试
4. 在 `run_all_tests()` 中调用新方法

## 许可证

与主项目相同
