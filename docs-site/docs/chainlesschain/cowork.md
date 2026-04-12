# Cowork 多智能体协作系统

> **版本: v4.0 | 状态: ✅ 生产就绪 | 238 IPC Handlers | 95 内置技能 | 21 数据库表 | ~90% 测试覆盖率**

## 概述

Cowork 是 ChainlessChain 的生产级多智能体协作系统，基于 Claude Code 的 TeammateTool 设计模式实现，提供智能任务分配、并行执行和协同工作流能力。系统包含 95 个内置技能、13 核心操作、文件沙箱、Agent 池化、P2P 跨设备代理网络和去中心化代理联邦等完整功能矩阵。

ChainlessChain Cowork 是一个生产级的多智能体协作系统，基于 Claude Code 的 TeammateTool 设计模式实现。它为复杂任务提供智能的任务分配、并行执行和协同工作流能力，包含 13 核心操作、FileSandbox 安全沙箱、长时任务管理、Agent 池化、95 内置技能、技能流水线引擎、可视化工作流编辑器、Git Hooks 集成、Instinct 学习系统、Orchestrate 编排工作流、Verification Loop 验证流水线、**P2P 跨设备代理网络、设备能力发现、混合执行策略、Computer Use Bridge、RESTful API 服务、Webhook 事件推送**、全自动开发流水线、自然语言编程（NL→Spec）、多模态协作（音视频/图像/文档融合）、自主运维（异常检测/自动修复/告警）以及**去中心化代理网络（Agent DID / 联邦发现 / 跨组织路由 / 信誉系统）**。

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
- 🔩 **全自动开发流水线** (v3.0): DAG 流水线编排，需求→Spec→代码→部署→监控全链路自动化
- 💬 **自然语言编程** (v3.1): NL→Spec 翻译（9 种意图分类），约定分析，代码生成，交互精炼
- 🖼️ **多模态协作** (v3.2): 音频/图像/文档/屏幕/文本五模态融合，富输出（MD/HTML/ECharts/幻灯片）
- 🚨 **自主运维** (v3.3): 异常检测，Playbook 自动修复，多通道告警升级（P0-P3），故障后分析报告
- 🪪 **Agent DID 身份** (v4.0): W3C DID 规范，Ed25519 密钥对，可验证凭证（Capability/Delegation/Membership）
- 🌐 **联邦代理发现** (v4.0): KadDHT 去中心化发现，跨组织技能查询，实时延迟感知路由
- 🔀 **跨组织任务路由** (v4.0): 凭证证明委派，SLA 预算控制，任务状态追踪，全程审计日志
- ⭐ **信誉系统** (v4.0): 动态评分（完成率/质量/响应时间/近期活跃），衰减机制，排名百分位

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

## 使用示例

### Debate Review 多视角代码评审

```bash
# 对指定文件发起多视角辩论式评审（性能/安全/可维护性三个视角）
chainlesschain cowork debate src/main/database.js

# 仅评审安全视角，输出详细报告
chainlesschain cowork debate src/auth/login.js --perspectives security --verbose

# 对整个目录进行批量辩论评审
chainlesschain cowork debate src/main/ai-engine/ --recursive
```

### A/B 方案对比

```bash
# 对同一需求生成两个方案并自动对比（含基准测试）
chainlesschain cowork compare "实现一个高性能的本地缓存模块"

# 指定对比维度：性能、内存占用、代码复杂度
chainlesschain cowork compare "用户认证方案" --criteria performance,security,complexity

# 对比两个已有文件的实现方案
chainlesschain cowork compare --file-a src/cache-v1.js --file-b src/cache-v2.js
```

### 代码知识图谱分析

```bash
# 分析项目代码结构，构建实体/关系知识图谱
chainlesschain cowork analyze src/main/ --mode knowledge-graph

# 检测循环依赖并输出依赖链
chainlesschain cowork analyze src/main/ --mode knowledge-graph --detect-cycles

# 分析项目编码风格并提取模式
chainlesschain cowork analyze src/ --mode style

# 查看 Cowork 系统运行状态（团队数/任务数/代理池）
chainlesschain cowork status
```

## 相关文档

- [快速入门指南 →](/guide/cowork-quick-start)
- [Skills 技能系统 →](/chainlesschain/skills)
- [Computer Use →](/chainlesschain/computer-use)
- [权限系统 →](/chainlesschain/permissions)
- [Hooks 系统 →](/chainlesschain/hooks)
- [Plan Mode →](/chainlesschain/plan-mode)
- [Session Manager →](/chainlesschain/session-manager)

---

> 本文档为 Cowork 核心功能参考。更多高级功能和路线图请参阅：
>
> - [Cowork 高级功能（v1.1.0-v2.1.0）](/chainlesschain/cowork-advanced)
> - [Cowork 路线图（v3.0-v4.0）](/chainlesschain/cowork-roadmap)
