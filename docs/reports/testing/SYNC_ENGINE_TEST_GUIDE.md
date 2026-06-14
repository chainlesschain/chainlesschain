# P2P同步引擎测试指南

**日期**: 2025-12-30
**版本**: v1.0

---

## 📋 测试概述

本文档提供P2P数据同步引擎的完整测试指南，包括单元测试、集成测试和手动测试场景。

---

## 🔧 环境准备

### 1. 安装测试依赖

```bash
cd desktop-app-vue
npm install --save-dev jest better-sqlite3
```

### 2. 配置Jest

在 `desktop-app-vue/package.json` 中添加测试脚本：

```json
{
  "scripts": {
    "test": "jest",
    "test:sync": "jest p2p-sync-engine",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage"
  },
  "jest": {
    "testEnvironment": "node",
    "testMatch": ["**/tests/**/*.test.js"],
    "coverageDirectory": "coverage",
    "collectCoverageFrom": [
      "src/main/sync/**/*.js"
    ]
  }
}
```

---

## ✅ 单元测试

### 运行单元测试

```bash
# 运行所有同步引擎测试
npm run test:sync

# 运行测试并生成覆盖率报告
npm run test:coverage

# 监视模式（开发时使用）
npm run test:watch
```

### 测试用例列表

#### 1. 初始化测试
- ✅ 成功初始化同步引擎
- ✅ 注册P2P消息处理器

#### 2. 同步状态管理测试
- ✅ 获取不存在的同步状态
- ✅ 创建新的同步状态
- ✅ 更新已存在的同步状态

#### 3. 冲突检测测试
- ✅ 检测本地更新（local_wins）
- ✅ 检测远程更新（remote_wins）
- ✅ 检测并发修改（conflict）
- ✅ 检测已同步状态（synced）
- ✅ 处理缺失DID的情况

#### 4. 冲突解决测试
- ✅ LWW策略-远程获胜
- ✅ LWW策略-本地获胜
- ✅ 根据资源类型选择策略

#### 5. 离线队列测试
- ✅ 添加项到离线队列
- ✅ 处理离线队列中的项
- ✅ 重试失败的队列项
- ✅ 达到最大重试次数后标记为失败

#### 6. 同步统计测试
- ✅ 获取同步统计信息
- ✅ 返回空组织的统计信息

#### 7. 待同步资源测试
- ✅ 获取待同步的资源列表
- ✅ 限制返回的资源数量（批量大小）

#### 8. 自动同步测试
- ✅ 启动自动同步
- ✅ 停止自动同步
- ✅ 启动新同步前停止旧同步

#### 9. P2P消息处理测试
- ✅ 处理同步请求消息
- ✅ 处理同步变更消息

---

## 🔄 集成测试

### 场景1: 完整同步流程

#### 测试步骤

1. **准备测试环境**
   ```bash
   npm run dev
   ```

2. **创建测试组织**
   - 打开应用
   - 创建新组织"测试同步组织"
   - 记录组织ID

3. **创建测试资源**
   - 创建知识库条目 "测试知识1"
   - 创建项目 "测试项目1"

4. **验证同步状态**
   - 打开同步状态监控组件
   - 检查统计信息：
     - 总资源数 ≥ 2
     - 已同步数 ≥ 2
     - 待同步数 = 0
     - 冲突数 = 0

5. **修改资源触发同步**
   - 编辑 "测试知识1" 内容
   - 观察同步状态变化：
     - 待同步数 +1
     - 自动同步后变回已同步

#### 预期结果

- ✅ 资源修改后标记为 'pending'
- ✅ 30秒内自动同步完成
- ✅ 同步状态更新为 'synced'
- ✅ 离线队列为空

---

### 场景2: 冲突检测与解决

#### 测试步骤

1. **模拟并发修改**

   方法1：使用两个客户端
   - 打开两个应用实例（Alice和Bob）
   - 同时编辑同一个知识库条目
   - 观察冲突产生

   方法2：直接修改数据库（仅测试用）
   ```javascript
   // 在控制台执行
   await window.ipc.invoke('db:execute', `
     INSERT INTO sync_conflicts (
       id, org_id, resource_type, resource_id,
       local_version, remote_version,
       local_data, remote_data,
       local_vector_clock, remote_vector_clock,
       created_at
     ) VALUES (
       'conflict_test_001',
       'org_abc123',
       'knowledge',
       'kb_001',
       2, 2,
       '{"title": "Local Title", "content": "Local content"}',
       '{"title": "Remote Title", "content": "Remote content"}',
       '{"did:test:alice": 2}',
       '{"did:test:bob": 2}',
       ${Date.now()}
     )
   `);
   ```

