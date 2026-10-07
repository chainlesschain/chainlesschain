# Dots / Muse / Mods 借鉴：实施进度

更新日期：2026-10-07。当前工作分支：`main`；原 `feature/dots-muse-mods-foundation` 已通过 `58a30cbae7` 完整合并，后续修改在主分支继续。开始实施时基线：`1de6f0f8d052eb1186a06ce6d30d0aa2dfffe85b`。

依据：[分析与实施计划](./chainlesschain-dots-muse-mods-analysis-2026-10-06.md)。B0/B1 目标基础与公共持久调度模块已提交为 `f74ae00de0`，首个风险巡检宿主与目标面板为 `ae8b2c5b57`，持久建议/原生动作与恢复为 `e8b5c87951`。独立完成检查器、停止单次执行、结束跟进及桌面验收面板已进入 `5c5a742a6b`，并随功能分支合入主分支；目标记忆原生驱动、引用/授权/恢复服务及桌面 IPC 已完成本地验证，记忆界面、通知、扩展及实际业务验收仍需继续交付。

**最新验收与控制回归：30 个互不重叠的测试文件，545 项通过，0 失败、0 跳过。** 分别为 CLI 292 项、Desktop 172 项、Renderer 79 项及隔离打包 2 项；包含 34 项独立完成、69 项监控、26 项跨域 usage 和既有 13 项真实 Node 子进程恢复用例。历史动作与恢复批次为 26 个文件、453 项，监控为 36 个文件、705 项，基础为 21 个文件、412 项，共享调度器为 27 个文件、521 项；各批有重叠，不相加。Electron 窗口和对话框在宿主测试中为替身，尚未运行真实 Electron GUI、真实业务效果评测或候选提交的远端发行矩阵。

| 任务                   | 本轮状态                                 | 已实现                                                                                                                                                              | 仍需实施或验收                                                                                          |
| ---------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| DMM-00 宿主接入        | 公共模块与首个桌面宿主完成               | 共享调度器与授权额度；主进程派生私有独立调度库；当前原生驱动、连接轮换和退出 draining；隔离 npm pack 加载                                                           | 实际桌面应用打包、完整 GUI 旅程及远端候选提交验证                                                       |
| DMM-01 目标合同        | 合同与独立业务完成检查器完成             | 版本/控制代次、个人引用；监控、原生动作、独立验收共享预算；明确业务断言与人工验收，完成证明同事务提交；模型 usage 保留未知费用与实际下界                            | 真实模型调用 adapter、其他执行域及实际业务有效性验收                                                    |
| DMM-02 存储适配        | CLI 与原生项目 SQLite 基础完成           | 同一 CLI 文件、严格锁内 CAS、旧数据安全缺省值、超限旧历史兼容、原生事务内身份/归属复核、当前权限读取、IPC/preload                                                   | 用户显式导入 CLI 目标到项目的备份/映射/回退流程；进程级并发及故障恢复演练；真实 GUI 使用入口            |
| DMM-03 持续调度        | 风险 adapter、独立停止控制与进程恢复完成 | 真实 SIGKILL、双进程抢占、迟到 fence、撤权恢复；持久停止本次执行与结束跟进；共享预算、离线合并和真实 draining 投影                                                  | 其他 adapter 和 canonical Graph 接入                                                                    |
| DMM-04 受控动作        | 原生动作回执与独立完成复核已接通         | goal→risk review→intent/admission→ActionRun；当前版本预览、原生确认、同事务血缘与 usage；未解决动作阻止验收；暂停/修订/到期/撤权/退出阻止旧确认；未知结果不换键重放 | 真实 Electron 旅程及更完整的审计展示                                                                    |
| DMM-05 记忆与通知      | 记忆原生服务与 IPC 完成，界面/通知待交付 | 现有 Kernel 原生 SQLite driver；目标仅存版本引用；显式分类、修正、单调撤权、真实删除回执、恢复/丢弃与输出前精确复核；无自动事实提升                                 | 记忆面板验证与真实 GUI；持久站内通知、静默时段、已读状态与语义去重；真实输出 adapter 接入               |
| DMM-06 工作区闭环      | 目标/动作/验收与结束控制界面回归完成     | 建议分页、范围设置、草稿恢复、当前预览、原生确认、回执/风险证据；验收配置/检查/完成历史、停止本次与结束跟进；跨身份/版本丢弃迟到响应及失效证据                      | 真正 Electron GUI 旅程与最终产品验收                                                                    |
| DMM-07/08 扩展与场景包 | 待实施                                   | 沿用既有插件能力，不开放新扩展执行                                                                                                                                  | 声明式事件/UI SDK、项目交付助手包、安装升级及禁用处理                                                   |
| DMM-09/10 效果与发行   | 恢复演练已补，待业务与发行验收           | 13 项真实进程演练；CLI 默认单元/集成集合及桌面固定配置包含新回归；本批 545 项独立证据                                                                               | 实际业务样本、准确候选提交三平台 CI、默认关闭开关、灰度和迁移/回退；发行时遵守 OIDC 与子包→CLI→IDE 顺序 |

