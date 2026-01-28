# Cowork 多智能体协作系统

**版本**: v1.0.0
**状态**: ✅ 生产就绪
**发布日期**: 2026-01-27

---

## 概述

ChainlessChain Cowork 是一个生产级的多智能体协作系统，基于 Claude Code 的 TeammateTool 设计模式实现。它为复杂任务提供智能的任务分配、并行执行和协同工作流能力。

## 核心特性

### 🤖 智能编排系统

- **AI驱动决策** - 自动判断任务是否需要多代理协作
- **三种场景模型** - 简单/中等/复杂任务自动识别
- **动态负载均衡** - 智能分配任务到可用代理
- **故障转移机制** - 自动重试和错误恢复

### 👥 团队协作工具

**13个核心操作**:

| 操作 | 功能 | 性能 |
|------|------|------|
| `spawnTeam` | 创建新团队 | < 45ms |
| `disbandTeam` | 解散团队 | < 20ms |
| `addAgent` | 添加代理到团队 | < 15ms |
| `removeAgent` | 从团队移除代理 | < 10ms |
| `assignTask` | 分配任务给代理 | < 25ms |
| `updateTaskStatus` | 更新任务状态 | < 8ms |
| `getTaskStatus` | 查询任务状态 | < 5ms |
| `getTeamStatus` | 查询团队状态 | < 10ms |
| `getAgentStatus` | 查询代理状态 | < 5ms |
| `broadcastMessage` | 向团队广播消息 | < 30ms |
| `sendMessage` | 发送私信 | < 12ms |
| `voteOnDecision` | 发起投票决策 | < 35ms |
| `castVote` | 投票 | < 8ms |

### 🔒 文件沙箱系统

**多层安全防护**:

- **18+敏感文件模式检测** - 自动识别和阻止访问敏感文件
  - 配置文件: `.env`, `config.json`, `secrets.yaml`
  - 凭证文件: SSH keys, AWS credentials, 证书文件
  - 系统文件: `/etc/passwd`, `registry.pol`

- **路径遍历防护** - 防止 `../` 等路径遍历攻击
- **细粒度权限** - READ / WRITE / EXECUTE 三级权限控制
- **完整审计日志** - 所有文件访问操作记录和完整性检查

**安全指标**:
- ✅ 零关键漏洞
- ✅ 5层防御架构
- ✅ 3ms权限检查延迟
- ✅ 100%审计覆盖率

### ⏱️ 长时任务管理

**特性**:

- **检查点机制** - 支持任务暂停和恢复
- **进度跟踪** - 实时进度百分比和时间估算
- **智能重试** - 指数退避算法，最多3次重试
- **超时处理** - 可配置超时和优雅取消
- **状态持久化** - 任务状态保存到数据库

**任务生命周期**:

```
PENDING → RUNNING → [PAUSED] → COMPLETED
                 ↓
              FAILED → RETRYING
```

### 🎯 Skills 技能系统

**内置技能**:

1. **ExcelSkill** - Excel文档处理
   - 读取/写入 .xlsx 文件
   - 数据提取和转换
   - 图表生成

2. **WordSkill** - Word文档处理
   - 创建/编辑 .docx 文件
   - 模板渲染
   - 格式化文本

3. **PowerPointSkill** - PPT文档处理
   - 创建演示文稿
   - 幻灯片编辑
   - 图片和图表插入

4. **DataAnalysisSkill** - 数据分析
   - CSV/JSON数据处理
   - 统计计算
   - 数据可视化

**技能匹配**:
- 0-100分智能评分算法
- 基于任务描述自动选择最佳技能
- 支持技能组合执行

## 系统架构

### 架构图

```
┌─────────────────────────────────────────────────────────────┐
│                      前端 (Vue3 + IPC)                       │
│  CoworkDashboard, TeamPanel, TaskMonitor, SkillManager      │
└─────────────────────┬───────────────────────────────────────┘
                      │ IPC 通信（45个处理器）
┌─────────────────────┴───────────────────────────────────────┐
│                    CoworkOrchestrator                       │
│         (智能单/多代理决策引擎)                                │
└─────────┬──────────────┬──────────────┬─────────────────────┘
          │              │              │
┌─────────┴────┐ ┌──────┴──────┐ ┌────┴──────────────┐
│ TeammateTool │ │ FileSandbox │ │ LongRunningTask   │
│              │ │             │ │ Manager           │
└──────────────┘ └─────────────┘ └───────────────────┘
          │              │              │
┌─────────┴──────────────┴──────────────┴─────────────────────┐
│                       Skills 框架                            │
└──────────────────────────────────────────────────────────────┘
          │
┌─────────┴──────────────────────────────────────────────────┐
│                    数据持久层                                │
│  SQLite (9张表) + 内存缓存 + 文件系统                         │
└──────────────────────────────────────────────────────────────┘
```

