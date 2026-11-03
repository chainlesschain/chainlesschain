# CLI .139 第三轮：verify-08 原生单项复测

日期：2026-11-03。用户明确要求提交 GitHub Actions 进行测试。本轮只选择仍未通过原生验收的 **verify-08 / macOS VS Code**，已通过的 verify-36 不再执行。

**第三轮原生验收 1/1 通过。** verify-08 正常生成，独立 Linux Docker 基线 **59/59**、候选 **2/2**，检出原父会话错绑变异 **1/1**（变异时 1 通过 / 1 失败）。本轮 **21/21** 个物理请求用量完整，token 费用估算 **$0.5873909**，实际账单未知。此前失败和辅助修复保持原记录；近期 OpenAI 未通过队列已清空，不代表同版本 45 项全量重跑。

新候选直接验证真实 live capability 的正确父会话、错误父会话及上下文、伪造与过期控制，并独立覆盖兄弟分支各自截点、来源身份及正文隔离。原验收器和预算未修改，辅助答案没有提供给模型；通过结果对应本轮重新生成的候选。

继续使用 CLI **0.166.139**、Open VSX **0.37.175**、JetBrains **0.4.192**。本次没有产品运行时代码变化，不需要重新发行；沿用已独立核验的[包身份](../verify01-package-sets/2026-11-03-openai-139-r2.json)与[云端包证明](../verify01-openai-139-r2-20261103/package-resolution.json)，最新公开版本另作本轮只读核对。

模型仍为 OpenAI / gpt-6.1-sol / Responses，`review_changes=true`。维持原 **20 轮、24 个物理请求、8192 输出 tokens、32768 tokens 规划上下文**，任务和 Linux Docker 独立验收标准保持不变。本轮总上限为 **24 请求**。

使用新的计划、项目修订、执行提交和派发 journal。模型重新生成候选，上一轮候选、辅助修复和反馈不作为答案提供；[第二轮原生 1/2、辅助修复 1/1](../verify01-openai-139-r2-20261103/README.md)保持原记录。

唯一原生运行 [41558182255](https://github.com/chainlesschain/chainlesschain/actions/runs/41558182255) 已完整成功，执行提交固定为 `aeb3a9d9cb97e23313bb1c316db00722a296e970`。见[派发 journal](dispatch.json)与[复测计划](retest-plan.json)。

只读收集工作流 [41560313707](https://github.com/chainlesschain/chainlesschain/actions/runs/41560313707) 成功，两份原始交付/验收 ZIP 的摘要、候选与回执绑定均已核验；本机再次核对收集制品 ZIP 与归档 **7/7** 文件。见[完整原生成绩与用量](public-aeb3a9d9cb/results.json)、[候选](public-aeb3a9d9cb/candidates/verify-08/repair137-verify-08.test.js.txt)、[原始文件索引](public-aeb3a9d9cb/archive-index.json)与[本机回读证明](collection-verification.json)。首次本机 ZIP 回读收到 401；使用现有 GitHub 登录态在只读子进程中完成回读，未再次派发或启动模型。

临时仓库 `OPENAI_API_KEY` 已在生成结束后删除并确认不存在，本机凭据文件不改动，见[清理回执](secret-cleanup.json)。本轮准备代码的派发范围、来源与修订合同回归 **17/17** 通过；工程测试与真实模型验收分别记录。
