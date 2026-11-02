# CLI 0.166.139：剩余两项公开版本复测

用户授权在 GitHub Actions 使用已发布 CLI **0.166.139**、VS Code 插件 **0.37.175** 和 JetBrains 插件 **0.4.192**，复测 **verify-08（macOS VS Code）**、**verify-36（macOS JetBrains）**。

上一轮 CLI .138 中，两项候选均通过独立测试与行为变异检查，但作者阶段耗尽 20 轮，未正常结束，因此端到端失败。见[上一轮结果](../verify01-openai-138/README.md)。已通过的 verify-19、verify-13、first-run-darwin-vscode 不重跑；历史 41/45、.137 r3 0/5、.138 2/4 分别保留，本轮单列 2 项。

本轮使用发行源码 `eec8b97b6040d19004670bfead0bec1b8a27b71b`；[项目绑定](project-revision.json)保留原题、交付路径及操作系统。包校验核对 npm 原始字节、Open VSX 与官方 VSIX 内容、官方 JetBrains ZIP 及工作流身份。JetBrains 使用官方发布构件，不据此宣称商店审核状态。

模型仍为 OpenAI / gpt-6.1-sol / Responses，`review_changes=true`，每项 20 轮、24 个物理请求、8192 输出 tokens、262144 请求 bytes、180000ms 请求超时、32768 tokens 规划上下文；两项最多 48 个物理请求。重新生成后独立执行 Linux Docker 基线、候选及行为变异验收，要求正常模型终态和完整用量，不修改既有验收标准。

GitHub Actions [包校验 41442467393](https://github.com/chainlesschain/chainlesschain/actions/runs/41442467393)已通过，原始版本与字节见[校验回执](package-resolution.json)。[复测计划](retest-plan.json)固定两项范围、证据摘要及原预算。用户已提供本机测试凭据文件路径，将临时配置仓库 `OPENAI_API_KEY`，任务结束后清理；凭据内容不写入证据。模型任务派发及结果另行记录。工程检查与[离线源码回放](offline-source-replay.json)均不计入真实模型任务通过数。
