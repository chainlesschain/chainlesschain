# Dots / Muse / Mods 借鉴：实施进度

更新日期：2026-10-07。工作分支：`feature/dots-muse-mods-foundation`。开始实施时基线：`1de6f0f8d052eb1186a06ce6d30d0aa2dfffe85b`。

依据：[分析与实施计划](./chainlesschain-dots-muse-mods-analysis-2026-10-06.md)。本轮实现 B0/B1 的基础切片：公共调度契约/服务入口、版本化目标、存储适配以及个人项目目标元数据 IPC。代码仍为本地候选，文件摘要见[证据目录](./evidence/dmm-foundation-2026-10-07/)。

**最新共享调度器回归：27 个互不重叠的测试文件，521 项通过，0 失败、0 跳过。** 第一批基础验证为 21 个文件、412 项通过，其原始证据保留为历史记录，未与最新结果相加。测试证明合同、原生 SQLite、IPC 和隔离包加载的当前范围；未运行真实 Electron GUI 旅程、真实业务效果评测或当前候选提交的远端发行矩阵。

| 任务                       | 本轮状态                               | 已实现                                                                                                                                                 | 仍需实施或验收                                                                               |
| -------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| DMM-00 宿主接入            | 公共持久调度模块完成，本地打包验证通过 | contract/service/runtime/store/source-path 与文件保护已共享；CLI 保留原宿主装配；实时授权、显式 Graph 模式及打开前后文件保护；真实 npm pack 后隔离加载 | 完整桌面宿主生命周期、独立调度库装配及应用打包验证                                           |
| DMM-01 目标合同            | 核心合同与本地回归完成                 | schema/revision/controlGeneration、个人项目引用、预算/通知/记忆描述、独立完成证据校验、不可变且有界记录                                                | 跨运行 usage 账本、真正的控制确认、目标执行投影与历史；产品完成检查器接入                    |
| DMM-02 存储适配            | CLI 与原生项目 SQLite 基础完成         | 同一 CLI 文件、严格锁内 CAS、旧数据安全缺省值、超限旧历史兼容、原生事务内身份/归属复核、当前权限读取、IPC/preload                                      | 用户显式导入 CLI 目标到项目的备份/映射/回退流程；进程级并发及故障恢复演练；真实 GUI 使用入口 |
| DMM-03 持续调度            | 待实施                                 | 尚未为目标创建 job 或 occurrence                                                                                                                       | 目标检查 adapter、期限/预算执行、触发去重、停止确认和恢复关联                                |
| DMM-04/05 动作、记忆与通知 | 待实施                                 | 本轮字段仅为描述，未授予动作权限                                                                                                                       | 目标→review→admission→ActionRun 链路、可信完成检查器、记忆撤销和通知投递                     |
| DMM-06 工作区闭环          | 待实施                                 | 已提供受控目标元数据 IPC/preload 方法                                                                                                                  | 现有项目面板中的目标卡片、用户控制和真实 Electron 旅程                                       |
| DMM-07/08 扩展与场景包     | 待实施                                 | 沿用既有插件能力，不开放新扩展执行                                                                                                                     | 声明式事件/UI SDK、项目交付助手包、安装升级及禁用处理                                        |
| DMM-09/10 效果与发行       | 待验收                                 | 新增打包宿主测试已加入 CLI CI                                                                                                                          | 实际业务样本、准确候选提交三平台 CI、灰度和回退；需要发行时遵守 OIDC 与子包→CLI→IDE 顺序     |

## 公共契约和加载边界

新增公共子路径：

- `@chainlesschain/session-core/scheduler-contract`
- `@chainlesschain/session-core/scheduler-service`
- `@chainlesschain/session-core/scheduler-runtime`
- `@chainlesschain/session-core/scheduler-store`
- `@chainlesschain/session-core/scheduler-source-path`
- `@chainlesschain/session-core/private-storage`
- `@chainlesschain/session-core/host-storage-environment`
- `@chainlesschain/session-core/goal-contract`
- `@chainlesschain/session-core/goal-repository`
- `@chainlesschain/session-core/project-goal-service`

[调度契约](../../../packages/session-core/lib/scheduler-contract.js)和[调度服务](../../../packages/session-core/lib/scheduler-service.js)复用原实现；CLI 原 `scheduler-kernel/contract.js` 与 `service.js` 现在是薄入口。CJS 宿主和 ESM CLI 的构造器、常量、错误实例保持一致。隔离包测试只安装公共入口及其依赖闭包，未加载 CLI 私有模块、整个 Session Core index 或原生数据库驱动。

后续切片已将 runtime、store、source-path 和文件保护实现移至 Session Core 公共 CJS 子路径，CLI 保留原 Graph、home 和原生数据库装配的兼容入口。中立 runtime 必须注入 Graph Authority，或明确选择 legacy Graph 模式；两种方式均要求实时授权回调。中立 store 必须由宿主显式提供 file、Database 和同步确认的 protectStorage；磁盘文件在打开前后均验证保护，失败时拒绝打开或关闭连接。

共享文件保护保留原有 Windows ACL 缓存、工作目录、超时、链接检查和隐藏辅助进程语义。调度账本仍校验独立的 application ID、schema version 和 catalog，不能直接放入已有项目库。完整桌面运行生命周期与个人目标巡检接入正在下一批实施；公共入口可用不等于业务巡检已接通。

## 目标与存储行为

