# Terraform Provider 集成

> **Phase 56 | v1.1.0 | 4 IPC 处理器 | 2 张新数据库表**

## 概述

Phase 56 为 ChainlessChain 引入 Terraform 基础设施即代码 (IaC) 管理能力，支持工作区管理、Plan/Apply/Destroy 运行控制和状态版本管理，实现 ChainlessChain 配置的代码化运维。

**核心目标**:

- 📁 **工作区管理**: Terraform 工作区 CRUD 和状态管理
- 🔄 **运行控制**: Plan/Apply/Destroy 三种运行类型
- 📊 **状态版本**: 状态快照和版本管理
- ⚡ **并发控制**: 最大并发运行数限制，队列管理

---

## 核心功能

### 1. 工作区管理

```javascript
// 创建工作区
const workspace = await window.electronAPI.invoke(
  "terraform:create-workspace",
  {
    name: "production",
    description: "Production environment configuration",
    terraformVersion: "1.9.0",
    workingDirectory: "/infra/production",
    autoApply: false,
    variables: {
      region: "us-east-1",
      instance_type: "t3.medium",
      replica_count: "3",
    },
    providers: ["aws", "cloudflare"],
  },
);

console.log(workspace);
// {
//   id: 'ws-001',
//   name: 'production',
//   terraformVersion: '1.9.0',
//   status: 'ACTIVE',
//   stateVersion: 0,
//   lastRunId: null,
//   createdAt: 1709078400000
// }

// 列出工作区
const workspaces = await window.electronAPI.invoke("terraform:list-workspaces");
// [
//   { id: 'ws-001', name: 'production', status: 'ACTIVE', lastRunAt: ... },
//   { id: 'ws-002', name: 'staging', status: 'ACTIVE', lastRunAt: ... }
// ]
```

---

### 2. 运行管理

```javascript
// 执行 Plan
const planRun = await window.electronAPI.invoke("terraform:plan-run", {
  workspaceId: "ws-001",
  runType: "PLAN",
  message: "Check infrastructure changes",
});

console.log(planRun);
// {
//   id: 'run-001',
//   workspaceId: 'ws-001',
//   runType: 'PLAN',
//   status: 'PLANNED',
//   planLog: '... Plan: 3 to add, 1 to change, 0 to destroy ...',
//   resourceChanges: {
//     add: 3, change: 1, destroy: 0
//   },
//   startedAt: 1709078400000,
//   completedAt: 1709078410000
// }

// 执行 Apply
const applyRun = await window.electronAPI.invoke("terraform:plan-run", {
  workspaceId: "ws-001",
  runType: "APPLY",
  message: "Deploy infrastructure changes",
});

// 执行 Destroy
const destroyRun = await window.electronAPI.invoke("terraform:plan-run", {
  workspaceId: "ws-001",
  runType: "DESTROY",
  message: "Tear down staging environment",
  confirm: true, // 销毁需要确认
});

// 查看运行历史
const runs = await window.electronAPI.invoke("terraform:list-runs", {
  workspaceId: "ws-001",
  limit: 20,
});
```

---

### 3. 运行类型

| 类型        | 说明     | 影响          | 需要确认  |
| ----------- | -------- | ------------- | --------- |
| **PLAN**    | 预览变更 | 无副作用      | 否        |
| **APPLY**   | 应用变更 | 创建/修改资源 | 自动/手动 |
| **DESTROY** | 销毁资源 | 删除所有资源  | 是        |

### 4. 运行状态流转

```
PENDING → PLANNING → PLANNED → APPLYING → APPLIED
    │                              │
    │                         ERRORED
    │
    ├── PLANNING → PLANNED → DESTROYING → DESTROYED
    │
    └── CANCELLED
```

---

## 并发控制

系统限制最大并发运行数（默认 3），超出的运行进入队列：

```javascript
// 并发运行管理
// 同一工作区同一时间只能有一个运行
// 跨工作区最多 3 个并发运行
// 超出限制的运行排队等待

const status = await window.electronAPI.invoke("terraform:list-runs", {
  status: "PENDING", // 查看排队中的运行
});
```

---

## 数据库结构