2. **查看冲突**
   - 点击同步状态监控中的"查看冲突"按钮
   - 应该显示冲突列表

3. **解决冲突**

   **方案A：使用本地版本**
   - 点击"使用本地版本"按钮
   - 验证本地数据被保留

   **方案B：使用远程版本**
   - 点击"使用远程版本"按钮
   - 验证远程数据被应用

   **方案C：手动合并**
   - 点击"手动合并"按钮
   - 编辑JSON数据
   - 保存合并结果
   - 验证合并后的数据正确

#### 预期结果

- ✅ 冲突被正确检测并记录
- ✅ 冲突列表显示完整信息
- ✅ 本地/远程数据对比清晰
- ✅ 冲突解决后从列表消失
- ✅ 同步状态更新为 'synced'

---

### 场景3: 离线队列测试

#### 测试步骤

1. **模拟离线状态**
   - 禁用网络或P2P连接
   - 或在代码中临时禁用 `p2pManager`

2. **执行操作**
   - 创建新知识库条目
   - 编辑现有条目
   - 删除条目

3. **验证队列**
   ```javascript
   // 在控制台查看离线队列
   const queue = await window.ipc.invoke('db:query', `
     SELECT * FROM sync_queue WHERE status = 'pending'
   `);
   console.log('离线队列:', queue);
   ```

4. **恢复在线**
   - 重新启用网络
   - 等待队列自动处理（5秒间隔）

5. **验证同步**
   - 检查队列项状态变为 'completed'
   - 验证数据已同步

#### 预期结果

- ✅ 离线操作被添加到队列
- ✅ 队列持久化（重启不丢失）
- ✅ 在线后自动处理队列
- ✅ 失败项自动重试
- ✅ 超过最大重试次数后标记为失败

---

### 场景4: 自动同步测试

#### 测试步骤

1. **启动自动同步**
   ```javascript
   const orgId = 'org_abc123';
   await window.ipc.invoke('sync:start-auto-sync', orgId);
   ```

2. **观察自动同步**
   - 每30秒应该自动执行一次同步
   - 观察控制台日志：
     ```
     [P2PSyncEngine] 开始同步: org_abc123
     [P2PSyncEngine] 待同步资源: X 个
     [P2PSyncEngine] 远程变更: Y 个
     [P2PSyncEngine] ✓ 同步完成: {...}
     ```

3. **修改数据测试**
   - 在自动同步间隔内修改数据
   - 验证下次自动同步时数据被推送

4. **停止自动同步**
   ```javascript
   await window.ipc.invoke('sync:stop-auto-sync');
   ```

#### 预期结果

- ✅ 自动同步定时器正常运行（30秒）
- ✅ 队列处理定时器正常运行（5秒）
- ✅ 数据变更被自动同步
- ✅ 停止后不再自动同步

---

## 🎯 手动测试检查清单

### 功能测试

- [ ] **同步状态监控组件**
  - [ ] 显示正确的统计信息
  - [ ] 实时刷新（10秒）
  - [ ] 点击按钮打开抽屉
  - [ ] 立即同步按钮工作正常
  - [ ] 查看冲突按钮跳转正确

- [ ] **冲突解决UI**
  - [ ] 显示冲突列表
  - [ ] 数据对比清晰
  - [ ] 三种解决方案都能正常工作
  - [ ] 手动合并JSON编辑器正常
  - [ ] JSON格式错误时显示提示

- [ ] **IPC接口**
  - [ ] `sync:start-auto-sync` 正常工作
  - [ ] `sync:stop-auto-sync` 正常工作
  - [ ] `sync:sync-now` 返回正确结果
  - [ ] `sync:get-stats` 返回正确统计
  - [ ] `sync:get-conflicts` 返回冲突列表
  - [ ] `sync:resolve-conflict` 正确解决冲突
  - [ ] `sync:add-to-queue` 添加到队列

### 性能测试

- [ ] **大量资源同步**
  - [ ] 创建100+个知识库条目
  - [ ] 全部标记为待同步
  - [ ] 验证批量同步性能
  - [ ] 检查是否有内存泄漏

- [ ] **频繁修改**
  - [ ] 快速连续修改多个资源
  - [ ] 验证离线队列不会溢出
  - [ ] 检查数据库性能

- [ ] **长时间运行**
  - [ ] 让自动同步运行1小时+
  - [ ] 检查是否有定时器泄漏
  - [ ] 验证统计信息准确性

### 边界测试

- [ ] **空数据测试**
  - [ ] 空组织同步
  - [ ] 无待同步资源
  - [ ] 无冲突

- [ ] **极端情况**
  - [ ] 非常大的JSON数据（>1MB）
  - [ ] 版本号很大（>1000）
  - [ ] 向量时钟包含大量DID（>100）

