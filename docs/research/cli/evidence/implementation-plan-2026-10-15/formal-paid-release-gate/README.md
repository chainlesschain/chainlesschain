# 正式付费评测与发布准入记录（2026-10-15）

本记录针对用户授权的火山引擎 v3 方案和新的 CLI/IDE 发布候选。两条准入独立判定；此处不改写冻结计划、不把诊断计入正式样本，也不重置 v1/v2/v3 共用的 **$99**。

## 正式付费评测：HOLD

冻结计划指纹为 `sha256:04b90d1a93cfd6556f91688a39508c69e4423671a7b6bcb85fac4dc7e82c0e13`，指定 `volcengine / deepseek-v4-flash-ga-260731 / https://ark.cn-beijing.volces.com/api/v3`，保持默认 thinking、36 项任务和 9 次独立首次安装。正式安装目标仍是公开 CLI `0.166.99`、VS Code `0.37.143`、JetBrains `0.4.161` 及冻结的三系统身份；本轮待发布的工程源码不能代替它们。窗口在 2026-10-19T14:46:52.556Z 结束。

本次重新运行冻结计划校验成功，v3 Node 合同测试 **28/28** 通过。只读 collection 预期退出 2，仍为 `NOT_RUN`、任务 **0/36**、首次安装 **0/9**、`reviewValidated:false`；它只读取冻结目录，不能导入[后续 Astra 审阅](../../gap-2026-10-05/continuation-2026-10-13/volcengine-v3/README.md)作为同目录的正式 review 回执。Astra 已批准准确 evaluator 范围，指纹 `sha256:70b1e2db16afe0664db90a76415bb6ffed528f89ef81e9134ca53b5d7ff626d9`；该 AI 审阅不是计费、native 或真人结果批准。因此旧 18+18 分配与 OpenAI 凭据缺失均不是当前阻碍。

| 必须核验的材料                                                   | 当前证据与决策                                                                                                                                                                                                       |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 账户计费、全部输入开销、默认 thinking 的总计费输出上界、结算汇率 | 尚无账户级有效合同及包含所有计费维度的上界；[合同校验器](../../../../../../packages/cli/src/lib/formal-budget-contract.js)要求逐项证明。首轮诊断请求上限 512 却观察到 4,186 output tokens，不能将 512 当总计费上界。 |
| v1/v2/v3 历史、进行中的调用及取消费用                            | 原 $99 余额为 `null`，不能假定全额可用；[诊断记录](../README.md)的取消调用无完整 usage，总费用仍未知。需要账户账单与每个原始请求/预留的对账回执。                                                                    |
| 认证、独立、单调的生产检查点和恢复                               | [离线宿主合同](../budget-checkpoint-host/README.md)已测，但测试宿主与两库可一起回滚；没有生产存储及权限证明。                                                                                                        |
| 可信宿主持有凭据与所有物理出口的系统隔离                         | [正式 transport](../../../../../../packages/cli/src/lib/formal-budget-transport.js)仍为 `paidReady:false` 且无条件拒绝。进程内工具/worker 拒绝不能证明 SDK、后代、已有服务及 OS 网络都被治理。                       |
| 每一冻结宿主的安装、身份与 native 准入                           | Linux CLI 可先准备五个样本，但仍受同一付费门约束；Windows/macOS native 仍为 `NOT_ADMITTED`。九入口需逐一保存真实镜像、公开版本和安装回执。                                                                           |

火山 API 凭据名称在当前执行环境中可见，但凭据存在不等于账户价格、硬额度或可信宿主证明。没有发出新的付费请求。上述材料齐备并经独立核对后，才可开启首批 Linux CLI 四任务加一次首次安装；首批最高 $11 仍来自原共享 $99。

## 发布：候选已准备，标签 HOLD

`chainlesschain@0.166.102` 已在 npm 公开。旧 IDE 标签 `ide-vscode-v0.37.146` 和 `ide-jetbrains-v0.4.164` 已指向旧提交，不能改指向本轮源码。本轮源码候选采用 CLI **0.166.103**、VS Code **0.37.147**、JetBrains **0.4.165**，后两者推荐同一个 CLI 版本；现有 CLI 子包依赖版本保持精确值。候选版本号不构成发布。

先前 PR #449 的 `7963e1c9ef6780af8d092545060eb808126845a8` 上，[CLI CI](https://github.com/chainlesschain/chainlesschain/actions/runs/38743931054)与[CLI Strict Sandbox](https://github.com/chainlesschain/chainlesschain/actions/runs/38743930140)在本记录开始时未完成。版本改动产生新的提交后，这两次运行即使全绿也不能为新提交背书。正式发布须在最终提交上完成 Linux、Windows、macOS 的全部配置矩阵及相关 IDE 门；任一失败修复均重新开始准确提交验证。

发布顺序固定为：核对并公开获取全部所需子包 → 以最终提交推送不可变 `v-npm-0-166-103` 标签，让 GitHub Actions OIDC Trusted Publishing 发布 CLI 并回读 npm 制品与 provenance → 核对 CLI 可获取后再分别发布 IDE 新标签，并区分市场上传与公开可安装。不得本地 npm 发布、复用旧 SHA 的检查，或以部分/超时矩阵替代成功。正式评测保持 `NOT_RUN` 与发布候选并不矛盾；新包不得声称完成正式付费评测。

