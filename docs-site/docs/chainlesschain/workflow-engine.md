# 自主工作流编排器

> **版本: v4.1.0 | 状态: ✅ 生产就绪 | 10 IPC Handlers | DAG 工作流 + 条件分支 + 并行执行 + 审批门 + 版本控制**

ChainlessChain 自主工作流编排器基于有向无环图 (DAG) 模型，支持条件分支、循环、并行执行和人工审批门等多种控制流。内置 5 套工作流模板，支持断点调试、版本控制和一键回滚，为复杂 AI 任务提供可视化编排能力。

## 概述

自主工作流编排器是 ChainlessChain 的 DAG 工作流执行引擎，通过有向无环图建模支持条件分支、循环、并行执行和人工审批门等复杂控制流。引擎内置拓扑排序与并行调度、断点调试器和版本控制机制，提供代码审查、数据处理、内容发布、部署上线和报告生成 5 套模板，支持工作流定义的版本化存储与一键回滚。

## 核心特性

- 🔀 **DAG 工作流**: 有向无环图建模，自动拓扑排序，环检测
- 🔀 **条件分支**: 基于表达式的条件路由，支持 if/else/switch
- 🔁 **循环执行**: for/while 循环节点，支持 break/continue
- ⚡ **并行执行**: 无依赖节点自动并行，可配置并发上限
- ✅ **审批门**: 人工审批节点，支持超时/自动批准/多人审批
- 🔴 **断点调试**: 设置断点暂停执行，检查中间状态
- 📋 **5 套模板**: 代码审查、数据处理、内容发布、部署上线、报告生成
- 🔄 **版本控制**: 工作流定义版本化，支持回滚到任意版本

## 系统架构

```
┌──────────────────────────────────────────────┐
│          自主工作流编排器 (DAG Engine)          │
│                                              │
│  ┌──────────────────────────────────────┐    │
│  │  工作流定义层 (DAG + 版本控制)        │    │
│  │  节点/边/条件/循环/并行/审批门        │    │
│  └──────────────────┬───────────────────┘    │
│                     ▼                        │
│  ┌──────────────────────────────────────┐    │
│  │  执行引擎                             │    │
│  │  拓扑排序 → 并行调度 → 条件分支      │    │
│  │  断点调试 → 失败重试 → 回滚恢复      │    │
│  └──────────────────┬───────────────────┘    │
│         ┌───────────┼───────────┐            │
│         ▼           ▼           ▼            │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐     │
│  │ Action   │ │ Approval │ │ Template │     │
│  │ 节点     │ │ 审批门   │ │ 5 套模板 │     │
│  └──────────┘ └──────────┘ └──────────┘     │
│                     │                        │
│                     ▼                        │
│  ┌──────────────────────────────────────┐    │
│  │  Workflow IPC (10 处理器)             │    │
│  │  create/execute/pause/resume/rollback│    │
│  └──────────────────────────────────────┘    │
└──────────────────────────────────────────────┘
```

## 关键文件

| 文件 | 职责 |
|------|------|
| `desktop-app-vue/src/main/ai-engine/workflow/workflow-engine.js` | DAG 工作流执行引擎 |
| `desktop-app-vue/src/main/ai-engine/workflow/dag-scheduler.js` | 拓扑排序与并行调度 |
| `desktop-app-vue/src/main/ai-engine/workflow/approval-gate.js` | 人工审批门控制 |
| `desktop-app-vue/src/main/ai-engine/workflow/breakpoint-debugger.js` | 断点调试器 |
| `desktop-app-vue/src/main/ai-engine/workflow/workflow-ipc.js` | IPC 处理器 (10 个) |

## 使用示例

```javascript
// 1. 从模板快速创建工作流
const templates = await window.electron.ipcRenderer.invoke("workflow:list-templates");
const workflow = await window.electron.ipcRenderer.invoke("workflow:create", {
  name: "数据处理管道",
  templateId: "tpl-data-pipeline",
  nodes: [
    { id: "fetch", type: "action", action: "data:fetch", config: { source: "api" } },
    { id: "transform", type: "action", action: "data:transform" },
    { id: "validate", type: "condition", expression: "transform.output.errors === 0",
      branches: { true: "save", false: "alert" } },
    { id: "save", type: "action", action: "data:save" },
    { id: "alert", type: "action", action: "notify:send" },
  ],
  edges: [
    { from: "fetch", to: "transform" },
    { from: "transform", to: "validate" },
    { from: "validate", to: "save", condition: "true" },
    { from: "validate", to: "alert", condition: "false" },
  ],
});

// 2. 执行并监听状态
const exec = await window.electron.ipcRenderer.invoke("workflow:execute", {
  workflowId: workflow.id,
  input: { apiUrl: "https://data.example.com/v1" },
});
```

