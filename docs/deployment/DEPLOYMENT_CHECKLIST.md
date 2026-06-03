# P1优化生产部署检查清单

**版本**: v0.17.0
**部署日期**: 2026-01-01
**负责人**: ___________

---

## 📋 部署前检查

### 1. 环境准备

- [ ] **数据库备份**
  ```bash
  cp data/chainlesschain.db data/chainlesschain.db.backup-$(date +%Y%m%d)
  ```

- [ ] **代码备份**
  ```bash
  git branch backup-pre-p1-$(date +%Y%m%d)
  git push origin backup-pre-p1-$(date +%Y%m%d)
  ```

- [ ] **环境检查**
  - [ ] Node.js版本 >= 18.0.0
  - [ ] 磁盘空间 >= 1GB
  - [ ] 内存 >= 4GB

### 2. 依赖检查

- [ ] **npm依赖安装**
  ```bash
  cd desktop-app-vue
  npm install
  ```

- [ ] **数据库迁移**
  ```bash
  node run-migration-p1.js
  ```
  - 预期输出: "✅ P1优化迁移成功！"
  - 新增表数: 4
  - 新增视图数: 5
  - 新增触发器数: 4

- [ ] **P1模块测试**
  ```bash
  node test-p1-simple.js
  ```
  - 预期通过率: 100% (7/7)

### 3. 配置检查

- [ ] **生产环境配置**
  - [ ] `.env.production` 文件存在
  - [ ] 所有P1模块开关已设置
  - [ ] LLM配置正确（OLLAMA_HOST, OLLAMA_MODEL）
  - [ ] 性能阈值已调整为生产值

- [ ] **LLM服务检查**
  ```bash
  curl http://localhost:11434/api/tags
  ```
  - 预期: 返回模型列表，包含 qwen2:7b

- [ ] **向量数据库检查**
  ```bash
  curl http://localhost:6333/collections
  ```
  - 预期: 返回集合列表或空数组

---

## 🚀 部署步骤

### 步骤1: 停止当前服务

- [ ] **关闭应用程序**
  - 保存所有未保存的工作
  - 退出ChainlessChain桌面应用

- [ ] **停止后端服务**（如果运行）
  ```bash
  docker-compose down
  ```

### 步骤2: 更新代码

- [ ] **拉取最新代码**
  ```bash
  git pull origin main
  ```

- [ ] **检查文件更新**
  - [ ] `src/main/index.js` - 已更新为P1引擎
  - [ ] `src/main/ai-engine/ai-engine-manager-p1.js` - 存在
  - [ ] `src/main/ai-engine/ai-engine-config.js` - 已添加P1配置
  - [ ] `src/main/migrations/003_add_p1_optimization_tables.sql` - 存在

### 步骤3: 执行数据库迁移

- [ ] **运行迁移脚本**
  ```bash
  cd desktop-app-vue
  node run-migration-p1.js
  ```

- [ ] **验证迁移结果**
  ```bash
  node test-p1-simple.js
  ```

### 步骤4: 构建生产版本

- [ ] **清理构建缓存**
  ```bash
  rm -rf out/
  rm -rf dist/
  ```

- [ ] **构建应用**
  ```bash
  npm run build
  ```

- [ ] **打包应用**（可选）
  ```bash
  npm run make:win
  ```

### 步骤5: 启动服务

- [ ] **启动后端服务**
  ```bash
  docker-compose up -d
  ```

- [ ] **验证服务状态**
  ```bash
  docker-compose ps
  ```
  - 所有服务状态应为 `Up`

- [ ] **启动桌面应用**
  - 方式1: 开发模式 `npm run dev`
  - 方式2: 生产包 `./out/make/...`

---

## ✅ 部署后验证

### 1. 功能验证

- [ ] **基本功能测试**
  - [ ] 应用正常启动
  - [ ] 登录功能正常
  - [ ] 数据库连接成功

- [ ] **P1功能测试**

  **测试1: 单意图识别**
  - [ ] 输入: "创建一个README.md文件"
  - [ ] 预期: 识别为CREATE_FILE，执行成功

  **测试2: 多意图识别**
  - [ ] 输入: "创建博客网站并部署到云端"
  - [ ] 预期: 识别为2个意图，按依赖顺序执行

  **测试3: 槽位填充**
  - [ ] 输入: "生成一个报告"
  - [ ] 预期: 自动推断文件类型为docx

  **测试4: 分层规划**
  - [ ] 输入: "分析项目代码"
  - [ ] 预期: 显示业务层、技术层、执行层步骤

  **测试5: 自我修正**
  - [ ] 输入: 一个可能失败的任务
  - [ ] 预期: 自动重试并修正

### 2. 性能验证

