# CLI / IDE 原生 36+9 实际任务评测（2026-10-18）

最新版本的逐项交付、验收结果及失败证据见 [最新结果](./LATEST-RESULTS.md)。

状态：**旧版本 45 项记录已归档；最新公开版本补测 IN_PROGRESS**。按用户授权继续测试实际交付与验收，费用未评估、未推算。

## 充值后的两组补测

用户已确认充值，继续沿用既有付费授权。这两组在新增按单项补测入口前已发起，按当时入口各五项运行 Windows VS Code、JetBrains 共 **10 项**（普通 8、独立首次 2）；另 **35 项**沿用既有精确生成与验收。无旧候选种子或修复答案注入。

- 新轮生成 10/10、验收 10/10；账户链路：已有新轮完整 usage 响应，且未观察到本轮欠费拒绝。
- 原先 6 条欠费样本中，已有 6 条在新轮观察到完整模型响应；这只确认实际进入模型执行，不等于候选验收通过。
- 上轮候选 **12/36 + 1/9**、全程 **7/36 + 1/9** 及 6 条欠费原始失败完整保存在 [历史轮次快照](./historical-rounds.json)，不以新结果覆盖其历史判定。
- 按用户新增要求，后续只补失败或未执行样本；已验收通过的产物和收据直接复用，不再重新生成。新增 `sample_ids` 入口支持单项执行与精确验收，使用独立 subset artifact 名称，不混入完整轮次。已启动两组先收取产物；其中 `first-run-win32-vscode` 在这项偏好提出前已被列入，不掩盖这一次重复。
- 入口与来源提交见 [补测清单](./recharge-round.json)。本次额外修复评测驱动器的 init 前退出采证：及时保留真实 exit，并以独立最多 5 秒的只读操作采集原会话 UI 状态；不扩展任务执行期限、不替换被测公开插件。

## 未执行任务的单项诊断

仅对仍未进入模型执行的 Windows JetBrains 首次任务采集缺失的 stderr；不重复另外四项已有候选。补测摘要和文件独立保存在 [单项补测记录](./targeted-retries.json)，不替换本轮 45 条结果。

- `39085805519`：仅 `first-run-win32-jetbrains`；状态 `SUPERSEDED`。来源 `69b00213a75cd9509de63e3c5249291d94fceb76`。
  - 诊断：该次旧包诊断的脱敏 stderr 明确为 owner-only ACL traversal timeout；0 模型请求。不能倒推更早两轮同因。该诊断已被用户最新版本要求取代，真实原始失败不改写。

## 最新公开版本补测（用户更正后）

使用 CLI **0.166.104**、VS Code **0.37.149**、JetBrains **0.4.166**，版本来自本次查询的公开注册表并以 [精确版本清单](../../../verify01-package-sets/2026-10-18-latest.json) 原始字节摘要绑定。仅对 **25 项**未合格或未执行任务发起新模型执行；其余 **20 项历史已验收产物**及收据直接复用。这 20 项不是最新包上的新模型执行，不能将混合来源覆盖率冒充统一最新版本通过率。

最新包生成已收集 **22/25**、独立验收 **22/25**。逐项来源、复用产物和运行状态见 [最新包轮次](./latest-package-round.json)。

| 原生入口         | Run         | 显式待补样本                                                       | 状态        |
| ---------------- | ----------- | ------------------------------------------------------------------ | ----------- |
| linux-cli        | 39087910738 | verify-04, verify-13, first-run-linux-cli                          | COMPLETED   |
| linux-vscode     | 39087921211 | verify-05, verify-14, verify-23, verify-32, first-run-linux-vscode | COMPLETED   |
| linux-jetbrains  | 39087930713 | verify-06, verify-33, first-run-linux-jetbrains                    | COMPLETED   |
| darwin-cli       | 39087938110 | verify-07, verify-25, verify-34, first-run-darwin-cli              | COMPLETED   |
| darwin-vscode    | 39087946196 | verify-08, first-run-darwin-vscode                                 | COMPLETED   |
| darwin-jetbrains | 39087957391 | verify-09, first-run-darwin-jetbrains                              | COMPLETED   |
| win32-cli        | 39087878780 | verify-10, verify-19                                               | COMPLETED   |
| win32-vscode     | 39087886976 | verify-11                                                          | COMPLETED   |
| win32-jetbrains  | 39087898779 | verify-12, verify-30, first-run-win32-jetbrains                    | IN_PROGRESS |

最新补测目前候选合格 **5/25**、全程通过 **4/25**；连同 20 项历史复用，累计已有 **25/45** 项合格交付。该累计覆盖不表示 45 项均在最新包上重新执行或全流程通过。

| 任务类别     | 历史合格复用 | 最新补测新增合格 | 累计合格交付 |
| ------------ | ------------ | ---------------- | ------------ |
| 普通任务     | 18           | 5/18             | 23/36        |
| 独立首次任务 | 2            | 0/7              | 2/9          |

累计覆盖包含不同版本与多次尝试，保留全部历史失败，不作为单轮或统一最新版本的成功率。

## 固定旧版本对照轮次（已归档）

