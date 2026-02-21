# Cowork 多智能体协作系统

> **版本: v1.0.0 | 状态: ✅ 生产就绪 | 51 IPC Handlers | 90 内置技能 | ~90% 测试覆盖率**

ChainlessChain Cowork 是一个生产级的多智能体协作系统，基于 Claude Code 的 TeammateTool 设计模式实现。它为复杂任务提供智能的任务分配、并行执行和协同工作流能力，包含 13 核心操作、FileSandbox 安全沙箱、长时任务管理、Agent 池化、90 内置技能以及智能单/多代理决策引擎。

## 核心特性

- 🤖 **智能编排**: AI 驱动的单/多代理自动决策，三种场景模型
- 👥 **团队协作**: 13 核心操作（TeammateTool），支持投票、消息、检查点
- 🔒 **文件沙箱**: 20+ 敏感文件检测，路径遍历防护，细粒度权限
- ⏱️ **长时任务**: 检查点恢复、智能重试、进度跟踪、超时处理
- 🏊 **Agent 池化**: 资源复用、自动扩缩、空闲回收
- 🎯 **90 内置技能**: 四层加载、门控检查、自动匹配、Handler 100% 覆盖
- 📊 **分析仪表板**: ECharts 可视化、KPI 趋势、实时监控
- 🛡️ **完整审计**: 所有文件操作审计日志，数据库 + 文件系统双持久化

## TeammateTool — 13 核心操作

TeammateTool 是 Cowork 的核心引擎，提供团队创建、代理管理、任务分配、消息通信和投票决策等 13 个操作。

### 操作概览

| 操作               | 功能         | 性能   | 说明                                |
| ------------------ | ------------ | ------ | ----------------------------------- |
| `spawnTeam`        | 创建新团队   | < 45ms | 支持配置 maxAgents、投票阈值        |
| `discoverTeams`    | 发现团队     | < 20ms | 按状态、动态加入等条件过滤          |
| `requestJoin`      | 加入团队     | < 15ms | 自动从 AgentPool 获取代理           |
| `assignTask`       | 分配任务     | < 25ms | 支持自动选择最优代理（评分算法）    |
| `broadcastMessage` | 团队广播     | < 30ms | 消息队列上限 1000，自动清理         |
| `sendMessage`      | 私信         | < 12ms | 验证双方在同一团队                  |
| `voteOnDecision`   | 投票决策     | < 35ms | 支持 approve/reject/abstain         |
| `getTeamStatus`    | 查询团队状态 | < 10ms | 含代理统计、任务统计、运行时长      |
| `terminateAgent`   | 终止代理     | < 10ms | 自动失败未完成任务并释放到池        |
| `mergeResults`     | 合并结果     | < 20ms | 4 种策略：aggregate/vote/concat/avg |
| `createCheckpoint` | 创建检查点   | < 40ms | 深拷贝团队状态到文件和数据库        |
| `listMembers`      | 列出成员     | < 5ms  | 含状态、能力、当前任务              |
| `updateTeamConfig` | 更新团队配置 | < 8ms  | 合并更新，双持久化                  |

### 创建团队

```javascript
const result = await window.electron.ipcRenderer.invoke("cowork:create-team", {
  teamName: "data-processing-team",
  config: {
    maxAgents: 5,
    allowDynamicJoin: true,
    requireApproval: false,
    votingThreshold: 0.6,
    autoAssignTasks: true,
  },
});

console.log("团队已创建:", result.team.id);
// team.id, team.name, team.status, team.maxAgents
```

### 智能任务分配

系统支持两种任务分配模式：

**指定代理分配**:

```javascript
const result = await window.electron.ipcRenderer.invoke("cowork:assign-task", {
  teamId: "team-001",
  agentId: "agent-1",
  task: {
    id: "task-001",
    description: "分析销售数据并生成报告",
    priority: "HIGH",
    timeout: 300000,
  },
});
```

**自动选择最优代理**（省略 agentId）:

```javascript
const result = await window.electron.ipcRenderer.invoke("cowork:assign-task", {
  teamId: "team-001",
  task: {
    description: "编写单元测试",
    type: "testing",
    priority: "MEDIUM",
  },
});
// 自动选择得分最高的空闲代理
// result.assignedTo = "agent-3" (最适合 testing 的代理)
```

**代理评分算法**:

```
直接技能匹配:    +10 分 (agent.capabilities 包含 task.type)
关键词匹配:      +5 分  (代码/测试/文档/设计/分析关键词)
通用能力匹配:    +2 分  (具有 'general' 能力)
空闲优先:        仅从 idle 状态的代理中选择
```

### 投票决策

```javascript
// 发起投票
const voteResult = await window.electron.ipcRenderer.invoke(
  "cowork:vote-on-decision",
  {
    teamId: "team-001",
    decision: {
      title: "是否采用微服务架构",
      description: "将单体应用拆分为微服务...",
      options: ["同意", "反对", "弃权"],
    },
    votes: [
      { agentId: "agent-1", vote: "approve", reason: "提升可扩展性" },
      { agentId: "agent-2", vote: "approve", reason: "便于独立部署" },
      { agentId: "agent-3", vote: "reject", reason: "增加运维复杂度" },
    ],
  },
);

console.log(voteResult.passed); // true (2/3 > 0.6 threshold)
console.log(voteResult.approvalRate); // 0.667
```

### 结果合并策略

```javascript
const merged = await window.electron.ipcRenderer.invoke(
  "cowork:merge-results",
  {
    teamId: "team-001",
    results: [result1, result2, result3],
    strategy: "vote", // aggregate | vote | concatenate | average
  },
);
```

| 策略          | 说明                 | 适用场景     |
| ------------- | -------------------- | ------------ |
| `aggregate`   | 将所有结果收集到数组 | 收集多方意见 |
| `vote`        | 选择出现最多的结果   | 代码审查共识 |
| `concatenate` | 用换行连接所有结果   | 文档合并     |
| `average`     | 计算数值平均值       | 性能评分汇总 |

### 团队生命周期

```
创建 (active) → 暂停 (paused) → 恢复 (active) → 完成 (completed)
                                                ↓
                                            失败 (failed) → 归档 (archived)
```

**暂停团队**: 暂停所有运行中的任务，记录暂停时长
**恢复团队**: 恢复所有已暂停任务，计算总暂停时间
**销毁团队**: 归档团队状态，终止所有代理，清空消息队列

### 事件系统

TeammateTool 通过 EventEmitter 发射以下事件：

| 事件                 | 触发时机     | 数据                   |
| -------------------- | ------------ | ---------------------- |
| `team-spawned`       | 创建团队     | team 对象              |
| `agent-joined`       | 代理加入团队 | agent, team 对象       |
| `task-assigned`      | 任务分配     | task, agent, team 对象 |
| `message-broadcast`  | 广播消息     | message, teamId        |
| `message-sent`       | 发送私信     | message, from, to      |
| `decision-voted`     | 投票完成     | decision, result       |
| `agent-terminated`   | 代理终止     | agentId, reason        |
| `results-merged`     | 结果合并     | mergedResult, strategy |
| `checkpoint-created` | 检查点创建   | checkpointId, teamId   |
| `team-paused`        | 团队暂停     | teamId                 |
| `team-resumed`       | 团队恢复     | teamId, pauseDuration  |
| `team-destroyed`     | 团队销毁     | teamId                 |

## Agent Pool — 代理池化

AgentPool 实现代理资源的池化复用，减少创建/销毁开销，提升系统性能。

### 工作原理