- [ ] **性能指标检查**
  ```javascript
  // 在开发者工具中执行
  window.electron.invoke('ai:getPerformanceReport')
  ```

  - [ ] 平均响应时间 < 15秒
  - [ ] 成功率 > 85%
  - [ ] P50延迟 < 10秒
  - [ ] P90延迟 < 20秒

- [ ] **P1统计查询**
  ```javascript
  window.electron.invoke('ai:getP1Stats')
  ```

  - [ ] 返回多意图统计
  - [ ] 返回检查点统计
  - [ ] 返回自我修正统计

### 3. 数据验证

- [ ] **数据库表检查**
  ```sql
  SELECT name FROM sqlite_master
  WHERE type='table' AND name LIKE '%history';
  ```

  - 应包含:
    - `multi_intent_history`
    - `checkpoint_validations`
    - `self_correction_history`
    - `hierarchical_planning_history`

- [ ] **视图检查**
  ```sql
  SELECT * FROM v_p1_optimization_summary;
  ```

  - 应返回3行统计数据

### 4. 日志检查

- [ ] **应用日志**
  - [ ] 检查启动日志中包含 "P1优化已启用"
  - [ ] 无严重错误（ERROR级别）
  - [ ] 警告数量在可接受范围内

- [ ] **数据库日志**
  - [ ] P1表自动清理触发器已激活
  - [ ] 数据写入正常

---

## 🔧 故障排除

### 问题1: 数据库迁移失败

**症状**: 运行迁移脚本时报错

**检查**:
```bash
# 检查数据库文件
ls -lh data/chainlesschain.db

# 检查迁移脚本
cat desktop-app-vue/src/main/migrations/003_add_p1_optimization_tables.sql
```

**解决**:
- 确保数据库文件存在且可写
- 检查迁移SQL语法
- 回滚到备份并重试

### 问题2: P1模块未启用

**症状**: 测试显示P1功能未工作

**检查**:
```javascript
// 在应用中检查配置
const config = require('./src/main/ai-engine/ai-engine-config');
console.log(config.getAIEngineConfig());
```

**解决**:
- 检查 `.env.production` 文件
- 确保环境变量正确加载
- 重启应用

### 问题3: 性能下降

**症状**: P1部署后响应变慢

**检查**:
```bash
# 检查系统资源
top
df -h

# 检查LLM服务
curl http://localhost:11434/api/tags
```

**解决**:
- 调整性能阈值
- 减少P1模块开启数量
- 优化LLM模型

### 问题4: LLM服务不可用

**症状**: P1功能降级到规则模式

**检查**:
```bash
docker-compose ps
docker logs chainlesschain-ollama
```

**解决**:
- 重启Ollama服务
- 检查模型是否已下载
- 验证网络连接

---

## 🔙 回滚方案

如果部署后出现严重问题，执行以下回滚步骤：

### 方案A: 快速回滚（使用Git）

```bash
# 1. 切换到备份分支
git checkout backup-pre-p1-$(date +%Y%m%d)

# 2. 恢复数据库
cp data/chainlesschain.db.backup-$(date +%Y%m%d) data/chainlesschain.db

# 3. 重启应用
npm run dev
```

### 方案B: 配置回滚（保留代码，关闭P1）

编辑 `.env.production`:
```bash
# 关闭所有P1模块
ENABLE_MULTI_INTENT=false
ENABLE_DYNAMIC_FEW_SHOT=false
ENABLE_HIERARCHICAL_PLANNING=false
ENABLE_CHECKPOINT_VALIDATION=false
ENABLE_SELF_CORRECTION=false
```

重启应用。

### 方案C: 代码回滚（手动）

1. 编辑 `src/main/index.js`:
   ```javascript
   // 改回P0引擎
   const { AIEngineManagerOptimized, getAIEngineManagerOptimized } =
     require('./ai-engine/ai-engine-manager-optimized');
   const AIEngineManager = AIEngineManagerOptimized;
   const getAIEngineManager = getAIEngineManagerOptimized;
   ```

2. 重启应用

---

## 📊 部署总结

### 部署信息

- **部署时间**: ___________
- **部署人员**: ___________
- **部署版本**: v0.17.0
- **部署环境**: 生产环境

### 部署结果

- [ ] **成功** - 所有检查通过，系统运行正常
- [ ] **部分成功** - 部分功能正常，有小问题但不影响使用
- [ ] **失败** - 已回滚到之前版本

### 遗留问题

1. ___________
2. ___________
3. ___________

### 备注

___________

---

## 📞 支持联系

如遇问题，请联系：
- **技术支持**: support@chainlesschain.com
- **紧急联系**: ___________

---

**签名确认**

部署执行人: ___________ 日期: ___________
技术负责人: ___________ 日期: ___________
项目负责人: ___________ 日期: ___________