[目标契约](../../../packages/session-core/lib/goal-contract.js)保留 `active/paused/done/abandoned`，执行状态单独保存。记录包含权威存储标识、revision、控制代次和个人项目引用。通用修订不允许改写身份、项目绑定、存储 ID、版本、控制代次、执行状态或完成证明。

修订通过 CAS 增加 revision 和控制代次。进度为 100 不能将项目目标标为完成；完成需宿主提供可信同步检查器，其证据绑定目标定义、当前版本与全部验收条件。当前桌面接口未安装检查器，也不暴露完成/执行接口。授权引用与允许动作类型只是描述，不能替代真实业务授权。

[CLI 适配器](../../../packages/cli/src/lib/goal-store.js)与既有 `cc goal` 读写同一文件。读旧文件仅产生兼容视图，不自动改写、绑定 DID、监控或项目权限；修改和可选删除 CAS 都在现有严格文件锁内检查。旧命令的明确关闭仍是人工声明，不产生核验完成证明。已核验的独立目标需先重新打开再修改；重新打开清除当前完成证明并推进控制代次。

旧版允许较长历史。无法无损放入新记录边界的 versionless 文件继续使用旧适配路径，保留全部 notes 并维护 revision/controlGeneration；暂停、进度和附注仍可使用。新格式记录不能降级进入此路径。错误、未知 schema 和 CAS 冲突不写入原文件。

[个人项目存储](../../../packages/session-core/lib/project-goal-service.js)在现有原生数据库创建 `cc_project_goal_store_meta` 和 `cc_project_goals`。每次读取/写入均从宿主解析当前 DID 并检查当前项目归属；拒绝直接组织/工作区字段以及 `organization_projects`、`workspace_resources` 关联。写入在 native immediate 事务内比较 revision 并重验身份；错误或身份变化回滚。真实 SQLite 关闭重开验证记录和存储标识持久化。

记录整体、JSON 结构、文本和分页都有上限；整体序列化上限为 64 KiB。数据损坏、元数据不一致和超限记录明确拒绝，避免出现“写入成功但读取失败”的大小边界差异。本轮没有宣称本地 SQLite 测试证明生产加密配置或真实进程崩溃恢复。

## 桌面开发接口

[项目目标 IPC](../../../desktop-app-vue/src/main/task/project-goal-ipc.js)已接入任务 IPC 初始化，使用可信来源、有效窗口和主进程当前身份。四个固定通道同时加入 preload 方法和生成的 renderer 能力清单。

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

这些接口目前保存和读取目标意图；新目标是 `executionState: idle`、无 trigger。预算是已校验的配置，未开始跨运行扣账。暂停修改目标意图，不代表本轮已经实现后台执行的停止确认。目标卡片和自动检查在 DMM-03/06 接入后另行验收。

## 验证与证据

| 验证                  | 最终结果   | 证明范围                                                                             |
| --------------------- | ---------- | ------------------------------------------------------------------------------------ |
| CLI 20 个针对性文件   | 362 项通过 | 原基础集合及配置安全、Windows 文件保护、source-path、Graph/宿主注入和运行控制回归    |
| Session Core 2 个文件 | 91 项通过  | 目标合同、完成证据绑定、有界 JSON 与既有业务对象合同                                 |
| 桌面 4 个文件         | 66 项通过  | 实际 SQLite 与注入 Electron 边界、IPC 注册/来源/身份及 preload 能力策略              |
| Node 打包宿主文件     | 2 项通过   | 真实 npm pack、隔离 CJS/ESM 加载、公共入口、CLI shim 身份、driver 失败隔离和关闭等待 |
| renderer 固定能力清单 | 通过       | 生成清单与 preload 保持一致                                                          |
| 格式与差异检查        | 通过       | 修改文件的 Prettier 检查与 `git diff --check`                                        |

最新证据：[CLI](./evidence/dmm-neutral-scheduler-2026-10-07/cli-tests.json)、[Session Core](./evidence/dmm-neutral-scheduler-2026-10-07/session-core-tests.json)、[桌面](./evidence/dmm-neutral-scheduler-2026-10-07/desktop-tests.json)、[打包 TAP](./evidence/dmm-neutral-scheduler-2026-10-07/packed-host.tap)、[来源与汇总](./evidence/dmm-neutral-scheduler-2026-10-07/summary.json)。历史基础证据仍保留在 [foundation 目录](./evidence/dmm-foundation-2026-10-07/)。

本机复用已准备的工作区依赖；命令从各包目录运行 `node ../../node_modules/vitest/vitest.mjs` 或桌面的 `node ../node_modules/vitest/vitest.mjs`。使用标准依赖安装的环境可按原实施计划运行 `npm test`。打包检查从仓库根运行：

```powershell
node --test packages/session-core/__tests__/scheduler-host-boundary.node.cjs
node desktop-app-vue/scripts/verify-fixed-renderer-ipc.mjs
```

Astra 完成调度公共入口切片与独立审查，发现并复现核验目标重开、删除 CAS、旧历史兼容三项问题；修复后由新增回归和限定复核关闭。最终结果按当前代码集合记录，没有将本地结果写成三平台正式发行门已通过。

本次将已完成的目标基础与公共持久调度模块提交到 Git。目标监控 adapter 和风险评估事务组合仍是未验证草稿，不包含在本次提交中。下一批完成监控的预算、恢复、停止确认与桌面宿主装配，再接目标执行投影、待确认动作和项目卡片。用户显式导入流程与真实进程故障演练作为存储适配的剩余工作单独交付。
