# Model Catalog 上游漂移原始证据

[Actions 38201454792](https://github.com/chainlesschain/chainlesschain/actions/runs/38201454792) 在准确 `08e883acc8ce0c1acdeebb4a7468d275da75311a` 上完成 failure。本地目录合同通过；官方原始输入检测到 Codex CLI 0.162.1、Claude Code 2.1.296，相对旧审查基线 0.160.0 / 2.1.289 触发 `--fail-on-drift` 的 exit 2。原告警保留，基线没有自动推进，也未自动启用模型。

7 个冻结源码与 review/Codex/Claude 三份输入逐字节核对 artifact 中的摘要成功。原 run/job/artifact API、完整 job log、原始发布输入和报告见 [manifest.json](./manifest.json)，范围见 [summary.json](./summary.json)。官方 Codex 文档当前跳转到混合产品 changelog，CLI 版本身份仍使用工作流保留的官方 release API 原件，不能用混合页面推断最新 CLI 版本。

Claude 2.1.296 的 Sonnet 5.5 缓存读取价格变化另行对照官方定价、修复和回归；此处仅归档原 run，不转为后续源码 CI 成绩或完整上游审查结案。没有 provider 调用、账单核验或正式样本，正式 36+9 / NOT_RUN / observed=0 保持。
