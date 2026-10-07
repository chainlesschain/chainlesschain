# 规范组织项目授权、审批与任务执行

更新：2026-10-07。第七批将第六批组织权威、审批和任务服务接到桌面固定 IPC 与项目详情页面；新增可跨身份核对的持久提议、所有者设置和请求者/审批人工作区。完成源码与本地验证，未发布。

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

`OrganizationProjectApprovalService` 复用 `approval_workflows`、`approval_requests`、`approval_responses`，增加不可变的审批和响应 companion。提交时固定实际请求/输入/目标版本摘要、actor、org、Project/Task 身份、完整权限快照、工作流行摘要、审批计划及 deadline；审批回执不持久保存任务正文或原始幂等键。第七批的私有提议正文另存于下述业务表，不混入审批或 ActionRun 回执。

步骤沿用现有 DID 或 DID 数组：sequential/any_one 每步任一指定人批准，parallel 每步全部批准。每次响应必须声明 step，由当前可信身份执行；拒绝自审批、跨步骤、重复响应、委托、未知条件及未支持版本。响应同时保存完整行摘要和当时权限版本，旧 approved 或旧响应行不能替代受控证据。

相同请求重读原回执。同项目、scope、对象类型及 target 的 pending/approved、未消费且未到期审批阻止新幂等键或换工作流绕过。请求者当前仍有 `task.read` 时可以取消旧审批；到期记录不阻止新提议，超时不会产生人工批准。已消费记录和审批计划不会被清理或改写。

主进程旧 `ApprovalWorkflowManager` 对带 companion 的响应和自动超时明确返回 `CONTROLLED_APPROVAL_REQUIRED`。其旧流程保留原行为，不具备新的受控授权语义。

## 持久提议与正文期限

`OrganizationProjectProposalStore` 在 `cc_organization_project_proposals` 私有业务表中保存完整校验请求，包括描述与用于恢复的原始幂等键；提交提议和提交审批在同一个 immediate 事务完成。元数据、摘要与审批绑定不可改写，分页列表不返回正文或完整审批计划。读取正文之前重新核验当前项目权限和组织作用域，限制请求 64 KiB、描述 8192 UTF-8 字节。

正文可用期限固定为审批 deadline 与创建后 7 天中的较早者；重试不延长期限。取消、拒绝、到期或目标移项后，读取返回元数据与 `request:null`。已执行提议在期限内仍可核对原请求；请求者可独立读取已保存的取消、成功或未决 ActionRun。审批计划和消费历史继续保留。

共享 `purgeExpired({projectId,limit})` 每次最多物理清除 100 条到期正文和原始幂等键，保留不可变元数据及审批历史。到期即停止返回正文，但目前没有自动清理调度或页面清理入口；实际库内删除须显式调用此方法，不能把读取到期等同自动物理擦除。

执行 IPC 仅接受 `proposalId`，主进程取回持久原请求；不接受 renderer 替换正文。准入、最终写入前和写入后均在实际事务中核验提议摘要、审批绑定及正文期限。确认期间到期保存 denied，任务变更与审批消费回滚。审批响应也在同一事务中核验正文期限与实际审批者。

## 真实任务写入与回执

`OrganizationTaskDescriptionActionService`、`OrganizationTaskCreateActionService` 复用个人动作既有的持久 admission、确认、幂等、未决阻断与终态处理。组织路径额外要求完整多级审批；准入前只读核验批准，宿主确认后在最终 immediate 事务中再次复核权限、所有实际审批者、工作流、目标版本及 deadline。

审批单次消费、规范 Task 写入、Project 版本推进和成功回执在同一事务完成。组织成员无需成为原 `projects.user_id`，但创建不会改变原所有者。只创建 pending 任务，不运行部署、模型或外部操作。完整任务行在读取前执行 64 KiB 预算，描述上限 8192 UTF-8 字节；授权元数据读取仍保持有界。

