# CLI 0.166.100 / IDE 配对发行公开核验

冻结源码：`6a8db627c87f33ce4f8e5d3db704868957aa685e`；[源 PR435](https://github.com/chainlesschain/chainlesschain/pull/435)。

- CLI **0.166.100 VERIFIED**：[OIDC 发布](https://github.com/chainlesschain/chainlesschain/actions/runs/38322183193)、[npm](https://www.npmjs.com/package/chainlesschain/v/0.166.100)。公开 tarball 与不可变 Actions 制品一致；14 个公开包含 13 个子包，SRI、四份签名来源回执、复用源码树和禁用生命周期脚本的 registry-only 安装通过。
- VS Code / Open VSX **0.37.144**：公开回读完成。Microsoft Marketplace 不包含在此标签发布渠道内。
- JetBrains **0.4.162**：已提交，仍待市场批准或最终核验。只有批准、listed、可公开下载且 ZIP 内容与 Actions 制品匹配才能算公开完成；pending 不算发布成功。

七个完整冻结源码门包含 114 个作业（113 success、1 预期 skip），见 preflight/summary.json 与 Astra 独立审阅。额外 15 个 merge-checkout 作业仅有相同 tree，不称 exact-source 执行。原失败与旧时点记录保留。

签名审计来源是成功 OIDC 工作流的 digest-bound npm audit signatures 回执，未重新本地执行签名审计；禁用脚本安装仅证明来源与依赖一致，不证明原生功能。大型 tarball/VSIX/ZIP 留在原独立回读目录，公开 URL、摘要和原件目录见回执与 manifest。

正式验收仍 **NOT_RUN / 0/36 / 0/9 / 共享 $99**；冻结火山18任务+9首次旅程、OpenAI18任务分配。预算模块31ff独立分支不在本次发布内，仍 NOT_PAID_READY。真实火山诊断和 Astra 审阅不计正式样本。
