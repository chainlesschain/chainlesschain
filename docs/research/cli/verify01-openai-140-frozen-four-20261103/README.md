# OpenAI：已发布 .140 修正源码的四项冻结补测

用户指定只补测此前原冻结项目未通过的四项：`verify-08`、`verify-13`、`verify-36`、`first-run-darwin-vscode`，完成后更新 [36+9 任务清单](../verify01-36-plus-9-task-list.md)。本轮分母为四项，其余 41 项不重新执行。

## 冻结身份

- 项目及发行源码：`e2a91bf54332ff3d252c40ecc25c5887e0f0430d`，包含 .138 / .139 的相关源码修正。采用明确的修正源码修订，不将其记录为原 `b2aa3aba` 项目的成绩。
- CLI `0.166.140`、VS Code `0.37.176`、JetBrains `0.4.193`；VS Code 宿主 `1.132.0`、IntelliJ IDEA `2025.2`。
- CLI 通过 GitHub Actions OIDC 发布，配套插件随后发布；公开包与官方构件的关系见 [包证明](package-resolution.json) 和本轮 `public-readback.json`。旧发布证明保留原字节，本轮另行核对 JetBrains 商店状态。
- 本轮公开回读确认 JetBrains `0.4.193`（update `1211021`）已获批、列出且可公开下载；商店包内容与官方构件逐项一致。CLI 与 VS Code 的公开包 SHA-256 均与官方发布字节匹配。
- 模型保持 `OpenAI / gpt-6.1-sol / Responses`，默认思考，`review_changes=true`，规划上下文 `32768` tokens。
- 维持每样本 20 轮、24 个物理请求、8192 输出 tokens，四项总上限 96 个物理请求；普通任务 20 分钟、首次安装 30 分钟。准备工作不启动模型请求。

## 执行与计分

macOS VS Code 执行 `verify-08` 和独立首次安装；Linux CLI 执行 `verify-13`；macOS JetBrains 执行 `verify-36`。每项使用独立工作区与配置，排除历史候选及验收答案。保留原提示词、源码边界、基线与行为变异，随后在独立 Linux Docker 验收。

只有正常生成终态和独立验收均通过才计本轮通过。配置、离线回归、候选文件生成或单纯测试通过不计完成。保留失败、未知账单及不完整用量，不以重复派发消除失败。

原冻结项目历史 **41/45**、修正源码跨版本累计 **45/45** 与本轮四项成绩分别报告。此次不重开原正式冻结计划的财务准入，正式状态继续为 `NOT_RUN`。

[复测计划](retest-plan.json) 与 [包清单](../verify01-package-sets/2026-11-03-openai140-frozen-four.json) 固定范围和摘要。实际派发、不可变执行提交及最终逐项结果将以 `dispatch.json`、原始回执和 `results.json` 记录；准备完成不表示模型补测完成。临时仓库模型凭据只在授权执行期间使用，结束后删除并核对，不改动用户提供的本地文件。

## 本轮运行

执行提交冻结为 `802c51a9f20568d06268b12c0326087eca697278`，标签 `verify01-public140-run-802c51a9f2`。四份计划绑定摘要均与此提交的原始 Git blob 核对一致；后续文档或排版提交不替代执行源码。

| 宿主 / 入口 | 样本 | 原生运行 |
| --- | --- | --- |
| macOS / VS Code | `verify-08`、`first-run-darwin-vscode` | [41665846234](https://github.com/chainlesschain/chainlesschain/actions/runs/41665846234) |
| Linux / CLI | `verify-13` | [41665868150](https://github.com/chainlesschain/chainlesschain/actions/runs/41665868150) |
| macOS / JetBrains | `verify-36` | [41666324429](https://github.com/chainlesschain/chainlesschain/actions/runs/41666324429) |

三次 POST 均只提交一次。GitHub 的按 head SHA 查询一度未返回已受理的 Linux 运行，派发器依合同停止；随后从相同不可变标签的分支列表确认原运行，保留回执并仅提交尚未提交的 JetBrains 作业，没有重发 Linux 请求。见 [派发 journal](dispatch.json)。运行结束后按实际原始回执填写成绩；排队或启动不算通过。

## 最终结果

**四项均正常生成，独立验收与端到端结果均为 2/4 通过、2/4 未通过。**

| 样本 | 基线 | 候选测试 | 行为变异检出 | 本轮结果 |
| --- | --- | --- | --- | --- |
| `verify-08` | 59/59 | 0/1 | 未执行 | 未通过 |
| `verify-13` | 15/15 | 20/20 | 2/2 | 通过 |
| `verify-36` | 12/12 | 63/63 | 1/1 | 通过 |
| `first-run-darwin-vscode` | 59/59 | 1/2 | 未执行 | 未通过 |

两个 VS Code 候选的具体错误和原始失败回执见[失败分析](failure-audit.json)。Linux 图片输入候选与 JetBrains 启动配置候选均经原始独立验收通过；未修改模型生成候选。

本轮 **81/81** 个物理请求用量完整，token 费用估算 **$2.7350963**，实际账单未知。六份原始 ZIP 的 GitHub 制品摘要、交付/验收 summary、候选、回执之间的绑定均经核验；本机再次核对归档 **22/22** 文件。收集、归因和清理未启动额外模型请求。

- [完整成绩与用量](public-802c51a9f2/results.json)
- [原始文件摘要索引](public-802c51a9f2/archive-index.json)
- [本机完整回读核验](collection-verification.json)
- [失败候选归因](failure-audit.json)
- [临时密钥清理回执](secret-cleanup.json)

原冻结项目 41/45 与修正源码跨版本累计 45/45 保持各自历史身份；本轮两项失败不扣减旧成功，也不宣称本次完成同版本全量 45/45。当前冻结补测仍有 `verify-08`、`first-run-darwin-vscode` 两项未通过。