```
┌──────────────────────────────────────────────────┐
│                   AgentPool                       │
│                                                   │
│  ┌─────────────┐    ┌─────────────────────────┐  │
│  │ 可用代理队列  │    │     繁忙代理 Map          │  │
│  │  (available) │    │     (busy)               │  │
│  │             │    │                          │  │
│  │  agent_1 ←──┼────┼── release ←── agent_3   │  │
│  │  agent_2    │    │              agent_4     │  │
│  │             │ ──→│ acquire ──→              │  │
│  └─────────────┘    └─────────────────────────┘  │
│                                                   │
│  ┌─────────────────────────────────────────────┐  │
│  │              等待队列 (waitQueue)              │  │
│  │  满载时请求排队，释放后按 FIFO 分配           │  │
│  └─────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────┘
```

### 配置

```javascript
{
  minSize: 3,              // 预创建代理数（热启动）
  maxSize: 10,             // 最大代理数（硬上限）
  idleTimeout: 300000,     // 空闲超时（5分钟后销毁）
  warmup: true,            // 初始化时预热
}
```

### 代理获取与释放

```javascript
// 获取代理（自动从池中分配或创建新代理）
const agent = await agentPool.acquireAgent(
  ["coding", "testing"], // 所需能力
  30000, // 等待超时（30秒）
);

// 代理使用后释放回池
await agentPool.releaseAgent(agent.id);
// 如果有等待请求，优先分配给等待者（FIFO）
// 如果超过 minSize，直接销毁
// 否则放回可用队列，启动空闲计时器
```

### 状态隔离

代理复用时自动重置状态：

- `status` → `idle`
- `teamId` → `null`
- `currentTask` → `null`
- `taskQueue` → `[]`
- `reuseCount` 递增
- `lastActiveTime` 更新

### 统计指标

```javascript
const stats = agentPool.getStats();
// {
//   created: 15,        // 总创建数
//   reused: 42,         // 复用次数
//   destroyed: 5,       // 销毁数
//   acquisitions: 57,   // 获取次数
//   releases: 52,       // 释放次数
//   reuseRate: "73.68%",// 复用率
//   avgReuseCount: "2.80"
// }
```

## FileSandbox — 文件沙箱安全系统

FileSandbox 提供多层安全防护，确保代理只能访问被授权的文件，并记录所有操作审计日志。

### 安全架构

```
文件操作请求
    │
    ▼
┌──────────────────┐
│ 1. 路径遍历检测    │ ── 检测 ../ 等路径遍历攻击
└────────┬─────────┘
         │ ✅ 通过
         ▼
┌──────────────────┐
│ 2. 敏感文件检测    │ ── 20+ 内置模式匹配
└────────┬─────────┘
         │ ✅ 通过
         ▼
┌──────────────────┐
│ 3. 权限检查       │ ── READ / WRITE / EXECUTE
└────────┬─────────┘
         │ ✅ 通过
         ▼
┌──────────────────┐
│ 4. 符号链接验证    │ ── 防止绕过沙箱
└────────┬─────────┘
         │ ✅ 通过
         ▼
┌──────────────────┐
│ 5. 文件大小检查    │ ── 最大 100MB (READ)
└────────┬─────────┘
         │ ✅ 通过
         ▼
    执行操作 + 写入审计日志
```

### 敏感文件模式（20+ 内置）

| 类别       | 模式                                |
| ---------- | ----------------------------------- |
| 环境变量   | `.env`, `.env.*`                    |
| 凭证文件   | `credentials.json`, `secrets.json`  |
| SSH 密钥   | `.ssh/`, `id_rsa`                   |
| TLS 证书   | `.pem`, `.key`, `.p12`, `.keystore` |
| Git 配置   | `.git/config`                       |
| 云服务凭证 | `.aws/credentials`, `.azure/config` |
| K8s 配置   | `.kube/config`                      |
| 包管理     | `.npmrc`                            |
| 密码文件   | 匹配 `password` 关键词              |
| 私钥文件   | 匹配 `private.*key` 关键词          |

### 权限管理

```javascript
// 请求文件夹访问权限（触发用户确认弹窗）
const granted = await window.electron.ipcRenderer.invoke(
  "cowork:request-file-access",
  {
    teamId: "team-001",
    folderPath: "/data/workspace",
    permissions: ["read", "write"],
    options: { autoApprove: false },
  },
);

// 程序化授权（跳过用户确认）
await window.electron.ipcRenderer.invoke("cowork:grant-file-access", {
  teamId: "team-001",
  folderPath: "/data/output",
  permissions: ["write"],
});

// 验证访问权限
const validation = await window.electron.ipcRenderer.invoke(
  "cowork:validate-file-access",
  {
    teamId: "team-001",
    filePath: "/data/workspace/report.csv",
    permission: "read",
  },
);
// validation.allowed = true, validation.reason = null
```

### 文件操作（含审计）

```javascript
// 读取文件
const content = await window.electron.ipcRenderer.invoke("cowork:read-file", {
  teamId: "team-001",
  agentId: "agent-1",
  filePath: "/data/workspace/input.json",
});

// 写入文件
await window.electron.ipcRenderer.invoke("cowork:write-file", {
  teamId: "team-001",
  agentId: "agent-1",
  filePath: "/data/workspace/output.json",
  content: JSON.stringify(result, null, 2),
});

// 列出目录（自动过滤敏感文件）
const files = await window.electron.ipcRenderer.invoke(
  "cowork:list-directory",
  {
    teamId: "team-001",
    agentId: "agent-1",
    dirPath: "/data/workspace",
  },
);
// [{name: "input.json", isFile: true}, {name: "output/", isDirectory: true}]
```

### 审计日志查询

```javascript
const logs = await window.electron.ipcRenderer.invoke("cowork:get-audit-log", {
  filters: {
    teamId: "team-001",
    agentId: "agent-1",
    operation: "read",
    success: true,
  },
  limit: 50,
});
// logs: [{teamId, agentId, operation, resourcePath, timestamp, success}, ...]
```

### 安全指标

| 指标         | 数值        |
| ------------ | ----------- |
| 关键漏洞     | 0           |
| 防御层数     | 5 层        |
| 权限检查延迟 | < 3ms       |
| 审计覆盖率   | 100%        |
| 敏感文件模式 | 20+ 种      |
| 最大文件大小 | 100MB       |
| 最大授权路径 | 100 条/团队 |

## 长时任务管理

LongRunningTaskManager 支持检查点、暂停恢复、智能重试和超时控制，适用于数据处理、模型训练等耗时任务。

### 任务生命周期

```
PENDING → RUNNING → [PAUSED] → COMPLETED
                  ↓           ↑
               FAILED → RETRYING (最多 3 次)
                  ↓
             CANCELLED
```

### 创建与执行任务

**自定义执行器**:

```javascript
const task = await window.electron.ipcRenderer.invoke(
  "cowork:create-long-task",
  {
    taskConfig: {
      name: "数据清洗与转换",
      description: "处理 100 万条用户数据",
      type: "data_processing",
      priority: "high",
      timeout: 600000, // 10 分钟超时
      executor: async (context) => {
        const data = await loadData();
        for (let i = 0; i < data.length; i++) {
          await processRecord(data[i]);
          await context.updateProgress(i / data.length, `处理第 ${i + 1} 条`);

          // 每处理 10000 条创建检查点
          if (i % 10000 === 0) {
            await context.createCheckpoint({ processedCount: i });
          }
        }
        return { totalProcessed: data.length };
      },
    },
  },
);

// 启动任务
await window.electron.ipcRenderer.invoke("cowork:start-task", {
  taskId: task.id,
});
```

**分步执行**:

