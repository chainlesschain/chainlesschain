# 快速测试指南

## 立即测试修复后的服务

### 1. 快速健康检查
```bash
# 测试项目服务
curl http://localhost:9090/api/projects/health

# 测试AI服务
curl http://localhost:8001/health

# 测试数据库连接
docker exec chainlesschain-postgres psql -U chainlesschain -d chainlesschain -c "SELECT 1;"
```

### 2. 运行自动化测试
```bash
cd C:\code\chainlesschain\backend\test

# 测试所有服务
python run_tests.py --service all

# 仅测试项目服务
python run_tests.py --service project

# 仅测试AI服务
python run_tests.py --service ai
```

### 3. 查看测试报告
- `test_report.md` - 详细的测试报告
- `test_report.json` - JSON格式数据
- `P0_FIX_SUMMARY.md` - P0修复总结

### 4. 如果遇到问题

#### 服务未启动
```bash
cd C:\code\chainlesschain
docker-compose up -d
docker-compose ps
```

#### 数据库连接失败
```bash
# 重置数据库
docker-compose down
rm -rf data/postgres
docker-compose up -d
```

#### 查看日志
```bash
# 项目服务日志
docker logs chainlesschain-project-service

# AI服务日志
docker logs chainlesschain-ai-service

# PostgreSQL日志
docker logs chainlesschain-postgres
```

---

## 当前服务状态

### ✅ 正常运行
- PostgreSQL: 端口 5432
- Redis: 端口 6379
- Qdrant: 端口 6333
- Ollama: 端口 11434
- AI Service: 端口 8001
- Project Service: 端口 9090

### 测试结果
- 项目服务: 66.67% 通过 (2/3)
- AI服务: 62.50% 通过 (5/8)
- 综合: 63.64% 通过 (7/11)

### 已知问题（低优先级）
1. 部分LLM功能需要配置API密钥
2. Git操作需要有效的仓库路径
3. 一个接口响应格式待调整

---

**更新时间**: 2025-12-24 16:26
