# CLI 0.166.98 独立复测准备：第三次归档

发行候选为 `821c63eff2698c8625a7be596f935d658ce095cf`；独立准备提交为 `9aa64f1f84f6c72ea07f75c7fed4794b7ee9b7fb`。该分支已合并准确候选，DIAGNOSTIC.publicReleaseCommit 指向同一发行 SHA，CLI 0.166.98 / Kernel 0.1.9 及依赖保持一致。[准备运行 38135294850](https://github.com/chainlesschain/chainlesschain/actions/runs/38135294850) 的 attempt 1 为 completed/skipped，唯一 job 114457841834 执行步骤为 0。本次没有付费 marker、provider 调用或发行。

Windows Node v22.22.2 与 Linux Node v22.12.0 在准确独立提交上分别运行原离线合同 **43/43，0 fail，0 skip**。没有安装依赖，测试 checkout 内没有 node_modules，结束时源码和工作树未变。七份源码的原始字节、换行规范化摘要、Git blob ID/摘要与完整 TAP、进程输出均保存；两平台绑定一致。

诊断 workflow 与历史准备 `f53477ad65b17f16d5e8bda77447d06bef86c587` 逐字相同：保留 volcengine diagnostic 的 push.paths 增项，paid job 的 if 不变。此次普通 push 的 skipped run 只证明零步骤准备状态；它不是付费旅程或公开包验证结果。该 push 另产生 Graph Kernel / Memory Index / Context Memory CI，原 API 清单保留，未取消或删除。

collector **9/9** 是 **2026-10-11T10:10:50.523Z 的历史合同结果**，按 helper 源码哈希绑定；本次只核对当前 helper 仍与历史测试字节一致，未将旧测试计作 9aa64f 的新运行。collector --plan 绑定本次 skipped run，但完整 collector 必须使用未来实际付费 run 的 execution SHA、run ID 和 API attempt。collector 只静态采集，不在宿主执行候选，也不独立证明 checker、价目表或 invoice。

正式计划 **36 tasks + 9 firstRuns / NOT_RUN / observed=0 / $99**、冻结指纹与旧窗口保持不变。本次 43/43 离线合同和历史 collector 9/9 均不增加正式观察。独立人工/外部 review 锁、实际 invoice/硬额度、目标 GUI/辅助技术、native/durable 和 8h/24h/SLO 仍须单独验收。formalSample=false，observationsProduced=0。

后续 marker 准备边界：

- 等待准确发行候选的七门和公开 CLI 回读完成；本归档不证明已经发行。
- marker 空提交不满足 paths 过滤，不能触发 push workflow。经授权的实际 marker 提交必须触及匹配文件；本次未创建或推送 marker，也未 confirm_live dispatch。
- marker 改动会产生新 execution SHA，须重新锁定该源码并使用真实 run/attempt 采集；发行 pin 保持 821c63。不得用本次 skipped run/9aa64f 冒充后续付费运行。
- 失败或缺件保留原始证据，不能升级为成功、账单验证或正式样本。

[manifest.json](./manifest.json) 记录 69 份 gzip 原件的压缩前后 SHA-256、字节数与 Git 身份。新目录全部使用排他创建，旧 retest-ready2 未覆盖；所有 gzip 均已逐项解压核验。
