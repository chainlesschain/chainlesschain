# Cowork 多智能体协作系统

> **适用版本：CLI 0.163.1（npm latest、源码包元数据与生产推荐一致）| P2-16 Agent Teams 发布门已通过 | 状态：Cowork 命令可用，运行时测试持续维护**
>
> 本文同时说明当前 CLI 与历史桌面端 Cowork。日常使用请优先参考“快速开始”和 CLI 章节；桌面 IPC 数量、历史性能基线与模块行数仅用于回归和演进追踪，不代表当前 CLI 的服务等级。Cowork 与基于 DAG / lease / queue 的 `cc team` 是两个不同入口，大规模团队协作请参阅 [Agent Team 用户指南](./cli-team.md)。

## 概述

Cowork 是 ChainlessChain 的生产级多智能体协作系统，基于 Claude Code 的 TeammateTool 设计模式实现，提供智能任务分配、并行执行和协同工作流能力。系统包含 146 个内置技能、13 核心操作、文件沙箱、Agent 池化、P2P 跨设备代理网络和去中心化代理联邦等完整功能矩阵。

ChainlessChain Cowork 是一个生产级的多智能体协作系统，基于 Claude Code 的 TeammateTool 设计模式实现。它为复杂任务提供智能的任务分配、并行执行和协同工作流能力，包含 13 核心操作、FileSandbox 安全沙箱、长时任务管理、Agent 池化、146 个内置技能、技能流水线引擎、可视化工作流编辑器、Git Hooks 集成、Instinct 学习系统、Orchestrate 编排工作流、Verification Loop 验证流水线、**P2P 跨设备代理网络、设备能力发现、混合执行策略、Computer Use Bridge、RESTful API 服务、Webhook 事件推送**、全自动开发流水线、自然语言编程（NL→Spec）、多模态协作（音视频/图像/文档融合）、自主运维（异常检测/自动修复/告警）以及**去中心化代理网络（Agent DID / 联邦发现 / 跨组织路由 / 信誉系统）**。

### 当前 CLI 能力边界

当前 CLI Cowork 入口包含：多视角辩论评审、A/B 方案比较、代码分析、任务模板、Cron 调度、签名共享包、DAG 工作流、运行观察、历史学习，以及协调器/Runner V2 管理命令。`debate`、`compare` 和 `analyze` 使用已配置的 LLM provider，并可通过命令行覆盖 provider/model；知识图谱分析及多数本地管理命令不调用 LLM。协调器、Runner 及其他 `*-v2` 命令属于治理/开发者接口，日常使用通常不需要直接调用。

本文按以下模块组织：

