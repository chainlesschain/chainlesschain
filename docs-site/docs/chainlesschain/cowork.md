# Cowork 多智能体协作系统

> **版本: v2.1.0 | 状态: ✅ 生产就绪 | 166 IPC Handlers | 95 内置技能 | ~90% 测试覆盖率**

ChainlessChain Cowork 是一个生产级的多智能体协作系统，基于 Claude Code 的 TeammateTool 设计模式实现。它为复杂任务提供智能的任务分配、并行执行和协同工作流能力，包含 13 核心操作、FileSandbox 安全沙箱、长时任务管理、Agent 池化、95 内置技能、技能流水线引擎、可视化工作流编辑器、Git Hooks 集成、Instinct 学习系统、Orchestrate 编排工作流、Verification Loop 验证流水线、**P2P 跨设备代理网络、设备能力发现、混合执行策略、Computer Use Bridge、RESTful API 服务、Webhook 事件推送**以及智能单/多代理决策引擎。

## 核心特性

- 🤖 **智能编排**: AI 驱动的单/多代理自动决策，三种场景模型
- 👥 **团队协作**: 13 核心操作（TeammateTool），支持投票、消息、检查点
- 🔒 **文件沙箱**: 20+ 敏感文件检测，路径遍历防护，细粒度权限
- ⏱️ **长时任务**: 检查点恢复、智能重试、进度跟踪、超时处理、增量检查点
- 🏊 **Agent 池化**: 能力池化、温复用、内存感知缩池、健康检查
- 🎯 **95 内置技能**: 四层加载、懒加载（启动提升 87%）、门控检查、热加载/热卸载
- 🔗 **技能流水线**: 5 种步骤类型（串联/并行/条件/循环/转换）、10 预置模板、变量传递
- 🎨 **可视化工作流**: Vue Flow 拖拽编辑器、8 种节点类型、DAG 拓扑排序执行
- 🪝 **Git Hooks 集成**: Pre-commit 智能检查、影响分析、CI 失败自动修复
- 🧠 **Instinct 学习**: 自动从会话中提取可复用模式，置信度强化/衰减，上下文感知检索
- 🎭 **Orchestrate 编排**: 4 种预置工作流模板，代理交接协议，结构化流水线执行
- ✅ **Verification Loop**: 6 阶段自动化验证流水线，READY/NOT READY 裁决
- 📊 **技能性能仪表板**: 执行指标采集、Token 消耗追踪、Top 技能排行、时间序列图表
- 📊 **分析仪表板**: ECharts 可视化、KPI 趋势、实时监控
- 🌐 **P2P 代理网络**: WebRTC DataChannel 跨设备代理通信，15 种消息协议
- 🔍 **设备能力发现**: 4 级能力分层，技能→设备索引，最优路由
- ⚡ **混合执行策略**: 6 种执行策略（local/remote/best-fit/load-balance），任务权重分类
- 🖥️ **Computer Use Bridge**: 12 个 AI 工具映射为技能，录制回放共享
- 🌍 **RESTful API**: 20+ 端点，SSE 实时推送，Bearer/API-Key 认证
- 🪝 **Webhook 事件**: 17 种事件类型，HMAC 签名，指数退避重试
- 🛡️ **完整审计**: 所有文件操作审计日志，数据库 + 文件系统双持久化
- 🕸️ **Code Knowledge Graph**: 代码实体/关系图谱，环形依赖检测，中心度分析，架构洞察注入
- 📚 **Decision Knowledge Base**: 决策历史积累，相似决策检索，最佳实践提取，投票/编排自动记录
- 🧬 **Prompt Optimizer**: Prompt 自优化，A/B 变体测试，SHA-256 哈希去重，成功率追踪
- 🔍 **Skill Discoverer**: 任务失败分析，Marketplace 技能自动发现与安装建议
- 🎭 **Debate Review**: 多视角辩论式代码审查（性能/安全/可维护性），共识投票裁决
- ⚖️ **A/B Comparator**: 多代理方案生成与基准对比，自动评分排名
- 🔄 **Experience Replay**: 工作流模板自动提取，成功路径沉淀为 Instinct 模式

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

Cowork 集成了 95 个内置技能，使用 SKILL.md 格式定义，支持四层加载和自动匹配。

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
│  1. Bundled 技能 (内置 95 个)              │
│     src/main/ai-engine/cowork/skills/      │
│     builtin/                               │
└───────────────────────────────────────────┘
```

### 技能分类（95 个内置技能）

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
                          │ IPC 通信（86 个处理器）
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
│  │         四层加载 | 懒加载 | 门控检查 | 热加载/热卸载           │  │
│  └────┬──────────────┬──────────────┬──────────────┬─────────┘  │
│       │              │              │              │              │
│  ┌────┴─────┐  ┌─────┴──────┐  ┌───┴──────────┐  ┌┴──────────┐ │
│  │Pipeline  │  │ Workflow   │  │ Metrics      │  │Git Hooks  │ │
│  │Engine    │  │ Engine     │  │ Collector    │  │Runner     │ │
│  │          │  │            │  │              │  │           │ │
│  │5步骤类型 │  │Vue Flow   │  │实时采集     │  │pre-commit │ │
│  │10个模板  │  │8节点类型  │  │时间序列     │  │影响分析   │ │
│  └──────────┘  └────────────┘  └──────────────┘  └───────────┘ │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │                   数据持久层                                 │  │
│  │    SQLite/SQLCipher (11 张表) + 文件系统 + 内存缓存          │  │
│  └────────────────────────────────────────────────────────────┘  │
│                          Electron Main Process                    │
└───────────────────────────────────────────────────────────────────┘
```

### 数据库 Schema

**11 张核心表**:

| 表名                         | 用途         | 关键字段                                                  |
| ---------------------------- | ------------ | --------------------------------------------------------- |
| `cowork_teams`               | 团队信息     | id, name, status, max_agents, metadata (JSON)             |
| `cowork_agents`              | 代理信息     | id, team_id, name, status, assigned_task                  |
| `cowork_tasks`               | 任务信息     | id, team_id, assigned_to, status, priority, result (JSON) |
| `cowork_messages`            | 消息记录     | id, team_id, from_agent, to_agent, message (JSON)         |
| `cowork_decisions`           | 投票记录     | id, team_id, decision_data (JSON), votes (JSON), passed   |
| `cowork_checkpoints`         | 检查点       | id, team_id, task_id, checkpoint_data (JSON)              |
| `cowork_sandbox_permissions` | 文件权限     | id, team_id, path, permission, expires_at, is_active      |
| `cowork_audit_log`           | 审计日志     | team_id, agent_id, operation, resource_path, success      |
| `cowork_metrics`             | 性能指标     | team_id, metric_name, metric_value, timestamp             |
| `skill_execution_metrics`    | 技能执行指标 | id, skill_id, pipeline_id, duration_ms, tokens, cost_usd  |
| `skill_pipeline_definitions` | 流水线定义   | id, name, category, definition_json, execution_count      |

**索引**:

- `cowork_teams`: status, created_at
- `cowork_agents`: team_id, status
- `cowork_tasks`: team_id, status, assigned_to
- `cowork_messages`: team_id, timestamp
- `cowork_audit_log`: team_id, agent_id, timestamp

## IPC 接口完整列表

Cowork 系统共提供 **97 个 IPC 处理器**，分为 12 大类：

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

### Pipeline 操作（12 个）— v1.1.0 新增

| 通道                     | 功能           |
| ------------------------ | -------------- |
| `pipeline:create`        | 创建流水线     |
| `pipeline:execute`       | 执行流水线     |
| `pipeline:get-status`    | 查询执行状态   |
| `pipeline:pause`         | 暂停流水线执行 |
| `pipeline:resume`        | 恢复流水线执行 |
| `pipeline:cancel`        | 取消流水线执行 |
| `pipeline:list`          | 列出所有流水线 |
| `pipeline:get`           | 获取流水线定义 |
| `pipeline:save`          | 保存流水线     |
| `pipeline:delete`        | 删除流水线     |
| `pipeline:get-templates` | 获取预置模板   |
| `pipeline:get-stats`     | 流水线统计     |

### Skill Metrics 操作（5 个）— v1.1.0 新增

| 通道                          | 功能           |
| ----------------------------- | -------------- |
| `skills:get-metrics`          | 获取技能指标   |
| `skills:get-pipeline-metrics` | 获取流水线指标 |
| `skills:get-top-skills`       | Top 技能排行   |
| `skills:get-time-series`      | 时间序列数据   |
| `skills:export-metrics`       | 导出全量指标   |

### Workflow 操作（10 个）— v1.1.0 新增

| 通道                       | 功能           |
| -------------------------- | -------------- |
| `workflow:create`          | 创建工作流     |
| `workflow:update`          | 更新工作流     |
| `workflow:execute`         | 执行工作流     |
| `workflow:get`             | 获取工作流     |
| `workflow:list`            | 列出所有工作流 |
| `workflow:delete`          | 删除工作流     |
| `workflow:save`            | 保存工作流     |
| `workflow:import-pipeline` | 从流水线导入   |
| `workflow:export-pipeline` | 导出为流水线   |
| `workflow:get-templates`   | 获取工作流模板 |

### Git Hooks 操作（8 个）— v1.1.0 新增

| 通道                       | 功能            |
| -------------------------- | --------------- |
| `git-hooks:run-pre-commit` | 执行 pre-commit |
| `git-hooks:run-impact`     | 影响范围分析    |
| `git-hooks:run-auto-fix`   | 自动修复        |
| `git-hooks:get-config`     | 获取配置        |
| `git-hooks:set-config`     | 更新配置        |
| `git-hooks:get-history`    | 获取执行历史    |
| `git-hooks:get-stats`      | 获取统计        |
| `git-hooks:install-hooks`  | 安装 Git Hooks  |

### Unified Tools 增强（2 个）— v1.1.0 新增

| 通道                    | 功能               |
| ----------------------- | ------------------ |
| `tools:execute-by-name` | 统一执行任意工具   |
| `tools:get-executors`   | 列出工具执行器信息 |

### Instinct Learning 操作（11 个）— v1.2.0 新增

| 通道                    | 功能                          |
| ----------------------- | ----------------------------- |
| `instinct:get-all`      | 获取所有 instinct（支持过滤） |
| `instinct:get-relevant` | 上下文感知检索相关 instinct   |
| `instinct:add`          | 手动添加 instinct             |
| `instinct:update`       | 更新 instinct 字段            |
| `instinct:delete`       | 删除 instinct                 |
| `instinct:reinforce`    | 强化置信度（成功使用时）      |
| `instinct:decay`        | 衰减置信度（失败/闲置时）     |
| `instinct:evolve`       | 触发模式进化（观测→提取）     |
| `instinct:export`       | 导出全部 instinct 为 JSON     |
| `instinct:import`       | 从 JSON 导入 instinct         |
| `instinct:get-stats`    | 获取 instinct 系统统计        |

### P2P Agent Network（9 个）— v2.0.0 新增

| 通道                          | 功能                 |
| ----------------------------- | -------------------- |
| `p2p-agent:get-remote-agents` | 获取远程代理列表     |
| `p2p-agent:find-for-skill`    | 按技能查找远程代理   |
| `p2p-agent:delegate-task`     | 委派任务到远程       |
| `p2p-agent:cancel-task`       | 取消远程任务         |
| `p2p-agent:query-skill`       | 广播查询远程技能     |
| `p2p-agent:invite-to-team`    | 邀请远程代理加入团队 |
| `p2p-agent:sync-team`         | 同步团队状态到远程   |
| `p2p-agent:announce`          | 广播本地设备在线     |
| `p2p-agent:get-stats`         | P2P 网络统计         |

### Device Discovery（5 个）— v2.0.0 新增

| 通道                        | 功能               |
| --------------------------- | ------------------ |
| `device:get-all`            | 获取所有设备       |
| `device:get-by-id`          | 获取指定设备详情   |
| `device:find-for-skill`     | 按技能查找最优设备 |
| `device:get-network-skills` | 全网络技能目录     |
| `device:get-stats`          | 设备发现统计       |

### Hybrid Executor（3 个）— v2.0.0 新增

| 通道                   | 功能             |
| ---------------------- | ---------------- |
| `hybrid:execute`       | 智能路由执行任务 |
| `hybrid:execute-batch` | 批量负载均衡执行 |
| `hybrid:get-stats`     | 执行器统计       |

### Computer Use Bridge（6 个）— v2.0.0 新增

| 通道                         | 功能             |
| ---------------------------- | ---------------- |
| `cu-bridge:execute`          | 执行 CU 工具     |
| `cu-bridge:share-recording`  | 共享录制         |
| `cu-bridge:list-recordings`  | 列出共享录制     |
| `cu-bridge:replay-recording` | 回放共享录制     |
| `cu-bridge:get-permissions`  | 获取代理 CU 权限 |
| `cu-bridge:get-stats`        | CU Bridge 统计   |

### Cowork API Server（4 个）— v2.0.0 新增

| 通道                       | 功能          |
| -------------------------- | ------------- |
| `cowork-api:start`         | 启动 API 服务 |
| `cowork-api:stop`          | 停止 API 服务 |
| `cowork-api:get-status`    | 获取服务状态  |
| `cowork-api:broadcast-sse` | 广播 SSE 事件 |

### Webhook Manager（7 个）— v2.0.0 新增

| 通道                       | 功能              |
| -------------------------- | ----------------- |
| `webhook:register`         | 注册 Webhook      |
| `webhook:unregister`       | 删除 Webhook      |
| `webhook:update`           | 更新 Webhook 配置 |
| `webhook:list`             | 列出所有 Webhook  |
| `webhook:dispatch`         | 手动派发事件      |
| `webhook:get-delivery-log` | 获取投递日志      |
| `webhook:get-stats`        | Webhook 统计      |

### Code Knowledge Graph（14 个）— v2.1.0 新增

| 通道                         | 功能                   |
| ---------------------------- | ---------------------- |
| `ckg:scan-workspace`         | 扫描工作区构建知识图谱 |
| `ckg:scan-file`              | 扫描单个文件           |
| `ckg:incremental-update`     | 增量更新               |
| `ckg:query-entity`           | 查询实体               |
| `ckg:get-relationships`      | 获取实体关系           |
| `ckg:get-dependency-tree`    | 获取模块依赖树         |
| `ckg:find-hotspots`          | 查找热点模块           |
| `ckg:find-circular-deps`     | 检测环形依赖           |
| `ckg:recommend-patterns`     | 推荐架构模式           |
| `ckg:build-context`          | 构建 KG 上下文         |
| `ckg:export-graph`           | 导出图谱数据           |
| `ckg:get-stats`              | 图谱统计               |
| `ckg:get-entity-types`       | 获取实体类型列表       |
| `ckg:get-relationship-types` | 获取关系类型列表       |

### Decision Knowledge Base（6 个）— v2.1.0 新增

| 通道                    | 功能             |
| ----------------------- | ---------------- |
| `dkb:record-decision`   | 记录决策         |
| `dkb:find-similar`      | 查找相似决策     |
| `dkb:get-history`       | 获取决策历史     |
| `dkb:get-best-practice` | 获取最佳实践     |
| `dkb:get-success-rates` | 按分类获取成功率 |
| `dkb:get-stats`         | 决策统计         |

### Prompt Optimizer（5 个）— v2.1.0 新增

| 通道                          | 功能             |
| ----------------------------- | ---------------- |
| `prompt-opt:record-execution` | 记录 Prompt 执行 |
| `prompt-opt:create-variant`   | 创建 Prompt 变体 |
| `prompt-opt:optimize`         | 分析优化建议     |
| `prompt-opt:compare-variants` | 对比两个变体     |
| `prompt-opt:get-stats`        | 优化器统计       |

### Skill Discoverer（4 个）— v2.1.0 新增

| 通道                         | 功能                   |
| ---------------------------- | ---------------------- |
| `skill-disc:analyze-failure` | 分析任务失败并发现技能 |
| `skill-disc:suggest-install` | 建议安装技能           |
| `skill-disc:get-history`     | 获取发现历史           |
| `skill-disc:get-stats`       | 发现统计               |

### Debate Review（3 个）— v2.1.0 新增

| 通道                 | 功能               |
| -------------------- | ------------------ |
| `debate:start`       | 启动辩论式代码审查 |
| `debate:get-history` | 获取审查历史       |
| `debate:get-stats`   | 辩论统计           |

### A/B Comparator（3 个）— v2.1.0 新增

| 通道             | 功能              |
| ---------------- | ----------------- |
| `ab:compare`     | 启动 A/B 方案对比 |
| `ab:get-history` | 获取对比历史      |
| `ab:get-stats`   | 对比统计          |

## Instinct Learning System — v1.2.0

Instinct 学习系统自动从用户会话中提取可复用模式（"本能"），通过 Hooks 观察存入永久记忆，并在未来会话中注入相关 instinct 上下文。灵感源自 everything-claude-code 的 instinct learning 模式。

### 核心概念

