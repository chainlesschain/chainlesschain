# CLI .141：源码预览、读取恢复与评测入口范围

> 发行状态以已归档公开回读为准；站点部署源码见 deployment-source.json。

## 源码与发行身份

配套版本为 CLI **0.166.141**、Open VSX **0.37.177**、JetBrains **0.4.194**。准确发行源为 [`df9295e33ad04aec0aa74cab4dd242766d5556a4`](https://github.com/chainlesschain/chainlesschain/commit/df9295e33ad04aec0aa74cab4dd242766d5556a4)，对应标签计划为 `v-npm-0-166-141`、`ide-vscode-v0.37.177`、`ide-jetbrains-v0.4.194`；实际标签来源须从发行回执验证。合入后的 `main@a60b9cdb35d9d598202930cb3317117b651948fd` 与发行源文件树一致。

上一公开 `.140` 源码为 `e2a91bf54332ff3d252c40ecc25c5887e0f0430d`；上一版文档复核主线为 `d62866538c1988258b93998f9705c2cdd76ee105`。读取恢复和部分诊断代码已在后者出现，但不在 `.140` 不可变发行源中。本次按发行差异记录交付行为，避免把先前主线修复误称为先前 npm 包已包含。

| 组件                  | 版本            | 发行或复用状态                                                         |
| --------------------- | --------------- | ---------------------------------------------------------------------- |
| CLI                   | 0.166.141       | `verified-public；字节、签名来源、registry-only安装与有限启动探测通过` |
| Open VSX              | 0.37.177        | `verified-public；VSIX与正式构建一致`                                  |
| JetBrains             | 0.4.194         | `verified-public；已获批，完整内部payload与正式构建一致`               |
| SDK / Protocol        | 0.2.17 / 0.1.12 | `SDK0.2.17 / Protocol0.1.12公开原版复用，字节与依赖核验通过`           |
| Kernel / Session Core | 0.1.11 / 0.3.24 | `Kernel0.1.11 / SessionCore0.3.24公开原版复用，字节与依赖核验通过`     |
| PC / Android / iOS    | v5.0.3.144      | 独立发行，本次不重复发布                                               |

已比对的 Core DB、Session Core、Agent SDK、Agent Protocol、Context/Memory Kernel 子包目录相对 `.140` 源码没有变更。复用仍需正式发布流程核验公共包字节和依赖安装，不凭版本号不变免除验证。

## 完整源码预览策略

`packages/cli/src/lib/tool-result-preview.js` 的 `canProjectHostToolExcerpt` 现在显式使用已有的 `bounded-source-tokens-v1`。此前宿主预览没有对齐提供方的源码表达式策略，包含合法数组或对象展开语法的完整候选可能提前变成 `Text omitted`，即使底层文件读取成功，模型也没有收到正文。

本次只对齐有界源码表达式的投影条件，保留 `explicit-source-containers-v1`、源码 token 上限、严格 JSON 与来源身份检查。敏感信息清理由提供方投影继续执行。正文可以进入下一轮请求不等于整文件已读、语法已验证或任务已完成。

既有两份失败候选的只读交付回放验证了宿主预览、证据投影及 Responses 工具输出之后的正文保留；这些结果证明传输可见性，不改判候选任务验收。

## 恢复提示必须可兑现

`packages/cli/src/lib/read-file-loop-guard.js` 把重复读取指纹提取为共享计算，区分恢复与复查。生成 `recoveryRead` 前，先基于同一已授权文件检查目标页有效、具有完整范围且未截断，再检查历史覆盖、当前可见性、已消费的范围指纹与剩余额度。

仍可恢复时返回有界读取参数；不能恢复时省略该参数，提示使用当前可见源码或 `search_files` 搜索精确符号，正则搜索须显式设置 `regex:true`。必要源码不可得时应明确报告限制。纯页检查不新增读取额度，也不以历史曾读过替代本轮模型可见性。

作者与独立审阅仍共享原有预算。审阅启动、模型终态、正文投递及独立验收分别记录，不能用其中一个事件替代其余条件。

## 共享入口绑定正式评测授权

`packages/cli/src/runtime/agent-core.js` 在 `agentLoop` 入口执行 `bindFormalQualityLoopOptions`。只有正式隔离运行标记、符合临时目录约束的配置 HOME 和启动器允许文件绑定齐备时才启用。

1. 把精确修改范围同时用于提供方工具路径枚举和执行检查。
2. 调用者只能收窄文件范围；扩大范围、工作区错配及无效绑定在模型请求前拒绝。
3. 工具集合与评测允许的文件工具取交集；空集合、只读集合保持收窄结果。
4. 清除该隔离路径中外部同名 executor 的投影覆盖，避免执行层已忽略的 executor 抑制内置文件工具枚举。

CLI 命令原先传递了启动器文件范围，IDE 网关直接调用共享循环时存在遗漏；把绑定放在共享入口后，两种入口使用同一授权。普通交互调用及没有文件绑定的 legacy hermetic 调用保持既有语义，不由这项变更推断普通 IDE 权限全面失效。IDE 协议未改变，修复通过配套 CLI 到达插件宿主。

macOS 回归夹具保留 `mkdtemp(os.tmpdir())` 的原路径用于配置 HOME，同时允许工作区 realpath。这样与真实启动器一致，避免 `/var` 到 `/private/var` 的别名差异导致评测条件误关；没有放宽 session-core 的运行条件，也没有为此更改子包版本。

## 诊断预算入口拒绝与观测边界

`packages/cli/scripts/verify01-volcengine-diagnostic-broker.mjs` 的外层构造入口，在读取 `options.executionBudgets` 前调用 `requireUnscopedModelTransport()`。共享 broker 内的拒绝检查继续保留。处于正式预算作用域时，未受管诊断传输因此在参数、凭据、路径或注入回调访问之前返回 `CC_BUDGET_TRANSPORT_NOT_COVERED`。

既有 Proxy 参数测试要求拒绝前读取次数为零；更新后的预算 egress 源码目录绑定精确文件字节。CI 把这项离线拒绝合同前移到测试分片之前，避免较晚才发现入口顺序退化。有限诊断轮次、请求数、输出上限及未知用量处理不因这项顺序修复改变。

相对 `.140` 的 ArtifactStore 差异还包括可选诊断标签：在原完整性条件已拒绝之后，仅记录失败字段名称，观测失败不能覆盖原异常；它不放宽拒绝条件，也不证明此前 Windows 完整性问题已定位或解除。

评测 harness 的显式内部输出上限、内部摘要边界和后续有限预算策略与用户运行核心分别记录。它们不能解释为普通用户自动获得更多模型调用或付费额度。

## 工程验证与发行门禁

| 核验项                                | 结果                                                                                                      | 来源                                                                                                                                                                                            |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 准确源码 CLI CI 三平台完整矩阵        | `success；success:76`                                                                                     | `https://github.com/chainlesschain/chainlesschain/actions/runs/41771520923`                                                                                                                     |
| CLI Strict Sandbox 完整矩阵           | `success；success:6`                                                                                      | `https://github.com/chainlesschain/chainlesschain/actions/runs/41771520789`                                                                                                                     |
| CLI 归档、OIDC、provenance 及公共安装 | `success；registry-only --ignore-scripts安装及Agent capability启动探测，不代表完整native/postinstall验证` | `https://github.com/chainlesschain/chainlesschain/actions/runs/41781533170`；`https://github.com/chainlesschain/chainlesschain/blob/main/docs/research/cli/evidence/release141-public/cli.json` |
| VS Code 必需宿主门禁与 Open VSX       | `完整流程通过，公开payload已核验`                                                                         | `https://github.com/chainlesschain/chainlesschain/actions/runs/41783621218`                                                                                                                     |
| JetBrains 必需宿主门禁、上传及商店    | `完整流程通过、商店获批、公开payload已核验`                                                               | `https://github.com/chainlesschain/chainlesschain/actions/runs/41783620938`                                                                                                                     |

成功、失败和跳过作业分别计数；不能把所有非跳过作业未经筛选就命名为“required host gates”。正式发布使用 GitHub Actions OIDC，并保持子包 → CLI → IDE 的顺序。JetBrains 商店重打包的外层 ZIP 可变化，但内部官方 payload 条目集合与内容须逐项核验。上传待审单列，不宣称公开可安装。

本地测试只作补充。RC-DEFAULT/MCP advisory 和 local session fabric 不替代真实 GitHub 身份的 required 门禁；JDK、操作系统和源码不同也须保留范围。`--ignore-scripts` 的 registry-only 安装与 Agent capability 启动只证明相应有限探测，不声称完整 native/postinstall 验证。

## 模型任务证据不因发行重算

火山 `.140` 修正轮 `41638188839` 生成 **39/45**、候选验收及严格通过 **24/45**，其中普通任务21/36、首次安装3/9。仅 `verify-04` 新增到此前35项历史账本，累计 **36/45**、剩9项；首轮新增的 `verify-08` 已计入35项。历史 `verify-06` 的候选验收通过、生成与端到端未通过限定保留。

Sol 原项目 `b2aa3aba082873570e85dce39b00754e5504ff37` 的历史成绩仍为 **41/45**；跨版本且含修正项目源码的累计为 **45/45**。最新 `.140` 四项绑定项目 `e2a91bf54332ff3d252c40ecc25c5887e0f0430d`，生成4/4、严格 **2/4**，通过 `verify-13` 和 `verify-36`，其余41项未运行。不能回填原冻结项目为43/45，也不能称为同配置一次45项全通过。

版本、源码和配置不同，累计覆盖不能直接用于单变量模型排名。`.141` 文档与发行工作没有重复已测模型样本。候选回放、离线检查和工程修复不新增模型验收；正式计划 `NOT_RUN` 及 `NOT_PAID_READY / NOT_ADMITTED / HOLD` 保留。

- [任务账本与失败分类](https://github.com/chainlesschain/chainlesschain/blob/df9295e33ad04aec0aa74cab4dd242766d5556a4/docs/research/cli/verify01-36-plus-9-task-list.md)
- [火山原始修正轮](https://github.com/chainlesschain/chainlesschain/blob/df9295e33ad04aec0aa74cab4dd242766d5556a4/docs/research/cli/verify01-volcengine-140-full-20261103/internal-output-repair/final-54d0064cab/results.json)
- [累计与历史限定](https://github.com/chainlesschain/chainlesschain/blob/df9295e33ad04aec0aa74cab4dd242766d5556a4/docs/research/cli/verify01-volcengine-140-full-20261103/internal-output-repair/cumulative-status.json)
- [CLI/IDE 评测范围差异证据](https://github.com/chainlesschain/chainlesschain/blob/df9295e33ad04aec0aa74cab4dd242766d5556a4/docs/research/cli/verify01-volcengine-140-full-20261103/internal-output-repair/diagnostics-cli-ide-scope/proof.json)
- [Sol 四项原始结果](https://github.com/chainlesschain/chainlesschain/blob/df9295e33ad04aec0aa74cab4dd242766d5556a4/docs/research/cli/verify01-openai-140-frozen-four-20261103/public-802c51a9f2/results.json)
- [源码读取独立审计](https://github.com/chainlesschain/chainlesschain/blob/df9295e33ad04aec0aa74cab4dd242766d5556a4/docs/research/cli/verify01-openai-140-frozen-four-20261103/harness-audit-20261104/README.md)
- [Sol 跨源码累计](https://github.com/chainlesschain/chainlesschain/blob/df9295e33ad04aec0aa74cab4dd242766d5556a4/docs/research/cli/verify01-volcengine-139-20261103/sol-comparison/cumulative-coverage.json)

## 文档构建与服务器身份

设计正文维护于 `docs/design/release-runtime-update-2026-11-04-141.md`，通过两站现有同步脚本生成文档站副本。升级指南维护于 `docs-site/docs/chainlesschain/cli-ide-update-2026-11-04-141.md`。官网状态数据与中英文首页及 SourceUpdate 文案需同步，保留旧 `.140` 文档作为历史快照。

文档构建：`本次提交由三个站点的锁定依赖本地构建；构建日志与部署回执归档`；部署源码：`以本站 /deployment-source.json 的 sourceHeadCommit 为准；与不可变CLI发行源码分别记录`；三个站点公开回读：`https://www.chainlesschain.com/deployment-source.json ; https://docs.chainlesschain.com/deployment-source.json ; https://design.chainlesschain.com/deployment-source.json`。文档部署提交、运行时发行提交和商店构件身份分别留档；本地构建成功不等于服务器已更新。
