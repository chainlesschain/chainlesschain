# Cowork 快速入门指南

**版本**: v1.0
**更新时间**: 2026-01-27

---

## 📖 目录

- [简介](#简介)
- [安装依赖](#安装依赖)
- [基础用法](#基础用法)
  - [创建团队](#创建团队)
  - [分配任务](#分配任务)
  - [文件访问](#文件访问)
  - [执行技能](#执行技能)
- [高级用法](#高级用法)
  - [自动多代理决策](#自动多代理决策)
  - [长时运行任务](#长时运行任务)
  - [投票决策](#投票决策)
- [前端集成](#前端集成)
- [API 参考](#api-参考)

---

## 简介

ChainlessChain Cowork 是一个基于 Claude Code 的 TeammateTool 设计的多代理协作系统，支持：

- **多代理协作**：13 个核心操作（spawnTeam、assignTask、voteOnDecision 等）
- **文件沙箱**：安全的文件访问控制
- **长时任务**：检查点机制，支持暂停/恢复
- **技能系统**：专业化任务处理（Office 文档、数据分析等）
- **智能决策**：基于 Anthropic 三种场景自动选择单/多代理模式

---

## 安装依赖

### 1. 安装 NPM 包

```bash
cd desktop-app-vue
npm install exceljs docx pptxgenjs
```

### 2. 验证安装

```bash
npm run dev
```

如果启动成功，Cowork 系统已自动初始化并注册 IPC 处理器。

---

## 基础用法

### 创建团队

**后端（Main Process）**:

```javascript
const { TeammateTool } = require('./ai-engine/cowork/teammate-tool');

const teammateTool = new TeammateTool();

// 创建团队
const team = await teammateTool.spawnTeam('my-team', {
  maxAgents: 5,
  allowDynamicJoin: true,
  votingThreshold: 0.6,
});

console.log('团队已创建:', team.id);
```

**前端（Renderer Process）**:

```javascript
// 通过 IPC 创建团队
const result = await window.electron.ipcRenderer.invoke('cowork:create-team', {
  teamName: 'my-team',
  config: {
    maxAgents: 5,
    allowDynamicJoin: true,
  },
});

if (result.success) {
  console.log('团队已创建:', result.team);
}
```

---

### 分配任务

**后端**:

```javascript
// 添加代理到团队
await teammateTool.requestJoin(team.id, 'agent-1', {
  name: 'Worker Agent 1',
  capabilities: ['data_processing', 'file_operations'],
});

// 分配任务
const taskResult = await teammateTool.assignTask(team.id, 'agent-1', {
  id: 'task-001',
  description: '处理数据文件',
  type: 'data_processing',
  priority: 1,
});

console.log('任务已分配:', taskResult.taskId);
```

**前端**:

```javascript
// 请求加入团队
await window.electron.ipcRenderer.invoke('cowork:request-join', {
  teamId: 'team_xxx',
  agentId: 'agent-1',
  agentInfo: {
    name: 'Worker Agent 1',
    capabilities: ['data_processing'],
  },
});

// 分配任务
const result = await window.electron.ipcRenderer.invoke('cowork:assign-task', {
  teamId: 'team_xxx',
  agentId: 'agent-1',
  task: {
    description: '处理数据文件',
    type: 'data_processing',
  },
});
```

---

### 文件访问

**请求文件访问权限**:

```javascript
const { FileSandbox } = require('./ai-engine/cowork/file-sandbox');

const sandbox = new FileSandbox();

// 请求访问（会弹出授权对话框）
const granted = await sandbox.requestAccess(
  'team-1',
  '/path/to/folder',
  ['read', 'write']
);

if (granted) {
  // 读取文件
  const content = await sandbox.readFile('team-1', 'agent-1', '/path/to/file.txt');

  // 写入文件
  await sandbox.writeFile('team-1', 'agent-1', '/path/to/output.txt', 'Hello Cowork!');
}
```

**前端**:

```javascript
// 请求文件访问
const result = await window.electron.ipcRenderer.invoke('cowork:request-file-access', {
  teamId: 'team-1',
  folderPath: '/Users/username/Documents',
  permissions: ['read', 'write'],
});

if (result.granted) {
  // 读取文件
  const readResult = await window.electron.ipcRenderer.invoke('cowork:read-file', {
    teamId: 'team-1',
    agentId: 'agent-1',
    filePath: '/Users/username/Documents/data.json',
  });

  console.log('文件内容:', readResult.content);
}
```

---

### 执行技能

**使用 OfficeSkill 创建 Excel**:

```javascript
const { getSkillRegistry } = require('./ai-engine/cowork/skills');

const skillRegistry = getSkillRegistry();
skillRegistry.autoLoadBuiltinSkills();

// 创建 Excel 任务
const task = {
  type: 'create_excel',
  input: {
    filePath: '/path/to/output.xlsx',
    data: {
      sheets: [
        {
          name: 'Sales Data',
          columns: [
            { header: 'Product', key: 'product', width: 20 },
            { header: 'Sales', key: 'sales', width: 15 },
          ],
          data: [
            { product: 'iPhone', sales: 1000 },
            { product: 'iPad', sales: 500 },
          ],
        },
      ],
    },
    options: {
      headerStyle: true,
      autoWidth: true,
      autoFilter: true,
    },
  },
};

// 自动选择技能并执行
const result = await skillRegistry.autoExecute(task);
console.log('Excel 已创建:', result.filePath);
```

**前端**:

```javascript
const result = await window.electron.ipcRenderer.invoke('cowork:auto-execute-task', {
  task: {
    type: 'create_excel',
    input: {
      filePath: '/path/to/output.xlsx',
      data: {
        sheets: [
          {
            name: 'Sales Data',
            data: [
              { product: 'iPhone', sales: 1000 },
              { product: 'iPad', sales: 500 },
            ],
          },
        ],
      },
    },
  },
});

if (result.success) {
  console.log('Excel 已创建:', result.result.filePath);
}
```

---

## 高级用法

### 自动多代理决策

**使用 CoworkOrchestrator**:

```javascript
const { CoworkOrchestrator } = require('./ai-engine/multi-agent/cowork-orchestrator');

const orchestrator = new CoworkOrchestrator({
  coworkEnabled: true,
  contextPollutionThreshold: 10000,
  minParallelTasks: 2,
});

// 设置数据库
orchestrator.setDatabase(database);

// 自动判断并执行
const task = {
  type: 'batch_processing',
  input: [1, 2, 3, 4, 5], // 5 个输入项
  subtasks: [
    { description: '处理项 1' },
    { description: '处理项 2' },
    { description: '处理项 3' },
  ],
};

const result = await orchestrator.executeWithCowork(task, {});
// 自动检测到可并行化，使用多代理模式

console.log('执行结果:', result);
```

**判断逻辑**:

```javascript
const decision = orchestrator.shouldUseMultiAgent(task, context);

if (decision.useMultiAgent) {
  console.log('使用多代理模式');
  console.log('原因:', decision.reason);
  console.log('策略:', decision.strategy);
  // 可能输出:
  // 原因: parallelization
  // 策略: parallel_execution
}
```

---

### 长时运行任务

**创建并启动长时任务**:

```javascript
const { LongRunningTaskManager } = require('./ai-engine/cowork/long-running-task-manager');

const taskManager = new LongRunningTaskManager({
  checkpointInterval: 60000, // 1 分钟自动创建检查点
  maxRetries: 3,
  autoRecovery: true,
});

// 创建任务
const task = await taskManager.createTask({
  name: '大数据处理任务',
  description: '处理 10000 条记录',
  steps: [
    {
      name: '加载数据',
      execute: async (context) => {
        context.log('正在加载数据...');
        // 模拟加载
        await new Promise(resolve => setTimeout(resolve, 2000));
        return { loaded: 10000 };
      },
    },
    {
      name: '处理数据',
      execute: async (context) => {
        context.log('正在处理数据...');
        context.updateProgress(50, '已处理 5000 条');
        // 模拟处理
        await new Promise(resolve => setTimeout(resolve, 5000));
        return { processed: 10000 };
      },
    },
    {
      name: '保存结果',
      execute: async (context) => {
        context.log('正在保存结果...');
        context.updateProgress(90, '正在写入文件');
        // 模拟保存
        await new Promise(resolve => setTimeout(resolve, 1000));
        return { saved: true };
      },
    },
  ],
});

// 启动任务
await taskManager.startTask(task.id);

// 监听进度
taskManager.on('task-progress', ({ task, progress, message }) => {
  console.log(`进度: ${progress}%, ${message}`);
});

// 监听完成
taskManager.on('task-completed', ({ task, result }) => {
  console.log('任务完成:', result);
});
```

**从检查点恢复**:

```javascript
// 如果任务失败或被中断
const checkpointId = 'checkpoint_xxx';
const restoredTask = await taskManager.restoreFromCheckpoint(checkpointId);

// 继续执行
await taskManager.resumeTask(restoredTask.id);
```

---

### 投票决策

**团队投票**:

```javascript
// 创建决策
const decision = {
  id: 'decision-001',
  type: 'task_assignment',
  description: '选择最佳的数据处理方案',
  options: ['方案 A', '方案 B', '方案 C'],
};

// 代理投票
const votes = [
  { agentId: 'agent-1', vote: 'approve' }, // 赞成方案 A
  { agentId: 'agent-2', vote: 'approve' }, // 赞成方案 A
  { agentId: 'agent-3', vote: 'reject' },  // 反对
];

// 执行投票
const voteResult = await teammateTool.voteOnDecision('team-1', decision, votes);

console.log('投票结果:', voteResult);
// {
//   passed: true,
//   approvalRate: 0.67,
//   threshold: 0.5,
//   votes: { approve: 2, reject: 1, abstain: 0 }
// }
```

---

## 前端集成

### Vue3 组件示例

```vue
<template>
  <div class="cowork-dashboard">
    <a-card title="创建 Cowork 团队">
      <a-form @submit="createTeam">
        <a-form-item label="团队名称">
          <a-input v-model="teamName" placeholder="输入团队名称" />
        </a-form-item>
        <a-form-item label="最大代理数">
          <a-input-number v-model="maxAgents" :min="1" :max="10" />
        </a-form-item>
        <a-button type="primary" html-type="submit">创建团队</a-button>
      </a-form>
    </a-card>

    <a-card v-if="currentTeam" title="团队状态">
      <a-descriptions bordered>
        <a-descriptions-item label="团队 ID">{{ currentTeam.id }}</a-descriptions-item>
        <a-descriptions-item label="状态">{{ currentTeam.status }}</a-descriptions-item>
        <a-descriptions-item label="代理数">{{ currentTeam.agents.length }}</a-descriptions-item>
        <a-descriptions-item label="任务数">{{ currentTeam.tasks.length }}</a-descriptions-item>
      </a-descriptions>

      <a-divider />

      <a-button @click="refreshTeamStatus">刷新状态</a-button>
      <a-button @click="destroyTeam" danger>销毁团队</a-button>
    </a-card>
  </div>
</template>

<script setup>
import { ref } from 'vue';
import { message } from 'ant-design-vue';

const teamName = ref('');
const maxAgents = ref(5);
const currentTeam = ref(null);

const createTeam = async () => {
  try {
    const result = await window.electron.ipcRenderer.invoke('cowork:create-team', {
      teamName: teamName.value,
      config: {
        maxAgents: maxAgents.value,
      },
    });

    if (result.success) {
      currentTeam.value = result.team;
      message.success('团队创建成功！');
    } else {
      message.error(result.error);
    }
  } catch (error) {
    message.error('创建团队失败: ' + error.message);
  }
};

const refreshTeamStatus = async () => {
  try {
    const result = await window.electron.ipcRenderer.invoke('cowork:get-team-status', {
      teamId: currentTeam.value.id,
    });

    if (result.success) {
      currentTeam.value = { ...currentTeam.value, ...result.status };
      message.success('状态已刷新');
    }
  } catch (error) {
    message.error('刷新失败: ' + error.message);
  }
};

const destroyTeam = async () => {
  try {
    const result = await window.electron.ipcRenderer.invoke('cowork:destroy-team', {
      teamId: currentTeam.value.id,
    });

    if (result.success) {
      currentTeam.value = null;
      message.success('团队已销毁');
    }
  } catch (error) {
    message.error('销毁失败: ' + error.message);
  }
};
</script>

<style scoped>
.cowork-dashboard {
  padding: 20px;
}
</style>
```

---

## API 参考

### IPC 通道列表

#### TeammateTool（15 个）

| 通道名称 | 参数 | 返回值 | 说明 |
|---------|------|--------|------|
| `cowork:create-team` | `{ teamName, config }` | `{ success, team }` | 创建团队 |
| `cowork:discover-teams` | `{ filters }` | `{ success, teams }` | 发现团队 |
| `cowork:request-join` | `{ teamId, agentId, agentInfo }` | `{ success, result }` | 请求加入 |
| `cowork:assign-task` | `{ teamId, agentId, task }` | `{ success, result }` | 分配任务 |
| `cowork:broadcast-message` | `{ teamId, fromAgent, message }` | `{ success, result }` | 广播消息 |
| `cowork:send-message` | `{ fromAgent, toAgent, message }` | `{ success, result }` | 发送消息 |
| `cowork:vote-on-decision` | `{ teamId, decision, votes }` | `{ success, result }` | 投票决策 |
| `cowork:get-team-status` | `{ teamId }` | `{ success, status }` | 获取状态 |
| `cowork:terminate-agent` | `{ agentId, reason }` | `{ success, result }` | 终止代理 |
| `cowork:merge-results` | `{ teamId, results, strategy }` | `{ success, mergedResult }` | 合并结果 |
| `cowork:create-checkpoint` | `{ teamId, metadata }` | `{ success, checkpoint }` | 创建检查点 |
| `cowork:list-members` | `{ teamId }` | `{ success, members }` | 列出成员 |
| `cowork:update-team-config` | `{ teamId, config }` | `{ success, result }` | 更新配置 |
| `cowork:destroy-team` | `{ teamId }` | `{ success, result }` | 销毁团队 |
| `cowork:get-stats` | - | `{ success, stats }` | 获取统计 |

#### FileSandbox（11 个）

| 通道名称 | 参数 | 返回值 | 说明 |
|---------|------|--------|------|
| `cowork:request-file-access` | `{ teamId, folderPath, permissions }` | `{ success, granted }` | 请求访问 |
| `cowork:grant-file-access` | `{ teamId, folderPath, permissions }` | `{ success }` | 授予访问 |
| `cowork:revoke-file-access` | `{ teamId, folderPath }` | `{ success }` | 撤销访问 |
| `cowork:validate-file-access` | `{ teamId, filePath, permission }` | `{ success, validation }` | 验证访问 |
| `cowork:read-file` | `{ teamId, agentId, filePath }` | `{ success, content }` | 读取文件 |
| `cowork:write-file` | `{ teamId, agentId, filePath, content }` | `{ success }` | 写入文件 |
| `cowork:delete-file` | `{ teamId, agentId, filePath }` | `{ success }` | 删除文件 |
| `cowork:list-directory` | `{ teamId, agentId, dirPath }` | `{ success, files }` | 列出目录 |
| `cowork:get-allowed-paths` | `{ teamId }` | `{ success, paths }` | 获取路径 |
| `cowork:get-audit-log` | `{ filters, limit }` | `{ success, logs }` | 获取日志 |
| `cowork:get-sandbox-stats` | - | `{ success, stats }` | 获取统计 |

#### LongRunningTaskManager（9 个）

| 通道名称 | 参数 | 返回值 | 说明 |
|---------|------|--------|------|
| `cowork:create-long-task` | `{ taskConfig }` | `{ success, task }` | 创建任务 |
| `cowork:start-task` | `{ taskId }` | `{ success }` | 启动任务 |
| `cowork:pause-task` | `{ taskId }` | `{ success }` | 暂停任务 |
| `cowork:resume-task` | `{ taskId }` | `{ success }` | 继续任务 |
| `cowork:cancel-task` | `{ taskId, reason }` | `{ success }` | 取消任务 |
| `cowork:get-task-status` | `{ taskId }` | `{ success, status }` | 获取状态 |
| `cowork:get-active-tasks` | - | `{ success, tasks }` | 获取任务 |
| `cowork:restore-from-checkpoint` | `{ checkpointId }` | `{ success, task }` | 恢复任务 |
| `cowork:get-task-manager-stats` | - | `{ success, stats }` | 获取统计 |

#### SkillRegistry（5 个）

| 通道名称 | 参数 | 返回值 | 说明 |
|---------|------|--------|------|
| `cowork:execute-skill` | `{ skillId, task, context }` | `{ success, result }` | 执行技能 |
| `cowork:auto-execute-task` | `{ task, context }` | `{ success, result }` | 自动执行 |
| `cowork:find-skills-for-task` | `{ task, options }` | `{ success, skills }` | 查找技能 |
| `cowork:get-all-skills` | - | `{ success, skills }` | 获取技能 |
| `cowork:get-skill-stats` | - | `{ success, stats }` | 获取统计 |

---

## 常见问题

### 1. 如何调试 Cowork？

```javascript
// 启用详细日志
const orchestrator = new CoworkOrchestrator({
  enableLogging: true,
});

// 监听所有事件
teammateTool.on('team-spawned', (data) => console.log('Team spawned:', data));
teammateTool.on('task-assigned', (data) => console.log('Task assigned:', data));
fileSandbox.on('file-read', (data) => console.log('File read:', data));
```

### 2. Office 文档生成失败？

确保已安装依赖：

```bash
npm install exceljs docx pptxgenjs
```

### 3. 文件访问被拒绝？

检查文件路径是否在允许列表中：

```javascript
const paths = await sandbox.getAllowedPaths('team-1');
console.log('允许的路径:', paths);
```

### 4. 如何查看性能指标？

```javascript
// TeammateTool 统计
const stats = teammateTool.getStats();
console.log('团队统计:', stats);

// FileSandbox 统计
const sandboxStats = fileSandbox.getStats();
console.log('沙箱统计:', sandboxStats);

// SkillRegistry 统计
const skillStats = skillRegistry.getStats();
console.log('技能统计:', skillStats);
```

---

## 下一步

- 查看 [完整实施计划](./COWORK_IMPLEMENTATION_PLAN.md)
- 查看 [Phase 1 完成报告](./COWORK_PHASE1_COMPLETION.md)
- 参考 [API 文档](./COWORK_API_REFERENCE.md)（待补充）
- 运行单元测试：`npm run test:cowork`（待实现）

---

**文档版本**: v1.0
**维护者**: ChainlessChain 开发团队
**最后更新**: 2026-01-27