```javascript
const task = await window.electron.ipcRenderer.invoke(
  "cowork:create-long-task",
  {
    taskConfig: {
      name: "数据分析流水线",
      steps: [
        {
          name: "数据加载",
          execute: async (ctx) => loadData(),
          required: true,
        },
        {
          name: "数据清洗",
          execute: async (ctx) => cleanData(ctx.stepResults[0]),
          required: true,
        },
        {
          name: "统计分析",
          execute: async (ctx) => analyze(ctx.stepResults[1]),
          required: true,
        },
        {
          name: "生成报告",
          execute: async (ctx) => generateReport(ctx.stepResults[2]),
          required: false,
        },
      ],
    },
  },
);
```

### 暂停与恢复

```javascript
// 暂停任务（自动创建暂停检查点）
await window.electron.ipcRenderer.invoke("cowork:pause-task", {
  taskId: "task-001",
});

// 查询进度
const status = await window.electron.ipcRenderer.invoke(
  "cowork:get-task-status",
  {
    taskId: "task-001",
  },
);
console.log(`进度: ${(status.progress * 100).toFixed(1)}%`);
console.log(`消息: ${status.progressMessage}`);
console.log(`已用时: ${status.duration}ms`);
console.log(`预计剩余: ${status.estimatedTimeRemaining}ms`);
console.log(`检查点数: ${status.checkpointCount}`);

// 从检查点恢复
await window.electron.ipcRenderer.invoke("cowork:restore-from-checkpoint", {
  checkpointId: "checkpoint-5",
});
await window.electron.ipcRenderer.invoke("cowork:resume-task", {
  taskId: "task-001",
});
```

### 智能检查点策略

SmartCheckpointStrategy 根据任务特征动态调整检查点间隔：

| 因素     | 调整规则                                                    |
| -------- | ----------------------------------------------------------- |
| 任务时长 | < 2min 不创建，2-10min 间隔 2min，> 10min 间隔 5min         |
| 任务类型 | data_processing × 0.5，llm_call × 1.5，file_operation × 0.7 |
| 优先级   | urgent/high × 0.8（更频繁），low × 1.2                      |
| 进度位置 | 0-10% × 1.3（少创建），90%+ × 0.7（多创建）                 |
| 间隔范围 | 最小 1 分钟，最大 10 分钟                                   |

### 错误恢复

- **自动重试**: 默认开启，最多 3 次，间隔 5 秒
- **指数退避**: 可配置退避算法
- **故障隔离**: 单步失败不影响后续非必须步骤
- **完整堆栈**: 保留错误消息和堆栈追踪

## Skills 技能系统

Cowork 集成了 90 个内置技能，使用 SKILL.md 格式定义，支持四层加载和自动匹配。

### 四层加载架构

```
优先级 (高 → 低):
┌───────────────────────────────────────────┐
│  4. Workspace 技能 (用户自定义)            │
│     ~/.chainlesschain/skills/*.md          │
├───────────────────────────────────────────┤
│  3. Managed 技能 (工作区级)                │
│     .chainlesschain/skills/*.md            │
├───────────────────────────────────────────┤
│  2. Marketplace 技能 (第三方安装)          │
│     .chainlesschain/marketplace/skills/    │
├───────────────────────────────────────────┤
│  1. Bundled 技能 (内置 90 个)              │
│     src/main/ai-engine/cowork/skills/      │
│     builtin/                               │
└───────────────────────────────────────────┘
```

### 技能分类（90 个内置技能）

| 类别      | 数量 | 示例技能                                                   |
| --------- | ---- | ---------------------------------------------------------- |
| 开发      | 18   | code-review, git-commit, refactor, architect-mode          |
| 自动化    | 4    | browser-automation, computer-use, workflow-automation      |
| 数据      | 4    | web-scraping, data-analysis, chart-creator, csv-processor  |
| 知识      | 6    | memory-management, smart-search, research-agent            |
| 测试      | 5    | api-tester, lint-and-fix, test-and-fix, bugbot             |
| 分析      | 4    | dependency-analyzer, impact-analyzer, git-history-analyzer |
| 文档      | 7    | pdf-toolkit, doc-converter, excel-analyzer, pptx-creator   |
| 媒体      | 7    | audio-transcriber, video-toolkit, subtitle-generator       |
| 安全      | 4    | security-audit, vulnerability-scanner, crypto-toolkit      |
| DevOps    | 6    | devops-automation, env-doctor, release-manager             |
| AI        | 4    | prompt-enhancer, auto-context, multi-model-router          |
| 系统/工具 | 21   | backup-manager, json-yaml-toolkit, http-client 等          |

### SKILL.md 格式

```markdown
---
name: code-review
description: 智能代码审查
category: development
tags: [code, review, quality]
handlers:
  - name: default
    model: claude-opus
capabilities: [code-analysis, suggestion-generation]
supportedFileTypes: [.js, .ts, .py, .java]
dependencies:
  bins: []
  npm: []
  env: []
platforms: [darwin, linux, win32]
enabled: true
tools: [Read, Grep, Glob]
instructions: 审查代码时关注安全性、性能和可维护性
examples:
  - input: "审查 src/main/index.js"
    output: "发现 3 个问题：..."
---

# Code Review 技能

详细实现说明...
```

### 技能匹配算法

```javascript
// 自动匹配最佳技能
const matches = await window.electron.ipcRenderer.invoke(
  "cowork:find-skills-for-task",
  {
    task: { description: "分析 CSV 数据并生成图表" },
    options: { limit: 5 },
  },
);
// 返回: [{skill: "data-analysis", score: 85}, {skill: "csv-processor", score: 72}, ...]
```

**评分规则**:

| 匹配维度 | 分值 | 说明                            |
| -------- | ---- | ------------------------------- |
| 任务类型 | +40  | task.type 匹配 skill.category   |
| 操作匹配 | +30  | 任务描述匹配 skill.capabilities |
| 文件类型 | +20  | 目标文件匹配 supportedFileTypes |
| 关键词   | +10  | 任务描述匹配 skill.tags         |
| **阈值** | ≥ 80 | 高匹配度                        |

### 技能执行

```javascript
// 指定技能执行
const result = await window.electron.ipcRenderer.invoke(
  "cowork:execute-skill",
  {
    skillId: "data-analysis",
    task: { description: "分析销售数据趋势" },
    context: { filePath: "/data/sales.csv" },
  },
);

// 自动选择技能执行
const result = await window.electron.ipcRenderer.invoke(
  "cowork:auto-execute-task",
  {
    task: { description: "将 Markdown 文档转换为 PDF" },
    context: {},
  },
);
// 自动选择 doc-converter 技能并执行
```

### 门控检查

技能执行前自动验证运行条件：

```javascript
const check = await window.electron.ipcRenderer.invoke(
  "cowork:check-skill-requirements",
  { skillId: "browser-automation" },
);
// {
//   passed: true,
//   results: {
//     platform: { passed: true, matched: "win32", required: ["win32", "darwin", "linux"] },
//     bins: { passed: true, missing: [] },
//     env: { passed: true, missing: [] },
//     enabled: { passed: true }
//   }
// }
```

## 系统架构

### 整体架构图

