# Phase 56 — Terraform Provider 系统设计

**版本**: v1.1.0
**创建日期**: 2026-02-28
**状态**: ✅ 已实现 (v1.1.0-alpha)

---

## 一、模块概述

Phase 56 实现 Terraform 集成，提供工作空间管理和基础设施即代码 (IaC) 运行管理。

### 1.1 核心目标

1. **工作空间管理**: CRUD 管理 Terraform 工作空间
2. **Plan/Apply/Destroy**: 支持三种运行类型
3. **状态管理**: 工作空间状态版本追踪
4. **并发控制**: 限制最大并发运行数

### 1.2 技术架构

```
┌──────────────────────────────────────────────────────┐
│                   Renderer Process                   │
│  Pinia Store (terraform.ts)                          │
│  TerraformProviderPage.vue                           │
└───────────────────────┬──────────────────────────────┘
                        │ IPC (4 channels)
┌───────────────────────┼──────────────────────────────┐
│                       ▼                              │
│  ┌─────────────────────────────────────────────┐    │
│  │ Terraform Manager (terraform-manager.js)    │    │
│  │ - Workspace CRUD                            │    │
│  │ - Plan/Apply/Destroy Runs                   │    │
│  │ - State Version Tracking                    │    │
│  │ - Concurrent Run Limiting                   │    │
│  └─────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────┘
```

---

## 二、核心模块设计

### 2.1 Terraform Manager

**文件**: `desktop-app-vue/src/main/enterprise/terraform-manager.js` (ES6 Module)

**运行状态**:

```javascript
const RUN_STATUS = {
  PENDING: "pending",
  PLANNING: "planning",
  PLANNED: "planned",
  APPLYING: "applying",
  APPLIED: "applied",
  DESTROYING: "destroying",
  DESTROYED: "destroyed",
  ERRORED: "errored",
  CANCELLED: "cancelled",
};
```

**运行类型**:

```javascript
const RUN_TYPES = {
  PLAN: "plan", // 预览变更
  APPLY: "apply", // 应用变更
  DESTROY: "destroy", // 销毁资源
};
```

**工作空间状态**:

```javascript
const WORKSPACE_STATUS = {
  ACTIVE: "active", // 正常
  LOCKED: "locked", // 锁定 (运行中)
  ARCHIVED: "archived", // 已归档
};
```

**API**:

```javascript
class TerraformManager extends EventEmitter {
  async initialize()
  async listWorkspaces(filter = {})  // 列出工作空间 (支持 status/limit 过滤)
  async createWorkspace({
    name,                // 必填: 工作空间名称
    description,         // 描述
    terraformVersion,    // 版本 (默认 "1.9.0")
    workingDirectory,    // 工作目录
    autoApply,           // 自动应用
    variables,           // Terraform 变量
    providers            // Provider 列表 (默认 ["hashicorp/aws"])
  })
  async planRun({
    workspaceId,         // 必填: 工作空间ID
    runType = "plan",    // 运行类型
    triggeredBy = "manual"
  })
  async listRuns({ workspaceId, limit = 20 })
  async close()
}
```

**并发控制**:

- `_maxConcurrentRuns`: 默认限制 5 个并发运行
- `_activeRunCount`: 当前活跃运行计数
- 超过限制时抛出错误

**运行输出示例**:

```
Plan: Terraform will perform the following actions:
  + 3 to add
  ~ 1 to change
  - 0 to destroy

Apply: Apply complete! Resources: 3 added, 1 changed, 0 destroyed.
```

---

## 三、数据库设计

### 3.1 terraform_workspaces (Terraform 工作空间)

```sql
CREATE TABLE IF NOT EXISTS terraform_workspaces (
  id TEXT PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  terraform_version TEXT DEFAULT '1.9.0',
  working_directory TEXT,
  auto_apply INTEGER DEFAULT 0,
  status TEXT DEFAULT 'active',
  last_run_id TEXT,
  last_run_at INTEGER,
  state_version INTEGER DEFAULT 0,
  variables TEXT,            -- JSON: { "region": "us-east-1" }
  providers TEXT,            -- JSON: ["hashicorp/aws"]
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_terraform_workspaces_name ON terraform_workspaces(name);
CREATE INDEX IF NOT EXISTS idx_terraform_workspaces_status ON terraform_workspaces(status);
```

### 3.2 terraform_runs (Terraform 运行记录)

```sql
CREATE TABLE IF NOT EXISTS terraform_runs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  run_type TEXT NOT NULL,       -- plan/apply/destroy
  status TEXT DEFAULT 'pending',
  plan_output TEXT,
  apply_output TEXT,
  resources_added INTEGER DEFAULT 0,
  resources_changed INTEGER DEFAULT 0,
  resources_destroyed INTEGER DEFAULT 0,
  triggered_by TEXT,
  started_at INTEGER,
  completed_at INTEGER,
  error_message TEXT,
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_terraform_runs_workspace ON terraform_runs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_terraform_runs_status ON terraform_runs(status);
```

---

## 四、IPC 接口设计

**文件**: `desktop-app-vue/src/main/enterprise/terraform-ipc.js` (ES6 Module)

4个处理器:

- `terraform:list-workspaces` - 列出工作空间 (支持过滤)
- `terraform:create-workspace` - 创建工作空间
- `terraform:plan-run` - 执行 Plan/Apply/Destroy 运行
- `terraform:list-runs` - 列出运行记录

---

## 五、前端集成

### 5.1 Pinia Store (`stores/terraform.ts`)

```typescript
interface TerraformWorkspace {
  id: string; name: string; description: string;
  terraform_version: string; working_directory: string;
  auto_apply: number; status: string;
  last_run_id: string | null; state_version: number;
  variables: Record<string, any>; providers: string[];
}

interface TerraformRun {
  id: string; workspace_id: string; run_type: string;
  status: string; plan_output: string | null;
  apply_output: string | null;
  resources_added: number; resources_changed: number;
  resources_destroyed: number; triggered_by: string;
}

const useTerraformStore = defineStore('terraform', {
  state: () => ({
    workspaces: [], runs: [],
    loading: false, error: null,
  }),
  getters: {
    activeWorkspaces, // 活跃工作空间
    recentRuns,       // 最近10次运行
    totalResources,   // 总添加资源数
  },
  actions: {
    fetchWorkspaces(), createWorkspace(),
    planRun(), fetchRuns(),
  }
})
```

### 5.2 UI 页面 (`pages/enterprise/TerraformProviderPage.vue`)

- 工作空间卡片 (名称、版本、Provider列表、状态、最后运行时间)
- 创建工作空间向导 (名称、版本选择、变量编辑器、Provider选择)
- 运行控制面板 (Plan/Apply/Destroy按钮、确认对话框)
- 运行历史表格 (类型、状态、资源变更统计、触发者、耗时)
- Plan输出查看器 (资源变更预览、语法高亮)

---

## 六、配置选项

```javascript
terraform: {
  enabled: true,
  defaultVersion: "1.9.0",
  maxConcurrentRuns: 5,
  workingDirectory: "/terraform",
  stateBackend: "local",        // local/s3/consul
  autoApplyDefault: false,
  defaultProviders: ["hashicorp/aws"]
}
```

---

## 七、测试覆盖

- ✅ `terraform-manager.test.js` - 工作空间CRUD、运行管理
- ✅ `terraform-ipc.test.js` - IPC处理器
- ✅ `terraform.test.ts` - Pinia Store

---

**文档版本**: 1.0.0
**最后更新**: 2026-02-28