```
用户会话行为
    │
    ▼
┌──────────────────┐
│ Hook 观察器       │ ── 监听: PostToolUse, PreCompact 等事件
│ (observationBuffer)│     缓冲区: 50 条上限，1 分钟定期刷新
└────────┬─────────┘
         ▼
┌──────────────────┐
│ 观测数据库        │ ── instinct_observations 表
│ (SQLite)         │     字段: event_type, event_data, processed
└────────┬─────────┘
         ▼
┌──────────────────┐
│ 模式进化引擎      │ ── 按事件类型分组，提取重复模式
│ (evolveInstincts) │     工具偏好、错误模式、工作流序列
└────────┬─────────┘
         ▼
┌──────────────────┐
│ Instinct 缓存     │ ── 内存中 Map，DB 持久化
│ (instinctCache)   │     字段: pattern, confidence, category
└────────┬─────────┘
         ▼
┌──────────────────┐
│ 上下文注入        │ ── ContextEngineering 自动注入到 LLM Prompt
│ (buildInstinctContext)│  置信度 ≥ 0.3 的 instinct 按相关度排序
└──────────────────┘
```

### Instinct 分类

| 分类            | 标识              | 说明               |
| --------------- | ----------------- | ------------------ |
| Coding Pattern  | `coding-pattern`  | 编码习惯和代码模式 |
| Tool Preference | `tool-preference` | 工具使用偏好       |
| Workflow        | `workflow`        | 工作流和工具序列   |
| Error Fix       | `error-fix`       | 错误修复模式       |
| Style           | `style`           | 代码风格偏好       |
| Architecture    | `architecture`    | 架构决策模式       |
| Testing         | `testing`         | 测试策略和模式     |
| General         | `general`         | 通用模式           |

### 置信度系统

```
置信度范围: [0.1, 0.95]    默认: 0.5

强化 (reinforce):
  newConfidence = min(0.95, current + 0.05 × (1 - current))
  使用次数 +1, 更新 lastUsed

衰减 (decay):
  newConfidence = max(0.1, current × 0.9)

检索过滤: 仅 confidence ≥ 0.3 的 instinct 参与上下文匹配
```

### 模式进化

`evolveInstincts()` 从未处理的观测中提取三类模式：

| 模式类型     | 提取条件            | 初始置信度         |
| ------------ | ------------------- | ------------------ |
| 工具使用频率 | 同一工具使用 ≥ 3 次 | 0.3 + count × 0.05 |
| 工具序列     | 连续 ≥ 3 个工具调用 | 0.35               |
| 重复错误     | 同类错误出现 ≥ 2 次 | 0.3 + count × 0.10 |

### 上下文注入

InstinctManager 通过 `ContextEngineering.setInstinctManager()` 注入，在 KV-Cache 优化 Prompt 构建时自动添加已学习模式：

```javascript
// ContextEngineering 第 4.5 步：注入 Instinct 上下文
const instinctContext = instinctManager.buildInstinctContext(contextHint, 5);
// 输出示例:
// ## Learned Patterns (Instincts)
// - [tool-preference] (confidence: 0.72) User frequently uses tool "file_reader"
// - [workflow] (confidence: 0.35) Common tool sequence: file_reader → code_analyzer → file_writer
```

### 数据库 Schema

```sql
CREATE TABLE instincts (
  id TEXT PRIMARY KEY,
  pattern TEXT NOT NULL,
  confidence REAL DEFAULT 0.5,
  category TEXT DEFAULT 'general',
  examples TEXT DEFAULT '[]',
  source TEXT DEFAULT 'auto',       -- auto | manual | import
  use_count INTEGER DEFAULT 0,
  last_used TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE instinct_observations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,          -- PostToolUse, IPCError, SessionEnd 等
  event_data TEXT DEFAULT '{}',
  processed INTEGER DEFAULT 0,
  created_at TEXT
);
```

### 关键文件

| 文件                                  | 行数   | 职责                      |
| ------------------------------------- | ------ | ------------------------- |
| `src/main/llm/instinct-manager.js`    | ~1,100 | Instinct 管理核心         |
| `src/main/llm/instinct-ipc.js`        | ~280   | 11 个 IPC Handler         |
| `src/main/llm/context-engineering.js` | +35    | Instinct 上下文注入集成   |
| `src/main/database.js`                | +30    | instincts/observations 表 |
| `src/main/ipc/ipc-registry.js`        | +44    | Phase 17 注册             |

## Orchestrate Workflow — v1.2.0

多代理工作流编排技能，提供 4 种预置工作流模板，每个模板包含有序的代理链和结构化交接协议。灵感源自 everything-claude-code 的 orchestrate 模式。

### 工作流模板

| 模板             | 代理链                                                       | 用途         |
| ---------------- | ------------------------------------------------------------ | ------------ |
| `feature`        | planner → architect → coder → reviewer → verification        | 新功能开发   |
| `bugfix`         | debugger → coder → tester → verification                     | Bug 诊断修复 |
| `refactor`       | architect → coder → reviewer → verification                  | 代码重构     |
| `security-audit` | security-reviewer → coder → security-verifier → verification | 安全审计修复 |

### 使用方式

```bash
/orchestrate feature "add user profile page"
/orchestrate bugfix "login fails with special characters"
/orchestrate refactor "extract auth module"
/orchestrate security-audit "review API endpoints"
```

### 代理交接协议

每个代理完成后生成结构化交接文档，传递给下一个代理：

```json
{
  "agent": "planner",
  "agentType": "document",
  "status": "complete",
  "deliverables": ["requirements.md", "acceptance-criteria.md"],
  "decisions": ["Use Vue 3 composables", "Add Pinia store"],
  "concerns": ["Performance impact on large datasets"],
  "nextAgentInstructions": "Implement based on requirements..."
}
```

### 执行模式

```
1. AgentCoordinator 可用 → 通过 coordinator.orchestrate() 真实代理执行
2. AgentCoordinator 不可用 → 结构化模拟输出（标注代理角色和预期行为）
3. 最终阶段 → 自动调用 verification-loop handler 执行验证
```

### 裁决等级

| 裁决           | 条件                           |
| -------------- | ------------------------------ |
| **SHIP**       | 所有代理成功且验证通过         |
| **NEEDS WORK** | 代理标记了 concerns 或验证失败 |
| **BLOCKED**    | 非验证阶段发生关键失败         |

### 关键文件

| 文件                                                              | 行数 | 职责         |
| ----------------------------------------------------------------- | ---- | ------------ |
| `src/main/ai-engine/cowork/skills/builtin/orchestrate/SKILL.md`   | ~112 | 技能定义     |
| `src/main/ai-engine/cowork/skills/builtin/orchestrate/handler.js` | ~507 | 编排引擎实现 |

## Verification Loop — v1.2.0

6 阶段自动化验证流水线，产出 READY / NOT READY 裁决。自动检测项目类型（Node.js / TypeScript / Python / Java）并适配对应的构建、检查、测试命令。

### 验证阶段

| 阶段       | 功能                     | 工具 / 命令                                  |
| ---------- | ------------------------ | -------------------------------------------- |
| Build      | 编译 / 打包项目          | `npm run build` / `mvn compile`              |
| TypeCheck  | 静态类型检查             | `tsc --noEmit` / `mypy`                      |
| Lint       | 代码风格检查             | `eslint` / `flake8`                          |
| Test       | 执行测试套件             | `vitest` / `jest` / `pytest`                 |
| Security   | 安全扫描                 | 委托 `security-audit` handler                |
| DiffReview | AI 审查未提交的 git diff | 检测 console.log、debugger、TODO、硬编码凭据 |

### 使用方式

```bash
/verification-loop                           # 全部 6 阶段
/verification-loop src/ --skip typecheck     # 跳过类型检查
/verification-loop --stages build,test,security  # 仅指定阶段
/verification-loop --verbose                 # 显示详细输出
```

### 项目类型检测

```
package.json 存在？
  ├── 是 → tsconfig.json 或 typescript 依赖？
  │       ├── 是 → TypeScript
  │       └── 否 → Node.js
  ├── pom.xml / build.gradle？
  │       └── 是 → Java
  └── pyproject.toml / setup.py / requirements.txt？
          └── 是 → Python
```

### DiffReview 检测规则

| 检测项          | 正则 / 逻辑                                              |
| --------------- | -------------------------------------------------------- |
| console.log     | `/console\.log\s*\(/`                                    |
| debugger 语句   | `/debugger\b/`                                           |
| TODO/FIXME 注释 | `/TODO\|FIXME\|HACK\|XXX/`                               |
| 硬编码凭据      | `/(?:password\|secret\|token)\s*[:=]\s*['"][^'"]+['"]/i` |

### 输出示例

```
Verification Loop Report
========================
Project: desktop-app-vue (typescript)

| Stage      | Status | Duration | Details          |
| ---------- | ------ | -------- | ---------------- |
| build      | PASS   | 12.3s    | Clean build      |
| typecheck  | PASS   | 4.1s     | 0 type errors    |
| lint       | PASS   | 2.8s     | 0 lint issues    |
| test       | PASS   | 8.5s     | 157 tests passed |
| security   | PASS   | 1.2s     | 0 findings       |
| diffreview | PASS   | 0.3s     | 5 file(s) changed, no issues |

Stages: 6 passed, 0 failed, 0 skipped (6 active)
Duration: 29.2s

Verdict: READY
```

### 关键文件

| 文件                                                                    | 行数 | 职责         |
| ----------------------------------------------------------------------- | ---- | ------------ |
| `src/main/ai-engine/cowork/skills/builtin/verification-loop/SKILL.md`   | ~118 | 技能定义     |
| `src/main/ai-engine/cowork/skills/builtin/verification-loop/handler.js` | ~547 | 验证引擎实现 |

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
✅ teammate-tool.test.js              - 50+ 测试用例 (团队/代理/任务/消息/投票)
✅ file-sandbox.test.js               - 40+ 测试用例 (权限/路径/敏感文件/审计)
✅ long-running-task.test.js          - 35+ 测试用例 (生命周期/检查点/重试)
✅ agent-pool.test.js                 - 30+ 测试用例 (获取/释放/超时/事件)
✅ skills.test.js                     - 50+ 测试用例 (加载/匹配/执行/门控)
```

**v1.1.0 新增测试**:

```
✅ skill-pipeline-engine.test.js      - 64KB (创建/执行/暂停/恢复/取消/变量/事件)
✅ skill-metrics-collector.test.js    - 81 测试用例 (采集/聚合/查询/SQLite刷新/事件)
✅ skill-lazy-load.test.js            - 48 测试用例 (懒加载/热加载/热卸载/事件)
✅ git-hook-runner.test.js            - 65 测试用例 (pre-commit/impact/auto-fix/事件)
✅ skill-pipeline-e2e.test.js         - 44 测试用例 (模板→流水线→执行→指标端到端)
```

**总覆盖率**: ~90%，440+ 测试用例，99.6% 通过率

### E2E 测试

- ✅ 团队创建、暂停、恢复和解散完整流程
- ✅ 任务分配、执行和结果合并流程
- ✅ 投票决策和共识达成流程
- ✅ 文件权限申请、授权和撤销流程
- ✅ 敏感文件检测和路径遍历防护
- ✅ 长时任务检查点创建和恢复
- ✅ 代理池获取、释放和超时处理
- ✅ 技能加载、匹配和执行流程
- ✅ 流水线模板创建、执行和变量传递（v1.1.0）
- ✅ 并行步骤执行和条件分支（v1.1.0）
- ✅ 指标采集和导出（v1.1.0）
- ✅ 懒加载和热加载/卸载（v1.1.0）
- ✅ Git Hooks pre-commit/impact/auto-fix（v1.1.0）

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

### v1.0.0 核心文件

| 文件                                                     | 职责                         | 行数   |
| -------------------------------------------------------- | ---------------------------- | ------ |
| `src/main/ai-engine/cowork/teammate-tool.js`             | 13 核心操作引擎              | ~1,700 |
| `src/main/ai-engine/cowork/file-sandbox.js`              | 文件沙箱安全系统             | ~830   |
| `src/main/ai-engine/cowork/long-running-task-manager.js` | 长时任务 + 增量检查点        | ~1,300 |
| `src/main/ai-engine/cowork/agent-pool.js`                | 能力池化 + 内存感知          | ~630   |
| `src/main/ai-engine/cowork/cowork-ipc.js`                | 51 IPC 处理器                | ~650   |
| `src/main/ai-engine/cowork/skills/index.js`              | Skills 模块入口              | ~70    |
| `src/main/ai-engine/cowork/skills/skills-ipc.js`         | Skills IPC (17 处理器)       | ~400   |
| `src/main/ai-engine/cowork/skills/skill-md-parser.js`    | SKILL.md 解析器 + 懒加载     | ~400   |
| `src/main/ai-engine/cowork/skills/markdown-skill.js`     | 技能实例 + ensureFullyLoaded | ~260   |
| `src/main/ai-engine/cowork/skills/skill-loader.js`       | 四层加载 + loadSingleSkill   | ~360   |
| `src/main/ai-engine/cowork/skills/skill-registry.js`     | 注册表 + 热加载/卸载         | ~200   |
| `src/main/ai-engine/cowork/skills/builtin/`              | 90 内置技能 Handler          | ~3,000 |
| `src/renderer/pages/CoworkDashboard.vue`                 | 仪表板页面                   | ~638   |
| `src/renderer/pages/CoworkAnalytics.vue`                 | 分析页面                     | ~1,080 |
| `src/renderer/stores/cowork.ts`                          | Pinia 状态管理               | ~1,410 |

### v1.1.0 新增文件

| 文件                                                          | 职责                        | 行数 |
| ------------------------------------------------------------- | --------------------------- | ---- |
| `src/main/ai-engine/cowork/skills/skill-pipeline-engine.js`   | 流水线引擎（5 种步骤类型）  | ~580 |
| `src/main/ai-engine/cowork/skills/pipeline-templates.js`      | 10 预置流水线模板           | ~470 |
| `src/main/ai-engine/cowork/skills/skill-metrics-collector.js` | 技能指标采集器              | ~320 |
| `src/main/ai-engine/cowork/skills/skill-pipeline-ipc.js`      | Pipeline IPC（12 handlers） | ~180 |
| `src/main/ai-engine/cowork/skills/skill-metrics-ipc.js`       | Metrics IPC（5 handlers）   | ~90  |
| `src/main/ai-engine/cowork/skills/skill-workflow-engine.js`   | 可视化工作流引擎            | ~350 |
| `src/main/ai-engine/cowork/skills/skill-workflow-ipc.js`      | Workflow IPC（10 handlers） | ~150 |
| `src/main/hooks/git-hook-runner.js`                           | Git Hook 运行器             | ~300 |
| `src/main/hooks/git-hook-ipc.js`                              | Git Hook IPC（8 handlers）  | ~130 |
| `src/renderer/pages/SkillPipelinePage.vue`                    | 流水线编排页                | ~163 |
| `src/renderer/pages/WorkflowDesignerPage.vue`                 | 工作流设计器                | ~209 |
| `src/renderer/pages/SkillPerformancePage.vue`                 | 技能性能仪表板              | ~122 |
| `src/renderer/pages/GitHooksPage.vue`                         | Git Hooks 管理页            | ~147 |
| `src/renderer/stores/skill-pipeline.ts`                       | 流水线 Pinia Store          | —    |
| `src/renderer/stores/skill-metrics.ts`                        | 指标 Pinia Store            | —    |
| `src/renderer/stores/workflow-designer.ts`                    | 工作流设计器 Store          | ~284 |
| `src/renderer/stores/git-hooks.ts`                            | Git Hooks Store             | —    |

### v1.2.0 新增文件

| 文件                                                                    | 职责                        | 行数   |
| ----------------------------------------------------------------------- | --------------------------- | ------ |
| `src/main/llm/instinct-manager.js`                                      | Instinct 学习核心引擎       | ~1,100 |
| `src/main/llm/instinct-ipc.js`                                          | Instinct IPC（11 handlers） | ~280   |
| `src/main/ai-engine/cowork/skills/builtin/orchestrate/SKILL.md`         | Orchestrate 技能定义        | ~112   |
| `src/main/ai-engine/cowork/skills/builtin/orchestrate/handler.js`       | Orchestrate 编排引擎        | ~507   |
| `src/main/ai-engine/cowork/skills/builtin/verification-loop/SKILL.md`   | Verification Loop 技能定义  | ~118   |
| `src/main/ai-engine/cowork/skills/builtin/verification-loop/handler.js` | Verification Loop 验证引擎  | ~547   |

### v2.0.0 新增文件

| 文件                                               | 职责                          | 行数 |
| -------------------------------------------------- | ----------------------------- | ---- |
| `src/main/ai-engine/cowork/p2p-agent-network.js`   | P2P 代理网络（15 种消息类型） | ~680 |
| `src/main/ai-engine/cowork/device-discovery.js`    | 设备能力发现（4 级分层）      | ~420 |
| `src/main/ai-engine/cowork/hybrid-executor.js`     | 混合执行策略（6 种策略）      | ~510 |
| `src/main/ai-engine/cowork/computer-use-bridge.js` | Computer Use 集成（12 工具）  | ~430 |
| `src/main/ai-engine/cowork/cowork-api-server.js`   | RESTful API 服务（20+ 端点）  | ~520 |
| `src/main/ai-engine/cowork/webhook-manager.js`     | Webhook 事件推送（17 事件）   | ~530 |
| `src/main/ai-engine/cowork/cowork-v2-ipc.js`       | 34 个 IPC Handler             | ~420 |

## 前端路由（v1.1.0 新增）

| 路由                   | 页面                     | 说明           |
| ---------------------- | ------------------------ | -------------- |
| `#/cowork/pipeline`    | SkillPipelinePage.vue    | 流水线编排     |
| `#/cowork/workflow`    | WorkflowDesignerPage.vue | 工作流设计器   |
| `#/cowork/performance` | SkillPerformancePage.vue | 技能性能仪表板 |
| `#/cowork/git-hooks`   | GitHooksPage.vue         | Git Hooks 管理 |

