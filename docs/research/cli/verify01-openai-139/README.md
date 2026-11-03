# CLI 0.166.139：剩余两项公开版本复测

最新第三轮 verify-08 已获 **原生 1/1 通过**，基线 59/59、候选 2/2、原变异检出 1/1，见[第三轮记录](../verify01-openai-139-r3-20261103/README.md)。下方各轮历史成绩保持原身份。

后续 **2026-11-03 第二轮原生复测 1/2 通过**：verify-36 通过，verify-08 候选测试虽通过但漏检父会话 capability 错绑变异；42/42 请求用量完整，临时模型 Secret 已删除。见[第二轮独立记录](../verify01-openai-139-r2-20261103/README.md)。以下本轮原生 0/2 与辅助 2/2 的历史记录保持原身份。

两项失败已定位并修复，**辅助修复独立验收 2/2 通过**。原生生成这次均正常结束，但生成测试各有错误断言，原生独立验收为 **0/2**；两类结果分别保留，未把辅助修复写成模型原生交付通过。

后续已将两份辅助候选安装到 `packages/cli/__tests__/verify-08.test.js` 与 `verify-36.test.js`，仅经 Prettier 格式化。相关本机回归 **10 文件 84/84、零跳过**，三系统 CLI CI 定向步骤已纳入这两项；准确新提交的完整云端矩阵尚待运行。[安装记录](../../cli-ide/cli-ide-assisted-0836-install-progress-2026-11-02.md)单独保存候选、安装文件及原验收来源绑定，不改写上述原生成绩。

