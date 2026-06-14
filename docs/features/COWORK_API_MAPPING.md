# Cowork API 映射文档

**目的**: 映射测试文件中使用的 API 与实际实现的 API

**问题**: E2E 测试文件 (`cowork-e2e.test.js`) 使用的方法名与实际实现不匹配

---

## TeammateTool API 映射

| 测试中使用的方法 | 实际实现的方法 | 状态 | 说明 |
|-----------------|---------------|------|------|
| `addAgent(teamId, agentInfo)` | `requestJoin(teamId, agentId, agentInfo)` | ⚠️ 不匹配 | 需要传递 agentId |
| `listTeams(filters)` | `discoverTeams(filters)` | ⚠️ 不匹配 | 方法名不同 |
| `updateTaskStatus(taskId, status, result)` | ❌ 不存在 | ❌ 缺失 | 需要实现或使用其他方法 |
| `getMetrics(teamId)` | `getStats()` | ⚠️ 不匹配 | 方法签名不同 |
| `disbandTeam(teamId)` | `destroyTeam(teamId)` | ⚠️ 不匹配 | 方法名不同 |
| `getAgent(agentId)` | ❌ 不存在 | ❌ 缺失 | 需要实现 |
| `getTask(taskId)` | ❌ 不存在 | ❌ 缺失 | 需要实现 |
| `getTeam(teamId)` | `getTeamStatus(teamId)` | ⚠️ 部分匹配 | 功能可能不完全相同 |

**实际实现的方法**（TeammateTool）:
- ✅ `spawnTeam(teamName, config)`
- ✅ `discoverTeams(filters)`
- ✅ `requestJoin(teamId, agentId, agentInfo)`
- ✅ `assignTask(teamId, agentId, task)`
- ✅ `broadcastMessage(teamId, fromAgent, message)`
- ✅ `sendMessage(fromAgent, toAgent, message)`
- ✅ `voteOnDecision(teamId, decision, votes)`
- ✅ `getTeamStatus(teamId)`
- ✅ `terminateAgent(agentId, reason)`
- ✅ `mergeResults(teamId, results, strategy)`
- ✅ `createCheckpoint(teamId, metadata)`
- ✅ `listMembers(teamId)`
- ✅ `updateTeamConfig(teamId, config)`
- ✅ `destroyTeam(teamId)`
- ✅ `getStats()`
- ✅ `cleanupOldMessages()`

---

## FileSandbox API 映射

| 测试中使用的方法 | 实际实现的方法 | 状态 | 说明 |
|-----------------|---------------|------|------|
| `hasPermission(teamId, path, permission)` | ✅ 存在 | ✅ 匹配 | |
| `validateAccess(teamId, path, permission)` | ✅ 存在 | ✅ 匹配 | |
| `grantPermission(teamId, path, permissions, options)` | ❓ 需确认 | ⚠️ 待确认 | 需要检查方法签名 |
| `revokePermission(teamId, path, permissions)` | ❓ 需确认 | ⚠️ 待确认 | 需要检查方法签名 |
| `isSensitivePath(path)` | ❓ 需确认 | ⚠️ 待确认 | 需要检查是否为实例方法 |
| `recordAuditLog(logData)` | ❓ 需确认 | ⚠️ 待确认 | 需要检查方法签名 |
| `getAuditLog(filters)` | ❓ 需确认 | ⚠️ 待确认 | 需要检查方法签名 |

---

## LongRunningTaskManager API 映射

| 测试中使用的方法 | 实际实现的方法 | 状态 | 说明 |
|-----------------|---------------|------|------|
| `createTask(config)` | ✅ 存在 | ✅ 匹配 | |
| `startTask(taskId)` | ✅ 存在 | ✅ 匹配 | |
| `getTask(taskId)` | ❓ 需确认 | ⚠️ 待确认 | 需要检查方法名 |
| `getCheckpoints(taskId)` | ❓ 需确认 | ⚠️ 待确认 | 需要检查方法名 |
| `retryTask(taskId)` | ❓ 需确认 | ⚠️ 待确认 | 需要检查方法名 |
| `listTasks(filters)` | ❓ 需确认 | ⚠️ 待确认 | 需要检查方法名 |
| `cancelTask(taskId)` | ❓ 需确认 | ⚠️ 待确认 | 需要检查方法名 |

---

## SkillRegistry API 映射