## npm 新依赖（v1.1.0）

```
@vue-flow/core @vue-flow/background @vue-flow/controls @vue-flow/minimap
```

## 相关文档

- [快速入门指南 →](/guide/cowork-quick-start)
- [Skills 技能系统 →](/chainlesschain/skills)
- [Computer Use →](/chainlesschain/computer-use)
- [权限系统 →](/chainlesschain/permissions)
- [Hooks 系统 →](/chainlesschain/hooks)
- [Plan Mode →](/chainlesschain/plan-mode)
- [Session Manager →](/chainlesschain/session-manager)

## v1.1.0 新增功能

### 技能懒加载（启动提升 87%）

v1.1.0 引入 metadata-only 解析策略，90 技能启动时间从 ~360ms 降至 ~45ms：

```
启动加载流程:
  parseMetadataOnly() ── 只读 YAML frontmatter，跳过 Markdown body
       ↓
  创建 SkillDefinitionStub (_isStub: true, _bodyLoaded: false)
       ↓
  注册到 SkillRegistry（轻量元数据）
       ↓
  首次使用时 ensureFullyLoaded() 完整解析 body + handler
```

**热加载/热卸载**: 支持运行时动态注册和移除技能

```javascript
// 热加载新技能
await skillRegistry.hotLoadSkill("my-skill", definition);
// 事件: skill-hot-loaded

// 热卸载技能
await skillRegistry.hotUnloadSkill("my-skill");
// 事件: skill-hot-unloaded
```

**Marketplace 自动热加载**: 安装插件时，如果包含 `SKILL.md`，自动调用 `loadSingleSkill()` + `hotLoadSkill()` 注册到 SkillRegistry 并刷新 UnifiedToolRegistry。

### 技能流水线引擎（Skill Pipeline Engine）

流水线引擎支持多技能编排，提供 5 种步骤类型和变量传递机制：

#### 步骤类型

| 类型        | 说明                                          |
| ----------- | --------------------------------------------- |
| `SKILL`     | 执行单个技能，输入映射 → 输出变量             |
| `CONDITION` | 基于表达式分支（true/false 输出口）           |
| `PARALLEL`  | 并行执行多个技能，`Promise.allSettled()` 合并 |
| `TRANSFORM` | JavaScript 表达式进行数据转换                 |
| `LOOP`      | 遍历数组输出，逐项执行子步骤                  |

#### Pipeline 执行模式

```
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

条件分支 (Condition):
┌──────────┐   ┌──────────────┐   ┌──────true──→ 发布
│ 代码审查  │──→│ 测试通过?     │──→│
└──────────┘   └──────────────┘   └──────false──→ 修复
```

#### 变量传递

步骤间通过 `${stepName.result.field}` 模板引用传递数据：

```javascript
const pipeline = engine.createPipeline({
  name: "data-report",
  steps: [
    {
      id: "fetch",
      type: "SKILL",
      skillId: "web-scraping",
      outputVariable: "fetch",
    },
    {
      id: "analyze",
      type: "SKILL",
      skillId: "data-analysis",
      inputMapping: { data: "${fetch.result.content}" },
      outputVariable: "analyze",
    },
    {
      id: "check",
      type: "CONDITION",
      expression: "${analyze.result.count} >= 10",
      trueBranch: "report",
      falseBranch: null,
    },
    {
      id: "report",
      type: "SKILL",
      skillId: "doc-generator",
      inputMapping: { summary: "${analyze.result.summary}" },
    },
  ],
});

const result = await engine.executePipeline(pipeline.id, {
  url: "https://...",
});
```

#### 执行控制

```javascript
// 暂停
await engine.pausePipeline(executionId);
// 恢复
await engine.resumePipeline(executionId);
// 取消
await engine.cancelPipeline(executionId);
// 查询状态
const status = engine.getPipelineStatus(executionId);
// { state: 'RUNNING', currentStep: 2, totalSteps: 4, startedAt: ..., results: [...] }
```

#### 事件

| 事件                      | 触发时机   |
| ------------------------- | ---------- |
| `pipeline:created`        | 流水线创建 |
| `pipeline:started`        | 开始执行   |
| `pipeline:step-started`   | 步骤开始   |
| `pipeline:step-completed` | 步骤完成   |
| `pipeline:step-failed`    | 步骤失败   |
| `pipeline:completed`      | 流水线完成 |
| `pipeline:failed`         | 流水线失败 |
| `pipeline:paused`         | 流水线暂停 |

### 10 预置流水线模板

| #   | 模板名           | 技能串联                                                                 | 分类        |
| --- | ---------------- | ------------------------------------------------------------------------ | ----------- |
| 1   | data-report      | web-scraping → data-analysis → chart-creator → doc-generator             | data        |
| 2   | code-review      | code-review → security-audit → lint-and-fix → doc-generator              | development |
| 3   | release          | test-generator → test-and-fix → changelog-generator → release-manager    | development |
| 4   | research         | web-scraping → data-analysis → knowledge-graph → doc-generator           | knowledge   |
| 5   | onboarding       | repo-map → dependency-analyzer → onboard-project → doc-generator         | development |
| 6   | security-audit   | security-audit → vulnerability-scanner → impact-analyzer → doc-generator | security    |
| 7   | i18n             | i18n-manager → code-translator → doc-generator                           | development |
| 8   | media-processing | audio-transcriber → subtitle-generator → doc-converter                   | media       |
| 9   | performance      | performance-optimizer → log-analyzer → chart-creator                     | devops      |
| 10  | data-migration   | db-migration → data-exporter → backup-manager                            | devops      |

```javascript
// 获取所有模板
const templates = getTemplates();
// 按分类筛选
const devTemplates = getTemplatesByCategory("development"); // 4 个
// 从模板创建流水线
const pipeline = engine.createPipeline(getTemplateById("tpl-code-review"));
```

### 技能指标采集器（Skill Metrics Collector）

实时采集技能和流水线执行指标，支持仪表板可视化：

```javascript
// 查询单技能指标
const metrics = collector.getSkillMetrics("code-review");
// { executions: 42, successRate: 0.95, avgDuration: 2300, totalTokens: 15000, totalCost: 0.45 }

// Top 技能排行
const top = collector.getTopSkills(5, "executions");
// [{ skillId: 'code-review', executions: 42, ... }, ...]

// 时间序列（图表数据）
const series = collector.getTimeSeriesData("code-review", "day");
// [{ timestamp: ..., executions: 5, avgDuration: 2100, successRate: 1.0 }, ...]

// 导出全量指标
const exported = collector.exportMetrics();
```

**存储**: 内存 Map + 定期刷入 SQLite（`skill_execution_metrics` 表），60 秒刷新间隔。

### Git Hooks 集成

GitHookRunner 将技能流水线与 Git 工作流打通：

#### Pre-commit 智能检查

```javascript
const result = await runner.runPreCommit([
  "src/main/index.js",
  "src/utils/helper.js",
]);
// {
//   passed: true,
//   duration: 45000,
//   steps: [
//     { skill: 'lint-and-fix', issues: [...], fixes: [...] },
//     { skill: 'code-review', issues: [...] },
//     { skill: 'security-audit', issues: [...] },
//   ],
//   issues: [...],      // 所有问题汇总
//   autoFixes: [...],   // 自动修复列表
//   blocking: false,    // 是否阻止提交
// }
```

#### 影响范围分析

```javascript
const impact = await runner.runImpactAnalysis(["src/main/database.js"]);
// {
//   affectedFiles: ['src/main/index.js', 'tests/db.test.js', ...],
//   suggestedTests: ['tests/db.test.js', 'tests/integration/...'],
//   riskScore: 7.5,
//   duration: 12000,
// }
```

#### CI 失败自动修复

```javascript
const fix = await runner.runAutoFix([
  "test-login-flow",
  "test-auth-middleware",
]);
// {
//   fixed: ['test-login-flow'],
//   remaining: ['test-auth-middleware'],
//   patchFiles: ['patches/fix-login.patch'],
//   duration: 30000,
// }
```

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

**Hook 事件**: 新增 `PreGitCommit`、`PostGitCommit`、`PreGitPush`、`CIFailure` 4 个事件到 HookRegistry。

### 可视化工作流编辑器

基于 Vue Flow 的拖拽式工作流设计器，支持 8 种节点类型：

#### 节点类型

| 节点类型         | 说明             | 对应 Pipeline 步骤 |
| ---------------- | ---------------- | ------------------ |
| `START_NODE`     | 流程起始         | —                  |
| `END_NODE`       | 流程结束         | —                  |
| `SKILL_NODE`     | 技能执行节点     | SKILL              |
| `CONDITION_NODE` | 条件分支（菱形） | CONDITION          |
| `PARALLEL_NODE`  | 并行 Fork/Join   | PARALLEL           |
| `LOOP_NODE`      | 循环迭代         | LOOP               |
| `TRANSFORM_NODE` | 数据转换         | TRANSFORM          |
| `MERGE_NODE`     | 结果合并         | —                  |

#### Pipeline 互转

```javascript
// Pipeline → Workflow（自动生成节点位置）
const workflow = engine.importFromPipeline(pipelineId);

// Workflow → Pipeline（拓扑排序生成步骤顺序）
const pipeline = engine.exportToPipeline(workflowId);
```

#### 工作流执行

```javascript
// 委托 SkillPipelineEngine 执行
const result = await engine.executeWorkflow(workflowId, { input: "data" });
```

**前端页面**: `#/cowork/workflow` — WorkflowDesignerPage.vue，三栏布局（技能面板 + 画布 + 属性面板 + 调试面板）

### UnifiedToolRegistry 增强（v1.1.0）

- **事件驱动刷新**: 监听 SkillRegistry 的 `skill-registered`、`skill-unregistered`、`skill-hot-loaded`、`skill-hot-unloaded` 事件，自动刷新工具列表
- **统一执行 API**: `executeToolByName(toolName, params, context)` — 路由到 FunctionCaller/MCP/SkillRegistry
- **执行器查询**: `getToolExecutor(toolName)` — 返回绑定执行器函数
- **新增 2 IPC**: `tools:execute-by-name`、`tools:get-executors`（总计 8 handlers）

### Agent 池化增强（v1.1.0）

- **能力池化**: `_pools: Map<agentType, Agent[]>` 按类型分池，`acquireByCapabilities(capabilities)` 匹配
- **温复用**: `_warmResetAgent(agent)` 重置状态保留连接（冷启动 ~2s → ~200ms）
- **内存感知**: 监控 `process.memoryUsage().heapUsed`，超阈值自动缩池
- **健康检查**: 60s 周期探活，自动移除无响应 agent

```javascript
const stats = agentPool.getPoolStats();
// {
//   pools: { 'CodeSecurity': { total: 3, available: 2, busy: 1 }, ... },
//   memory: { heapUsed: 150MB, heapTotal: 256MB, heapRatio: 0.59, rss: 320MB },
// }
```

### 增量检查点（v1.1.0）

任务 > 5 分钟默认启用增量模式，全量 ~50-100KB/次 → 增量 ~2-10KB/次（节省 60-80%）：

```javascript
const checkpoint = new IncrementalCheckpoint();

// 创建基线（全量快照）
checkpoint.createBaseline(state);

// 创建增量（只保存 JSON diff）
checkpoint.createDelta(currentState);
// { type: 'delta', size: 1234, changes: 5 }

// 恢复（基线 + 累加 delta）
const restored = checkpoint.restore(checkpointId);

// 压缩（合并旧 delta 为新基线）
checkpoint.compact(currentState);
```

## 未来规划

---

### v1.2.0 — 专业化代理与智能调度 ✅

**目标**: Instinct 学习系统 + Orchestrate 编排工作流 + Verification Loop 验证流水线

#### 已完成

- [x] **Instinct Learning System** — 自动从 Hook 观测中提取可复用模式，置信度强化/衰减，上下文感知检索，LLM Prompt 自动注入（11 IPC handlers, ~1,380 行）
- [x] **Orchestrate Workflow Skill** — 4 种预置工作流模板（feature/bugfix/refactor/security-audit），代理交接协议，AgentCoordinator 集成（~620 行）
- [x] **Verification Loop Skill** — 6 阶段自动化验证流水线（Build → TypeCheck → Lint → Test → Security → DiffReview），项目类型自动检测，READY/NOT READY 裁决（~665 行）
- [x] **Context Engineering 集成** — InstinctManager 注入 ContextEngineering，自动在 KV-Cache Prompt 中添加已学习模式
- [x] **数据库 Schema** — instincts + instinct_observations 表，含索引
- [x] **IPC Registry Phase 17** — Instinct Learning System 11 个 IPC handler 注册

#### 代理能力画像（已实现基础版 — Instinct 驱动）

```
Instinct 驱动的能力画像:

  Instinct Cache (示例):
  ┌────────────────────────────────────────────┐
  │ [tool-preference] confidence: 0.72         │
  │   "User frequently uses file_reader"       │
  │                                            │
  │ [workflow] confidence: 0.35                │
  │   "Sequence: file_reader → analyzer → writer" │
  │                                            │
  │ [error-fix] confidence: 0.60               │
  │   "Recurring error: ENOENT on config path" │
  │                                            │
  │ [coding-pattern] confidence: 0.55          │
  │   "Prefers async/await over callbacks"     │
  │                                            │
  │ 进化: 自动从 PostToolUse 事件提取          │
  │ 注入: ContextEngineering 第 4.5 步         │
  └────────────────────────────────────────────┘
```

#### v1.3.0 — ML 调度、负载均衡、CI/CD 优化、API 文档

- [x] **ML 驱动的任务调度** — 基于历史数据训练轻量模型，预测任务复杂度和资源需求 → `ml-task-scheduler.js` (8 IPC handlers)
- [x] **动态负载均衡** — 实时监控代理负载，自动迁移任务到空闲代理 → `load-balancer.js` (8 IPC handlers)
- [x] **CI/CD 深度优化** — 智能测试选择（70%+ 缓存命中率）、增量构建编排 → `cicd-optimizer.js` (10 IPC handlers)
- [x] **API 文档自动生成** — 扫描 IPC handlers 和函数签名，生成 OpenAPI/Swagger 文档 → `ipc-api-doc-generator.js` (6 IPC handlers)

##### ML 驱动的任务调度

MLTaskScheduler 使用加权线性回归模型（无外部 ML 依赖）预测任务复杂度：

- **特征提取**: 词数、关键词密度、子任务数、优先级权重、任务类型基准
- **在线学习**: 任务完成后通过指数移动平均 (EMA) 更新权重
- **复杂度预测**: 1-10 分制，附带置信度评估
- **资源估算**: 根据复杂度推荐代理数量、Token 预算、预估耗时
- **批量再训练**: 支持从数据库历史数据全量重新训练

```javascript
// 预测任务复杂度
const result = await window.electron.ipcRenderer.invoke(
  "ml-scheduler:predict-complexity",
  "重构认证模块，支持 OAuth2.0 + PKCE 流程",
  { priority: "high", type: "refactoring" },
);
// result.data = { complexity: 7.2, confidence: 0.68, estimatedDurationMs: 129600, ... }

// 预测资源需求
const resources = await window.electron.ipcRenderer.invoke(
  "ml-scheduler:predict-resources",
  7.2,
  "refactoring",
);
// resources.data = { agentCount: 3, tokenBudget: 15000, tier: 4, ... }
```

| IPC Channel                           | 功能               |
| ------------------------------------- | ------------------ |
| `ml-scheduler:predict-complexity`     | 预测任务复杂度     |
| `ml-scheduler:predict-resources`      | 预测资源需求       |
| `ml-scheduler:get-model-stats`        | 模型准确率、样本量 |
| `ml-scheduler:retrain`                | 强制批量再训练     |
| `ml-scheduler:get-history`            | 历史预测 vs 实际   |
| `ml-scheduler:get-feature-importance` | 特征权重排名       |
| `ml-scheduler:configure`              | 更新调度器配置     |
| `ml-scheduler:get-config`             | 获取当前配置       |

##### 动态负载均衡

