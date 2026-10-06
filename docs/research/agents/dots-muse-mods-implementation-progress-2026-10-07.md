# Dots / Muse / Mods 借鉴：实施进度

更新日期：2026-10-07。工作分支：`feature/dots-muse-mods-foundation`。开始实施时基线：`1de6f0f8d052eb1186a06ce6d30d0aa2dfffe85b`。

依据：[分析与实施计划](./chainlesschain-dots-muse-mods-analysis-2026-10-06.md)。B0/B1 目标基础与公共持久调度模块已提交为 `f74ae00de0`。随后实现 B2 的首个风险巡检 adapter，并接入 B3 的目标卡片、主进程登录态和应用生命周期。各批原始证据分别保存；动作、记忆、通知、扩展及业务验收仍需继续交付。

**最新监控与界面回归：36 个互不重叠的测试文件，705 项通过，0 失败、0 跳过。** 第一批基础验证为 21 个文件、412 项，第二批共享调度器为 27 个文件、521 项；历史结果不与最新集合相加。测试覆盖原生 SQLite、真实 UKey 管理器/登录 handler、Windows ACL、Vue 交互与隔离包加载。跨库恢复以注入结算失败和真实数据库重开验证；尚未运行真实进程强制崩溃、Electron GUI 旅程、真实业务效果评测或候选提交的远端发行矩阵。

| 任务                       | 本轮状态                       | 已实现                                                                                                            | 仍需实施或验收                                                                               |
| -------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| DMM-00 宿主接入            | 公共模块与首个桌面宿主完成     | 共享调度器与授权额度；主进程派生私有独立调度库；当前原生驱动、连接轮换和退出 draining；隔离 npm pack 加载         | 实际桌面应用打包、完整 GUI 旅程及远端候选提交验证                                            |
| DMM-01 目标合同            | 合同与首个运行投影完成         | 版本/控制代次、个人引用与独立完成证据；跨运行风险检查 usage、控制状态和校验历史                                   | 完成检查器、其他执行域及模型/动作 usage                                                      |
| DMM-02 存储适配            | CLI 与原生项目 SQLite 基础完成 | 同一 CLI 文件、严格锁内 CAS、旧数据安全缺省值、超限旧历史兼容、原生事务内身份/归属复核、当前权限读取、IPC/preload | 用户显式导入 CLI 目标到项目的备份/映射/回退流程；进程级并发及故障恢复演练；真实 GUI 使用入口 |
| DMM-03 持续调度            | 首个只读风险 adapter 完成      | 显式开启、manual/timer occurrence 去重、期限/次数/时间预算、principal 额度、离线合并、暂停确认、跨库结算恢复      | 实际进程强制崩溃、多实例恢复演练、其他 adapter 和 canonical Graph 接入                       |
| DMM-04/05 动作、记忆与通知 | 待实施                         | 本轮字段仅为描述，未授予动作权限                                                                                  | 目标→review→admission→ActionRun 链路、可信完成检查器、记忆撤销和通知投递                     |
| DMM-06 工作区闭环          | 目标卡片与本地交互回归完成     | 现有风险面板中的目标保存/开启/暂停/重启、同请求重试、额度/历史与 review 联动；真实主进程会话撤销                  | 真正 Electron GUI 旅程、剩余动作闭环与最终产品验收                                           |
| DMM-07/08 扩展与场景包     | 待实施                         | 沿用既有插件能力，不开放新扩展执行                                                                                | 声明式事件/UI SDK、项目交付助手包、安装升级及禁用处理                                        |
| DMM-09/10 效果与发行       | 待业务与发行验收               | CLI CI 隔离包测试；Desktop CI 固定宿主/renderer 回归配置；本地 705 项验证证据                                     | 实际业务样本、准确候选提交三平台 CI、灰度和回退；需要发行时遵守 OIDC 与子包→CLI→IDE 顺序     |

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

[调度契约](../../../packages/session-core/lib/scheduler-contract.js)和[调度服务](../../../packages/session-core/lib/scheduler-service.js)复用原实现；CLI 原 `scheduler-kernel/contract.js` 与 `service.js` 现在是薄入口。CJS 宿主和 ESM CLI 的构造器、常量、错误实例保持一致。隔离包测试只安装公共入口及其依赖闭包，未加载 CLI 私有模块、整个 Session Core index 或原生数据库驱动。

后续切片已将 runtime、store、source-path 和文件保护实现移至 Session Core 公共 CJS 子路径，CLI 保留原 Graph、home 和原生数据库装配的兼容入口。中立 runtime 必须注入 Graph Authority，或明确选择 legacy Graph 模式；两种方式均要求实时授权回调。中立 store 必须由宿主显式提供 file、Database 和同步确认的 protectStorage；磁盘文件在打开前后均验证保护，失败时拒绝打开或关闭连接。

共享文件保护保留原有 Windows ACL 缓存、工作目录、超时、链接检查和隐藏辅助进程语义。调度账本仍校验独立的 application ID、schema version 和 catalog，不能直接放入已有项目库。首个桌面风险巡检宿主现已接入：按可信应用数据路径与数据库实路径派生独立账本，以同一原生驱动打开，退出时中止并等待后台及手动操作结算后再关闭。连接替换会锁住并排空旧宿主，再建立新宿主。