```
┌─────────────────────────────────────────────────────────────────┐
│                    前端 (Vue3 + Ant Design Vue)                   │
│                                                                  │
│  ┌──────────────┐  ┌───────────────┐  ┌──────────────────────┐ │
│  │ CoworkDash-  │  │ CoworkAnaly-  │  │ Components:          │ │
│  │ board.vue    │  │ tics.vue      │  │ TeamCard, TeamDetail │ │
│  │              │  │               │  │ TaskDetail, SkillCard│ │
│  │ 团队管理     │  │ 分析仪表板    │  │ FilePermission       │ │
│  └──────┬───────┘  └──────┬────────┘  └──────────┬───────────┘ │
│         │                 │                       │              │
│  ┌──────┴─────────────────┴───────────────────────┴───────────┐ │
│  │                    Pinia Store (cowork.ts)                   │ │
│  │  1,410 行 | 25+ Getters | 40+ Actions | TypeScript          │ │
│  └──────────────────────┬──────────────────────────────────────┘ │
└─────────────────────────┼────────────────────────────────────────┘
                          │ IPC 通信（51 个处理器）
┌─────────────────────────┼────────────────────────────────────────┐
│                         ▼                                         │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │                  CoworkOrchestrator                         │  │
│  │            (智能单/多代理决策引擎)                            │  │
│  └────┬──────────────┬──────────────┬──────────────┬──────────┘  │
│       │              │              │              │              │
│  ┌────┴─────┐  ┌─────┴──────┐  ┌───┴──────────┐  ┌┴──────────┐ │
│  │Teammate  │  │ FileSandbox│  │LongRunning   │  │ AgentPool │ │
│  │Tool      │  │            │  │TaskManager   │  │           │ │
│  │          │  │ 5层安全    │  │              │  │ 池化复用  │ │
│  │ 13操作   │  │ 20+模式   │  │ 智能检查点   │  │ 自动扩缩  │ │
│  └────┬─────┘  └─────┬──────┘  └───┬──────────┘  └┬──────────┘ │
│       │              │              │              │              │
│  ┌────┴──────────────┴──────────────┴──────────────┴──────────┐  │
│  │                    Skills 框架 (90 内置技能)                  │  │
│  │              四层加载 | 门控检查 | 自动匹配                    │  │
│  └────────────────────────────┬───────────────────────────────┘  │
│                               │                                   │
│  ┌────────────────────────────┴───────────────────────────────┐  │
│  │                   数据持久层                                 │  │
│  │    SQLite/SQLCipher (9 张表) + 文件系统 + 内存缓存           │  │
│  └────────────────────────────────────────────────────────────┘  │
│                          Electron Main Process                    │
└───────────────────────────────────────────────────────────────────┘
```

### 数据库 Schema

**9 张核心表**:

| 表名                         | 用途     | 关键字段                                                  |
| ---------------------------- | -------- | --------------------------------------------------------- |
| `cowork_teams`               | 团队信息 | id, name, status, max_agents, metadata (JSON)             |
| `cowork_agents`              | 代理信息 | id, team_id, name, status, assigned_task                  |
| `cowork_tasks`               | 任务信息 | id, team_id, assigned_to, status, priority, result (JSON) |
| `cowork_messages`            | 消息记录 | id, team_id, from_agent, to_agent, message (JSON)         |
| `cowork_decisions`           | 投票记录 | id, team_id, decision_data (JSON), votes (JSON), passed   |
| `cowork_checkpoints`         | 检查点   | id, team_id, task_id, checkpoint_data (JSON)              |
| `cowork_sandbox_permissions` | 文件权限 | id, team_id, path, permission, expires_at, is_active      |
| `cowork_audit_log`           | 审计日志 | team_id, agent_id, operation, resource_path, success      |
| `cowork_metrics`             | 性能指标 | team_id, metric_name, metric_value, timestamp             |

**索引**:

- `cowork_teams`: status, created_at
- `cowork_agents`: team_id, status
- `cowork_tasks`: team_id, status, assigned_to
- `cowork_messages`: team_id, timestamp
- `cowork_audit_log`: team_id, agent_id, timestamp

## IPC 接口完整列表

Cowork 系统共提供 **51 个 IPC 处理器**，分为 6 大类：

### TeammateTool 操作（15 个）

| 通道                                | 功能           |
| ----------------------------------- | -------------- |
| `cowork:create-team`                | 创建团队       |
| `cowork:discover-teams`             | 发现/列出团队  |
| `cowork:request-join`               | 代理加入团队   |
| `cowork:assign-task`                | 分配任务       |
| `cowork:broadcast-message`          | 团队广播       |
| `cowork:send-message`               | 私信           |
| `cowork:vote-on-decision`           | 投票决策       |
| `cowork:get-team-status`            | 查询团队状态   |
| `cowork:terminate-agent`            | 终止代理       |
| `cowork:merge-results`              | 合并多代理结果 |
| `cowork:create-checkpoint`          | 创建团队检查点 |
| `cowork:list-members`               | 列出团队成员   |
| `cowork:update-team-config`         | 更新团队配置   |
| `cowork:destroy-team`               | 销毁团队       |
| `cowork:pause-team` / `resume-team` | 暂停/恢复团队  |

### FileSandbox 操作（11 个）

| 通道                          | 功能               |
| ----------------------------- | ------------------ |
| `cowork:request-file-access`  | 请求文件访问权限   |
| `cowork:grant-file-access`    | 授予文件访问权限   |
| `cowork:revoke-file-access`   | 撤销文件访问权限   |
| `cowork:validate-file-access` | 验证文件访问权限   |
| `cowork:read-file`            | 读取文件（含审计） |
| `cowork:write-file`           | 写入文件（含审计） |
| `cowork:delete-file`          | 删除文件（含审计） |
| `cowork:list-directory`       | 列出目录内容       |
| `cowork:get-allowed-paths`    | 获取已授权路径     |
| `cowork:get-audit-log`        | 查询审计日志       |
| `cowork:get-sandbox-stats`    | 沙箱统计信息       |

### 长时任务操作（9 个）

| 通道                             | 功能             |
| -------------------------------- | ---------------- |
| `cowork:create-long-task`        | 创建长时任务     |
| `cowork:start-task`              | 启动任务         |
| `cowork:pause-task`              | 暂停任务         |
| `cowork:resume-task`             | 恢复任务         |
| `cowork:cancel-task`             | 取消任务         |
| `cowork:get-task-status`         | 查询任务状态     |
| `cowork:get-active-tasks`        | 获取活动任务列表 |
| `cowork:restore-from-checkpoint` | 从检查点恢复     |
| `cowork:get-task-manager-stats`  | 任务管理器统计   |

### Skills 操作（10 个）

| 通道                              | 功能            |
| --------------------------------- | --------------- |
| `cowork:execute-skill`            | 执行指定技能    |
| `cowork:auto-execute-task`        | AI 自动选择技能 |
| `cowork:find-skills-for-task`     | 查找匹配技能    |
| `cowork:get-all-skills`           | 获取所有技能    |
| `cowork:get-skill-stats`          | 技能使用统计    |
| `cowork:get-skill-sources`        | 技能加载路径    |
| `cowork:reload-skills`            | 重新加载技能    |
| `cowork:get-invocable-skills`     | 获取可调用技能  |
| `cowork:check-skill-requirements` | 检查技能依赖    |
| `cowork:get-skill-definition`     | 获取技能定义    |

### 分析与统计（6 个）

| 通道                      | 功能                  |
| ------------------------- | --------------------- |
| `cowork:get-stats`        | 全局统计信息          |
| `cowork:get-analytics`    | 高级分析数据          |
| `cowork:set-log-level`    | 设置日志级别          |
| `cowork:get-logs`         | 获取操作日志          |
| `cowork:decide-execution` | 智能决策（单/多代理） |
| `cowork:get-config`       | 获取系统配置          |

## 前端集成

### CoworkDashboard 页面

```vue
<template>
  <CoworkDashboard />
</template>

<script setup>
import CoworkDashboard from "@/pages/CoworkDashboard.vue";
</script>
```

**功能模块**:

- **全局统计卡片**: 团队数 / 活跃团队 / 运行任务 / 成功率
- **团队搜索与过滤**: 实时搜索 + 状态下拉过滤（active/paused/completed/failed）
- **团队网格**: 响应式布局（24xs, 12sm, 8md, 6lg），TeamCard 卡片展示
- **创建团队弹窗**: 名称、描述、最大代理数滑块(1-20)、动态加入开关、共识阈值(0.5-1.0)
- **团队详情抽屉**: 800px 右侧抽屉，TeamDetailPanel 组件
- **快捷操作**: 查看任务、管理技能、创建团队按钮

