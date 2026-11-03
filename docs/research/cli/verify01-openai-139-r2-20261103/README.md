# CLI .139：未通过原生任务的第二轮复测

后续第三轮重新生成的 verify-08 已取得 **原生 1/1 通过**，见[第三轮结果](../verify01-openai-139-r3-20261103/README.md)。本页第二轮原生 1/2 与辅助修复 1/1 保留各自来源和原始成绩。

日期：2026-11-03。用户授权使用最新 CLI / IDE 插件，在 GitHub Actions 重新测试未通过的 36+9 样本。本轮仅选择 **verify-08 / macOS VS Code**、**verify-36 / macOS JetBrains**；已通过样本跳过。

**本轮原生独立验收 1/2 通过：verify-36 通过，verify-08 仍失败。** 两项生成均正常结束，**42/42** 个物理请求用量完整；token 费用估算 **$1.1929985**，实际账单未知。原生验收未修改候选、验收器或预算；下方按用户后续要求完成的辅助修复不改写该成绩，最新未通过原生验收的队列只剩 `verify-08`。

| 样本      | 基线  | 候选测试 | 原行为变异                                       | 最终结果 |
| --------- | ----- | -------- | ------------------------------------------------ | -------- |
| verify-08 | 59/59 | 2/2      | 删除父会话绑定检查后，候选仍 2/2，通过了错误实现 | 失败     |
| verify-36 | 12/12 | 7/7      | 权限放宽变异触发 4 个失败，检出 1/1              | 通过     |

verify-08 的生成测试覆盖了合法祖先前缀及兄弟分支正文隔离，但没有错误父会话 capability 的负对照，因此漏检原变异。原始运行记录确认候选本身能通过，不属于错误断言或产品缺陷复现；该失败不能用上一轮辅助修复替代。见[失败分析](verify08-failure-audit.json)。verify-36 的通过依据独立 Docker 执行与变异检查；模型最终自述未运行测试的限制保留，原生 UI 和生产完整旅程不由此自动验收。

## verify-08 辅助修复与原验收复跑

用户后续要求查明并修复问题，并授权 Astra 帮助。Astra 独立核查原始候选、读取记录和修复代码，确认本次缺口是生成测试没有落实父会话绑定负例；产品已有正确守卫，没有复现运行时缺陷。verify-08 已完整回读候选，不能借用 verify-36 的读取省略自述解释本次失败。见[独立静态审阅](assisted-verify08/astra-review.json)。

修复保留原两个合法分支案例，新增两个测试：在真实同步 authority / projection 回调内取得 live capability，先验证合法父会话，再仅改变父会话 ID 验证拒绝，并复核拒绝后合法调用仍有效；另外验证上下文变更、伪造、null 和回调退出后的过期行为。直接调用真实 resolver，避免其他 store 守卫掩盖父会话检查缺失。原两例 AST 相同，本机 **4/4** 通过，见[修复及本机审计](assisted-verify08/repair-audit.json)。

原独立 Docker 镜像、setup/check 字节与本次原生验收完全一致。GitHub Actions [41555674510](https://github.com/chainlesschain/chainlesschain/actions/runs/41555674510) 已成功：**基线 59/59、修复候选 4/4，原 wrong-parent 变异检出 1/1**；变异时仅新增父会话负例失败，另外三例仍通过。见[修复候选](assisted-verify08/repair137-verify-08.test.js.txt)、[独立结果](assisted-verify08/acceptance/result.json)与[原始回执绑定](assisted-verify08/acceptance/archive-index.json)。额外负例不声称完成了未执行的其他变异检查。

这次辅助修复 **1/1** 单列；原生结果仍为 **1/2**。没有重新执行已通过的 verify-36，没有追加原生付费请求，也没有改动产品运行时代码。

## 原生执行、制品与用量

目标版本：CLI **0.166.139**、Open VSX **0.37.175**、JetBrains **0.4.192**。先独立核对最新公开版本、原始包字节及官方构建来源，再派发模型任务；JetBrains 商店批准、公开包内容与官方制品分别核对。

模型继续为 OpenAI / gpt-6.1-sol / Responses，开启 `review_changes`；每项维持 **20 轮、24 个物理请求、8192 输出 tokens、32768 tokens 规划上下文**。两项最多 48 个物理请求，不修改原任务、交付路径、macOS 宿主、预算或独立 Linux Docker 验收标准。项目固定公开发行源码 `eec8b97b6040d19004670bfead0bec1b8a27b71b`；原辅助修复、历史候选与反馈不提供给模型。

上一轮原生 **0/2**、辅助 **2/2** 保留，见[上轮记录](../verify01-openai-139/README.md)。本轮使用新的计划、修订、执行提交与派发 journal；不重放旧运行，也不以已安装辅助测试替代原生交付。历史 OpenAI 41/45、.138 的 2/4、火山 34/45 分别记账。

包预检 [41546976889](https://github.com/chainlesschain/chainlesschain/actions/runs/41546976889) 成功，原始 ZIP 的摘要已核对，三份证据文件按原字节归档。JetBrains `.192` 的公开 update **1209958** 已批准、列出，公开 ZIP 与官方制品内容一致；容器 SHA-256 不同，未冒充逐字节一致。见[包清单](../verify01-package-sets/2026-11-03-openai-139-r2.json)、[预检回执](package-resolution.json)、[JetBrains 公开证明](jetbrains-public.json)。首个无模型预检因目录初始化遗漏取消，修正后重新验证，见[基础设施记录](preflight-infrastructure.json)。

两项已唯一派发，执行源码固定为 `fbe0b5949b61240d05913693a8333fbea699fe68`，计划与结果隔离于上一轮：

- [verify-08 / macOS VS Code / 41547368707](https://github.com/chainlesschain/chainlesschain/actions/runs/41547368707)
- [verify-36 / macOS JetBrains / 41547386705](https://github.com/chainlesschain/chainlesschain/actions/runs/41547386705)

[派发 journal](dispatch.json)保留提交前写入和只读核对的唯一 run ID；没有重试不确定的派发请求。[复测计划](retest-plan.json)记录两个样本与原请求预算。

只读收集工作流 [41554602070](https://github.com/chainlesschain/chainlesschain/actions/runs/41554602070) 已成功：核对四个原始交付/验收 ZIP 的 SHA-256、两项候选、四份验收回执和生成/验收摘要绑定。本机再次核验收集制品 ZIP 及归档 **13/13** 文件。见[完整结果与用量](public-fbe0b5949b/results.json)、[原始文件索引](public-fbe0b5949b/archive-index.json)、[本机回读证明](collection-verification.json)。收集过程没有模型请求。

临时仓库 `OPENAI_API_KEY` 已在全部生成作业结束后删除并确认不存在，本机凭据文件未修改，见[清理回执](secret-cleanup.json)。准备与回收代码的来源、轮次隔离及派发守卫本地回归 **20/20** 通过；这些工程结果不增加模型验收数。后续只复测 `verify-08`，不得再次执行已通过的 `verify-36`；新付费执行需要新的计划和来源记录。