| 样本      | 修复内容                                                                       | 基线  | 修复测试 | 行为变异检出 | GitHub Actions                                                                           |
| --------- | ------------------------------------------------------------------------------ | ----- | -------- | ------------ | ---------------------------------------------------------------------------------------- |
| verify-08 | 分开校验分支显示身份与原始来源，保留祖先及正文隔离，并补齐 capability 正反对照 | 59/59 | 3/3      | 1/1          | [41451396249](https://github.com/chainlesschain/chainlesschain/actions/runs/41451396249) |
| verify-36 | 正确处理 null/缺省预算，验证实际恢复的权限、沙箱、工具与预算参数               | 12/12 | 17/17    | 1/1          | [41453819130](https://github.com/chainlesschain/chainlesschain/actions/runs/41453819130) |

修复经过 Astra 独立分析与审阅；根因均为生成测试对已有 API 合同的错误假设，未发现需要修改产品实现的证据。两次修复验收使用各自原生运行的**原始验收脚本字节与原始 Docker 镜像**，没有额外模型请求。修复候选、脚本摘要及原始回执见 [verify-08](assisted-verify08/acceptance/result.json)、[verify-36](assisted-verify36/acceptance/result.json)，汇总见[修复结果](assisted-results.json)。

用户授权在 GitHub Actions 使用已发布 CLI **0.166.139**、VS Code 插件 **0.37.175** 和 JetBrains 插件 **0.4.192**，复测 **verify-08（macOS VS Code）**、**verify-36（macOS JetBrains）**。

上一轮 CLI .138 中，两项候选均通过独立测试与行为变异检查，但作者阶段耗尽 20 轮，未正常结束，因此端到端失败。见[上一轮结果](../verify01-openai-138/README.md)。已通过的 verify-19、verify-13、first-run-darwin-vscode 不重跑；历史 41/45、.137 r3 0/5、.138 2/4 分别保留，本轮单列 2 项。

本轮使用发行源码 `eec8b97b6040d19004670bfead0bec1b8a27b71b`；[执行项目绑定](../verify01-openai-137/public139-project-revision.json)保留原题、交付路径及操作系统。该文件放在驱动允许的既有修订目录中。包校验核对 npm 原始字节、Open VSX 与官方 VSIX 内容、官方 JetBrains ZIP 及工作流身份。JetBrains 使用官方发布构件，不据此宣称商店审核状态。

主线随后补充了公开发行状态，合并时保留主线最新发布记录。实测时的[发布证明快照](../evidence/release139-public/publication-retest-snapshot.json)及执行提交 `24a6e3857f` 保留原字节；已完成计划的只读预检从该不可变执行提交核对原证明，不将后来的发布文档变化混入实测身份。

模型仍为 OpenAI / gpt-6.1-sol / Responses，`review_changes=true`，每项 20 轮、24 个物理请求、8192 输出 tokens、262144 请求 bytes、180000ms 请求超时、32768 tokens 规划上下文；两项最多 48 个物理请求。重新生成后独立执行 Linux Docker 基线、候选及行为变异验收，要求正常模型终态和完整用量，不修改既有验收标准。

GitHub Actions [包校验 41442467393](https://github.com/chainlesschain/chainlesschain/actions/runs/41442467393)已通过，原始版本与字节见[校验回执](package-resolution.json)。[复测计划](retest-plan.json)固定两项范围、证据摘要及原预算。临时仓库 `OPENAI_API_KEY` 已在全部生成任务结束后删除，并验证不存在，见[清理回执](secret-cleanup.json)；本机凭据文件未改动。原生任务共 42/42 个物理请求用量完整，token 费用估算 $1.2735909，实际账单未知。[只读收集 41451690807](https://github.com/chainlesschain/chainlesschain/actions/runs/41451690807)已通过，四个原始 ZIP 的摘要及本地归档 13/13 文件已核对，见[原生结果](public-24a6e3857f/results.json)。工程检查与[离线源码回放](offline-source-replay.json)不计入真实模型任务通过数。

首次基础设施尝试的[回执](infrastructure-dispatch-605d1da3ba.json)保留：VS Code 运行 41443770821 在创建 broker 前因修订文件路径不满足旧目录限制而退出，模型请求为 0；JetBrains 运行 41443782209 在仍排队时申请取消。已将配置移至兼容路径，并为派发预检增加同一限制，未修改模型或验收器。

两次首次尝试的原始生成日志均已核对，均出现创建 broker 前的同一修订路径断言，[独立归档](infrastructure-first-attempt/audit.json)确认模型请求为 0。JetBrains 的最终工作流结论为取消，保留其实际退出状态。

修正后的派发工作流 [41445266749](https://github.com/chainlesschain/chainlesschain/actions/runs/41445266749)成功，执行源码固定为 `24a6e3857f53419de142e01375c79e4fcb326a12`，两项[回执](dispatch.json)均已保存。原生任务运行如下：

- [verify-08 / macOS VS Code / 41445382222](https://github.com/chainlesschain/chainlesschain/actions/runs/41445382222)
- [verify-36 / macOS JetBrains / 41448844116](https://github.com/chainlesschain/chainlesschain/actions/runs/41448844116)：同配置容量补跑；此前零请求容量失败另行保留。

配置、证据及结果跟踪见[草稿 PR #516](https://github.com/chainlesschain/chainlesschain/pull/516)。相关配置、来源绑定与包身份检查共 19 项通过；工程回归不替代真实任务验收。

verify-08 已完成：生成正常结束，21/21 个物理请求用量完整，费用估算 $0.6038099，实际账单未知。独立基线 59/59 通过，候选 0/1 通过，第 78 行错误地要求分支祖先显示行与父会话完整对象相等。显示 ID 依据当前会话与持久事件构建，原始来源由 `sourceEventId` / `sourceItemIndex` 单独保存；既有基线也明确要求父子显示 ID 不相同。Astra 独立核对确认该失败是生成断言错误，不构成产品缺陷证据。候选早期失败，后续断言与行为变异未执行。

verify-36 的 41445393011 未获得 macOS runner：官方注释为 `The job was not acquired by Runner of type hosted even after multiple attempts`，同时提示 macOS ARM64 容量不足。生成作业 `runner_name` 为空、步骤为空，模型请求为 0。已按原配置仅补跑此项，[41448844116](https://github.com/chainlesschain/chainlesschain/actions/runs/41448844116)，原始官方注释与一次性补跑记录见[回执](jetbrains-capacity-retry.json)。保留 macOS 15 ARM64，不替换为 Intel。

该补跑正常生成后，基线 12/12、原生候选 9/17，八个失败均把合法的 null 预算误判为非法值。实现明确将 null/缺省预算视为未设置，并省略对应命令参数；既有基线也覆盖了此类合法但可能放宽限制的配置变化。辅助修复将其加入正对照，同时把恢复权限的自比较改为对实际 `--permission-mode manual` 等参数的明确断言，原有非法输入检查继续保留，最终 17/17 且检出原始权限放宽变异。