### CoworkAnalytics 页面

```vue
<template>
  <CoworkAnalytics />
</template>

<script setup>
import CoworkAnalytics from "@/pages/CoworkAnalytics.vue";
</script>
```

**图表组件** (ECharts):

| 图表             | 类型      | 说明                            |
| ---------------- | --------- | ------------------------------- |
| 任务完成趋势     | 折线+柱状 | 30 天历史数据                   |
| 任务状态分布     | 饼图      | active/completed/failed/pending |
| 代理利用率热力图 | 热力图    | 7 天 × 24 小时使用分布          |
| 技能使用统计     | 水平柱状  | Top 6 热门技能                  |
| 任务执行时间线   | 甘特图    | 按代理展示任务调度              |
| 优先级与时长     | 散点图    | 50 点相关性分析                 |
| 团队绩效排名     | 堆叠柱状  | 完成/失败任务堆叠对比           |

**实时监控面板**: 3 个仪表盘每 3 秒刷新（系统负载、任务队列、成功率）

### 组件列表

| 组件                       | 功能                                           |
| -------------------------- | ---------------------------------------------- |
| `TeamCard.vue`             | 团队卡片（状态徽章、成员数、操作菜单）         |
| `TeamDetailPanel.vue`      | 团队详情（基本信息、配置、成员管理、任务列表） |
| `TaskDetailPanel.vue`      | 任务详情（进度条、步骤、检查点）               |
| `SkillCard.vue`            | 技能卡片（类型徽章、支持操作、文件类型）       |
| `SkillDetailPanel.vue`     | 技能详情（匹配算法说明、使用示例）             |
| `FilePermissionDialog.vue` | 文件权限弹窗（路径展示、权限复选框、安全警告） |

### Pinia Store (cowork.ts)

**1,410 行** TypeScript，完整的状态管理：

```typescript
// 类型定义
type TeamStatus = "active" | "paused" | "completed" | "failed";
type TaskStatus =
  | "pending"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

// Store 结构
const useCoworkStore = defineStore("cowork", {
  state: () => ({
    teams: [], // 团队列表
    currentTeam: null, // 当前选中团队
    tasks: [], // 任务列表
    skills: [], // 技能列表
    agents: [], // 代理列表
    globalStats: {}, // 全局统计
    teamFilters: {}, // 团队过滤条件
    taskFilters: {}, // 任务过滤条件
    // ... 7 个 loading 标志位
  }),
  getters: {
    filteredTeams, // 按搜索 + 状态过滤
    activeTeams, // 仅 active 状态
    runningTasks, // 仅 running 状态
    skillsByType, // 按类型分组
    isLoading, // 任一 loading 为 true
    // ... 25+ getters
  },
  actions: {
    createTeam, // → cowork:create-team
    loadTeams, // → cowork:discover-teams
    assignTask, // → cowork:assign-task
    loadSkills, // → cowork:skill-list-all
    autoExecuteTask, // → cowork:skill-auto-execute
    initEventListeners, // 注册 4 个实时事件
    // ... 40+ actions
  },
});
```

**实时事件监听**:

- `cowork:team-updated` — 更新团队状态
- `cowork:task-progress` — 更新任务进度
- `cowork:agent-joined` — 刷新成员列表
- `cowork:task-completed` — 更新任务状态 + 刷新统计

## 配置参考

### TeammateTool 配置

```javascript
{
  dataDir: ".chainlesschain/cowork",
  maxTeams: 10,                       // 最大团队数
  maxAgentsPerTeam: 5,                // 每团队最大代理数
  messageRetention: 86400000,         // 消息保留时间（24小时）
  enableLogging: true,                // 启用操作日志
  useAgentPool: true,                 // 启用代理池
  agentPoolMinSize: 3,                // 代理池最小数量
  agentPoolMaxSize: 10,               // 代理池最大数量
  agentPoolIdleTimeout: 300000,       // 空闲超时（5分钟）
  agentPoolWarmup: true,              // 初始化时预热
}
```

### FileSandbox 配置

```javascript
{
  strictMode: true,                   // 严格模式（必须显式授权）
  auditEnabled: true,                 // 启用审计日志
  maxAllowedPaths: 100,               // 最大授权路径数
  allowSymlinks: false,               // 禁止符号链接
  maxFileSize: 104857600,             // 最大文件大小（100MB）
}
```

### LongRunningTaskManager 配置

```javascript
{
  dataDir: ".chainlesschain/cowork/tasks",
  checkpointInterval: 60000,          // 检查点间隔（1分钟）
  maxRetries: 3,                      // 最大重试次数
  retryDelay: 5000,                   // 重试间隔（5秒）
  taskTimeout: 0,                     // 任务超时（0=无限制）
  autoRecovery: true,                 // 自动恢复
  retentionDays: 7,                   // 任务数据保留天数
  useSmartCheckpoint: true,           // 启用智能检查点
  minCheckpointInterval: 60000,       // 最小检查点间隔（1分钟）
  maxCheckpointInterval: 600000,      // 最大检查点间隔（10分钟）
}
```

## 性能指标

### 响应时间

| 操作       | 目标   | 实际 | 状态 |
| ---------- | ------ | ---- | ---- |
| 创建团队   | < 50ms | 45ms | ✅   |
| 添加代理   | < 20ms | 15ms | ✅   |
| 分配任务   | < 30ms | 25ms | ✅   |
| 权限检查   | < 5ms  | 3ms  | ✅   |
| 投票决策   | < 40ms | 35ms | ✅   |
| 代理池获取 | < 10ms | 5ms  | ✅   |
| 检查点创建 | < 50ms | 40ms | ✅   |
| 技能匹配   | < 30ms | 20ms | ✅   |

### 资源使用

| 指标         | 数值               |
| ------------ | ------------------ |
| 内存占用     | < 50MB (单团队)    |
| 数据库大小   | ~2MB (1000 个任务) |
| CPU (空闲)   | < 5%               |
| CPU (高负载) | < 30%              |
| 代理池复用率 | ~74%               |

### 可扩展性

| 限制              | 数值  |
| ----------------- | ----- |
| 最大团队数        | 100+  |
| 最大代理数/团队   | 10    |
| 最大并发任务      | 1000+ |
| 最大检查点数/任务 | 100   |
| 最大授权路径/团队 | 100   |
| 消息队列容量      | 1000  |

## 测试覆盖率

### 单元测试

```
✅ teammate-tool.test.js         - 50+ 测试用例 (团队/代理/任务/消息/投票)
✅ file-sandbox.test.js          - 40+ 测试用例 (权限/路径/敏感文件/审计)
✅ long-running-task.test.js     - 35+ 测试用例 (生命周期/检查点/重试)
✅ agent-pool.test.js            - 30+ 测试用例 (获取/释放/超时/事件)
✅ skills.test.js                - 50+ 测试用例 (加载/匹配/执行/门控)
```

**总覆盖率**: ~90%，200+ 测试用例，99.6% 通过率

### E2E 测试

- ✅ 团队创建、暂停、恢复和解散完整流程
- ✅ 任务分配、执行和结果合并流程
- ✅ 投票决策和共识达成流程
- ✅ 文件权限申请、授权和撤销流程
- ✅ 敏感文件检测和路径遍历防护
- ✅ 长时任务检查点创建和恢复
- ✅ 代理池获取、释放和超时处理
- ✅ 技能加载、匹配和执行流程

### 性能测试

- ✅ 代理池 5 分钟热身 + 2 分钟压力测试
- ✅ 并发团队创建 (100+)
- ✅ 高频消息广播 (1000 条/秒)