- [ ] **错误处理**
  - [ ] P2P网络未初始化
  - [ ] 数据库错误
  - [ ] JSON解析错误
  - [ ] 网络断开

---

## 🐛 已知问题和限制

### 当前限制

1. **P2P网络依赖**
   - 如果P2P管理器未初始化，仅处理本地队列
   - 需要确保P2P网络正常工作

2. **签名验证**
   - 当前使用简化的哈希签名
   - 需要实现真实的DID私钥签名

3. **冲突解决**
   - Knowledge类型默认需要手动解决
   - 没有自动Three-Way Merge

4. **性能**
   - 大量资源同步可能较慢
   - 需要优化批量处理

### 测试注意事项

1. **数据库状态**
   - 测试前备份数据库
   - 测试后清理测试数据

2. **定时器清理**
   - 停止自动同步后验证定时器已清理
   - 避免内存泄漏

3. **并发测试**
   - 多客户端测试需要真实P2P网络
   - 本地模拟有限

---

## 📊 测试报告模板

### 测试执行报告

```markdown
# 同步引擎测试报告

**测试日期**: YYYY-MM-DD
**测试人员**: XXX
**测试环境**:
- OS: Windows/macOS/Linux
- Node版本: vX.X.X
- 应用版本: vX.X.X

## 测试结果

### 单元测试
- 总用例数: XX
- 通过: XX
- 失败: XX
- 覆盖率: XX%

### 集成测试
- [ ] 完整同步流程 - ✅/❌
- [ ] 冲突检测与解决 - ✅/❌
- [ ] 离线队列 - ✅/❌
- [ ] 自动同步 - ✅/❌

### 发现的问题
1. 问题描述
   - 重现步骤
   - 预期结果
   - 实际结果
   - 严重程度: 高/中/低

### 性能数据
- 100个资源同步时间: XXXms
- 冲突检测耗时: XXXms
- 内存使用: XXXmb

### 结论
- [ ] 通过所有测试
- [ ] 通过部分测试（有minor issues）
- [ ] 未通过测试（有major bugs）
```

---

## 🚀 自动化测试脚本

### 快速测试脚本

创建 `desktop-app-vue/tests/sync-quick-test.js`:

```javascript
const { spawn } = require('child_process');

async function runQuickTest() {
  console.log('🚀 开始快速测试...\n');

  // 1. 运行单元测试
  console.log('📝 运行单元测试...');
  const jest = spawn('npm', ['run', 'test:sync']);

  jest.stdout.on('data', (data) => {
    console.log(data.toString());
  });

  jest.on('close', (code) => {
    if (code === 0) {
      console.log('\n✅ 单元测试通过\n');
    } else {
      console.log('\n❌ 单元测试失败\n');
      process.exit(1);
    }
  });
}

runQuickTest();
```

### 运行快速测试

```bash
node tests/sync-quick-test.js
```

---

## 📚 参考资料

- **同步协议设计**: `desktop-app-vue/docs/SYNC_PROTOCOL_DESIGN.md`
- **同步引擎实现报告**: `SYNC_ENGINE_IMPLEMENTATION_REPORT.md`
- **Jest文档**: https://jestjs.io/
- **Better-SQLite3文档**: https://github.com/WiseLibs/better-sqlite3

---

**创建日期**: 2025-12-30
**最后更新**: 2025-12-30

## 附录：规范章节补全（v5.0.3.108）

> 为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述
见正文头部。本文：P2P同步引擎测试指南。

### 2. 核心特性
见正文要点 / 特性 / 范围章节。

### 3. 系统架构
见正文架构 / 设计章节（或项目根 docs/design/ 系统设计主文档）。

### 4. 系统定位
见正文定位 / 背景章节。

### 5. 核心功能
见正文功能 / 内容章节。

### 6. 技术架构
见正文技术 / 实现章节。

### 7. 系统特点
见正文（状态 / 版本 / 特性）。

### 8. 应用场景
见正文应用场景 / 背景。

### 9. 竞品对比
见正文对比 / 借鉴（如有）。

### 10. 配置参考
见正文配置 / 参数 / 环境章节。

### 11. 性能指标
见正文性能 / 指标章节（如有）。

### 12. 测试覆盖
见正文测试 / 验证章节（如有）。

### 13. 安全考虑
见正文安全 / 权限章节（如适用）。

### 14. 故障排除
见正文故障 / 已知限制 / 常见问题章节。

### 15. 关键文件
见正文实现位置 / 关键文件章节。

### 16. 使用示例
见正文命令 / 操作 / API 示例。

### 17. 相关文档
见正文相关链接；项目根 docs/design/ 系统设计主文档与对应模块文档。
