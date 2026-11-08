# Windows 风险建议创建任务旅程（2026-11-07）

本批补齐原计划 DMM-04/06 明确要求单独验收的“风险→创建任务”。实际原生描述修改或独立建任务成功，不能替代这个关联。准确源码 `8cd5ac2040d511575b75fb3d1450a758e28cbfa9` 的风险创建、基础目标、记忆/通知与三平台宿主四组远端工作流全部成功，三个 GUI 报告源码干净；本机干净候选也完整通过。草稿 [#545](https://github.com/chainlesschain/chainlesschain/pull/545) 依赖 #544。没有业务规则、包版本或公开发行变化。

## 实际本机结果

[干净候选完整旅程](./local-candidate/journey.json)退出 0，`sourceSha` 为准确候选且 `sourceStatus` 为空。真实 DID/密码表单、加密项目库、canonical Graph、生产 Vue、原生按钮和公开授权 IPC 均未替换。

1. 在当前真实风险建议中，实际 Vue 预览明确展示现有内置 `query_info` 类型；打开原生确认后取消，任务 ID 集合保持原样，没有新增任务。
2. 两次实际点击暂停/恢复，暂停状态持久化且监控关闭，恢复保持目标 v2 并增加 revision/controlGeneration。之前准备的预览通过真实授权 IPC 执行时返回 `ACTION_GOAL_REVISION_CONFLICT`，没有新增任务。
3. 当前新预览经实际原生“确认创建”后仅增加一条 pending 任务。公开 API 回读正文，`sqlite-task-create.createdTaskRef` 指向同一任务；goal/不可变 review/intent/ActionRun 相互绑定。
4. 四类血缘为 `project-risk-review`、`project-goal-intent`、`local-user-confirmation`、`sqlite-task-create`；四份证据与 ActionRun 引用的摘要一致。
5. 通过真实授权 IPC 重放原成功 intent，返回原 ActionRun、`replayed:true`，任务 ID 集合不变，没有再次审批或创建。
6. 再次检查仍识别原逾期任务，风险数为 1，目标仍 active、completion=null。随后完整记忆/通知组合、独立拒绝完成和真实 70 秒停止观察均通过；结束前后检查次数均为 11。

5 份实际原生窗口回执单列：原有独立创建的取消/确认、描述修改确认，以及本批风险创建的取消/确认；不当作 5 项新增 unit/integration。暂停前已准备预览的拒绝和成功重放使用公开 IPC，明确不写成 GUI 点击或“原生确认框已打开期间并发暂停”的验收。

[源码/产物回读](./local-candidate/source-readback.json)验证运行器、risk-create helper、workspace helper 与提交一致，启动时产物摘要在捕获时一致。[首次探索运行](./local-exploratory/journey.json)也通过，但记录的是 `e710194705` 基线及未提交脚本；其源码摘要与候选匹配，仍不能改写为干净候选证据。两轮不相加，也不当作独立业务样本。

## 准确提交远端工作流

| 工作流                                                                                              | 范围                                                 | 状态    |
| --------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------- |
| [风险创建 42303362396](https://github.com/chainlesschain/chainlesschain/actions/runs/42303362396)   | 完整风险创建、记忆/通知、独立验收及真实停止观察      | success |
| [基础目标 42303362268](https://github.com/chainlesschain/chainlesschain/actions/runs/42303362268)   | 保留既有真实风险→描述修改旅程                        | success |
| [记忆/通知 42303362264](https://github.com/chainlesschain/chainlesschain/actions/runs/42303362264)  | 保留未开启新场景时的组合旅程                         | success |
| [三平台宿主 42303362279](https://github.com/chainlesschain/chainlesschain/actions/runs/42303362279) | Linux/Windows/macOS 原生边界、renderer、完整组织配置 | success |

工作流使用一次根全工作区锁定安装、准确 SHA、源码/锁文件漂移拒绝、真实加密 Graph 预检和完整生产构建；[候选工作流快照](./candidate-workflows/dmm-native-goal-creation.yml)保留原命令。观察超时不重启，旧提交或部分矩阵不作为新候选通过。

[远端创建原始报告](./ci/creation/dmm-native-goal-creation/journey.json)包含 5 份实际原生回执，结束前后检查次数均为 9；[基础目标](./ci/baseline/dmm-native-goal-journey/journey.json)与[记忆/通知](./ci/workspace/dmm-native-goal-workspace/journey.json)也保留各自真实 70 秒停止观察。[三平台原始报告](./ci/host/)去重后每平台均为 **52 文件/958 项通过，0 失败/跳过**：桌面 21/405、renderer 19/293、组织排除重叠后 12/260。新增长旅程没有增加 unit/integration 计数；与前批、本机重跑及其他平台不相加。[终态与 GitHub 制品身份](./ci/runs/)单独保存。

## 校验

```powershell
node docs/research/agents/evidence/dmm-native-risk-create-2026-11-07/verify-evidence.mjs
```

校验器核对 `manifest.json` 的 43 份原始文件摘要，通过 `git show <准确提交>:<路径>` 检查源码，验证两个干净创建报告及探索报告的真实场景、四类回执摘要、两次暂停/恢复、旧预览拒绝、同 run 重放、原风险未消除、实际停止时间，并逐平台去重。它保留探索/准确候选的区别，不把旧报告改绑新脚本，也不提供发行许可。

## 范围与剩余任务

全部为隔离合成数据。本批没有验证真实独立业务收益、安装包、跨平台/模型/IDE/扩展 GUI、确认框打开期间的并发撤权、实际跨夜投递、整体数据库升级/回退或新源码发行门。DMM-10 的全局默认关闭与禁用演练仍待完成；Graph 模式默认 legacy 不能等同整个持续目标功能默认关闭。24 entries/72 份生产签名回执及第二阶段启动条件也未省略。

原始日志、密码、密钥和数据库不归档。记忆/通知断言沿用上一批边界：删除证明授权阻断与在线逻辑清理，不证明 WAL/备份物理擦除；免打扰仅验证配置持久化，不证明跨夜投递。整体实施目标保持进行中。