## 安全考虑

### 文件访问安全

1. **敏感文件检测** — 20+ 内置模式 + 自定义模式支持
2. **路径遍历防护** — 禁止 `../` 路径遍历
3. **权限检查** — READ / WRITE / EXECUTE 三级控制
4. **符号链接验证** — 防止绕过沙箱限制
5. **审计日志** — 100% 操作审计覆盖率
6. **文件大小限制** — 最大 100MB 防止资源耗尽

### 数据安全

1. **SQLCipher 加密** — 数据库 AES-256 加密
2. **内存清理** — 敏感数据使用后立即清理
3. **传输安全** — IPC 通信加密
4. **检查点加密** — 检查点数据持久化加密

### 代码注入防护

1. **参数验证** — 严格的输入类型和范围检查
2. **SQL 参数化** — 防止 SQL 注入
3. **命令白名单** — 防止命令注入
4. **输出净化** — 防止跨站脚本

## 故障排查

### 常见问题

**Q: 团队创建失败?**

检查以下几点:

1. 团队名称是否唯一
2. 是否超过最大团队数限制 (默认 10)
3. 数据库连接是否正常
4. 数据目录 `.chainlesschain/cowork/` 是否有写权限

**Q: 任务执行超时?**

可能原因:

1. 任务太复杂 — 增加 `timeout` 配置
2. 代理资源不足 — 增加 `agentPoolMaxSize`
3. 检查点频率太高 — 调整 `minCheckpointInterval`
4. 网络延迟 — 检查外部服务连接

**Q: 代理池耗尽?**

解决方案:

1. 增加 `maxSize` 配置（默认 10）
2. 检查是否有代理未正确释放（leak）
3. 减少 `idleTimeout` 加快回收
4. 查看 `agentPool.getStats()` 分析复用率

**Q: 文件访问被拒绝?**

检查:

1. 文件路径是否在已授权列表 (`cowork:get-allowed-paths`)
2. 是否有对应权限（read/write/execute）
3. 是否命中敏感文件模式
4. 查看审计日志 (`cowork:get-audit-log`) 了解拒绝原因

### 调试模式

```javascript
// 设置日志级别
await window.electron.ipcRenderer.invoke("cowork:set-log-level", {
  level: "debug",
});

// 查看组件日志
const logs = await window.electron.ipcRenderer.invoke("cowork:get-logs", {
  component: "teammate-tool", // file-sandbox | long-running-task | agent-pool | skills
  since: Date.now() - 3600000, // 最近 1 小时
});
```

## 关键文件

| 文件                                                     | 职责                   | 行数   |
| -------------------------------------------------------- | ---------------------- | ------ |
| `src/main/ai-engine/cowork/teammate-tool.js`             | 13 核心操作引擎        | ~1,700 |
| `src/main/ai-engine/cowork/file-sandbox.js`              | 文件沙箱安全系统       | ~830   |
| `src/main/ai-engine/cowork/long-running-task-manager.js` | 长时任务管理           | ~1,050 |
| `src/main/ai-engine/cowork/agent-pool.js`                | 代理池化管理           | ~435   |
| `src/main/ai-engine/cowork/cowork-ipc.js`                | 51 IPC 处理器          | ~650   |
| `src/main/ai-engine/cowork/skills/index.js`              | Skills 加载器（四层）  | ~500   |
| `src/main/ai-engine/cowork/skills/skills-ipc.js`         | Skills IPC (17 处理器) | ~400   |
| `src/main/ai-engine/cowork/skills/skill-md-parser.js`    | SKILL.md 解析器        | ~300   |
| `src/main/ai-engine/cowork/skills/builtin/`              | 90 内置技能 Handler    | ~3,000 |
| `src/renderer/pages/CoworkDashboard.vue`                 | 仪表板页面             | ~638   |
| `src/renderer/pages/CoworkAnalytics.vue`                 | 分析页面               | ~1,080 |
| `src/renderer/stores/cowork.ts`                          | Pinia 状态管理         | ~1,410 |
| `tests/cowork/`                                          | 测试套件               | ~2,183 |

## 相关文档

- [快速入门指南 →](/guide/cowork-quick-start)
- [Skills 技能系统 →](/chainlesschain/skills)
- [Computer Use →](/chainlesschain/computer-use)
- [权限系统 →](/chainlesschain/permissions)
- [Hooks 系统 →](/chainlesschain/hooks)
- [Plan Mode →](/chainlesschain/plan-mode)
- [Session Manager →](/chainlesschain/session-manager)

## 未来规划

### v1.1.0 — 技能生态与工作流集成

**目标**: 深度整合 90 内置技能与工作流自动化，提升日常开发效率 40%+

#### 技能生态扩展

- [ ] **统一工具注册表集成** — 将 Cowork Skills 与 UnifiedToolRegistry（FunctionCaller 60+ 工具 + MCP 8 服务器 + 90 技能）完全打通，实现跨系统技能调用
- [ ] **Marketplace 技能热加载** — 从 Plugin Marketplace 安装的第三方技能自动注册到 Cowork SkillRegistry，支持四层加载（bundled → marketplace → managed → workspace）
- [ ] **技能组合编排** — 支持多技能串联/并行执行的 Pipeline 模式，如 `web-scraping → data-analysis → chart-creator → doc-generator` 自动化数据报告流水线
- [ ] **技能性能仪表板** — 集成 LLM Performance Dashboard，展示技能执行耗时、Token 消耗、成功率等指标

#### 技能 Pipeline 架构

```
Pipeline 执行模式:

  串联模式 (Serial):
  ┌──────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
  │web-scrap │──→│data-analysis │──→│chart-creator │──→│doc-generator │
  │  ing     │   │              │   │              │   │              │
  └──────────┘   └──────────────┘   └──────────────┘   └──────────────┘
       ↓              ↓                   ↓                   ↓
    原始HTML      结构化数据          图表PNG/SVG          PDF报告

  并行模式 (Parallel):
  ┌──────────────┐
  │code-review   │──→ 代码质量报告
  ├──────────────┤
  │security-audit│──→ 安全漏洞报告    ──→ 合并结果
  ├──────────────┤
  │test-generator│──→ 测试用例
  └──────────────┘

  混合模式 (Hybrid):
  ┌──────────┐   ┌──────────┬──────────┐   ┌──────────┐
  │ 数据加载  │──→│ 清洗分支  │ 转换分支  │──→│ 结果合并  │
  └──────────┘   └──────────┴──────────┘   └──────────┘
```

#### Git Hooks 集成

- [ ] **Pre-commit 智能检查** — 集成 `code-review` + `security-audit` + `lint-and-fix` 技能，将提交前检查时间从 2-5 分钟降至 30-60 秒
- [ ] **影响范围分析** — 基于 `impact-analyzer` + `dependency-analyzer` 自动识别变更影响范围，智能选择需要运行的测试
- [ ] **自动修复流程** — `test-and-fix` + `bugbot` 在 CI 失败时自动尝试修复并重新提交

#### Git Hooks 工作流

```
git commit
    │
    ▼
┌──────────────────┐
│ Pre-commit Hook   │
│                   │
│  ┌─────────────┐ │
│  │ lint-and-fix │ │ ── 自动修复 ESLint/Prettier
│  └──────┬──────┘ │
│         ▼        │
│  ┌─────────────┐ │
│  │ code-review  │ │ ── AI 快速审查关键问题
│  └──────┬──────┘ │
│         ▼        │
│  ┌──────────────┐│
│  │security-audit││ ── 敏感信息/漏洞扫描
│  └──────────────┘│
└──────────────────┘
    │
    ▼
  提交成功 (30-60秒, 原 2-5 分钟)
```

#### 可视化工作流编辑器

