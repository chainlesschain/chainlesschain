# 规范组织项目授权、审批与任务执行

更新：2026-10-07。对应第六批 PAL ONT / POLICY / LINEAGE 源码交付；范围为共享服务、桌面主进程授权适配和本地验证。组织管理、审批与任务页面的固定 IPC/Renderer 旅程仍待接线。本批没有启用新的 renderer 迁移入口，没有发布。

## 可信身份和权限来源

`OrganizationProjectAuthority` 接受原生 SQLite、主进程身份和宿主确认函数。桌面 `createOrganizationProjectAuthorityHost` 默认使用已登录的 `getProjectGoalActor()`，绑定认证 generation、窗口与数据库连接。默认 DID 已加载但未登录时拒绝；退出后同 DID 重登录不能沿用先前确认。

政策启用要求当前 DID 同时等于 `organization_info.owner_did`，且存在 active owner 成员行。所有者在原生确认中审核具体 actor、规范 project、权限、到期时间和选定工作流。允许的权限为 `task.read`、`task.create`、`task.update-description`、`task.approve`。未列出的权限拒绝；旧 roles、permission_grants、继承、委托及 report/off 判定不自动获得受控权限。

政策保存单调 epoch、组织来源 revision、来源摘要、精确授权及工作流行摘要。组织根、成员及工作流变更通过 SQLite 触发器推进持久 revision；删除后恢复原内容仍使旧政策失效。规范 Project/Task 与 workspace 资源变更也推进项目来源 revision。授权快照包含数据库 schema revision，后建表和迁移不能恢复旧提议。发生这些变化后，需重新读取版本，必要时由所有者重新确认政策；不会自动重认证旧记录。

配置最多 100 条授权、20 个工作流，成员来源最多 1,000 行，政策序列化最多 65,536 字节。超限在确认和写入前拒绝。当前选择严格的显式授权，不宣称兼容所有旧团队/条件授权语义。

## 显式项目归属

`cc_organization_project_bindings` 以规范 `project_id` 唯一映射独立 `organization_project_id`，保存 org、revision、原所有者、建立者和状态。相同 ID 不会自动迁移或合并。

本批绑定要求同一可信身份同时是规范项目原所有者和 active 组织所有者；双方不是同一人时明确拒绝，仍需后续双主体迁移批准。组织项目须属于所选组织；任务/项目上的冲突 org、workspace 字段以及 workspace 资源映射均拒绝。存在未决业务动作时不允许转移归属。原生确认后重读身份、来源版本、组织政策及映射冲突，再将绑定和回执原子保存。

撤销保留 binding tombstone，只关闭组织使用权限，不恢复个人作用域。个人任务、风险与目标服务对 active/revoked 显式映射都拒绝。所有权恢复或再迁移需要另行实现受控迁移，不能直接删除绑定来绕过。

## 不可变多级审批

`OrganizationProjectApprovalService` 复用 `approval_workflows`、`approval_requests`、`approval_responses`，增加不可变的审批和响应 companion。提交时固定实际请求/输入/目标版本摘要、actor、org、Project/Task 身份、完整权限快照、工作流行摘要、审批计划及 deadline；不持久保存任务正文或原始幂等键。

步骤沿用现有 DID 或 DID 数组：sequential/any_one 每步任一指定人批准，parallel 每步全部批准。每次响应必须声明 step，由当前可信身份执行；拒绝自审批、跨步骤、重复响应、委托、未知条件及未支持版本。响应同时保存完整行摘要和当时权限版本，旧 approved 或旧响应行不能替代受控证据。

相同请求重读原回执。同项目、scope、对象类型及 target 的 pending/approved、未消费且未到期审批阻止新幂等键或换工作流绕过。请求者当前仍有 `task.read` 时可以取消旧审批；到期记录不阻止新提议，超时不会产生人工批准。已消费记录和审批计划不会被清理或改写。

主进程旧 `ApprovalWorkflowManager` 对带 companion 的响应和自动超时明确返回 `CONTROLLED_APPROVAL_REQUIRED`。其旧流程保留原行为，不具备新的受控授权语义。

## 真实任务写入与回执

`OrganizationTaskDescriptionActionService`、`OrganizationTaskCreateActionService` 复用个人动作既有的持久 admission、确认、幂等、未决阻断与终态处理。组织路径额外要求完整多级审批；准入前只读核验批准，宿主确认后在最终 immediate 事务中再次复核权限、所有实际审批者、工作流、目标版本及 deadline。

审批单次消费、规范 Task 写入、Project 版本推进和成功回执在同一事务完成。组织成员无需成为原 `projects.user_id`，但创建不会改变原所有者。只创建 pending 任务，不运行部署、模型或外部操作。完整任务行在读取前执行 64 KiB 预算，描述上限 8192 UTF-8 字节；授权元数据读取仍保持有界。

ActionRun 的来源证据固定准入时原项目、org 和审批摘要。确认中任务移到其他项目会落盘 denied，不遗留 running；历史读取另外核验当前任务位置和原项目权限。合法旧 personal/team 历史与组织历史分开，损坏的组织候选不会被过滤后伪装成完整历史。

确定的版本/权限失败保存 denied。最终写入或成功回执发生数据库错误时，任务与消费回滚，原 admission 保留未决；新键不能重放。原请求的成功/取消回执可幂等重读。库内摘要是内容绑定，不是跨服务签名证明。

## 接口和验证

| 服务     | 已实现接口                                                                                                        |
| -------- | ----------------------------------------------------------------------------------------------------------------- |
| 组织权威 | `previewPolicy` / `attestPolicy`、`previewBinding` / `bindProject`、`revokeBinding`、事务内授权/审批者/工作流复核 |
| 受控审批 | `submit`、`get`、`respond`、`cancel`、`verifyApprovedInTransaction`、`consumeInTransaction`                       |
| 组织任务 | 版本预览、创建/描述执行、有界读取、分页列表、ActionRun 读取与历史                                                 |

Windows / Node 22.22.2，真实 better-sqlite3；组织共享服务与既有个人服务 8 文件、204 项，桌面宿主与旧审批/个人 IPC 3 文件、90 项通过，0 失败、0 跳过。完整参数、文件和内容哈希见[第六批验证证据](./evidence/palantir-gap-organization-authority-2026-10-07.json)。Astra 独立复现并复核登录会话、撤权 ABA、政策大小、晚建表、任务移项和历史隔离边界。

本批未完成组织固定 IPC/页面、双主体迁移、组织风险/目标及附属/看板入口、Document/Person/Decision 操作和跨服务证明。真实 GUI、Linux/macOS、真实租户及模型业务验收没有执行。按用户最新要求先完成源码与本地验证，保留全部后续任务，当前目标仍在进行。