## 公共契约和加载边界

新增公共子路径：

- `@chainlesschain/session-core/scheduler-contract`
- `@chainlesschain/session-core/scheduler-service`
- `@chainlesschain/session-core/scheduler-authority-resolver`
- `@chainlesschain/session-core/scheduler-runtime`
- `@chainlesschain/session-core/scheduler-store`
- `@chainlesschain/session-core/scheduler-source-path`
- `@chainlesschain/session-core/private-storage`
- `@chainlesschain/session-core/host-storage-environment`
- `@chainlesschain/session-core/goal-contract`
- `@chainlesschain/session-core/goal-repository`
- `@chainlesschain/session-core/project-goal-service`
- `@chainlesschain/session-core/project-goal-monitoring`
- `@chainlesschain/session-core/goal-usage-ledger`
- `@chainlesschain/session-core/project-goal-workflow`
- `@chainlesschain/session-core/project-goal-completion`

[调度契约](../../../packages/session-core/lib/scheduler-contract.js)和[调度服务](../../../packages/session-core/lib/scheduler-service.js)复用原实现；CLI 原 `scheduler-kernel/contract.js` 与 `service.js` 现在是薄入口。CJS 宿主和 ESM CLI 的构造器、常量、错误实例保持一致。隔离包测试只安装公共入口及其依赖闭包，未加载 CLI 私有模块、整个 Session Core index 或原生数据库驱动。

后续切片已将 runtime、store、source-path 和文件保护实现移至 Session Core 公共 CJS 子路径，CLI 保留原 Graph、home 和原生数据库装配的兼容入口。中立 runtime 必须注入 Graph Authority，或明确选择 legacy Graph 模式；两种方式均要求实时授权回调。中立 store 必须由宿主显式提供 file、Database 和同步确认的 protectStorage；磁盘文件在打开前后均验证保护，失败时拒绝打开或关闭连接。

共享文件保护保留原有 Windows ACL 缓存、工作目录、超时、链接检查和隐藏辅助进程语义。调度账本仍校验独立的 application ID、schema version 和 catalog，不能直接放入已有项目库。首个桌面风险巡检宿主现已接入：按可信应用数据路径与数据库实路径派生独立账本，以同一原生驱动打开，退出时中止并等待后台及手动操作结算后再关闭。连接替换会锁住并排空旧宿主，再建立新宿主。

## 目标与存储行为

[目标契约](../../../packages/session-core/lib/goal-contract.js)保留 `active/paused/done/abandoned`，执行状态单独保存。记录包含权威存储标识、revision、控制代次和个人项目引用。通用修订不允许改写身份、项目绑定、存储 ID、版本、控制代次、执行状态或完成证明。

修订通过 CAS 增加 revision 和控制代次。进度为 100 不能将项目目标标为完成；完成需可信独立检查器，其证据绑定目标定义、当前版本与全部验收条件。当前桌面已安装原生业务验收检查器并暴露独立验收/完成接口，详细边界见下文。授权引用与允许动作类型只是描述，不能替代真实业务授权。

[CLI 适配器](../../../packages/cli/src/lib/goal-store.js)与既有 `cc goal` 读写同一文件。读旧文件仅产生兼容视图，不自动改写、绑定 DID、监控或项目权限；修改和可选删除 CAS 都在现有严格文件锁内检查。旧命令的明确关闭仍是人工声明，不产生核验完成证明。已核验的独立目标需先重新打开再修改；重新打开清除当前完成证明并推进控制代次。

