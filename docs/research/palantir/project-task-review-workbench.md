# 项目任务工作区：受控编辑与来源核验

更新日期：2026-10-06。对应第四批 PAL ONT / POLICY / LINEAGE / EVAL 改进。

## 入口与数据模型

项目详情页 `/projects/:id` 提供已保存任务入口，读取当前项目的 `project_tasks`，并支持本人确认的规范任务创建。团队看板的 `team_tasks`、AI 临时执行计划和任务流进度仍使用各自模型；本入口不把它们转换为已保存任务，也不创建示例任务。没有规范任务行时显示空状态。

读取和修改都要求桌面主进程的当前 DID 与 `projects.user_id` 匹配。旧项目中 `default-user`、设备 ID 等值不会自动视为当前 DID，不自动迁移所有权。组织或工作区资源继续等待组织权限适配；判断包含项目/任务上的关联字段、`organization_projects` 和 `workspace_resources` 资源关系。

## 授权读取与编辑

| API                                                                              | 返回与边界                                                                                 |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `electronAPI.task.listControlledTasks({projectId,afterId?,limit?})`              | 默认 50、最多 100 条；按 ID 翻页，返回描述摘要、真实状态与下一页游标；排除已删除任务       |
| `electronAPI.task.readControlledTask({taskId})`                                  | 返回描述、状态和 `editable/reason`；描述展示最多 8192 UTF-8 字节，大结果不妨碍读取有界详情 |
| `electronAPI.task.previewDescriptionUpdate({taskId,description,idempotencyKey})` | 权威重读并绑定完整行版本；生成修改前后预览                                                 |
| `electronAPI.task.executeDescriptionUpdate({request})`                           | 主进程原生确认；确认后复核版本/归属；修改和执行证据原子提交                                |
| `electronAPI.task.listDescriptionActionRuns({taskId,beforeId?,limit?})`          | 默认 20、最多 50 条，按数据库插入顺序倒序翻页；当前身份仍须拥有该任务                      |
| `electronAPI.task.getDescriptionActionRun({runId})`                              | 校验当前归属以及存储回执、确认和执行证据的一致性                                           |

任务列表是实时分页，不是不可变的完整项目快照。风险检查会另行在一个数据库事务中读取全部所需字段。

界面中的待核实状态不是成功，也不证明后台仍在运行。任何同一任务的 `running/queued/unknown` 回执会阻止新的修改意图；更换幂等键、刷新或重新打开页面均不能绕过。重复提交原请求仍可获得旧回执。当前没有强制重放、自动处理未决结果或自动取消未知操作的接口。

完整任务行超出既有动作契约大小限制时，仍可读取有界详情和历史，但不能修改。非待处理任务、非活动/草稿项目和范围不支持等原因也会显示为不可编辑。第五批收口个人规范任务的旧读取、创建和描述入口，拒绝尚未实现的旧任意字段变更；附属评论/清单和团队看板仍未统一。创建接口及兼容边界见[受控任务创建](./controlled-project-task-creation.md)。

## 在线风险检查与历史来源

```js
const result = await window.electronAPI.project.evaluateRisk({
  projectId: "project-1",
});
// { review: { id, projectId, actorDid, createdAt }, sourceSnapshot, evaluation }

const historical = await window.electronAPI.project.getRiskReview({
  reviewId: result.review.id,
});
```

在线检查使用实际 `desktop.project-tasks/v1` 状态：`pending/running/completed/failed`。源快照只包含项目和任务的风险相关字段，评估时间由主进程服务取得。迁移所定义的 `blocked_by IS NULL` 表示未设置依赖，可规范化为空数组；损坏的 JSON 不会按无依赖处理。

检查以一个原生 SQLite immediate 事务读取当前归属与源行、执行确定性规则并持久保存检查记录。缺少风险列、任务超过 1000 条等情况明确记录读取不完整；数据库读取错误不会伪装成空项目，也不会保存成功评估。组织/工作区任务不会被悄悄过滤后宣称读取完整。

记录保存当时的选定字段快照、评估结果及摘要，整个返回记录最多 2 MiB。无效源任务标识符会拒绝保存，避免产生无法授权重读的历史。`getRiskReview` 重新检查当前项目归属和组织/工作区范围，并逐个确认历史来源任务仍位于当前项目且未删除；移出、删除或撤权后拒绝重读。内容摘要与规则重算也须一致。它返回历史 `asOf`，不会用新数据覆盖原结果；历史记录不能代表项目当前状态。

规则仅检查未完成任务的逾期和直接未完成依赖。零命中只表示没有发现这些规则对应的信号；描述修改不会改变截止时间、依赖或任务状态，也不代表风险已经解决。

## 验证与剩余工作

后端回归使用真实 SQLite，覆盖分页、撤权、组织资源关联、较大内容、未决回执、新键绕过拒绝、读取完整性和历史记录一致性。桌面适配器测试验证来源/窗口/主进程身份边界；组件测试验证用户交互与异步状态。完整执行参数和结果见本批实施进度及证据。

第五批将风险记录与描述操作 admission、原生确认及 ActionRun 绑定，新增授权历史和独立人工核对；接口、新鲜度及分页规则见[风险动作血缘](./project-risk-action-lineage.md)。组织权限、多级审批、剩余附属及看板入口、真实业务样本与模型/费用验收、风险历史保留策略和跨服务可信证明仍待完成。原生确认与页面的实际 Electron GUI 旅程也需要单独验证，不能由组件替身测试替代。