## 故障排查

| 问题 | 可能原因 | 解决方案 |
| --- | --- | --- |
| DAG 验证失败 | 存在循环依赖或孤立节点 | 检查 edges 定义，确保无环且所有节点可达 |
| 工作流执行卡住 | 审批门等待人工确认 | 查看执行日志确认卡在哪个节点，手动审批或调整超时 |
| 回滚失败 | 目标节点不支持回滚或快照缺失 | 确认 `snapshotEnabled: true`，检查目标节点是否有 undo 定义 |
| 并行节点执行超时 | 并发上限不足或单节点耗时过长 | 增大 `maxParallelNodes`，或为耗时节点设置独立 timeout |
| 条件分支走错路径 | 表达式求值结果非预期 | 设置断点检查中间输出，确认表达式语法正确 |

## 安全考虑

- **输入验证**: 所有节点输入经过 Schema 验证，防止注入攻击
- **审批授权**: 审批门节点支持多人审批和角色限制，审批记录不可篡改
- **日志审计**: 工作流每次执行生成完整日志，包括节点输入输出和耗时
- **版本控制**: 工作流定义版本化存储，支持回滚到任意历史版本
- **执行隔离**: 并行工作流实例间数据隔离，防止互相干扰
- **权限分离**: 工作流的创建、执行、审批、回滚分别受 RBAC 权限控制

## 相关文档

- [工作流自动化引擎](/chainlesschain/workflow-automation)
- [流水线编排](/chainlesschain/pipeline)
- [自主运维](/chainlesschain/autonomous-ops)
- [产品路线图](/chainlesschain/product-roadmap)

## 工作流执行模型

```
工作流定义 (DAG)
  │
  ├─ [开始] ──→ [数据采集] ──→ [AI 分析] ──┬──→ [人工审批] ──→ [发布] ──→ [结束]
  │                                        │
  │                                        └──→ [异常处理] ──→ [告警] ──→ [结束]
  │
  执行引擎:
  ├─ 拓扑排序确定执行顺序
  ├─ 无依赖节点并行执行
  ├─ 条件节点评估表达式选择分支
  ├─ 审批门暂停等待人工确认
  ├─ 断点命中时暂停，允许检查状态
  └─ 失败时根据策略重试/跳过/回滚

节点类型:
  action     → 执行具体任务 (IPC 调用/脚本/API)
  condition  → 条件分支 (表达式求值)
  loop       → 循环 (for/while)
  parallel   → 并行网关 (fork/join)
  approval   → 人工审批门
  breakpoint → 调试断点
```

## 创建工作流

```javascript
const workflow = await window.electron.ipcRenderer.invoke("workflow:create", {
  name: "AI 代码审查流水线",
  description: "自动拉取 PR → AI 分析 → 人工审批 → 合并",
  nodes: [
    {
      id: "start",
      type: "action",
      action: "git:fetch-pr",
      config: { repo: "my-repo" },
    },
    {
      id: "analyze",
      type: "action",
      action: "ai:code-review",
      config: { model: "gpt-4" },
    },
    {
      id: "check-score",
      type: "condition",
      expression: "analyze.output.score >= 0.8",
      branches: { true: "approve", false: "request-changes" },
    },
    {
      id: "approve",
      type: "approval",
      config: { approvers: ["lead"], timeoutMs: 86400000 },
    },
    { id: "request-changes", type: "action", action: "git:request-changes" },
    { id: "merge", type: "action", action: "git:merge-pr" },
  ],
  edges: [
    { from: "start", to: "analyze" },
    { from: "analyze", to: "check-score" },
    { from: "check-score", to: "approve", condition: "true" },
    { from: "check-score", to: "request-changes", condition: "false" },
    { from: "approve", to: "merge" },
  ],
});
// workflow = {
//   id: "wf-uuid-001",
//   name: "AI 代码审查流水线",
//   version: 1,
//   nodeCount: 6,
//   createdAt: "2026-03-10T08:00:00Z",
// }
```

## 执行工作流