旧版允许较长历史。无法无损放入新记录边界的 versionless 文件继续使用旧适配路径，保留全部 notes 并维护 revision/controlGeneration；暂停、进度和附注仍可使用。新格式记录不能降级进入此路径。错误、未知 schema 和 CAS 冲突不写入原文件。

[个人项目存储](../../../packages/session-core/lib/project-goal-service.js)在现有原生数据库创建 `cc_project_goal_store_meta` 和 `cc_project_goals`。每次读取/写入均从宿主解析当前 DID 并检查当前项目归属；拒绝直接组织/工作区字段以及 `organization_projects`、`workspace_resources` 关联。写入在 native immediate 事务内比较 revision 并重验身份；错误或身份变化回滚。真实 SQLite 关闭重开验证记录和存储标识持久化。

记录整体、JSON 结构、文本和分页都有上限；整体序列化上限为 64 KiB。数据损坏、元数据不一致和超限记录明确拒绝，避免出现“写入成功但读取失败”的大小边界差异。本轮没有宣称本地 SQLite 测试证明生产加密配置或真实进程崩溃恢复。

## 桌面开发接口

[项目目标 IPC](../../../desktop-app-vue/src/main/task/project-goal-ipc.js)已接入任务 IPC 初始化，使用可信来源、有效窗口和主进程当前身份。元数据、监控、建议/动作、验收及单次停止/结束跟进通道均已加入 preload 与固定 renderer 能力清单。

```js
const goal = await window.electronAPI.project.createGoal({
  projectId: "personal-project-id",
  objective: "持续关注本项目交付风险",
  acceptanceCriteria: [
    {
      id: "risk-reviewed",
      kind: "manual",
      description: "核对项目风险及处理结果",
    },
  ],
  budgetPolicy: { maxRuns: 20 },
});

const current = await window.electronAPI.project.readGoal({ id: goal.id });
const goals = await window.electronAPI.project.listGoals({
  projectId: "personal-project-id",
  limit: 20,
});

await window.electronAPI.project.reviseGoal({
  id: current.id,
  expectedRevision: current.revision,
  patch: { status: "paused" },
});
```

创建目标仍保存 `executionState: idle` 的意图，不自动开启工作。实时执行状态从监控状态接口读取，除 `waiting/running/blocked/pause-requested/paused/idle` 外，还区分结束跟进的 `end-requested/ended` 和独立完成后的 `completion-draining/completed`；目标记录本身不伪造执行状态或完成证明。

## 持久风险巡检与主进程登录态

[巡检引擎](../../../packages/session-core/lib/project-goal-monitoring.js)在项目原生库保存显式监控配置、手动请求绑定和已完成检查。风险 review、检查证据与每目标 usage 同事务提交；调度库的 occurrence 结算是独立投影。注入“项目已提交、调度结算失败”后，真实重开数据库并重新取得租约，会读取同一 review，检查次数及 principal 预留均不重复扣账。租约丢失、身份变化、期限/时间超限或保存检查失败会回滚项目 review 和检查。

手动请求绑定 goal revision、control generation 和 scheduler policy revision；新请求可绑定当前策略，历史请求保留原身份。检查结果与历史读取都重验记录摘要和授权风险证据，已成功的 scheduler 终态也不能绕过复核。每目标最多保留 1000 次有效检查/手动意图，状态展示最新 20 条；单次扫描及执行最多 50 项，以游标避免撤权记录阻塞后续目标。检查周期为 1 分钟至 7 天，离线周期合并为一次到期检查。

目标次数/时间预算与 principal 全局额度独立执行；耗尽、过期、撤权时不持续新增无效 timer 队列。当前规则不调用模型，模型 tokens/cost usage 为零。暂停目标与关闭配置在同一 CAS 事务中更新；尚有 claimed occurrence 时显示“暂停中”，待结算后才显示“已暂停”。这些检查不改业务任务，也不自动完成目标。

[专用主进程会话](../../../desktop-app-vue/src/main/task/project-goal-auth-session.js)仅从真实可信 PIN/密码登录成功 handler 建立。默认 DID 自动加载不代表登录；软件密码模式不要求 UKey；UKey 模式绑定当前驱动，锁定、拔出、驱动切换和身份变化会撤销授权。认证代次阻止延迟返回的旧 PIN 结果在锁定/退出后恢复会话。退出登录先等待主进程撤销确认，再清除界面登录态；原有明文凭据日志已移除。本批沿用既有密码校验规则，没有将其写成新密码认证系统。

