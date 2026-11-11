# ChainlessChain 对照 Claude Code / Codex 的增量差距复核（2026-11-08）

审核日期：2026-11-08。范围：CLI、VS Code / JetBrains IDE、共享 Agent Runtime，以及相关桌面端组合旅程。

依据：[10 月 27 日差距评审及其 11 月 8 日汇总](./cli-ide-codex-claude-gap-review-2026-10-27.md)、仓库源码与归档证据、当日实际读取的官方文档。初次分析基线为 `8ecb5bcfbc0ca4e16a9154c14121a266696781fb`，保存前复核 HEAD 为 `74f8df309ee69741003fab426ae30bb50514505a`。

保存前工作区已有原评审文档和 Memory 实现的未提交修改；本文不将这些修改视为准确提交的验证结果。初次保存时，本文只记录分析与建议，未重新执行模型任务、性能测试、GUI 旅程、GitHub Actions 或公开包下载核验。历史测试结果保持原版本、平台和样本范围，不累计为当前 HEAD 成绩。

**完成情况（截至 2026-11-12）**

第 1 项的上游比较基线已记录。第 2–9 项均已取得部分证据，仍有验收项未完成。下表汇总当前完成情况，各轮历史结果保留在后文。

本次续作状态（2026-11-11；发布候选 [PR #602](https://github.com/chainlesschain/chainlesschain/pull/602)，准确提交 `32451e4d568e414acdb9c956208e5cff827cd6e0`）：

| 续作项目                     | 完成情况                              | 验证与剩余工作                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 原待合并 PR                  | 已合并                                | #596–#605 相关原提交已合入；Git worktree 宿主恢复驱动修正 #608 亦已合并。本次公开发行回读和完成情况表继续归档。                                                                                                                                                                                                                                                                                                        |
| 自进化 manifest 原组件所有权 | 本批实现完成                          | 七文件 84 项通过、2 项既有平台跳过；完整历史汇总、存储图、生产 producer 和自动晋级仍未完成。                                                                                                                                                                                                                                                                                                                           |
| DMM 原生跨夜                 | 受控时钟 Windows 验收通过             | 准确提交 `32451e4d5` 的实际 Electron/Vue/加密 SQLite 通过；两类通知各保留原 ID，跨午夜 pending、静默结束投递及已读隔离/授权跳转通过，检查次数为 1。首次驱动失败保留；真实整夜、重启及其他平台待完成。[运行回执](https://github.com/chainlesschain/chainlesschain/actions/runs/42959022161)                                                                                                                             |
| 新 CLI / IDE 发行            | CLI / Open VSX 已公开；JetBrains 单列 | CLI 0.166.147 准确源 `32451e4d5` 已通过 CLI CI 76/76、Strict Sandbox 6/6、OIDC 发布及公开字节/来源证明回读。准确源 `703b22e89` 的 IDE 18 成功/1 项发布后条件跳过、ARM64 11/11、无障碍 4/4、桌面 E2E 4/4、质量 8 成功/2 项条件跳过及进程恢复 2/2 全部完成。Open VSX 0.37.186：已公开并核验；JetBrains 0.4.201：官方发行中，公开回读未完成。                                                                             |
| Git worktree 宿主恢复驱动    | 已修复并合并 PR #608                  | 准确源 `817903715` 的本地恢复 4/4、标准 353/353、扩展 387/387 通过，实际 WSL/devcontainer/严格 SSH 工作流 4/4 通过；旧函数在真实 worktree 的 ENOENT 回放及 25 份原始托管成员见[修复证据](../evidence/host-recovery-worktree-20261112/README.md)。变更为发布包排除的测试驱动。                                                                                                                                          |
| 合并后 Linux 全量补充验证    | 测试断言通过，结果上传失败            | 主分支 `5044641ff` 的 [43083563555](https://github.com/chainlesschain/chainlesschain/actions/runs/43083563555) 首轮 Linux 依赖安装遇到 Babel 上游先后发布窗口；attempt 2 的安装、完整测试及强制检查成功，随后证据上传失败。日志读取与 Actions 查询出现 502/超时，具体上传原因尚待核验；工作流未确认成功，历史失败保留。见[分阶段观察](../evidence/ide201-infrastructure/README.md#合并后主分支的-babel-上游发布窗口)。 |
| 36+9 完整复测                | 准备完成，真实运行未开始              | 固定原题、平台分配、火山 DeepSeek 模型和预算；历史严格单轮基准 24/45（53.3%），维护任务 21/36、首次安装 3/9。当前新轮模型调用为 0，没有新完成率。                                                                                                                                                                                                                                                                      |

自进化整体验收仍未完成。新版完整复测用于比较实际完成率变化；当前自动晋级仍 HOLD，不能仅凭新版分数变化断言学习机制带来增益，也不把跨版本累计 36/45 当作单轮基准。

| 对应项                    | 完成情况 | 已完成或已验证                                                                                                                                                                                                    | 仍待完成                                                                                                                                                                                               |
| ------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. 上游比较基线           | 已完成   | 已记录本轮核对的 Codex CLI `0.167.0` 和 Claude Code `2.1.319`。                                                                                                                                                   | —                                                                                                                                                                                                      |
| 2. 模型实际输入与任务归因 | 部分完成 | 原生 VS Code 真实任务的 4 个实际请求均完成输入映射，共 8 条诊断记录。JetBrains 真实任务通过功能断言，保留清理失败。                                                                                               | 扩展真实任务和失败归因样本，完成 JetBrains 原始输入映射、安全退出和跨平台验收。                                                                                                                        |
| 3. 跨入口生命周期与恢复   | 部分完成 | VS Code 真实任务在重启后恢复原结果，新增模型请求为 0。JetBrains 已完成有条件的恢复验证。                                                                                                                          | 覆盖追加要求、压缩、断线、恢复和安全退出的完整流程，验证其他平台和入口。                                                                                                                               |
| 4. MCP Tasks              | 部分完成 | 已验证持久化续跑和 3 个崩溃窗口。火山 DeepSeek 真实续跑返回 HTTP 200，REPL 重启后无重复派发。                                                                                                                     | 验证生产远程服务、追加输入、任务过期及撤销，并完成双 IDE、桌面端和跨平台验收。                                                                                                                         |
| 5. 成本、上下文与付费准入 | 部分完成 | 已验证火山真实调用、输出上限和用量采集，归档官方价格并保留未知结算状态。离线预算检查 234/234 通过。                                                                                                               | 用真实任务比较上下文配置的交付成本，完成真实账号时段定价和汇率核对、账单对账及正式付费准入。                                                                                                           |
| 6. Codex 兼容性           | 部分完成 | `71d392c0b` 的三系统兼容工作流 **24/24** 通过，`.167` 在三系统均通过原生回合、取消和数据库重启恢复。                                                                                                              | 三系统严格冷升序扫描均只返回 1/2 个已知线程。仍需冷发现修复、模型变更验证及生产准入。                                                                                                                  |
| 7. IDE 与桌面端完整流程   | 部分完成 | Windows 安装版 VSIX 已通过受限条件下的真实任务、结果展示和重启验证。JetBrains 原生任务、界面及重启断言已有证据，保留整体清理失败。                                                                                | 验证常规宿主入口、三系统与桌面端完整流程、安全清理、无障碍以及安装升级与回滚。                                                                                                                         |
| 8. Memory 性能与质量      | 部分完成 | Linux、Windows、macOS 每组 100 次的完整托管矩阵 **12/12** 通过。三个平台的 100K 冷分类列表 p95 均低于该场景的 1 秒候选目标。[运行回执](https://github.com/chainlesschain/chainlesschain/actions/runs/42850534026) | 本机两次 Stop 确认超出 500ms，原因待定位。仍需产品混合与恢复 SLO、真实 IDE Stop 和多语言真实用户任务验收。原始完整矩阵归档已合入。[PR #596](https://github.com/chainlesschain/chainlesschain/pull/596) |
| 9. 共享逻辑与指导         | 部分完成 | 已共享输入诊断投影、修复流式诊断持久化并验证实际请求映射。已归档 JetBrains 历史记录跟踪与有条件的标准 Gradle 构建。                                                                                               | 完成常规环境与跨平台验收、安全退出流程及独立桌面故障定位。                                                                                                                                             |

本批兼容实现使用独立分支 feature/cli-ide-gap-20261108，工作区位于 .worktrees/cli-ide-gap-20261108。这样可满足现有协议探针对干净准确提交的要求，并保留主工作区已有 Memory / CLI CI 改动。尚未合并、发布或宣称生产支持扩大。

本批已修复传输退出感知、Windows 管道清理及历史探针资源泄漏，详细结果与首次失败见[Codex 0.167 实施记录](../implementation/cli-ide-codex-167-progress-2026-11-08.md)。代码提交为 e55e99ca22eda1f202d516e42ef306ee9cf28af6；本机冷升序扫描失败保持失败，生产准入关闭。

第 2 项首批实现及验证见[最终模型输入诊断实施记录](../implementation/cli-ide-model-input-diagnostics-progress-2026-11-08.md)，代码提交 2ba726cd9c40cf640d6950dac27c088039d0cece。该项尚未完整验收。

CLI 持久化查询及同请求三阶段验收见[后续实施记录](../implementation/cli-ide-model-input-journal-progress-2026-11-08.md)，代码提交 5501891ee3c61728e1661fb6fee7c740c76aae8d。

IDE 诊断入口的实施和验收范围见[原生宿主记录](../implementation/cli-ide-model-input-ide-progress-2026-11-08.md)。

逐来源规划选择及可信投影计数见[后续来源诊断记录](../implementation/cli-ide-model-input-source-progress-2026-11-08.md)，代码提交 ce6df580b8a0e269386e2ce4de950396a1e9a8cf。

**审核结论**

现有证据支持优先加强任务交付稳定性、跨入口恢复，以及质量和费用的可验证性。项目已有 Goal、MCP / Skills 检索、Memory、会话隔离和发行门禁等基础；下一阶段应强化这些能力在实际产品中的组合行为。本文不依据功能数量或不同条件的累计任务成绩判断项目与 Claude Code / Codex 的胜负。

**1. 更新上游比较基线**

| 产品        | 原评审的上游基线 | 本次官方页面可核实版本 | 日期       |
| ----------- | ---------------- | ---------------------- | ---------- |
| Codex CLI   | 0.164.0          | 0.167.0                | 2026-11-06 |
| Claude Code | 2.1.311          | 2.1.319                | 2026-11-06 |

版本来自 [Codex 官方更新日志](https://learn.chatgpt.com/docs/changelog)与 [Claude Code 官方更新日志](https://code.claude.com/docs/en/changelog)。这里的“最新”仅指核对当日官方页面列出的版本，不保证全部分发渠道、账号或平台同步可用。

这两个版本是上游工具版本，与项目 CLI `0.166.143` 的编号属于不同产品，不能用数字大小比较能力。项目发行状态仍以各自准确提交的归档回执为准。

**2. P1：补齐模型实际输入、执行与独立验收的诊断链**

已有任务结果必须分别解释：

| 范围                       | 归档结果                               | 解释边界                                              |
| -------------------------- | -------------------------------------- | ----------------------------------------------------- |
| 火山历史去重累计           | 36/45                                  | 跨版本累计覆盖，保留 `verify-06` 仅候选验收通过的限定 |
| 火山 `.140` 修正轮         | 严格通过 24/45                         | 单轮结果，不等于累计 36/45，也不是 `.143` 的全量成绩  |
| Sol 跨版本覆盖             | 45/45                                  | 包含修正项目源码，不是同版本、同源码的一次全量通过    |
| OpenAI `.140` 四项冻结补测 | 正常生成 4/4，独立验收及端到端通过 2/4 | 两项仍未通过；不能与其他源码的结果拼接成同条件成绩    |

依据：[任务总账](../../cli/verify01-36-plus-9-task-list.md)、[四项冻结补测](../../cli/verify01-openai-140-frozen-four-20261103/README.md)。这些样本不能直接用于 Claude Code、Codex 与本项目的同题排名。

[历史 harness 审计](../../cli/verify01-openai-140-frozen-four-20261103/harness-audit-20261104/README.md)曾确认：工具读取成功的合法源码，在出站投影中被错误省略；部分恢复提示也无法实际执行。该记录已有修复及离线回放证据，本文将其作为诊断体系的教训，不将历史缺陷再次列为当前未修复问题，也不沿用旧记录中的“尚未发行”作为当前发行结论。修复记录不能自动把原失败样本改为通过。

建议沿用 OpenAI 的分层评测方法，在同一组任务上区分工具测试、独立模型调用循环和实际产品运行环境；不同层的成绩分别记录，再定位差异。[官方评测方法](https://developers.openai.com/cookbook/examples/partners/harness_aware_plugin_evals/harness_aware_plugin_evals)

下一步应补齐最终出站请求中源码、规则、工具结果的可见性诊断，将失败归因为模型错误、上下文遗漏、工具错误、宿主接线或验收环境。诊断复用现有来源、摘要和脱敏机制，不默认公开完整原始请求。

建议按准确发行组合报告任务成功率、人工接管次数、完成时间和每项合格交付成本。已有样本和失败记录保持原身份；“已测试样本暂不重测”的既有边界继续有效，后续验证范围另行明确，不为改善累计数字自动重跑。

**3. P1：把恢复能力验收到整个任务生命周期**

源码已经接入 Goal 工具证据、工作区版本绑定和显式独立检查器，检查点保存失败也已能阻断相关续跑。这些属于已有能力，剩余工作是跨入口组合验收。依据：[Goal 证据绑定](../implementation/cli-ide-goal-workspace-progress-2026-10-29.md)、[独立检查器](../implementation/cli-ide-goal-verification-progress-2026-10-29.md)、[Headless Runner](../../../../packages/cli/src/runtime/headless-runner.js)。

Codex App Server 对持久目标、线程恢复、取消与运行中追加输入提供明确协议；例如 `turn/steer` 通过 `expectedTurnId` 绑定当前执行回合。[官方协议](https://learn.chatgpt.com/docs/app-server)

建议复用项目现有事件和任务身份合同，验收以下完整旅程：

> 执行任务 → 追加修改要求 → 压缩上下文 → 断网或退出 → 重启恢复 → 查看产物与费用。

验收重点是要求不丢失、任务不串线、外部操作不重复提交、未知结果不误报成功。CLI、双 IDE、多会话和后台后代进程应分别验证；单个模块的取消或恢复测试不能代替整个旅程。证据断点包括完整崩溃窗口、交互 REPL、双 IDE 恢复和未结算请求核对。

**4. P2：将 MCP 服务端长任务列为能力核查与实现候选**

Claude Code 的 MCP Tasks 当前处于公开测试阶段，可在服务端受理后后台跟踪，并在符合条件的会话恢复后继续获取结果。远端任务可能在客户端退出后继续执行；本地 stdio 服务则受进程生命周期限制。取消请求不保证远端已经停止。[官方 MCP 文档](https://code.claude.com/docs/en/mcp)

本次在 `packages/cli/src`、`packages/agent-sdk`、`packages/session-core` 和 `desktop-app-vue/src/main/mcp` 的 JavaScript / TypeScript / CommonJS 文件中检索，未发现 `tasks/get`、`tasks/result`、`tasks/cancel` 或 `taskSupport` 的匹配。这是有限静态检索结果，不足以证明所有依赖、动态实现和其他入口均不支持该协议。

现有 Cowork 任务、后台子代理、MCP 调用账本与恢复机制应继续复用，但它们本身不证明标准 MCP Tasks 的端到端支持。先核查协议能力协商与真实服务端行为，再确定实现范围。

若纳入实施，建议覆盖：

- 持久绑定服务器身份、远端任务 ID 和所属会话。
- 查询进度、恢复跟踪、领取结果及发送取消请求。
- 区分停止本地等待、已发送取消与远端确认终止。
- 结果未知时先核对，防止重复构建、导出或写入。

验收应包含断线、客户端重启、服务端任务过期、撤权和重复结果投递，并验证任务结果不会错误注入其他会话。

**5. P1 / P2：用真实交付成本验证上下文优化，并单独完成付费准入**

项目已有中文工具检索、Skills 按需加载和紧凑 MCP 目录。[工具搜索代码](../../../../packages/cli/src/runtime/mcp-tool-search.js)仍默认使用 `stubs`，`compact` 为显式启用。

[上下文来源账本](../../../../packages/cli/src/lib/context-source-ledger.js)的报告仍明确返回 `currentRequestVerified:false` 和 `billingVerified:false`。这说明该来源报告本身没有完成最终请求及账单核验，不代表项目所有 usage 记录均缺失。

建议比较 `stubs` 与 `compact` 时，同步观察工具召回、误调用、额外搜索、缓存命中、任务通过率和实际用量。核心指标应为每个通过独立验收的任务消耗的总时间、请求、token 与费用；目录估算 token 降低不能直接推导相同比例的真实费用下降。真实账单未知时继续明确标注未知。

本批另完成一个有限真实 provider 宿主往返：200 工具目录下，火山模型先通过 `tool_search` 选择目标工具，生产 `executeTool` 宿主执行本地无网络 MCP fixture，再把结果回传给模型确认 marker；3 次 provider 请求、搜索结果 1 个、宿主参数和最终 marker 均核对通过。该回执证明 provider → 宿主授权 / 执行 → 结果回传链路的有限样本，不代表外部 MCP 服务、稳定成本、账单或生产准入。见[真实 MCP 宿主往返回执](../../../cli/evidence/mcp-context-real-volcengine-host-roundtrip-20261108/README.md)。

正式付费准入另行处理：[预算传输代码](../../../../packages/cli/src/lib/formal-budget-transport.js)仍保持 `paidReady:false`，说明 Agent、Chat、压缩、advisor、探针、重试和子进程出口尚未全部路由到同一 authority。

对准备承诺的生产范围，按平台 × provider × 入口 × 进程类型核对请求预留、结算、取消、崩溃、回滚和恢复。未知用量继续保留未决状态；只有对应组合通过才调整该范围的 readiness。这是相关付费承诺的前置条件，不阻塞所有无模型工程工作。

**6. P1：让上游更新更快转化为兼容证据和行为回归**

[Codex 兼容清单](../../../../packages/cli/src/lib/codex-app-server-support.js)在初次审核时已统一，当时 schema / turn 探针配置覆盖 `.160/.164`，App Server 默认关闭且未生产准入；旧版本的实验允许列表另列。清单配置、探针通过、默认启用与生产准入是不同状态。生产路径与实验 App Server 的边界继续按原评审保留。

建议对 `.167` 补协议、事件交错、取消、断流、恢复和历史分页验证，再决定是否调整支持范围。已接受的任务不能因协议回退被重复启动。

[冷扫描历史记录](../implementation/cli-ide-codex-scan-progress-2026-10-29.md)中，Windows 下 `.160/.164` 两线程样本的首次冷升序扫描只发现 1/2，却声明分页结束。这是特定旧版本、查询路径和样本的结果；后续已知线程恢复不能弥补首次发现遗漏，也不能未经测试推断 `.167` 仍有同一缺陷。

本次上游更新可转化为以下回归候选：

| 上游变化                                           | 本项目建议验证的行为                   |
| -------------------------------------------------- | -------------------------------------- |
| Codex 切换 provider 后保留历史，切换后端时保留草稿 | 历史仍可读，不能恢复时给出明确续接方式 |
| Codex 压缩计入失败响应及缺失 usage 的保留输出      | 失败请求留下的上下文也纳入容量判断     |
| Claude 修复恢复后长 MCP 调用结果丢失               | 结果正确归属并送达原任务               |
| Claude 改进 Windows 配置保存                       | 文件占用、进程中止时不留下空配置       |

以上来自 [Codex 更新日志](https://learn.chatgpt.com/docs/changelog)与 [Claude Code 更新日志](https://code.claude.com/docs/en/changelog)，属于回归候选，并非本次已复现的项目缺陷。

模型能力维护也应区分产品可用、API 可用、目标账号可用和运行时已验证，并跟踪协议、上下文、缓存、reasoning、价格、地区与退役。项目已有 Terra 精确 profile 等实现；剩余是官方字段变化、目标端点和实际账单的验证闭环，不能重复立项为“添加 Terra”。依据：[模型能力实施记录](../implementation/cli-ide-terra-model-progress-2026-10-29.md)、[模型审查代码](../../../../packages/cli/src/lib/model-catalog-review.js)。

**7. P1：按真实用户旅程验收 IDE 与桌面入口**

首次配置、配置三态、共享模型推荐和会话级模型切换已有实现。建议继续验收：

> 干净安装 → 连接账号 → 首个任务 → 查看和应用修改 → Stop → 重启恢复 → 升级。

应特别验证 A 会话切换模型时 B 会话继续运行，以及全局凭据变更时用户能理解受影响任务。三系统无模型宿主夹具不能替代真实账号首次任务与完整双任务旅程。依据：[首次配置](../implementation/cli-ide-llm-onboarding-progress-2026-10-27.md)、[会话隔离](../implementation/cli-ide-session-model-progress-2026-10-27.md)。

[记忆与通知组合 GUI 记录](../../agents/evidence/dmm-native-workspace-2026-11-07/README.md)曾发现 Vue 对象无法跨 Electron 原生序列化，以及通知数据库 wrapper 接线不匹配。记录已有修复与局部回归，但尚未声明完整组合旅程通过。普通函数替身遗漏这些问题，说明真实 Electron、IDE 和原生数据库组合验收仍有必要。

继续补充键盘、读屏器、升级和安装迁移回退。Microsoft Marketplace 按既定范围暂缓，不作为其他工作的共同阻塞项。npm 保持 GitHub Actions OIDC Trusted Publishing、准确提交的完整系统门禁，以及子 npm 包 → CLI → IDE → 移动 / PC 客户端的发行顺序。

**8. P2：同时验证 Memory 冷查询性能与记忆质量**

[历史 `.131` 固定运行时测量](../implementation/cli-ide-memory-slo131-progress-2026-10-29.md)中，Windows 100K 分类列表查询热 p95 为 178.866ms，冷 p95 为 2258.233ms，未满足当时提出的 1s 冷查询目标。该结果只覆盖指定列表场景，每格 100 次采样；冷指新 Node 进程，未清空操作系统缓存，计时也不包含进程导入和夹具构造。

这些数字不代表当前 HEAD、全部语义检索或跨平台 SLO。保存前工作区的 `memory-query-index.js` 和 `segmented-memory-port.js` 已有未提交的按需 posting 构建改动，本次不改动、不复测，也不据此宣称性能改善或正确性通过。

建议在固定硬件与数据集下减少规范化、校验和锁内计算成本，同时保留损坏检测、版本绑定与全量参考一致性。按需构建应确认不会跳过原有输入拒绝条件；历史原型发现过相关边界，当前改动仍需自己的证据。

记忆质量还应独立衡量：召回相关性、旧规则覆盖新规则、错误记忆纠正，以及删除或撤权后是否继续进入上下文。查询速度、语义质量、取消响应和恢复正确性分别验收。

**9. P2：减少跨入口重复接线，并精简常驻指导内容**

[Agent Core](../../../../packages/cli/src/runtime/agent-core.js)、[Agent REPL](../../../../packages/cli/src/repl/agent-repl.js)和 Headless Runner 仍承担大量执行接线。建议围绕完成判定、上下文组装、费用结算及取消恢复逐步提取共享逻辑，保留入口之间有意设计的差异。以状态一致性、修改影响范围和故障定位能力验收，不以拆分文件数量衡量完成度。

常驻仓库指导可借鉴 Claude 的做法，保留关键命令、约束和代码无法直接说明的易错点，将历史测试介绍改为按需文档链接。[Claude 官方最佳实践](https://code.claude.com/docs/en/best-practices)

根 AGENTS 中较长的历史测试统计可作为精简候选，但不得丢失现有发行顺序、OIDC、准确提交门禁或其他有效约束。本文未修改这些指导文件。

**10. 建议执行顺序与完成标准**

| 优先级    | 工作                        | 完成标准                                                                       |
| --------- | --------------------------- | ------------------------------------------------------------------------------ |
| P1        | 实际输入诊断、剩余任务归因  | 能解释模型实际看到了什么，失败原因有可追溯证据；成绩绑定版本和任务范围         |
| P1        | 跨入口恢复及真实 IDE 旅程   | 要求不丢失、任务不串线、副作用不重复；首次安装、Stop、恢复、升级有实际入口证据 |
| P1        | Codex `.167` 兼容与上游回归 | 探针结果、默认支持和生产准入分别记录；冷扫描与已知线程恢复分别验收             |
| P2        | MCP Tasks                   | 先确认能力缺口，再验证受理、恢复、取消、结果去重及失联语义                     |
| P2        | 紧凑目录与 Memory           | 真实任务 A/B、冷 / 热 / 混合 SLO 与语义质量均有明确范围                        |
| P2        | 共享逻辑与指导文档          | 跨入口行为更一致，故障更易定位；保留有效规则                                   |
| 条件性 P0 | 正式付费及目标 native 承诺  | 对应范围的预算、出口、宿主与恢复准入通过后才扩大承诺                           |

**保存前审核修正**

- 将历史已修复的 harness 缺陷改为诊断体系教训，避免误写为当前待修复问题。
- 将 MCP Tasks 的判断限定为本次静态检索未找到标准方法证据，保留动态实现和依赖未覆盖的边界。
- 将 Memory 数据限定为历史固定版本，并注明当前工作区已有未验证改动。
- 分开表述目录估算、provider usage、真实账单，以及累计任务覆盖、单轮结果和当前发行准入。
- 保留原评审、历史失败、Microsoft 渠道暂缓及已测试样本暂不重测等既定边界。

本文为建议文档，不构成新测试通过、生产准入、发行或模型优劣证明。

第 4 项实验性协议入口及 236 项相关测试见[MCP Tasks 实施记录](../implementation/cli-ide-mcp-tasks-progress-2026-11-08.md)，代码提交 677b9c35e968426fefdcf3697cac5769428f4229。此前第 4 节静态检索结论属于历史基线；本批已新增标准方法，但 durable 任务账本及宿主完整旅程仍未完成。

第 4 项后续已接入可用的 durable CLI：原调用账本与任务日志联合投影、OS Secret Store、身份校验、取消核对及离线结果缓存。Windows DPAPI 子进程崩溃恢复和 303 项相关测试见[持久化实施记录](../implementation/cli-ide-mcp-task-durable-progress-2026-11-08.md)。本批代码提交为 2cde23e9f7e950992692b52192cd38b7be5cd6f8；完整模型继续与原生双 IDE / 桌面任务旅程仍未完成。

第 4 项后续实现提交 525f088b5a7f20e4479cb03813cf49080f14489f，加入原子任务交付及真实用户显式续跑：24 文件 664 通过、4 个平台条件跳过，4 项真实签名 / HTTP 协议组合及 Windows 交付后 SIGKILL 去重证据见[交付实施记录](../implementation/cli-ide-mcp-task-delivery-progress-2026-11-08.md)。第 9 项同步抽出共享纯投影；自动模型任务路径与其余原生旅程仍未完成。

本次在当前主分支复核 MCP Tasks 相关 6 个定向单测文件，共 114 项全部通过（需要允许本机回环端口和 Windows ACL 校验的测试环境）。在受限沙箱直接运行时，失败原因分别为 `EACCES 127.0.0.1` 和 `owner-only native ACL verification failed`，未作为代码回归计入；该结果只证明当前实现的专项回归可复现通过，不能替代真实第三方任务服务、模型后台跟踪、双 IDE / 桌面组合旅程或多平台验收。

第 2 项跨阶段来源映射实现提交 e94c1f49bb3dafc83dcb4cabd4fff48c98e776a4，见[后续实施记录](../implementation/cli-ide-model-input-mapping-progress-2026-11-08.md)：规划私有请求摘要、签名投影位置、Chat / Responses / Anthropic / Ollama 转换位置共同绑定实际准备的 HTTP 正文。17 文件最终回归 182 项通过；完整 production composition 文件在独立单实例依赖布局下 288 项通过；基线与首次失败分别保留。没有将部分来源截断报为完整覆盖，双 IDE 新明细及真实独立任务仍待完成。

当前主分支随后复核了模型输入诊断、来源映射、会话查询和 Agent Evolution 组合的 4 个 CLI 测试文件，最终结果为 **331/331 通过**。组合用例运行中打印的受控拒绝（ask evidence denied、response evidence denied、Run 绑定失败）均由测试验证错误边界，最终没有转化为失败项；该结果仍不替代双 IDE 的真实独立任务、逐来源完整映射和真实账单核验。

当前主分支的 VS Code 模型输入诊断单测进一步复核为 **10/10 通过**，覆盖命令注册、参数注入防护、白名单投影、会话切换、异步文档竞态和 per-source sourceMapping 投影。JetBrains 同名 Gradle 单测在本机无法连接 Gradle daemon（daemon 监听本机回环端口后客户端连接失败），保留为环境阻断；本地 `javac --release 17` 语法/类型检查通过，不把它扩大为当前主分支 Gradle 通过；双 IDE 真实 canonical 任务旅程仍未完成。

随后使用本机 VS Code 1.96.2 的真实 `Code.exe` 运行原生 Extension Host 模型输入诊断脚本，结果 `status: passed`、退出码 0，验证命令注册、编辑器快照和 CLI 进程夹具；回执明确 `realCanonicalSessionJourney:false`，因此仍不宣称真实 canonical 会话或双 IDE 组合旅程完成。

当前主分支还复跑了真实 CLI REPL 进程的硬杀恢复旅程：`repl-inflight-recovery-e2e.test.js` **2/2 通过**。测试覆盖原请求在 SIGKILL 后保持未知、恢复同一会话并提交一个新的独立请求，未把它扩展为双 IDE、OS PTY、预派发输入持久化或完整费用闭环的通过证明。

本次 durable MCP Task 原生探针完整回执已归档于 `../implementation/evidence/mcp-task-durable-20261108/native-rerun-current.json`，并绑定运行时 `sourceCommit`。回执确认 Windows DPAPI、loopback HTTP、受理后 / 结果保存后 / 交付后 SIGKILL、跨进程恢复和一次性重复交付；`offlineProductCliVerified:true` 已由真实产品 CLI 离线列表核对，`modelContinuationVerified:false` 仍保持未完成边界。

第 8 项新增实现已合入当前主分支提交 74a4140af：增加固定 SciFact 输入校验、离线向量完整性校验、二值 qrels 约束、Recall@1/5/10、MRR@10、nDCG@10 及确定性排序回归。memory-semantic-quality.node-test.mjs 当前 **6/6 通过**。这是可复核的离线评测基础设施，不等于生产 Memory 候选源已接入，也不替代冷/热/混合 SLO、中文/多语言质量、真实用户任务或三系统准确提交门禁。

第 2 项现已把 CLI 的逐来源规划 / 逻辑映射 / 协议正文映射投影接入 VS Code 和 JetBrains 的只读解析器：仅保留 digest、索引、状态、原因、协议路径和字节等白名单字段，拒绝任意正文、未知路径和越界数组。VS Code 回归为 **10/10 通过**；JetBrains 纯 JDK 解析源在本机 JDK 17 下 javac --release 17 通过。真实 canonical 双 IDE 任务旅程、真人可访问性和 provider 账单仍未验收。

第 4 项原生 Windows 回执已更新为 native-rerun-current.json：新增真实产品 CLI `mcp tasks list --session <id> --json` 离线读取并核对已保存 / 已交付记录，offlineProductCliVerified:true，同时保留受理后、结果保存后和交付后 SIGKILL、DPAPI 恢复及重复交付去重。modelContinuationVerified:false 仍明确表示该原生探针未覆盖模型后台自动跟踪 / 唤醒；REPL 的 opt-in 接线见后文。

第 5 项当前证据边界已细化：有限 Volcengine provider 回执包含每次请求的 input/output/cache usage 和 deferred/full A/B 结果，并核对目标工具、错误调用及响应摘要；但项目仍把 billingVerified 标为 false，因为 provider 返回的 usage 不能替代实际账单或正式付费准入。

### Durable MCP Task watch 增量

本次新增 durable runtime 的显式 `watch` 路径：它在持有 session lease 的前提下按有界间隔轮询，遇到远端终态后保存结果并以已有 delivery 事件去重交付；不会自动注入模型历史，也不会启动新的模型回合。`mcp-task-runtime.test.js` 当前 13/13 通过，覆盖轮询终态、结果保存和重复交付。该实现补齐了 session-owned tracking 的安全边界，但 `modelContinuationVerified` 仍保持 false，自动唤醒仍需后续真实 REPL / IDE 旅程验收。

本次继续接入真实 REPL：新增显式 /mcp-watch [local-id]，在当前 canonical session lease 下启动 tracker，并在 REPL 关闭时停止。设置 CC_MCP_TASK_AUTOWAKE=1 后，已验证 delivery 会排入有界 continuation queue，复用普通 turn 的预算、lease、turn binding 和持久化；默认关闭，且结果仍以外部引用身份进入上下文。MCP Tasks 与 REPL 交互定向回归为 116 项通过；完整模型自动唤醒的真实 provider / 双 IDE / 桌面旅程仍待验收。

补充边界：watch 现尊重服务端声明的 pollInterval，并对本地 interval/timeout 执行有限整数和上下界校验；启用 CC_MCP_TASK_AUTOWAKE=1 时，REPL 启动会在 listener 就绪后扫描 canonical journal 并恢复 pending tracker。恢复和唤醒仍是显式 opt-in，默认不会产生后台模型请求。

恢复边界进一步收紧：启动扫描现在也包含 resultSaved:true 但尚未 delivery 的记录，watch 会复用已保存结果而不重新请求远端，并通过既有 deliveryId 去重；对应 crash-after-result-save 回归已加入 runtime 测试。

Auto-wake 崩溃恢复现在以 deliveryId 绑定 continuation prompt：启动时对已交付但没有对应 settled user prompt 的 delivery 重新排队，对已有 settled prompt 的记录跳过，避免重复模型回合。

### 2026-11-09 Volcengine live probe boundary

??????????????????????? key ??? Volcengine endpoint ? deepseek-v4-1-flash-economy-261017 ? bounded live probe?4/4 ??????? HTTP 200???? prompt/output usage?prompt_tokens ? 698?842?1037?2071?completion_tokens ?? 8??????????/????????[`context-token-volcengine-live-probe-20261109`](../../cli/evidence/context-token-volcengine-live-probe-20261109/README.md)?????????? usage capture?4 ????? `unknownCostRequests`?`invoiceAssessed:false`?`outputLimitEnforcementVerified:false`???????????????????????????????????????????????????

Using the authorized key from `H:\code\api\deepseek.txt` only through the process environment and an isolated temporary config, the bounded live probe sent one generated request to the built-in Volcengine endpoint. The receipt was bound to source commit `7e9b7fcc8d7a71ae2600be19b938d65230222e0a`; it recorded `attemptedRequests: 1`, `requestCount: 0`, `unknownCostRequests: 1`, and `invoiceAssessed: false`. The request settled as `RESPONSE_OR_TRANSPORT_FAILED` without persisting response content, usage, response ID, or credentials. This is evidence that the probe path reached the request boundary, but it does not verify provider usage, billing, A/B context behavior, or production readiness; those acceptance items remain open.

### 2026-11-09 Codex cold-scan receipt archive

The `.160` and `.164` zero-turn replay, environment, launcher-registry, and native-registry receipts are now archived in [`codex-cold-scan-0160-0164-20261109`](../../cli/evidence/codex-cold-scan-0160-0164-20261109/). Both replay receipts remain failed: the ascending cold scan found only 1/2 entries, with no provider request and no turn-start request. The archive preserves the failure evidence and does not claim `.167` or three-system compatibility.
第 2 项新增组合回归：[`model-input-diagnostics.test.js`](../../../../packages/cli/__tests__/unit/model-input-diagnostics.test.js) 的 canonical planning / durable signed readback / governed fetch 两个用例 **2/2 通过**，同一 `requestId` 与 `attemptId` 贯穿阶段顺序，并验证 readback 失败时不会 dispatch。该证据使用本地 loopback/受控签名 fixture，不替代真实 provider 或双 IDE 任务旅程；同文件既有两个真实 loopback 用例在当前 Windows 沙箱中仍因 `EACCES 127.0.0.1` 未通过。组合回归的命令、源码提交和环境边界已固化到[`model-input-composition-20261109`回执](../../cli/evidence/model-input-composition-20261109/README.md)。第 3 项真实 REPL/SIGKILL 旅程已在当前提交重跑，但子进程在首个 prompt 前触发 `owner-only native ACL verification failed`，没有进入 provider 请求或恢复阶段；该环境阻断回执已归档于[`repl-inflight-recovery-20261109`](../../cli/evidence/repl-inflight-recovery-20261109/README.md)，因此不把历史 2/2 回执扩大为当前提交通过。第 8 项离线语义质量回归已在当前提交重跑并通过 **6/6**；指标、qrels、float32 完整性和确定性排序回执已归档于[`memory-semantic-quality-20261109`](../../cli/evidence/memory-semantic-quality-20261109/README.md)。该回执仍明确不替代生产 Memory 接入、冷/热/混合 SLO 或真实用户任务质量验收。第 9 项用量归因单元回归在当前提交通过 **12/12**；相关 transcript 集成回归仅 2 个解析用例通过，7 个需要严格 Windows session store 的用例因 owner-only ACL 环境阻断。结果已归档于[`usage-attribution-unit-20261109`](../../cli/evidence/usage-attribution-unit-20261109/README.md)，不宣称跨入口生产旅程完成。随后在具备 Windows owner-only ACL 的受控权限下于提交 `011b3c916` 重跑同一旅程，测试 **1/1 通过**：原请求被 SIGKILL 后保持 unknown，恢复阶段仅接纳 1 个新请求，旧请求 replay 为 0，并产生可见恢复提示。该提升权限回执与非提升环境阻断回执并列保存于[`repl-inflight-recovery-20261109`](../../cli/evidence/repl-inflight-recovery-20261109/README.md)；这证明 CLI/REPL 恢复旅程，但仍不等于双 IDE、桌面或付费 provider 全链路验收。同一提升权限环境下完整 `repl-inflight-recovery-e2e.test.js` 套件随后 **2/2 通过**；受控回执已补充完整套件命令和计数。第 4 项 durable MCP 七个定向测试文件在 owner-only ACL 可用环境中于提交 `354235664` 重跑，**118/118 通过**；当前回执见[`mcp-task-targeted-20261109`](../../cli/evidence/mcp-task-targeted-20261109/README.md)。该结果仍不覆盖真实第三方服务、模型 continuation、双 IDE/桌面或多平台验收。在 owner-only ACL 与 loopback 可用环境中，完整 `model-input-diagnostics.test.js` 于当前源码重跑为 **20/20 通过**；此前非提升沙箱的 `EACCES 127.0.0.1` 仅作为环境边界保留，不再代表当前实现失败。在 owner-only ACL 可用环境中，用量归因 unit 与 transcript 集成回归于提交 `878b288a6` 通过 **19/19**（12 个 unit、7 个 transcript）；当前回执已更新，先前非提升环境的 ACL 阻断保留为历史边界。第 6 项 Codex App Server 当前六个 schema/support/turn/history 单测在提交 `aba189fc7` 通过 **137/137**，回执见[`codex-app-server-137-20261109`](../../cli/evidence/codex-app-server-137-20261109/README.md)。该结果是静态/本地兼容证据，仍不替代准确 `.167` native 协议、取消恢复和三系统 CI 回执。

### 2026-11-09 Codex 0.164 scan-repair rerun

Using the exact current source commit `72fe88974308bad8f9fea6acc078a3ec811f39e5`, the local official Codex 0.164.0 fixture was rerun with `--scope scan-repair`. The strict probe failed at `cold-asc:first-scan`: the first cold page sequence returned one of two expected identities. Later full-read and known-ID recovery observations were retained but did not promote the incomplete first scan. The negative receipt is archived in [`codex-history-scan-repair-0164-20261109`](../../cli/evidence/codex-history-scan-repair-0164-20261109/). This strengthens the failure boundary; it does not close exact `.167` native, cancellation/recovery, or three-system CI acceptance.

### 2026-11-09 JetBrains scripted journey rerun

Four repository-hosted JetBrains journey/evidence suites passed **85/85** with Node's test runner. The receipt is archived in [`jetbrains-scripted-journey-20261109`](../../cli/evidence/jetbrains-scripted-journey-20261109/), with `realIdeHostVerified:false` and `gradleUiHostVerified:false`; this improves scripted contract coverage without claiming a live IntelliJ, dual-IDE, desktop, or accessibility journey.

2026-11-09 MCP 后续：显式新版协议、等待期限修复及官方独立参考服务的 Windows 多进程验证见[MCP 实施记录](../implementation/cli-ide-mcp-stateless-reference-progress-2026-11-09.md)和[原始证据](../../cli/evidence/mcp-tasks-reference-stateless-20261109/README.md)。第 4 项仍为 partial；本地参考服务不能替代生产远程服务、真实模型续跑或多平台验收。

2026-11-09 MCP 续跑后续：消费凭据、真实输入保留、三种 Windows REPL 窗口及 HTTP 429 未决回执见[续跑实施记录](../implementation/cli-ide-mcp-continuation-authority-progress-2026-11-09.md)。真实模型成功消费仍未验收，不把未知用量改成零费用。

## Completion audit snapshot (2026-11-09)

This table records the November 9 audit. The completion table at the top of the plan includes later evidence.

| Scope                                      | Current evidence                                                                                                                                                                                                                        | Audit result                                                                                                                          | Remaining gate                                                                                                                      |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Item 2: actual model input and attribution | Native VS Code real task at bcce11f maps all four physical requests with 8 canonical diagnostics and 50/50/51/52 sources; JetBrains real task assertions passed with retained cleanup failure                                           | Partial                                                                                                                               | Broader independent tasks/failure attribution; JetBrains unadapted mapping, safe teardown and cross-platform acceptance remain open |
| Item 3: lifecycle recovery                 | Source-bound recovery archives plus bcce11f real VS Code file task, visible canonical final result and actual IDE restart with zero new model requests; conditional JetBrains fixture recovery retained                                 | Partial                                                                                                                               | Complete cross-entry task/steer/compaction/disconnect recovery, safe teardown and multiplatform acceptance remain open              |
| Item 4: MCP Tasks                          | Durable continuation and 3/3 crash windows, 755/755 regression; one real Volcengine DeepSeek continuation passed HTTP 200 with independent settled readback and no duplicate dispatch after REPL restart                                | Partial                                                                                                                               | Remote production service, input continuation, expiry/revocation, dual IDE/desktop and multiplatform remain open                    |
| Item 5: cost/context/paid admission        | Volcengine bounded diagnostic and live provider output-cap checks passed; official time-windowed CNY price for the exact economy model is archived; 6-request cap receipt, usage captured, cancellation settlement preserved as unknown | Partial, transport/compaction/cancellation and official price lookup verified; settlement remains unpriced in the fixed USD estimator | Invoice reconciliation, native-currency/time-window settlement integration, and target-scope paid readiness                         |
| Item 6: Codex compatibility                | Current HEAD `.167.0` Windows native turn and database recovery passed; strict cold scan fails first 1/2 identity; static suite 137/137                                                                                                 | Partial current-HEAD Windows native evidence                                                                                          | Three-system CI, Linux/macOS native cancellation/recovery, and model-change closure                                                 |
| Item 7: IDE/desktop journey                | Windows installed-VSIX fixture journeys and one original real-provider file/result/restart journey passed under temporary loopback conditions; native JetBrains task/UI/restart assertions retain overall cleanup failure               | Partial                                                                                                                               | Stock-host ingress, exact-head platform/desktop matrix, full lifecycle, accessibility and upgrade/rollback remain open              |
| Item 8: Memory quality and responsiveness  | Semantic quality, current responsiveness, and production source wiring verification archived                                                                                                                                            | Partial                                                                                                                               | Cross-platform cold/hot/mixed SLO and multilingual real-user tasks remain open                                                      |
| Item 9: shared logic/guidance              | Shared source-bound diagnostic projections; stream observer persistence fixed and real-body mapping verified; JetBrains history trace captures complete; conditional standard Gradle build and standing guidance retained               | Partial                                                                                                                               | Unconditional/cross-platform acceptance, full safe lifecycle and independent desktop failure localization remain open               |

The plan therefore remains open. The unresolved rows require an external provider invoice, a missing official native artifact or CI matrix, or live IDE/desktop hosts; no local fixture result is promoted to close those gates.

### 2026-11-09 Existing Codex 0.167 native receipt promoted into the audit

The repository already contains a source-bound `.167.0` Windows x64 native evidence pack at [`codex-167-20261108`](../implementation/evidence/codex-167-20261108/), commit `e55e99ca22eda1f202d516e42ef306ee9cf28af6`. `fixed-turn.json` passed real native turn, approval cancellation, interleaved threads, and post-admission transport-loss handling; `fixed-database.json` passed process-restart database/history recovery without replaying the completed request. `fixed-scan-repair.json` remains a strict failure for the first cold scan, while later repair observations are retained. The pack explicitly records `realProviderAcceptance:false` and `productionAdmission:false`. Because the adapter/probe/history sources changed after `e55e99ca22eda1f202d516e42ef306ee9cf28af6`, the historical pack is not current-HEAD native evidence; the source-drift boundary is recorded in [`codex-167-current-head-boundary-20261109`](../../cli/evidence/codex-167-current-head-boundary-20261109/).

### 2026-11-09 Codex `.167` CI status readback

Read-only GitHub verification for `e55e99ca22eda1f202d516e42ef306ee9cf28af6` found the compatibility workflow's `.167` Ubuntu, Windows, and macOS jobs cancelled; the separate cold-scan matrix was also cancelled. Shared manifest/adapter jobs and the `.164` Ubuntu job succeeded. The sanitized status receipt is archived in [`codex-ci-0167-cancelled-20261109`](../../cli/evidence/codex-ci-0167-cancelled-20261109/). This confirms that the Windows `.167` native receipt cannot be promoted to three-system CI acceptance, and no remote workflow was rerun.

### 2026-11-09 Codex `.167` current-HEAD source-drift boundary

The historical `.167.0` Windows native pack is bound to `e55e99ca22eda1f202d516e42ef306ee9cf28af6`, while current `main` includes later changes to the App Server turn/history probe sources (`b60efe3a7c`, `8eadb310ff`, `e4e8eb21a6`, among others). No `.167` native binary is available locally for a current-HEAD rerun. The boundary receipt [`codex-167-current-head-boundary-20261109`](../../cli/evidence/codex-167-current-head-boundary-20261109/) therefore records `historicalNativeReceiptCurrentHeadVerified:false`; current HEAD retains static compatibility evidence only.

### 2026-11-09 Current HEAD native 0.164 rerun

Using the local official Codex 0.164.0 Windows x64 binary, current HEAD `e1cde771c4f3c5508567a0f843184e5b38196698` passed the native turn probe (completed/failed/interrupted scenarios, approval cancellation, interleaved threads, and post-admission transport loss) and the database scope (process restart, same-second thread/turn pagination, settings restoration, and no replay). Receipts are archived in [`codex-current-head-native-0164-20261109`](../../cli/evidence/codex-current-head-native-0164-20261109/). This is current-HEAD native evidence for `.164.0`, not `.167` or production admission.

### 2026-11-09 Current Memory responsiveness benchmark

The current local disk-backed Memory service was measured at 1,000, 10,000, and 100,000 records with three samples in both `validate-disk` and `verified-memory` modes. All 18 samples acknowledged the 10 ms Stop timer, released the authority lock, and met the 500 ms delivery/acknowledgement benchmark target. The receipt is archived in [`memory-responsiveness-current-20261109`](../../cli/evidence/memory-responsiveness-current-20261109/). This is fixed Windows local evidence with warm OS caches; it does not close cross-platform, production-source, multilingual, or real-user SLOs.

### 2026-11-09 Volcengine implementation-plan live diagnostic

The bounded live implementation-plan diagnostic was rerun with the authorized Volcengine key supplied only through the process environment. The user's config was left unchanged; an isolated temporary config supplied a pricing override for `deepseek-v4-1-flash-economy-261017`, because the built-in Volcengine table has no exact rate and correctly fails closed without one. Four requests reached the configured endpoint and returned HTTP 200; stream/usage and read-only tool round-trip passed. Provider-backed compaction fact retention failed its semantic assertion, so the run stopped before the stream-abort check. Estimated spend under the temporary rate was `$0.00039242`; billing, formal pricing, output-cap enforcement, and production admission remain unverified. Evidence: `../cli/evidence/implementation-plan-volcengine-live-20261109/`. The prior no-price run is preserved as a no-egress boundary receipt.

### 2026-11-09 Volcengine implementation-plan diagnostic completed

The live diagnostic harness was tightened after the first run exposed two real boundary issues: structured compaction JSON could be truncated at the ordinary 512-token cap, and the provider could settle a stream after a client abort. The compaction prompt now asks for concise bounded JSON; the diagnostic gives that summary request a separate 1024-token cap. The cancellation check uses a timed client abort, requires one admitted request with no retry, and preserves unknown settlement instead of treating the interrupted call as free. The authorized isolated-config rerun passed **4/4** checks with five requests; one cancellation request remains `usageUnknown:true`, so `totalEstimatedCostUsd` is null. Evidence: `../cli/evidence/implementation-plan-volcengine-live-20261109/`. This closes the bounded transport/compaction diagnostic, but not invoice reconciliation, formal pricing, output-cap enforcement, or production paid admission.

### 2026-11-09 Current HEAD Codex 0.167 native rerun

A locally available official Windows x64 Codex `0.167.0` binary was rerun against current `main` commit `8c4ae22975c661813120fb728404145e848fad16`. The native turn scope passed completed/failed/interrupted turns, approval cancellation, interleaved threads, and post-admission transport loss. The database scope passed process restart, same-second thread pagination, settings restoration, and no replay of a completed request. The strict `scan-repair` scope still fails at the first cold ascending scan because only 1/2 known identities were returned; later repair observations were retained without promoting the incomplete first scan. Evidence: `../cli/evidence/codex-current-head-native-0167-20261109/`. The run uses a synthetic loopback provider and therefore does not close real-provider or production admission.

### 2026-11-09 IntelliJ live-host attempts

The cached IntelliJ 2024.2 distribution was supplied to the repository's live UI-host driver. The default-JDK attempt and an isolated JDK 17 plus IPv4/Gradle-home retry both failed during Gradle preparation because the single-use Gradle daemon could not accept a localhost connection. The generated receipts mark `evidenceComplete:false`; no IDE or Robot host started, so this is a current environment boundary rather than live IDE acceptance. Evidence: `../cli/evidence/jetbrains-live-host-attempt-20261109/`.

### 2026-11-09 VS Code live Extension Host attempt

The real VS Code Extension Host runner launched an isolated VS Code profile, installed the existing VSIX, opened a two-root workspace, and activated the packaged extension. The driver then timed out connecting to the extension's localhost bridge at `127.0.0.1:53123`; the task journey therefore failed even though host/activation evidence is complete. Evidence: `../cli/evidence/vscode-live-extension-host-20261109/`.

### 2026-11-09 Requirement-by-requirement completion audit

The current Item 2?9 status is also recorded in the machine-readable [`cli-ide-gap-completion-audit-20261109`](../../cli/evidence/cli-ide-gap-completion-audit-20261109/README.md) manifest. Every row remains explicitly `partial`, with committed evidence paths and scope-matching remaining gates. The manifest is an audit aid, not a completion claim; the plan stays open until the external provider, native cross-platform, and live IDE/desktop gates are closed.

### 2026-11-09 Three-system desktop E2E CI readback

Read-only GitHub verification of workflow run `42509137812` found successful Windows, Ubuntu, and macOS Electron/Playwright E2E jobs for PR commit `5d62ee9533e3f2f903d55930ca3c0f72a682c642`. Each built the desktop main/renderer and completed the E2E smoke step. This is cross-platform desktop smoke evidence for an older commit; it does not close current-HEAD, full IDE task/recovery, Codex native CI, or paid-provider gates. Evidence: `../cli/evidence/desktop-e2e-ci-42509137812-20261109/`.

### 2026-11-09 latest IDE Extensions CI readback

Read-only GitHub verification of IDE Extensions run 42518446281 passed VS Code host gates on Windows, macOS, Linux, and scoped Remote-SSH, plus browser evidence on all three systems. The JetBrains real-host matrix was skipped and the run is bound to remote commit cdc8f4590a5bc70bf8e2f38ede6127bf40ee621a, so it strengthens the latest remote VS Code/browser baseline without closing current-HEAD, JetBrains real-host, bridge-loopback, or full accessibility/upgrade gates. Evidence: ../cli/evidence/ide-extensions-ci-42518446281-20261109/.

### 2026-11-09 IDE Extensions CI readback

Read-only GitHub verification of IDE Extensions run `42505953777` found successful JetBrains real-host jobs on Linux, Windows, and macOS for IntelliJ 2024.2 and 2025.2. The jobs ran deterministic chat/control/resume plus canonical recovery/Stop journeys and uploaded host evidence; browser evidence also passed on all three systems. VS Code host gates were skipped. The run is bound to older commit `4e4b421bfb42e524f071c9ad70c2a2a2ce607374`, so it strengthens the historical cross-platform IDE baseline without closing current-HEAD or VS Code bridge acceptance. Evidence: `../cli/evidence/ide-extensions-ci-42505953777-20261109/`.

### 2026-11-09 VS Code Host rerun

The repository Extension Host runner was rerun on the current local `main` worktree using the packaged VSIX from the previous live attempt, VS Code 1.145.2, a fresh profile, and `--host-api-only`. The installed VSIX was discovered and activated, and the extension log recorded `bridge up on 127.0.0.1:65215`. The runner's same-host TCP probe then timed out on the advertised port. This reproducibly separates packaging/activation from the unresolved loopback bridge gate; it does not close Item 7. Evidence: `../cli/evidence/vscode-live-extension-host-rerun-20261109/`.

### 2026-11-09 VS Code bridge regression checks

The repository lockfile, IDE doctor, and Extension Host runner contract tests passed **55/55** on the current worktree. These are offline/unit and runner-contract checks; they validate fail-closed diagnostics and evidence handling, but do not override the live Host bridge timeout recorded in vscode-live-extension-host-rerun-20261109.

### 2026-11-09 direct bridge server probe

The production src/mcp-http-server.js was exercised directly on a real Windows loopback port. The MCP initialize request connected successfully, returned HTTP 200 with a session header, and produced valid JSON. This confirms the server implementation and machine loopback path; the unresolved live failure is isolated to the production extension lifecycle inside VS Code Extension Host. Evidence: ../cli/evidence/vscode-bridge-server-direct-20261109/.

### 2026-11-09 VS Code lock and self-probe fixes

The live Host driver was corrected to prefer the current Extension Host PID and newest started_at, avoiding an old same-workspace lock. A rebuilt VSIX then demonstrated the remaining boundary: the extension process could not connect to its own freshly bound 127.0.0.1 listener. The new production self-probe fails closed before publishing a dead lockfile. Runner contracts remain 54/54; the live task journey remains open. Evidence: ../cli/evidence/vscode-live-extension-host-lockfix-20261109/ and ../cli/evidence/vscode-live-extension-host-selfprobe-20261109/.

### 2026-11-09 VS Code self-probe error code

The rebuilt real Host emitted ETIMEDOUT on all five bounded self-probe attempts to its freshly bound 127.0.0.1 listener, then failed closed without publishing a lockfile. A standalone Node probe against the same production HTTP server succeeds. The remaining issue is therefore constrained to the VS Code Extension Host process boundary; Item 7 remains open. Evidence: ../cli/evidence/vscode-live-extension-host-diagnostic-20261109/.

### 2026-11-09 Volcengine provider output cap

The implementation diagnostic was extended with a bounded live provider-cap check. Against the configured Volcengine model, a long-output prompt sent with maxOutputTokens=1 returned usage.output_tokens=1; all five checks passed across six requests. The cancellation request remains unknown-settled and billing/formal paid admission remain unverified. Final receipt: ../cli/evidence/implementation-plan-volcengine-cap-live-20261109/receipt-v4.json, source commit e3714c33e.

### 2026-11-09 Volcengine exact model price readback

The official Ark pricing page and model documentation identify `deepseek-v4-1-flash-261017` and its economy alias. The economy edition is listed at CNY 0.80 input / 0.016 cache-hit / 3.20 output per million tokens during idle hours, and CNY 1.60 / 0.032 / 6.40 during peak hours. The exact-model readback is archived in [`volcengine-model-price-20261109`](../../cli/evidence/volcengine-model-price-20261109/). This closes the official price lookup, but not invoice reconciliation or paid admission: the provider price is time-windowed and native-currency, while the current estimator requires fixed USD rates and therefore intentionally returns `matched:false` for the exact economy alias.

### 2026-11-09 Memory production source wiring current-source verification

The archived real BGE smoke evidence was checked with `node docs/cli/evidence/local-memory-semantic-20261108/verify-evidence.mjs --check-current-sources` on the current `main`. Verification passed: six executable source hashes still match the real smoke, and the smoke had asserted all three production entries (CLI `search`, scoped recall, and provider-context planning), semantic-off controls, and three real worker launches. This closes the production source wiring sub-gate for the current source hashes. It does not close cross-platform cold/hot/mixed SLO, multilingual relevance, or real-user task quality; the archive still records `fullQualityAccepted:false` and `performanceAccepted:false`.

### 2026-11-09 Current HEAD lifecycle recovery suites

Current `main` commit `eb3579908173f2f8f5da8075048c3c12b72282c0` passed the independent-process Compaction/Memory restart E2E suite **4/4** and the headless side-effect ledger resume suite **12/12**. The latter includes fail-closed persistence/readback, interrupted dangerous operations, clean completion, duplicate committed-effect detection, zero-duplicate correct resume, unknown background outcomes, and interaction recovery. The receipt is archived in [`lifecycle-recovery-current-20261109`](../../cli/evidence/lifecycle-recovery-current-20261109/). These close the local compaction and side-effect-idempotence sub-gates only; dual-IDE recovery, concurrent input during restart, and the complete cross-entry journey remain open.

### 2026-11-09 Current HEAD concurrent-input recovery

The real CLI/readline/Evolution/JSONL and loopback REPL recovery suite passed **2/2** on current `main` commit `fb1cfe3a4352867ea99a9918d6a8271b729e98cf`. The journey killed an unsettled request, supplied new input immediately while restart/recovery overlapped, admitted exactly one new request, replayed the old request zero times, preserved unknown settlement, and emitted a visible recovery notice. The sanitized receipt is archived in [`repl-inflight-recovery-current-20261109`](../../cli/evidence/repl-inflight-recovery-current-20261109/). The test uses emulated stdin and a loopback fixture; dual-IDE and complete cross-entry recovery remain open.

### 2026-11-09 Current HEAD CLI/VS Code projection checks

The current `main` commit `99c8a598a0c6553f1273e365d90b557943c7a82f` passed the four CLI model-input/source-mapping suites **52/52** and the VS Code model-input diagnostics suite **10/10**. These checks cover bounded allowlisted projections, source mappings, session ownership, stale-result rejection, and command argument safety. The receipt is archived in [`cross-entry-projection-current-20261109`](../../cli/evidence/cross-entry-projection-current-20261109/). This narrows Item 9's remaining scope, but JetBrains live runtime and independent IDE/desktop failure localization remain unverified.

### 2026-11-09 Current HEAD accessibility/performance contract checks

The current `main` commit `c98efe3f78c3c6a359375a4d1f101576070a24ee` passed the deterministic accessibility/performance validator suite **30/30**. It covers accessibility tree/transcript, focus, performance evidence, diagnostics scale and provenance contracts. The receipt is archived in [`accessibility-performance-contract-current-20261109`](../../cli/evidence/accessibility-performance-contract-current-20261109/). This strengthens the non-host contract layer but does not replace real IDE accessibility, screen-reader, upgrade/rollback, bridge or current-HEAD desktop acceptance.

### Current evidence index (2026-11-09)

The completion manifest is [cli-ide-gap-completion-audit-20261109](../../cli/evidence/cli-ide-gap-completion-audit-20261109/manifest.json). Recent evidence bound to the local audit includes:

- Memory responsiveness rerun: [memory-responsiveness-rerun-20261109](../../cli/evidence/memory-responsiveness-rerun-20261109/) - 66/66 local Windows samples met the 500 ms cancellation acknowledgement target; cross-platform and multilingual admission remain open.
- Current-main Volcengine diagnostic boundary: [implementation-plan-volcengine-live-current-20261109](../../cli/evidence/implementation-plan-volcengine-live-current-20261109/) - 3/4 bounded checks passed; compaction fact-retention failed closed with no retry and no response text persisted, so Item 2 remains partial.
- Current-main Volcengine acceptance rerun: [implementation-plan-volcengine-live-current2-20261109](../../cli/evidence/implementation-plan-volcengine-live-current2-20261109/) - 5/5 bounded checks passed across six requests; cancellation settlement remains unknown and this is not invoice or formal paid admission.
- Current-main project-goal task boundary: [project-goal-volcengine-live-current-20261109](../../cli/evidence/project-goal-volcengine-live-current-20261109/) - the first synthetic task failed before provider dispatch (`dispatchAttempts: 0`); this localizes a pre-admission host boundary and does not close the independent task matrix.
- Current-main Volcengine project-goal matrix: [project-goal-volcengine-live-current24-20261109](../../cli/evidence/project-goal-volcengine-live-current24-20261109/) - Node 24 ABI-matched run passed 2/2 real-provider task cases with one dispatch each; GUI, dual-IDE and billing gates remain open.
- VS Code real host rerun: [vscode-live-extension-host-rerun-current-20261109](../../cli/evidence/vscode-live-extension-host-rerun-current-20261109/) - fresh VSIX install, activation, two-root workspace, and 19 commands passed; bridge self-probe timed out and lockfile was withheld.
- JetBrains scripted rerun: [jetbrains-scripted-journey-rerun-current-20261109](../../cli/evidence/jetbrains-scripted-journey-rerun-current-20261109/) - 85/85 scripted checks passed; live IntelliJ host remains unverified.
- CI Tests readback: [ci-tests-42516074674-20261109](../../cli/evidence/ci-tests-42516074674-20261109/) - Windows/Ubuntu jobs passed while macOS unit tests were cancelled; this does not close the three-system gate.
- Codex static rerun: [codex-app-server-static-rerun-current-20261109](../../cli/evidence/codex-app-server-static-rerun-current-20261109/) - six static suites passed 137/137 on current main; native and three-system gates remain open.
- Codex history probe contract rerun: current main passed 18 files / 705 tests; this validates the fail-closed cold-scan boundary and pagination diagnostics, but does not override the official .167 native first-page omission.
- Codex 0.167 native turn rerun: [codex-turn-rerun-current-20261109](../../cli/evidence/codex-turn-rerun-current-20261109/) - official Windows native turn probe passed completed/failed/interrupted/approval/transport-loss scenarios; provider remains synthetic loopback and Linux/macOS gates remain open.
- Codex 0.167 native history rerun: [codex-history-rerun-current-20261109](../../cli/evidence/codex-history-rerun-current-20261109/) - database recovery passed; strict cold-asc first scan still omitted one of two identities, while later recency_at asc/desc observations verified complete pagination. The cold-scan boundary remains open.

### 2026-11-09 Independent Electron loopback isolation and standing guidance

The real VS Code host journey at `cc965340c158e15637ee1bf71da3b2e74ed38bf0` still fails bridge discovery after fresh VSIX installation, activation and 19 registered commands. Its new automatic failure diagnostic connects successfully in standalone Node on IPv4/IPv6, while the exact signed VS Code Electron executable returns `ETIMEDOUT` on both without loading any extension. This replaces the earlier extension-lifecycle-only hypothesis with a reproduced executable-level boundary; the underlying cause and bridge repair remain open. The runner preserves the original failed result, and the joint runner/release-contract regression passed **63/63**. See [the diagnostic archive](../../cli/evidence/vscode-electron-loopback-isolation-20261109/README.md) and [draft PR #569](https://github.com/chainlesschain/chainlesschain/pull/569).

Item 9 standing guidance is implemented: the root `AGENTS.md` now links to [the historical PM E2E inventory](../../../testing/pm-e2e-history-2026-02-04.md), preserving the prior text on demand and all standing release order, OIDC, exact-commit matrix and other active rules. The summary table now also includes Item 8 and has four explicit columns. These changes do not close the remaining JetBrains/desktop, provider, Memory quality, billing or production gates.

### 2026-11-09 Native price-window settlement and expiry/restart recovery

Commit `44f56fe58aee36e6cc097755ce7c4ab3ec94b126` implements account-attested absolute price windows in the existing explicit trusted-host budget authority. Worst-case native reservations remain in force; a unique price-window/time witness commits with dispatch before fetch. Settlement uses the persisted witness across time changes and restart, preserving native CNY and rational USD accounting. Missing, duplicate, unsupported or inconsistent evidence retains full liability.

A new regression first reproduced inability to reopen an authority after contract/FX expiry. Reopen now verifies the original durable activation time and identity; existing dispatched calls can settle with pinned terms, while expired held calls and new dispatch remain refused. The final authority suite passed **81/81**, included within **234/234** complete formal-budget checks; additional egress/diagnostic/Memory boundary checks passed **37/37**. The committed-source egress review passed with 89 candidates and zero unclassified files, while 78 call-chain-unmapped candidates and `paidReady:false` remain explicit.

See [implementation details](../implementation/cli-ide-native-price-windows-progress-2026-11-09.md) and [source-bound JUnit evidence](../../cli/evidence/native-price-windows-20261109/README.md). These are synthetic account-contract fixtures and a scoped runtime implementation, not proof of Volcengine billing on a host-dispatch clock. Real account contract/FX acceptance, invoice reconciliation, three-system CI and formal paid admission remain open.

### 2026-11-09 Installed VS Code recovery and real DeepSeek continuation

Source `dc69b751845b9a264f82c8743566c2b023fc7037` passed the full Windows installed-VSIX real-DOM journey on explicitly selected VS Code **1.96.2**: two workspace roots, 19 commands, two simultaneous bridge windows, chat controls, Workbench, background canonical completion, text/image draft recovery and IDE restart. Needs-input visibility passed **100 samples, P95 1936 ms** against 2000 ms; the separate model-input editor/CLI fixture and runner regression **65/65** also passed. The latest cached **1.145.2** standalone loopback failure remains open. See [source-bound native evidence](../../cli/evidence/vscode-installed-native-recovery-20261109/README.md).

After the user configured Volcengine DeepSeek, source `8572855e16412d56dd73662ea0e487627b18e2c4` passed **one real model continuation** using `deepseek-v4-1-flash-economy-261017`: HTTP **200**, **862 input / 71 output tokens**, original user and single external reference preserved, verified canonical continuation settled, one answer, and zero repeated dispatches after actual REPL restart. The independent MCP reference remains official unmodified Everything 2.2.1 on local Windows with DPAPI; this is not a production remote service or OS PTY. An earlier unmatched-USD preflight had zero physical inference requests. Diagnostic estimates retain this exact model's published maximum **CNY** rates without inventing FX or changing production USD pricing; **26/26** estimate/pricing checks passed. [Real-provider evidence](../../cli/evidence/mcp-tasks-deepseek-continuation-20261109/README.md) closes only the scoped model-consumption subgate.

[Independent Java controls](../../cli/evidence/native-ide-runtime-controls-20261109/README.md) reproduce listener success but IPv4/IPv6 client failure in Zulu 11/17, bundled JetBrains Runtime 21 and cached Temurin 21 without Gradle or any extension. This localizes a boundary below the JetBrains host; cause/repair remain open and security policies were not changed. Items 2–9 remain partial; exact-head GitHub matrices, dual IDE/desktop, remote Tasks/input/expiry, Memory quality and billing admission still require their own evidence.

### 2026-11-09 Canonical source mapping and the active CLI diagnostic fix

CLI source `e691dad7b3879844eed649db45a10e251f9eb343` passed a new explicit canonical Context/Memory opt-in profile using the configured real Volcengine DeepSeek: HTTP 200, **853 input / 72 output tokens**, five source mappings complete at logical and body phases, with diagnostic body digest equal to the physical fetch request digest. Original-user/reference/answer preservation, settled readback and zero redispatch after actual REPL restart passed; the final-source synthetic profile also passed all three crash windows. The earlier shadow-profile run's `planning_unbound` remains correct and unchanged.

The real installed-VSIX diagnostic journey then found that a disabled bridge left the registered model-input command using a global fallback instead of the explicit CLI path. Source `d4460f315ff9c2ccc8e5ed8ccc0ded24d6d9d38b` shares the active conversation's CLI selector, covering explicit paths before asynchronous bridge startup and over cached globals. A fresh VS Code 1.96.2 profile selected the actual real-provider session through the production deep link and invoked the registered command: five real CLI read processes, two complete mapped records in the editor, unchanged canonical journal, zero IDE model calls. Full extension regression passed **352/352 in 41 files**; an existing candidate README/manifest version mismatch was corrected without changing public release claims.

The same packaged candidate also passed the complete real-DOM/Workbench/two-window/canonical draft/restart journey on Windows VS Code 1.96.2 at that exact source: **100 samples, P95 1437 ms** against 2000 ms. This separate timing/recovery profile uses a deterministic model fixture. [Source-bound evidence and retained failures](../../cli/evidence/canonical-model-input-native-readback-20261109/README.md) distinguish it from native readback of the separately executed real-provider task. Full IDE-initiated independent tasks, JetBrains/desktop, signed Agent Evolution projection, three-system acceptance and production/billing gates remain open; Items 2–9 remain partial.

### 2026-11-09 Native JetBrains readback and the inbound-policy causal boundary

At `ae2372cd82c4d1ca870378c202da7f41366006dc`, current JetBrains Java/Kotlin/protocol sources compiled fresh with Kotlin 1.9.24/JDK 21.0.13, and a direct SDK development plugin ran in native IntelliJ 2024.2/JBR21.0.3. The registered production model-input action performed nine guarded read-only CLI calls for the same real-provider session seen in VS Code; the canonical journal was unchanged. The native dialog screenshot visibly shows two summaries and five complete source mappings. All **202 source/resource/harness commitments, 613 compiled outputs and 625 production JAR payloads** were verified; a one-byte copied-class mutation was denied before IDE launch. [Native evidence](../../cli/evidence/jetbrains-canonical-native-readback-20261109/README.md) retains the reflection selection seam, failed first foreground capture and manual-package boundary; it does not establish Gradle/release or independently initiated IDE tasks.

Two repeated 18-pair cross-runtime runs isolate the cached Code1.145.2 failure to its listener: outbound connections work, while Node/installed/cached clients all time out reaching cached listeners on both address families. An authorized same-process/same-port IPv4 experiment changes only a narrow temporary Public/TCP/executable/127.0.0.1 inbound rule: **timeout → nonce/ACK pass → timeout after removal**. The ActiveStore rule was nonpersistent and removed. The IPv6 address validator rejected the separate ::1 rule before creation; no broader scope was substituted. Third-party filter decisions remain unassigned.

Under a temporary exact-program/Public/TCP/local+remote127.0.0.1 ActiveStore rule, cached **VS Code1.145.2** subsequently passed the full installed-VSIX real-DOM/two-window/canonical draft/restart journey at the same source, **100 needs-input samples P95 1414 ms** against 2000 ms. The rule was removed, persistent/default policy unchanged, and post-cleanup probes again time out. [Causal and conditioned-native evidence](../../cli/evidence/vscode-inbound-policy-causal-20261109/README.md) distinguishes this from stock-host repair or a comparative speed claim. Full task/recovery, standard Gradle/three-system, desktop, accessibility and billing gates remain open; all items retain Partial.

### 2026-11-09 Standard Gradle passes under a temporary Java loopback rule

Astra extended the same-process/same-port IPv4 control to signed Temurin21.0.13 Java: timeout → narrow temporary Allow → verified nonce/ACK → timeout after removal. Under an exact-Java/Public/TCP/local+remote127.0.0.1 ActiveStore rule, existing Gradle8.7 `smokeTest test buildPlugin --offline --no-daemon` then completed successfully in 2m26s, 20 actionable tasks executed. Smoke **1455 passed**; independently parsed JUnit **1031 tests, 0 failures/errors, 3 skipped**, across 120 suites. Counts overlap and are not combined. The standard 0.4.198 plugin ZIP was generated with metadata and searchable options, not published. [Build and causal evidence](../../cli/evidence/jetbrains-gradle-inbound-policy-20261109/README.md) binds 349 build/main/test/protocol source files to the unchanged source reference `ae2372cd82c4d1ca870378c202da7f41366006dc`, raw XML identities and packaged JAR contents. Both temporary rules were removed; ActiveStore/PersistentStore contain zero diagnostic rules. This closes only the conditional local Windows standard-build subgate. Stock-host repair, full native task/recovery, exact-head three-system CI and release acceptance remain open; Items 2–9 remain Partial.

### 2026-11-09 IDE-initiated real-provider file task and restart

Source reference `63538f8d83bc9f100e6ac6432ce84fc88bf87961` passed one new isolated file task through an installed VSIX0.37.182 in native Windows VS Code1.145.2. The configured Volcengine DeepSeek model used admitted production `read_file`/`write_file` tools; an independent checker verified the exact JSON keys, random nonce absent from the prompt, total49 and label. Three actual requests returned HTTP200: provider prompt tokens45609 including30720cached, completion337 including102reasoning. The real DOM displayed the result, a second tab was visited, and actual IDE restart restored the saved result/tool history with no new model requests and an unchanged drained protocol. [Source-bound evidence](../../cli/evidence/vscode-real-file-task-native-20261109/README.md) binds48 primary repository sources/16 artifacts including three integration-regression files and retains the pre-initialization Windows import failure. This is a new diagnostic case, not a replacement of a historical model sample. The temporary exact-program loopback rule was removed. The diagnostic hook sets/caps physical `max_tokens` at1024 and records differing original/physical body hashes; canonical physical-body mapping, account billing, full lifecycle/Stop/upgrade and dual-IDE/desktop acceptance remain open. Native task worklogs also remained unavailable in this mode. Items2–9 retain Partial.

### 2026-11-09 Conditional native JetBrains recovery and complete Workbench samples

The existing installed-plugin/Remote Robot harness passed two separate native IntelliJ2024.2 Windows fixture branches: canonical history/draft/Stop/actual-restart recovery (45 original artifacts, retaining an incomplete host-diagnostic capture warning), and ordinary Workbench/chat/model-config/rewind/restart (53 original artifacts, complete host captures). The ordinary branch retained40 readiness and all100 needs-input samples: **P951607ms**, **maximum15667ms**, **3 over2000ms**; the P95 gate passed without discarding outliers. The first TCP-only concurrent Gradle cache-lock failure remains22 artifacts. Local Gradle bytecode confirmed DatagramSocket-based lock signalling; later runs added exact-Temurin/Public/UDP/local+remote127.0.0.1 to their exact-Java TCP conditions. All rules were temporary ActiveStore entries, removed and nonpersistent; final ActiveStore/PersistentStore global diagnostic count is0. [Native journey archive](../../cli/evidence/jetbrains-conditioned-native-journeys-20261109/README.md) binds353 source files/19 selected artifacts and independently verifies all120 original artifact bytes across the three manifests. The workbench run spans repository fast-forward63538f8→f5959828 with related JetBrains/harness sources unchanged. It is fixture acceptance under these conditions, not a JetBrains real-provider task or stock-host repair. Recovery capture, full lifecycle/upgrade/accessibility/desktop and exact-head three-system gates remain open. After integration, local MCP44/44 and VSCode352/352 checks passed atf5959828, separately bound in the real-file-task archive. Items2–9 remain Partial.

### 2026-11-09 JetBrains real file task: assertions pass, cleanup gate fails

At source reference `171659e7e668276285aa56ac8eadcffcf9ea39e1`, the locally Gradle-built development plugin 0.4.198 (ZIP SHA256 `6efd52b835c0a30a047c3a70bfae88c8a71765ecc90ef25a7419a5121295d632`) completed a new IDE-composer-initiated Volcengine DeepSeek file task. Actual read/write/read tools produced the independently verified input-only random nonce and total59; native background/return-tab and actual IDE restart assertions passed with zero new requests after restart. Four physical requests returned HTTP200, reporting21112 input/255 output tokens. [The real-task archive](../../cli/evidence/jetbrains-real-file-task-native-20261109/README.md) binds immutable source hashes and private raw evidence identities. This is development-plugin evidence, not Marketplace acceptance.

The overall harness remains **failed**: graceful shutdown left a shared SGTool/Sogou daemon, and no force kill was performed. `overallHarnessPassed:false` and `paidReady:false` remain explicit. The diagnostic transport capped physical `max_tokens` at1024, with different original/physical body digests; this does not establish canonical physical-body mapping, unadapted output-cap enforcement or invoice reconciliation. Exact-program/Public/loopback-only temporary Java TCP and Gradle UDP rules were removed; this is conditional Windows evidence, not stock-host repair. The real task assertion subgate is now observed, while complete safe teardown and broader lifecycle/desktop/three-system acceptance remain open.

### 2026-11-09 History restore trace fix verified with a separate restart continuation

Commit `937ceaa3746ba032111ea304b061bc4703118b78` passed ChatHistoryViewTest11/11 and UiEventDiagnosticsTest5/5. [The history trace archive](../../cli/evidence/jetbrains-history-restore-trace-20261109/README.md) verifies both native phase captures complete: initial15 history records/5 complete correlated groups, restart20/3, including actual same-session/id HISTORY_REQUESTED → HISTORY_READ_RETURNED → HISTORY_APPLIED. READ_FAILED and STALE records remain present. Public HISTORY-only JSONL projections use allowlisted metadata without raw prompt, cursor or path; original full-trace byte hashes are retained separately.

The original full journey still **failed** at initial cleanup because the shared input-method daemon survived. A separately recorded restart-only continuation reused that completed fixture and passed; initial was not rerun and no model was called. The private launcher used graceful-only teardown and finally-capture before rethrowing cleanup failure; its original/modified SHA and sanitized diff are explicit, while production Java and UI/recovery assertions remained unchanged. Temporary scoped rules were removed. This closes the missing history trace subgate for these captures, without backfilling the earlier incomplete capture or claiming a complete safe-cleanup journey.

### 2026-11-09 Explicit output-cap wiring and cleanup identity diagnostics

Commit `bc28be429c031af1b6dda9f12fc5b59c6e64893c` adds explicit `agent --max-output-tokens` propagation through interactive, headless, IDE stream-json and reconstructed background launches; the targeted suite passed232/232. Capped background profiles use version2 so older readers reject rather than silently drop the cap. This bounds requested output for main agent/tool-loop calls only: provider-specific enforcement, auxiliary compaction/advisor budgets, total session tokens, elapsed time, invoicing and paid admission remain separate. It does not retroactively turn the prior diagnostic physical-body cap into unadapted production evidence.

Commit `02f892dbe3091f9c41e5655f4d579891108e03b7` adds executable identity to Windows cleanup diagnostics; the reported targeted result is17 passed/3 skipped. Termination authorization remains PID plus CreationDate; it does not add command-line collection or permission to kill shared IME processes, and does not repair or reclassify the original SGTool cleanup failure. All Items2–9 remain **Partial**, the plan remains open, and paid readiness remains false.

### 2026-11-09 VS Code physical body identity and separate read-only recovery

The [unadapted-body real file task archive](../../cli/evidence/vscode-unadapted-file-task-native-20261109/README.md) is bound to source `02f892dbe3091f9c41e5655f4d579891108e03b7`, native Windows VS Code1.145.2 and development VSIX0.37.183. All184 packaged payloads were checked against immutable sources (182 byte-exact and two documented Markdown normalizations). The genuine IDE submission used admitted read_file/write_file tools and produced the exact input-only nonce and total47. Three requests returned HTTP200, reporting46614 input/211 output tokens. The production `--max-output-tokens 1024` flag supplied the cap; the diagnostic fetch guard left every body unchanged, with original/physical SHA256 identical.

The original full harness remains **failed**, not recovered in place: its private batch IF wrapper rejected the production history caller's escaped argv, leaving the saved-terminal wait unsatisfied. A timestamped midrun shim repair preserved old/new hashes without resending input or extending the deadline; original process-tree cleanup then returned128. A separate continuation reopened that same profile/session, verified exact canonical saved-row eventId/text/nonstreaming state, and repeated the checks after another actual native restart. Both continuation phases passed with distinct Extension Host processes, zero new provider dispatches and unchanged original protocol bytes. Managed owners exited and the isolated profile had no matching Code owner, but complete descendant-tree identity cleanup was not attested. Temporary scoped firewall rules were removed and private profile settings restored.

The read-only model-input report for this task contains **0 records**, so physical body identity does **not** establish canonical physical source mapping. The configured canonical_default stage alone does not supply that missing evidence. The archive retains `originalHarnessPassed:false`, `paidReady:false`, the original cleanup failure and conditional-host limits. No later source fix is backfilled into this historical task.

### 2026-11-09 Stream model-input observer wiring: local regression only

Commit `39d95352e7089b4c0bf9e6fe5503a870cac5480a` connects the persisted model-input observer to the IDE stream session's main loop options, addressing the separate missing-observer boundary exposed above. The final root targeted run passed **111/111 across three test files**, including real canonical-journal readback, append throwing or returning false before provider dispatch, and the non-persisted/anonymous observer path. These are local regression results; they do not retroactively populate the older task's empty report or prove native physical source mapping.

Remote thinking-cap/storage-failure changes were integrated at `bcce11f6455ad2584a5ce4fed36b5de6de23f2ff` (including remote `773e740`). The final integration regression passed **207/207 across six files** at that merge: the observer-related 111 tests plus thinking 26, history 17 and storage 53. The earlier 111-test result is included in this total and is not added again. A new native observer-mapping task was not yet started and has no acceptance result here. All Items2–9 remain **Partial**; full native lifecycle, safe teardown, three-system and paid-production gates stay open.

### 2026-11-11 Codex 0.167 三系统兼容性复核

核对提交 `71d392c0b36ffa26b5e7b19fe25054b1ebe3eecd` 的两组工作流与 Codex `0.167.0` 的 9 份原始报告。兼容工作流 **24/24** 通过，三系统 `.167` 的原生回合报告和数据库历史报告均为通过。数据库报告确认进程重启、设置恢复和已完成请求无重放。 [兼容工作流](https://github.com/chainlesschain/chainlesschain/actions/runs/42845933201)

| 平台    | 原生回合与取消 | 数据库历史重启恢复 | 严格首次冷升序扫描        | 独立首次冷降序扫描        |
| ------- | -------------- | ------------------ | ------------------------- | ------------------------- |
| Linux   | 通过           | 通过，无重放       | 失败，发现 1/2 个已知线程 | 通过，2 页发现 2/2 个线程 |
| Windows | 通过           | 通过，无重放       | 失败，发现 1/2 个已知线程 | 通过，2 页发现 2/2 个线程 |
| macOS   | 通过           | 通过，无重放       | 失败，发现 1/2 个已知线程 | 通过，2 页发现 2/2 个线程 |

三个冷扫描报告均保留 `cold-asc:first-scan` 失败。首请求使用 `sortKey:recency_at`、`limit:1` 和 `useStateDbOnly:false`，每次返回 1 条记录并给出空游标。官方协议把空 `nextCursor` 定义为分页结束。 [严格冷扫描工作流](https://github.com/chainlesschain/chainlesschain/actions/runs/42845933449) [OpenAI App Server 分页文档](https://learn.chatgpt.com/docs/app-server#list-threads-with-pagination--filters)

上游 `rust-v0.167.0` 源码的升序扫描先截断文件结果，只把当页命中的文件回填 SQLite。`recency_at` 分支再查询 SQLite 并返回该查询的游标。索引为空且页大小为 1 时，后续文件未入库，数据库查询可以提前返回空游标。这条路径与三平台回执一致。降序分支在回填前多取文件，本轮 2 线程样本均完成分页。第 6 项仍为部分完成，冷发现修复、模型变更验证和生产准入仍待完成。 [上游回填与分页实现](https://github.com/openai/codex/blob/086ccc833bc9cf01024ad2dd6af7dbd421b6bf9a/codex-rs/rollout/src/recorder.rs#L597)

### 2026-11-11 Memory 三系统回执审计与完整矩阵续作

第 8 项已补核发布源 `daafda2cf7790580467dae8ce006ceaa1285d3b4` 的 [Memory Actions 42722731666](https://github.com/chainlesschain/chainlesschain/actions/runs/42722731666)：12 个 job 均成功。三系统各档各模式仍为 11 次；各平台分别有 165 个五模式查询样本、66 个 Stop 样本、33 轮八进程混合及 99 个首次冷组合样本。所有 Stop 均在两个 500ms 限制内，没有送达后成功返回；送达前完成与取消确认分别计数。14 份原始报告、154 组提交/路径字节绑定及校验器 5 个拒绝边界用例已核对，详见[原始归档与离线校验器](../../cli/evidence/memory-platform-20261111/README.md)。这不将 11 次提升为 100 次验收，不给其他 HEAD 或完整依赖闭包背书。

新的本机 Windows / Node 24.12.0 三档双模式各 100 次 Stop 测量保留 **失败**：600 个样本中 580 次确认取消、20 次送达前完成、送达后成功为 0，锁均释放且 authority 不变；但两个确认延迟为 631.349ms 和 514.960ms，超过既有 500ms 限制，退出码 1。原因尚未定位，原样本未删除或重跑覆盖。测量 checkout 为 `ed53ce6527` 加 Stop 基准覆盖层，11 个记录源码字节匹配 main `6338e6a1b1`；不是该 main 的干净提交整体验收。

main 已有 Stop 修正和 6 个定向回归，本机 6/6 再验通过；测试文件变化的 push/pull_request 路径触发已随 `b2d87568e` 合入。随后[每组 100 次的完整三系统矩阵 42850534026](https://github.com/chainlesschain/chainlesschain/actions/runs/42850534026) **12/12 job 成功**，准确源为 `6338e6a1b1310af6a6164d799ab544ed0bc15668`。每平台核对 1,500 个五模式查询、600 个 Stop、300 轮八进程混合和 900 个首次冷组合样本；13 份完整矩阵回执已归档，两批共 27 份原字节及 286 组提交/路径字节绑定通过离线复核。100K 冷分类列表 p95 为 Linux 714.699ms、Windows 506.465ms、macOS 557.493ms，均低于该场景原 1s 候选目标。托管 Stop 全部满足 500ms 送达与确认限制；本机两个超限不改变。仅关闭完整托管测量子项，第 8 项仍 Partial：产品混合/恢复 SLO、真实 IDE Stop、多语言任务及本机延迟归因未完成；完整生命周期与账单/付费准入保持原状态。 [Archive PR #596 merged](https://github.com/chainlesschain/chainlesschain/pull/596).

### 2026-11-09 Original native stream task with canonical physical mapping

Source `bcce11f6455ad2584a5ce4fed36b5de6de23f2ff`, including stream observer fix `39d95352e7089b4c0bf9e6fe5503a870cac5480a`, passed the original Windows VS Code1.145.2 / installed development VSIX0.37.183 task journey. Four unchanged physical requests returned HTTP200; eight journal-backed diagnostics correlate all logical/fetch pairs, with planning4/4 and sourceMapping8/8 covered across50/50/51/52 sources. Independent strict nonce/total67 output validation, actual saved terminal, tab switch and IDE restart passed; restart made zero new model requests. The actual tools included the same-session WORKLOG read, input read, output write and output read: output correctness is not a general instruction-compliance or model-quality judgment. Provider usage was70638 input including45056cached,668 completion including166reasoning. The production1024 cap and read-only guard preserved exact request bytes. [Frozen archive](../../cli/evidence/vscode-stream-model-input-native-20261109/README.md) binds true prelaunch harness identities,184 package payloads and207/207 integration tests (including the earlier111). Both managed hosts completed without timeout failure and the exact temporary rule was removed; full descendant-tree cleanup snapshots were absent. Stock-host, full Stop/steer/compaction/upgrade/desktop, three-system, billing and paid-admission gates remain open. Older failed/zero-diagnostic archives are unchanged. Items2–9 remain Partial.

### 2026-11-11 CLI / IDE 发布情况

| 渠道                  | 版本      | 已完成                                                                                                                                | 限制与待办                                                                                      |
| --------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| npm CLI               | 0.166.147 | 准确源码 `32451e4d5` 的全平台 CLI CI 76/76、Strict Sandbox 6/6、OIDC 发布、来源证明及公开字节回读通过                                 | 新 IDE 0.37.186 / 0.4.201 仍待完整新矩阵与正式发行                                              |
| VS Code / Open VSX    | 0.37.185  | 已公开；本次重新查询 Open VSX `latest` 一致，推荐 CLI 0.166.146                                                                       | Microsoft Marketplace 渠道仍未发布                                                              |
| JetBrains Marketplace | 0.4.200   | 正式标签工作流及上传成功；随后已审核上架，更新 1217276；公开下载的 631 个 payload 与官方 ZIP/JAR 原始文件逐项一致，推荐 CLI 0.166.146 | 初始 `pending / version-not-visible` 是历史状态；外层 ZIP 打包字节不同，不宣称整个 ZIP 摘要一致 |

JetBrains 发布标签 `ide-jetbrains-v0.4.200` 固定到 `38081db870576ffb63f9e8e2d0dccb79f0251276`。同一源的候选 IDE Extensions 为 18 项成功、1 项条件跳过，ARM64 为 11/11 成功。[正式发布运行](https://github.com/chainlesschain/chainlesschain/actions/runs/42945700403) [候选检查](https://github.com/chainlesschain/chainlesschain/actions/runs/42934536614) [ARM64 检查](https://github.com/chainlesschain/chainlesschain/actions/runs/42934536692)

本次补丁覆盖 Rewind 弹窗定位及切换会话后的过期结果丢弃。上传成功不等于公开上架，也不关闭本文第 2–9 项剩余验收。

### 2026-11-11 自进化与新发行候选续作

| 项目                       | 本批完成情况                                                                                                                                                              | 待完成                                                                                                           |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| RRSI manifest 原组件所有权 | 实现沿真实 factory 传递；七个相关文件 84 项通过、2 项既有平台条件跳过；PR #599                                                                                            | 历史组件汇总、完整存储图、生产 producer 与实际学习收益                                                           |
| DMM 原生跨夜通知           | 主进程跨夜已合入；准确提交 `32451e4d5` 的受控时钟 Windows 原生流程通过，7 份原始文件及 20 组源码绑定已归档；首次失败保留                                                  | 真实整夜运行、进程重开、其他平台及已安装客户端                                                                   |
| 安全审计                   | 更新 Mongoose 锁文件、拒绝空/错误/超时审计结果，10 项边界检查通过；PR #600                                                                                                | 本机 registry 审计超时，需正式 Actions 审计及依赖兼容结果                                                        |
| CLI / IDE 新候选           | 准确源 `703b22e89` 的 IDE 18 成功/1 项发布后条件跳过、ARM64 11/11、无障碍 4/4、桌面 E2E 4/4、质量 8 成功/2 项条件跳过及进程恢复 2/2 全部完成；旧菜单/DNS/CIM 失败原样保留 | Open VSX 0.37.186：已公开并核验；JetBrains 0.4.201：官方发行中，公开回读未完成；36+9 仍未执行，自动晋级保持 HOLD |
| 36+9 新复测                | 新轮次约束及实际工作流选择器 26 项检查通过；原任务/模型/预算，基准单轮 24/45                                                                                              | 公开包证明齐全后真实执行；当前新模型任务仍为 NOT_RUN                                                             |

这些实现和离线检查不表示整个自进化计划完成，也不产生实际任务完成率改善结论。详见[复测准备](../../cli/verify01-volcengine-147-full-20261111/README.md)。
