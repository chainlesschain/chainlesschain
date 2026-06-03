# 测试套件快速参考

## 测试文件结构

```
backend/test/
├── test_framework.py              # 核心测试框架
├── test_project_service.py        # 项目服务基础测试 (3个接口)
├── test_ai_service.py             # AI服务基础测试 (8个接口)
├── test_project_service_full.py   # 项目服务完整测试 (30个接口)
├── test_ai_service_full.py        # AI服务完整测试 (33个接口)
├── run_tests.py                   # 基础测试运行器
└── run_tests_full.py              # 完整测试运行器 (支持两种模式)
```

---

## 快速命令

### 运行基础测试 (11个接口, ~3分钟)
```bash
cd C:\code\chainlesschain\backend\test
python run_tests_full.py --mode basic
```

### 运行完整测试 (48个接口, ~2小时)
```bash
cd C:\code\chainlesschain\backend\test
python run_tests_full.py --mode full
```

### 仅测试项目服务
```bash
# 基础模式 (3个接口)
python run_tests_full.py --mode basic --service project

# 完整模式 (30个接口)
python run_tests_full.py --mode full --service project
```

### 仅测试AI服务
```bash
# 基础模式 (8个接口)
python run_tests_full.py --mode basic --service ai

# 完整模式 (33个接口)
python run_tests_full.py --mode full --service ai
```

---

## 测试覆盖范围

### 基础测试 (11个接口) - 100% 通过
- ✅ 项目服务健康检查
- ✅ 创建项目
- ✅ 获取项目列表
- ✅ AI服务根路径
- ✅ AI服务健康检查
- ✅ 意图识别
- ✅ AI创建项目
- ✅ RAG知识检索
- ✅ Git状态查询
- ✅ 代码生成
- ✅ 代码解释

### 完整测试 (48个接口) - 75% 通过

#### 项目服务 (19个接口)
- **项目管理** (5个): 健康检查、创建、列表、详情、执行任务、删除
- **文件管理** (6个): 列表、创建、详情、更新、批量创建、删除
- **协作者管理** (5个): 列表、添加、更新、接受邀请、移除
- **评论管理** (6个): 列表、创建、更新、删除、回复、回复列表
- **自动化规则** (7个): 列表、创建、更新、删除、触发、切换、统计

#### AI服务 (29个接口)
- **基础接口** (2个): 根路径、健康检查
- **意图识别** (1个): 分类
- **项目管理** (3个): 创建、流式创建、执行任务
- **RAG相关** (6个): 查询、索引、统计、增强查询、更新、删除
- **Git操作** (13个): 初始化、状态、提交、推送、拉取、日志、差异、分支操作等
- **代码助手** (7个): 生成、审查、重构、解释、修复、测试、优化
- **聊天** (1个): 流式聊天

---

## 测试结果

### 当前状态 (完整测试)
- **总测试**: 48个
- **通过**: 36个 (75%)
- **失败**: 12个 (25%)
- **跳过**: 15个

### 问题分类
- **性能问题** (1个): AI流式创建耗时2小时+
- **功能问题** (12个): 状态码不匹配或接口未实现

---

## 报告文件

测试完成后会生成以下报告文件：

### 基础测试报告
- `test_report_project_basic.md` - 项目服务Markdown报告
- `test_report_project_basic.json` - 项目服务JSON报告
- `test_report_ai_basic.md` - AI服务Markdown报告
- `test_report_ai_basic.json` - AI服务JSON报告

### 完整测试报告
- `test_report_project_full.md` - 项目服务完整报告
- `test_report_project_full.json` - 项目服务完整JSON数据
- `test_report_ai_full.md` - AI服务完整报告
- `test_report_ai_full.json` - AI服务完整JSON数据

---

## 环境要求

### 必需服务
```bash
# 检查服务状态
docker ps

# 必需的容器
- chainlesschain-postgres (端口5432)
- chainlesschain-redis (端口6379)
- chainlesschain-qdrant (端口6333)
- chainlesschain-ollama (端口11434)
- chainlesschain-ai-service (端口8001)
- chainlesschain-project-service (端口9090)
```

### Python依赖
```bash
pip install requests
```

---

## 故障排查

### 连接失败
```bash
# 检查服务是否运行
curl http://localhost:9090/api/projects/health
curl http://localhost:8001/health
```

### 测试超时
- 基础测试默认超时: 600秒 (10分钟)
- 完整测试某些操作可能需要更长时间
- AI流式创建可能需要2小时+ (已知问题)

### 部分测试失败
- 正常现象，当前有12个接口存在问题
- 查看失败原因在详细报告中
- 重点关注"状态码不匹配"的接口

---

## 扩展测试

### 添加新测试

1. 在 `test_project_service_full.py` 或 `test_ai_service_full.py` 中添加测试方法
2. 按照现有格式定义测试:
```python
def test_new_feature(self):
    self.run_test(
        name="新功能测试",
        method="POST",
        endpoint="/api/new/endpoint",
        data={"key": "value"},
        expected_status=200
    )
```
3. 在 `run_all_tests()` 中调用新测试方法

### 修改超时时间

编辑 `test_framework.py`:
```python
class APITester:
    def __init__(self, base_url: str, timeout: int = 600):  # 修改这里
        ...
```

---

## 最佳实践

1. **日常开发**: 运行基础测试 (快速验证核心功能)
2. **集成测试**: 运行完整测试 (全面验证)
3. **持续集成**: 自动运行基础测试
4. **发布前**: 运行完整测试并修复所有问题

---

## 支持

如有问题，请查看:
- `FULL_TEST_SUMMARY.md` - 完整测试总结
- `ISSUES_FIXED.md` - 已修复问题的详细记录
- `FINAL_TEST_REPORT.md` - 最终测试报告

---

**最后更新**: 2025-12-24 18:30
**维护者**: Claude Code