[目标面板](../../../desktop-app-vue/src/renderer/components/projects/ProjectGoalMonitoringPanel.vue)已放入现有项目风险面板。支持保存目标、显式开启巡检、立即检查、暂停、重新启用、预算/授权阻塞显示、历史 review 联动和分页。超时保留本次 requestId；重试读取同一次检查。项目/身份切换会清除数据并丢弃旧响应，策略换版后允许显式刷新巡检授权。

开发调用示例（使用当前 active 目标的最新 revision）：

```js
const status = await window.electronAPI.project.startGoalMonitoring({
  id: goal.id,
  expectedRevision: goal.revision,
  intervalMs: 3_600_000,
});
const request = {
  id: goal.id,
  expectedRevision: goal.revision,
  requestId: crypto.randomUUID(),
};
const check = await window.electronAPI.project.checkGoalNow(request);
// 网络/IPC结果不确定时复用request；新的独立检查使用新的requestId。
const paused = await window.electronAPI.project.stopGoalMonitoring({
  id: goal.id,
  expectedRevision: goal.revision,
});
const current = await window.electronAPI.project.getGoalMonitoringStatus({
  id: goal.id,
});
```

## 本批受控动作与恢复

[工作流服务](../../../packages/session-core/lib/project-goal-workflow.js)在风险检查的原生事务内保存建议。语义签名排除检查时间与行更新时间；同一目标控制代次中的同一风险/动作建议只消费一次。每目标分别保留最多 500 条建议与 500 条意图，单次检查最多新增 100 条建议；容量不足明确记录省略数量，仍保存完整风险检查。准备时先持久化 requestId、参数与幂等身份，再读取当前原生版本并保存精确预览；中断后沿原请求恢复。

执行通过既有 TaskDescriptionActionService / TaskCreateActionService，严格原生确认后再次检查目标 revision/control、到期、身份、归属、风险来源和对象版本。动作变更、ActionRun、风险血缘、目标意图及 usage 在同一项目 SQLite 事务提交；关联保存失败则回滚业务写入，保留未解决的 admission。桌面窗口、来源导航、连接或身份变化均阻止旧确认。目标的允许动作列表仅作为范围上限，不能代替当前业务授权与原生确认。

[使用量账本](../../../packages/session-core/lib/goal-usage-ledger.js)共享风险检查和原生动作的次数/时间预算，并为未来模型 adapter 保存真实或未知 quantities。未知费用不能写成零；已报告实际量是不可降低的下界；终态预留不能重新用作派发许可。原生动作没有模型调用，因此 token/模型费用为零，但未知动作耗时保持 null。真实崩溃后的恢复只核查原 ActionRun 并标记未知时间，不重新确认或写入；同进程正在等待确认的操作保留活跃预留，另一进程恢复后的迟到确认失效。

新增桌面固定通道为 `project:goal-proposals`、`project:goal-intent-prepare`、`project:goal-intent-execute`、`project:goal-intent-read`，对应 preload 的 `listGoalProposals`、`prepareGoalIntent`、`executeGoalIntent`、`readGoalIntent`。执行接口只接收已持久化的 intentId，不接收 renderer 提供的审批。现有目标卡片内的[动作面板](../../../desktop-app-vue/src/renderer/components/projects/ProjectGoalActionsPanel.vue)提供范围设置、当前预览、原生确认入口、草稿恢复、未知状态和回执查询。描述修改或新建任务不修改截止时间与依赖字段；复查仍可能命中原风险，也不表示目标完成。

本批证据：[CLI 226 项](./evidence/dmm-workflow-2026-10-07/cli-tests.json)、[Desktop 158 项](./evidence/dmm-workflow-2026-10-07/desktop-tests.json)、[Renderer 67 项](./evidence/dmm-workflow-2026-10-07/renderer-tests.json)、[隔离打包 2 项](./evidence/dmm-workflow-2026-10-07/packed-host.tap)、[来源与汇总](./evidence/dmm-workflow-2026-10-07/summary.json)。汇总保存源码文件 SHA-256、宿主/依赖、场景和真实/替身边界；不将这些本地证据视为候选提交的远端发行门。

