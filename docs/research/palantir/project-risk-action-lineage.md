# 项目风险历史、人工核对与动作血缘

更新：2026-10-06。范围：个人规范项目任务、本地 SQLite 与桌面授权入口。

## 授权接口

桌面项目任务抽屉现在提供检查历史、关联操作和人工核对。接口使用主进程当前 DID；客户端不能选择操作者或降低审批规则。

```js
const history = await window.electronAPI.project.listRiskReviews({
  projectId: "project-1",
  limit: 10,
});
const evidence = await window.electronAPI.project.getRiskLineage({
  reviewId: history.reviews[0].review.id,
  limit: 10,
});
await window.electronAPI.project.recordRiskFeedback({
  reviewId: evidence.review.id,
  taskId: "task-1",
  verdict: "dismissed",
  reasonCodes: [],
  comment: "人工核对后排除此项规则信号",
});
```

`listRiskReviews` 按数据库插入顺序返回元数据、规则状态、摘要和内容摘要；用 `beforeId` 翻页。默认每页 10 条，上限 20。历史游标必须属于当前项目和身份。读取逐项校验存储摘要、重算规则并复核历史来源任务的当前归属、删除和组织/工作区关联，不能通过历史入口读取已经撤权的数据。

`getRiskLineage` 返回历史规则结果、关联 ActionRun 和人工核对。动作使用 `beforeId`，人工核对使用独立的 `feedbackBeforeId`；分别返回 `nextCursor` 和 `nextFeedbackCursor`。每个回执和其证据最多 64 KiB，整个返回最多 2 MiB；过大或损坏证据明确失败。

## 来源到执行的绑定

描述预览可提供 `reviewId`。主进程从数据库验证记录、操作者和目标任务，生成 `{id, contentDigest}` 放入 action input，参与 `inputDigest`、`actionDigest` 和 `invocationDigest`。不能用离线快照或风险选定字段版本替代完整任务行的 `expectedVersion`。

预览、持久 admission 和确认后的写事务均复核当前风险相关字段。项目状态、任务集合、截止时间、依赖、版本等变化会返回 `PROJECT_RISK_REVIEW_STALE`，确认后也不会执行旧来源提议。修改描述导致的版本变化不会重写先前的历史评估。

admission 与风险→ActionRun 关联同事务保存。原生确认独立记录批准或取消；最终任务变化及执行证据同事务提交。成功、取消、拒绝、running/unknown 都保留同一来源关联。确认期间身份或归属撤销仍持久保存拒绝，后续读取重新授权。未知结果不自动重试；原请求仅可读取已有回执，新幂等键不能绕过未决目标。

血缘查询逐一校验回执身份、目标类型、调用摘要、证据摘要及风险引用；成功状态还验证严格人工确认和 SQLite 影响行数/前后版本。项目与任务同 ID 的历史、游标及未决锁按对象类型隔离。

## 人工核对与评估边界

人工核对以追加记录保存，包含主进程身份、时间、任务、判断及可选说明。判断为 `affirmed`、`dismissed` 或 `needs-review`；允许修正的原因码为逾期与直接依赖阻塞，排除时原因码必须为空。说明最多 4096 UTF-8 字节。记录读取仍验证身份、任务归属、格式和内容摘要。

人工意见不会覆盖独立规则输出，也不自动修改任务、完成任务或宣称风险已解决。界面在身份、项目或检查变化后丢弃迟到响应；保存反馈出现传输未知时，读取历史核实后才能继续。选择新的检查会使尚未执行的旧描述预览失效。

`proof: local-content-binding` 表明库内内容关联；不是独立签名或跨服务可信证明。当前流程没有调用模型，模型 usage 不提供，费用状态明确 `unknown`，不能据此报告模型质量或成本改善。验证使用真实 SQLite 与隔离样本、注入的 Electron 确认边界；真实业务样本、独立人工标注及交付结果、真实 GUI 和本次准确提交的跨系统门禁仍需单独验收。

组织动作前提见[受控任务创建](./controlled-project-task-creation.md#组织适配的具体前提)，验证汇总见[实施进度](./palantir-gap-implementation-progress-2026-10-06.md)。