LoadBalancer 实时监控每个代理的负载指标，自动建议任务迁移：

- **复合负载评分**: `0.4*taskLoad + 0.3*queueDepth + 0.2*errorRate + 0.1*responseTime`
- **健康监控**: 30s 心跳检查，自动标记无响应代理
- **自动重平衡**: 当代理负载超过阈值 (0.8) 时建议迁移
- **负载卸载**: 系统整体负载 > 90% 时拒绝新任务

```javascript
// 获取系统负载
const load = await window.electron.ipcRenderer.invoke(
  "load-balancer:get-system-load",
);
// load.data = { agents: [...], avgLoad: 0.45, maxLoad: 0.72, loadSheddingActive: false }

// 建议最佳代理
const suggestion = await window.electron.ipcRenderer.invoke(
  "load-balancer:suggest-assignment",
  { type: "code-review", priority: "high" },
);
// suggestion.data = { agentId: "agent-3", loadScore: 0.21, reason: "Least loaded agent" }
```

| IPC Channel                        | 功能                 |
| ---------------------------------- | -------------------- |
| `load-balancer:get-metrics`        | 所有代理负载指标     |
| `load-balancer:get-agent-load`     | 单个代理负载         |
| `load-balancer:get-system-load`    | 系统负载摘要         |
| `load-balancer:suggest-assignment` | 推荐最优代理         |
| `load-balancer:migrate-task`       | 迁移任务到其他代理   |
| `load-balancer:set-threshold`      | 配置负载阈值         |
| `load-balancer:get-history`        | 负载历史（图表数据） |
| `load-balancer:get-config`         | 获取均衡器配置       |

##### CI/CD 深度优化

CICDOptimizer 通过依赖图分析和缓存实现智能测试选择和增量构建：

- **测试缓存**: SHA256(变更文件集) → 缓存测试选择结果，相同变更复用
- **依赖图**: 解析 require/import 构建传递性依赖树
- **Flakiness 评分**: 追踪测试通过/失败历史，计算不稳定度
- **覆盖映射**: 源文件 ↔ 测试文件双向映射
- **增量构建**: DAG 拓扑排序，并行执行无依赖步骤

```javascript
// 智能测试选择
const result = await window.electron.ipcRenderer.invoke("cicd:select-tests", [
  "src/main/llm/context-engineering.js",
  "src/main/llm/session-manager.js",
]);
// result.data = { tests: ["tests/context.test.js", ...], cached: true, hitRate: "75%" }

// 增量构建计划
const plan = await window.electron.ipcRenderer.invoke("cicd:plan-build", [
  "src/main/llm/context-engineering.js",
]);
// plan.data = { steps: [...], savedTimeMs: 85000, savingsPercent: "71%" }
```

| IPC Channel                 | 功能                |
| --------------------------- | ------------------- |
| `cicd:select-tests`         | 智能测试选择        |
| `cicd:get-cache-stats`      | 缓存命中率          |
| `cicd:clear-cache`          | 清除测试缓存        |
| `cicd:get-test-history`     | 测试 Flakiness 数据 |
| `cicd:get-dependency-graph` | 依赖图可视化        |
| `cicd:plan-build`           | 生成增量构建计划    |
| `cicd:execute-build-step`   | 执行单个构建步骤    |
| `cicd:get-build-cache`      | 构建缓存统计        |
| `cicd:analyze-coverage`     | 源码→测试覆盖分析   |
| `cicd:get-config`           | 获取优化器配置      |

##### API 文档自动生成

IPCApiDocGenerator 扫描所有 `*-ipc.js` 文件，提取 IPC handler 定义，生成 OpenAPI 3.0 规范和 Markdown 文档：

- **Handler 扫描**: 递归发现所有 IPC 文件，正则 + JSDoc 解析
- **参数提取**: 从函数签名、解构模式、`@param` 标签提取
- **响应推断**: 检测 `{ success, data, error }` 标准模式
- **OpenAPI 3.0**: 每个 IPC channel 映射为 `POST /ipc/{namespace}/{operation}`
- **Markdown 输出**: 按命名空间分组的可读 API 参考

```javascript
// 生成完整文档
const docs = await window.electron.ipcRenderer.invoke("api-docs:generate", {
  rescan: true,
});
// docs.data = { openApiSpec: {...}, markdown: "# ChainlessChain IPC API\n...", stats: {...} }

// 查询特定 channel
const info = await window.electron.ipcRenderer.invoke(
  "api-docs:get-channel-info",
  "instinct:get-all",
);
// info.data = { channel, params, response, file, line, jsdoc }
```

| IPC Channel                 | 功能                    |
| --------------------------- | ----------------------- |
| `api-docs:generate`         | 生成 OpenAPI + Markdown |
| `api-docs:scan-handlers`    | 扫描所有 IPC handlers   |
| `api-docs:get-spec`         | 获取 OpenAPI 规范       |
| `api-docs:get-channel-info` | 查询特定 channel 信息   |
| `api-docs:get-stats`        | Handler 统计            |
| `api-docs:get-config`       | 获取生成器配置          |

#### 关键文件

| 文件                                                                    | 行数   | 职责                      |
| ----------------------------------------------------------------------- | ------ | ------------------------- |
| `src/main/llm/instinct-manager.js`                                      | ~1,100 | Instinct 管理核心         |
| `src/main/llm/instinct-ipc.js`                                          | ~280   | 11 个 IPC Handler         |
| `src/main/ai-engine/cowork/skills/builtin/orchestrate/handler.js`       | ~507   | Orchestrate 编排引擎      |
| `src/main/ai-engine/cowork/skills/builtin/orchestrate/SKILL.md`         | ~112   | Orchestrate 技能定义      |
| `src/main/ai-engine/cowork/skills/builtin/verification-loop/handler.js` | ~547   | Verification Loop 引擎    |
| `src/main/ai-engine/cowork/skills/builtin/verification-loop/SKILL.md`   | ~118   | Verification Loop 定义    |
| `src/main/llm/context-engineering.js`                                   | +35    | Instinct 上下文注入集成   |
| `src/main/database.js`                                                  | +30    | instincts/observations 表 |
| `src/main/ipc/ipc-registry.js`                                          | +44    | Phase 17 注册             |

---

### v2.0.0 — 跨设备协作与分布式执行 ✅

**目标**: 突破单设备限制，实现桌面端、Android、iOS 三端协同的多智能体网络

#### 已完成

- [x] **P2P Agent Network** — 基于 WebRTC DataChannel + MobileBridge 的跨设备代理通信，15 种消息类型，心跳监测，任务委派/结果回传（~680 行）
- [x] **Device Discovery** — 自动发现网络设备及其能力，4 级能力分层（full/standard/light/cloud），技能→设备索引，最优设备路由（~420 行）
- [x] **Hybrid Executor** — 6 种执行策略（local-only/remote-only/local-first/remote-first/best-fit/load-balance），4 级任务权重分类，批量执行，回退重试（~510 行）
- [x] **Computer Use Bridge** — 12 个 AI 工具映射为 Cowork 技能，录制回放共享库，FileSandbox + SafeMode 统一权限（~430 行）
- [x] **Cowork API Server** — RESTful API（20+ 端点），SSE 实时事件推送，Bearer/API-Key 认证，CORS，限流（~520 行）
- [x] **Webhook Manager** — 17 种事件类型，HMAC 签名验证，指数退避重试（3 次），投递日志持久化（~530 行）
- [x] **IPC Handler 注册** — 34 个 IPC handler（Phase 18），6 模块全覆盖
- [x] **数据库 Schema** — 4 张新表（p2p_remote_agents, p2p_remote_tasks, cowork_webhooks, cowork_webhook_deliveries）

#### 跨设备协作架构

```
┌──────────────────┐     WebRTC      ┌──────────────────┐
│   Desktop 端      │ ◄─────────────► │   Android 端      │
│                   │   DataChannel   │                   │
│  92 Skills 全量   │                │  28 Skills 本地   │
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

#### P2P Agent Network

基于现有 WebRTC DataChannel 和 MobileBridge 基础设施，实现跨设备代理通信协议：

**15 种消息类型**:

| 消息类型                      | 方向 | 说明                    |
| ----------------------------- | ---- | ----------------------- |
| `cowork:agent-announce`       | 双向 | 设备上线广播 + 能力通告 |
| `cowork:agent-depart`         | 广播 | 设备下线通知            |
| `cowork:agent-heartbeat`      | 广播 | 心跳保活 + 资源状态更新 |
| `cowork:task-delegate`        | 单向 | 委派任务到远程设备      |
| `cowork:task-accept`          | 回复 | 远程设备接受任务        |
| `cowork:task-reject`          | 回复 | 远程设备拒绝任务        |
| `cowork:task-progress`        | 单向 | 远程任务进度更新        |
| `cowork:task-result`          | 回复 | 远程任务执行结果        |
| `cowork:task-cancel`          | 单向 | 取消远程任务            |
| `cowork:skill-query`          | 广播 | 查询远程技能可用性      |
| `cowork:skill-response`       | 回复 | 远程技能查询响应        |
| `cowork:team-sync`            | 多播 | 团队状态同步            |
| `cowork:team-invite`          | 单向 | 邀请远程代理加入团队    |
| `cowork:team-invite-response` | 回复 | 团队邀请响应            |

```javascript
// 委派任务到远程设备
const result = await p2pNetwork.delegateTask("mobile-peer-001", {
  skillId: "code-review",
  description: "Review the authentication module",
  input: { files: ["src/auth/*.js"] },
  priority: "HIGH",
  timeout: 120000,
});
```

#### Device Discovery

自动发现网络中各设备的可用技能和计算资源：

**4 级能力分层**:

| 层级     | 标识       | 典型设备           | 特征                  |
| -------- | ---------- | ------------------ | --------------------- |
| Full     | `full`     | Desktop (Win/Mac)  | 92+ 技能, GPU, 全能力 |
| Standard | `standard` | Android (10+ 技能) | 12+ native handler    |
| Light    | `light`    | Android (REMOTE)   | 仅委派到 Desktop 执行 |
| Cloud    | `cloud`    | 云端 Worker        | 大模型推理, 重计算    |

```javascript
// 查找能执行指定技能的最佳设备
const device = deviceDiscovery.getBestDeviceForSkill("data-analysis", {
  minCpus: 4,
  minMemoryMB: 2048,
});
// → { deviceId: "local", platform: "win32", tier: "full", ... }

// 获取全网络技能目录
const catalog = deviceDiscovery.getNetworkSkillCatalog();
// → [{ skillId: "code-review", availableOn: [{deviceId, platform, tier}, ...] }, ...]
```

#### Hybrid Executor

智能任务路由引擎，6 种执行策略：

| 策略         | 标识           | 行为                                |
| ------------ | -------------- | ----------------------------------- |
| Local Only   | `local-only`   | 强制本地执行                        |
| Remote Only  | `remote-only`  | 强制远程执行                        |
| Local First  | `local-first`  | 优先本地，失败回退远程              |
| Remote First | `remote-first` | 优先远程，失败回退本地              |
| Best Fit     | `best-fit`     | 根据任务权重 + 设备能力评分选择最优 |
| Load Balance | `load-balance` | 滚动窗口负载均衡，选择最空闲设备    |

**4 级任务权重分类**:

| 权重   | 典型技能                              | 特征            |
| ------ | ------------------------------------- | --------------- |
| light  | text-transformer, json-yaml, regex    | < 5s, 低计算    |
| medium | code-review, lint-and-fix, test-gen   | 5-30s, 中等计算 |
| heavy  | data-analysis, web-scraping, research | 30s+, 高计算    |
| gpu    | computer-use, image-editor, OCR       | 需 GPU 加速     |

```javascript
// Best-fit 执行
const result = await hybridExecutor.execute({
  skillId: "code-review",
  description: "Review authentication module",
  input: { files: ["src/auth/*.js"] },
  strategy: "best-fit",
});
// result._executedOn → "local" 或 "remote:device-abc123"

// 批量负载均衡执行
const results = await hybridExecutor.executeBatch(
  [
    { skillId: "code-review", input: { file: "a.js" } },
    { skillId: "security-audit", input: { file: "b.js" } },
    { skillId: "test-generator", input: { file: "c.js" } },
  ],
  { concurrency: 3, strategy: "load-balance" },
);
```

#### Computer Use Bridge

12 个 AI 工具映射为 Cowork 技能：

| CU 工具              | Cowork 技能 ID          | 权重   |
| -------------------- | ----------------------- | ------ |
| `browser_click`      | `cu-browser-click`      | light  |
| `visual_click`       | `cu-visual-click`       | medium |
| `browser_type`       | `cu-browser-type`       | light  |
| `browser_key`        | `cu-browser-key`        | light  |
| `browser_scroll`     | `cu-browser-scroll`     | light  |
| `browser_screenshot` | `cu-browser-screenshot` | light  |
| `analyze_page`       | `cu-analyze-page`       | medium |
| `browser_navigate`   | `cu-browser-navigate`   | light  |
| `browser_wait`       | `cu-browser-wait`       | light  |
| `desktop_screenshot` | `cu-desktop-screenshot` | medium |
| `desktop_click`      | `cu-desktop-click`      | light  |
| `desktop_type`       | `cu-desktop-type`       | light  |

**录制回放共享**:

```javascript
// 代理 A 共享录制
const shareId = bridge.shareRecording(
  "rec-001",
  {
    steps: [
      { tool: "browser_navigate", params: { url: "https://example.com" } },
      { tool: "browser_click", params: { selector: "#login" } },
      {
        tool: "browser_type",
        params: { selector: "#email", text: "user@..." },
      },
    ],
    metadata: { stopOnError: true },
  },
  { agentId: "agent-A" },
);

// 代理 B 回放
const result = await bridge.replaySharedRecording(shareId, {
  agentId: "agent-B",
});
// → { success: true, totalSteps: 3, executedSteps: 3, results: [...] }
```

#### Cowork API Server

RESTful API 端点（默认端口 9100）：

| 方法     | 路径                              | 功能           |
| -------- | --------------------------------- | -------------- |
| `GET`    | `/api/v1/cowork/health`           | 健康检查       |
| `GET`    | `/api/v1/cowork/stats`            | 综合统计       |
| `GET`    | `/api/v1/cowork/teams`            | 列出团队       |
| `POST`   | `/api/v1/cowork/teams`            | 创建团队       |
| `GET`    | `/api/v1/cowork/teams/:id`        | 团队详情       |
| `DELETE` | `/api/v1/cowork/teams/:id`        | 销毁团队       |
| `POST`   | `/api/v1/cowork/teams/:id/tasks`  | 分配任务       |
| `GET`    | `/api/v1/cowork/teams/:id/tasks`  | 团队任务列表   |
| `POST`   | `/api/v1/cowork/teams/:id/agents` | 加入团队       |
| `GET`    | `/api/v1/cowork/teams/:id/agents` | 成员列表       |
| `GET`    | `/api/v1/cowork/skills`           | 技能列表       |
| `POST`   | `/api/v1/cowork/skills/execute`   | 执行技能       |
| `GET`    | `/api/v1/cowork/devices`          | 设备列表       |
| `GET`    | `/api/v1/cowork/devices/skills`   | 全网络技能目录 |
| `GET`    | `/api/v1/cowork/webhooks`         | Webhook 列表   |
| `POST`   | `/api/v1/cowork/webhooks`         | 注册 Webhook   |
| `DELETE` | `/api/v1/cowork/webhooks/:id`     | 删除 Webhook   |
| `GET`    | `/api/v1/cowork/events`           | SSE 实时事件流 |

**认证方式**:

```bash
# Bearer Token
curl -H "Authorization: Bearer <token>" http://localhost:9100/api/v1/cowork/teams

# API Key
curl -H "X-API-Key: <key>" http://localhost:9100/api/v1/cowork/teams
```

#### Webhook Manager

17 种事件类型，HMAC 签名验证，指数退避重试：

| 事件类型                    | 触发条件       |
| --------------------------- | -------------- |
| `team.created`              | 新团队创建     |
| `team.destroyed`            | 团队销毁       |
| `team.paused`               | 团队暂停       |
| `team.resumed`              | 团队恢复       |
| `agent.joined`              | 代理加入团队   |
| `agent.terminated`          | 代理终止       |
| `agent.remote.connected`    | 远程代理连接   |
| `agent.remote.disconnected` | 远程代理断开   |
| `task.assigned`             | 任务分配       |
| `task.completed`            | 任务完成       |
| `task.failed`               | 任务失败       |
| `task.delegated`            | 任务委派到远程 |
| `skill.executed`            | 技能执行成功   |
| `skill.failed`              | 技能执行失败   |
| `vote.completed`            | 投票决策完成   |
| `device.discovered`         | 新设备发现     |
| `device.offline`            | 设备离线       |

```javascript
// 注册 Webhook
const webhook = webhookManager.registerWebhook({
  url: "https://ci.example.com/cowork-hook",
  events: ["task.completed", "task.failed"],
  secret: "my-hmac-secret",
});