两份真实进程测试分别覆盖 [10 项巡检恢复](../../../packages/cli/__tests__/integration/project-goal-process-recovery.test.js)与 [3 项动作恢复](../../../packages/cli/__tests__/integration/project-goal-workflow-process-recovery.test.js)。父进程先独立读库确认 admission/项目结果已提交，再强制终止存活子进程；动作恢复用例在 kill 后确认 usage 仍为 reserved，证明未经过正常 catch 清理。检查计时、租约时钟和审批等待屏障是测试控制；它们不代替真实 Electron 或业务样本验收。

```powershell
# 从 packages/cli 运行；完整批次的精确选择见证据中的 cli-command.json。
node ../../node_modules/vitest/vitest.mjs run __tests__/unit/project-goal-workflow.test.js __tests__/unit/goal-usage-ledger.test.js __tests__/unit/project-goal-monitoring.test.js __tests__/integration/project-goal-process-recovery.test.js __tests__/integration/project-goal-workflow-process-recovery.test.js
```

Astra 完成真实进程用例与独立复核，已修复未知时间误报零、建议容量回滚完整检查、大风险快照摘要边界、跨目标恢复分页和持久草稿缺少继续入口的问题。npm pack 初次因沙箱外缓存写入失败，获准重跑后通过；该环境重试与业务失败分开记录。

## 最新独立验收与停止控制

[独立完成服务](../../../packages/session-core/lib/project-goal-completion.js)要求用户明确配置验收条件及类型映射，不从目标描述、模型文本、进度或调度成功推断完成。当前支持三种业务断言：`all-tasks-completed` 要求项目非空且所有当前任务均为 completed；`selected-risk-signals-cleared` 仅验证显式选择的逾期/未完成依赖信号；`all-goal-actions-resolved` 要求目标没有 draft/prepared/running 意图。取消任务、空项目、旧风险检查或未解决动作不能满足相应条件。人工条件必须通过 strict/high 原生 ApprovalGate 确认，renderer 不能提交确认结论。

配置推进目标 revision/controlGeneration，将计划绑定目标定义与条件摘要；修订后旧计划和旧人工确认失效。每次独立检查读取新的原生风险证据与目标动作成员快照；完成操作重新核验当前业务行，不复用早先通过的检查。完成 CAS、来源证据、回执、真实 verifier usage 与关闭巡检在同一原生事务提交。失败检查保存原因与实际费用/时间；`native-verifier` 与监控/动作共享预算且模型 token/cost 为零。若保存证据时跨过到期时间或超出预算，保留失败记录和真实 usage，不完成目标。

计划、人工确认、检查和来源保存于 `cc_project_goal_acceptance`，每目标有界保留。相同 requestId 读取原回执，不重做检查或再次计费；不同请求身份冲突明确拒绝。回读重新核对计划/目标绑定、源风险证据、动作成员及终态回执、逐项结果、verifier 账本与目标完成证据的 digest/version。缺少 usage、重算后与源事实不一致、或只有相同证明 ID 而版本不同均拒绝。

停止本次执行使用 `stopGoalOccurrence({id, expectedRevision, occurrenceId, expectedFence, requestId})`，项目库的停止意图持久化后，再投影到独立调度库；未来巡检保持配置。投影失败或执行仍 claimed 显示 `stop-requested`，实际结算后显示 `stopped`；已经结束显示 `already-finished` 并保留真实结果。外部恢复调度控制不能绕过项目停止意图，也不退回已经消耗的预算。`endGoalFollowUp({id, expectedRevision})` 则将目标置为 abandoned、推进版本/控制代次并关闭未来巡检；尚有执行时显示 `end-requested`，结算后显示 `ended`。两库不宣称原子提交。

新增七个固定通道：`project:goal-occurrence-stop`、`project:goal-follow-up-end`、`project:goal-acceptance-configure`、`project:goal-acceptance-status`、`project:goal-acceptance-acknowledge`、`project:goal-acceptance-check`、`project:goal-complete`。人工验收对话框显示当前目标/版本/归属及全部人工条件，并在返回后复核可信 frame/window、登录身份、数据库连接及 revision；导航、退出登录、身份切换、连接轮换或修订均拒绝旧确认。

目标卡片的[验收面板](../../../desktop-app-vue/src/renderer/components/projects/ProjectGoalAcceptancePanel.vue)提供条件配置、原生人工验收、独立检查、重新核验并完成、逐项结果/历史和原始风险证据。仅当当前完成证明可授权读取时显示验收完成。身份/版本变化丢弃迟到响应；权威读取失败清除旧证据，并清除父卡片中已失去授权的目标元数据。检查和确认结果不确定时保留 requestId；已知 revision/fence 冲突清除失效请求。