本轮从各真实入口执行 36 项原始项目任务及 9 次独立首次安装项目任务。每次 first-run 使用独立安装流程、profile、workspace 和 run ID；同层普通任务不能替代它。九入口的 nonce 冒烟结果另列保存。

| 样本         | 候选通过独立验收 | 生成、宿主与验收全程通过 |
| ------------ | ---------------- | ------------------------ |
| 普通任务     | 17/36            | 9/36                     |
| 独立首次任务 | 1/9              | 1/9                      |

已收集当前指定轮次生成 45/45、验收 45/45。未收齐时，上表仅是当前观察值。

各入口下列三项依次为：生成通过 / 候选验收通过 / 全程通过。生成包含真实模型终态、工具范围、来源范围、代理状态，以及 IDE 的 UI 观察和重启恢复；候选验收在重建的冻结项目上执行。

| 原生入口         | 普通任务（各 4 项） | 独立首次任务（各 1 项） |
| ---------------- | ------------------- | ----------------------- |
| win32-cli        | 4/4 / 2/4 / 2/4     | 1/1 / 0/1 / 0/1         |
| win32-vscode     | 3/4 / 3/4 / 2/4     | 1/1 / 1/1 / 1/1         |
| win32-jetbrains  | 0/4 / 2/4 / 0/4     | 0/1 / 0/1 / 0/1         |
| linux-cli        | 2/4 / 2/4 / 1/4     | 1/1 / 0/1 / 0/1         |
| linux-vscode     | 4/4 / 0/4 / 0/4     | 1/1 / 0/1 / 0/1         |
| linux-jetbrains  | 0/4 / 2/4 / 0/4     | 0/1 / 0/1 / 0/1         |
| darwin-cli       | 2/4 / 1/4 / 1/4     | 1/1 / 0/1 / 0/1         |
| darwin-vscode    | 3/4 / 3/4 / 3/4     | 0/1 / 0/1 / 0/1         |
| darwin-jetbrains | 0/4 / 2/4 / 0/4     | 0/1 / 0/1 / 0/1         |

精确逐项结果见 [CSV](./native45-latest-results.csv)，完整失败、基线、候选测试与行为变异控制记录见 [results.json](./results.json) 及其引用的原始压缩摘要。即使候选文件合格，网络失败、越界变化、宿主或恢复失败仍阻止全程通过。

## 轮次与历史

- 较早的 Linux CLI 36 项诊断：首次 **8/36**，含已记录的有界修复 **11/36**。它与本次九原生入口的 36+9 分开。
- 原生第一轮 `39051952884`：候选 **4/36、0/9**，全程 **2/36、0/9**；旧失败及原始判定均保留。
- 当前指定轮次：`win32-cli`=`39057575738`；`win32-vscode`=`39081688535`；`win32-jetbrains`=`39082074376`；`linux-cli`=`39051952884`；`linux-vscode`=`39055183659`；`linux-jetbrains`=`39055189152`；`darwin-cli`=`39051952884`；`darwin-vscode`=`39055183659`；`darwin-jetbrains`=`39055189152`。本轮 Windows 两个 IDE 入口重新执行，其余七组沿用精确绑定的既有生成；不是 45 条全部新执行。
- [独立来源审计](./native45-independent-audit.json) 分别记录首轮原判定、独立复核、历史累计和当前指定轮次。验收只按生成摘要 SHA-256 和 sample ID 关联；当前轮缺项不以旧通过填充。历史累计代表多次尝试后的覆盖，不是单轮成功率。

## 已定位并修复

1. Windows GNU tar 误解析盘符：使用原生 Windows tar。
2. VS Code 测试 relay 的 512 字符限制：完整原始提示经真实 webview textarea/input/send 提交，并比对 raw CLI input。
3. 持久 IDE 正常 `result` + `system/end` 被旧 checker 误判：严格校验唯一相邻终态、session、trace、turn 和 seq；原始流及旧失败不改写。
4. 缺少标准 Windows profile 目录导致 PowerShell 缓存污染工作区：建立 AppData 目录并使用绝对缓存路径，保留来源范围限制。
5. 长 SSE 响应撞 1 MiB 诊断传输上限：原生评测显式使用 16 MiB，上游输出上限仍为 8192 token、24 请求、180 秒。未知用量仍停止代理，不自动 HTTP 重放。
   Windows tar 文件名编码也已修复；旧产物按原始归档 header/PAX 信息核验完整树后，可在规范冻结源码上单独验收候选，其初始路径错误仍阻止全程通过。详见 [真实 CI 归档核对](./windows-archive-proof.json)。
6. 产品源码：JetBrains Markdown 历史恢复、CLI 延迟写入未执行却报告完成、上游 aborted 被误判用户中断。分别有 21 项 JUnit、22 项 focused Vitest、9 项中断回归通过；产品修复尚未发布，本轮仍使用下述公开版本。

完整提交 SHA、验证收据和优化边界见 [optimization-validation.json](./optimization-validation.json)。单元回归不替代修复版本的真实 GUI / 模型复测。

## 交付质量诊断

