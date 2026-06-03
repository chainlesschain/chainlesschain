# ChainlessChain 后端接口测试指南

本目录包含ChainlessChain后端服务的全面自动化测试套件。

## 📁 文件说明

### 测试脚本

| 文件 | 说明 |
|------|------|
| `test_framework.py` | 测试框架基础类，提供HTTP请求、结果验证、报告生成等功能 |
| `test_project_service.py` | 项目服务基础测试（旧版） |
| `test_ai_service.py` | AI服务基础测试（旧版） |
| `test_project_service_comprehensive.py` | **项目服务全面测试** - 覆盖所有Controller |
| `test_ai_service_comprehensive.py` | **AI服务全面测试** - 覆盖所有API端点 |
| `run_tests.py` | 基础测试运行器（旧版） |
| `run_comprehensive_tests.py` | **全面测试运行器** - 推荐使用 |

### 测试报告

| 文件 | 说明 |
|------|------|
| `test_report_项目_service.md` | 项目服务测试详细报告（Markdown格式） |
| `test_report_ai_service.md` | AI服务测试详细报告（Markdown格式） |
| `test_report_项目_service.json` | 项目服务测试数据（JSON格式） |
| `test_report_ai_service.json` | AI服务测试数据（JSON格式） |
| `API_REMEDIATION_PLAN.md` | **修复计划** - 问题分类和修复建议 |
| `TEST_SUMMARY_REPORT.md` | **测试总结报告** - 完整分析和结论 |
| `README_TESTING.md` | 本文档 - 测试指南 |

## 🚀 快速开始

### 1. 安装依赖

```bash
cd backend/test
pip install -r requirements.txt
```

### 2. 启动后端服务

**启动Docker服务**:
```bash
cd C:/code/chainlesschain
docker-compose up -d
```

**启动项目服务** (新终端):
```bash
cd backend/project-service
mvn spring-boot:run
```

**启动AI服务** (新终端):
```bash
cd backend/ai-service
uvicorn main:app --reload --port 8001
```

### 3. 运行测试

**运行所有测试**:
```bash
cd backend/test
python run_comprehensive_tests.py --generate-plan
```

**只测试项目服务**:
```bash
python run_comprehensive_tests.py --service project
```

**只测试AI服务**:
```bash
python run_comprehensive_tests.py --service ai
```

**自定义服务URL**:
```bash
python run_comprehensive_tests.py \
  --project-url http://localhost:9090 \
  --ai-url http://localhost:8001
```

## 📊 测试覆盖范围

### 项目服务 (Spring Boot - Port 9090)

#### ProjectController
- ✅ `GET /api/projects/health` - 健康检查
- ✅ `POST /api/projects/create` - 创建项目
- ✅ `GET /api/projects/{projectId}` - 获取项目详情
- ✅ `GET /api/projects/list` - 获取项目列表
- ✅ `POST /api/projects/tasks/execute` - 执行任务
- ✅ `DELETE /api/projects/{projectId}` - 删除项目

#### ProjectFileController
- ✅ `GET /api/projects/{projectId}/files` - 获取文件列表
- ✅ `GET /api/projects/{projectId}/files/{fileId}` - 获取文件详情
- ✅ `POST /api/projects/{projectId}/files` - 创建文件
- ✅ `POST /api/projects/{projectId}/files/batch` - 批量创建文件
- ✅ `PUT /api/projects/{projectId}/files/{fileId}` - 更新文件
- ✅ `DELETE /api/projects/{projectId}/files/{fileId}` - 删除文件

#### CollaboratorController
- ✅ `GET /api/projects/{projectId}/collaborators` - 获取协作者列表
- ✅ `POST /api/projects/{projectId}/collaborators` - 添加协作者
- ✅ `PUT /api/projects/{projectId}/collaborators/{collaboratorId}` - 更新权限
- ✅ `DELETE /api/projects/{projectId}/collaborators/{collaboratorId}` - 移除协作者
- ✅ `POST /api/projects/{projectId}/collaborators/{collaboratorId}/accept` - 接受邀请