## 目标与存储行为

[目标契约](../../../packages/session-core/lib/goal-contract.js)保留 `active/paused/done/abandoned`，执行状态单独保存。记录包含权威存储标识、revision、控制代次和个人项目引用。通用修订不允许改写身份、项目绑定、存储 ID、版本、控制代次、执行状态或完成证明。

修订通过 CAS 增加 revision 和控制代次。进度为 100 不能将项目目标标为完成；完成需宿主提供可信同步检查器，其证据绑定目标定义、当前版本与全部验收条件。当前桌面接口未安装检查器，也不暴露完成/执行接口。授权引用与允许动作类型只是描述，不能替代真实业务授权。

[CLI 适配器](../../../packages/cli/src/lib/goal-store.js)与既有 `cc goal` 读写同一文件。读旧文件仅产生兼容视图，不自动改写、绑定 DID、监控或项目权限；修改和可选删除 CAS 都在现有严格文件锁内检查。旧命令的明确关闭仍是人工声明，不产生核验完成证明。已核验的独立目标需先重新打开再修改；重新打开清除当前完成证明并推进控制代次。

旧版允许较长历史。无法无损放入新记录边界的 versionless 文件继续使用旧适配路径，保留全部 notes 并维护 revision/controlGeneration；暂停、进度和附注仍可使用。新格式记录不能降级进入此路径。错误、未知 schema 和 CAS 冲突不写入原文件。

[个人项目存储](../../../packages/session-core/lib/project-goal-service.js)在现有原生数据库创建 `cc_project_goal_store_meta` 和 `cc_project_goals`。每次读取/写入均从宿主解析当前 DID 并检查当前项目归属；拒绝直接组织/工作区字段以及 `organization_projects`、`workspace_resources` 关联。写入在 native immediate 事务内比较 revision 并重验身份；错误或身份变化回滚。真实 SQLite 关闭重开验证记录和存储标识持久化。

记录整体、JSON 结构、文本和分页都有上限；整体序列化上限为 64 KiB。数据损坏、元数据不一致和超限记录明确拒绝，避免出现“写入成功但读取失败”的大小边界差异。本轮没有宣称本地 SQLite 测试证明生产加密配置或真实进程崩溃恢复。

## 桌面开发接口

[项目目标 IPC](../../../desktop-app-vue/src/main/task/project-goal-ipc.js)已接入任务 IPC 初始化，使用可信来源、有效窗口和主进程当前身份。四个元数据通道和四个独立监控通道均已加入 preload 与固定 renderer 能力清单。

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

创建目标仍保存 `executionState: idle` 的意图，不自动开启工作。实时执行状态从监控状态接口读取，区分 `waiting/running/blocked/pause-requested/paused/idle`；目标记录本身不伪造执行状态或完成证明。

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

## 验证与证据

| 验证                  | 最新结果   | 范围                                                                         |
| --------------------- | ---------- | ---------------------------------------------------------------------------- |
| CLI 21 个文件         | 408 项通过 | 目标/受控动作及共享调度器回归、44 项原生巡检、7 项授权解析、真实 Windows ACL |
| Session Core 2 个文件 | 91 项通过  | 目标与业务对象合同、独立完成证明、有界 JSON                                  |
| Desktop 7 个文件      | 144 项通过 | 19 项宿主/真实 ACL、21 项生产认证链路、38 项旧 UKey IPC 与既有安全边界       |
| Renderer 5 个文件     | 60 项通过  | 11 项目标交互、6 项退出登录、风险/任务面板和已有组件旅程                     |
| Node 打包 1 个文件    | 2 项通过   | 真实 npm pack、CJS/ESM 新公共模块及 CLI shim 身份、隔离宿主加载              |
| 固定 IPC 能力与差异   | 通过       | 固定 renderer 能力清单及 git diff --check                                    |

最新证据：[CLI](./evidence/dmm-monitoring-2026-10-07/cli-tests.json)、[Session Core](./evidence/dmm-monitoring-2026-10-07/session-core-tests.json)、[Desktop](./evidence/dmm-monitoring-2026-10-07/desktop-tests.json)、[Renderer](./evidence/dmm-monitoring-2026-10-07/renderer-tests.json)、[打包 TAP](./evidence/dmm-monitoring-2026-10-07/packed-host.tap)、[来源与汇总](./evidence/dmm-monitoring-2026-10-07/summary.json)。保留 [foundation](./evidence/dmm-foundation-2026-10-07/) 和 [neutral scheduler](./evidence/dmm-neutral-scheduler-2026-10-07/) 历史证据。

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

下一批仍需交付：目标关联 review→admission→ActionRun 的待确认业务动作、独立完成检查器、记忆/通知、声明式扩展及场景包；同时完成实际 Electron GUI、真正进程崩溃/多实例恢复、CLI 显式导入与真实业务样本验收。发行时仍必须通过准确提交的三平台 CI，并遵循 OIDC 和子包→CLI→IDE 顺序。
