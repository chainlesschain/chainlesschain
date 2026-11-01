# CLI 0.166.138：公开包的未通过项复验

按用户授权立即验证，不等待 JetBrains 商店审核。使用公开 CLI **0.166.138**、Open VSX **0.37.174**，以及 run **41327724484** 已通过全部检查并上传的 JetBrains **0.4.191** 原始构建 ZIP；后者明确记录为官方待审侧载构件。

依照“成功不用复测”，跳过 .136 已正式通过的 **verify-19**，只重跑 **verify-08、verify-13、verify-36、first-run-darwin-vscode**。保留其后开启审阅时的失败记录，不把历史通过当作 .138 新验收。历史 **41/45** 与上一修复候选 **0/5** 均保持不变，本轮单列 **4 项** 分母。

重新生成后执行独立 Linux Docker 验收，保留原始任务、基线、行为变异、输出路径、原预算及正常终态要求；`review_changes=true`，规划上下文仍为 **32768 tokens**，模型仍为 **OpenAI / gpt-6.1-sol / Responses**。并发 WS 策略和 review-budget WIP 均未混入已发行 CLI138。

[包清单](../verify01-package-sets/2026-11-02-openai-138.json)与[云端包校验](package-resolution.json)固定发行来源及字节。规划与验收见[复验计划](retest-plan.json)。当前尚未派发付费生成；运行 ID、用量、候选及独立验收结果将在执行后归档，临时仓库 OpenAI 凭据在生成全部结束后清理，用户本地凭据不改动。
