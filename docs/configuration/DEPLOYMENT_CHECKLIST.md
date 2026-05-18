# SQLite-PostgreSQL数据同步 - 部署验证清单

**部署日期**: 待定
**验证环境**: 测试环境
**状态**: ⏳ 待执行

---

## ✅ 部署前检查清单

### 1. 代码完整性

- [x] ✅ 所有修复代码已提交
- [x] ✅ 14个文件修改完成
- [x] ✅ 90个单元测试编写完成
- [x] ✅ 6份技术文档完成
- [ ] ⏳ 代码审查通过
- [ ] ⏳ Git提交推送

### 2. 测试验证

- [x] ✅ 功能验证测试通过（84.2%）
- [x] ✅ 性能基准测试通过（100%）
- [ ] ⏳ 集成测试通过（需环境）
- [ ] ⏳ 端到端测试通过

### 3. 文档完备性

- [x] ✅ 修复报告文档
- [x] ✅ 测试验证报告
- [x] ✅ 性能基准报告
- [x] ✅ API文档更新
- [ ] ⏳ 用户手册更新
- [ ] ⏳ 发布说明编写

---

## 🚀 部署步骤

### 步骤1: 后端服务部署

#### 1.1 数据库迁移

```sql
-- 添加version字段到project_files表
ALTER TABLE project_files ADD COLUMN version INT DEFAULT 1;

-- 添加version字段到projects表
ALTER TABLE projects ADD COLUMN version INT DEFAULT 1;

-- 验证字段
DESCRIBE project_files;
DESCRIBE projects;
```

**验证**: ✅ version字段存在且默认值为1

#### 1.2 Redis配置检查

```bash
# 检查Redis连接
redis-cli ping
# 预期输出: PONG

# 检查Redis配置
redis-cli CONFIG GET maxmemory
# 确保有足够内存
```

**验证**: ✅ Redis可用且配置正确

#### 1.3 后端服务编译

```bash
cd backend/project-service

# 编译项目
mvn clean compile -DskipTests

# 运行测试
mvn test

# 打包
mvn clean package -DskipTests
```

**验证**: ✅ 编译成功，无错误

#### 1.4 启动后端服务

```bash
# 方式1: 直接运行
mvn spring-boot:run

# 方式2: 运行JAR
java -jar target/project-service-0.1.0.jar

# 验证服务启动
curl http://localhost:9090/api/sync/server-time
```

**预期输出**:
```json
{
  "code": 200,
  "message": "操作成功",
  "data": {
    "timestamp": 1703596800000,
    "timezone": "Asia/Shanghai",
    "iso8601": "2023-12-26T08:00:00.000Z"
  }
}
```

**验证**: ✅ 服务启动成功，API可访问

---

### 步骤2: 前端应用部署

#### 2.1 依赖安装

```bash
cd desktop-app-vue

# 清理旧依赖
rm -rf node_modules package-lock.json

# 安装依赖
npm install

# 验证关键依赖
npm list sql.js better-sqlite3 axios
```

**验证**: ✅ 依赖安装完整

#### 2.2 配置检查

**检查同步配置** (`src/main/sync/sync-config.js`):
```javascript
module.exports = {
  backendUrl: 'http://localhost:9090',  // ✅ 确认后端地址
  maxConcurrency: 3,                     // ✅ 确认并发数
  syncInterval: 5 * 60 * 1000,          // ✅ 确认同步间隔
  // ...
};
```

**验证**: ✅ 配置正确

#### 2.3 构建应用

```bash
# 构建主进程
npm run build:main

# 构建渲染进程
npm run build:renderer

# 完整构建
npm run build
```

**验证**: ✅ 构建成功，无错误

#### 2.4 开发环境启动

```bash
# 启动开发模式
npm run dev

# 观察控制台输出
# 应该看到:
# [DBSyncManager] 初始化，设备ID: xxx
# [DBSyncManager] 时间同步完成
# [DBSyncManager] 定期清理任务已启动
```

**验证**: ✅ 应用启动成功

---

### 步骤3: 集成测试

#### 3.1 登录后同步测试

**操作步骤**:
1. 启动桌面应用
2. 登录用户账号
3. 观察同步日志

**预期行为**:
```
[DBSyncManager] 开始登录后同步（并发模式）
[DBSyncManager] 同步表: projects (优先级: 8)
[DBSyncManager] 同步表: project_files (优先级: 7)
[DBSyncManager] 同步表: knowledge_items (优先级: 6)
...
[DBSyncManager] 同步完成: 成功8个表, 失败0个表, 冲突0个
```