本批证据：[CLI 292 项](./evidence/dmm-acceptance-2026-10-07/cli-tests.json)、[Desktop 172 项](./evidence/dmm-acceptance-2026-10-07/desktop-tests.json)、[Renderer 79 项](./evidence/dmm-acceptance-2026-10-07/renderer-tests.json)、[隔离打包 2 项](./evidence/dmm-acceptance-2026-10-07/packed-host.tap)、[来源与汇总](./evidence/dmm-acceptance-2026-10-07/summary.json)。汇总绑定报告、源码 SHA-256、具体命令与测试/替身边界；修正命令记录中相对于 cwd 的 Vitest 路径，并保留原显示记录。测试通过后的 preload 改动仅为 Prettier 格式化，不将该后置快照写成准确提交 CI 证明。

Astra 独立复核并复测了到期边界、缺失 verifier usage 与完成证据版本绑定问题，均已修复。固定 IPC 清单验证通过（1250 个准确通道）；实际 Electron GUI、业务样本和远端候选提交验证仍未运行，不能用本地 545 项回归替代。

## 目标记忆原生基础与桌面 IPC

本批 **25 个互不重叠文件、375 项通过，0 失败、0 跳过**：目标记忆服务 29 项、既有目标/独立验收 45 项、桌面主进程 189 项、Kernel 全包 112 项（其中新增原生驱动 13 项）。与此前 545 项验收批次有重叠，不相加。记忆 renderer 面板仍在实现，本批未将其列为已验证交付，也未运行真实 Electron GUI。

[共享原生 MemoryPort](../../../packages/context-memory-kernel/lib/native-sqlite-memory-port.js)实现同步精确 read/readEvent、不可扩大作用域、逐操作可信授权、原生 immediate CAS/事件血缘及永久墓碑。使用现有 Kernel reducer/propose/decide/delete/reconcile，不复制生命周期逻辑、不依赖 CLI 私有模块。记录、事件、作用域版本及删除协调操作在现有原生连接持久化；两个独立连接的 CAS 与关闭全部句柄后的删除协调恢复已有真实 SQLite 用例。

[目标记忆服务](../../../packages/session-core/lib/project-goal-memory.js)由可信宿主派生 store/actor/project/goal 的散列 scope 和精确 sink。目标只存 `{kind,id,version}` 引用，version 绑定 revision/digest；权限由当前项目归属、目标引用和持久 grant/epoch 共同决定。用户明确事实、Agent 推断与执行备注保持分类，不把目标文本、progress 或执行状态自动写成长期事实。

输出前同步读取精确记录并检查 active/reinforced、有效期、精确 scope/sink/revision/digest，再复核当前 Goal/grant。`revalidateOutput` 不接收缓存正文，旧 envelope 不能越过身份、版本或撤权代次。修正生成 successor 并保存 supersede 事件；删除或撤权先提交读取 denial，再恢复 Kernel 清理。操作日记不复制正文，相同请求沿原身份恢复；目标修订后的孤立 candidate 可显式丢弃。已验收目标仍可做隐私清理，不伪造替代完成证明。

Astra 独立复核发现的全目标 pending/容量阻止其他记忆撤权、复用丢弃键误认另一条删除回执，以及缺失删除回执仍可回放的问题已修复并加入回归。清理身份绑定原 operation、精确 memoryId 和 discardRequestId；purged 回执复核 Kernel reconciliation 与当前墓碑 revision/digest。同步 purge target 抛错现会生成 partial 回执并保留 denial，不再跳出协调流程。

桌面新增八个固定 memory 通道及 body-free invalidation 事件；preload 提供查看/创建/修正/删除/撤权/操作查询/恢复/丢弃。宿主绑定窗口、frame URL、当前认证代次/DID 与捕获的原生连接，跨 await 变化拒绝迟到结果。固定 IPC 验证通过（1259 个准确通道）。新 Kernel driver 已登记为唯一 canonical runtime 的存储适配，目标服务登记为 capability client。

