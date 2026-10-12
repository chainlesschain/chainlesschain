# 当前工程提交的 CI 回读与旧提交结算

旧 `a537486bac13763a90aedffa1a59ef538121afcf` 的 Strict [38201818827](https://github.com/chainlesschain/chainlesschain/actions/runs/38201818827) 为 5/5 成功，Quality [38201818774](https://github.com/chainlesschain/chainlesschain/actions/runs/38201818774) 为 7 成功/2 条件跳过。新增定价提交后，旧 CLI/CI Tests/Kernel/IDE 的未完成 run 被替换/取消，不能当作完整通过；取消后的 always 结算步骤报错不自行归为原测试失败。Host 旧 run 继续运行，单独保留来源。

当前工程源码为 `bdaf873c68a706ee65b985892d2603cbe0510979`。回读时点 2026-10-12T04:28:23.687Z 的 8 个关键工作流及逐 job API 见 [summary.json](./summary.json) 和 [manifest.json](./manifest.json)。排队或进行中均保留为未完成；当前全矩阵完成标志为 `false`，不作为发行、合并或正式目标宿主准入。后续文档提交或运行状态变化不会把这一快照转成新 SHA 的成绩。

Model Catalog PR run38203332415 为 completed/success，仅验证本地目录与证据合同；上游抓取及漂移步骤条件跳过，不关闭原漂移告警。完整终态 job API、run log 与 artifact metadata 已归档；job-log API 的一次 HTTP 403 失败也保留，随后整 run 的完整日志读取成功。

根代理此前仅取消本 PR 已被替代且未完成的三条旧 Host run（848e6e4/861e9bc/08e883），取消前 API 和请求回执同时归档；没有删除已完成/失败的历史记录，也没有取消当时的最新 run。正式 36+9 / NOT_RUN / observed=0 保持，没有新付费请求。
