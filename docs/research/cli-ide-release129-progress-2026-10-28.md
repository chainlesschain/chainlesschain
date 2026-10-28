# CLI 0.166.129 与 IDE 发布进度（2026-10-28 准备，2026-10-29 发布）

公开归档核对时间：2026-10-28T18:02:52.286732Z；2026-10-29 同步此前未提交的发布记录。用户已授权本轮必需测试通过后发布 CLI 与 IDE，并允许先发布、后合并。本轮不包含移动或 PC 客户端发行，Microsoft 渠道按用户要求暂缓。

## 当前状态

CLI、Open VSX 与 JetBrains 均已公开并完成限定范围的归档回读；真实任务及原生旅程继续单独验收。

| 渠道 | 版本 | 状态 |
| --- | --- | --- |
| npm CLI | 0.166.129 | 已公开并验证下载 |
| Open VSX | 0.37.167 | 已公开并验证下载 |
| JetBrains | 0.4.184 | 已批准、列出且未隐藏；公开 ZIP 已回读 |
| Microsoft Marketplace | — | 按用户要求暂缓，本轮不做；仍未发布 |

[完整公开回执](./cli/evidence/release129-public/publication.json)记录准确提交、运行、归档哈希及公开下载结果。

## CLI 证据

- 准确源码：`fd8a21637ab188dae0c777442d312ae85d420a9b`；不可变标签 `v-npm-0-166-129`；PR [#506](https://github.com/chainlesschain/chainlesschain/pull/506)。
- [CLI CI 40679324623](https://github.com/chainlesschain/chainlesschain/actions/runs/40679324623) attempt 2 最终 **72/72** 成功；[CLI Strict Sandbox 40679324803](https://github.com/chainlesschain/chainlesschain/actions/runs/40679324803) 成功。准确提交的 Linux、Windows、macOS 双门禁完整，通过记录见 [gates.json](./cli/evidence/release129-public/gates.json)。
- [正式 OIDC 发布 40693655894](https://github.com/chainlesschain/chainlesschain/actions/runs/40693655894) attempt 2 成功；[独立公开回读 40723568902](https://github.com/chainlesschain/chainlesschain/actions/runs/40723568902) 成功。
- 公开 npm 归档 **9,566,651** 字节，SHA-256 `88958be9e818f6e38db66faa0808fad28afa7f652b9a2c81c1dedc4f8be8f11b`，与不可变 CI 制品逐字节一致；签名来源与十个直接子依赖均已核验。所需子包源码相对上轮未变，沿用已公开版本。
- Open VSX 上传前已完成 CLI 0.166.129 的全新公开安装，十个子依赖均来自官方 registry，版本及能力探测成功；见[前置安装回执](./cli/evidence/release129-public/ide-vscode-cli-prerequisite.json)。

## IDE 证据

- 准确源码：`800e9cc99711f9f02eb3bbd78eb14600406bdba5`；PR [#507](https://github.com/chainlesschain/chainlesschain/pull/507)。候选 [IDE Extensions 40694534085](https://github.com/chainlesschain/chainlesschain/actions/runs/40694534085) 成功（18 项通过；发布后 Marketplace 核验按候选事件跳过）。
- VS Code 标签 `ide-vscode-v0.37.167`；[正式工作流 40724836985](https://github.com/chainlesschain/chainlesschain/actions/runs/40724836985) 成功。Open VSX 已列为 latest，公开 VSIX 与不可变 CI 制品的 SHA-256 均为 `daa1dfc582631c645037bac9720d26d5669ca5a47ba78075e9fac82535a375c8`。公开下载核验由正式 Linux 发布作业完成，其回执与本地 CI 制品哈希交叉一致；见 [open-vsx.json](./cli/evidence/release129-public/open-vsx.json)。
- JetBrains 标签 `ide-jetbrains-v0.4.184`；准确提交的[正式工作流 40724923599](https://github.com/chainlesschain/chainlesschain/actions/runs/40724923599)已成功。公开更新 `1205524` 已批准、列出且未隐藏；[公开归档回读](./cli/evidence/implementation-plan-2026-10-15/task-campaign-2026-10-18/next-package-128-review-20261028/supersession/package-readback.json)确认全部 ZIP 成员字节与 CI 制品一致。公开 ZIP SHA-256 为 `eed876bdf005856215200a353af952a76234ea5e62043d0b23b6dc1b3cf4ffe3`；ZIP 容器字节与 CI 不同，不能声称整包逐字节相同。该回读没有执行下载包。

## 保留的失败与恢复记录

CLI CI 首轮 Linux E2E 分片在依赖安装阶段因 node-pty 的 Node 头文件下载/解压失败；三次安装均未成功，E2E 未执行，不能计通过。保留原始失败作业 [122792731139](https://github.com/chainlesschain/chainlesschain/actions/runs/40679324623/job/122792731139) 与完整作业快照后结束首轮，只重跑相同源码的失败及未完成部分；第二轮最终 72/72 成功。

发布工作流首轮因原 CI 取消而被准确提交门禁拦截，未上传 npm。只有完整双门禁成功后，才恢复同一不可变标签的发布工作流 attempt 2。插件早期候选的 README 兼容段落版本滞后也在创建发布标签前修正；准确提交 800e9cc997 的元数据、能力清单、宿主矩阵和发行工作流分别记录。未降低测试、预算或验收要求。

## 安装与验收范围

安装：`npm i -g chainlesschain@0.166.129 --registry https://registry.npmjs.org`。升级插件后重启 Agent 会话，核对实际 CLI 路径，运行 `cc --version` 与 `cc doctor`。当前公开配对为 `.129 / .167 / .184`；包 README、根 README 与公开升级指南的整体一致性继续按主差距表跟踪。本记录不把后续 Goal、Memory 或 Terra 源码修复计入已发布的 `.129`。

历史累计交付验收仍为 **34/45**（普通 **27/36**、首次 **7/9**），剩余 **11** 项；不是 CLI .129 单轮模型任务成功率，也不等同于完整原生 E2E。**NOT_PAID_READY / NOT_ADMITTED / HOLD** 保留。默认关闭的交付复查和实验性 Codex App Server 路由继续保留各自限制，版本探测不表示生产准入。本轮发布成功不代表历史 45 项全部完成。