#### CommentController
- ✅ `GET /api/projects/{projectId}/comments` - 获取评论列表
- ✅ `POST /api/projects/{projectId}/comments` - 添加评论
- ✅ `PUT /api/projects/{projectId}/comments/{commentId}` - 更新评论
- ✅ `DELETE /api/projects/{projectId}/comments/{commentId}` - 删除评论
- ✅ `POST /api/projects/{projectId}/comments/{commentId}/replies` - 回复评论
- ✅ `GET /api/projects/{projectId}/comments/{commentId}/replies` - 获取回复

#### AutomationController
- ✅ `GET /api/projects/{projectId}/automation/rules` - 获取规则列表
- ✅ `POST /api/projects/{projectId}/automation/rules` - 创建规则
- ✅ `PUT /api/projects/{projectId}/automation/rules/{ruleId}` - 更新规则
- ✅ `DELETE /api/projects/{projectId}/automation/rules/{ruleId}` - 删除规则
- ✅ `POST /api/projects/{projectId}/automation/rules/{ruleId}/trigger` - 手动触发
- ✅ `PUT /api/projects/{projectId}/automation/rules/{ruleId}/toggle` - 启用/禁用
- ✅ `GET /api/projects/{projectId}/automation/stats` - 获取统计

#### SyncController
- ✅ `POST /api/sync/upload` - 批量上传数据
- ✅ `GET /api/sync/download/{tableName}` - 增量下载数据
- ✅ `GET /api/sync/status` - 获取同步状态
- ✅ `POST /api/sync/resolve-conflict` - 解决冲突
- ✅ `GET /api/sync/health` - 同步服务健康检查

### AI服务 (FastAPI - Port 8001)

#### 基础服务
- ✅ `GET /` - 服务根路径
- ✅ `GET /health` - 健康检查

#### 意图识别
- ✅ `POST /api/intent/classify` - 意图分类

#### 项目管理
- ✅ `POST /api/projects/create` - 创建项目
- ✅ `POST /api/tasks/execute` - 执行任务

#### RAG知识检索
- ✅ `POST /api/rag/query` - 简单查询
- ✅ `POST /api/rag/query/enhanced` - 增强查询
- ✅ `POST /api/rag/index/project` - 索引项目
- ✅ `GET /api/rag/index/stats` - 索引统计
- ✅ `POST /api/rag/index/update-file` - 更新文件索引
- ✅ `DELETE /api/rag/index/project/{project_id}` - 删除项目索引

#### Git操作
- ✅ `POST /api/git/init` - 初始化仓库
- ✅ `GET /api/git/status` - 查询状态
- ✅ `GET /api/git/log` - 查询日志
- ✅ `GET /api/git/diff` - 查询差异
- ✅ `GET /api/git/branches` - 获取分支列表
- ✅ `POST /api/git/branch/create` - 创建分支
- ✅ `POST /api/git/branch/checkout` - 切换分支
- ✅ `POST /api/git/generate-commit-message` - 生成提交信息

#### 代码助手
- ✅ `POST /api/code/generate` - 生成代码
- ✅ `POST /api/code/explain` - 解释代码
- ✅ `POST /api/code/review` - 审查代码
- ✅ `POST /api/code/refactor` - 重构代码
- ✅ `POST /api/code/fix-bug` - 修复Bug
- ✅ `POST /api/code/generate-tests` - 生成测试
- ✅ `POST /api/code/optimize` - 优化代码

**总计**: 63个API端点测试

## 🔍 理解测试结果

### 测试状态

- `[PASS]` - 测试通过 ✅
- `[FAIL]` - 测试失败（状态码或验证不匹配） ❌
- `[ERROR]` - 测试错误（连接失败、超时等） ⚠️
- `[SKIP]` - 测试跳过 ⏭️

### 测试报告解读

**Markdown报告** (`test_report_*.md`):
- 测试摘要（总数、通过率、耗时）
- 按状态分类的详细结果
- 请求/响应数据
- 错误信息

**JSON报告** (`test_report_*.json`):
- 机器可读的测试数据
- 可用于CI/CD集成
- 可用于趋势分析

**修复计划** (`API_REMEDIATION_PLAN.md`):
- 问题分类（高/中/低优先级）
- 详细的修复建议
- 系统设计对照检查

