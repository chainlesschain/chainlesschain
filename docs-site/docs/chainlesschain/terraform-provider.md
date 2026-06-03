# Terraform Provider 集成

> **Phase 56 | v1.1.0 | 4 IPC 处理器 | 2 张新数据库表**

## 核心特性

- 📁 **工作区管理**: Terraform 工作区 CRUD，支持变量配置和 Provider 管理
- 🔄 **运行控制**: Plan/Apply/Destroy 三种运行类型，完整状态流转
- 📊 **状态版本管理**: 状态快照和版本追踪，资源变更可视化预览
- ⚡ **并发控制**: 最大并发运行数限制（默认 3），自动队列管理
- 🔒 **安全机制**: 敏感变量 AES-256 加密、运行隔离、Destroy 权限控制

## 系统架构

```
┌──────────────┐
│  Renderer    │
│  Terraform   │
│  管理页面    │
└──────┬───────┘
       │ IPC (4 通道)
       ▼
┌──────────────────────────────────┐
│      Terraform Provider          │
│  ┌────────────┐  ┌────────────┐ │
│  │ Workspace  │  │ Run        │ │
│  │ Manager    │  │ Controller │ │
│  │ (CRUD)     │  │ (P/A/D)   │ │
│  └─────┬──────┘  └─────┬──────┘ │
│        │               │        │
│  ┌─────▼───────────────▼──────┐ │
│  │   Concurrency Manager      │ │
│  │   (max 3 parallel runs)    │ │
│  └────────────┬───────────────┘ │
└───────────────┼─────────────────┘
                │
       ┌────────▼────────┐
       │  SQLite (2表)   │
       │  terraform_     │
       │  workspaces /   │
       │  terraform_runs │
       └─────────────────┘
```

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

## 使用示例

### 示例 1: 完整的 Plan → Apply 工作流

```javascript
// 1. 创建工作区
const ws = await window.electronAPI.invoke("terraform:create-workspace", {
  name: "staging",
  terraformVersion: "1.9.0",
  variables: { region: "ap-southeast-1", instance_type: "t3.small" },
  providers: ["aws"],
});

// 2. 先执行 Plan 预览变更
const plan = await window.electronAPI.invoke("terraform:plan-run", {
  workspaceId: ws.id,
  runType: "PLAN",
  message: "检查 staging 环境变更",
});
console.log(`Plan 结果: +${plan.resourceChanges.add} ~${plan.resourceChanges.change} -${plan.resourceChanges.destroy}`);

// 3. 确认无误后执行 Apply
const apply = await window.electronAPI.invoke("terraform:plan-run", {
  workspaceId: ws.id,
  runType: "APPLY",
  message: "部署 staging 变更",
});
console.log(`Apply 状态: ${apply.status}`);
```

### 示例 2: 安全销毁并查看运行历史

```javascript
// 销毁 staging 环境（需要 confirm 确认）
const destroy = await window.electronAPI.invoke("terraform:plan-run", {
  workspaceId: "ws-staging",
  runType: "DESTROY",
  message: "清理测试环境资源",
  confirm: true,
});

// 查看该工作区所有运行历史
const runs = await window.electronAPI.invoke("terraform:list-runs", {
  workspaceId: "ws-staging",
  limit: 10,
});
runs.forEach(r => console.log(`[${r.runType}] ${r.status} - ${r.message}`));
```

---

## 故障排查

| 问题 | 可能原因 | 解决方案 |
| --- | --- | --- |
| Plan 执行报错 | Terraform 版本不匹配或配置语法错误 | 检查 `terraformVersion` 是否已安装，查看 `planLog` 中的详细错误 |
| Apply 超时 | 资源创建耗时过长或云平台响应慢 | 增大 `runTimeout` 配置（默认 3600000ms），检查云平台配额 |
| Destroy 操作被拒绝 | 当前用户无管理员权限 | 确认操作者具有 Destroy 权限，且传入 `confirm: true` |
| 工作区状态为 LOCKED | 有正在执行的运行未完成 | 等待当前运行完成，或检查是否有异常中断的运行需要取消 |
| 并发运行排队 | 超过最大并发数限制 | 等待前序运行完成，或调整 `maxConcurrentRuns`（默认 3） |
| 敏感变量泄露 | 变量未标记为敏感 | 在配置中使用 `sensitive: true` 标记，系统会自动 AES-256 加密存储 |

---

## 配置参考

