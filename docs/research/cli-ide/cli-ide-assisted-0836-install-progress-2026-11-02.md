# verify-08 / 36 辅助回归接入与状态续做

日期：2026-11-02。将 `.139` 已独立验收的两份辅助修复候选安装为 `packages/cli/__tests__/verify-08.test.js`、`verify-36.test.js`，仅经仓库 Prettier 格式化。已安装辅助回归从 **5 项增至 7 项**，CLI CI `verify-cli` 的 Linux / Windows / macOS 定向步骤均已纳入七项。

| 交付           | 覆盖与验证                                                                                                        | 原独立验收                                                                                                                                     |
| -------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| verify-08      | 持久历史祖先的来源字段、子会话显示身份、两个分支正文隔离；合法 capability 及错误父会话、上下文、伪造、过期负例    | 原候选 **3/3**，原 wrong-parent 行为变异检出 **1/1**；[41451396249](https://github.com/chainlesschain/chainlesschain/actions/runs/41451396249) |
| verify-36      | 八项预算逐字段验证；null/缺省正对照；磁盘往返恢复空白名单、权限、沙箱；具体 argv 及指纹；非法策略和列表拒绝       | 原候选 **17/17**，原权限放宽行为变异检出 **1/1**；[41453819130](https://github.com/chainlesschain/chainlesschain/actions/runs/41453819130)     |
| 当前工作区     | 七项辅助测试、既有分支归属与启动策略基线、发行 workflow 合同，**10 文件 84/84，零失败、零跳过，exit 0**           | Windows / Node **22.22.2** / Vitest **4.1.10**，使用仓库原配置与 setup                                                                         |
| 候选与安装来源 | 两份原候选摘要与独立 result 匹配；格式化前后 Acorn AST 相同；原 setup/check gzip、解压字节及 receipt 摘要全部匹配 | 原 Docker 回执对应原候选；当前文件的本机兼容验证单独记账，本轮未重跑 Docker 变异                                                               |

可离线复核[证据绑定及本机原始报告](../cli/evidence/assisted0836-integration-2026-11-02/review.json)：

```powershell
node docs/research/cli/evidence/assisted0836-integration-2026-11-02/verify.mjs
```

实际执行的定向回归命令（工作目录 `packages/cli`）：

```powershell
node node_modules/vitest/vitest.mjs run __tests__/verify-08.test.js __tests__/verify-36.test.js __tests__/verify-04.test.js __tests__/verify-07.test.js __tests__/verify-09.test.js __tests__/verify-10.test.js __tests__/verify-13.test.js __tests__/unit/session-branch-ownership-regression.test.js __tests__/unit/background-launch-policy-roundtrip-regression.test.js __tests__/unit/release-workflow-contract.test.js
```

这批检查基于 `d803c909a0` 之后的 **modified-worktree-before-commit**，不预填未来提交或云端通过状态。准确新提交仍需自己的完整三系统 CI，旧发行 `eec8b97b60` 的门禁只证明 `.139` 原发行源码。本轮没有新增模型请求或发行，也未修改产品运行时代码。

已同步[差距评审](./cli-ide-codex-claude-gap-review-2026-10-27.md)顶部与[36+9 清单](../cli/verify01-36-plus-9-task-list.md#actual-completion)：CLI **.139** / Open VSX **.175** 已公开核验，JetBrains **.192** 官方包已上传、公开批准待独立核实；`.138` 原生 **2/4**、`.139` 原生 **0/2** 与辅助 **2/2** 分别记录。历史 OpenAI **41/45**、火山 **34/45** 及冻结正式 **NOT_RUN** 不改写。

后续未闭环项：

- `verify-08`、`verify-36` 新执行身份下的原生独立验收；已通过样本按原规则跳过，辅助安装不替代原生生成。
- 当前安装改动的准确提交云端验证，以及 JetBrains `.192` 的版本专属公开包回读。
- Memory 100K 冷查询与完整 SLO、混合进程超时、Codex 冷扫描完整性、跨 CLI / 双 IDE 恢复、真实账号与可访问性旅程；本批没有为这些范围产生新结果。

Microsoft 渠道继续暂缓。旧资金、hold、未知派发和用量责任保持原记录；后续付费复测使用对应的新计划与预算记录。