```javascript
const execution = await window.electron.ipcRenderer.invoke("workflow:execute", {
  workflowId: "wf-uuid-001",
  input: { prNumber: 42, branch: "feature/new-skill" },
  options: { dryRun: false, maxParallel: 4 },
});
// execution = {
//   executionId: "exec-uuid-001",
//   workflowId: "wf-uuid-001",
//   status: "running",
//   startedAt: "2026-03-10T08:12:00Z",
//   currentNodes: ["start"],
// }
```

## 暂停 / 恢复工作流

```javascript
// 暂停
await window.electron.ipcRenderer.invoke("workflow:pause", "exec-uuid-001");

// 恢复
await window.electron.ipcRenderer.invoke("workflow:resume", {
  executionId: "exec-uuid-001",
  approvalResult: { nodeId: "approve", approved: true, comment: "LGTM" },
});
```

## 回滚工作流

```javascript
const result = await window.electron.ipcRenderer.invoke("workflow:rollback", {
  executionId: "exec-uuid-001",
  targetNodeId: "analyze", // 回滚到该节点之前的状态
});
// result = {
//   success: true,
//   rolledBackNodes: ["merge", "approve", "check-score"],
//   currentNode: "analyze",
//   snapshotRestored: true,
// }
```

## 列出工作流模板

```javascript
const templates = await window.electron.ipcRenderer.invoke(
  "workflow:list-templates",
);
// templates = [
//   { id: "tpl-code-review", name: "代码审查", nodeCount: 6, description: "PR 自动审查流水线" },
//   { id: "tpl-data-pipeline", name: "数据处理", nodeCount: 8, description: "ETL 数据处理管道" },
//   { id: "tpl-content-publish", name: "内容发布", nodeCount: 5, description: "内容审核与发布" },
//   { id: "tpl-deploy", name: "部署上线", nodeCount: 10, description: "CI/CD 部署流水线" },
//   { id: "tpl-report", name: "报告生成", nodeCount: 4, description: "自动数据报告" },
// ]
```

## 导入 / 导出工作流

```javascript
// 导出
const exported = await window.electron.ipcRenderer.invoke("workflow:export", {
  workflowId: "wf-uuid-001",
  format: "json", // json | yaml
});
// exported = { data: "{ ... }", format: "json", version: 1 }

// 导入
const imported = await window.electron.ipcRenderer.invoke("workflow:import", {
  data: exportedJsonString,
  format: "json",
  overwrite: false,
});
// imported = { workflowId: "wf-uuid-002", name: "AI 代码审查流水线 (副本)", version: 1 }
```

## 获取执行日志

```javascript
const log = await window.electron.ipcRenderer.invoke(
  "workflow:get-execution-log",
  {
    executionId: "exec-uuid-001",
    limit: 50,
  },
);
// log = {
//   executionId: "exec-uuid-001",
//   entries: [
//     { timestamp: "...", nodeId: "start", event: "started", durationMs: 0 },
//     { timestamp: "...", nodeId: "start", event: "completed", durationMs: 1200, output: { ... } },
//     { timestamp: "...", nodeId: "analyze", event: "started", durationMs: 0 },
//     { timestamp: "...", nodeId: "analyze", event: "completed", durationMs: 4500, output: { score: 0.92 } },
//     { timestamp: "...", nodeId: "check-score", event: "evaluated", branch: "true" },
//     { timestamp: "...", nodeId: "approve", event: "waiting-approval" },
//   ],
//   total: 6,
// }
```

## 设置断点

```javascript
const result = await window.electron.ipcRenderer.invoke(
  "workflow:set-breakpoint",
  {
    workflowId: "wf-uuid-001",
    nodeId: "check-score",
    condition: "analyze.output.score < 0.5", // 可选: 条件断点
    enabled: true,
  },
);
// result = {
//   breakpointId: "bp-uuid-001",
//   nodeId: "check-score",
//   condition: "analyze.output.score < 0.5",
//   enabled: true,
// }
```

## 配置选项

```json
{
  "workflowEngine": {
    "enabled": true,
    "maxConcurrentExecutions": 5,
    "maxParallelNodes": 8,
    "defaultTimeout": 3600000,
    "approvalTimeout": 86400000,
    "retryPolicy": {
      "maxRetries": 3,
      "backoffMs": 1000,
      "backoffMultiplier": 2
    },
    "snapshotEnabled": true,
    "versionControl": true,
    "maxVersions": 50,
    "templateDir": "workflow-templates"
  }
}
```
