# CLI 0.166.96 配对发布候选

> **2026-10-10 实际发行结果**：准确发行源码 `da91e730d802b7c9dcdc075b222ecc257021e552` 的 CLI CI **71/71**、Strict **5/5**、IDE Extensions **18 success / 1 非标签后验证 skip**、ARM64 **10/10** 及其余完整测试门全部通过。既有 GitHub Actions OIDC 已先发布并核验 Agent SDK `0.2.14`，再发布 CLI `0.166.96`；公开包与不可变制品的摘要、SRI、来源证明和十个直接子包安装/精确版本均匹配。随后发布 Open VSX `0.37.140`，公开可下载内容与标签制品一致。JetBrains `0.4.158` 的标签发布已成功提交 Marketplace，当前仍 `pending`，等待公开审批，不能声称已公开可安装。 见[完整发行清单](./final-release/manifest.json)。正式 36 tasks + 9 firstRuns、$99 和 observations 保持 `NOT_RUN`；冻结 Windows **211 = 194 pass / 16 fail / 1 skip**、**6 检出 / 4 存活 / 4 未运行**与完整 native review 保持 `NOT_ADMITTED`。Windows/macOS durable authority、受保护 journal、服务自身恢复/WFP、官方账单、独立人工/辅助技术及 8h/24h/SLO 继续开放；本轮无新增付费 provider 调用。

> **2026-10-10 首轮完整矩阵失败**：准确候选 `3900e9bd7f4d610b74b4d1639cf62b39dd9004ed` 的 CLI CI 为 **66 success / 2 failure / 1 skip**（69 个实际 job，SDK 尚未运行），Strict **5/5**；IDE Extensions 为 **15 success / 1 failure / 3 skip**，ARM64 为 **8 success / 2 failure**。完整门未通过，四个候选版本均未发布。 当前修复仅涉及功能测试驱动：CLI 单个 600 事件完整集合用例使用 180 秒有界功能预算并保留全部断言；ARM64 Enter 后改从稳定 frame/rootpane 读取每次调用的独立标量收据；Remote SSH 仅在明确匿名 Docker Hub 限流时回退到相同固定 digest 镜像，并校验实际 RepoDigests、保存两次完整输出。局部 CLI **7/7**、Rhino/Swing **14/14**、Remote SSH **17/17** 通过，不能替代新准确提交的真实宿主与完整三平台门。 见[完整失败原件](./prepublish-attempt1/index.json)及[修复合同](./repair-attempt1/index.json)。版本仍为 Agent SDK `0.2.14`、CLI `0.166.96`、VS Code `0.37.140`、JetBrains `0.4.158`。新提交须重新完成自身全部矩阵，再按子包 → CLI → IDE → 合并顺序发行；保留原 `.95` 标签，不移动标签，不改为本地或 token 发布。

新候选为 Agent SDK `0.2.14`、CLI `0.166.96`、VS Code `0.37.140`、JetBrains `0.4.158`。两端 IDE 尚未发布，因此保留插件版本并将推荐 CLI 改为 `.96`；SDK 与锁文件升级，VS Code/Desktop 生成标记同步，SDK 运行时输出摘要未变。保留 `.95` 原标签和失败原件，不移动标签、不削弱复用门。新提交必须重新完成自身的三平台完整矩阵，再按 SDK → CLI → IDE → 合并顺序发行。当前没有发布新版本。

CLI `0.166.95` 的准确提交 `3caf14f2ee866335608487ab57add325972709d7` 已取得 CLI CI **71/71**、Strict **5/5**、IDE **18 成功 / 1 条件跳过**及 ARM64 **10/10**。但 OIDC 发布 run `37985598206` 在 Agent SDK `0.2.13` 的整个源码树复用检查失败，CLI 发布步骤明确跳过；它没有成为新公开 CLI。SDK 的签名来源校验通过，实际改变的是测试诊断文件，公开 tarball 字节一致的预检不足以证明整个 Git 子树未变。

旧[发布失败](../release-0.166.95/npm-publish-failure/manifest.json)和[完整源码验证](../release-0.166.95/validated-source-3caf/manifest.json)属于旧提交，不是本候选的发行门。最终发行状态须以本目录后续准确提交、OIDC 回执及公共包字节校验为准。

正式 36 tasks + 9 firstRuns 保持 `NOT_RUN`，完整 native review 保持 `NOT_ADMITTED`；冻结源码、配置、分母、$99、observations 以及 Windows/macOS durable、账户账单、独立人工和长时验收状态不变。
