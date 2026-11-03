# 取消 8192 测试输出上限

用户于 2026-11-03 要求取消单次 8192 token 输出限制。火山 `/models` 的实时认证查询确认 `deepseek-v4-flash-ga-260731` 的 `max_output_token_length` 为 **393216**；[原始模型目录记录](model-catalog.json)已归档。

新诊断队列将 `max_tokens` 及完整用量校验使用的上限改为模型声明的 **393216**，不再人为设为 8192 或 16384。旧的冻结队列及旧配置保留，不以修改历史预算代替补测。40 轮、48 次物理请求、thinking 关闭、独立 change review、文件范围和独立 Docker 验收继续生效。

[新计划](plan.json)和[清单](../../verify01-package-sets/2026-11-03-volcengine-139-provider-output.json)通过三个已完成轮次的源码、摘要及最新结果，选择仍受输出截断影响的 **12** 个样本：原完整轮次的 11 个截断样本，加上 40 轮后截断的 `verify-07`。`verify-06` 最新失败是写错交付目录，不属于输出截断，不重跑；已通过样本也不重跑。

[本轮 Actions 41585306414](https://github.com/chainlesschain/chainlesschain/actions/runs/41585306414) 已完整结束，执行源码 `ba504a7869c14c11787e1547dc8611eef9aace71`。**独立验收 2/12 通过**：任务 **2/10**、首次运行 **0/2**，新增通过 `verify-01`、`verify-32`。生成通过 **9/12**；生成与独立验收分别记录。24 份生成/验收摘要、24 份独立回执与 12 份候选齐全，[最终原始报告](final-ba504a7869/results.json)为 `completeEvidence:true`。

**全历史累计更正：火山仍为 34/45（任务 27/36、首次运行 7/9，75.6%）**，此前成功继续计入。01/32 均已在历史成功名单中，本次不增加新的历史成功 ID，见[完整历史核对](../history-reconciliation/README.md)。

此前 `.139` 完整轮保持 **任务 12/36、首次运行 3/9，总计 15/45**。仅合并 `.139` 这批诊断的通过记录为 **任务 14/36、首次运行 3/9，总计 17/45**；[该局部累计](completion-status.json)不能代表全部火山历史，也不替代历史 34/45。新单轮与旧冻结分数均保留。

## 新轮次的实际终止情况

本轮 12 个样本没有任何 `DIAGNOSTIC_OUTPUT_TRUNCATED` 记录。`verify-07` 的第 35 次真实响应输出 **8951 token**、HTTP 200、`finish_reason:tool_calls`，完整的 JSON 参数调用 `write_file` 写入指定 `packages/cli/__tests__/verify-07.test.js`；原响应字节及摘要与用量回执一致。见[真实长输出证据](over8192-real-response/provenance.json)。该样本最终仍因未检出行为变异而验收失败，不能把接收长输出当作任务通过。

按生成阶段优先，最终分类如下：

| 结果 | 数量 | 说明 |
| --- | --- | --- |
| 生成及独立验收均通过 | 2 | `verify-01`、`verify-32` |
| 发送前网络失败 | 2 | `verify-14` 第一请求未发出；`verify-33` 前五次有完整用量，第六次在发送 HTTP 前失败 |
| 循环停滞 | 1 | `first-run-darwin-cli`，16 次请求用量完整，反复读取已交付内容，六批无进展后被 CLI 停滞保护终止 |
| 生成完成，但候选或基线回归失败 | 3 | `verify-11`、`verify-15`、`first-run-darwin-vscode` |
| 生成完成，但未检出行为变异 | 2 | `verify-04`、`verify-07` |
| 生成完成，但没有执行有效候选用例 | 2 | `verify-08`、`verify-36` |

网络项单列基础设施问题，不归因为模型能力或输出上限失败；`physicalRequestsStarted` 包含发送前预留的物理槽位，不能据此把未发出的请求算成有上游用量。独立验收的候选/基线失败也没有全部归因为模型错误，固定项目的既有缺陷需另行区分。没有移动模型候选、修改验收规则或将人工修复混入成绩。

[verify-14 网络回执](network-receipts/verify-14/provenance.json)与[verify-33 网络回执](network-receipts/verify-33/provenance.json)均确认 `dispatchStarted:false`、上游状态为空、响应字节为零，连接错误为 `ETIMEDOUT` / `ENETUNREACH`。CLI 所见 HTTP 403 来自本地诊断代理的拒绝响应，不能当作火山返回 403 或密钥无效。

## CLI .139 是否也有这个限制

已下载 npm 的 `chainlesschain@0.166.139` 原包并校验 SHA-256，与既有公开包清单一致。实际请求路径的五份关键源码与工作区逐字节一致。

火山 `agent` 默认的流式和非流式请求均不发送 `max_tokens`；显式设置 `maxOutputTokens:393216` 时原值传出。四项离线实际请求捕获均接收了完整的 20000-token 模拟响应，未在 8192 或 16384 处拒绝。见[原包及请求验证记录](cli139-output-wire-proof.json)。这项检查没有联网生成或产生模型费用。另已在上文真实模型任务中接收完整的 8951-token 工具调用。

结论限于火山 agent 路径。Anthropic 等其他 provider 有各自的默认输出预算，不能据此声称 CLI 的所有 provider 和功能都没有任何上限。本次固定 8192 的行为来自测试代理。

## Sol 最新状态更正

先前仅引用 41/45，没有包含共享仓库中最新的 .138/.139 复测记录。已从提交 `bac9e9757a` 取得[最新 Sol 原生成绩](sol139-r3-results.json)和[原始说明](sol139-r3-readme.md)。

Sol 最后未通过的 `verify-08` 在 [Actions 41558182255](https://github.com/chainlesschain/chainlesschain/actions/runs/41558182255) 的 .139 第三轮 **原生 1/1 通过**：基线 59/59、候选 2/2、原变异检出 1/1，21/21 次请求用量完整。近期失败队列已经清空：`verify-19`、`verify-13`、`first-run-darwin-vscode`、`verify-36`、`verify-08` 的最新原生记录均通过。

这些通过结果保持各自版本和项目修订身份。原冻结项目的历史累计 **41/45** 不改写；不存在由这些记录证明的 .139 同版本全量 **45/45**。最近归档的完整 Sol 单轮是 .133 的 **39/45**。因此不能直接把累计补测结果与火山本次完整单轮混为同条件比较。

本轮工程验证：相关 Node 合同 **38/38**，npm .139 实际请求路径离线捕获 **4/4** 通过；Actions 校验成功。模型任务的 **2/12** 独立验收成绩保持单独记录。
