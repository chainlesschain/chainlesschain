# Volcengine / DeepSeek：公开 .139 CLI 与 IDE 的 36+9 诊断

本次完整新轮次的独立验收结果为 **15/45**：项目任务 **12/36**，首次运行样本 **3/9**。全部 45 份生成记录和 45 份验收记录齐全。32 个样本正常完成生成；生成完成不等于通过验收。

这是 `formalSample:false` 的新诊断队列，不改写旧的冻结计划、正式分数或历史 OpenAI 成绩。

| 项目 | 本轮固定值 |
| --- | --- |
| 执行 | [Actions 41563424430](https://github.com/chainlesschain/chainlesschain/actions/runs/41563424430) |
| 执行源码 | `e7788a09316abb6f637932ae09254a441168742e` |
| 原始项目源码 | `b2aa3aba082873570e85dce39b00754e5504ff37` |
| CLI / VS Code / JetBrains | `0.166.139` / `0.37.175` / `0.4.192` |
| JetBrains 分发 | 官方 release ZIP；Marketplace 当时仍待审批 |
| VS Code / JetBrains 宿主 | `1.132.0` / `2025.2` |
| Provider / model | `volcengine` / `deepseek-v4-flash-ga-260731` |
| API | `https://ark.cn-beijing.volces.com/api/v3/chat/completions` |
| 本轮预算 | 20 模型轮次、24 物理请求、单次输出 8192 token |
| 诊断设置 | thinking 关闭，独立 change review 开启，六种文件工具，无候选答案或修复种子 |

使用公开 CLI 和实际安装的 IDE 插件，通过真实原生入口完成生成；独立 Linux Docker 验收检查生成身份、候选文件、既有回归及行为反例。工作流整体显示 failure，因为其中存在真实失败样本，不是报告缺失。

## 已观察到的失败原因

按生成阶段优先分类，45 个样本分为：

- **15** 个通过生成及独立验收。
- **11** 个生成阶段发生 `DIAGNOSTIC_OUTPUT_TRUNCATED`：上游 HTTP 200，但返回 `finish_reason: length`，单次输出触及 8192 token。诊断代理拒绝把截断内容交给工具执行；CLI 所见 HTTP 403 是代理的拒绝响应，不是火山密钥被拒绝。
- **1** 个耗尽 20 轮：`verify-06`。
- **1** 个无法完成独立复核：`verify-07`，仅剩一次请求，少于复核要求的两次。
- **17** 个正常完成生成但未通过独立验收：6 个未检出注入的行为缺陷，9 个候选或基线回归失败，2 个未执行有效测试用例。对应原始 receipt 的分类均保留，不以模型自述代替验收。

例如 `verify-10` 的候选测试在原始代码上能运行，但注入被测行为缺陷后仍然通过；因此验收失败。`first-run-win32-vscode` 的候选断言则与固定项目的模型能力行为不符。候选或基线回归失败还需逐项区分断言错误与固定项目的既有缺陷，本报告没有将其全部归因为模型错误。增加轮次不会自动解决行为覆盖或源码缺陷。

## 用户授权增加轮次后的独立队列

用户授权：“轮次不够可以加”。新预算为 **40 轮 / 48 请求**，输出仍为 **8192 token**，保留独立复核。只选择原轮次已证实受轮次或复核请求预算限制的 `verify-06`、`verify-07`；没有把输出截断样本自动扩入新预算队列。

[40 轮首轮执行 41574308573](https://github.com/chainlesschain/chainlesschain/actions/runs/41574308573)，源码 `98bf47be5a72442cc7e2655dfbf3aebb7770d409`：

- macOS CLI `verify-07` 发出 **17** 次真实模型请求后触发输出截断，独立验收未通过。不能记为轮次耗尽，也不能把它当作零请求启动失败重复运行。
- Linux JetBrains `verify-06` 在模型请求前失败：Java UI 驱动仍限制 deadline 最多 20 分钟，拒绝显式 40 分钟期限。broker 记录 **0** 次物理请求。这是测试框架遗漏，并非模型表现。

修复将 40 轮声明经 adapter、Gradle 传递到 Java 驱动；默认仍限定 20 分钟，显式 40 轮最多 40 分钟。新增离线 Java 边界回归，并在真实 IDE 任务之前执行。

[仅恢复零请求样本的执行 41576842146](https://github.com/chainlesschain/chainlesschain/actions/runs/41576842146)，源码 `cc4cd3180f226a7365f97b26f37a8da3306c1b07`，只补 `verify-06`。清单绑定上次源码与原始 summary/receipt 摘要；任何非零模型请求证据都会拒绝作为启动恢复运行。

修复后 Java 驱动离线回归 **9/9** 通过，真实 IDE 任务与重启检查通过，35/35 次请求用量完整且无代理截断错误。模型返回 success，但写入 `packages/cli/__tests__/integration/verify-06.test.js`，而提示词指定 `packages/cli/__tests__/verify-06.test.js`；因此 `sourceScopePassed:false`、`tool-scope-unverified`。增加轮次消除了本次的迭代耗尽，却没有保证正确交付路径。独立验收最终 **0/1**，指定候选没有有效测试用例；31/31 项基线仍通过，最终生成及验收证据齐全。

[原始请求、模型流、提示词及原生测试日志](budget-retry/host-recovery/details-cc4cd3180f/provenance.json)保留该错误。另存的错路径文件内容逐字节来自 write_file 调用，并与最终工作区树摘要一致；没有移动到指定路径或替换验收候选。

40 轮结果与原 20 轮完整队列分开报告，不合并成统一预算下的新通过率。

| 40 轮目标 | 最终运行 | 独立验收 | 观察到的终止原因 |
| --- | --- | --- | --- |
| macOS CLI `verify-07` | `41574308573` | 0/1 | 17 次请求后触及单次 8192 输出 token 上限 |
| Linux JetBrains `verify-06` | `41576842146` | 0/1 | 35 次请求，模型写错目录；原生 UI 和重启通过，交付范围与候选验收失败 |

## 与 OpenAI Sol 历史结果的关系

仓库任务清单记载的 OpenAI **41/45** 是跨版本累计通过记录（任务 33/36、首次运行 8/9），不是本次 .139 固定预算的新完整单轮结果。后续 OpenAI 独立五项队列也有失败；[既有报告](../verify01-openai-137/README.md)保留这些结果。

本轮能证实 DeepSeek 在该诊断设置下遇到输出上限、轮次/复核预算及交付测试质量问题。它不能单独证明相同版本、相同源码、相同预算下两种模型的能力差距，更不能把认证失败和 UI 驱动失败归因于模型。

## 无效尝试和证据

最早一次认证失败来自执行者误把完整密钥截成内部 UUID；已改为读取整个文件并仅去除首尾空白。这是执行错误。后续另一次只读模型目录预检网络超时发生在生成前。这两次均独立保留，未计入完整 45 个样本结果。完整密钥仅存于专用 Actions secret，现有通用密钥未被替换。

- [完整轮次原始结果](full-e7788a0931/results.json)：包含 42 份归档的摘要与独立 receipt；候选文件由已验证的固定基线补齐，21 份交付 summary 逐字节匹配，[候选索引](full-e7788a0931/candidate-archive-index.json)保留摘要。
- [不可变的生成基线](baseline-e7788a0931/results.json)：用于 40 轮失败样本选择，当时独立验收尚未全部结束，不以它代替最终分数。
- [40 轮首轮原始结果](budget-retry/final-98bf47be5a/results.json)和[零请求启动失败证据](budget-retry/attempt-98bf47be5a/diagnosis.json)。
- [修复启动问题后的最终独立验收](budget-retry/host-recovery/final-cc4cd3180f/results.json)：`completeEvidence:true`，0/1；与已核查的原始交付 summary 逐字节一致。
- [补跑派发记录](budget-retry/host-recovery/dispatch.json)。全部历史派发、无效认证和目录网络失败的记录保留在本目录。

本次工程修改的本地相关 Node 合同测试 **42/42** 通过；补跑 Actions 的 Java 离线驱动回归 **9/9** 和真实 IDE/重启检查通过。模型任务分数仍由独立验收决定。未发布任何包、未合并 PR。
