# CLI .139：未通过原生任务的第二轮复测

日期：2026-11-03。用户授权使用最新 CLI / IDE 插件，在 GitHub Actions 重新测试未通过的 36+9 样本。本轮仅选择 **verify-08 / macOS VS Code**、**verify-36 / macOS JetBrains**；已通过样本跳过。

目标版本：CLI **0.166.139**、Open VSX **0.37.175**、JetBrains **0.4.192**。先独立核对最新公开版本、原始包字节及官方构建来源，再派发模型任务；JetBrains 商店批准、公开包内容与官方制品分别核对。

模型继续为 OpenAI / gpt-6.1-sol / Responses，开启 `review_changes`；每项维持 **20 轮、24 个物理请求、8192 输出 tokens、32768 tokens 规划上下文**。两项最多 48 个物理请求，不修改原任务、交付路径、macOS 宿主、预算或独立 Linux Docker 验收标准。项目固定公开发行源码 `eec8b97b6040d19004670bfead0bec1b8a27b71b`；原辅助修复、历史候选与反馈不提供给模型。

上一轮原生 **0/2**、辅助 **2/2** 保留，见[上轮记录](../verify01-openai-139/README.md)。本轮使用新的计划、修订、执行提交与派发 journal；不重放旧运行，也不以已安装辅助测试替代原生交付。历史 OpenAI 41/45、.138 的 2/4、火山 34/45 分别记账。

包预检 [41546976889](https://github.com/chainlesschain/chainlesschain/actions/runs/41546976889) 成功，原始 ZIP 的摘要已核对，三份证据文件按原字节归档。JetBrains `.192` 的公开 update **1209958** 已批准、列出，公开 ZIP 与官方制品内容一致；容器 SHA-256 不同，未冒充逐字节一致。见[包清单](../verify01-package-sets/2026-11-03-openai-139-r2.json)、[预检回执](package-resolution.json)、[JetBrains 公开证明](jetbrains-public.json)。首个无模型预检因目录初始化遗漏取消，修正后重新验证，见[基础设施记录](preflight-infrastructure.json)。

两项已唯一派发，执行源码固定为 `fbe0b5949b61240d05913693a8333fbea699fe68`，计划与结果隔离于上一轮：

- [verify-08 / macOS VS Code / 41547368707](https://github.com/chainlesschain/chainlesschain/actions/runs/41547368707)
- [verify-36 / macOS JetBrains / 41547386705](https://github.com/chainlesschain/chainlesschain/actions/runs/41547386705)

[派发 journal](dispatch.json)保留提交前写入和只读核对的唯一 run ID；没有重试不确定的派发请求。[复测计划](retest-plan.json)记录两个样本与原请求预算。当前结果待独立回收，派发成功不等于生成或任务验收成功。临时仓库模型 Secret 在全部生成作业完成后删除，本机凭据文件不改动。