- [ ] **拖拽式工作流设计器** — 基于 Vue Flow 的可视化编辑器，支持条件分支、循环、并行节点
- [ ] **模板库** — 预置 10+ 常用工作流模板（代码审查、发布管理、数据处理等）
- [ ] **实时调试面板** — 工作流执行时可视化每个节点的输入/输出和执行状态

#### 性能优化

- [ ] **Agent 池化与复用** — 减少代理创建/销毁开销，降低内存占用 30%
- [ ] **增量检查点** — 仅保存差异数据，减少检查点存储空间 60%
- [ ] **懒加载技能** — 按需加载技能定义和 Handler，启动时间优化 50%

#### 关键文件（规划）

| 文件                                            | 职责                   |
| ----------------------------------------------- | ---------------------- |
| `src/main/ai-engine/cowork/skill-pipeline.js`   | 技能 Pipeline 编排引擎 |
| `src/main/ai-engine/cowork/git-hooks-bridge.js` | Git Hooks 集成桥接     |
| `src/main/ai-engine/cowork/workflow-editor.js`  | 工作流编辑器后端       |
| `src/renderer/pages/WorkflowEditorPage.vue`     | 可视化工作流编辑器     |
| `src/renderer/pages/SkillPipelinePage.vue`      | 技能 Pipeline 管理页   |

---

### v1.2.0 — 专业化代理与智能调度

**目标**: 利用 8 个专业化代理模板实现智能任务分解和自动化执行

#### 专业化代理深度集成

- [ ] **代理模板自动匹配** — 根据任务描述自动选择最优代理模板（CodeSecurity / DevOps / DataAnalysis / Documentation / TestGenerator / Architect / Performance / Compliance）
- [ ] **代理能力学习** — 基于历史执行数据，动态调整代理的技能权重和优先级
- [ ] **代理间知识共享** — 通过 Permanent Memory 实现代理间的经验传递和知识积累
- [ ] **代理性能画像** — 每个代理的成功率、平均耗时、擅长领域等维度的能力画像

#### 代理能力画像

```
代理性能画像示例:

  Agent: CodeSecurity-01
  ┌────────────────────────────────────────┐
  │ 成功率:  ████████████████████ 95.2%     │
  │ 平均耗时: ████████████ 2.3min            │
  │ 总任务:  347 (完成 330, 失败 17)         │
  │                                         │
  │ 擅长领域:                                │
  │   安全审计    ██████████████ 92%          │
  │   漏洞扫描    █████████████ 88%           │
  │   代码审查    ██████████ 71%              │
  │   依赖分析    ████████ 63%                │
  │                                         │
  │ 技能权重 (动态调整):                      │
  │   security-audit:     0.95 (+0.05)       │
  │   vulnerability-scan: 0.91 (+0.03)       │
  │   code-review:        0.72 (-0.02)       │
  │   dependency-analyze: 0.65 (+0.01)       │
  └────────────────────────────────────────┘
```

#### ML 驱动的任务调度

- [ ] **任务复杂度预测** — 基于历史数据训练轻量模型，预测任务所需时间和资源
- [ ] **动态负载均衡** — 实时监控代理负载，自动迁移任务到空闲代理
- [ ] **优先级自适应** — 根据截止时间、依赖关系、资源可用性动态调整任务优先级
- [ ] **故障预测与预防** — 识别高风险任务模式，提前分配额外资源

#### 智能调度算法

```
任务到达
    │
    ▼
┌──────────────────┐
│ 复杂度预测模型    │ ── 基于: 任务描述、历史数据、依赖数
│ (轻量 ML)        │     输出: 预估时间、所需资源、风险等级
└────────┬─────────┘
         ▼
┌──────────────────┐
│ 代理匹配引擎      │ ── 考虑: 能力画像、当前负载、历史成功率
│                   │     策略: 最佳匹配 > 最少负载 > 最近空闲
└────────┬─────────┘
         ▼
┌──────────────────┐
│ 优先级调度器      │ ── 因素: 截止时间、依赖链、资源可用性
│                   │     动态: 每 30 秒重新评估优先级
└────────┬─────────┘
         ▼
    分配到最优代理
```

#### CI/CD 深度优化

- [ ] **智能测试选择** — 基于代码变更的影响分析，仅运行受影响的测试（目标: 70%+ 缓存命中率）
- [ ] **增量构建编排** — Cowork 管理分布式构建任务，CI/CD 时间从 20-30 分钟降至 10-15 分钟
- [ ] **自动化发布流水线** — 集成 `release-manager` + `changelog-generator` + `doc-generator`，一键发布

#### 文档自动化

- [ ] **API 文档自动生成** — 扫描 IPC handlers 和函数签名，自动生成 OpenAPI/Swagger 文档
- [ ] **架构图自动更新** — 基于代码变更自动更新 Mermaid 架构图和 ADR 记录
- [ ] **变更日志智能汇总** — 基于 `git-history-analyzer` 自动生成版本变更日志

#### 关键文件（规划）

| 文件                                              | 职责               |
| ------------------------------------------------- | ------------------ |
| `src/main/ai-engine/agents/agent-matcher.js`      | 代理模板自动匹配   |
| `src/main/ai-engine/agents/capability-learner.js` | 代理能力学习引擎   |
| `src/main/ai-engine/agents/knowledge-sharing.js`  | 代理间知识共享     |
| `src/main/ai-engine/cowork/ml-scheduler.js`       | ML 驱动的任务调度  |
| `src/main/ai-engine/cowork/smart-ci-bridge.js`    | CI/CD 智能集成桥接 |
| `src/renderer/pages/AgentProfilePage.vue`         | 代理性能画像页面   |

---

### v2.0.0 — 跨设备协作与分布式执行

**目标**: 突破单设备限制，实现桌面端、Android、iOS 三端协同的多智能体网络

#### 跨设备团队协作

- [ ] **P2P 代理网络** — 基于现有 WebRTC DataChannel 基础设施，实现跨设备代理通信
- [ ] **远程技能委派** — Android/iOS 端通过 P2PSkillBridge 将 REMOTE 类型技能委派到桌面端执行（已有 8 个远程技能定义）
- [ ] **设备能力发现** — 自动发现网络中各设备的可用技能和计算资源
- [ ] **混合执行策略** — 轻量任务在移动端本地执行，重量任务委派到桌面端或云端

#### 跨设备协作架构

```
┌──────────────────┐     WebRTC      ┌──────────────────┐
│   Desktop 端      │ ◄─────────────► │   Android 端      │
│                   │   DataChannel   │                   │
│  90 Skills 全量   │                │  28 Skills 本地   │
│  GPU 加速         │                │  8 REMOTE 技能    │
│  全能力代理      │                │  轻量代理         │
└────────┬──────────┘                └────────┬──────────┘
         │                                     │
         │           WebRTC                    │
         │      ┌─────────────┐                │
         └──────┤ Signaling   ├────────────────┘
                │ Server 9001 │
         ┌──────┤             ├────────────────┐
         │      └─────────────┘                │
         │                                     │
┌────────┴──────────┐                ┌────────┴──────────┐
│   iOS 端           │                │   云端（可选）     │
│                   │                │                   │
│  ComputerUse 工具 │                │  大模型推理       │
│  12 AI Tools      │                │  分布式计算       │
└───────────────────┘                └───────────────────┘

  技能委派路由:
  Android REMOTE skill → P2PSkillBridge → Desktop 执行 → 结果回传
```

#### Computer Use 集成

- [ ] **视觉代理协作** — 将 Computer Use 的 12 个 AI 工具（browser_click, visual_click, desktop_screenshot 等）作为 Cowork 技能，支持多代理协同操作浏览器和桌面
- [ ] **录制回放共享** — 一个代理录制的操作序列可分发给其他代理回放执行
- [ ] **安全模式联动** — Cowork 的 FileSandbox 与 Computer Use 的 SafeMode 统一权限管控