### 完整配置字段说明

| 字段 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `terraform.enabled` | `boolean` | `true` | 启用/禁用 Terraform Provider 模块 |
| `terraform.defaultVersion` | `string` | `"1.9.0"` | 新建工作区时默认的 Terraform 版本 |
| `terraform.maxConcurrentRuns` | `number` | `3` | 跨工作区最大并发运行数；超出后进入 PENDING 队列 |
| `terraform.autoApplyDefault` | `boolean` | `false` | 新建工作区是否默认开启自动 Apply |
| `terraform.runTimeout` | `number` | `3600000` | 单次运行的超时时长（毫秒）；超时后状态置为 ERRORED |
| `terraform.logRetention` | `number` | `30` | 运行日志保留天数；超期记录由定时清理任务删除 |
| `terraform.stateBackup` | `boolean` | `true` | Apply/Destroy 成功后自动保存状态快照 |

### 工作区创建参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `name` | `string` | ✅ | 工作区名称，全局唯一 |
| `description` | `string` | — | 可选描述 |
| `terraformVersion` | `string` | — | 覆盖 `defaultVersion`，如 `"1.10.0"` |
| `workingDirectory` | `string` | — | Terraform 配置文件目录路径 |
| `autoApply` | `boolean` | — | 是否在 Plan 通过后自动执行 Apply |
| `variables` | `Record<string, string>` | — | 工作区变量键值对；敏感值自动 AES-256 加密 |
| `providers` | `string[]` | — | 声明所需 Provider（如 `["aws", "cloudflare"]`） |

### 运行触发参数

| 参数 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `workspaceId` | `string` | ✅ | 目标工作区 ID |
| `runType` | `"PLAN" \| "APPLY" \| "DESTROY"` | ✅ | 运行类型 |
| `message` | `string` | — | 本次运行的描述信息，记录到运行历史 |
| `confirm` | `boolean` | — | DESTROY 类型必须传 `true`，否则拒绝执行 |

---

## 测试覆盖率

### 测试文件

| 文件 | 测试数 | 覆盖内容 |
| --- | --- | --- |
| `tests/unit/enterprise/terraform-provider.test.js` | 28 | 工作区 CRUD、状态流转、并发限制 |
| `tests/unit/enterprise/terraform-run-controller.test.js` | 24 | Plan/Apply/Destroy 执行路径、超时、错误处理 |
| `tests/unit/enterprise/terraform-workspace-manager.test.js` | 18 | 工作区变量加密、Provider 配置、归档操作 |
| `tests/unit/ipc/ipc-terraform.test.js` | 16 | 4 个 IPC 通道参数校验与权限检查 |

**总计**: 86 个单元测试

### 关键测试场景

```javascript
// 并发运行队列：第 4 个运行应进入 PENDING
it('queues run when maxConcurrentRuns exceeded', async () => {
  // 建立 3 个 APPLYING 状态的运行
  for (let i = 0; i < 3; i++) await controller.startRun(ws.id, 'APPLY');
  const queued = await controller.startRun(ws.id, 'APPLY');
  expect(queued.status).toBe('PENDING');
});

// Destroy 必须携带 confirm: true
it('rejects DESTROY without confirm flag', async () => {
  await expect(
    controller.startRun(ws.id, 'DESTROY', { confirm: false })
  ).rejects.toThrow('Destroy operation requires explicit confirmation');
});

// 敏感变量不得以明文写入数据库
it('encrypts sensitive variables at rest', async () => {
  const ws = await manager.createWorkspace({ variables: { SECRET_KEY: 'abc123' } });
  const raw = db.prepare('SELECT variables FROM terraform_workspaces WHERE id = ?').get(ws.id);
  expect(raw.variables).not.toContain('abc123');
});
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

## 关键文件

| 文件 | 职责 | 行数 |
| --- | --- | --- |
| `src/main/enterprise/terraform-provider.js` | Terraform 核心引擎 | ~400 |
| `src/main/enterprise/terraform-workspace-manager.js` | 工作区管理器 | ~280 |
| `src/main/enterprise/terraform-run-controller.js` | 运行控制器 (Plan/Apply/Destroy) | ~320 |
| `src/main/ipc/ipc-terraform.js` | IPC 处理器注册 | ~100 |
| `src/renderer/stores/terraform.ts` | Pinia 状态管理 | ~150 |

**文档版本**: 1.0.0
**最后更新**: 2026-02-27
