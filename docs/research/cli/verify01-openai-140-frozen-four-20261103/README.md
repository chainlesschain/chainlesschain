# OpenAI：已发布 .140 修正源码的四项冻结补测

用户指定只补测此前原冻结项目未通过的四项：`verify-08`、`verify-13`、`verify-36`、`first-run-darwin-vscode`，完成后更新 [36+9 任务清单](../verify01-36-plus-9-task-list.md)。本轮分母为四项，其余 41 项不重新执行。

## 冻结身份

- 项目及发行源码：`e2a91bf54332ff3d252c40ecc25c5887e0f0430d`，包含 .138 / .139 的相关源码修正。采用明确的修正源码修订，不将其记录为原 `b2aa3aba` 项目的成绩。
- CLI `0.166.140`、VS Code `0.37.176`、JetBrains `0.4.193`；VS Code 宿主 `1.132.0`、IntelliJ IDEA `2025.2`。
- CLI 通过 GitHub Actions OIDC 发布，配套插件随后发布；公开包与官方构件的关系见 [包证明](package-resolution.json) 和本轮 `public-readback.json`。旧发布证明保留原字节，本轮另行核对 JetBrains 商店状态。
- 模型保持 `OpenAI / gpt-6.1-sol / Responses`，默认思考，`review_changes=true`，规划上下文 `32768` tokens。
- 维持每样本 20 轮、24 个物理请求、8192 输出 tokens，四项总上限 96 个物理请求；普通任务 20 分钟、首次安装 30 分钟。准备工作不启动模型请求。

## 执行与计分

macOS VS Code 执行 `verify-08` 和独立首次安装；Linux CLI 执行 `verify-13`；macOS JetBrains 执行 `verify-36`。每项使用独立工作区与配置，排除历史候选及验收答案。保留原提示词、源码边界、基线与行为变异，随后在独立 Linux Docker 验收。

只有正常生成终态和独立验收均通过才计本轮通过。配置、离线回归、候选文件生成或单纯测试通过不计完成。保留失败、未知账单及不完整用量，不以重复派发消除失败。

原冻结项目历史 **41/45**、修正源码跨版本累计 **45/45** 与本轮四项成绩分别报告。此次不重开原正式冻结计划的财务准入，正式状态继续为 `NOT_RUN`。

[复测计划](retest-plan.json) 与 [包清单](../verify01-package-sets/2026-11-03-openai140-frozen-four.json) 固定范围和摘要。实际派发、不可变执行提交及最终逐项结果将以 `dispatch.json`、原始回执和 `results.json` 记录；准备完成不表示模型补测完成。临时仓库模型凭据只在授权执行期间使用，结束后删除并核对，不改动用户提供的本地文件。
