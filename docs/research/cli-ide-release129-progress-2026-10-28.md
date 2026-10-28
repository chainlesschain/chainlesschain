# CLI 0.166.129 与 IDE 发布进度（2026-10-28）

用户已授权本轮必需测试通过后发布 CLI 与 IDE 插件，并允许先发布、后合并。移动与 PC 客户端不在本轮范围内。

## 当前状态

- CLI 候选：`0.166.129`，准确提交 `fd8a21637ab188dae0c777442d312ae85d420a9b`，PR [#506](https://github.com/chainlesschain/chainlesschain/pull/506)。
- 不可变标签：`v-npm-0-166-129`；正式 [OIDC 发布工作流 40693655894](https://github.com/chainlesschain/chainlesschain/actions/runs/40693655894) 已启动，等待准确提交的完整发布检查；启动工作流不等于已公开。
- [CLI Strict Sandbox 40679324803](https://github.com/chainlesschain/chainlesschain/actions/runs/40679324803) 已成功；[CLI CI 40679324623](https://github.com/chainlesschain/chainlesschain/actions/runs/40679324623) attempt 2 已成功（72/72），三系统矩阵完整通过。
- [IDE Extensions 40679324574](https://github.com/chainlesschain/chainlesschain/actions/runs/40679324574) 在 CLI 候选提交上成功。新版插件提交需要自己的准确源码检查。
- IDE 候选：VS Code `0.37.167` / JetBrains `0.4.184`，推荐 CLI `0.166.129`；准确提交 `800e9cc99711f9f02eb3bbd78eb14600406bdba5`，PR [#507](https://github.com/chainlesschain/chainlesschain/pull/507)。[IDE 候选检查 40694534085](https://github.com/chainlesschain/chainlesschain/actions/runs/40694534085) 已成功（18 项通过，发布后回读作业按候选事件跳过）；旧候选因 README 兼容段落版本滞后而停止，修正后版本元数据、能力清单与 fixture 校验均通过。尚未创建插件发布标签。
- 公开版本仍为 CLI `0.166.128`、Open VSX `0.37.166`、JetBrains `0.4.183`。Microsoft Marketplace 缺少 `VSCE_PAT`，仍未发布。

## 发布顺序与验证

1. 十个直接子 npm 依赖的准确版本与公开归档已逐个抓取并验证 SHA-512；对应子包源码相对上一轮 CLI 发行提交未变，沿用已发布版本。
2. CLI 通过准确提交的 Linux / Windows / macOS CLI CI 与 Strict Sandbox 后，由现有 Actions OIDC 工作流发布。随后验证公开归档、不可变 CI 制品一致性、npm provenance 和全新公开安装。
3. CLI 公开验证完成、插件准确源码检查通过后，依次创建插件不可变标签，验证 Open VSX VSIX 与 JetBrains 公开审核、上架和 ZIP 内容。
4. 合并发布 PR 与包含实际版本、配套、安装命令、限制和回执的公开文档。

## 已完成本地验证

CLI 八个 changelog / release-contract 测试文件，83 项通过；插件 Marketplace overview 校验、CLI 升级推荐和发布契约定向测试通过，公开 CLI 前置条件测试 14 项通过；两个候选均通过 `git diff --check`。本地检查是补充，不能替代 Actions 完整矩阵。

历史任务累计交付验收仍为 **34/45**。任务验收、完整原生 E2E、构建和发布检查分别记录，不能互相替代；发布成功不表示 45 项全部完成。
## 首轮 CI 安装失败与恢复

CLI CI 首轮 Linux E2E 分片在依赖安装阶段因 node-pty 的 Node 头文件下载/解压失败，三次安装均未成功；E2E 未执行，不计通过。保留失败日志与完整作业记录后结束第一轮，GitHub 已接受相同源码的失败及未完成作业重跑（attempt 2）。第二轮最终 72/72 通过，三系统矩阵完整。发布工作流首轮因原 CI 取消而被准确提交门禁拦截，尚未上传 npm；双门禁完整通过后，发布工作流 attempt 2 已于 2026-10-28T15:52:50Z 被接受，正在从同一不可变标签恢复打包和发布；此时尚未确认 npm 公开。