证据：[目标/验收 74 项](./evidence/dmm-memory-2026-10-07/core-tests.json)、[桌面 189 项](./evidence/dmm-memory-2026-10-07/desktop-tests.json)、[Kernel 112 项](./evidence/dmm-memory-2026-10-07/kernel-tests.tap)、[命令与来源汇总](./evidence/dmm-memory-2026-10-07/summary.json)。这是当前本地工作树快照；其中含并行组织权限调整，不能称为准确提交 CI 或发行门证据。`purged` 表示权威记录与注册在线清理目标的逻辑清理，不证明 SQLite WAL、备份或此前导出的物理擦除。持久通知、真实模型输出 adapter、实际业务效果和远端发行验证仍待完成。

## 上一批监控验证与证据

| 验证                  | 最新结果   | 范围                                                                         |
| --------------------- | ---------- | ---------------------------------------------------------------------------- |
| CLI 21 个文件         | 408 项通过 | 目标/受控动作及共享调度器回归、44 项原生巡检、7 项授权解析、真实 Windows ACL |
| Session Core 2 个文件 | 91 项通过  | 目标与业务对象合同、独立完成证明、有界 JSON                                  |
| Desktop 7 个文件      | 144 项通过 | 19 项宿主/真实 ACL、21 项生产认证链路、38 项旧 UKey IPC 与既有安全边界       |
| Renderer 5 个文件     | 60 项通过  | 11 项目标交互、6 项退出登录、风险/任务面板和已有组件旅程                     |
| Node 打包 1 个文件    | 2 项通过   | 真实 npm pack、CJS/ESM 新公共模块及 CLI shim 身份、隔离宿主加载              |
| 固定 IPC 能力与差异   | 通过       | 固定 renderer 能力清单及 git diff --check                                    |

历史证据：[CLI](./evidence/dmm-monitoring-2026-10-07/cli-tests.json)、[Session Core](./evidence/dmm-monitoring-2026-10-07/session-core-tests.json)、[Desktop](./evidence/dmm-monitoring-2026-10-07/desktop-tests.json)、[Renderer](./evidence/dmm-monitoring-2026-10-07/renderer-tests.json)、[打包 TAP](./evidence/dmm-monitoring-2026-10-07/packed-host.tap)、[来源与汇总](./evidence/dmm-monitoring-2026-10-07/summary.json)。保留 [foundation](./evidence/dmm-foundation-2026-10-07/) 和 [neutral scheduler](./evidence/dmm-neutral-scheduler-2026-10-07/) 历史证据。

本机使用已准备的工作区依赖与 Node 22.22.2。Renderer 的 Happy DOM 位于工作区 junction，而 Vitest 实际位于 npm cache，本地通过仅重定位该现有依赖的 Node import hook 运行标准环境；额外 Pinia 安装在 Windows Temp，并以工作区 junction 提供。未改项目 dependency manifest/lockfile。正常依赖安装环境直接运行：

```powershell
# 分别从对应package目录运行：
node ../../node_modules/vitest/vitest.mjs run __tests__/unit/project-goal-monitoring.test.js
node ../node_modules/vitest/vitest.mjs run --config vitest.business-actions.config.mjs
node ../node_modules/vitest/vitest.mjs run --config vitest.business-actions-renderer.config.mjs
# 从仓库根目录运行：
node --test packages/session-core/__tests__/scheduler-host-boundary.node.cjs
node desktop-app-vue/scripts/verify-fixed-renderer-ipc.mjs
```

Astra 独立复核了调度权限、恢复和真实锁定链路；已修复旧手动 job 换版、终态证据绕过、预算耗尽持续入队、分页误报停止及 UKey 锁定仍保留 DID 的问题。本地结果不代表远端三平台发行门通过。

后续仍需交付：canonical Graph、记忆/通知、声明式扩展及场景包；同时完成实际 Electron GUI、CLI 显式导入、真实模型 adapter、真实业务样本和默认关闭/迁移/回退验收。DMM-05 下一步采用现有 Memory Kernel，由可信宿主派生 store/actor/project/goal 作用域，目标仅存版本引用；修正/删除/撤权后按记录重新授权，站内通知使用独立身份隔离的持久引用投影与语义去重，避免复用全局 localStorage 或未按 actor 过滤的旧通知查询。真实业务样本尚待用户提供项目来源与独立预期。发行时仍必须通过准确提交的三平台 CI，并遵循 OIDC 和子包→CLI→IDE 顺序；总体实施目标保持进行中。
