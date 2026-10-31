# OpenAI 上轮 6 项失败重测结果

本轮 **1/6** 通过独立验收，生成已收集 6/6、验收已收集 6/6。六项证据已收齐。

仅重测上轮失败的六项，已通过的 39 项没有重复调用。上轮原始 39/45 不改写；跨版本累计为 **40/45**，它不是新版完整 45 项重跑的通过率。

CLI **0.166.135** 与 Open VSX **0.37.173** 为已核验公开包；JetBrains **0.4.189** 使用通过完整发布门禁、来源和 ZIP 哈希核验的官方 Actions 构建包，**不声称商店已批准**。模型为 **OpenAI / gpt-6.1-sol / Responses**。

执行源码：`99b93fc209678e5e372ec8673e2b9ec31c0bd762`。包清单摘要：`sha256:c0d5db91c1b141258edf768126929049252d2d40b7d4ff59348c385de5bf4599`。原冻结项目、任务及无模型凭据的 Linux Docker 独立验收保持不变；生成成功不等于验收通过。

| 样本                    | 宿主入口         | 生成 | 候选行为检查 | 独立验收 |
| ----------------------- | ---------------- | ---- | ------------ | -------- |
| verify-08               | darwin-vscode    | 通过 | 失败         | 失败     |
| verify-13               | linux-cli        | 通过 | 失败         | 失败     |
| verify-19               | win32-cli        | 通过 | 失败         | 失败     |
| verify-26               | darwin-vscode    | 通过 | 通过         | 通过     |
| verify-36               | darwin-jetbrains | 通过 | 失败         | 失败     |
| first-run-darwin-vscode | darwin-vscode    | 通过 | 失败         | 失败     |

已记录 **100** 个上游请求，完整用量 **100** 个，未知用量 **0** 个。已知 token 费用估算 **$5.880530**；实际账户账单未知，未报告的缓存写入与其他费用未计入。它不是账户硬额度或正式生产准入。

## 运行与证据

- [darwin-vscode / 41175026100](https://github.com/chainlesschain/chainlesschain/actions/runs/41175026100)：`completed` / `failure`。
- [linux-cli / 41175056046](https://github.com/chainlesschain/chainlesschain/actions/runs/41175056046)：`completed` / `failure`。
- [win32-cli / 41175285091](https://github.com/chainlesschain/chainlesschain/actions/runs/41175285091)：`completed` / `failure`。
- [darwin-jetbrains / 41175292378](https://github.com/chainlesschain/chainlesschain/actions/runs/41175292378)：`completed` / `failure`。

[完整 JSON](results.json)记录来源、摘要绑定、独立检查、候选变异、终态和用量；[CSV](results.csv)提供逐项统计。原始制品链接、归档摘要、生成/验收摘要 SHA-256 和到期时间列于 JSON。历史失败候选没有人工修补，也没有把未运行的样本记为成功。

- **verify-08**：candidate or baseline regression failed
- **verify-13**：candidate tests did not reject the behavioral mutant
- **verify-19**：candidate tests did not reject the behavioral mutant
- **verify-36**：candidate or baseline regression failed
- **first-run-darwin-vscode**：candidate or baseline regression failed

## 失败原因复核

| 样本                    | 独立验收事实                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------------- |
| verify-08               | 原基线 58/58 通过；生成候选 3/3 失败，涉及 fork 祖先历史投影与 capability 拒绝边界。      |
| verify-13               | 原基线 13/13、候选 6/6 通过，但行为变异未被识别，不能计为任务成功。                       |
| verify-19               | 原基线 17/17、候选 3/3 通过，但行为变异未被识别，不能计为任务成功。                       |
| verify-26               | 生成终态、宿主退出、基线、候选和独立行为控制全部通过。                                    |
| verify-36               | 原基线 7/7 通过；候选 6 条中 4 条失败，涉及空白名单、MCP/插件限制和非法持久化值的拒绝。   |
| first-run-darwin-vscode | 原基线 58/58 通过；独立首次运行候选 4 条中 2 条失败，涉及 capability 绑定和真实历史导入。 |

verify-36 仍在原冻结项目上验收，允许交付的范围是候选测试，不能修改生产实现。新 CLI 作为执行宿主的修复不会自动覆盖冻结项目；本轮结论描述模型在该任务上的交付，不可直接称为公开 CLI 0.166.135 对应修复的产品回归。原冻结项目提交见 JSON 的 `projectCommit`。

## 运行时协议与凭据

实际请求原件中检查了 100 个请求：94 个含工具结果，70 个回放 reasoning，空 summary 出现 349 次，缺失 summary 0 次。这些属于本轮 100 次调用，不是额外付费任务。

本轮临时 repository secret 已在全部生成作业结束后删除并核验不存在；[清理回执](secret-cleanup.json)不含凭据，本地配置未改动。原始候选以 .txt 后缀按字节保存，避免被仓库测试发现器执行；[归档索引](archive-index.json)绑定原路径和摘要。未人工修补任何候选，也未重复运行已完成的付费样本。