ActionRun 的来源证据固定准入时原项目、org 和审批摘要。确认中任务移到其他项目会落盘 denied，不遗留 running；历史读取另外核验当前任务位置和原项目权限。合法旧 personal/team 历史与组织历史分开，损坏的组织候选不会被过滤后伪装成完整历史。

确定的版本/权限失败保存 denied。最终写入或成功回执发生数据库错误时，任务与消费回滚，原 admission 保留未决；新键不能重放。原请求的成功/取消回执可幂等重读。库内摘要是内容绑定，不是跨服务签名证明。

## 桌面使用入口

项目详情的“组织任务与审批”打开独立工作区。未绑定项目的所有者依次选择组织、创建审批计划、配置明确成员授权、预览并原生确认政策，再预览并原生确认项目绑定。已有个人入口继续单独授权；绑定后其个人访问拒绝保持生效。

请求者读取规范任务，准备创建或描述修改，预览后提交持久提议；审批人用自己的登录身份读取实际提议正文和多级计划，原生核对修改前后内容，再批准或拒绝。所有步骤批准后仍由请求者原生确认执行，不自动运行所创建任务。所有者可重新确认政策或明确撤销组织使用权限。

主进程注册 20 个 `organization-project:*` 精确通道，preload 暴露 `electronAPI.organizationProject`；生成清单没有通配授权。setup 目录限制 1,000 位成员、100 个组织项目与 20 个任务工作流；新建工作流在达到上限时于原生确认前拒绝。

界面在项目、身份、开关变化及当前授权无法建立时清除私有状态，丢弃迟到响应。所有者设置遇到撤权会通知父组件一并清除任务和提议正文。提议正文到期时本地定时清除，审批和执行仍以后端事务时间核验为准。提交或执行回复丢失时通过摘要或持久 ActionRun 核对，完整刷新保留当前作用域的未知提交线索，不自动重试写入。

原生确认同时绑定认证 generation、数据库、窗口、当前 mainFrame 和导航代；原事件 frame 仍存活但已被替换、导航后恢复同 URL，均不能完成原确认。

## 接口和验证

| 服务     | 已实现接口                                                                                                        |
| -------- | ----------------------------------------------------------------------------------------------------------------- |
| 组织权威 | `previewPolicy` / `attestPolicy`、`previewBinding` / `bindProject`、`revokeBinding`、事务内授权/审批者/工作流复核 |
| 受控审批 | `submit`、`get`、`respond`、`cancel`、`verifyApprovedInTransaction`、`consumeInTransaction`                       |
| 组织任务 | 版本预览、创建/描述执行、有界读取、分页列表、ActionRun 读取与历史                                                 |
| 私有提议 | `submit` / `get` / `getInTransaction` / `list` / `purgeExpired`；主进程按提议 ID 审批、取消及执行                 |

第七批 17 个互不重叠的测试文件、393 项通过、0 失败、0 跳过，见[独立证据](./evidence/palantir-gap-organization-workflow-2026-10-07.json)。Windows / Node 22.22.2，实际 better-sqlite3、主进程业务服务与双向结构化克隆；renderer 使用真实 Vue 组件及 happy-dom，Electron 原生窗口/确认框是注入边界。覆盖完整所有者设置与绑定、请求者提交、跨身份多级审批、最终规范任务写入、失权清理、到期和未知回复恢复。

第六批历史验证为共享服务 8 文件、204 项，桌面宿主与旧审批/个人 IPC 3 文件、90 项通过，0 失败、0 跳过，原[第六批证据](./evidence/palantir-gap-organization-authority-2026-10-07.json)保持不变。Astra 在第七批复现 frame 替换/导航恢复和 renderer 权限清理问题，补充真实 host/SQLite 交互回归。

仍待双主体迁移、组织风险/目标及附属/看板入口、Document/Person/Decision 操作和跨服务证明。真实 Electron GUI、完整类型检查、Linux/macOS、真实租户及模型业务验收没有执行。按用户最新要求先完成源码与本地验证，将已完成内容提交主分支；保留全部后续任务，当前目标仍在进行。
