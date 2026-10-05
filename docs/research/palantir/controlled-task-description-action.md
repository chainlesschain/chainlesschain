# 受控任务描述修改：实现与使用边界

更新日期：2026-10-06。

本切片把第二批业务对象契约接入真实桌面 SQLite，提供 `task.update-description` v1：当前所有者预览待处理任务的描述修改，经主进程原生确认后，原子保存任务修改与执行回执。它是个人任务的一项受控操作，尚未覆盖所有任务编辑入口、组织 RBAC、多级审批或完整业务血缘。

## 当前能力

| 项目     | 实际行为                                                                                                                     |
| -------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 目标     | `project_tasks.description`；关联项目状态须为 `draft` 或 `active`，任务状态须为 `pending`                                    |
| 身份     | 主进程 `getCurrentUserDid()`；`projects.user_id` 必须与其精确相等                                                            |
| 范围     | 个人项目；项目/任务的组织或工作区字段、`organization_projects` 或 `workspace_resources` 关联存在时拒绝                       |
| 数据库   | 必须具有原生 SQLite 同步 `transaction(...).immediate()` 能力；拒绝 sql.js 回退和调用方已开启的事务                           |
| 确认     | 每次新执行使用独立的 strict/high `ApprovalGate` 和原生 Electron 确认框；显示身份、任务、完整修改前后内容及操作摘要，默认取消 |
| 版本     | 任务完整行与项目归属、状态、更新时间等字段的 SHA-256 摘要；确认后在写事务内重新读取、核对                                    |
| 持久化   | 确认前记录 admission；修改 `description`、递增 `updated_at`、设置 `sync_status='pending'` 与成功回执在同一事务提交           |
| 重复提交 | 相同幂等键和调用摘要返回已有回执；同一作用域内将键用于另一操作会拒绝                                                         |
| 回执读取 | 要求原执行身份仍拥有当前对象；项目转移、删除或进入组织范围后拒绝读取                                                         |
| 内容边界 | 修改前后描述各最多 8192 UTF-8 字节；动作快照还须满足共享 JSON 合约的大小边界                                                 |

发送方校验独立强制执行，拒绝非可信来源、iframe 和已销毁窗口。主进程身份会在确认后再次检查。Renderer 传入的 `actorDid`、`approved`、`approval` 或 `policy` 字段不能授予权限。

## 桌面调用

项目详情页已新增已保存任务抽屉，接入授权列表、描述预览、系统确认与修改历史。使用入口及在线风险检查见[项目任务工作区](./project-task-review-workbench.md)。旧任务编辑/CRUD 入口尚未全部统一接入。

Preload 调用示例：

```js
const prepared = await window.electronAPI.task.previewDescriptionUpdate({
  taskId: "task-1",
  description: "补充交付说明和验收条件",
  idempotencyKey: "task-description-20261006-001",
});

// 返回 { request, before, after }。保留整个 request；不要重建版本或摘要。
// execute 会由主进程显示原生确认框。
const result = await window.electronAPI.task.executeDescriptionUpdate({
  request: prepared.request,
});

const receipt = await window.electronAPI.task.getDescriptionActionRun({
  runId: result.run.id,
});
```

对应 IPC 为 `task:controlled-description-preview`、`task:controlled-description-execute`、`task:controlled-description-run`。执行响应包含 `{ run, evidence, replayed }`；重复调用另有 `executionState`。只有 `run.status === "succeeded"` 表示该回执记录了已提交的修改，调用本身返回并不代表执行成功。

请求绑定目标、个人作用域、期望版本、输入摘要与幂等摘要。预览后若源内容、归属或任务状态变化，执行会拒绝该旧请求。应重新读取并预览；再次提交同一已取消或拒绝的请求只会返回原回执。

## CLI 离线预览

```bash
cc project task-description-preview --snapshot task-description-snapshot.json --json
```

快照文件的顶层字段须为 `task`、`project`、`description` 和 `idempotencyKey`：

```json
{
  "task": {
    "id": "task-1",
    "project_id": "project-1",
    "description": "原描述",
    "status": "pending",
    "updated_at": 1791244800000
  },
  "project": {
    "id": "project-1",
    "user_id": "did:chainlesschain:example",
    "status": "active",
    "updated_at": 1791244800000
  },
  "description": "新描述",
  "idempotencyKey": "task-description-20261006-001"
}
```

