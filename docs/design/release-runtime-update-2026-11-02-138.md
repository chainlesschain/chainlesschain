# CLI .138：源码交付、任务保留与公开包复验

## 代码与发行基线

本次根据 `main@94b6bd418eb58993919e1d2154c4504210438668` 的代码、Git 记录及不可变发行/验收回执核对，日期为 **2026-11-02**。

| 组件                  | 版本       | 来源与状态                                                                                                              |
| --------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------- |
| Agent SDK             | 0.2.17     | `e42ea07b6d`；先于 CLI 通过 Actions OIDC 发布，公开字节与签名来源已核验                                                 |
| CLI                   | 0.166.138  | 同一发行源；三平台 CLI CI 的 75 项必需任务与 Strict Sandbox 6/6 通过，公开安装、启动、字节与签名已核验                  |
| Open VSX              | 0.37.174   | 同一发行源；正式发布工作流及公开 VSIX 核验通过，推荐 CLI 0.166.138                                                      |
| JetBrains             | 0.4.191    | `ef13d5238e`；完整发布工作流成功，Marketplace 已批准上架（update 1209507）；公开 ZIP 负载核验待完成，推荐 CLI 0.166.138 |
| Context/Memory Kernel | 0.1.11     | 保持已发布依赖版本                                                                                                      |
| PC / 移动客户端       | v5.0.3.143 | 独立发行源 `036d2b8be2`，不从 CLI 发布推断客户端变更                                                                    |

CLI 来源固定为 `e42ea07b6da7ab2c3eb709002448b32d5fedf535`。SDK .17 修正整棵源码树与发布来源的对应关系，生成的运行时代码没有改变。Microsoft Marketplace 继续暂缓。见[发行回执](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/release138-public/README.md)与[正式 OIDC 工作流](https://github.com/chainlesschain/chainlesschain/actions/runs/41313099948)。

## 源码读取与模型交付

`65651c7a06` 修复工具已经读取文件、但该源码在模型请求中被省略后仍被误记为已读的问题。读取覆盖只有在对应源码片段确实选入 provider 请求后才确认；未交付片段保留恢复机会，重复交付失败返回明确限制。读取到文件末尾不能作为用户任务完成的证明。

`5f372b3aa6` 扩展已验证 JavaScript 源码在证据投影中的保留路径，避免支持范围内的源码表达式被当作不合法 JSON 而丢失。无法证明的局部片段仍可能省略；原始工具参数 JSON、重复键检查、敏感信息处理与预算限制继续有效，不能推断任意 JavaScript 都能完整投影。

## 压缩与原始任务身份

`b749852179` 在 canonical compaction、工具尾部和持久会话中保留原始用户任务。压缩摘要和继续执行提示不替代原任务合同；规划上下文仍受预算约束。本轮复验保持 **32768 tokens** 的规划上下文与原始任务、基线、行为变异和输出路径，不通过放宽合同取得成功。

## 已合入但尚未发行的 WebSocket 修复

`2e97ce3d797bfdc03aba59834734da2a916b8774` 为独立 `ChainlessChainWSServer` 补充宿主模型策略：未传入模型准备钩子或 Evolution composition factory 时，按 `projectRoot` 调用 `prepareConfiguredUiModelTurn`。显式钩子/factory（包括 `null`）保持优先。

该提交晚于公开 CLI .138 的发行源，**未进入 npm 0.166.138**。它需要下一版精确提交的完整 CLI CI、Strict Sandbox 与 OIDC 发布，不能因主分支已有实现就宣称用户安装的 .138 已包含修复。

## 公开包四项复验

本轮使用公开 CLI **0.166.138**、Open VSX **0.37.174** 和 JetBrains **0.4.191** 官方待审侧载构件，跳过 .136 已通过的 verify-19，只复验四项。启用 `review_changes=true`，保留原预算，使用原任务、基线和行为变异进行独立 Linux Docker 验收。

| 样本                    | 独立候选测试 | 行为变异检出 | 模型终态               | 本轮最终结果 |
| ----------------------- | ------------ | ------------ | ---------------------- | ------------ |
| first-run-darwin-vscode | 5/5          | 1/1          | success                | 通过         |
| verify-13               | 12/12        | 2/2          | success                | 通过         |
| verify-08               | 3/3          | 1/1          | error_max_turns，20/20 | 失败         |
| verify-36               | 23/23        | 1/1          | error_max_turns，20/20 | 失败         |

独立候选测试通过不等于端到端通过：后两项在作者阶段耗尽轮次，`changeReview.observed=false`，尚未进入独立审阅。局部源码交付有额外开销的证据，但不足以认定其是完整根因，也没有证据证明旧 review-budget WIP 能解决本轮问题。

本轮为 **2/4**，前轮 .137 为 **0/5**，历史累计记录仍为 **41/45**，图像单项复验 **0/1** 单列；不能合并为某一版本完整 45 项通过率。80/80 个物理请求的用量完整，token 估算 **$2.6309597**，实际账单未知。后续已通过项跳过；本次文档更新没有再次调用模型。

[原始复验记录](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/verify01-openai-138/README.md) · [机器可读结果](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/verify01-openai-138/public-c472d664eb/results.json) · [失败诊断](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/verify01-openai-138/public-c472d664eb/failure-audit.json)。

## 文档与部署边界

`docs/design/` 是设计源；用户站 `docs-site/docs/design/` 与设计站 `docs-site-design/docs/` 通过现有同步脚本生成。用户升级指南、官网中英文版本数据、README 与导航共同引用本次范围。三站部署校验新构建、哈希与版本，保留旧站点备份和失败回滚，完成后分别检查源站与公网。

**NOT_PAID_READY / NOT_ADMITTED / HOLD** 保留。工程回归、发行成功与站点部署均不增加模型任务验收数。

- [用户升级指南](https://docs.chainlesschain.com/chainlesschain/cli-ide-update-2026-11-02-138.html)
- [CLI Runtime 当前架构](./cli-runtime-current.md)
- [.132 响应终态设计](./release-runtime-update-2026-10-30-132.md)
