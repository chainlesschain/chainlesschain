# CLI 0.166.138：公开包的未通过项复验

按用户授权立即验证，不等待 JetBrains 商店审核。使用公开 CLI **0.166.138**、Open VSX **0.37.174**，以及 run **41327724484** 已通过全部检查并上传的 JetBrains **0.4.191** 原始构建 ZIP；后者明确记录为官方待审侧载构件。

依照“成功不用复测”，跳过 .136 已正式通过的 **verify-19**，只重跑 **verify-08、verify-13、verify-36、first-run-darwin-vscode**。保留其后开启审阅时的失败记录，不把历史通过当作 .138 新验收。历史 **41/45** 与上一修复候选 **0/5** 均保持不变，本轮单列 **4 项** 分母。

重新生成后执行独立 Linux Docker 验收，保留原始任务、基线、行为变异、输出路径、原预算及正常终态要求；`review_changes=true`，规划上下文仍为 **32768 tokens**，模型仍为 **OpenAI / gpt-6.1-sol / Responses**。并发 WS 策略和 review-budget WIP 均未混入已发行 CLI138。

[包清单](../verify01-package-sets/2026-11-02-openai-138.json)与[云端包校验](package-resolution.json)固定发行来源及字节。规划与验收见[复验计划](retest-plan.json)。四项均已重新生成并独立验收，结果为 **2/4 通过**。本次通过项后续跳过，不重新调用模型。

| 样本                    | 独立候选测试 | 行为变异检出 | 模型终态                      | 本轮最终结果 |
| ----------------------- | ------------ | ------------ | ----------------------------- | ------------ |
| first-run-darwin-vscode | 5/5          | 1/1          | success                       | 通过         |
| verify-13               | 12/12        | 2/2          | success                       | 通过         |
| verify-08               | 3/3          | 1/1          | error_max_turns，20/20 轮耗尽 | 失败         |
| verify-36               | 23/23        | 1/1          | error_max_turns，20/20 轮耗尽 | 失败         |

两项失败的候选均通过了独立检查，但模型未正常结束，因此不能算端到端通过。没有抬高预算、关闭审阅、修改候选或放宽验收。三个模型工作流已结束，本轮 **80/80** 个物理请求的用量完整，broker 均通过，未记录此前的 OpenAI HTTP 400。已知 token 费用估算 **$2.6309597**，实际账单未知。

两项都是作者阶段耗尽：`changeReview.observed=false`，尚未进入独立审阅。verify-08 最后一轮仍在修正历史来源断言；verify-36 最后一轮仍在修正参数化测试。后者的 21 次物理请求包含一次语义压缩，作者仍为 20 轮。局部读取交付确有额外开销证据，但不足以认定它是两项失败的完整根因；旧 review-budget WIP 也尚未证明能解决本轮。详见[失败诊断](public-c472d664eb/failure-audit.json)。

执行源码为 `c472d664ebfe8ca6ebd198cbd894d606a9b16195`，项目与公开 CLI 源码为 `e42ea07b6da7ab2c3eb709002448b32d5fedf535`。只读云端收集器另外校验了六个原始 ZIP 的 SHA-256，以及交付摘要、验收摘要和回执之间的绑定；本地再校验归档索引 **22/22** 文件。收集过程没有模型请求。

- [完整结果与用量](public-c472d664eb/results.json)
- [原始摘要、回执和候选索引](public-c472d664eb/archive-index.json)
- [本轮派发回执](dispatch.json)
- [临时仓库凭据清理回执](public-c472d664eb/secret-cleanup.json)：已删除并确认不存在，用户本地凭据未修改。
- [VS Code 两项工作流](https://github.com/chainlesschain/chainlesschain/actions/runs/41343643669)
- [Linux CLI 工作流](https://github.com/chainlesschain/chainlesschain/actions/runs/41343651198)
- [JetBrains 工作流](https://github.com/chainlesschain/chainlesschain/actions/runs/41343658414)

若按这五项的历次验收计算，已有 verify-19（CLI .136）、verify-13 和首次 VS Code 运行三项通过，剩 verify-08 与 verify-36；这不是同一版本的 3/5。历史 **41/45**、上一修复候选 **0/5** 和本轮 **2/4** 分别保留。
