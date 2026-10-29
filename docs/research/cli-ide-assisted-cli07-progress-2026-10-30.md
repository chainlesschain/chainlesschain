# verify-07 持久正文分页：辅助交付与独立复验

截至 2026-10-30，人工辅助编写的 4 个分页回归已通过原 Docker checker，并已由主执行者格式化后安装到 `packages/cli/__tests__/verify-07.test.js`。这不是原自动任务成功，也不是完整 macOS 安装旅程验收；原累计交付仍为 **34/45**。

## 实际云端结果

- [GitHub Actions run 40916508225](https://github.com/chainlesschain/chainlesschain/actions/runs/40916508225)，attempt 1，结论 `success`。
- 隔离标签 `ci-cli07-assisted-20261030-v1`，执行源码 `a3b838bc70f1b5ced39b53eb4c2633dfe350357e`。
- 原冻结项目 `b2aa3aba082873570e85dce39b00754e5504ff37`；镜像 `node:22.12.0-bookworm`，固定 image ID `sha256:344dbe71e1c47a59db0e94bebdcc94ef3a7bc8bd828393c820168993539048da`。
- 实际 artifact `12915603297` 已下载并按原字节归档。GitHub 元数据中的 ZIP digest 为 `sha256:0fb7a22fc2d12a099134186e1acbf428cf47be835a971cd96409b0c2931866d5`；本归档核验的是解压文件，未声称重新计算 ZIP 摘要。

| 阶段                            | 真实结果                                                                      |
| ------------------------------- | ----------------------------------------------------------------------------- |
| setup                           | 原基线 39/39                                                                  |
| 原 27 字节占位交付复现          | 基线 39/39，候选无有效测试；`acceptance requires executed test cases`，仍失败 |
| 辅助交付                        | 原基线 39/39，新增 4/4                                                        |
| `repeat-before-cursor-boundary` | 4 条中 1 条失败，拒绝重复边界                                                 |
| `skip-after-cursor-first-row`   | 4 条中 2 条失败，拒绝漏掉第一条新增正文                                       |

原 setup/check 脚本与原 run `40905249327` 的归档 `scriptDigest` 完全一致。没有修改 checker 语义、原行为变异或生产源码。4 个用例覆盖反向跨页首尾 cursor、追加分页的首条和最终完整正文、整页尾部终止、空及单行历史。

## 归档与复核

证据目录：[`evidence/native131-assisted-install-2026-10-30/verify07/`](evidence/native131-assisted-install-2026-10-30/verify07/)。`review.json` 索引 32 份真实记录，包括原失败回执、原验收摘要、此次各阶段回执和原始 stdout、artifact 元数据及运行观察。`corrected-verify-07.test.js` 保留云端实际候选字节，`repair.patch` 记录替换占位文件的辅助修改。

```sh
node docs/research/cli/evidence/native131-assisted-install-2026-10-30/verify07/verify-evidence.mjs
```

复核已返回 `VERIFIED`：校验压缩前后摘要与长度、实际 run/source/tag、冻结 Git 文件、隔离执行源码的 payload 字节、原 checker 摘要、回执摘要，以及基线/候选/两次变异的实际测试输出与退出码。

## 安装与边界

主执行者已将候选仅经 Prettier 格式化后安装到 main 工作区，并将 verify-07/09/10 加入 CLI CI 三系统 `verify-cli` 定向步骤。已核对安装文件与归档候选格式化后等价。记录时 HEAD 仍为 `44fd177967e498707ae904fd2efed7a78f2045fb`，安装属于未提交修改；当前 main Windows 相关 6 文件回归尚待主执行者回报结果，不能以冻结项目结果替代。

当前 main 的历史投影模块及相关依赖与冻结项目并非相同字节：包括 `tool_round` 投影和向 `contextItemsToMessages` 传递 sessionId 等后续改动。未声明整个依赖闭包等价。

本轮无新增模型请求，未变更原 native 失败结果、任务 ledger、原预算或累计 34/45。付费与原生生产就绪状态不因本辅助测试改变；本归档步骤未 push、dispatch 或发布软件。
