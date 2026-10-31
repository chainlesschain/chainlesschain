# OpenAI 剩余五项复测结果（CLI 0.166.136）

独立验收：**1/5**；已收集生成 5/5、验收 5/5。五项证据已收齐。

本轮只测上一轮仍失败的五项，已通过的 40 项不重跑。历史结果不改写。跨版本累计：**41/45**，不是新版完整 45 项重跑通过率。

组件：CLI 0.166.136 / Open VSX 0.37.173 / JetBrains 0.4.189 官方 Actions 构建。使用构建包不声称商店已批准。模型：OpenAI / gpt-6.1-sol / Responses。

执行提交：23e26368c81f129d848831bfaed92200cfa9f653。原冻结项目、任务和无模型凭据的 Linux Docker 独立验收保持不变；当前产品工程修复不自动改变冻结项目。

| 样本                    | 入口             | 生成   | 候选行为 | 独立验收 |
| ----------------------- | ---------------- | ------ | -------- | -------- |
| verify-08               | darwin-vscode    | passed | failed   | failed   |
| verify-13               | linux-cli        | passed | failed   | failed   |
| verify-19               | win32-cli        | passed | passed   | passed   |
| verify-36               | darwin-jetbrains | passed | failed   | failed   |
| first-run-darwin-vscode | darwin-vscode    | passed | failed   | failed   |

上游请求 **72**，完整用量 **72**，未知用量 **0**。已知 token 费用估算 **$4.105678**；实际账单未知。

- [darwin-vscode / 41244310370](https://github.com/chainlesschain/chainlesschain/actions/runs/41244310370)：completed / failure
- [linux-cli / 41244319591](https://github.com/chainlesschain/chainlesschain/actions/runs/41244319591)：completed / failure
- [win32-cli / 41244329556](https://github.com/chainlesschain/chainlesschain/actions/runs/41244329556)：completed / success
- [darwin-jetbrains / 41244362320](https://github.com/chainlesschain/chainlesschain/actions/runs/41244362320)：completed / failure

[完整 JSON](results.json)记录原始制品、来源、摘要、候选和验收回执；[CSV](results.csv)提供逐项结果。原始候选不作人工修补。

- verify-08：candidate or baseline regression failed
- verify-13：candidate tests did not reject the behavioral mutant
- verify-36：candidate or baseline regression failed
- first-run-darwin-vscode：candidate or baseline regression failed

临时 GitHub 凭据已在全部生成任务结束后删除并核验不存在。用户本地配置和 Desktop/openai.txt 未修改。原始候选按字节保存为 .txt，防止测试发现器执行。回执及摘要见 archive-index.json。