#### 企业级功能

- [ ] **SSO 集成** — 团队成员通过 SAML/OAuth/OIDC 统一认证，代理操作与真实用户身份绑定
- [ ] **合规审计** — 集成 Enterprise Audit Logger，所有代理操作记录到统一审计日志，支持 GDPR/SOC2 合规报告
- [ ] **团队权限继承** — 与 RBAC Permission Engine 联动，代理继承其所属团队的资源访问权限
- [ ] **多租户隔离** — 不同团队/项目的代理和数据完全隔离

#### API 开放平台

- [ ] **RESTful API** — 通过 MCP SDK HTTP Server 暴露 Cowork 核心操作，支持外部系统集成
- [ ] **Webhook 事件** — 任务完成、投票结果、代理状态变更等事件推送
- [ ] **SDK 封装** — 提供 JavaScript/Python/Go SDK，方便第三方开发者集成 Cowork 能力

#### 关键文件（规划）

| 文件                                               | 职责              |
| -------------------------------------------------- | ----------------- |
| `src/main/ai-engine/cowork/p2p-agent-network.js`   | P2P 代理网络      |
| `src/main/ai-engine/cowork/device-discovery.js`    | 设备能力发现      |
| `src/main/ai-engine/cowork/hybrid-executor.js`     | 混合执行策略      |
| `src/main/ai-engine/cowork/computer-use-bridge.js` | Computer Use 集成 |
| `src/main/ai-engine/cowork/cowork-api-server.js`   | RESTful API 服务  |
| `src/main/ai-engine/cowork/webhook-manager.js`     | Webhook 事件推送  |

---

### v2.1.0 — 自进化与知识图谱

**目标**: 构建能够自我学习和知识积累的智能代理网络

#### 知识图谱驱动

- [ ] **代码知识图谱** — 基于 `knowledge-graph` 技能自动构建项目代码的实体关系图谱（类、函数、模块、依赖）
- [ ] **决策知识库** — 积累历史决策数据（投票结果、方案选择、故障处理），为未来决策提供参考
- [ ] **最佳实践推荐** — 基于知识图谱分析，自动推荐适合当前任务的代码模式和解决方案

#### 知识图谱架构

```
代码知识图谱:

  ┌─────────┐    imports    ┌─────────┐
  │ Module A │ ───────────► │ Module B │
  └────┬─────┘              └────┬─────┘
       │ contains                │ contains
       ▼                         ▼
  ┌─────────┐    calls     ┌─────────┐
  │ Class X  │ ───────────► │ Class Y  │
  └────┬─────┘              └────┬─────┘
       │ has method              │ has method
       ▼                         ▼
  ┌─────────┐   depends    ┌─────────┐
  │ func()  │ ───────────► │ func()  │
  └─────────┘              └─────────┘

  决策知识图:

  ┌──────────────┐
  │ 问题 P001    │
  │ "性能瓶颈"   │
  └──────┬───────┘
         │ 历史方案
    ┌────┴────┬────────────┐
    ▼         ▼            ▼
  方案A     方案B        方案C
  (缓存)   (索引优化)   (异步处理)
  成功率92% 成功率78%   成功率85%
    ↓
  推荐方案A
```

#### 自进化代理

- [ ] **技能自动发现** — 代理根据任务失败原因自动搜索 Marketplace 中的新技能并建议安装
- [ ] **Prompt 自优化** — 基于执行结果反馈，自动调优技能的 Prompt 模板（集成 `prompt-enhancer`）
- [ ] **经验回放学习** — 将成功的任务执行路径提取为新的工作流模板，持续丰富模板库

#### 高级协作模式

- [ ] **辩论式代码审查** — 多个代理从不同角度（性能、安全、可维护性）审查代码，通过投票达成共识
- [ ] **A/B 方案对比** — 对同一任务生成多个实现方案，自动运行基准测试并推荐最优方案
- [ ] **流式任务处理** — 支持数据流式处理模式，适用于日志分析、实时监控等持续性任务

#### 辩论式代码审查流程

```
代码变更提交
      │
      ├──────────────────────────────────────┐
      ▼                 ▼                    ▼
┌──────────┐    ┌──────────┐        ┌──────────┐
│ 性能代理  │    │ 安全代理  │        │ 维护性代理│
│          │    │          │        │          │
│ 分析性能  │    │ 扫描漏洞  │        │ 检查可读性│
│ 影响     │    │ 安全隐患  │        │ 复杂度    │
└────┬─────┘    └────┬─────┘        └────┬─────┘
     │               │                   │
     └───────────────┼───────────────────┘
                     ▼
              ┌──────────────┐
              │  投票决策      │
              │              │
              │ 性能: 通过    │
              │ 安全: 需修改  │
              │ 维护: 通过    │
              │              │
              │ 结果: 需修改  │
              └──────────────┘
```

#### 关键文件（规划）

| 文件                                                   | 职责              |
| ------------------------------------------------------ | ----------------- |
| `src/main/ai-engine/cowork/code-knowledge-graph.js`    | 代码知识图谱构建  |
| `src/main/ai-engine/cowork/decision-knowledge-base.js` | 决策知识库        |
| `src/main/ai-engine/cowork/skill-discoverer.js`        | 技能自动发现      |
| `src/main/ai-engine/cowork/prompt-optimizer.js`        | Prompt 自优化引擎 |
| `src/main/ai-engine/cowork/debate-review.js`           | 辩论式代码审查    |
| `src/main/ai-engine/cowork/ab-comparator.js`           | A/B 方案对比引擎  |

---

### 长期愿景 (2026 H2+)

| 方向                 | 目标                                 | 关键指标              |
| -------------------- | ------------------------------------ | --------------------- |
| **全自动开发流水线** | 从需求到部署全程 AI 代理协作         | 人工干预率 < 20%      |
| **自然语言编程**     | 用自然语言描述需求，代理团队自动实现 | 需求→代码转化率 > 80% |
| **去中心化代理网络** | 基于 DID 的代理身份认证和跨组织协作  | 支持 100+ 节点        |
| **多模态协作**       | 集成语音、视觉、文档等多模态输入输出 | 支持 5+ 模态          |
| **自主运维**         | 代理自动监控、诊断、修复生产环境问题 | MTTR < 5 分钟         |

### 路线图总览

| 版本   | 功能                   | 核心技术                      | 优先级     |
| ------ | ---------------------- | ----------------------------- | ---------- |
| v1.1.0 | 技能生态与工作流集成   | Pipeline、Vue Flow、Git Hooks | ⭐⭐⭐⭐⭐ |
| v1.2.0 | 专业化代理与智能调度   | ML 调度、能力学习、CI/CD      | ⭐⭐⭐⭐⭐ |
| v2.0.0 | 跨设备协作与分布式执行 | WebRTC P2P、SSO、REST API     | ⭐⭐⭐⭐   |
| v2.1.0 | 自进化与知识图谱       | 知识图谱、Prompt 优化         | ⭐⭐⭐     |

## 贡献指南

欢迎贡献代码和反馈问题！

- [GitHub Issues](https://github.com/chainlesschain/issues)
- [贡献指南](https://github.com/chainlesschain/CONTRIBUTING.md)

## 许可证

MIT License - 详见 [LICENSE](https://github.com/chainlesschain/LICENSE)

---

**代码行数**: ~13,000 行 (含测试和文档)
**IPC 处理器**: 51 个
**内置技能**: 90 个 (100% Handler 覆盖)
**测试用例**: 200+ (通过率 99.6%)
**维护者**: ChainlessChain Team
