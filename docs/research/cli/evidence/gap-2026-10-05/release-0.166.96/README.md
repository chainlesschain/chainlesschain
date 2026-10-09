# CLI 0.166.96 配对发布候选

新候选为 Agent SDK `0.2.14`、CLI `0.166.96`、VS Code `0.37.140`、JetBrains `0.4.158`。两端 IDE 尚未发布，因此保留插件版本并将推荐 CLI 改为 `.96`；SDK 与锁文件升级，VS Code/Desktop 生成标记同步，SDK 运行时输出摘要未变。保留 `.95` 原标签和失败原件，不移动标签、不削弱复用门。新提交必须重新完成自身的三平台完整矩阵，再按 SDK → CLI → IDE → 合并顺序发行。当前没有发布新版本。

CLI `0.166.95` 的准确提交 `3caf14f2ee866335608487ab57add325972709d7` 已取得 CLI CI **71/71**、Strict **5/5**、IDE **18 成功 / 1 条件跳过**及 ARM64 **10/10**。但 OIDC 发布 run `37985598206` 在 Agent SDK `0.2.13` 的整个源码树复用检查失败，CLI 发布步骤明确跳过；它没有成为新公开 CLI。SDK 的签名来源校验通过，实际改变的是测试诊断文件，公开 tarball 字节一致的预检不足以证明整个 Git 子树未变。

旧[发布失败](../release-0.166.95/npm-publish-failure/manifest.json)和[完整源码验证](../release-0.166.95/validated-source-3caf/manifest.json)属于旧提交，不是本候选的发行门。最终发行状态须以本目录后续准确提交、OIDC 回执及公共包字节校验为准。

正式 36 tasks + 9 firstRuns 保持 `NOT_RUN`，完整 native review 保持 `NOT_ADMITTED`；冻结源码、配置、分母、$99、observations 以及 Windows/macOS durable、账户账单、独立人工和长时验收状态不变。