[Linux VS Code 五项逐一复核](./linux-vscode-task-quality-review.json) 已比对候选、checker receipt 与冻结源码：五项基线全部通过，候选真实落盘，23 个已执行测试中 15 过、8 败，另 6 个测试体被导入错误阻止执行。行为变异阶段均未进入。

| 样本           | 已证实的候选错误                                 |
| -------------- | ------------------------------------------------ |
| 首次 verify-05 | 调用不存在的 `createAgentRouter`，并误读返回结构 |
| 普通 verify-05 | `_runSingleTask` 少传独立 backend 参数           |
| verify-14      | 相对导入多退一层，未执行候选测试                 |
| verify-23      | 缺少 maintenance 证据，却断言完整 baseline 成功  |
| verify-32      | 忽略帧延迟最小 20ms，提前推进计时器              |

JetBrains 存在候选通过但重启恢复失败的情况，不能按文件通过数宣称插件完成任务。部分样本仍遇 8192 token 输出截断；传输上限修复不等于输出截断已解决。

[充值前 Windows JetBrains 首次任务复核](./windows-jb-latest-readiness-review.json)：准备构建、CLI 版本检查与配置读取均成功；聊天子进程在 init 前以 1 退出，模型请求为 0。真实 JSONL 有一条 exit，旧采证的 `0 !== 1` 不等于零协议。聊天 stderr 未被原公开插件接收并归档，底层退出原因仍未知；不能直接归因于 ACL 或 Station 警告。JSONL 采证修复已提交，但不会升级该轮启动失败。

[充值后 VS Code `verify-20` 终态复核](./recharge-vscode-final-error.json)：候选已通过独立验收，但 CLI 最终返回 `fetch failed`，原生全程保持失败。代理记录 5 次完整 usage 响应且未拒绝账户；底层网络原因仍未知。模型错误后没有进入恢复阶段，不能仅据缺少重启文件判定为 IDE 恢复缺陷。按用户要求复用合格候选，不为此终态错误重复生成。

[充值后 JetBrains 复核](./recharge-jetbrains-review.json)：四项普通任务共 32 次完整模型响应；重启后会话、保存行和原始 Markdown 均保留，但界面直接显示 Markdown 源文，与实时渲染不同。该公开版历史渲染缺陷已在源码修复，本轮仍保持恢复失败。首次任务仍是初始化前 exit 1、0 请求；底层原因待独立 stderr 采证，不根据相同症状断言同一根因。

充值后 JetBrains 的候选质量按 [原始验收收据](./recharge-checker-receipts.json) 单独判定：`verify-03/21` 合格并直接复用；`verify-12` 基线 11/11，候选 5/6，错误地期待 `stripFirstTurnPromptArgv` 删除应保留的 `--session`，这是候选断言错误；`verify-30` 基线 13/13、候选 6/6，检出帧计数变异，但第二个“忽略动画 fallback 画布像素”的变异仍 6/6 通过。其 GIF 用例没有覆盖 APNG 额外 fallback 画布，不能把检出第一个变异当作完成全部行为验收。以上复核仅使用已有源码与收据，没有重新执行任务或测试。

## 后续优化顺序

1. 候选质量：先核对真实 API、导入路径、fixture 与计时约束，再验证测试能拒绝任务要求的错误行为。`verify-10/13/19` 自身测试通过但行为变异存活，仍是未合格交付。
2. JetBrains 恢复：`verify-15/24/18/27` 候选及行为变异验收通过，却因重启 UI 失败未完成全程；优先复测已修历史恢复逻辑，避免把合格文件重新生成当作恢复验证。
3. 完成边界：对 `verify-04/07/08/33/36` 与 macOS VS Code 首次任务的输出截断，验证更小的分块写入与落盘回读；对 `verify-34` 的延迟写入未执行，复测已修完成保护。修复源码的单元测试不能替代真实入口复测。

## 证据与边界

- 冻结项目：`b2aa3aba082873570e85dce39b00754e5504ff37`；计划 digest：`sha256:04b90d1a93cfd6556f91688a39508c69e4423671a7b6bcb85fac4dc7e82c0e13`。
- 固定旧版本对照轮公开版本：CLI `0.166.99`、VS Code `0.37.143`（host `1.132.0`）、JetBrains `0.4.161`（IntelliJ `2025.2`）；模型为 `volcengine/deepseek-v4-flash-ga-260731`，Node `22.12.0`。
- 这是 thinking disabled、六文件工具的诊断；Windows 使用 hosted runner。生成在原生系统完成，所有候选执行验收均在 Linux、无网络 Docker 中完成，不表示 Windows/macOS 原生测试通过。
- 通过候选与收据按原始字节校验 SHA-256，分别归档到 [原生候选索引](./native-verified-deliveries.json) 和 [较早 Linux 诊断索引](./verified-deliveries.json)。归档测试追加 `.txt`，避免测试发现；内容与 digest 保持不变。
- [所有已收集原生候选](./native-candidates.json) 同时保留失败文件和未改动占位，不能视作通过列表。证据完整性可用 `node verify-evidence.mjs` 在此目录离线核验。
- 冻结 observations 保持 **0/36、0/9**，`paidReady:false`。未作正式准入、生产或发布背书。