// 请求头包含 HMAC 签名:
// X-Webhook-Signature: sha256=<hex-digest>
// X-Webhook-Event: task.completed
// X-Webhook-Delivery: dlv-abc12345
```

#### v2.0.0 IPC 通道（34 个 — Phase 18）

**P2P Agent Network（9 个）**:

| 通道                          | 功能                 |
| ----------------------------- | -------------------- |
| `p2p-agent:get-remote-agents` | 获取远程代理列表     |
| `p2p-agent:find-for-skill`    | 按技能查找远程代理   |
| `p2p-agent:delegate-task`     | 委派任务到远程       |
| `p2p-agent:cancel-task`       | 取消远程任务         |
| `p2p-agent:query-skill`       | 广播查询远程技能     |
| `p2p-agent:invite-to-team`    | 邀请远程代理加入团队 |
| `p2p-agent:sync-team`         | 同步团队状态到远程   |
| `p2p-agent:announce`          | 广播本地设备在线     |
| `p2p-agent:get-stats`         | P2P 网络统计         |

**Device Discovery（5 个）**:

| 通道                        | 功能               |
| --------------------------- | ------------------ |
| `device:get-all`            | 获取所有设备       |
| `device:get-by-id`          | 获取指定设备详情   |
| `device:find-for-skill`     | 按技能查找最优设备 |
| `device:get-network-skills` | 全网络技能目录     |
| `device:get-stats`          | 设备发现统计       |

**Hybrid Executor（3 个）**:

| 通道                   | 功能             |
| ---------------------- | ---------------- |
| `hybrid:execute`       | 智能路由执行任务 |
| `hybrid:execute-batch` | 批量负载均衡执行 |
| `hybrid:get-stats`     | 执行器统计       |

**Computer Use Bridge（6 个）**:

| 通道                         | 功能             |
| ---------------------------- | ---------------- |
| `cu-bridge:execute`          | 执行 CU 工具动作 |
| `cu-bridge:share-recording`  | 共享录制         |
| `cu-bridge:list-recordings`  | 列出共享录制     |
| `cu-bridge:replay-recording` | 回放共享录制     |
| `cu-bridge:get-permissions`  | 获取代理 CU 权限 |
| `cu-bridge:get-stats`        | CU Bridge 统计   |

**Cowork API Server（4 个）**:

| 通道                       | 功能          |
| -------------------------- | ------------- |
| `cowork-api:start`         | 启动 API 服务 |
| `cowork-api:stop`          | 停止 API 服务 |
| `cowork-api:get-status`    | 获取服务状态  |
| `cowork-api:broadcast-sse` | 广播 SSE 事件 |

**Webhook Manager（7 个）**:

| 通道                       | 功能              |
| -------------------------- | ----------------- |
| `webhook:register`         | 注册 Webhook      |
| `webhook:unregister`       | 删除 Webhook      |
| `webhook:update`           | 更新 Webhook 配置 |
| `webhook:list`             | 列出所有 Webhook  |
| `webhook:dispatch`         | 手动派发事件      |
| `webhook:get-delivery-log` | 获取投递日志      |
| `webhook:get-stats`        | Webhook 统计      |

#### 数据库 Schema（v2.0.0 新增 4 表）

```sql
-- P2P 远程代理注册表
CREATE TABLE p2p_remote_agents (
  peer_id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  platform TEXT,
  skills TEXT DEFAULT '[]',
  resources TEXT DEFAULT '{}',
  state TEXT DEFAULT 'offline',
  last_heartbeat TEXT,
  registered_at TEXT,
  updated_at TEXT
);

-- P2P 远程任务记录
CREATE TABLE p2p_remote_tasks (
  task_id TEXT PRIMARY KEY,
  peer_id TEXT NOT NULL,
  skill_id TEXT,
  description TEXT,
  input TEXT DEFAULT '{}',
  status TEXT DEFAULT 'pending',
  result TEXT,
  delegated_at TEXT,
  completed_at TEXT
);

-- Webhook 注册表
CREATE TABLE cowork_webhooks (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  events TEXT DEFAULT '[]',
  secret TEXT,
  metadata TEXT DEFAULT '{}',
  active INTEGER DEFAULT 1,
  delivery_count INTEGER DEFAULT 0,
  last_delivery TEXT,
  fail_count INTEGER DEFAULT 0,
  created_at TEXT
);

-- Webhook 投递日志
CREATE TABLE cowork_webhook_deliveries (
  id TEXT PRIMARY KEY,
  webhook_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  http_status INTEGER,
  attempt INTEGER DEFAULT 0,
  error TEXT,
  created_at TEXT
);
```

#### 关键文件

| 文件                                               | 行数 | 职责                          |
| -------------------------------------------------- | ---- | ----------------------------- |
| `src/main/ai-engine/cowork/p2p-agent-network.js`   | ~680 | P2P 代理网络（15 种消息类型） |
| `src/main/ai-engine/cowork/device-discovery.js`    | ~420 | 设备能力发现（4 级分层）      |
| `src/main/ai-engine/cowork/hybrid-executor.js`     | ~510 | 混合执行策略（6 种策略）      |
| `src/main/ai-engine/cowork/computer-use-bridge.js` | ~430 | Computer Use 集成（12 工具）  |
| `src/main/ai-engine/cowork/cowork-api-server.js`   | ~520 | RESTful API 服务（20+ 端点）  |
| `src/main/ai-engine/cowork/webhook-manager.js`     | ~530 | Webhook 事件推送（17 事件）   |
| `src/main/ai-engine/cowork/cowork-v2-ipc.js`       | ~420 | 34 个 IPC Handler             |
| `src/main/database.js`                             | +55  | 4 张新表                      |
| `src/main/ipc/ipc-registry.js`                     | +95  | Phase 18 注册                 |

---

### v2.1.0 — 自进化与知识图谱 ✅

**目标**: 构建能够自我学习和知识积累的智能代理网络

#### 已完成

- [x] **代码知识图谱** — 8 种实体类型，7 种关系类型，度中心度分析，热点检测，环形依赖检测（DFS），架构建议注入 ContextEngineering（~650 行）
- [x] **决策知识库** — 自动记录投票/编排决策，相似决策检索，最佳实践提取，4 种来源，Hook 集成自动捕获（~500 行）
- [x] **Prompt 自优化** — SHA-256 哈希去重，A/B 变体管理，成功率自动追踪，优化建议生成（~450 行）
- [x] **技能自动发现** — 任务失败关键词提取，Marketplace 自动搜索，安装建议，发现历史追踪（~400 行）
- [x] **辩论式代码审查** — 3 视角审查代理，结构化 issue 输出，共识投票裁决，决策记录到 DecisionKB（~550 行）
- [x] **A/B 方案对比** — 5 种代理风格，3 维基准评分，自动排名选优（~500 行）
- [x] **经验回放** — Instinct evolveInstincts 扩展，成功工作流自动沉淀为 instinct（~100 行）
- [x] **KG 上下文注入** — ContextEngineering 步骤 4.6 注入代码知识图谱架构洞察（~30 行）
- [x] **IPC Handler 注册** — 35 个 IPC handler（Phase 20），6 模块全覆盖
- [x] **数据库 Schema** — 8 张新表
- [x] **3 新内置技能** — debate-review, ab-compare, stream-processor

#### 知识图谱驱动

- [x] **代码知识图谱** — 基于 `knowledge-graph` 技能自动构建项目代码的实体关系图谱（类、函数、模块、依赖）
- [x] **决策知识库** — 积累历史决策数据（投票结果、方案选择、故障处理），为未来决策提供参考
- [x] **最佳实践推荐** — 基于知识图谱分析，自动推荐适合当前任务的代码模式和解决方案

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

- [x] **技能自动发现** — 代理根据任务失败原因自动搜索 Marketplace 中的新技能并建议安装
- [x] **Prompt 自优化** — 基于执行结果反馈，自动调优技能的 Prompt 模板（集成 `prompt-enhancer`）
- [x] **经验回放学习** — 将成功的任务执行路径提取为新的工作流模板，持续丰富模板库

#### 高级协作模式

- [x] **辩论式代码审查** — 多个代理从不同角度（性能、安全、可维护性）审查代码，通过投票达成共识
- [x] **A/B 方案对比** — 对同一任务生成多个实现方案，自动运行基准测试并推荐最优方案
- [x] **流式任务处理** — 支持数据流式处理模式，适用于日志分析、实时监控等持续性任务

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

#### 关键文件

| 文件                                                         | 行数 | 职责                   |
| ------------------------------------------------------------ | ---- | ---------------------- |
| `src/main/ai-engine/cowork/code-knowledge-graph.js`          | ~650 | 代码知识图谱构建与分析 |
| `src/main/ai-engine/cowork/decision-knowledge-base.js`       | ~500 | 决策知识库             |
| `src/main/ai-engine/cowork/prompt-optimizer.js`              | ~450 | Prompt 自优化引擎      |
| `src/main/ai-engine/cowork/skill-discoverer.js`              | ~400 | 技能自动发现           |
| `src/main/ai-engine/cowork/debate-review.js`                 | ~550 | 辩论式代码审查         |
| `src/main/ai-engine/cowork/ab-comparator.js`                 | ~500 | A/B 方案对比引擎       |
| `src/main/ai-engine/cowork/evolution-ipc.js`                 | ~550 | 35 个 IPC handler      |
| `src/main/ai-engine/cowork/skills/builtin/debate-review/`    | ~240 | debate-review 技能     |
| `src/main/ai-engine/cowork/skills/builtin/ab-compare/`       | ~230 | ab-compare 技能        |
| `src/main/ai-engine/cowork/skills/builtin/stream-processor/` | ~350 | stream-processor 技能  |

#### v2.1.0 IPC 通道（35 个 — Phase 20）

| 模块                    | 前缀          | 数量 | 主要功能                          |
| ----------------------- | ------------- | ---- | --------------------------------- |
| Code Knowledge Graph    | `ckg:`        | 14   | 图谱扫描、实体查询、热点/环形依赖 |
| Decision Knowledge Base | `dkb:`        | 6    | 决策记录、相似检索、最佳实践      |
| Prompt Optimizer        | `prompt-opt:` | 5    | 执行记录、变体管理、优化分析      |
| Skill Discoverer        | `skill-disc:` | 4    | 失败分析、安装建议、发现历史      |
| Debate Review           | `debate:`     | 3    | 辩论审查、历史查询、统计          |
| A/B Comparator          | `ab:`         | 3    | 方案对比、历史查询、统计          |

#### 数据库 Schema（v2.1.0 新增 8 表）

```sql
-- 代码知识图谱：实体表
CREATE TABLE code_kg_entities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,        -- module, class, function, variable, interface, type, enum, component
  file_path TEXT,
  line_start INTEGER,
  line_end INTEGER,
  language TEXT,
  metadata TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 代码知识图谱：关系表
CREATE TABLE code_kg_relationships (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  type TEXT NOT NULL,        -- imports, exports, extends, implements, calls, contains, depends_on
  weight REAL DEFAULT 1.0,
  metadata TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (source_id) REFERENCES code_kg_entities(id),
  FOREIGN KEY (target_id) REFERENCES code_kg_entities(id)
);