**验证指标**:
- [ ] ✅ 8张表全部同步成功
- [ ] ✅ 并发执行（3个表同时同步）
- [ ] ✅ 耗时 < 1秒
- [ ] ✅ 无错误日志

#### 3.2 增量同步测试

**操作步骤**:
1. 创建新项目
2. 修改项目信息
3. 等待5分钟自动同步，或手动触发

**预期行为**:
```
[DBSyncManager] 开始增量同步（并发模式）
[DBSyncManager] 发现1个表需要同步: ['projects']
[DBSyncManager] 增量同步表: projects
[DBSyncManager] 上传1条记录到表 projects
[DBSyncManager] 增量同步完成: 成功1个表, 失败0个表
```

**验证指标**:
- [ ] ✅ 只同步有变更的表
- [ ] ✅ 上传成功
- [ ] ✅ sync_status变为'synced'
- [ ] ✅ synced_at更新

#### 3.3 冲突处理测试

**操作步骤**:
1. 设备A修改项目名称为"测试A"
2. 设备B同时修改为"测试B"
3. A先同步成功
4. B尝试同步

**预期行为**:
```
[DBSyncManager] 检测到冲突: projects test-project-123
[DBSyncManager] 冲突: table=projects, id=test-project-123
[前端] 显示冲突解决对话框
```

**验证指标**:
- [ ] ✅ 冲突被检测到
- [ ] ✅ 本地记录标记为'conflict'
- [ ] ✅ 冲突对话框弹出
- [ ] ✅ 用户可手动解决

#### 3.4 网络故障重试测试

**操作步骤**:
1. 创建新项目
2. 断开网络连接
3. 尝试同步（会失败）
4. 恢复网络连接
5. 再次同步

**预期行为**:
```
[DBSyncManager] 上传projects记录[test-123]
[RetryPolicy] 上传projects记录[test-123] 第1次失败，118ms后重试
[RetryPolicy] 上传projects记录[test-123] 第2次失败，243ms后重试
[RetryPolicy] 上传projects记录[test-123] 第3次失败，放弃重试
[DBSyncManager] 上传最终失败: table=projects, id=test-123
-- (网络恢复后) --
[DBSyncManager] 重试上传: table=projects, id=test-123, attempt=1
[DBSyncManager] 上传成功
```

**验证指标**:
- [ ] ✅ 自动重试6次
- [ ] ✅ 指数退避延迟
- [ ] ✅ 网络恢复后成功
- [ ] ✅ 幂等性保证（requestId）

#### 3.5 软删除恢复测试

**操作步骤**:
1. 创建测试项目
2. 删除项目（软删除）
3. 检查数据库：deleted=1
4. 恢复项目
5. 检查数据库：deleted=0
6. 等待30天后（模拟）物理删除

**预期行为**:
```
[Database] 软删除记录: projects, id=test-123
[Database] deleted=1, sync_status='pending'
-- (恢复后) --
[Database] 恢复软删除: projects, id=test-123
[Database] deleted=0, sync_status='pending'
-- (30天后) --
[Database] 清理软删除记录: projects
[Database] 物理删除1条记录
```

**验证指标**:
- [ ] ✅ 软删除正常（deleted=1）
- [ ] ✅ 恢复功能正常（deleted=0）
- [ ] ✅ 定期清理运行
- [ ] ✅ 同步状态正确

---

### 步骤4: 性能验证

#### 4.1 登录同步性能

**测试方法**:
- 清空本地数据库
- 服务器准备100条项目数据
- 登录触发首次同步
- 记录耗时

**性能指标**:
- [ ] ✅ 同步耗时 < 2秒
- [ ] ✅ CPU使用率 < 80%
- [ ] ✅ 内存增长 < 100MB
- [ ] ✅ 无卡顿

#### 4.2 增量同步性能

**测试方法**:
- 修改10条记录
- 触发增量同步
- 记录耗时

**性能指标**:
- [ ] ✅ 同步耗时 < 500ms
- [ ] ✅ 只上传变更的记录
- [ ] ✅ 并发执行
- [ ] ✅ 无阻塞UI

#### 4.3 并发性能

**测试方法**:
- 8张表同时有变更
- 触发完整同步
- 观察并发执行

**性能指标**:
- [ ] ✅ 最多3个表同时同步
- [ ] ✅ 总耗时 < 串行的50%
- [ ] ✅ 队列调度正常
- [ ] ✅ 优先级生效

