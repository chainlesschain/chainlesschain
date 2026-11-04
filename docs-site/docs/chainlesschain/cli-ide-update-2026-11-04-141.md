# CLI .141 与 IDE 配套升级：完整源码预览和读取恢复

> 发行状态以已归档公开回读为准；站点部署源码见 deployment-source.json。

## 概述

本次配套版本为 CLI **0.166.141**、VS Code 兼容编辑器扩展 **0.37.177**、JetBrains 插件 **0.4.194**。准确发行源码为 [`df9295e33ad04aec0aa74cab4dd242766d5556a4`](https://github.com/chainlesschain/chainlesschain/commit/df9295e33ad04aec0aa74cab4dd242766d5556a4)。文档复核主线为 `a60b9cdb35d9d598202930cb3317117b651948fd`，其文件树与该发行源码一致；后续文档或部署提交不替换不可变发行身份。

核验时间：`2026-11-04T10:59:34.766935+00:00`。

| 组件                  | 版本                  | 公开状态及回执                                                                                                                                                                             |
| --------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| npm CLI               | 0.166.141             | `verified-public；字节、签名来源、registry-only安装与有限启动探测通过`；`https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/release141-public/cli.json` |
| Open VSX 扩展         | 0.37.177              | `verified-public；VSIX与正式构建一致`；`https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/release141-public/open-vsx.json`                             |
| JetBrains 插件        | 0.4.194               | `verified-public；已获批，完整内部payload与正式构建一致`；`https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/release141-public/jetbrains.json`         |
| Microsoft Marketplace | 0.37.177 的该渠道状态 | `deferred-unpublished`                                                                                                                                                                     |

两款扩展推荐 CLI **0.166.141**。JetBrains 的上传、审核、公开列出和下载 payload 核验是不同阶段。若 `.194` 仍待审，上一已核验公开版应单列为 `0.4.193`，其 CLI 推荐版本为 `0.166.140`，依据为 `https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/release141-public/jetbrains-listing.json`。不要把 `.194` 的推荐关系应用到旧版插件。

## 核心特性

**完整源码预览保留合法展开语法。** 读取的 JavaScript 包含数组或对象展开表达式时，宿主预览此前可能误判并返回 `Text omitted`。本次对齐提供方已有的有界源码表达式策略，使符合边界的正文继续传给模型。它不表示所有源码都能无限输出，也不等于完成语法验证。

**读取恢复提示与实际可恢复范围一致。** 如果某个范围仍能在现有额度中恢复，提示保留具体读取参数；额度耗尽或相同恢复机会已消费时，不再要求反复重读同一区域，而是建议利用当前可见正文或按精确符号搜索。必要源码仍不可得时应报告限制，不能猜测接口。读取成功、正文送达模型和任务完成是不同状态。

**正式隔离评测的 CLI 与 IDE 入口使用相同文件范围。** 可信启动器指定精确交付文件时，共享运行核心同时约束修改工具的路径说明和实际执行。调用者只能收窄授权；空工具集、只读工具集不会被扩大。这是评测启动器授权传递的修正，不是普通 IDE 文件权限全面失效的证据。

**诊断转发器在读取选项前检查正式预算边界。** 没有受管传输的诊断 broker 在正式预算作用域中先拒绝构造，不先读取预算参数、凭据或注入传输。普通用户请求不会因此自动增加模型轮次或费用额度。

运行核心修复随 CLI 分发，两款 IDE 更新推荐关系。现有模型配置、权限、审批和 IDE 通信协议沿用原有行为；自进化开关不会因升级自动开启。

## 配置参考

在上表确认目标渠道公开可用后，使用 Node.js **22.12.0+**、npm **10+**：

```bash
npm i -g chainlesschain@0.166.141 --registry https://registry.npmjs.org
cc --version
cc doctor
```

`cc --version` 应显示 `0.166.141`。重启 CLI、`cc ui` 和 IDE 聊天宿主，确认宿主实际连接到更新后的 CLI。若终端版本正确但 IDE 仍旧，检查 IDE 配置的可执行路径及 PATH，停止旧宿主后重新连接。JetBrains 待审时可继续使用已公开配对；只有明确标注的官方构件才可作为侧载选择。

仍出现省略正文时，保留原始错误和目标文件范围，按提示执行有界恢复或精确搜索；不要通过放宽 JSON、敏感信息或预算校验来消除报错。

Agent SDK **0.2.17**、Protocol **0.1.12**、Context/Memory Kernel **0.1.11**、Session Core **0.3.24** 版本不变。上游公共字节和依赖复用核验：`版本不变；逐包公开字节与registry-only依赖安装已核验`。PC、Android、iOS **v5.0.3.144** 保持独立发行；本轮不重新发布客户端。

## 测试覆盖

| 核验                                     | 结果                                                                                                      | 回执                                                                                                               |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 准确源码 CLI CI，Linux / Windows / macOS | `success；success:76`                                                                                     | `https://github.com/chainlesschain/chainlesschain/actions/runs/41771520923`                                        |
| 准确源码 CLI Strict Sandbox              | `success；success:6`                                                                                      | `https://github.com/chainlesschain/chainlesschain/actions/runs/41771520789`                                        |
| npm Actions OIDC 发行                    | `success；GitHub Actions OIDC`                                                                            | `https://github.com/chainlesschain/chainlesschain/actions/runs/41781533170`                                        |
| npm 公共字节、来源签名及安装探测         | `success；registry-only --ignore-scripts安装及Agent capability启动探测，不代表完整native/postinstall验证` | `https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/release141-public/cli.json` |
| VS Code / Open VSX 宿主门禁及公开构件    | `完整流程通过，公开payload已核验`                                                                         | `https://github.com/chainlesschain/chainlesschain/actions/runs/41783621218`                                        |
| JetBrains 宿主门禁、上传及商店状态       | `完整流程通过、商店获批、公开payload已核验`                                                               | `https://github.com/chainlesschain/chainlesschain/actions/runs/41783620938`                                        |

作业数应分别记录成功、失败和跳过，不能把跳过作业计为通过。发行顺序保持必需子包可获取且一致 → CLI 公开并验证安装 → IDE 配套发行。`--ignore-scripts` 安装加 Agent capability 启动探测只证明相应范围，不代表完整 native/postinstall 验证。本地测试、部分矩阵、超时或旧提交检查不替代准确源码的云端门禁。

文档构建：`本次提交由三个站点的锁定依赖本地构建；构建日志与部署回执归档`；服务器部署源码：`以本站 /deployment-source.json 的 sourceHeadCommit 为准；与不可变CLI发行源码分别记录`；官网、用户文档与设计文档的公开回读：`https://www.chainlesschain.com/deployment-source.json ; https://docs.chainlesschain.com/deployment-source.json ; https://design.chainlesschain.com/deployment-source.json`。源码提交、构建成功和服务器内容更新分别记录。

## 模型任务成绩保持独立口径

本次 `.141` 配套发行没有新增模型任务补测，也没有重算历史成绩。

| 队列与范围                                       | 已核验记录                         | 含义                                          |
| ------------------------------------------------ | ---------------------------------- | --------------------------------------------- |
| 火山 / DeepSeek `.140` 修正轮，run `41638188839` | 生成 **39/45**；严格验收 **24/45** | 完整单轮，普通任务21/36、首次安装3/9          |
| 火山历史自动交付去重累计                         | **36/45**，剩 **9**                | 从此前35项新增 `verify-04`；保留历史验收限定  |
| Sol 原冻结项目 `b2aa3aba…`                       | 历史 **41/45**                     | 保留原项目身份                                |
| Sol `.140` 修正项目 `e2a91bf…` 的四项补测        | **2/4**                            | `verify-13`、`verify-36` 通过，其他41项未执行 |
| Sol 跨版本且包含修正源码的累计覆盖               | **45/45**                          | 不是同版本、同源码的一轮全量成绩              |

火山首轮新增的 `verify-08` 已在前一35项中，不能再次算作修正轮新增。历史 `verify-06` 仅候选验收通过，原生成和端到端未通过，故累计36/45不能标成统一严格端到端成绩。原冻结 Sol 41与修正项目两项相加，不能称为原冻结同源码43/45。

两队列的版本、项目源码及运行配置存在差异，累计覆盖不构成单变量模型能力排名。离线回归、候选交付回放和发行不增加模型任务验收数。正式冻结计划仍为 `NOT_RUN`；`NOT_PAID_READY / NOT_ADMITTED / HOLD` 保留。

## 系统架构

CLI 与 IDE 网关调用共享的 `agentLoop`。读取结果经过有界预览和模型投影后进入请求，宿主读取成功与模型实际收到源码分别记录。正式隔离评测由启动器绑定精确文件范围；普通会话继续使用原有工具权限和审批。诊断 broker 的正式预算拒绝检查发生在读取选项之前，内部有限预算策略继续执行。

## 性能指标

本次没有新增模型性能或成本基准。已核验的数字是同一发行提交的 CLI CI 76/76 和 Strict Sandbox 6/6，不能换算成任务完成率或吞吐量。火山与 Sol 的历史任务统计和预算范围见下方原始账本，未知费用保持未知。

## 安全考虑

升级不会自动打开自进化或增加普通用户请求额度。敏感信息扫描、严格 JSON 校验、来源身份和执行时文件范围检查继续生效。不要在日志、仓库或聊天中保存 API key；诊断配置使用现有密钥存储。公开构件验证和历史模型成绩分别留档。

## 故障排查

如果 IDE 中仍显示旧版本，先确认 IDE 配置的 CLI 路径和 PATH，停止旧聊天宿主后重新连接。出现 `Text omitted` 时按提示中的有效范围有界重读；额度已耗尽时使用精确符号搜索。正文仍不可得应报告限制。保留原错误、文件范围和版本，不通过关闭校验解决读取问题。

## 关键文件

源码预览与恢复位于 `packages/cli/src/runtime/coding-agent-contract-shared.cjs` 及共享运行核心 `packages/cli/src/runtime/agent-core.js`。正式评测绑定见 `packages/cli/src/lib/formal-quality-eval-runtime.js`；诊断边界见 `packages/cli/scripts/verify01-volcengine-diagnostic-broker.mjs`。这些内部文件用于追溯，不需要用户直接编辑。

## 使用示例

安装后在终端运行 `cc --version`，确认输出 `0.166.141`，再运行 `cc doctor` 检查实际配置和运行环境。打开 IDE 的 ChainlessChain 聊天宿主并重新连接；读取带数组或对象展开表达式的文件时，合法有界预览应保留正文。任务结果仍需按原验收标准独立检查。

## 相关文档

[输入与读取恢复](./agent-input-and-recovery)、[Agent 命令](./cli-agent)、[自进化开关](./self-evolution-configuration)、[本次运行时设计](https://design.chainlesschain.com/release-runtime-update-2026-11-04-141.html)及[发行回执](https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/release141-public/README.md)分别说明操作、配置和证据范围。

- [45项任务账本及比较边界](https://github.com/chainlesschain/chainlesschain/blob/df9295e33ad04aec0aa74cab4dd242766d5556a4/docs/research/cli/verify01-36-plus-9-task-list.md)
- [火山修正轮原始成绩](https://github.com/chainlesschain/chainlesschain/blob/df9295e33ad04aec0aa74cab4dd242766d5556a4/docs/research/cli/verify01-volcengine-140-full-20261103/internal-output-repair/final-54d0064cab/results.json)
- [火山累计及历史限定](https://github.com/chainlesschain/chainlesschain/blob/df9295e33ad04aec0aa74cab4dd242766d5556a4/docs/research/cli/verify01-volcengine-140-full-20261103/internal-output-repair/cumulative-status.json)
- [Sol 四项原始成绩](https://github.com/chainlesschain/chainlesschain/blob/df9295e33ad04aec0aa74cab4dd242766d5556a4/docs/research/cli/verify01-openai-140-frozen-four-20261103/public-802c51a9f2/results.json)
- [Sol 跨源码累计](https://github.com/chainlesschain/chainlesschain/blob/df9295e33ad04aec0aa74cab4dd242766d5556a4/docs/research/cli/verify01-volcengine-139-20261103/sol-comparison/cumulative-coverage.json)

另见[输入与恢复](./agent-input-and-recovery)、[CLI Agent](./cli-agent)、[自进化配置](./self-evolution-configuration)与[本次运行时设计](/design/release-runtime-update-2026-11-04-141)。
