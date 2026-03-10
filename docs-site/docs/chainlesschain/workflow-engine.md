# 自主工作流编排器

> **版本: v4.1.0 | 状态: ✅ 生产就绪 | 10 IPC Handlers | DAG 工作流 + 条件分支 + 并行执行 + 审批门 + 版本控制**

ChainlessChain 自主工作流编排器基于有向无环图 (DAG) 模型，支持条件分支、循环、并行执行和人工审批门等多种控制流。内置 5 套工作流模板，支持断点调试、版本控制和一键回滚，为复杂 AI 任务提供可视化编排能力。

## 核心特性

- 🔀 **DAG 工作流**: 有向无环图建模，自动拓扑排序，环检测
- 🔀 **条件分支**: 基于表达式的条件路由，支持 if/else/switch
- 🔁 **循环执行**: for/while 循环节点，支持 break/continue
- ⚡ **并行执行**: 无依赖节点自动并行，可配置并发上限
- ✅ **审批门**: 人工审批节点，支持超时/自动批准/多人审批
- 🔴 **断点调试**: 设置断点暂停执行，检查中间状态
- 📋 **5 套模板**: 代码审查、数据处理、内容发布、部署上线、报告生成
- 🔄 **版本控制**: 工作流定义版本化，支持回滚到任意版本

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
