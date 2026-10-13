# Workflow 压缩状态与 CI 历史 fixture 修复

候选 `688268fc406280d578bebf566df364eec10a208b` **不可发布**。发布前实际复现两个缺陷：workflow 子代理在压缩规划拒绝和提交失败后，费用已结算，却返回 `completed / (No output from sub-agent)`，并遗漏合法 provider 回执；其 CLI CI 的 Ubuntu unit `2/4` 另有九项历史 fixture 失败。原始复现和 CI 日志均保留，没有借用旧结果通过发行。

修复后的本地 workflow/消费者回归 **208/208（8 suites，新增严格 SubAgentContext 11 项）**，历史相关回归 **65/65（4 文件，history 40 项）**，根代理独立 Windows/Linux kernel 与 conformance 各 **29/29，零跳过**。最终源码另记录十份文件摘要；所有回归均为本地验证，新的准确 SHA 仍须重新完成七门 Actions。

本归档保存 **134 份原件映射、92 个 gzip 对象**，见 [manifest.json](./manifest.json) 与 [summary.json](./summary.json)。两个约 93/94 MB 的原始 git-archive seed 仅保留在任务本机；排除项的完整原始长度、摘要及原因明确列出，仓库保存不可变基础提交、完整逐文件比对和修复源码，不重复存储大 tar。

## 真实任务状态及回执修复

捕获的合法 provider 回执现在在 token usage 之前按同一 callId、workflowEffectId 和 callSequence 传给宿主，私有标记防止重复。真实 precommit 规划拒绝明确为 `CC_WORKFLOW_COMPACTION_PLAN_REJECTED / contextOutcome=aborted / usageOutcome=known`；未知提交继续要求 reconciliation，费用保持已知。普通子代理的中断也发出非 complete 的 `run-ended`，结果明确为 incomplete。

回归使用实际 `SubAgentContext`、严格 usage telemetry、agentLoop 与 canonical kernel，覆盖正常成功、规划拒绝、提交失败、缺失用量、错配回执和三个 observer 失败阶段；模拟 provider 不产生实际费用。现有 dynamic workflow runtime suite 也通过，但不冒称新的 dynamic executor 端到端执行。初始两项复现的“诊断断言通过”证明缺陷存在，不计产品通过。

验证从准确 `688268f` 源码 archive 加仅两个修复 overlay 建立隔离运行，**5938 个文件 SHA-256 比对无差异**。中间 `207 pass / 2 fail` 的新增普通模式期望错误已保留；按真实 consumer 契约纠正测试，未放宽产品停止行为。最终权威运行 `run-CSM7N2` 为 208/208。

## 原 CI 九项失败与最小 fixture 修复

旧 helper 设置 modelWindow=150、output=20、safety=10、recovery=10，可选预算 110，conversation ceiling **33**；每条实际 bundle 至少 **58 tokens**，所以全部被丢弃。新的空上下文保护正确拒绝，错误并非随机 worker 退出或 provider 费用问题。

只修改正向测试 helper 的默认窗口为 **450**：实测 ceiling **117**，保留 **2/16** 条消息，仍是部分压缩；并加入 helper 非空断言、压缩后原显示历史不变断言。显式窗口 150 的负控验证 context、head、events、history 全不变。生产 planner、partition 分配和拒绝门未改。原九个失败 case、实际 checkout SHA、源码行和预算实算原件均在归档中。

## API-set 静态解析进展

新的只读 resolver 依据固定 ntdll 的机器码、真实 call 链、RVA 和区间摘要实现 v6 namespace 的 hash、HashedLength 与 parent alias 选择；没有调用私有 ntdll ABI。891 项表/index/hash 校验和七项负控/交叉测试通过。

原 5681 条 exact-name 未解析边中，5621 条获得有规则依据的静态 host 映射，60 条仍未解析。全部 9535 API-set 边中 9473 条静态映射、62 条未解析；593 条映射明确依赖所提供的 parent，27 条指向旧 pin 集之外的十二个 host，只记录名字，未读取或授予信任。**dynamicClosure 与 fullClosure 仍为 false**，不计完整 native admission。

## 发行及原目标边界

版本仍为 kernel **0.1.10**、CLI **0.166.101**、VS Code **0.37.145**、JetBrains **0.4.163**，尚未发布。用户授权测试成功后按 GitHub Actions OIDC 子包→CLI→公开安装回读→IDE 执行。修复后的新 SHA 必须重新完成七门全部 job；`688268f` 和其他旧提交均不能作为此次发布的矩阵凭据。

正式冻结 `.99 / .37.143 / .4.161` 的 36+9 仍 **NOT_RUN / 0/36 / 0/9 / 原共享 $99 / NOT_PAID_READY**；外部账户、真实目标宿主及人工验收按用户要求跳过，不计通过。完整 native authority/WAL/防回滚和实际 24h 最终验收仍未完成。没有新实际 provider 调用。Astra 与根代理均为 AI 审查。

```sh
node docs/research/cli/evidence/gap-2026-10-05/continuation-2026-10-14/workflow-compaction-and-ci-repair/verify-archive.mjs
```