| 测试中使用的方法 | 实际实现的方法 | 状态 | 说明 |
|-----------------|---------------|------|------|
| `registerSkill(skill)` | `register(skill)` | ⚠️ 不匹配 | 方法名不同（已修复） |
| `findBestSkill(task)` | ❓ 需确认 | ⚠️ 待确认 | 需要检查方法名 |
| `autoExecute(task)` | ❓ 需确认 | ⚠️ 待确认 | 需要检查方法名 |

---

## CoworkOrchestrator API 映射

| 测试中使用的方法 | 实际实现的方法 | 状态 | 说明 |
|-----------------|---------------|------|------|
| `shouldUseSingleAgent(task)` | ❓ 需确认 | ⚠️ 待确认 | 需要检查方法名 |

---

## 解决方案选项

### 选项 A: 修改测试文件（推荐）
**优点**: 保持实现不变，只需更新测试
**缺点**: 需要重写大部分测试逻辑
**工作量**: 4-6 小时

**步骤**:
1. 将所有 `addAgent()` 改为 `requestJoin()`，并生成 agentId
2. 将 `listTeams()` 改为 `discoverTeams()`
3. 将 `disbandTeam()` 改为 `destroyTeam()`
4. 实现缺失的方法（`getAgent`, `getTask`, `updateTaskStatus`）或调整测试逻辑
5. 确认 FileSandbox, LongRunningTaskManager, SkillRegistry 的所有方法

### 选项 B: 添加兼容层
**优点**: 测试无需大改，保持向后兼容
**缺点**: 增加代码复杂度
**工作量**: 2-3 小时

**步骤**:
1. 在 TeammateTool 中添加别名方法
```javascript
async addAgent(teamId, agentInfo) {
  const agentId = `agent_${Date.now()}_${uuidv4().slice(0, 8)}`;
  return await this.requestJoin(teamId, agentId, agentInfo);
}

async listTeams(filters = {}) {
  return await this.discoverTeams(filters);
}

async disbandTeam(teamId) {
  return await this.destroyTeam(teamId);
}
```

2. 在其他类中添加类似的别名方法

### 选项 C: 重新设计 API（不推荐）
**优点**: 统一 API 设计
**缺点**: 需要修改大量实现代码，可能引入新bug
**工作量**: 8-12 小时

---

## 推荐行动计划

**立即行动**（本次）:
1. ✅ 修复数据库 Schema 问题（已完成）
2. ✅ 修复模块导入问题（已完成）
3. ✅ 验证测试框架可运行（已完成）
4. ✅ 创建 API 映射文档（本文档）

**短期行动**（下一步）:
1. 选择**选项 B：添加兼容层**
2. 在 TeammateTool 中添加 5 个别名方法
3. 确认 FileSandbox, LongRunningTaskManager 的方法名
4. 重新运行测试，期望通过率 > 50%

**中期行动**（Week 3）:
1. 完善所有缺失的方法
2. 调整测试逻辑以匹配实际行为
3. 达到 > 80% 测试通过率

---

## 当前测试执行统计

**测试运行结果** (2026-01-27):
- **测试文件**: 1
- **测试用例**: 17
- **通过**: 0 (0%)
- **失败**: 17 (100%)
- **跳过**: 0
- **执行时间**: 3,372 ms

**主要失败原因**:
1. ❌ `teammateTool.addAgent is not a function` (6 次)
2. ❌ `teammateTool.listTeams is not a function` (13 次)
3. ❌ `teammateTool.getMetrics is not a function`
4. ❌ `orchestrator.shouldUseSingleAgent is not a function` (2 次)
5. ❌ `taskManager.getCheckpoints is not a function`
6. ❌ `fileSandbox.grantPermission is not a function` (3 次)

**积极信号** ✅:
- 数据库成功初始化
- 所有组件成功创建
- 9 个团队成功创建
- FileSandbox 权限检查正常工作
- 测试框架可正常运行

---

**文档版本**: 1.0.0
**创建日期**: 2026-01-27
**维护者**: ChainlessChain Team

**下一步**: 实施选项 B - 添加兼容层 🚀

## 附录：规范章节补全（v5.0.3.108）

> 为对齐项目文档标准结构，下列章节以 `见正文` 指引或简述方式补齐若干视角，不重复正文细节。

### 1. 概述
见正文头部。本文：Cowork API 映射文档。

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
