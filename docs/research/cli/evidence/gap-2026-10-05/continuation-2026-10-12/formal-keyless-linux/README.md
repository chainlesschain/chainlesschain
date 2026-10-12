# 正式 v2 的真实 Linux 无密钥预检回读

准确工程提交 **e32e75e2b4a14daf0901f09a6738605896fb6385** 的 [run38269124745](https://github.com/chainlesschain/chainlesschain/actions/runs/38269124745) 已 completed/success。真实 Ubuntu24.04.5 x64 / Node22.12.0、固定项目 b2aa3aba082873570e85dce39b00754e5504ff37 checkout、Docker 镜像实际启动、全部72脚本生成，以及启用 lifecycle 的公开 CLI0.166.99 安装均通过。CLI、10个直接子包的 registry/SRI/原始 lock 和版本回执已回读；旧 OIDC/public summary 先核验 manifest 原字节摘要、OIDC VERIFIED 和不可变制品字节。

实际镜像 ID 为 `sha256:344dbe71e1c47a59db0e94bebdcc94ef3a7bc8bd828393c820168993539048da`，RepoDigest 为 `node@sha256:0e910f435308c36ea60b4cfd7b80208044d77a074d16b768a81901ce938a62dc`。实际 reviewDigest 为 `sha256:70bf778369d352cfa7d31036ec8f2ab4b14d2079a8d18a82ab465bf2b7803c54`，与[历史本地预览](../../../../verify01-plan-2026-10-12-v2/review-preview/README.md)不同，不沿用其审阅结论。

[linux-review-pack.tgz](./linux-review-pack.tgz) 保存实际75文件：36 setup、36 check、review.json、review.sha256、pack.json，未修改其原始字节。创建新目录后用 `tar -xzf` 解压，完整75项摘要见 [summary.json](./summary.json)。它们已生成并逐摘要验证，尚未在本轮作为实际 task checker 执行；独立 checker 的既有 Docker 诊断另行绑定。Astra 回读已核验原 ZIP 与 API 摘要、旧摘要链、10个子包精确版本/SRI、全部72脚本以及 runtime 与 e32e75 Git blob。

[manifest.json](./manifest.json) 保存32份 API、实际 ZIP、日志、安装 lock、镜像、完整原 readiness、来源 binding、源码绑定和 collection 的压缩/原文双 SHA256。原始 ZIP619891字节，API digest为 `sha256:30732043f3bc2610d936804bf3c036fb932c0558590a8f3704195715e4b306ed`。collection 再次以原process Buffer采集，退出2且 reviewValidated=true，正式仍0/36、0/9。全 CI 矩阵在快照时仍有排队/运行项，不作为发行门通过。

该 run 在用户授权 Astra 替代人工之前执行，原 `independentHumanReview:false`/`paidExecutionReady:false` 回执完整保留。当前审阅规则与后续发现以 [v2](../../../../verify01-plan-2026-10-12-v2/README.md) 的增量为准。预检不认证 provider、不执行模型任务或首次旅程；安装 lifecycle、lock、版本检查不等同 native SQL 功能验收。实际其他 GUI、Windows/macOS native/durable、长时观察与正式 SLO 仍开放。