### 数据库 Schema

**9张核心表**:

| 表名 | 用途 | 字段数 |
|------|------|--------|
| `cowork_teams` | 团队信息 | 8 |
| `cowork_agents` | 代理信息 | 9 |
| `cowork_tasks` | 任务信息 | 12 |
| `cowork_messages` | 消息记录 | 8 |
| `cowork_votes` | 投票记录 | 8 |
| `cowork_checkpoints` | 检查点 | 7 |
| `file_permissions` | 文件权限 | 8 |
| `audit_logs` | 审计日志 | 9 |
| `skill_executions` | 技能执行记录 | 10 |

## 快速开始

### 安装依赖

```bash
cd desktop-app-vue
npm install exceljs docx pptxgenjs
```

### 基础用法

#### 创建团队

```javascript
// 前端代码
const result = await window.electron.ipcRenderer.invoke('cowork:create-team', {
  teamName: 'my-team',
  config: {
    maxAgents: 5,
    allowDynamicJoin: true,
    votingThreshold: 0.6,
  },
});

if (result.success) {
  console.log('团队已创建:', result.team);
}
```

#### 分配任务

```javascript
const result = await window.electron.ipcRenderer.invoke('cowork:assign-task', {
  teamId: 'my-team',
  agentId: 'agent-1',
  task: {
    id: 'task-001',
    description: '分析销售数据并生成报告',
    priority: 'HIGH',
    timeout: 300000, // 5分钟
  },
});
```

#### 执行技能

```javascript
const result = await window.electron.ipcRenderer.invoke('cowork:execute-skill', {
  skillName: 'DataAnalysisSkill',
  taskDescription: '分析CSV数据',
  input: {
    filePath: '/path/to/data.csv',
    operation: 'summarize',
  },
});
```

### 高级用法

#### 自动多代理决策

```javascript
const result = await window.electron.ipcRenderer.invoke('cowork:decide-execution', {
  task: {
    complexity: 'high',
    estimatedTime: 600000, // 10分钟
    requiresParallel: true,
  },
});

// result.useMultiAgent: true/false
// result.recommendedAgents: 建议的代理数量
// result.strategy: 'parallel' | 'sequential' | 'single'
```

#### 长时运行任务

```javascript
// 启动任务
const startResult = await window.electron.ipcRenderer.invoke('cowork:start-long-task', {
  taskId: 'long-task-001',
  checkpointInterval: 60000, // 每分钟保存检查点
});

// 查询进度
const progress = await window.electron.ipcRenderer.invoke('cowork:get-task-progress', {
  taskId: 'long-task-001',
});

console.log(`进度: ${progress.percentage}%`);
console.log(`预计剩余时间: ${progress.estimatedTimeRemaining}ms`);

// 恢复任务
const resumeResult = await window.electron.ipcRenderer.invoke('cowork:resume-task', {
  taskId: 'long-task-001',
  checkpointId: 'checkpoint-5',
});
```

#### 投票决策

```javascript
// 发起投票
const voteResult = await window.electron.ipcRenderer.invoke('cowork:create-vote', {
  teamId: 'my-team',
  decision: {
    title: '是否采用方案A',
    description: '详细说明...',
    options: ['同意', '反对', '弃权'],
    votingThreshold: 0.6,
    deadline: Date.now() + 3600000, // 1小时后截止
  },
});

// 投票
await window.electron.ipcRenderer.invoke('cowork:cast-vote', {
  voteId: voteResult.voteId,
  agentId: 'agent-1',
  option: '同意',
  reason: '理由说明...',
});
```

## 前端集成

### CoworkDashboard 组件

```vue
<template>
  <CoworkDashboard />
</template>

<script setup>
import CoworkDashboard from '@/components/cowork/CoworkDashboard.vue'
</script>
```

**功能**:
- 全局统计卡片（团队数/代理数/任务数/成功率）
- 团队网格视图
- 团队详情抽屉
- 实时状态更新

### TaskMonitor 组件

```vue
<template>
  <TaskMonitor :team-id="teamId" />
</template>

<script setup>
import TaskMonitor from '@/components/cowork/TaskMonitor.vue'

const teamId = ref('my-team')
</script>
```

