# CLI 0.166.139：剩余两项公开版本复测

用户授权在 GitHub Actions 使用已发布 CLI **0.166.139**、VS Code 插件 **0.37.175** 和 JetBrains 插件 **0.4.192**，复测 **verify-08（macOS VS Code）**、**verify-36（macOS JetBrains）**。

上一轮 CLI .138 中，两项候选均通过独立测试与行为变异检查，但作者阶段耗尽 20 轮，未正常结束，因此端到端失败。见[上一轮结果](../verify01-openai-138/README.md)。已通过的 verify-19、verify-13、first-run-darwin-vscode 不重跑；历史 41/45、.137 r3 0/5、.138 2/4 分别保留，本轮单列 2 项。

本轮使用发行源码 `eec8b97b6040d19004670bfead0bec1b8a27b71b`；[执行项目绑定](../verify01-openai-137/public139-project-revision.json)保留原题、交付路径及操作系统。该文件放在驱动允许的既有修订目录中。包校验核对 npm 原始字节、Open VSX 与官方 VSIX 内容、官方 JetBrains ZIP 及工作流身份。JetBrains 使用官方发布构件，不据此宣称商店审核状态。

模型仍为 OpenAI / gpt-6.1-sol / Responses，`review_changes=true`，每项 20 轮、24 个物理请求、8192 输出 tokens、262144 请求 bytes、180000ms 请求超时、32768 tokens 规划上下文；两项最多 48 个物理请求。重新生成后独立执行 Linux Docker 基线、候选及行为变异验收，要求正常模型终态和完整用量，不修改既有验收标准。

GitHub Actions [包校验 41442467393](https://github.com/chainlesschain/chainlesschain/actions/runs/41442467393)已通过，原始版本与字节见[校验回执](package-resolution.json)。[复测计划](retest-plan.json)固定两项范围、证据摘要及原预算。用户已提供本机测试凭据文件路径，将临时配置仓库 `OPENAI_API_KEY`，任务结束后清理；凭据内容不写入证据。模型任务派发及结果另行记录。工程检查与[离线源码回放](offline-source-replay.json)均不计入真实模型任务通过数。

首次基础设施尝试的[回执](infrastructure-dispatch-605d1da3ba.json)保留：VS Code 运行 41443770821 在创建 broker 前因修订文件路径不满足旧目录限制而退出，模型请求为 0；JetBrains 运行 41443782209 在仍排队时申请取消。已将配置移至兼容路径，并为派发预检增加同一限制，未修改模型或验收器。

两次首次尝试的原始生成日志均已核对，均出现创建 broker 前的同一修订路径断言，[独立归档](infrastructure-first-attempt/audit.json)确认模型请求为 0。JetBrains 的最终工作流结论为取消，保留其实际退出状态。

修正后的派发工作流 [41445266749](https://github.com/chainlesschain/chainlesschain/actions/runs/41445266749)成功，执行源码固定为 `24a6e3857f53419de142e01375c79e4fcb326a12`，两项[回执](dispatch.json)均已保存。真实任务运行如下，最终验收完成前不增加通过数：

- [verify-08 / macOS VS Code / 41445382222](https://github.com/chainlesschain/chainlesschain/actions/runs/41445382222)
- [verify-36 / macOS JetBrains / 41445393011](https://github.com/chainlesschain/chainlesschain/actions/runs/41445393011)

配置、证据及结果跟踪见[草稿 PR #516](https://github.com/chainlesschain/chainlesschain/pull/516)。相关配置、来源绑定与包身份检查共 19 项通过；工程回归不替代真实任务验收。

verify-08 已完成：生成正常结束，21/21 个物理请求用量完整，费用估算 $0.6038099，实际账单未知。独立基线 59/59 通过，候选 0/1 通过，第 78 行错误地要求分支祖先显示行与父会话完整对象相等。显示 ID 依据当前会话与持久事件构建，原始来源由 `sourceEventId` / `sourceItemIndex` 单独保存；既有基线也明确要求父子显示 ID 不相同。Astra 独立核对确认该失败是生成断言错误，不构成产品缺陷证据。候选早期失败，后续断言与行为变异未执行。

verify-36 的 41445393011 未获得 macOS runner：官方注释为 `The job was not acquired by Runner of type hosted even after multiple attempts`，同时提示 macOS ARM64 容量不足。生成作业 `runner_name` 为空、步骤为空，模型请求为 0。已按原配置仅补跑此项，[41448844116](https://github.com/chainlesschain/chainlesschain/actions/runs/41448844116)，原始官方注释与一次性补跑记录见[回执](jetbrains-capacity-retry.json)。保留 macOS 15 ARM64，不替换为 Intel。