```sql
CREATE TABLE terraform_workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  terraform_version TEXT DEFAULT '1.9.0',
  working_directory TEXT,
  auto_apply INTEGER DEFAULT 0,
  status TEXT DEFAULT 'ACTIVE',     -- ACTIVE/LOCKED/ARCHIVED
  state_version INTEGER DEFAULT 0,
  last_run_id TEXT,
  last_run_at INTEGER,
  variables TEXT,                   -- JSON 变量配置
  providers TEXT,                   -- JSON Provider 列表
  created_at INTEGER NOT NULL,
  updated_at INTEGER
);

CREATE TABLE terraform_runs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  run_type TEXT NOT NULL,           -- PLAN/APPLY/DESTROY
  status TEXT DEFAULT 'PENDING',    -- PENDING/PLANNING/PLANNED/APPLYING/APPLIED/DESTROYING/DESTROYED/ERRORED/CANCELLED
  message TEXT,
  plan_log TEXT,
  apply_log TEXT,
  destroy_log TEXT,
  error_message TEXT,
  resource_changes TEXT,            -- JSON { add, change, destroy }
  started_at INTEGER,
  completed_at INTEGER,
  created_at INTEGER NOT NULL
);
```

---

## 前端集成

### Pinia Store

```typescript
import { useTerraformStore } from "@/stores/terraform";

const terraform = useTerraformStore();

// 获取工作区列表
await terraform.fetchWorkspaces();

// 创建工作区
await terraform.createWorkspace(workspaceData);

// 执行 Plan
await terraform.planRun(workspaceId, "PLAN", "Check changes");

// 查看运行历史
await terraform.fetchRuns(workspaceId);
console.log(terraform.currentRuns);
```

### 前端页面

**Terraform 管理页面** (`/terraform-provider`)

**功能模块**:

1. **工作区管理**
   - 工作区列表
   - 创建/归档工作区
   - 变量和 Provider 配置

2. **运行控制**
   - Plan/Apply/Destroy 操作
   - 运行日志实时查看
   - 资源变更预览

3. **运行历史**
   - 历史记录列表
   - 运行详情和日志
   - 状态追踪

4. **状态管理**
   - 状态版本浏览
   - 资源清单查看

---

## 配置选项

```json
{
  "terraform": {
    "enabled": true,
    "defaultVersion": "1.9.0",
    "maxConcurrentRuns": 3,
    "autoApplyDefault": false,
    "runTimeout": 3600000,
    "logRetention": 30,
    "stateBackup": true
  }
}
```

---

## 使用场景

### 场景 1: 多环境管理

```javascript
// 1. 创建 staging 和 production 工作区
await window.electronAPI.invoke("terraform:create-workspace", {
  name: "staging",
  variables: { environment: "staging", replica_count: "1" },
});

await window.electronAPI.invoke("terraform:create-workspace", {
  name: "production",
  variables: { environment: "production", replica_count: "3" },
});

// 2. 先在 staging 验证
await window.electronAPI.invoke("terraform:plan-run", {
  workspaceId: "ws-staging",
  runType: "APPLY",
});

// 3. 验证通过后部署到 production
await window.electronAPI.invoke("terraform:plan-run", {
  workspaceId: "ws-production",
  runType: "APPLY",
});
```

### 场景 2: 变更审查

```javascript
// 1. 先执行 Plan 查看变更
const plan = await window.electronAPI.invoke("terraform:plan-run", {
  workspaceId: "ws-001",
  runType: "PLAN",
});

// 2. 审查资源变更
console.log(plan.resourceChanges);
// { add: 2, change: 1, destroy: 0 }

// 3. 确认后 Apply
if (approved) {
  await window.electronAPI.invoke("terraform:plan-run", {
    workspaceId: "ws-001",
    runType: "APPLY",
  });
}
```

---

## 安全考虑

1. **变量加密**: 敏感变量 (API Key/Secret) 使用 AES-256 加密存储
2. **运行隔离**: 每次运行在独立上下文中执行
3. **审计日志**: 所有 Apply/Destroy 操作记录到审计日志
4. **权限控制**: Destroy 操作需要管理员权限
5. **状态保护**: 工作区锁定防止并发状态冲突

---

## 性能指标

| 指标         | 目标   | 实际   |
| ------------ | ------ | ------ |
| 工作区创建   | <500ms | ~200ms |
| Plan 执行    | <30s   | ~15s   |
| Apply 执行   | <120s  | ~60s   |
| 运行历史查询 | <200ms | ~100ms |

---

## 相关文档

- [SCIM 2.0 用户配置](/chainlesschain/scim)
- [合规与数据分类](/chainlesschain/compliance)
- [审计日志](/chainlesschain/audit)
- [产品路线图](/chainlesschain/product-roadmap)

---

**文档版本**: 1.0.0
**最后更新**: 2026-02-27
