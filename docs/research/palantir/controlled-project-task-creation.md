# 受控项目任务创建及旧入口收口

更新：2026-10-06。本说明记录本地实现与选择性验证，不代表组织工作流或真实 Electron GUI 验收完成。

## 真实任务模型和所有权

规范持久任务是 `project_tasks`：`task_type`、`description`、`status`、时间戳及同步字段。状态为 pending/running/completed/failed；类型是数据库 schema 的六种类型。旧 `TaskManager` 假设 title、created_by、assigned_to 等另一套企业字段；看板管理器使用单独的 `team_tasks`。本次没有将看板任务自动复制到规范表。

所有权从当前主进程 DID 和 `projects.user_id` 精确匹配得出。创建、编辑、读取及历史查询均拒绝组织字段、组织项目映射和工作区资源映射。`default-user`、设备 ID 不自动变成当前 DID；组织 RBAC 和多级审批适配仍未完成。

## 用户入口与接口

项目详情的“项目任务”抽屉新增创建表单，可选择六种任务类型和最多 8192 UTF-8 字节描述。预览后弹出原生确认框，默认取消。确认仅创建待处理记录，不运行部署、文件操作或模型调用。

- `task:controlled-create-preview`：`{projectId, taskType, description, idempotencyKey}`。
- `task:controlled-create-execute`：`{request}`，只执行被摘要绑定的完整请求。
- `task:controlled-create-runs`：`{projectId, beforeId?, limit?}`，有界、授权、按插入顺序查询创建历史。
- `task:controlled-description-run` 也可读取创建回执，按当前 Project 归属授权。

创建操作以现存 Project 为目标，版本来自项目权威快照。新 Task ID 由宿主生成，并以 `createdTaskRef` 写入执行证据。Task 插入、Project 版本推进和成功回执在同一 SQLite immediate 事务提交。确认期间不占用事务；确认后复核当前身份、所有权、组织映射和项目版本。回执不保存任务正文和原始幂等键。

同一个请求再次调用只返回原回执。创建结果未知或审批尚未返回时，同项目不能用新幂等键绕过。界面遇到传输异常后只读取历史，不自动执行；成功、取消与未决状态分别展示。取消创建仍可在项目历史中查询，无须存在 Task 行。

## 旧入口兼容边界

旧个人 `task:create-task` 接收受控创建的 `request`，缺失时返回 `ACTION_CONTROLLED_TASK_REQUIRED`。旧 `task:update-task` 可执行绑定对应 Task ID 的受控描述 `request`；不再接受个人规范任务的任意字段更新。

旧 `task:get-tasks` 的个人分支要求显式 projectId/project_id，改为授权的有界列表。旧 `task:get-task` 的规范项目分支使用授权详情，返回有界描述和可编辑原因。

规范项目任务经旧 delete/move/assign/priority/due-date/label/dependency/subtask 接口写入会明确拒绝，避免旧模型和 renderer actor 绕过受控操作。看板表的流程仍独立，尚未完成其 RBAC/审批统一；附属评论、清单等旧入口及直接服务调用未在本次迁移范围内。这不是所有业务入口的统一策略声明。

## 风险来源绑定

描述预览可带 `reviewId`。宿主独立验证风险记录，将 `{id, contentDigest}` 放入请求 input 并参与 actionDigest。admission 与风险→ActionRun 关联原子保存；确认后再次检查来源新鲜度。source evidence 绑定 review、actor、invocationDigest、actionDigest 和 expectedVersion；成功、取消、拒绝及未决记录均保留来源。

变更描述不会自动消除逾期或阻塞信号。风险记录不是描述操作的版本替代品；操作仍使用完整 Task 行快照版本。身份撤销后拒绝回执仍能在原事务中落地，后续历史读取重新授权。

## 本地验证

新增创建服务真实 SQLite 测试 12 项，覆盖版本冲突、取消、幂等重读、未知结果、新键阻断、原子回滚、设备归属拒绝与组织资源拒绝；既有描述/读取 41 项通过。

桌面 host/IPC 与来源策略选择性测试 61 项通过，其中新增原生创建、风险来源绑定，以及 10 个旧规范任务变更入口拒绝测试。Renderer 选择性测试在新增创建流程后 32 项通过，新增创建成功、取消和传输丢失后通过回执恢复；使用真实 host、SQLite 和双向 structuredClone，Electron dialog 为注入边界。

交叉审查进一步隔离 Project/Task 同名 ID 的历史、游标和未决锁；新增风险选择变化以及迟到预览失效测试。最终创建/描述/风险链路合并选择验证 5 文件 81 项，桌面 3 文件 61 项，包含风险面板的 Renderer 3 文件 43 项均通过；各组有自己的独立范围，不将此前轮次重复累计。

尚未运行真实 Electron GUI、仓库全量、Linux/macOS 矩阵；组织权限及所有权迁移仍保留明确限制。完整当批汇总以主进度表及其证据文件为准。

## 组织适配的具体前提

已检查现有组织、权限及审批实现，尚不能将任一 `checkPermission=true` 或 `approval_requests.status=approved` 直接转换为受控写权限：

| 已检查源码                                                                                                                                 | 不兼容合同                                                                                                                                                           | 必须先具备的实现                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `database/database-schema.js` 的 `organization_projects`、`project_tasks`；`database/database-migrations.js` 的迁移7                       | 前者是独立组织项目实体，没有指向 `projects` 的外键或映射；后者的外键仍指向 `projects`，新增 org_id/workspace_id 不保证一致归属。相同 ID 不能证明两个项目是同一实体。 | 明确且可验证的组织项目映射和现有数据冲突迁移；拒绝不一致或多组织映射。                                        |
| `permission/permission-engine.js` 的 `checkPermission`、`_getUserRoles`；`organization/organization-manager-roles.js` 的 `checkPermission` | 前者使用异步查询、缓存、grants/继承/委托，角色查询未筛 active；后者使用 role.permissions 并筛 active，未定义两套权利的优先/拒绝关系。                                | 一个同步、无缓存、在最终写事务内可复核的规范权限判定；覆盖有效成员、授权版本、撤销、到期和组织归属。          |
| `permission/rbac-authority.js`                                                                                                             | 默认 report 仅记录而允许，数据库错误也允许，不具备拒绝优先的执行授权语义。                                                                                           | 受控路径强制拒绝优先的权威入口，不受旧 report/off 开关放宽。                                                  |
| `permission/approval-workflow-manager.js` 的 `submitApproval`、`_processDecision`、`_handleTimeout`                                        | request_data 没有 actionDigest/expectedVersion/workflowVersion 或单次消费；审批时读取当前 workflow.approvers；超时可直接 approved；响应也没有与执行的原子消费绑定。  | 不可变审批计划、输入/资源版本绑定、审批人当下权限复核、防重复响应和最终单次消费；超时批准不能伪装成人工确认。 |
| `permission/permission-ipc.js`、`permission/current-user-context.js`                                                                       | 旧身份适配允许 report/off 保留客户端 claim；历史审批记录不证明当时使用了强制身份模式。                                                                               | 新强制主进程身份路径及记录来源版本；旧审批不得追认为新合同下的批准。                                          |

这些工作需要新增组织动作合同、迁移和撤权/审批并发测试，不能通过把已有独立项目同 ID 合并、读取用户自报 org_id 或复用旧 approved 状态来代替。本批组织路径继续明确拒绝；个人原生确认也不宣称完成多级审批。
