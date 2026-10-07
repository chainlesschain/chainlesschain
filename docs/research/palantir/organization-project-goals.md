# 组织共享目标与手动风险检查

更新：2026-10-07。本文保留第十批组织目标存储、共享权限、原生确认、幂等手动检查和桌面入口的交付记录。第十一批增加独立 `goal.monitor`、有期限 executor 同意和两种停止，见[组织目标周期巡检](./organization-project-goal-periodic.md)。第十二批已接入[组织目标建议与多级审批](./organization-project-goal-actions.md)，第十三批已接入[独立验收](./organization-project-goal-acceptance.md)，组织记忆仍待适配；本批未发布。

## 使用方式和权限

项目详情打开“组织任务与审批”。组织所有者在成员授权中明确配置目标权限，并原生重新确认政策。目标、任务和风险权限互不隐含。

| 权限          | 支持内容                                      | 额外要求                                           |
| ------------- | --------------------------------------------- | -------------------------------------------------- |
| `goal.read`   | 共享目标、创建者归因和累计用量                | 当前组织成员、政策及显式项目绑定有效               |
| `goal.create` | 原生确认后创建共享目标                        | 同时持有 `goal.read`                               |
| `goal.update` | 更新说明/标题/预算/到期，暂停、恢复或结束跟进 | 同时持有 `goal.read`                               |
| `goal.check`  | 手动检查当前目标项目的风险                    | 同时持有 `goal.read`、`risk.read`、`risk.evaluate` |

仅有 `goal.read` 的成员可看目标和用量，不加载任务描述、审批提议或风险事实。读取目标检查历史另外要求 `risk.read`；有风险权限的成员可从目标历史打开第九批的独立组织风险记录。

创建者 DID 只记录归因，不是共享目标的所有读取者或执行身份。有当前明确授权的其他成员可以更新同一目标；原创建者退出组织后，其归因仍保留，其他合法成员继续使用。

界面提供目标说明、次数预算、说明修改和暂停/恢复/结束操作。创建及更新经原生确认展示真实字段与摘要，确认后重验权限版本和目标 CAS。核心还支持标题、完整预算与到期时间修订；当前界面没有这些扩展编辑项。检查、任务写入或结束跟进都不会把目标标记为通过验收；第十三批仅通过独立验收服务完成目标；`done`、completion 和授权/记忆/trigger 补丁拒绝。第十二批允许受限 `allowedActionTypes` 原生修订，任务建议默认关闭；其余字段边界保持。

## 复用与隔离

组织服务复用 `GoalRepository` 和纯 `GoalRecord` 创建/修订合同。组织 Project 引用仅允许 `desktop.organization-project-goals` 与 organization scope，并要求 DID 创建者；个人范围仍须与 ownerRef 一致。纯合同描述意图，不授予权限。

| 独立表                                         | 内容                                              |
| ---------------------------------------------- | ------------------------------------------------- |
| `cc_organization_project_goal_store_meta`      | 独立目标 store 身份                               |
| `cc_organization_project_goals`                | 目标、版本、原组织映射、创建者及内容摘要          |
| `cc_organization_project_goal_mutations`       | 创建/修订请求的不可变回执                         |
| `cc_organization_project_goal_manual_requests` | 实际执行身份、目标定义和权限快照绑定的手动请求    |
| `cc_organization_project_goal_checks`          | occurrence、实际风险记录、结果摘要和 elapsed 用量 |
| `cc_organization_project_goal_usage`           | 与既有用量合同一致的独立预算账本                  |

目标 scope/创建者不可改，目标行保留且以 CAS 修改正文和内容摘要；请求、检查及变更回执不可 UPDATE/DELETE。构造时先建好全部领域表与 fence，再捕获版本。不迁移个人目标，不删除组织绑定 tombstone，不写样例任务或补造业务结果。当前没有自动清理或保留期调度。

既有 `GoalUsageLedger` 默认仍只接受个人范围。组织调用必须由可信宿主明确注入 organization namespace、共享预算及当前目标授权检查；不允许通过 renderer 参数放宽默认路径。组织目标预算按整个目标累计，不能换成员或 requestId 重置；执行硬限 1000 次，受更低的 maxRuns、时间和目标到期限制。纯本地规则不调用模型；显示模型费用未知。

## 手动检查和恢复

检查使用既有 `SchedulerRuntime`、独立 scheduler store、authority policy、lease、once-per-trigger occurrence 和结算。没有新增 workflow/session engine；手动检查不自动授予周期同意。当前 actor 是本次检查执行者，不继承目标创建者的长期授权。

请求固定 store/目标/修订/control generation、实际 actor、定义摘要及完整组织权限快照。新请求在准备、scheduler 授权、事务执行前后重验这些版本、当前 goal/risk 权限及预算；成员/政策/来源/schema 变化后恢复原内容不会恢复旧检查资格。

