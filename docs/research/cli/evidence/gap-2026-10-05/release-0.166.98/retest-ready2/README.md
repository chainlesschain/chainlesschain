# CLI 0.166.98 独立复测准备：第二次归档

发行候选为 `d62ebf99141e7ef912f4384c1d65c83139ab2e5c`；独立准备提交为 `f53477ad65b17f16d5e8bda77447d06bef86c587`。CLI 0.166.98、Kernel 0.1.9 及 DIAGNOSTIC.publicReleaseCommit 已核对。[准备运行 38132809857](https://github.com/chainlesschain/chainlesschain/actions/runs/38132809857) 的 attempt 1 为 completed/skipped，唯一 job 114450457942 的 steps 为空。本归档记录零付费准备，不表示 CLI 已公开或付费诊断已执行。

Windows Node v22.22.2 与 Linux Node v22.12.0 在准确独立提交上各执行 43 项合同：43 通过、0 失败、0 跳过。工作树内无 node_modules、未安装依赖；七份仪器源码的原始字节、规范换行摘要及 Git blob 均有记录，两平台一致。原始 TAP、完整进程报告和源码快照均归档。

相较独立提交 `80b8b140a17f5a8fad74844e13d33674b456ef65`，诊断 workflow 唯一变化是 push.paths 增加 `packages/cli/scripts/verify01-volcengine-task-diagnostic.mjs`，使发行固定值变更产生可观察的准备运行。paid job 的 if 条件逐字不变；本次提交消息没有付费 marker。该推送另产生 Kernel CI 38132809907；仅记录，没有取消或删除结果。

collector 的 9/9 是 **2026-10-11T10:10:50.523Z 的历史合同结果**，按六份 helper 源码摘要绑定；原报告不含 execution SHA。本次只核对当前 helper 字节仍与历史一致，没有将这九项重新归属为 f53477ad 的新测试。旧准备上下文是 80b8b140 / 0b1f0e7；其 manifest 与完整历史 TAP 一并保留。collector 继续预检 ZIP 单项及累计 32 MiB、4096 条，限制实际 inflate 输出并复核尺寸；只静态采集，不执行候选或独立证明 checker、定价、账单。

后续付费衔接需要注意：

- 等候发行候选六门及公开 CLI 回读完成。这里只记录准备状态，不能替代发行门或公开版本核验。
- **仅含 marker 的空提交不满足 paths 过滤，不能启动 push workflow。** 后续授权 marker 提交须实际修改过滤范围内文件；显式 dispatch 的 confirm_live=true 是另一个独立触发方式。本次未执行任一付费触发。
- marker 提交会产生新的 execution SHA。collector 必须使用实际付费 run 的 ID、准确 SHA 与 API run_attempt，release SHA 保持 d62ebf；不得沿用本次准备 run 或 f53477ad 作为后续运行身份。
- prepared skipped run 仅用于 --plan 和门控证据。完整 collector 会要求 paid marker（push）、准确 attempt 制品摘要与最终 summary；缺失时保留 PARTIAL_EVIDENCE_NOT_ACCEPTED。失败运行也只能形成失败诊断证据，不能升级为成功、账单验证或正式样本。

[manifest.json](./manifest.json) 列出 59 个 gzip 原件，每项都有压缩前后 SHA-256 与字节数；Git 源码另有提交及 blob ID。所有 gzip 已逐项解压复核。本目录为全新归档，不覆盖 retest-ready。formalSample=false、formalStatus=NOT_RUN、observationsProduced=0。