**功能**:
- 分页任务列表
- 实时进度条
- 任务详情抽屉
- 状态徽章

### SkillManager 组件

```vue
<template>
  <SkillManager />
</template>

<script setup>
import SkillManager from '@/components/cowork/SkillManager.vue'
</script>
```

**功能**:
- 技能网格视图
- 能力标签
- 技能执行历史
- 性能统计

## 性能指标

### 响应时间

| 操作 | 目标 | 实际 | 状态 |
|------|------|------|------|
| 创建团队 | < 50ms | 45ms | ✅ |
| 添加代理 | < 20ms | 15ms | ✅ |
| 分配任务 | < 30ms | 25ms | ✅ |
| 权限检查 | < 5ms | 3ms | ✅ |
| 投票决策 | < 40ms | 35ms | ✅ |

### 资源使用

- **内存占用**: < 50MB (单团队)
- **数据库大小**: ~2MB (1000个任务)
- **CPU使用率**: < 5% (空闲), < 30% (高负载)

### 可扩展性

- **最大团队数**: 100+
- **最大代理数/团队**: 10
- **最大并发任务**: 1000+
- **最大检查点数/任务**: 100

## 测试覆盖率

### 单元测试

```
✅ teammate-tool.test.js      - 50+ 测试用例
✅ file-sandbox.test.js       - 40+ 测试用例
✅ long-running-task.test.js  - 35+ 测试用例
✅ skills.test.js             - 30+ 测试用例
```

**总覆盖率**: ~90%

### E2E 测试

- ✅ 团队创建和解散流程
- ✅ 任务分配和执行流程
- ✅ 投票决策流程
- ✅ 文件权限验证流程
- ✅ 长时任务检查点恢复

## 安全考虑

### 文件访问安全

1. **敏感文件检测** - 18+种敏感文件模式
2. **路径验证** - 防止路径遍历攻击
3. **权限检查** - 细粒度权限控制
4. **审计日志** - 完整的访问记录

### 数据安全

1. **SQLCipher加密** - 数据库AES-256加密
2. **内存清理** - 敏感数据使用后立即清理
3. **传输安全** - IPC通信加密

### 代码注入防护

1. **参数验证** - 严格的输入验证
2. **SQL参数化** - 防止SQL注入
3. **命令白名单** - 防止命令注入

## 故障排查

### 常见问题

**Q: 团队创建失败?**

A: 检查以下几点:
1. 团队名称是否唯一
2. 配置参数是否有效
3. 数据库连接是否正常

**Q: 任务执行超时?**

A: 可能原因:
1. 任务太复杂，增加超时时间
2. 代理资源不足，增加代理数量
3. 网络延迟，检查网络连接

**Q: 文件访问被拒绝?**

A: 检查:
1. 文件路径是否在允许列表
2. 是否有足够权限
3. 查看审计日志了解拒绝原因

### 调试模式

启用详细日志:

```javascript
// 设置日志级别
await window.electron.ipcRenderer.invoke('cowork:set-log-level', {
  level: 'debug',
});

// 查看日志
const logs = await window.electron.ipcRenderer.invoke('cowork:get-logs', {
  component: 'teammate-tool',
  since: Date.now() - 3600000, // 最近1小时
});
```

## API 参考

完整的 API 文档请参考:

- [TeammateTool API](/api/cowork/teammate-tool)
- [FileSandbox API](/api/cowork/file-sandbox)
- [LongRunningTaskManager API](/api/cowork/long-running-task)
- [Skills API](/api/cowork/skills)

## 相关文档

- [快速入门指南](/guide/cowork-quick-start)
- [系统架构](/guide/cowork-architecture)
- [最佳实践](/guide/cowork-best-practices)
- [更新日志](/changelog#027)

## 未来规划

### v1.1.0 (计划中)

- [ ] 更多内置技能 (PDF, 图像处理)
- [ ] 可视化工作流编辑器
- [ ] 性能优化（减少内存占用30%）
- [ ] 分布式团队支持

### v1.2.0 (研究中)

- [ ] 机器学习任务分配优化
- [ ] 跨设备团队协作
- [ ] GraphQL API支持

## 贡献指南

欢迎贡献代码和反馈问题！

- [GitHub Issues](https://github.com/chainlesschain/issues)
- [贡献指南](https://github.com/chainlesschain/CONTRIBUTING.md)

## 许可证

MIT License - 详见 [LICENSE](https://github.com/chainlesschain/LICENSE)

---

**构建时间**: 1天
**代码行数**: ~13,000行 (含测试和文档)
**维护者**: ChainlessChain Team