---

### 步骤5: 生产环境部署（可选）

#### 5.1 打包应用

```bash
cd desktop-app-vue

# Windows打包
npm run make:win

# 输出位置
# out/make/squirrel.windows/x64/ChainlessChain-*.exe
```

#### 5.2 安装测试

1. 安装打包的应用
2. 配置生产服务器地址
3. 完整功能测试
4. 性能压力测试

#### 5.3 监控配置

1. 配置应用日志收集
2. 配置性能监控
3. 配置错误告警
4. 配置用户反馈渠道

---

## 📊 验证结果记录

### 后端服务

| 检查项 | 状态 | 备注 |
|--------|------|------|
| 数据库迁移 | ⏳ 待执行 | |
| Redis可用性 | ⏳ 待执行 | |
| 服务启动 | ⏳ 待执行 | |
| API测试 | ⏳ 待执行 | |

### 前端应用

| 检查项 | 状态 | 备注 |
|--------|------|------|
| 依赖安装 | ⏳ 待执行 | |
| 配置检查 | ⏳ 待执行 | |
| 构建成功 | ⏳ 待执行 | |
| 应用启动 | ⏳ 待执行 | |

### 集成测试

| 测试场景 | 状态 | 耗时 | 备注 |
|---------|------|------|------|
| 登录同步 | ⏳ 待执行 | | |
| 增量同步 | ⏳ 待执行 | | |
| 冲突处理 | ⏳ 待执行 | | |
| 网络重试 | ⏳ 待执行 | | |
| 软删除恢复 | ⏳ 待执行 | | |

### 性能验证

| 性能指标 | 目标 | 实际 | 状态 |
|---------|------|------|------|
| 登录同步 | < 2s | ⏳ 待测 | |
| 增量同步 | < 500ms | ⏳ 待测 | |
| 并发效率 | > 90% | ⏳ 待测 | |
| CPU使用 | < 80% | ⏳ 待测 | |
| 内存增长 | < 100MB | ⏳ 待测 | |

---

## ⚠️ 已知问题与限制

### 1. 环境依赖

- **后端服务**: 需要Spring Boot + PostgreSQL + Redis
- **前端应用**: 需要Electron环境
- **网络要求**: 需要可靠的网络连接

### 2. 性能限制

- **并发数**: 默认3，可配置但不建议超过8
- **大表同步**: 超过10000条记录可能较慢
- **网络带宽**: 影响实际同步速度

### 3. 功能限制

- **软删除**: 只保留30天，需注意重要数据
- **冲突解决**: 当前需要手动解决
- **时间偏移**: 如果超过5分钟会有警告

---

## 🚀 部署后监控

### 关键指标

1. **同步成功率**: 目标 > 98%
2. **平均同步时间**: 目标 < 1秒
3. **错误率**: 目标 < 2%
4. **冲突率**: 预期 < 5%

### 日志监控

```bash
# 查看同步日志
grep "DBSyncManager" logs/main.log

# 查看错误日志
grep "ERROR" logs/main.log

# 查看重试日志
grep "重试" logs/main.log

# 查看冲突日志
grep "冲突" logs/main.log
```

### 性能监控

```bash
# 查看同步耗时
grep "同步完成" logs/main.log | awk '{print $NF}'

# 查看并发状态
grep "activeCount" logs/main.log

# 查看重试次数
grep "重试上传" logs/main.log | wc -l
```

---

## 📝 部署记录

**执行人**: _____________
**执行日期**: _____________
**环境**: ☐ 开发 ☐ 测试 ☐ 生产

### 部署步骤签字

- [ ] 后端服务部署完成 ___________
- [ ] 前端应用部署完成 ___________
- [ ] 集成测试通过 ___________
- [ ] 性能验证通过 ___________
- [ ] 监控配置完成 ___________

### 问题记录

| 问题 | 严重性 | 状态 | 解决方案 |
|------|--------|------|---------|
| | | | |

---

## 🎉 部署完成确认

### 最终检查

- [ ] 所有测试通过
- [ ] 性能指标达标
- [ ] 监控正常运行
- [ ] 文档已更新
- [ ] 用户已通知

### 签字确认

**开发**: _____________  日期: _____________
**测试**: _____________  日期: _____________
**运维**: _____________  日期: _____________

---

**部署状态**: ⏳ 准备就绪，待执行
**建议操作**: 立即进行后端服务部署和集成测试