实际组织风险快照、规则记录、目标检查及累计检查用量在同一个 native SQLite 事务完成。风险仍仅识别逾期与未完成的直接依赖；数据不足保留真实不足状态，不宣称交付判断。事务内身份、时间预算或来源失效使这些写入全部回滚；领域提交后的返回校验失败保留已提交记录供后续授权核对。

创建/修订的幂等身份为 actor/kind/requestId，手动检查为 goal/actor/requestId。相同请求在当前读取权限下返回既有结果，不重复原生确认、目标版本、风险评估或计费；不同成员可以使用同名请求，但不能重放另一成员的写入。已完成检查在目标暂停、修订或政策重新确认后仍可授权读回，旧终态不依赖新的执行资格。损坏、跨目标游标和风险记录错配拒绝。

scheduler 结算是独立投影。领域检查成功后即使 scheduler 结算失败，同一请求可恢复已有检查；不会再次评估或重复扣目标预算。没有结果未知后的自动副作用重放。

## 桌面宿主与状态清理

新增 8 个精确 IPC：`organization-project:goal-create/read/list/revise/check/status/checks/check-read`。组织通道总数为 41；生成清单为 1300 个精确通道、156 个未注册 renderer 通道拒绝，无通配目标权限。

原生创建/更新按“校验输入/当前版本 → 确认真实字段与摘要 → 固定 actor/session 和权限快照重验 → 同事务保存目标与回执”执行。同 DID 重新登录、窗口/frame 替换、导航 ABA、数据库更换和成员撤权均拒绝。非法字段和陈旧目标版本在打开确认前拒绝。

手动检查在 await 初始化前后、dispatch、SQLite 写入前后与返回前验证可信 `getActor` guard。scheduler 路径由实际数据库真实路径摘要和 Electron userData 派生，使用独立 `organization-goal-monitoring` 目录，复用生产私有目录/文件 ACL 保护；renderer 不能指定路径或执行身份。应用关闭通过既有 composite host 同时等待个人与组织 host，关闭或换数据库会停止旧引擎并关闭其 store。

独立 Vue 面板校验目标的项目、组织和来源类型。项目/身份/权限变化清理目标、草稿及请求，丢弃迟到响应。当前会话内父工作区刷新会隐藏旧事实、清空显示和异步代次，并保留精确待核对请求；确认新上下文后重新读取。请求重试前去除 Vue proxy，仍使用原始内容和 key。明确拒绝会解锁编辑；丢失回复只保留原请求供用户明确核对/重试。风险历史另外校验根/结果 goalId 与 reviewId，避免错误链接。

第十批交付时周期巡检未开放；第十一批已单独适配实际 executor、原生周期同意、共享预算和停止/撤权恢复，参见[周期巡检说明](./organization-project-goal-periodic.md)。历史手动检查请求、计费及回执保持兼容。

## 本地验证和限制

| 验证组                                 | 文件 | 通过 | 失败/跳过 |
| -------------------------------------- | ---- | ---- | --------- |
| CLI 内共享服务与个人目标/风险/动作回归 | 18   | 541  | 0/0       |
| Session-Core 纯合同                    | 1    | 18   | 0/0       |
| 原生 IPC、scheduler host 和旧入口回归  | 11   | 200  | 0/0       |
| Vue 与真实 host/SQLite/scheduler       | 6    | 119  | 0/0       |
| 合计                                   | 36   | 878  | 0/0       |

新组织核心 30 项、原生 33 项、renderer 28 项，并补充纯组织引用/默认拒绝合同回归。四组文件互不重叠；历史批次有重叠，不累加。Astra 实现核心并完成独立原生测试及交叉审查；修复原请求 Vue proxy、确定拒绝后的锁定、历史错配和父刷新恢复。新增标题确认回归保证可选字段也可核对。

命令、源码及报告哈希见[第十批独立证据](./evidence/palantir-gap-organization-goals-2026-10-07.json)。保持第六至第九批证据不变。所选源码通过 Prettier、Node CJS/ESM 语法、Vue script/template 编译和 IPC 清单检查。

环境为 Windows / Node 22.22.2、实际 better-sqlite3 12.11.1、Vue 3.5.42、happy-dom 20.11.2。领域表、scheduler 文件库和 Vue 交互真实执行；Electron 原生窗口/认证、测试 ACL 回调为注入边界，ACL 拒绝行为有测试，不宣称完成目标生产系统 ACL 验收。没有真实 GUI、全仓库测试、完整类型检查、Linux/macOS 准确提交发布矩阵、真实租户或模型业务验收。第十二批已完成本轮目标建议多级审批绑定；第十三批已完成本轮独立目标验收；组织记忆、附属/看板及其余路线图任务仍未完成。

隔离验证使用 Git index 导出的快照及独立 session-core 包解析，排除并行通知策略模块。实时工作区的同文件通知修改保留，只有组织 scope 修改进入本批提交。