## 2026-10-16 发布回读

- CLI `chainlesschain@0.166.103` 的发布提交为 `b235ac80687fe31a45db18388ffc0f2424a26fb2`，标签为 `v-npm-0-166-103`。[OIDC 发布工作流](https://github.com/chainlesschain/chainlesschain/actions/runs/38854237037)成功；该提交的 `CLI CI` 与 `CLI Strict Sandbox` 三系统门禁通过。指定子包与 CLI 已从公共 npm 获取，[独立回读](https://github.com/chainlesschain/chainlesschain/actions/runs/38855697795)验证了注册表字节、不可变制品及签名来源。
- IDE 修复 [PR #450](https://github.com/chainlesschain/chainlesschain/pull/450) 在 CLI 发布及回读后合并为 `fa6484021670a09afb46aa46f0e17e2c707ec539`。[IDE Extensions 主线门禁](https://github.com/chainlesschain/chainlesschain/actions/runs/38855882905)完整成功，包含 VS Code 三系统宿主与 JetBrains 六项真实宿主检查。
- `ide-vscode-v0.37.147` 指向该 IDE 提交。[标签工作流](https://github.com/chainlesschain/chainlesschain/actions/runs/38859114569)通过 Open VSX 上传和公开 VSIX 字节回读；独立查询返回 `ready`、`listed:true`、`downloadable:true`，公开最新版为 `0.37.147`。仓库尚无官方 Microsoft VS Code Marketplace 所需的 `VSCE_PAT`，因此精确标签回填未执行；Open VSX 是本轮已验证的公开渠道。
- `ide-jetbrains-v0.4.165` 指向同一 IDE 提交。[标签工作流](https://github.com/chainlesschain/chainlesschain/actions/runs/38860748741)的六项宿主检查、`publishPlugin` 上传与市场回读作业均成功。最终独立公共 API 回读为 `status:ready`、`approve:true`、`listed:true`、`hidden:false`；从公开文件端点下载的 `chainlesschain-ide-bridge-0.4.165.zip` 为 1,531,110 字节，ZIP 完整性检查通过，SHA-256 为 `dab99dca016dcc156a954a823aa39bb1188a381c4d76084f9bd831f3dcb56c98`。该版本已公开可安装。

用户要求先跳过正式付费评测。本轮没有付费模型请求；冻结的 36 项任务与 9 次首次安装继续为 `NOT_RUN`（0/36、0/9），`paidReady:false`、native `NOT_ADMITTED`，历史共享 **$99** 不重置。发布门禁成功不改变这些评测结论.

## 2026-10-17 发布与公开状态

以下记录对应 [PR #458](https://github.com/chainlesschain/chainlesschain/pull/458)。按用户要求，先完成子 npm 包、CLI、VS Code 和 JetBrains 的发布与公开回读，再合并 PR。旧版本的 2026-10-16 记录保留为历史证据。

| 阶段 | 准确提交与工作流 | 当前结果 | 下一步 |
| --- | --- | --- | --- |
| 子 npm 包 → CLI `0.166.104` | `93792f65204aec3d25aa3b5abda83013f290d4ca`；[OIDC 工作流第 2 次运行](https://github.com/chainlesschain/chainlesschain/actions/runs/39012587904/attempts/2) | GitHub Actions 发布成功；公共 npm 可获取 `chainlesschain@0.166.104`，子包先于 CLI 发布。 | 生产宿主与正式效果验收仍按各自工作包判定。 |
| VS Code `0.37.149` | 同一发布提交；[Open VSX 标签工作流第 2 次运行](https://github.com/chainlesschain/chainlesschain/actions/runs/39014016230/attempts/2) | Open VSX API 返回 `ready`、`listed:true`、`downloadable:true`；推荐 CLI `0.166.104`。 | Microsoft Marketplace 尚无 `VSCE_PAT`，官方渠道未发布。 |
| JetBrains `0.4.166` | `4c3e5cfd56f9afa947aa2383428fdcd883d4e4b8`；[标签工作流](https://github.com/chainlesschain/chainlesschain/actions/runs/39020301946) | 六组真实宿主矩阵、插件构建、CLI 前置核验及 `publishPlugin` 上传成功；公共 API 已返回 `ready`、`approve:true`、`listed:true`、`hidden:false`。公开 ZIP 为 1,532,930 字节，完整性检查通过，SHA-256 为 `0aa37f3c34f5e02e66812826629ae0a7e7cb5d1fe1479700900005b02505dc5b`。 | 后续版本须重新走完整宿主与公开制品回读门禁。 |
| PR #458 | 当前仍开放 | CLI、Open VSX 与 JetBrains 的本轮公开发行均已完成，遵守先发布后合并顺序。 | 检查最终文档提交的必需门禁，再合并。 |

上述发行不改变正式付费评测 `NOT_RUN`（任务 0/36、首次安装 0/9）、`paidReady:false` 或 native `NOT_ADMITTED`。