示例仅说明输入形状；若希望请求版本与真实桌面对象一致，`task` 必须来自完整规范任务行，不能遗漏其他列。CLI 输出 `authority: "unverified-snapshot"`，既不认证其中的 DID，也不修改数据库。新增 CLI 功能没有 live execute 子命令；桌面执行仍独立读取当前身份和规范数据。

风险评估的选定字段快照及其引用使用另一种 `sourceKind`，不能充当本操作所需的完整任务版本。CLI 既有项目 CRUD 仍是原有实现，不能因这项预览能力而视为全部经过受控服务。

## 执行状态和证据

| 状态        | 含义                                                                            |
| ----------- | ------------------------------------------------------------------------------- |
| `succeeded` | 写入后再次验证描述，任务修改与成功回执已一同提交                                |
| `cancelled` | strict/high 原生确认明确返回用户取消；无任务修改                                |
| `denied`    | 审批不可用、策略/授权结果不满足条件，或确认后的已知前置条件失败；不冒充用户取消 |
| `running`   | 已持久化 admission；可能正在等待确认，也可能是中断遗留，不证明当前仍在执行      |

进程中断或数据库提交结果不明时，不自动重新确认或重放。重复执行遇到 `running` 回执返回 `executionState: "unresolved"`；其他已有终态返回 `recorded`。`getRun` 返回存储状态，界面将缺少活跃执行证据的 `running` 显示为待核实。同一任务已有未决回执时，后端拒绝新预览和新幂等键执行；原请求可继续查询旧回执。当前没有未决回执的自动恢复、强制重试或保留清理接口。

`cc_business_action_runs` 保存 ActionRun 与证据。原生确认记录包含身份、动作/调用摘要、期望版本、决策和时间；执行记录包含修改前后版本、受影响行数和时间。回执不保存描述正文或原始幂等键。

读取会校验证据摘要、唯一 ID、引用一一对应，并核对成功回执关联的确认和执行记录。后续任务生成较大的结果内容，不会妨碍仍有权限的原执行者读取已有历史回执。此校验提供库内内容一致性，尚无独立签名、外部不可改写存储或跨服务可信证明。

## 与现有项目结构的关系

基础 `project_tasks` 表实际具有 `description`、必填 `task_type`，状态为 `pending/running/completed/failed`。旧 `TaskManager` 则假定存在 `title/priority/created_by` 并使用 `in_progress/cancelled`；企业迁移未完整消除这些差异。看板 `team_tasks` 又是另一模型。

本切片直接适配真实基础表中的描述字段，不复用旧管理器，也不修复或替换全部旧入口。个人项目的真实页面入口已接入；组织权限、多级审批、其他字段或状态操作、看板任务、实际 Electron GUI 旅程和更完整的业务血缘仍是后续工作。

实现入口：

- [共享执行服务](../../../packages/session-core/lib/task-description-action-service.js)
- [桌面身份、确认和 IPC 适配器](../../../desktop-app-vue/src/main/task/task-description-ipc.js)
- [共享服务回归测试](../../../packages/cli/__tests__/unit/task-description-action-service.test.js)
- [桌面适配器回归测试](../../../desktop-app-vue/src/main/task/__tests__/task-description-ipc.test.js)

桌面适配器的 16 项回归使用真实 SQLite 和注入的 Electron 界面边界，覆盖更新、确认、身份变更、授权读取、风险历史、来源校验和未决操作阻断。专用配置还包含 preload 能力策略的 6 项和发送方校验的 27 项，共 49 项。它们不替代实际 Electron GUI 端到端验收。在 `desktop-app-vue` 目录执行：

```bash
node ../node_modules/vitest/vitest.mjs run --config vitest.business-actions.config.mjs
```

描述操作、授权读取和风险检查通道同时登记在 `scripts/verify-fixed-renderer-ipc.mjs` 的受控能力来源中，由脚本生成 manifest 和 preload 固定允许列表。修改通道后运行以下命令，避免直接编辑生成块：

```bash
node scripts/verify-fixed-renderer-ipc.mjs --write
node scripts/verify-fixed-renderer-ipc.mjs
```