-- 决策知识库
CREATE TABLE decision_records (
  id TEXT PRIMARY KEY,
  problem TEXT NOT NULL,
  problem_category TEXT,     -- architecture, implementation, testing, performance, security, etc.
  solutions TEXT DEFAULT '[]',
  chosen_solution TEXT,
  outcome TEXT,
  context TEXT DEFAULT '{}',
  agents TEXT DEFAULT '[]',
  source TEXT DEFAULT 'manual',  -- manual, voting, orchestrate, instinct
  success_rate REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Prompt 执行记录
CREATE TABLE prompt_executions (
  id TEXT PRIMARY KEY,
  skill_name TEXT NOT NULL,
  prompt_hash TEXT,          -- SHA-256 前 16 字符
  prompt_text TEXT,
  result_success INTEGER DEFAULT 0,
  execution_time_ms INTEGER DEFAULT 0,
  feedback TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Prompt 变体
CREATE TABLE prompt_variants (
  id TEXT PRIMARY KEY,
  skill_name TEXT NOT NULL,
  variant_name TEXT,
  prompt_text TEXT NOT NULL,
  success_rate REAL DEFAULT 0,
  use_count INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

-- 技能发现日志
CREATE TABLE skill_discovery_log (
  id TEXT PRIMARY KEY,
  task_id TEXT,
  failure_reason TEXT,
  searched_keywords TEXT,
  suggested_skills TEXT DEFAULT '[]',
  installed INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- 辩论式审查记录
CREATE TABLE debate_reviews (
  id TEXT PRIMARY KEY,
  target TEXT NOT NULL,
  reviews TEXT DEFAULT '[]',
  votes TEXT DEFAULT '{}',
  verdict TEXT,              -- APPROVE, NEEDS_WORK, REJECT
  consensus_score REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- A/B 对比记录
CREATE TABLE ab_comparisons (
  id TEXT PRIMARY KEY,
  task_description TEXT NOT NULL,
  variants TEXT DEFAULT '[]',
  winner TEXT,
  scores TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now'))
);
```

---

### 长期愿景 (2026 H2+)

| 方向                 | 目标                                 | 关键指标              |
| -------------------- | ------------------------------------ | --------------------- |
| **全自动开发流水线** | 从需求到部署全程 AI 代理协作         | 人工干预率 < 20%      |
| **自然语言编程**     | 用自然语言描述需求，代理团队自动实现 | 需求→代码转化率 > 80% |
| **去中心化代理网络** | 基于 DID 的代理身份认证和跨组织协作  | 支持 100+ 节点        |
| **多模态协作**       | 集成语音、视觉、文档等多模态输入输出 | 支持 5+ 模态          |
| **自主运维**         | 代理自动监控、诊断、修复生产环境问题 | MTTR < 5 分钟         |

---

### v3.0 — 全自动开发流水线

**目标**: 从需求描述到生产部署全程 AI 代理协作，人工干预率 < 20%

#### 规划模块

- [ ] **Pipeline Orchestrator** — 中央流水线协调器，7 阶段生命周期（需求→设计→编码→测试→审查→部署→监控），门控审批机制（~700 行）
- [ ] **Requirement Parser** — 自然语言需求→结构化 Spec JSON，支持用户故事、验收标准、边界条件提取（~450 行）
- [ ] **Deploy Agent** — 自动化部署执行引擎，支持 Git 分支/PR 创建、Docker 构建、npm 发布（~500 行）
- [ ] **Post-Deploy Monitor** — 生产环境监控桥接，集成 ErrorMonitor + AutoTuner，异常自动回滚触发（~350 行）
- [ ] **Pipeline IPC** — 15 个 IPC handler，覆盖流水线全生命周期操作（~400 行）

#### 流水线架构

```
需求输入
  │
  ▼
┌──────────────────────────────────────────────────────────────────┐
│                    Pipeline Orchestrator                         │
│                                                                  │
│  ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐   │
│  │ Stage 1 │→│ Stage 2 │→│ Stage 3 │→│ Stage 4 │→│ Stage 5 │   │
│  │ 需求解析│  │ 架构设计│  │ 代码生成│  │ 测试验证│  │ 代码审查│   │
│  └────┬───┘  └────┬───┘  └────┬───┘  └────┬───┘  └────┬───┘   │
│       │           │           │           │           │         │
│       ▼           ▼           ▼           ▼           ▼         │
│  Requirement  Orchestrate  Cowork    Verification  Debate       │
│  Parser       Planner      Skills    Loop          Review       │
│                                                                  │
│  ┌────────┐  ┌────────┐                                        │
│  │ Stage 6 │→│ Stage 7 │  ← 门控审批（人工/自动）              │
│  │ 自动部署│  │ 生产监控│                                        │
│  └────┬───┘  └────┬───┘                                        │
│       │           │                                              │
│       ▼           ▼                                              │
│  Deploy Agent  Post-Deploy                                      │
│  (Git/Docker)  Monitor                                          │
└──────────────────────────────────────────────────────────────────┘
       │                    │
       ▼                    ▼
  ┌─────────┐        ┌─────────────┐
  │ CKG     │        │ Instinct    │
  │ 代码图谱 │        │ 经验学习     │
  └─────────┘        └─────────────┘
```

#### 分阶段实现

**Phase A — 流水线框架（Month 1-2）**:

- [ ] PipelineOrchestrator 类骨架：7 阶段状态机、事件总线、门控队列
- [ ] RequirementParser 基础：NL→Spec JSON 结构化输出（用户故事、验收标准）
- [ ] Pipeline 数据模型：3 张数据库表、流水线模板
- [ ] 基础 IPC 通道（8 个）：create、start、pause、resume、cancel、get-status、get-all、get-config

**Phase B — 代理集成（Month 3-4）**:

- [ ] 阶段 1-5 代理编排：集成 Orchestrate（设计）、Cowork Skills（编码）、Verification Loop（测试）、Debate Review（审查）
- [ ] 门控审批机制：人工审批 + 自动审批（基于 Instinct 置信度阈值）
- [ ] 制品管理：阶段间产物传递（Spec JSON→设计文档→代码→测试报告→审查意见）
- [ ] 扩展 IPC 通道（+4 个）：approve-gate、reject-gate、get-artifacts、get-stage-detail

**Phase C — 部署与监控（Month 5-6）**:

- [ ] DeployAgent 实现：Git 分支创建、PR 生成、Docker build/push、npm publish
- [ ] PostDeployMonitor 集成：ErrorMonitor 异常检测 + AutoTuner 性能基线比对
- [ ] 自动回滚触发：部署后异常超阈值自动执行 rollback
- [ ] 完善 IPC（+3 个）：get-metrics、get-templates、configure
- [ ] 端到端集成测试

#### v3.0 IPC 通道（15 个）

**Pipeline Orchestrator（12 个）**:

| 通道                            | 功能               |
| ------------------------------- | ------------------ |
| `dev-pipeline:create`           | 创建流水线实例     |
| `dev-pipeline:start`            | 启动流水线执行     |
| `dev-pipeline:pause`            | 暂停流水线         |
| `dev-pipeline:resume`           | 恢复流水线         |
| `dev-pipeline:cancel`           | 取消流水线         |
| `dev-pipeline:get-status`       | 获取流水线状态     |
| `dev-pipeline:get-all`          | 列出所有流水线     |
| `dev-pipeline:get-stage-detail` | 获取指定阶段详情   |
| `dev-pipeline:approve-gate`     | 审批通过门控       |
| `dev-pipeline:reject-gate`      | 拒绝门控（含原因） |
| `dev-pipeline:get-artifacts`    | 获取阶段制品       |
| `dev-pipeline:get-metrics`      | 获取流水线执行指标 |

**Pipeline Config（3 个）**:

| 通道                         | 功能               |
| ---------------------------- | ------------------ |
| `dev-pipeline:get-templates` | 获取流水线模板列表 |
| `dev-pipeline:configure`     | 更新流水线配置     |
| `dev-pipeline:get-config`    | 获取当前配置       |

#### 代码示例

```javascript
// 创建并启动全自动开发流水线
const pipeline = await ipcRenderer.invoke("dev-pipeline:create", {
  name: "用户认证模块",
  template: "feature",
  requirement: "实现基于 JWT 的用户认证系统，支持注册、登录、Token 刷新",
  config: {
    autoApprove: false, // 门控需人工审批
    deployTarget: "staging", // 部署目标环境
    rollbackOnError: true, // 异常自动回滚
  },
});
// → { id: "pipe-abc123", status: "created", stages: [...] }

// 启动流水线
await ipcRenderer.invoke("dev-pipeline:start", { pipelineId: "pipe-abc123" });
// → { status: "running", currentStage: "requirement-parsing" }

// 门控审批
await ipcRenderer.invoke("dev-pipeline:approve-gate", {
  pipelineId: "pipe-abc123",
  stageId: "code-review",
  comment: "代码质量符合标准，批准部署",
});
// → { status: "approved", nextStage: "deploy" }

// 查询流水线执行指标
const metrics = await ipcRenderer.invoke("dev-pipeline:get-metrics", {
  pipelineId: "pipe-abc123",
});
// → { totalTime: 1842000, stageMetrics: [...], humanInterventions: 1, autoApprovals: 4 }
```

#### 数据库 Schema（v3.0 新增 3 表）

```sql
-- 开发流水线主表
CREATE TABLE dev_pipelines (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  template TEXT,                  -- feature, bugfix, refactor, security-audit
  requirement TEXT,
  spec_json TEXT DEFAULT '{}',
  status TEXT DEFAULT 'created',  -- created, running, paused, gate-waiting, completed, failed, cancelled
  current_stage TEXT,
  config TEXT DEFAULT '{}',
  metrics TEXT DEFAULT '{}',
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);

-- 流水线阶段表
CREATE TABLE dev_pipeline_stages (
  id TEXT PRIMARY KEY,
  pipeline_id TEXT NOT NULL,
  stage_name TEXT NOT NULL,       -- requirement-parsing, architecture-design, code-generation, testing, code-review, deploy, monitoring
  stage_order INTEGER NOT NULL,
  status TEXT DEFAULT 'pending',  -- pending, running, gate-waiting, approved, rejected, completed, failed, skipped
  input TEXT DEFAULT '{}',
  output TEXT DEFAULT '{}',
  agent_id TEXT,
  gate_approver TEXT,
  gate_comment TEXT,
  started_at TEXT,
  completed_at TEXT,
  FOREIGN KEY (pipeline_id) REFERENCES dev_pipelines(id)
);

-- 流水线制品表
CREATE TABLE dev_pipeline_artifacts (
  id TEXT PRIMARY KEY,
  pipeline_id TEXT NOT NULL,
  stage_id TEXT NOT NULL,
  artifact_type TEXT NOT NULL,    -- spec, design-doc, code, test-report, review-report, deploy-log, monitor-snapshot
  content TEXT,
  file_path TEXT,
  metadata TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (pipeline_id) REFERENCES dev_pipelines(id),
  FOREIGN KEY (stage_id) REFERENCES dev_pipeline_stages(id)
);
```

#### 关键文件

| 文件                                                 | 行数 | 职责                     |
| ---------------------------------------------------- | ---- | ------------------------ |
| `src/main/ai-engine/cowork/pipeline-orchestrator.js` | ~700 | 中央流水线协调（7 阶段） |
| `src/main/ai-engine/cowork/requirement-parser.js`    | ~450 | NL 需求→Spec JSON 转换   |
| `src/main/ai-engine/cowork/deploy-agent.js`          | ~500 | 自动部署（Git/Docker）   |
| `src/main/ai-engine/cowork/post-deploy-monitor.js`   | ~350 | 生产监控桥接             |
| `src/main/ai-engine/cowork/pipeline-ipc.js`          | ~400 | 15 个 IPC handler        |

#### KPI 度量

| 指标             | 目标     | 度量方式                           |
| ---------------- | -------- | ---------------------------------- |
| 人工干预率       | < 20%    | 人工审批次数 / 总门控次数          |
| 需求→部署时间    | < 2 小时 | pipeline.completed_at - created_at |
| 流水线成功率     | > 85%    | 成功完成 / 总创建数                |
| 自动回滚响应时间 | < 30 秒  | 异常检测→回滚完成耗时              |

---

### v3.1 — 自然语言编程

**目标**: 用自然语言描述需求，代理团队自动实现符合项目约定的代码，需求→代码转化率 > 80%

#### 规划模块

- [ ] **Spec Translator** — 自然语言→结构化 Spec 翻译引擎，支持多轮对话澄清、上下文补全（~600 行）
- [ ] **Project Style Analyzer** — 项目编码约定提取器，集成 CKG + Instinct 分析命名/架构/测试模式（~500 行）
- [ ] **NL Programming IPC** — 10 个 IPC handler（~350 行）
- [ ] **nl-program 内置技能** — handler.js + SKILL.md，支持 `/nl-program` 命令（~300 行）

#### 自然语言编程架构

```
自然语言输入
  │ "实现一个带分页的用户列表组件"
  ▼
┌──────────────────────────────────────────────────┐
│              Spec Translator                      │
│                                                    │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  │
│  │ 意图识别    │→│ 上下文补全  │→│ Spec 生成   │  │
│  │ (LLM)      │  │ (CKG+对话) │  │ (JSON)     │  │
│  └────────────┘  └────────────┘  └────────────┘  │
└──────────┬───────────────────────────────────────┘
           │ Spec JSON
           ▼
┌──────────────────────────────────────────────────┐
│           Project Style Analyzer                   │
│                                                    │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  │
│  │ CKG 分析    │  │ Instinct   │  │ 约定合并    │  │
│  │ 代码结构    │  │ 编码模式    │  │ 风格指南    │  │
│  └────────────┘  └────────────┘  └────────────┘  │
└──────────┬───────────────────────────────────────┘
           │ Spec + Conventions
           ▼
┌──────────────────────────────────────────────────┐
│              Code Generator                        │
│                                                    │
│  Orchestrate (coder agent) + Conventions Context   │
│  → 符合项目约定的代码                              │
└──────────┬───────────────────────────────────────┘
           │ Generated Code
           ▼
┌──────────────────────────────────────────────────┐
│           Verification Loop                        │
│                                                    │
│  Build → TypeCheck → Lint → Test → Security        │
│  → READY / NOT READY（循环精炼）                   │
└──────────────────────────────────────────────────┘
```

#### 分阶段实现

**Phase A — Spec 翻译引擎（Month 2-3）**:

- [ ] SpecTranslator 类：NL 意图识别、上下文补全、结构化 Spec JSON 输出
- [ ] 多轮对话：歧义检测 + 自动追问
- [ ] 集成 CKG：从代码图谱中提取已有模块信息辅助上下文补全
- [ ] 基础 IPC（5 个）：translate、validate、refine、get-history、get-config

**Phase B — 约定分析与代码生成（Month 4-5）**:

- [ ] ProjectStyleAnalyzer 实现：扫描项目提取命名约定、目录结构、测试模式、组件模板
- [ ] Instinct 集成：从 CODING_PATTERN / STYLE / ARCHITECTURE 类别提取编码偏好
- [ ] 代码生成：Orchestrate coder agent + Conventions 上下文注入
- [ ] 扩展 IPC（+3 个）：generate、get-conventions、analyze-project

**Phase C — 交互精炼（Month 6-7）**:

- [ ] 验证循环集成：生成代码自动通过 Verification Loop 验证
- [ ] 精炼循环：NOT READY 结果自动触发 LLM 修复 + 重新验证
- [ ] nl-program 内置技能：SKILL.md + handler.js，支持 `/nl-program "描述"` 命令
- [ ] 完善 IPC（+2 个）：get-stats、configure

#### v3.1 IPC 通道（10 个）

**Spec Translator（5 个）**:

| 通道                  | 功能                   |
| --------------------- | ---------------------- |
| `nl-prog:translate`   | NL 描述→Spec JSON 翻译 |
| `nl-prog:validate`    | 验证 Spec 完整性       |
| `nl-prog:refine`      | 交互精炼 Spec          |
| `nl-prog:get-history` | 获取翻译历史           |
| `nl-prog:get-config`  | 获取配置               |

**Project Style & Generation（5 个）**:

| 通道                      | 功能               |
| ------------------------- | ------------------ |
| `nl-prog:generate`        | 基于 Spec 生成代码 |
| `nl-prog:get-conventions` | 获取项目编码约定   |
| `nl-prog:analyze-project` | 分析项目风格       |
| `nl-prog:get-stats`       | 获取统计数据       |
| `nl-prog:configure`       | 更新配置           |

#### 代码示例

```javascript
// 自然语言→代码生成
const spec = await ipcRenderer.invoke("nl-prog:translate", {
  description:
    "实现一个带分页和搜索功能的用户列表 Vue 组件，支持按姓名和邮箱搜索",
  context: { directory: "src/renderer/components/user/" },
});
// → {
//     intent: "create-component",
//     spec: {
//       type: "vue-component",
//       name: "UserList",
//       features: ["pagination", "search"],
//       searchFields: ["name", "email"],
//       dependencies: ["ant-design-vue/Table", "ant-design-vue/Input.Search"]
//     }
//   }

// 分析项目约定
const conventions = await ipcRenderer.invoke("nl-prog:analyze-project", {
  directory: "src/renderer/components/",
});
// → {
//     naming: { components: "PascalCase", files: "PascalCase.vue", stores: "use*Store" },
//     patterns: { stateManagement: "pinia", uiLibrary: "ant-design-vue", composition: true },
//     testing: { framework: "vitest", location: "__tests__/", naming: "*.test.ts" }
//   }

// 生成符合约定的代码
const result = await ipcRenderer.invoke("nl-prog:generate", {
  specId: spec.id,
  conventions: conventions,
  autoVerify: true, // 自动通过 Verification Loop
});
// → { files: ["UserList.vue", "useUserListStore.ts", "UserList.test.ts"], verified: true }
```

#### 数据库 Schema（v3.1 新增 2 表）

```sql
-- 自然语言编程记录
CREATE TABLE nl_programs (
  id TEXT PRIMARY KEY,
  description TEXT NOT NULL,
  spec_json TEXT DEFAULT '{}',
  conventions TEXT DEFAULT '{}',
  generated_files TEXT DEFAULT '[]',
  status TEXT DEFAULT 'draft',      -- draft, translating, generating, verifying, completed, failed
  verification_result TEXT,         -- READY, NOT_READY
  refine_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);

-- 项目编码约定缓存
CREATE TABLE nl_program_conventions (
  id TEXT PRIMARY KEY,
  project_path TEXT NOT NULL,
  naming_conventions TEXT DEFAULT '{}',
  architecture_patterns TEXT DEFAULT '{}',
  testing_patterns TEXT DEFAULT '{}',
  style_rules TEXT DEFAULT '{}',
  source TEXT DEFAULT 'auto',       -- auto (CKG+Instinct), manual
  confidence REAL DEFAULT 0,
  scanned_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
```

#### 关键文件

| 文件                                                             | 行数 | 职责                    |
| ---------------------------------------------------------------- | ---- | ----------------------- |
| `src/main/ai-engine/cowork/spec-translator.js`                   | ~600 | NL→Spec 翻译引擎        |
| `src/main/ai-engine/cowork/project-style-analyzer.js`            | ~500 | 项目约定提取            |
| `src/main/ai-engine/cowork/nl-programming-ipc.js`                | ~350 | 10 个 IPC handler       |
| `src/main/ai-engine/cowork/skills/builtin/nl-program/handler.js` | ~200 | nl-program 技能 handler |
| `src/main/ai-engine/cowork/skills/builtin/nl-program/SKILL.md`   | ~100 | nl-program 技能定义     |

#### KPI 度量

| 指标            | 目标  | 度量方式                    |
| --------------- | ----- | --------------------------- |
| 需求→代码转化率 | > 80% | 成功生成 / 总翻译请求       |
| Spec 准确率     | > 90% | 无需精炼即通过 / 总 Spec 数 |
| 验证通过率      | > 75% | 首次 READY / 总生成数       |
| 约定符合度      | > 95% | Lint 通过 + 命名规范符合率  |

---

### v3.2 — 多模态协作

**目标**: 集成语音、视觉、文档等多模态输入输出，支持 5+ 模态

#### 规划模块

- [ ] **Modality Fusion** — 多模态输入融合引擎，5 模态统一表示（文本/图像/语音/文档/屏幕）（~600 行）
- [ ] **Document Parser** — PDF/DOCX/XLSX/PPT 文档内容提取与结构化（~500 行）
- [ ] **Screen Recorder** — 屏幕录制→关键帧提取→OCR 文本识别（~400 行）
- [ ] **Multimodal Context** — 统一上下文构建器，融合多模态信息为 LLM 可理解的上下文（~450 行）
- [ ] **Multimodal Output** — 多格式输出生成（Markdown/HTML/图表/幻灯片）（~500 行）
- [ ] **Multimodal Collab IPC** — 12 个 IPC handler（~350 行）
- [ ] **3 新内置技能** — whiteboard-reader、screen-explainer、voice-programmer

#### 多模态协作架构

```
┌────────────────────────────────────────────────────────────────┐
│                     多模态输入层                                │
│                                                                │
│  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐  ┌──────┐           │
│  │ 文本  │  │ 图像  │  │ 语音  │  │ 文档  │  │ 屏幕  │           │
│  │ Text  │  │ Image │  │ Audio │  │ Docs  │  │ Screen│           │
│  └──┬───┘  └──┬───┘  └──┬───┘  └──┬───┘  └──┬───┘           │
│     │         │         │         │         │                  │
└─────┼─────────┼─────────┼─────────┼─────────┼──────────────────┘
      │         │         │         │         │
      ▼         ▼         ▼         ▼         ▼
┌────────────────────────────────────────────────────────────────┐
│                   Modality Fusion Engine                        │
│                                                                │
│  ┌────────────┐  ┌────────────┐  ┌────────────────┐          │
│  │ OCR/Vision  │  │ Whisper    │  │ Document Parser │          │
│  │ 图像理解    │  │ 语音转录    │  │ 文档结构化      │          │
│  └────────────┘  └────────────┘  └────────────────┘          │
└──────────────────────┬─────────────────────────────────────────┘
                       │ 统一表示
                       ▼
┌────────────────────────────────────────────────────────────────┐
│                  Multimodal Context Builder                     │
│                                                                │
│  文本 + 图像描述 + 转录文本 + 文档结构 + 屏幕 OCR             │
│  → 融合上下文 JSON → LLM Prompt                                │
└──────────────────────┬─────────────────────────────────────────┘
                       │
                       ▼
┌────────────────────────────────────────────────────────────────┐
│                    Agent Workflow                               │
│                                                                │
│  Cowork Skills / Orchestrate / Pipeline                        │
└──────────────────────┬─────────────────────────────────────────┘
                       │
                       ▼
┌────────────────────────────────────────────────────────────────┐
│                  Multimodal Output Generator                    │
│                                                                │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐     │
│  │ Markdown  │  │ HTML     │  │ 图表     │  │ 幻灯片   │     │
│  │ 文档      │  │ 富文本    │  │ ECharts  │  │ Reveal.js│     │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘     │
└────────────────────────────────────────────────────────────────┘
```

#### 分阶段实现

**Phase A — 文档与图像融合（Month 2-3）**:

- [ ] ModalityFusion 基础架构：5 模态注册、统一表示格式
- [ ] DocumentParser 实现：PDF（pdf-parse）、DOCX（mammoth）、XLSX（xlsx）内容提取
- [ ] 图像 OCR 集成：复用现有 Tesseract.js + Sharp
- [ ] MultimodalContext 基础：文本 + 图像 + 文档三模态上下文构建
- [ ] 基础 IPC（6 个）：fuse-input、parse-document、build-context、get-session、get-supported-modalities、get-config

**Phase B — 语音与屏幕（Month 4-5）**:

- [ ] 语音模态：Whisper API 集成，音频转录→文本
- [ ] ScreenRecorder 实现：Electron desktopCapturer 录制 + 关键帧提取 + OCR
- [ ] 3 内置技能：whiteboard-reader（白板 OCR→代码）、screen-explainer（屏幕内容解释）、voice-programmer（语音→代码）
- [ ] 扩展 IPC（+3 个）：capture-screen、transcribe-audio、get-artifacts

**Phase C — 富输出生成（Month 6-7）**:

- [ ] MultimodalOutput 实现：Markdown、HTML 富文本、ECharts 图表、Reveal.js 幻灯片
- [ ] 输出模板系统：可配置输出格式模板
- [ ] 端到端流程打通：多模态输入→代理工作流→多格式输出
- [ ] 完善 IPC（+3 个）：generate-output、get-stats、configure

#### v3.2 IPC 通道（12 个）

**Modality Fusion（6 个）**:

| 通道                  | 功能                      |
| --------------------- | ------------------------- |
| `mm:fuse-input`       | 融合多模态输入            |
| `mm:parse-document`   | 解析文档（PDF/DOCX/XLSX） |
| `mm:capture-screen`   | 屏幕截图/录制             |
| `mm:transcribe-audio` | 语音转录                  |
| `mm:build-context`    | 构建统一上下文            |
| `mm:generate-output`  | 生成多格式输出            |

**Session & Config（6 个）**:

| 通道                          | 功能               |
| ----------------------------- | ------------------ |
| `mm:get-session`              | 获取多模态会话详情 |
| `mm:get-artifacts`            | 获取会话制品       |
| `mm:get-supported-modalities` | 获取支持的模态列表 |
| `mm:get-stats`                | 获取统计数据       |
| `mm:configure`                | 更新配置           |
| `mm:get-config`               | 获取当前配置       |

#### 代码示例

```javascript
// 截图 + 文字描述→代码生成
const context = await ipcRenderer.invoke("mm:fuse-input", {
  modalities: [
    { type: "image", data: screenshotBase64, label: "UI 设计稿" },
    {
      type: "text",
      data: "根据这个设计稿实现 Vue 组件，使用 Ant Design Vue",
    },
  ],
});
// → { sessionId: "mm-abc123", fusedContext: { ... }, modalities: ["image", "text"] }

// 构建统一上下文
const unified = await ipcRenderer.invoke("mm:build-context", {
  sessionId: "mm-abc123",
});
// → { context: "图像分析: 包含用户列表表格，顶部搜索栏...\n用户需求: 实现 Vue 组件..." }

// 文档解析
const doc = await ipcRenderer.invoke("mm:parse-document", {
  filePath: "/path/to/api-spec.pdf",
  extractTables: true,
  extractImages: true,
});
// → { pages: 12, text: "...", tables: [...], images: [...], structure: {...} }

// 语音编程
const transcription = await ipcRenderer.invoke("mm:transcribe-audio", {
  audioPath: "/path/to/instruction.wav",
  language: "zh-CN",
});
// → { text: "创建一个用户登录表单，包含邮箱和密码字段", confidence: 0.95 }

// 生成多格式输出
const output = await ipcRenderer.invoke("mm:generate-output", {
  sessionId: "mm-abc123",
  format: "html",
  template: "technical-report",
});
// → { format: "html", content: "<html>...", filePath: "/tmp/report.html" }
```

#### 数据库 Schema（v3.2 新增 2 表）

```sql
-- 多模态会话记录
CREATE TABLE multimodal_sessions (
  id TEXT PRIMARY KEY,
  modalities TEXT DEFAULT '[]',     -- ["text", "image", "audio", "document", "screen"]
  fused_context TEXT,
  status TEXT DEFAULT 'active',     -- active, processing, completed, archived
  input_count INTEGER DEFAULT 0,
  output_format TEXT,
  metadata TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 多模态制品表
CREATE TABLE multimodal_artifacts (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  artifact_type TEXT NOT NULL,      -- input-image, input-audio, input-document, ocr-text, transcription, output-markdown, output-html, output-chart, output-slides
  modality TEXT,
  content TEXT,
  file_path TEXT,
  metadata TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES multimodal_sessions(id)
);
```

#### 关键文件

| 文件                                                          | 行数 | 职责                 |
| ------------------------------------------------------------- | ---- | -------------------- |
| `src/main/ai-engine/cowork/modality-fusion.js`                | ~600 | 多模态输入融合引擎   |
| `src/main/ai-engine/cowork/document-parser.js`                | ~500 | PDF/DOCX/XLSX 解析   |
| `src/main/ai-engine/cowork/screen-recorder.js`                | ~400 | 屏幕录制与关键帧提取 |
| `src/main/ai-engine/cowork/multimodal-context.js`             | ~450 | 统一上下文构建       |
| `src/main/ai-engine/cowork/multimodal-output.js`              | ~500 | 多格式输出生成       |
| `src/main/ai-engine/cowork/multimodal-collab-ipc.js`          | ~350 | 12 个 IPC handler    |
| `src/main/ai-engine/cowork/skills/builtin/whiteboard-reader/` | ~180 | 白板识别技能         |
| `src/main/ai-engine/cowork/skills/builtin/screen-explainer/`  | ~180 | 屏幕内容解释技能     |
| `src/main/ai-engine/cowork/skills/builtin/voice-programmer/`  | ~180 | 语音编程技能         |

#### KPI 度量

| 指标           | 目标   | 度量方式                      |
| -------------- | ------ | ----------------------------- |
| 支持模态数     | ≥ 5    | 已注册模态类型计数            |
| OCR 识别准确率 | > 95%  | 正确字符 / 总字符             |
| 语音转录准确率 | > 90%  | 正确词语 / 总词语（WER）      |
| 文档解析成功率 | > 98%  | 成功解析 / 总请求             |
| 上下文融合延迟 | < 3 秒 | 多模态输入→统一上下文构建耗时 |

---

### v3.3 — 自主运维

**目标**: 代理自动监控、诊断、修复生产环境问题，MTTR < 5 分钟

#### 规划模块

- [ ] **Anomaly Detector** — 统计异常检测引擎（Z-score、IQR、EWMA），多维指标监控（~550 行）
- [ ] **Incident Classifier** — 事故严重度分级 P0-P3，自动关联历史事故（~400 行）
- [ ] **Auto Remediator** — 自动修复编排引擎 + Playbook 系统，支持条件化修复策略（~600 行）
- [ ] **Rollback Manager** — 自动回滚执行器，支持 Git revert、Docker rollback、配置回滚（~450 行）
- [ ] **Alert Manager** — 多通道告警（Webhook/邮件/IM），升级链（P3→P2→P1→P0）（~400 行）
- [ ] **Postmortem Generator** — LLM 驱动的事故报告自动生成，时间线重建 + 根因分析（~350 行）
- [ ] **Autonomous Ops IPC** — 15 个 IPC handler（~450 行）

#### 自主运维架构

```
┌──────────────────────────────────────────────────────────────────┐
│                      指标采集层                                   │
│                                                                    │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────┐ │
│  │ ErrorMonitor│  │ AutoTuner  │  │ Performance │  │ 自定义指标  │ │
│  │ 错误监控    │  │ 性能调优    │  │ Monitor     │  │ 用户定义    │ │
│  └──────┬─────┘  └──────┬─────┘  └──────┬─────┘  └──────┬─────┘ │
└─────────┼───────────────┼───────────────┼───────────────┼────────┘
          │               │               │               │
          └───────────────┴───────┬───────┴───────────────┘
                                  ▼
┌──────────────────────────────────────────────────────────────────┐
│                    Anomaly Detector                               │
│                                                                    │
│  ┌─────────┐    ┌─────────┐    ┌─────────┐                      │
│  │ Z-Score  │    │  IQR    │    │  EWMA   │                      │
│  │ 突变检测  │    │ 离群检测 │    │ 趋势检测 │                      │
│  └─────────┘    └─────────┘    └─────────┘                      │
└──────────────────────┬───────────────────────────────────────────┘
                       │ 异常事件
                       ▼
┌──────────────────────────────────────────────────────────────────┐
│                   Incident Classifier                             │
│                                                                    │
│  P0 (致命)  │  P1 (严重)  │  P2 (一般)  │  P3 (轻微)           │
└──────────────────────┬───────────────────────────────────────────┘
                       │
              ┌────────┴────────┐
              ▼                 ▼
┌──────────────────┐  ┌──────────────────┐
│  Auto Remediator  │  │  Alert Manager   │
│                   │  │                   │
│  Playbook 匹配    │  │  多通道告警       │
│  条件化修复执行    │  │  升级链触发       │
└────────┬─────────┘  └──────────────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌────────┐ ┌────────┐
│ 修复成功│ │ 修复失败│
│        │ │        │
│ 记录   │ │ Rollback│
│ Instinct│ │ Manager │
└────────┘ └────────┘
              │
              ▼
       ┌──────────────┐
       │  Postmortem   │
       │  Generator    │
       │  LLM 报告生成 │
       └──────────────┘
```

#### 分阶段实现

**Phase A — 异常检测（Month 1-2）**:

- [ ] AnomalyDetector 实现：Z-score 突变、IQR 离群值、EWMA 趋势检测
- [ ] 基线管理：自动采集历史指标建立正常基线
- [ ] IncidentClassifier 实现：P0-P3 严重度分级、历史事故关联
- [ ] 集成 ErrorMonitor + PerformanceMonitor 作为指标源
- [ ] 基础 IPC（6 个）：get-incidents、get-incident-detail、acknowledge、get-baseline、update-baseline、get-config

**Phase B — 自动修复（Month 3-4）**:

- [ ] AutoRemediator 实现：Playbook YAML 定义、条件匹配、修复步骤执行
- [ ] RollbackManager 实现：Git revert、Docker image rollback、配置回滚
- [ ] AlertManager 实现：Webhook/邮件/IM 多通道、P3→P0 升级链
- [ ] 扩展 IPC（+6 个）：resolve、get-playbooks、create-playbook、update-playbook、trigger-remediation、rollback

**Phase C — 自学习与报告（Month 5-6）**:

- [ ] PostmortemGenerator 实现：时间线重建、根因分析、改进建议、LLM 生成报告
- [ ] Instinct 集成：成功修复路径自动沉淀为 ERROR_FIX 类 instinct
- [ ] 自适应基线：基线随时间自动漂移适应系统演进
- [ ] 完善 IPC（+3 个）：configure-alerts、generate-postmortem、get-alerts

#### v3.3 IPC 通道（15 个）

**Incident Management（4 个）**:

| 通道                      | 功能           |
| ------------------------- | -------------- |
| `ops:get-incidents`       | 获取事故列表   |
| `ops:get-incident-detail` | 获取事故详情   |
| `ops:acknowledge`         | 确认事故       |
| `ops:resolve`             | 标记事故已解决 |

**Remediation（5 个）**:

| 通道                      | 功能               |
| ------------------------- | ------------------ |
| `ops:get-playbooks`       | 获取 Playbook 列表 |
| `ops:create-playbook`     | 创建新 Playbook    |
| `ops:update-playbook`     | 更新 Playbook      |
| `ops:trigger-remediation` | 触发自动修复       |
| `ops:rollback`            | 执行回滚           |

**Monitoring & Config（6 个）**:

| 通道                      | 功能         |
| ------------------------- | ------------ |
| `ops:get-alerts`          | 获取告警列表 |
| `ops:configure-alerts`    | 配置告警规则 |
| `ops:get-baseline`        | 获取指标基线 |
| `ops:update-baseline`     | 更新指标基线 |
| `ops:generate-postmortem` | 生成事故报告 |
| `ops:get-config`          | 获取运维配置 |

#### 代码示例

```javascript
// 配置异常检测基线
await ipcRenderer.invoke("ops:update-baseline", {
  metrics: [
    { name: "error_rate", method: "z-score", threshold: 3.0, window: "5m" },
    {
      name: "response_time_p99",
      method: "ewma",
      alpha: 0.3,
      threshold: 2000,
    },
    {
      name: "memory_usage",
      method: "iqr",
      multiplier: 1.5,
      window: "15m",
    },
  ],
});

// 创建修复 Playbook
await ipcRenderer.invoke("ops:create-playbook", {
  name: "high-memory-remediation",
  trigger: {
    metric: "memory_usage",
    condition: "above_threshold",
    severity: "P2",
  },
  steps: [
    { action: "restart-service", target: "ai-service", timeout: 30000 },
    { action: "clear-cache", target: "embedding-cache" },
    {
      action: "scale-down",
      target: "worker-pool",
      params: { minWorkers: 1 },
    },
  ],
  rollbackOnFailure: true,
  notifyChannels: ["webhook", "email"],
});

// 查询事故详情
const incident = await ipcRenderer.invoke("ops:get-incident-detail", {
  incidentId: "inc-xyz789",
});
// → {
//     id: "inc-xyz789", severity: "P1", status: "remediated",
//     anomaly: { metric: "error_rate", value: 15.2, baseline: 2.1, method: "z-score" },
//     remediation: { playbook: "high-error-remediation", steps: [...], duration: 45000 },
//     timeline: [...]
//   }

// 生成事故报告
const postmortem = await ipcRenderer.invoke("ops:generate-postmortem", {
  incidentId: "inc-xyz789",
  includeTimeline: true,
  includeRootCause: true,
  includeSuggestions: true,
});
// → { report: "# 事故报告 inc-xyz789\n\n## 时间线\n...\n## 根因分析\n...", format: "markdown" }
```

#### 数据库 Schema（v3.3 新增 3 表）

```sql
-- 运维事故记录
CREATE TABLE ops_incidents (
  id TEXT PRIMARY KEY,
  severity TEXT NOT NULL,           -- P0, P1, P2, P3
  status TEXT DEFAULT 'open',       -- open, acknowledged, remediating, remediated, resolved, escalated
  anomaly_metric TEXT,
  anomaly_value REAL,
  anomaly_method TEXT,              -- z-score, iqr, ewma
  baseline_value REAL,
  playbook_id TEXT,
  remediation_result TEXT,
  rollback_executed INTEGER DEFAULT 0,
  alert_channels TEXT DEFAULT '[]',
  postmortem TEXT,
  timeline TEXT DEFAULT '[]',
  created_at TEXT DEFAULT (datetime('now')),
  acknowledged_at TEXT,
  resolved_at TEXT
);

-- 修复 Playbook 定义
CREATE TABLE ops_remediation_playbooks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  trigger_config TEXT DEFAULT '{}',
  steps TEXT DEFAULT '[]',
  rollback_on_failure INTEGER DEFAULT 1,
  notify_channels TEXT DEFAULT '[]',
  success_count INTEGER DEFAULT 0,
  failure_count INTEGER DEFAULT 0,
  avg_duration_ms INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 指标基线定义
CREATE TABLE ops_metrics_baseline (
  id TEXT PRIMARY KEY,
  metric_name TEXT NOT NULL UNIQUE,
  detection_method TEXT NOT NULL,   -- z-score, iqr, ewma
  threshold REAL,
  window TEXT DEFAULT '5m',
  params TEXT DEFAULT '{}',         -- method-specific: alpha, multiplier, etc.
  baseline_values TEXT DEFAULT '[]',
  last_calibrated TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
```

#### 关键文件

| 文件                                                | 行数 | 职责                     |
| --------------------------------------------------- | ---- | ------------------------ |
| `src/main/ai-engine/cowork/anomaly-detector.js`     | ~550 | 统计异常检测（3 种算法） |
| `src/main/ai-engine/cowork/incident-classifier.js`  | ~400 | 事故分级 P0-P3           |
| `src/main/ai-engine/cowork/auto-remediator.js`      | ~600 | 自动修复编排 + Playbook  |
| `src/main/ai-engine/cowork/rollback-manager.js`     | ~450 | 自动回滚执行             |
| `src/main/ai-engine/cowork/alert-manager.js`        | ~400 | 多通道告警 + 升级链      |
| `src/main/ai-engine/cowork/postmortem-generator.js` | ~350 | LLM 事故报告生成         |
| `src/main/ai-engine/cowork/autonomous-ops-ipc.js`   | ~450 | 15 个 IPC handler        |

#### KPI 度量

| 指标            | 目标     | 度量方式                   |
| --------------- | -------- | -------------------------- |
| MTTR            | < 5 分钟 | 事故检测→解决耗时          |
| 自动修复成功率  | > 80%    | 成功修复 / 总触发数        |
| 误报率          | < 5%     | 误报事故 / 总检测事故      |
| 告警响应时间    | < 30 秒  | 异常检测→告警发送耗时      |
| Playbook 覆盖率 | > 70%    | Playbook 匹配事故 / 总事故 |

---

### v4.0 — 去中心化代理网络

**目标**: 基于 DID 的代理身份认证和跨组织协作，支持 100+ 节点

#### 规划模块

- [ ] **Agent DID** — Agent DID 创建/解析/能力证明，基于现有 DID 系统扩展代理身份（~650 行）
- [ ] **Federated Agent Registry** — KadDHT 跨组织代理发现，去中心化技能索引（~700 行）
- [ ] **Agent Credential Manager** — 可验证凭证（Verifiable Credentials）签发与验证（~500 行）
- [ ] **Cross-Org Task Router** — 跨组织任务路由与委派，支持权限控制和计费（~600 行）
- [ ] **Agent Reputation** — 去中心化信誉评分系统，基于任务完成率和质量评分（~450 行）
- [ ] **Agent Authenticator** — DID 互认证协议，跨组织信任链建立（~400 行）
- [ ] **Decentralized Network IPC** — 20 个 IPC handler（~500 行）

#### 去中心化代理网络架构

```
                        ┌─────────────────────────┐
                        │     KadDHT Network       │
                        │   去中心化发现协议        │
                        └────────────┬────────────┘
                                     │
               ┌─────────────────────┼─────────────────────┐
               │                     │                     │
               ▼                     ▼                     ▼
┌──────────────────────┐ ┌──────────────────────┐ ┌──────────────────────┐
│   组织 A              │ │   组织 B              │ │   组织 C              │
│                       │ │                       │ │                       │
│  ┌─────────────────┐ │ │  ┌─────────────────┐ │ │  ┌─────────────────┐ │
│  │  Agent DID       │ │ │  │  Agent DID       │ │ │  │  Agent DID       │ │
│  │  did:cc:agent-A1 │ │ │  │  did:cc:agent-B1 │ │ │  │  did:cc:agent-C1 │ │
│  └────────┬────────┘ │ │  └────────┬────────┘ │ │  └────────┬────────┘ │
│           │           │ │           │           │ │           │           │
│  ┌────────┴────────┐ │ │  ┌────────┴────────┐ │ │  ┌────────┴────────┐ │
│  │ Credential Mgr   │ │ │  │ Credential Mgr   │ │ │  │ Credential Mgr   │ │
│  │ VC 签发/验证     │ │ │  │ VC 签发/验证     │ │ │  │ VC 签发/验证     │ │
│  └────────┬────────┘ │ │  └────────┬────────┘ │ │  └────────┬────────┘ │
│           │           │ │           │           │ │           │           │
│  ┌────────┴────────┐ │ │  ┌────────┴────────┐ │ │  ┌────────┴────────┐ │
│  │ Cowork Engine    │ │ │  │ Cowork Engine    │ │ │  │ Cowork Engine    │ │
│  │ 95+ Skills       │ │ │  │ 95+ Skills       │ │ │  │ 95+ Skills       │ │
│  └─────────────────┘ │ │  └─────────────────┘ │ │  └─────────────────┘ │
└──────────────────────┘ └──────────────────────┘ └──────────────────────┘
               │                     │                     │
               └─────────────────────┼─────────────────────┘
                                     │
                        ┌────────────┴────────────┐
                        │  Cross-Org Task Router   │
                        │  跨组织任务路由           │
                        │                          │
                        │  ┌──────────────────┐   │
                        │  │ Agent Reputation   │   │
                        │  │ 信誉评分 + 排名    │   │
                        │  └──────────────────┘   │
                        └─────────────────────────┘
```

#### 分阶段实现

**Phase A — Agent DID 身份（Month 7-8）**:

- [ ] AgentDID 实现：基于现有 DID 系统扩展代理身份，DID Document 包含技能能力声明
- [ ] AgentAuthenticator 实现：DID 互认证协议（Challenge-Response），跨组织信任链
- [ ] AgentCredentialManager 基础：VC 签发（能力证明、任务完成证明）
- [ ] 基础 IPC（8 个）：agent-did:create、agent-did:resolve、agent-did:get-all、agent-did:revoke、agent-cred:issue、agent-cred:verify、agent-cred:revoke、decentralized:get-config

**Phase B — 联邦发现与路由（Month 8-9）**:

- [ ] FederatedAgentRegistry 实现：KadDHT 去中心化代理发现，技能索引广播
- [ ] CrossOrgTaskRouter 实现：跨组织任务委派、权限校验、结果回传
- [ ] 集成现有 P2P Agent Network：复用 WebRTC DataChannel 作为传输层
- [ ] 扩展 IPC（+7 个）：fed-registry:discover、fed-registry:register、fed-registry:query-skills、fed-registry:get-network-stats、cross-org:route-task、cross-org:get-task-status、cross-org:cancel-task

**Phase C — 信誉与扩展（Month 9-12）**:

- [ ] AgentReputation 实现：基于任务完成率、质量评分、响应时间的多维信誉模型
- [ ] 信誉排名：去中心化 PageRank 式排名算法
- [ ] 信誉激励：高信誉代理优先接收任务
- [ ] 完善 IPC（+5 个）：cross-org:get-log、reputation:get-score、reputation:get-ranking、reputation:update、reputation:get-history
- [ ] 100+ 节点压力测试 + 加固优化

#### v4.0 IPC 通道（20 个）

**Agent DID（4 个）**:

| 通道                | 功能                    |
| ------------------- | ----------------------- |
| `agent-did:create`  | 创建 Agent DID          |
| `agent-did:resolve` | 解析 Agent DID Document |
| `agent-did:get-all` | 获取所有 Agent DID      |
| `agent-did:revoke`  | 吊销 Agent DID          |

**Federated Registry（4 个）**:

| 通道                             | 功能               |
| -------------------------------- | ------------------ |
| `fed-registry:discover`          | 发现网络中的代理   |
| `fed-registry:register`          | 注册到联邦网络     |
| `fed-registry:query-skills`      | 查询网络技能可用性 |
| `fed-registry:get-network-stats` | 获取网络统计       |

**Agent Credentials（3 个）**:

| 通道                | 功能           |
| ------------------- | -------------- |
| `agent-cred:issue`  | 签发可验证凭证 |
| `agent-cred:verify` | 验证凭证有效性 |
| `agent-cred:revoke` | 吊销凭证       |

**Cross-Org Task Routing（4 个）**:

| 通道                        | 功能               |
| --------------------------- | ------------------ |
| `cross-org:route-task`      | 跨组织任务路由     |
| `cross-org:get-task-status` | 查询跨组织任务状态 |
| `cross-org:cancel-task`     | 取消跨组织任务     |
| `cross-org:get-log`         | 获取跨组织任务日志 |

**Reputation & Config（5 个）**:

| 通道                       | 功能                 |
| -------------------------- | -------------------- |
| `reputation:get-score`     | 获取代理信誉评分     |
| `reputation:get-ranking`   | 获取信誉排名         |
| `reputation:update`        | 更新信誉数据         |
| `reputation:get-history`   | 获取信誉变化历史     |
| `decentralized:get-config` | 获取去中心化网络配置 |

#### 代码示例

```javascript
// 创建 Agent DID
const agentDid = await ipcRenderer.invoke("agent-did:create", {
  name: "code-review-specialist",
  skills: ["code-review", "security-audit", "test-generator"],
  organization: "org-chainlesschain",
  capabilities: {
    maxConcurrency: 5,
    supportedLanguages: ["javascript", "typescript", "python"],
    gpuAvailable: true,
  },
});
// → {
//     did: "did:cc:agent-abc123",
//     document: { id: "did:cc:agent-abc123", skills: [...], capabilities: {...} },
//     credentials: []
//   }

// 联邦网络技能发现
const agents = await ipcRenderer.invoke("fed-registry:query-skills", {
  skillId: "security-audit",
  minReputation: 0.8,
  maxLatency: 5000,
});
// → [
//     { did: "did:cc:agent-xyz789", org: "org-securitylab", reputation: 0.95, latency: 120 },
//     { did: "did:cc:agent-def456", org: "org-devteam", reputation: 0.87, latency: 230 }
//   ]

// 跨组织任务委派
const task = await ipcRenderer.invoke("cross-org:route-task", {
  targetDid: "did:cc:agent-xyz789",
  skillId: "security-audit",
  input: {
    repository: "https://github.com/org/repo",
    branch: "main",
  },
  credential: credentialJwt, // 能力证明
  timeout: 300000,
  budget: { maxTokens: 50000 },
});
// → { taskId: "cross-task-001", status: "delegated", estimatedCompletion: "2026-07-15T10:30:00Z" }

// 查询信誉评分
const reputation = await ipcRenderer.invoke("reputation:get-score", {
  did: "did:cc:agent-abc123",
});
// → {
//     score: 0.92,
//     dimensions: { completionRate: 0.95, qualityScore: 0.88, responseTime: 0.93 },
//     totalTasks: 156, rank: 12, percentile: 95
//   }
```

#### 数据库 Schema（v4.0 新增 3 表）

```sql
-- Agent DID 注册表
CREATE TABLE agent_dids (
  did TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  organization TEXT,
  skills TEXT DEFAULT '[]',
  capabilities TEXT DEFAULT '{}',
  did_document TEXT DEFAULT '{}',
  credentials TEXT DEFAULT '[]',
  status TEXT DEFAULT 'active',     -- active, suspended, revoked
  public_key TEXT,
  private_key_encrypted TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 代理信誉记录
CREATE TABLE agent_reputation (
  id TEXT PRIMARY KEY,
  agent_did TEXT NOT NULL,
  score REAL DEFAULT 0.5,
  completion_rate REAL DEFAULT 0,
  quality_score REAL DEFAULT 0,
  response_time_score REAL DEFAULT 0,
  total_tasks INTEGER DEFAULT 0,
  successful_tasks INTEGER DEFAULT 0,
  failed_tasks INTEGER DEFAULT 0,
  feedback_history TEXT DEFAULT '[]',
  rank INTEGER,
  last_updated TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (agent_did) REFERENCES agent_dids(did)
);

-- 联邦任务日志
CREATE TABLE federated_task_log (
  id TEXT PRIMARY KEY,
  source_did TEXT NOT NULL,
  target_did TEXT NOT NULL,
  source_org TEXT,
  target_org TEXT,
  skill_id TEXT NOT NULL,
  input TEXT DEFAULT '{}',
  result TEXT,
  status TEXT DEFAULT 'pending',    -- pending, delegated, accepted, running, completed, failed, cancelled
  credential_jwt TEXT,
  budget TEXT DEFAULT '{}',
  latency_ms INTEGER,
  delegated_at TEXT DEFAULT (datetime('now')),
  completed_at TEXT
);
```

#### 关键文件

| 文件                                                     | 行数 | 职责                         |
| -------------------------------------------------------- | ---- | ---------------------------- |
| `src/main/ai-engine/cowork/agent-did.js`                 | ~650 | Agent DID 创建/解析/能力证明 |
| `src/main/ai-engine/cowork/federated-agent-registry.js`  | ~700 | KadDHT 联邦代理发现          |
| `src/main/ai-engine/cowork/agent-credential-manager.js`  | ~500 | 可验证凭证签发与验证         |
| `src/main/ai-engine/cowork/cross-org-task-router.js`     | ~600 | 跨组织任务路由               |
| `src/main/ai-engine/cowork/agent-reputation.js`          | ~450 | 去中心化信誉系统             |
| `src/main/ai-engine/cowork/agent-authenticator.js`       | ~400 | DID 互认证协议               |
| `src/main/ai-engine/cowork/decentralized-network-ipc.js` | ~500 | 20 个 IPC handler            |

#### KPI 度量

| 指标             | 目标    | 度量方式                    |
| ---------------- | ------- | --------------------------- |
| 网络节点数       | ≥ 100   | KadDHT 活跃节点计数         |
| 跨组织任务成功率 | > 90%   | 成功完成 / 总委派数         |
| DID 认证延迟     | < 500ms | Challenge-Response 往返耗时 |
| 技能发现延迟     | < 2 秒  | 查询发起→结果返回耗时       |
| 信誉更新一致性   | > 99%   | 最终一致性收敛率            |

---

### 实现时间线总览

```
Month 1-2:   Phase 3.0.A (流水线框架)        + Phase 3.3.A (异常检测)
Month 2-3:   Phase 3.1.A (Spec 翻译引擎)     + Phase 3.2.A (文档/图像融合)
Month 3-4:   Phase 3.0.B (代理集成)           + Phase 3.3.B (自动修复)
Month 4-5:   Phase 3.1.B (约定分析与代码生成) + Phase 3.2.B (语音/屏幕)
Month 5-6:   Phase 3.0.C (部署与监控)         + Phase 3.3.C (自学习与报告)
Month 6-7:   Phase 3.1.C (交互精炼)           + Phase 3.2.C (富输出生成)
Month 7-9:   Phase 4.0.A-B (Agent DID + 联邦发现与路由)
Month 9-12:  Phase 4.0.C (信誉与扩展) + 全系统加固优化
```

#### 新增总量预估

| 方向             | 版本 | 新增模块 | 新增行数    | IPC 通道 | 数据库表 | 新技能 |
| ---------------- | ---- | -------- | ----------- | -------- | -------- | ------ |
| 全自动开发流水线 | v3.0 | 5        | ~2,400      | 15       | 3        | 0      |
| 自然语言编程     | v3.1 | 4        | ~1,750      | 10       | 2        | 1      |
| 多模态协作       | v3.2 | 9        | ~3,340      | 12       | 2        | 3      |
| 自主运维         | v3.3 | 7        | ~3,200      | 15       | 3        | 0      |
| 去中心化代理网络 | v4.0 | 7        | ~3,800      | 20       | 3        | 0      |
| **合计**         | —    | **32**   | **~14,490** | **72**   | **13**   | **4**  |

### 路线图总览

| 版本   | 功能                   | 核心技术                            | 状态      |
| ------ | ---------------------- | ----------------------------------- | --------- |
| v1.1.0 | 技能生态与工作流集成   | Pipeline、Vue Flow、Git Hooks       | ✅ 已完成 |
| v1.2.0 | 专业化代理与智能调度   | Instinct、Orchestrate、Verification | ✅ 已完成 |
| v1.3.0 | ML 调度与 CI/CD 优化   | 线性回归、负载均衡、OpenAPI 3.0     | ✅ 已完成 |
| v2.0.0 | 跨设备协作与分布式执行 | WebRTC P2P、REST API、Webhook       | ✅ 已完成 |
| v2.1.0 | 自进化与知识图谱       | 知识图谱、Prompt 优化、辩论审查     | ✅ 已完成 |
| v3.0   | 全自动开发流水线       | Pipeline 编排、需求解析、自动部署   | 🔮 规划中 |
| v3.1   | 自然语言编程           | NL→Spec 翻译、约定分析、代码生成    | 🔮 规划中 |
| v3.2   | 多模态协作             | 模态融合、文档/语音/屏幕解析        | 🔮 规划中 |
| v3.3   | 自主运维               | 异常检测、自动修复、告警升级        | 🔮 规划中 |
| v4.0   | 去中心化代理网络       | Agent DID、联邦发现、跨组织路由     | 🔮 规划中 |

## 贡献指南

欢迎贡献代码和反馈问题！

- [GitHub Issues](https://github.com/chainlesschain/issues)
- [贡献指南](https://github.com/chainlesschain/CONTRIBUTING.md)

## 许可证

MIT License - 详见 [LICENSE](https://github.com/chainlesschain/LICENSE)

---

**代码行数**: ~42,000 行 (含测试和文档, 含 v3.0-v4.0 规划 ~14,490 行)
**IPC 处理器**: 238 个 (166 已实现 + 72 规划: 15 v3.0 dev-pipeline + 10 v3.1 + 12 v3.2 + 15 v3.3 + 20 v4.0)
**内置技能**: 99 个 (95 已实现 + 4 规划: 1 v3.1 nl-program + 3 v3.2 多模态技能)
**数据库表**: 21 张新表 (8 已实现 + 13 规划: 3 v3.0 + 2 v3.1 + 2 v3.2 + 3 v3.3 + 3 v4.0)
**流水线模板**: 10 个预置模板
**跨设备支持**: Desktop + Android + iOS + Cloud (4 平台)
**API 端点**: 20+ RESTful 端点 + SSE 实时推送
**Webhook 事件**: 17 种事件类型
**测试用例**: 440+ (通过率 99.6%)
**维护者**: ChainlessChain Team