**总结报告** (`TEST_SUMMARY_REPORT.md`):
- 执行摘要
- 详细发现
- 测试覆盖率评估
- 后续行动计划

## 🛠️ 自定义测试

### 添加新的测试用例

**1. 在测试类中添加测试方法**:

```python
# test_project_service_comprehensive.py

def test_your_new_feature(self):
    """测试你的新功能"""
    if not self.test_project_id:
        print("  跳过：需要先创建项目")
        return

    request_data = {
        "param1": "value1",
        "param2": "value2"
    }

    self.run_test(
        name="[YourController] 你的新功能",
        method="POST",
        endpoint=f"/api/your/endpoint",
        data=request_data,
        expected_status=200,
        validate_func=lambda r: validate_success_response(r)
    )
```

**2. 在run_all_tests中调用**:

```python
def run_all_tests(self):
    # ... 现有测试 ...
    self.test_your_new_feature()
```

### 自定义验证函数

```python
def validate_custom(response_data):
    """自定义验证函数"""
    assert "custom_field" in response_data, "缺少custom_field字段"
    assert response_data["custom_field"] > 0, "custom_field值无效"

# 使用
self.run_test(
    name="自定义验证测试",
    method="GET",
    endpoint="/api/custom",
    validate_func=validate_custom
)
```

## 🔧 故障排查

### 常见问题

**1. 连接错误 (ConnectionError)**

```
Error: 无法连接到服务器
```

**解决方法**:
- 检查服务是否启动
- 验证端口号是否正确
- 检查防火墙设置

**2. 超时错误 (Timeout)**

```
Error: 请求超时 (>30s)
```

**解决方法**:
- 增加超时时间（修改test_framework.py中的timeout参数）
- 优化服务性能
- 使用更小的LLM模型

**3. 状态码不匹配**

```
Error: 状态码不匹配
Expected: 200
Actual: 422
```

**解决方法**:
- 检查请求参数格式
- 查看服务端日志
- 参考API文档

**4. 验证失败**

```
Error: 响应中缺少data字段
```

**解决方法**:
- 检查API响应格式
- 更新验证函数
- 统一响应格式

## 📈 CI/CD集成

### GitHub Actions示例

```yaml
name: Backend API Tests

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main ]

jobs:
  test:
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_PASSWORD: chainlesschain_pwd_2024
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

      redis:
        image: redis:7
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
    - uses: actions/checkout@v3

    - name: Set up Python
      uses: actions/setup-python@v4
      with:
        python-version: '3.11'

    - name: Install dependencies
      run: |
        cd backend/test
        pip install -r requirements.txt

    - name: Start services
      run: |
        # Start project service
        cd backend/project-service
        mvn spring-boot:run &

        # Start AI service
        cd ../ai-service
        uvicorn main:app --port 8001 &

        # Wait for services to be ready
        sleep 30

    - name: Run tests
      run: |
        cd backend/test
        python run_comprehensive_tests.py --generate-plan

    - name: Upload test reports
      if: always()
      uses: actions/upload-artifact@v3
      with:
        name: test-reports
        path: backend/test/*.md
```

## 📚 最佳实践

1. **定期运行测试**
   - 每次代码提交前
   - 每次合并到主分支前
   - 定期（每日/每周）自动化测试

2. **保持测试数据清洁**
   - 测试后清理创建的数据
   - 使用独立的测试数据库
   - 避免硬编码测试数据

3. **监控测试性能**
   - 跟踪测试执行时间
   - 识别慢速测试
   - 优化测试性能

4. **维护测试文档**
   - 更新API变更时同步更新测试
   - 记录已知问题
   - 维护修复历史

## 🤝 贡献指南

1. Fork项目
2. 创建特性分支
3. 添加测试用例
4. 运行测试确保通过
5. 提交Pull Request

## 📞 支持

如有问题，请：
- 查看测试报告中的错误信息
- 查阅修复计划
- 查看服务端日志
- 提交Issue到项目仓库

---

**最后更新**: 2025-12-24
**维护者**: ChainlessChain Team