| 模块                  | 内容                                          |
| --------------------- | --------------------------------------------- |
| [快速开始](#快速开始) | 环境检查、模型配置和第一个任务                |
| [系统架构](#系统架构) | CLI 与桌面端层次、任务执行和持久化边界        |
| [配置参考](#配置参考) | CLI、TeammateTool、FileSandbox 和长时任务参数 |
| [性能指标](#性能指标) | 当前 CLI 边界、测量口径和历史桌面基线         |
| [测试覆盖](#测试覆盖) | CLI/Web unit、integration、E2E 与历史桌面覆盖 |
| [安全考虑](#安全考虑) | 文件、凭据、沙箱、模板、传输与审计边界        |
| [故障排查](#故障排查) | CLI、本地状态与桌面 IPC 常见故障              |
| [关键文件](#关键文件) | 当前 CLI/Web 和历史桌面端实现入口             |
| [使用示例](#使用示例) | 评审、分析、工作流、调度、分享与历史学习      |
| [相关文档](#相关文档) | 命令参考、Web 指南、工作流、安全和设计文档    |

## 快速开始

### 1. 检查环境

Cowork CLI 要求 Node.js `>=22.12.0`。安装 CLI 后先检查版本和命令入口：

```bash
node --version
cc --version
cc cowork --help
```

从源码运行时，可在仓库根目录使用：

```bash
node packages/cli/bin/chainlesschain.js cowork --help
```

### 2. 配置模型

```bash
# 使用本地 Ollama
cc config set llm.provider ollama
cc config set llm.model qwen2.5:7b

# 或配置云端模型；密钥通过隐藏输入保存，不进入 shell 历史
cc config set llm.provider openai
cc config set llm.model gpt-4o
cc config set-secret llm.apiKey

# 验证当前模型连接
cc llm test --provider openai
```

也可以只对单次命令使用 `--provider` 和 `--model` 覆盖全局配置。

### 3. 运行第一个任务

```bash
# 不调用 LLM，先验证本地分析链路
cc cowork analyze ./src --type knowledge-graph --json

# 多视角代码评审
cc cowork debate ./src/index.js --perspectives security,maintainability

# 查看本地 Cowork 状态
cc cowork status
```

`debate` 既接受文件路径，也接受主题文本；读取文件时最多向评审链路传入前 15,000 个字符。

## 核心特性

- 🤖 **智能编排**: AI 驱动的单/多代理自动决策，三种场景模型
- 👥 **团队协作**: 13 核心操作（TeammateTool），支持投票、消息、检查点
- 🔒 **文件沙箱**: 20+ 敏感文件检测，路径遍历防护，细粒度权限
- ⏱️ **长时任务**: 检查点恢复、智能重试、进度跟踪、超时处理、增量检查点
- 🏊 **Agent 池化**: 能力池化、温复用、内存感知缩池、健康检查
- 🎯 **146 内置技能**: 四层加载、懒加载（历史 90 技能基线启动约提升 87%）、门控检查、热加载/热卸载
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
- ⏰ **Cron 与 DAG 工作流**: 5 字段定时调度、依赖校验、批次并行、流水线和失败降级
- 📦 **模板、分享与学习**: EvoMap 模板、SHA-256/可选 DID 签名、历史推荐与失败归因
- 🔌 **MCP 工具挂载**: 模板声明 MCP server，任务生命周期内自动挂载和卸载
- 🔩 **全自动开发流水线** (v3.0): DAG 流水线编排，需求→Spec→代码→部署→监控全链路自动化
- 💬 **自然语言编程** (v3.1): NL→Spec 翻译（9 种意图分类），约定分析，代码生成，交互精炼
- 🖼️ **多模态协作** (v3.2): 音频/图像/文档/屏幕/文本五模态融合，富输出（MD/HTML/ECharts/幻灯片）
- 🚨 **自主运维** (v3.3): 异常检测，Playbook 自动修复，多通道告警升级（P0-P3），故障后分析报告
- 🪪 **Agent DID 身份** (v4.0): W3C DID 规范，Ed25519 密钥对，可验证凭证（Capability/Delegation/Membership）
- 🌐 **联邦代理发现** (v4.0): KadDHT 去中心化发现，跨组织技能查询，实时延迟感知路由
- 🔀 **跨组织任务路由** (v4.0): 凭证证明委派，SLA 预算控制，任务状态追踪，全程审计日志
- ⭐ **信誉系统** (v4.0): 动态评分（完成率/质量/响应时间/近期活跃），衰减机制，排名百分位

### 当前 CLI 新增能力

在原有桌面端团队协作、文件沙箱、Agent 池和技能体系之外，当前 CLI 已提供以下可组合能力：

| 能力               | 命令入口                            | 说明                                                         |
| ------------------ | ----------------------------------- | ------------------------------------------------------------ |
| 多视角辩论评审     | `cowork debate`                     | 默认从性能、安全、可维护性三个视角并行评审，再汇总共识       |
| A/B 方案生成与评分 | `cowork compare`                    | 默认生成 3 个、最多 4 个方案，按指定维度评分排序             |
| 代码与决策分析     | `cowork analyze`                    | 支持本地知识图谱，以及基于 LLM 的风格和架构决策分析          |
| 模板市场           | `cowork template`                   | 搜索、安装、列出、删除和发布 EvoMap 模板                     |
| Cron 调度          | `cowork cron`                       | 管理 5 字段 cron 计划，并由前台调度循环触发任务              |
| 签名分享包         | `cowork share`                      | 导出、导入和验证模板/结果包，支持校验和及可选 DID 签名       |
| DAG 工作流         | `cowork workflow`                   | 校验依赖与环路，支持批次并行、流水线模式和失败后继续         |
| 观察与学习         | `cowork observe`、`cowork learning` | 汇总近期任务、提供本地只读面板，并从历史中生成推荐和失败归因 |
| MCP 生命周期扩展   | 模板中的 `mcpServers`               | 在任务生命周期内挂载和卸载模板声明的 MCP server              |

上述能力与 `cc team` 的 lease、分布式队列、worktree 和裁决协议互补，但不是同一套命令或状态文件。

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

桌面端 Cowork 当前包含 146 个带 `SKILL.md` 的内置技能，并支持用户、工作区和 Marketplace 扩展。技能数量会随版本变化，准确清单以 `desktop-app-vue/src/main/ai-engine/cowork/skills/builtin/` 为准。

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
│  1. Bundled 技能 (当前 146 个)              │
│     desktop-app-vue/src/main/ai-engine/    │
│     cowork/skills/builtin/                 │
└───────────────────────────────────────────┘
```

### 技能分类（当前 146 个内置技能）

下表按各 `SKILL.md` frontmatter 中的 `category` 统计，合计 146 个：

| 类别            | 数量 | 示例技能                                                         |
| --------------- | ---: | ---------------------------------------------------------------- |
| `development`   |   41 | `ab-compare`、`api-design`、`api-docs-generator`                 |
| `knowledge`     |   16 | `codebase-qa`、`context-loader`、`deep-research`                 |
| `automation`    |    9 | `agent-browser`、`api-gateway`、`browser-automation`             |
| `media`         |    8 | `audio-transcriber`、`image-editor`、`media-metadata`            |
| `data`          |    7 | `chart-creator`、`csv-processor`、`data-analysis`                |
| `workflow`      |    7 | `complete`、`deep-interview`、`orchestrate`                      |
| `devops`        |    6 | `devops-automation`、`env-doctor`、`log-analyzer`                |
| `document`      |    6 | `doc-comparator`、`doc-converter`、`excel-analyzer`              |
| `productivity`  |    6 | `content-publisher`、`google-workspace`、`humanizer`             |
| `system`        |    6 | `backup-manager`、`find-skills`、`free-model-manager`            |
| `security`      |    5 | `crypto-toolkit`、`password-generator`、`security-audit`         |
| `utility`       |    5 | `clipboard-manager`、`file-compressor`、`json-yaml-toolkit`      |
| `ai`            |    4 | `auto-context`、`image-generator`、`multi-model-router`          |
| `analysis`      |    3 | `dependency-analyzer`、`git-history-analyzer`、`impact-analyzer` |
| `documentation` |    3 | `doc-coauthoring`、`doc-generator`、`markdown-enhancer`          |
| `testing`       |    3 | `api-tester`、`bugbot`、`test-and-fix`                           |
| `design`        |    2 | `color-picker`、`frontend-design`                                |
| `general`       |    2 | `brainstorming`、`my-custom-skill`                               |
| `integration`   |    1 | `pdh-android-collector`                                          |
| `remote`        |    1 | `remote-control`                                                 |
| `quality`       |    1 | `verification-loop`                                              |
| `debugging`     |    1 | `fault-localizer`                                                |
| `code-review`   |    1 | `debate-review`                                                  |
| `database`      |    1 | `db-migration`                                                   |
| `learning`      |    1 | `explain-code`                                                   |

技能数量和分类会随源码变化；发布前可重新扫描 `builtin/*/SKILL.md` 更新本表。

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

### 当前 CLI 架构

```text
cc cowork
   │
   ├─ debate / compare / analyze
   │      ├─ cowork adapter ── LLM provider（按需调用）
   │      └─ knowledge graph（本地静态分析）
   │
   ├─ template / cron / workflow
   │      ├─ 任务模板与 SubAgentContext
   │      ├─ 5 字段 cron 调度器
   │      └─ DAG 校验与并行执行器
   │
   └─ share / observe / learning / status
          ├─ SHA-256 + 可选 DID 签名
          ├─ 本地历史聚合
          └─ 模板推荐与失败归因
                    │
                    ▼
       <项目>/.chainlesschain/cowork/
```

`packages/cli/src/commands/cowork.js` 只负责命令注册、参数校验和输出，具体模块在调用子命令时按需加载。CLI 状态默认落在当前项目的 `.chainlesschain/cowork/`，不会写入桌面端 Cowork 数据库。

| 数据         | 默认位置                                              | 格式  |
| ------------ | ----------------------------------------------------- | ----- |
| 调度计划     | `.chainlesschain/cowork/schedules.jsonl`              | JSONL |
| 工作流定义   | `.chainlesschain/cowork/workflows/<id>.json`          | JSON  |
| 工作流历史   | `.chainlesschain/cowork/workflow-history.jsonl`       | JSONL |
| 任务历史     | `.chainlesschain/cowork/history.jsonl`                | JSONL |
| 用户模板     | `.chainlesschain/cowork/user-templates/<id>.json`     | JSON  |
| 导入结果     | `.chainlesschain/cowork/shared-results/<taskId>.json` | JSON  |
| 学习补丁记录 | `.chainlesschain/cowork/learning-patches.jsonl`       | JSONL |

### 桌面端整体架构图

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
│  │                   Skills 框架 (当前 146 内置技能)             │  │
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
  "pending" | "running" | "paused" | "completed" | "failed" | "cancelled";

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

> CLI 与桌面端使用不同配置入口。CLI 复用全局 LLM、权限和项目配置；下面的 TeammateTool、FileSandbox 和 LongRunningTaskManager 对象只适用于桌面端。

### CLI 配置

```bash
# 查看生效值及来源
cc config get llm.provider
cc config get llm.model
cc config explain llm.model

# 设置默认 provider/model
cc config set llm.provider ollama
cc config set llm.model qwen2.5:7b

# 安全写入云端密钥
cc config set-secret llm.apiKey
```

CLI 主配置默认位于 `~/.chainlesschain/config.json`；如果设置 `CHAINLESSCHAIN_HOME`，则使用 `<CHAINLESSCHAIN_HOME>/config.json`。云端 provider 也可从 `ANTHROPIC_API_KEY`、`OPENAI_API_KEY`、`DEEPSEEK_API_KEY`、`DASHSCOPE_API_KEY`、`GEMINI_API_KEY` 或 `MISTRAL_API_KEY` 读取凭据。

`debate`、`compare` 和 `analyze` 支持命令级 `--provider` / `--model` 覆盖。工作流和定时任务由任务执行器读取生效的全局配置。

| 参数                               | 默认值                                 | 作用范围                                  |
| ---------------------------------- | -------------------------------------- | ----------------------------------------- |
| `debate --perspectives`            | `performance,security,maintainability` | 评审视角，可选 correctness/architecture   |
| `compare --variants`               | `3`                                    | 方案数量，最多使用 4 个内置 profile       |
| `compare --criteria`               | `quality,performance,readability`      | 方案评分维度                              |
| `analyze --type`                   | `style`                                | `style`、`knowledge-graph` 或 `decisions` |
| `workflow run --max-parallel`      | `4`                                    | 每批最多并行步骤数                        |
| `workflow run --pipeline`          | 关闭                                   | 依赖满足后立即启动步骤，不等待整批完成    |
| `workflow run --continue-on-error` | 关闭                                   | 步骤失败后继续执行可运行步骤              |
| `cron run --interval`              | `60000` ms                             | 调度器检查周期                            |
| `observe report --days`            | `7`                                    | 聚合窗口天数                              |
| `observe serve --host/--port`      | `127.0.0.1:18820`                      | 只读观察面板监听地址                      |

所有相对路径都以运行命令时的当前工作目录为基准。建议在项目根目录运行 Cowork，以便状态集中写入同一个 `.chainlesschain/cowork/`。

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

CLI Cowork 没有承诺固定响应时间。LLM 延迟受 provider、模型、上下文长度、限流和网络影响；本地知识图谱、签名校验、历史聚合等操作则主要受输入规模和磁盘性能影响。

### 当前 CLI 性能边界

| 场景             | 当前边界/默认值                      | 性能含义                                            |
| ---------------- | ------------------------------------ | --------------------------------------------------- |
| `debate <file>`  | 文件内容截断到 15,000 字符           | 控制每个评审者的上下文规模                          |
| `debate`         | 默认 3 个评审者并行 + 1 次汇总       | 总耗时通常接近最慢评审加汇总，而非 4 次请求串行之和 |
| `compare`        | 默认 3、最多 4 个方案并行 + 1 次评分 | 增加方案数会增加 token 与 provider 并发压力         |
| `workflow run`   | `--max-parallel 4`                   | 限制每批同时执行的步骤数                            |
| `cron run`       | 每 60 秒检查一次                     | 调度触发精度受 `--interval` 影响                    |
| `observe report` | 默认读取最近 7 天                    | 历史文件增长时，聚合耗时和内存会线性增加            |

建议在目标环境中记录“命令总耗时、provider/model、输入字符数、并发数、token 用量和成功率”。例如：

```bash
# Linux / macOS
time cc cowork analyze ./src --type knowledge-graph --json > result.json

# PowerShell
Measure-Command { cc cowork analyze .\src --type knowledge-graph --json | Out-Null }
```

### 历史桌面端基准

下表是历史桌面端基准，仅用于同环境回归比较，不是所有机器上的保证值，也不应作为 CLI SLA。

#### 响应时间

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

#### 资源使用

| 指标         | 数值               |
| ------------ | ------------------ |
| 内存占用     | < 50MB (单团队)    |
| 数据库大小   | ~2MB (1000 个任务) |
| CPU (空闲)   | < 5%               |
| CPU (高负载) | < 30%              |
| 代理池复用率 | ~74%               |

#### 可扩展性

| 限制              | 数值  |
| ----------------- | ----- |
| 最大团队数        | 100+  |
| 最大代理数/团队   | 10    |
| 最大并发任务      | 1000+ |
| 最大检查点数/任务 | 100   |
| 最大授权路径/团队 | 100   |
| 消息队列容量      | 1000  |

## 测试覆盖

### 当前 CLI 与 Web Panel

CLI 包当前包含 35 个 Cowork 专项测试文件：28 个单元测试、3 个集成测试和 4 个 E2E 测试；Web Panel 另有工作流状态测试。覆盖重点如下：

| 层级     | 代表性测试                                                                               | 覆盖内容                              |
| -------- | ---------------------------------------------------------------------------------------- | ------------------------------------- |
| 单元     | `cowork-task-runner.test.js`、`cowork-workflow.test.js`、`cowork-cron.test.js`           | 任务生命周期、DAG、调度与持久化       |
| 单元     | `cowork-share.test.js`、`cowork-learning.test.js`、`cowork-template-marketplace.test.js` | 校验包、模板分层、推荐与失败归因      |
| 单元     | `cowork-mcp-tools.test.js`、`cowork-observe.test.js`                                     | MCP 挂载与观测聚合                    |
| Web 单元 | `workflow-store.test.js`                                                                 | Web 工作流状态管理                    |
| 相关回归 | `agent-sandbox.test.js`、`credential-proxy.test.js`、`session-hooks.test.js`             | 执行沙箱、凭据代理与 Hook 安全边界    |
| 集成     | `cowork-task-workflow.test.js`、`cowork-evolution-workflow.test.js`                      | 真实临时目录、模块组合与持久化往返    |
| E2E      | `cowork-command.test.js`、`cowork-evolution-commands.test.js`                            | CLI 子进程、参数、JSON 输出和错误路径 |
| E2E      | `cowork-task-e2e.test.js`、`cowork-workflow-ws-e2e.test.js`                              | 任务与 WebSocket 工作流端到端链路     |

推荐按层执行：

```bash
cd packages/cli
npm test -- cowork
npm run test:e2e -- cowork

cd ../web-panel
npm test -- workflow-store
```

发布结论以 CI 对准确提交运行的 Linux、Windows、macOS 矩阵为准。本页只描述覆盖面，不用静态用例数推导覆盖率，也不把一次本地通过视为发布门结果。

### 历史桌面端单元测试

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

> **口径说明**：上面的 440+ 测试是历史桌面 Cowork 基线，文件名和数量用于追踪旧版本，不代表当前 CLI 覆盖率。

### 历史桌面端 E2E 测试

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

### 历史桌面端性能测试

- ✅ 代理池 5 分钟热身 + 2 分钟压力测试
- ✅ 并发团队创建 (100+)
- ✅ 高频消息广播 (1000 条/秒)

## 安全考虑

### CLI 安全边界

- **模型数据边界**：`knowledge-graph` 在本地运行；`debate`、`compare`、`style` 和 `decisions` 会把输入发送给所选 provider。评审敏感代码时优先使用本地模型或先脱敏。
- **凭据保护**：使用 `cc config set-secret llm.apiKey` 或 provider 环境变量。不要把 API key、私钥或访问令牌写进 prompt、工作流、模板、历史记录或共享包。
- **统一执行边界**：Cowork 任务的 shell 调用进入 `process-execution-broker` 策略/沙箱链路，credential agent 默认不向任务暴露长效凭据。严格模式下沙箱不可用会拒绝启动；可用 `cc doctor` 核对实际隔离能力。
- **项目状态**：任务提示、摘要和结果会写入项目下的 `.chainlesschain/cowork/*.json(l)`。如内容敏感，应限制目录权限、设置备份策略，并避免将该目录提交到版本控制。
- **只读面板**：`observe serve` 默认绑定 `127.0.0.1`。除非已经配置反向代理认证和网络访问控制，否则不要改成公网监听地址。

### 模板与共享包

校验和只能证明内容未被意外修改，不能证明作者可信；DID 签名能验证来源，也不代表模板本身安全。第三方模板可能声明 MCP server、提示扩展或 shell 策略覆盖，安装和运行前应人工检查。

```bash
# 只安装带签名且来自指定 DID 的模板
cc cowork template install <gene-id> --require-signed --trust <did>

# 导入前先校验；正式导入时同时要求签名与信任列表
cc cowork share verify ./packet.json
cc cowork share import ./packet.json --require-signed --trust <did>
```

模板 ID 会被限制为单一路径段以阻止路径遍历；导入包还会验证 canonical JSON 校验和和可选 Ed25519 签名。即使验证通过，也应把外部模板视为代码级输入进行审查。

### 桌面端安全能力

桌面端 FileSandbox 提供敏感文件模式、路径遍历防护、READ/WRITE/EXECUTE 权限、符号链接检查、文件大小限制和操作审计。桌面数据库是否启用 SQLCipher、检查点是否加密以及 IPC/远程传输保护，取决于实际部署配置；不要仅根据本页示例假定已启用。

#### 文件访问安全

1. **敏感文件检测** — 20+ 内置模式，并支持自定义模式。
2. **路径遍历防护** — 拒绝逃逸授权根目录的 `../` 路径。
3. **权限检查** — READ / WRITE / EXECUTE 三级控制。
4. **符号链接验证** — 防止通过链接绕过沙箱边界。
5. **审计日志** — 记录允许与拒绝的文件操作。
6. **文件大小限制** — 默认示例上限为 100 MB，防止资源耗尽。

#### 数据与代码注入防护

1. **数据库保护** — 部署启用 SQLCipher 时使用加密数据库；密钥不得写入任务提示或日志。
2. **检查点保护** — 检查点包含任务上下文，应结合目录权限和部署级加密保护。
3. **参数验证** — IPC、工作流和模板字段在进入执行层前进行类型与范围检查。
4. **SQL 参数化** — 数据库操作使用参数化语句，避免拼接用户输入。
5. **命令策略** — shell 命令进入统一策略/沙箱链路，第三方模板的策略覆盖必须审查。
6. **输出净化** — Web 页面展示模型或外部内容时使用安全渲染，避免脚本注入。

## 故障排查

### CLI 常见问题

**Q: `cowork` 命令找不到或启动失败？**

确认使用 Node.js `>=22.12.0`，依次执行 `cc --version` 和 `cc cowork --help`。若从源码运行，使用 `node packages/cli/bin/chainlesschain.js cowork --help`，并检查 `packages/cli/src/command-manifest.json` 是否与当前 CLI 版本匹配。

**Q: LLM 请求很慢或任务没有结果？**

先执行 `cc config explain llm.model` 和 `cc llm test --provider <name>`，确认生效的 provider/model、凭据和网络。再用较小输入运行 `cc cowork compare ... --variants 1 --json`；知识图谱模式不调用 LLM，可用于区分本地 CLI 故障和模型服务故障。

**Q: `cowork share import` 或模板导入被拒绝？**

先运行 `cc cowork share verify <file>` 检查 JSON、校验和和签名，再确认 `--trust` 使用的是签名包中的完整 DID。不要关闭 `--require-signed` 来绕过来源校验。

**Q: CLI sandbox 报引擎不可用？**

按配置安装并验证 Docker 或 bubblewrap；严格模式会在启动阶段 fail-closed。需要确认当前实际隔离级别时运行 `cc doctor`，不要仅依据配置文件判断已完成隔离。

**Q: Cron 任务没有触发？**

确认 `cc cowork cron run` 正在前台运行，并在创建计划时使用的同一项目目录启动。检查系统时区、5 字段 cron 表达式和 `cc cowork cron list` 中的 enabled 状态；默认检查周期为 60 秒。

**Q: 工作流提示不存在、依赖无效或出现环？**

使用 `cc cowork workflow show <id>` 检查实际保存内容。步骤 ID 必须唯一，`dependsOn` 只能引用已有步骤且不能形成环；工作流文件必须是合法 JSON。相对路径按当前项目目录解析。

**Q: `observe` 或 `learning` 没有数据？**

这些命令读取当前项目 `.chainlesschain/cowork/` 下的历史。请回到执行任务时的项目目录，并确认 `history.jsonl` 或 `workflow-history.jsonl` 存在。首次使用且没有历史时返回空结果是正常行为。

**Q: 提示 schedule/history JSONL 损坏？**

先备份 `.chainlesschain/cowork/`，再定位报错文件中的非 JSON 行或被截断的最后一行。不要直接删除整个目录；调度计划、历史、工作流和用户模板分别存储，可以只修复受影响的文件。

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

### 当前 CLI 与 Web 入口

| 文件                                                  | 职责                                          |
| ----------------------------------------------------- | --------------------------------------------- |
| `packages/cli/src/commands/cowork.js`                 | CLI 子命令、参数、按需模块加载与输出          |
| `packages/cli/src/lib/cowork/`                        | debate、compare、代码知识图谱、决策和风格分析 |
| `packages/cli/src/lib/cowork-task-templates.js`       | 内置/用户任务模板注册表                       |
| `packages/cli/src/lib/cowork-task-runner.js`          | SubAgent 任务执行、MCP 挂载与历史收口         |
| `packages/cli/src/lib/cowork-workflow.js`             | DAG 校验、持久化、批次/流水线执行             |
| `packages/cli/src/lib/cowork-cron.js`                 | 5 字段 cron 解析、租约与前台调度器            |
| `packages/cli/src/lib/cowork-template-marketplace.js` | 用户模板存储与安全路径校验                    |
| `packages/cli/src/lib/cowork-evomap-adapter.js`       | EvoMap 搜索、安装、发布与签名策略             |
| `packages/cli/src/lib/cowork-share.js`                | 模板/结果包导出、校验、签名和导入             |
| `packages/cli/src/lib/cowork-learning.js`             | 历史统计、推荐、失败归因与补丁建议            |
| `packages/cli/src/lib/cowork-observe.js`              | 任务、工作流和调度历史聚合                    |
| `packages/web-panel/src/views/Cowork.vue`             | Web Cowork 日常任务页面                       |
| `packages/web-panel/src/stores/cowork.js`             | Web Cowork Pinia 状态                         |
| `scripts/cowork-doc-generator.js`                     | Cowork 文档生成辅助脚本                       |

专项测试位于 `packages/cli/__tests__/{unit,integration,e2e}/`，Web 工作流 Store 测试位于 `packages/web-panel/__tests__/unit/workflow-store.test.js`。

### 历史桌面端 v1.0.0 核心文件

下表中的 `src/` 路径均相对于 `desktop-app-vue/`；行数为历史近似值。

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
| `src/main/ai-engine/cowork/skills/builtin/`              | 146 个内置技能定义与 Handler | —      |
| `src/renderer/pages/CoworkDashboard.vue`                 | 仪表板页面                   | ~638   |
| `src/renderer/pages/CoworkAnalytics.vue`                 | 分析页面                     | ~1,080 |
| `src/renderer/stores/cowork.ts`                          | Pinia 状态管理               | ~1,410 |

### 历史桌面端 v1.1.0 新增文件

| 文件                                                          | 职责                                       | 行数 |
| ------------------------------------------------------------- | ------------------------------------------ | ---- |
| `src/main/ai-engine/cowork/skills/skill-pipeline-engine.js`   | 流水线引擎（5 种步骤类型）                 | ~580 |
| `src/main/ai-engine/cowork/skills/pipeline-templates.js`      | 10 预置流水线模板                          | ~470 |
| `src/main/ai-engine/cowork/skills/skill-metrics-collector.js` | 技能指标采集器                             | ~320 |
| `src/main/ai-engine/cowork/skills/skill-pipeline-ipc.js`      | Pipeline IPC（12 handlers）                | ~180 |
| `src/main/ai-engine/cowork/skills/skill-metrics-ipc.js`       | Metrics IPC（5 handlers）                  | ~90  |
| `src/main/ai-engine/cowork/skills/skill-workflow-engine.js`   | 可视化工作流引擎                           | ~350 |
| `src/main/ai-engine/cowork/skills/skill-workflow-ipc.js`      | Workflow IPC（10 handlers）                | ~150 |
| `src/main/hooks/git-hook-runner.js`                           | Git Hook 运行器                            | ~300 |
| `src/main/hooks/git-hook-ipc.js`                              | Git Hook IPC（8 handlers）                 | ~130 |
| `src/renderer/pages/SkillPipelinePage.vue`                    | 流水线编排页（历史版本，当前源码已移除）   | ~163 |
| `src/renderer/pages/WorkflowDesignerPage.vue`                 | 工作流设计器                               | ~209 |
| `src/renderer/pages/SkillPerformancePage.vue`                 | 技能性能仪表板（历史版本，当前源码已移除） | ~122 |
| `src/renderer/pages/GitHooksPage.vue`                         | Git Hooks 管理页                           | ~147 |
| `src/renderer/stores/skill-pipeline.ts`                       | 流水线 Pinia Store                         | —    |
| `src/renderer/stores/skill-metrics.ts`                        | 指标 Pinia Store                           | —    |
| `src/renderer/stores/workflow-designer.ts`                    | 工作流设计器 Store                         | ~284 |
| `src/renderer/stores/git-hooks.ts`                            | Git Hooks Store                            | —    |

### 历史桌面端 v1.2.0 新增文件

| 文件                                                                    | 职责                        | 行数   |
| ----------------------------------------------------------------------- | --------------------------- | ------ |
| `src/main/llm/instinct-manager.js`                                      | Instinct 学习核心引擎       | ~1,100 |
| `src/main/llm/instinct-ipc.js`                                          | Instinct IPC（11 handlers） | ~280   |
| `src/main/ai-engine/cowork/skills/builtin/orchestrate/SKILL.md`         | Orchestrate 技能定义        | ~112   |
| `src/main/ai-engine/cowork/skills/builtin/orchestrate/handler.js`       | Orchestrate 编排引擎        | ~507   |
| `src/main/ai-engine/cowork/skills/builtin/verification-loop/SKILL.md`   | Verification Loop 技能定义  | ~118   |
| `src/main/ai-engine/cowork/skills/builtin/verification-loop/handler.js` | Verification Loop 验证引擎  | ~547   |

### 历史桌面端 v2.0.0 新增文件

| 文件                                               | 职责                          | 行数 |
| -------------------------------------------------- | ----------------------------- | ---- |
| `src/main/ai-engine/cowork/p2p-agent-network.js`   | P2P 代理网络（15 种消息类型） | ~680 |
| `src/main/ai-engine/cowork/device-discovery.js`    | 设备能力发现（4 级分层）      | ~420 |
| `src/main/ai-engine/cowork/hybrid-executor.js`     | 混合执行策略（6 种策略）      | ~510 |
| `src/main/ai-engine/cowork/computer-use-bridge.js` | Computer Use 集成（12 工具）  | ~430 |
| `src/main/ai-engine/cowork/cowork-api-server.js`   | RESTful API 服务（20+ 端点）  | ~520 |
| `src/main/ai-engine/cowork/webhook-manager.js`     | Webhook 事件推送（17 事件）   | ~530 |
| `src/main/ai-engine/cowork/cowork-v2-ipc.js`       | 34 个 IPC Handler             | ~420 |

## 历史前端路由（v1.1.0 新增）

当前源码仍注册工作流设计器和 Git Hooks 路由；流水线编排页、技能性能页及对应路由属于历史版本记录。

| 路由                   | 页面                     | 说明           | 当前源码状态 |
| ---------------------- | ------------------------ | -------------- | ------------ |
| `#/cowork/pipeline`    | SkillPipelinePage.vue    | 流水线编排     | 已移除       |
| `#/cowork/workflow`    | WorkflowDesignerPage.vue | 工作流设计器   | 保留         |
| `#/cowork/performance` | SkillPerformancePage.vue | 技能性能仪表板 | 已移除       |
| `#/cowork/git-hooks`   | GitHooksPage.vue         | Git Hooks 管理 | 保留         |

## npm 新依赖（v1.1.0）

```
@vue-flow/core @vue-flow/background @vue-flow/controls @vue-flow/minimap
```

## 使用示例

以下示例使用短命令 `cc`；npm 包同时提供 `chainlesschain`、`clc` 和 `clchain` 别名，原有脚本无需改名。

### Debate Review 多视角代码评审

```bash
# 对指定文件发起多视角辩论式评审（性能/安全/可维护性三个视角）
cc cowork debate src/main/database.js

# 仅评审安全视角，并输出 JSON 结果
cc cowork debate src/auth/login.js --perspectives security --json
```

### A/B 方案对比

```bash
# 对同一需求生成多个方案并自动评分
cc cowork compare "实现一个高性能的本地缓存模块" --variants 3 --json

# 也可以按性能、安全和复杂度评估
cc cowork compare "用户认证方案" --criteria performance,security,complexity

# 指定 provider/model 和评估维度
cc cowork compare "用户认证方案" \
  --criteria performance,security,readability \
  --provider openai --model gpt-4o
```

### 本地代码分析

```bash
# 构建实体/关系知识图谱，不调用 LLM
cc cowork analyze src/main/ --type knowledge-graph --json

# 使用 LLM 分析项目编码风格
cc cowork analyze src/ --type style

# 从文档和配置中提取架构决策
cc cowork analyze . --type decisions --json
```

### DAG 工作流

将下面内容保存为 `review-workflow.json`：

```json
{
  "id": "daily-review",
  "name": "每日代码检查",
  "steps": [
    {
      "id": "scan",
      "message": "分析 src 目录并找出高风险模块"
    },
    {
      "id": "review",
      "message": "根据扫描摘要给出修复优先级：${step.scan.summary}",
      "dependsOn": ["scan"]
    }
  ]
}
```

```bash
cc cowork workflow add ./review-workflow.json
cc cowork workflow show daily-review
cc cowork workflow run daily-review --max-parallel 2 --pipeline
```

### 定时执行与观察

```bash
# 工作日 09:00 创建一条检查任务
cc cowork cron add --cron "0 9 * * 1-5" --message "检查项目风险并生成日报"
cc cowork cron list

# 调度器是前台进程，需保持运行
cc cowork cron run

# 查看最近 7 天聚合数据，或启动本机只读面板
cc cowork observe report --days 7 --json
cc cowork observe serve --host 127.0.0.1 --port 18820
```

### 模板与签名分享

```bash
# 从 EvoMap 搜索并安装受信任模板
cc cowork template search "code review" --json
cc cowork template install <gene-id> --require-signed --trust <did>

# 导出已安装的用户模板；--sign 可选
cc cowork share export-template <template-id> \
  --out ./template.packet.json --sign <local-did>

# 接收方先验证，再按信任策略导入
cc cowork share verify ./template.packet.json
cc cowork share import ./template.packet.json --require-signed --trust <did>
```

### 状态与历史学习

```bash
# status 展示可用命令，不是运行中团队的实时监控器
cc cowork status

# 基于当前项目历史生成统计、推荐和失败摘要
cc cowork learning stats --json
cc cowork learning recommend "把周报转换为 PDF" --min-runs 3 --json
cc cowork learning failures --limit 5 --json
```

## 相关文档

- [CLI Cowork 命令参考 →](/chainlesschain/cli-cowork)
- [Web Cowork 日常任务协作 →](/chainlesschain/web-cowork)
- [Cowork 工作流 →](/chainlesschain/cowork-workflow)
- [Agent Team 用户指南 →](/chainlesschain/cli-team)
- [CLI 配置管理 →](/chainlesschain/cli-config)
- [CLI 安全沙箱 →](/chainlesschain/cli-sandbox)
- [Skills 技能系统 →](/chainlesschain/skills)
- [Computer Use →](/chainlesschain/computer-use)
- [权限系统 →](/chainlesschain/permissions)
- [Hooks 系统 →](/chainlesschain/hooks)
- [Plan Mode →](/chainlesschain/plan-mode)
- [Session Manager →](/chainlesschain/session-manager)
- [当前 CLI Runtime 实现 →](/chainlesschain/cli-runtime-current)
- [后台 Agent 与 attach →](/chainlesschain/cli-background-agents)
- [CLI 更新日志 →](/changelog)

---

> 本文档为 Cowork 核心功能参考。更多高级功能和路线图请参阅：
>
> - [Cowork 高级功能（v1.1.0-v2.1.0）](/chainlesschain/cowork-advanced)
> - [Cowork 路线图（v3.0-v4.0）](/chainlesschain/cowork-roadmap)
