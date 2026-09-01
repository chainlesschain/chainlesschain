# ChainlessChain 对照 WikiSkill、Claude Code 与 Codex 的自进化差距与优化建议

> 审计日期：2026-09-01<br>
> ChainlessChain 仓库基线：`b7aab9d3c0f92ddcaaebcbad7ca3b24b14af9f14`<br>
> 产品版本基线：根项目 `5.0.3.54`、CLI `0.166.15`、Desktop `5.0.3-alpha.135`<br>
> WikiSkill 基线：arXiv `2608.27454v1`，2026-08-27<br>
> Claude Code 基线：`2.1.251`，2026-08-28<br>
> OpenAI Codex 基线：Codex CLI `0.151.0`，2026-08-29<br>
> 二次复审：2026-09-01，重点核对“可直接复用的本项目底座”、最新版本增量与论文结论边界<br>
> 参考章节格式：[`CODEX_OPEN_SOURCE_GAP_ANALYSIS_2026-08-24.md`](./CODEX_OPEN_SOURCE_GAP_ANALYSIS_2026-08-24.md)

## 1. 结论先行

WikiSkill 对 ChainlessChain 最重要的启发，不是再增加一个名为“自进化”的模块，而是把现有学习零件收敛为一套**受控的软件发布系统**：

```text
不可变经验 Raw
    ↓
可纠错、可积累的 Wiki
    ↓
一次只改一个 Skill 的 candidate patch
    ↓
独立 Eval / 安全 / 权限门禁
    ↓
shadow / canary / active / rollback
```

其中，经验是证据，Wiki 是可维护的中间表示，Skill 是编译产物，Eval、权限和人工审阅是发布门。

当前 ChainlessChain 已有 Trajectory、Outcome Feedback、Reflection、Skill Synthesizer、Skill Improver、Eval、Rollout、Record & Replay、Memory、Hooks 和 Desktop Phase 20 等零件，但还没有形成完整的：

`Raw → persistent Wiki → candidate Skill → validation gate → promote / rollback`

这里的“没有形成”是指**尚无覆盖 Synthesizer、Improver、普通 Skill、CLI/Desktop/Graph 的 canonical 闭环**，不是说仓库完全没有生命周期原语。Record & Replay 已实现 `draft→approved→validated→enabled→revoked` 的窄域纵切，Plugin runtime 也已有不可变版本、active pointer 与事务恢复；正确方向是推广和统一这些实现，而非从零开始。

二次复审后，最值得本项目借鉴的并不是再造新基础设施，而是复用现有底座补五个“连接件”：

1. 在现有 [`CAPABILITY_MANIFEST`](../packages/cli/src/lib/capability-manifest.js#L32) 声明 evolution capability ID/静态 gate，再由 `cc agent --capabilities` 输出带 manifest digest 的运行时 status projection，如实公开 `implemented/wired/verified/defaultEnabled/mutationScope/lastEvidence`；不要另建第二套 capability 清单，也不要把易变证据写进静态 manifest digest。
2. 把 Record & Replay 已有的 approval/replay/CAS 生命周期与 Plugin runtime 的不可变版本、active pointer、journal/recovery 抽成通用制品激活端口，不从零重写 Skill Registry 事务。
3. 复用 [`GoalConditionEngine`](../packages/cli/src/lib/goal-condition-engine.js#L301) 的确定性完成条件、token/cost/time/turn 预算，以及现有 worktree/checkpoint，先做“单候选→评分→保留更优→预算停止”的离线纵切闭环。
4. 修复现有 Desktop Skill metrics 接线，并结合 CLI name-level attribution 补 `SkillInvocationReceipt`，把 Skill digest、路由理由、模型/工具/环境/权限指纹和真实 outcome 连接起来；否则无法判断“用了哪个 Skill”是否真的改善结果。
5. 把模型切换、工具结果进入模型前的投影、基础设施故障分类设为证据边界，防止混合模型归因、工具注入和瞬时 MCP/权限失败被错误编译成 Skill 规则。

这五项的投入产出比高于先建设完整 Wiki UI 或新的“自进化”服务；其中第 1、2、5 项属于自动 mutation 开启前的 P0，第 3、4 项属于最小可用闭环的 P1。

源码审计显示，当前被“自进化”命名覆盖的实现实际分为三类：

1. **指标或演示壳**：按公式递增 accuracy、返回固定预测或状态字符串，并没有训练模型或进化 Skill。
2. **尚未接入生产主链的真实组件**：例如 CLI learning hooks 和 `SkillImprover`，静态引用扫描只命中定义，没有找到生产调用点。
3. **接入后可能产生高风险副作用的 writer**：若 `SkillImprover.skillsDir` 指向当前运行时 Skill 树，它会在缺少 candidate/Eval/promotion 语义时原地覆盖 `<skillsDir>/<name>/SKILL.md>`。当前未找到生产构造点，且 CLI loader 在后续 materialize 时有 digest drift/再授权防线；这降低了静默执行风险，但没有补上 mutation-time gate。

这里的优先级按“何时成为发布阻断”定义：当前高风险 writer 尚未接入主链，因此 P0 主要是**启用任何自主 active Skill mutation 之前必须关闭的门禁**；P1 是闭环主能力；P2 是闭环稳定后的产品化与规模化。建议顺序为：

- **P0：先保证真实、安全、可恢复。** 冻结任何未经门禁的 active Skill 自动写入，消除幻影成功，建立 candidate、独立验证、原子晋级、回滚、可信审计和演化数据安全边界。
- **P1：再建立统一演化内核。** 形成 canonical Raw/Wiki/Skill 三层控制面，统一 CLI、Desktop、Graph、Eval、Memory 与 Skill Registry，补齐模型与运行环境兼容矩阵。
- **P2：最后扩展产品体验和规模。** 建立演化工作台、Skill 检索路由、跨设备团队知识、跨模型来源/目标适配和长时在线适应。

在 P0 门禁关闭前，不应把当前 `learning synthesize`、`SkillImprover`、CLI/Desktop `self-evolving` 指标壳描述为生产级自主进化。

### 1.1 当前实施完成情况（2026-09-01）

本节记录本报告转入实施后的当前状态，实施基线截至提交 `4f22d70bb5`。状态采用两层口径：**“已提交”只表示一个可独立审查、已验证的基础批次完成，不等于对应路线项已经达到第 9 节的生产验收标准**；只有剩余项全部关闭后，路线项才可标记为“完成”。

| 优先级 | 当前判断 | 已完成并写入仓库 | 当前仍需完成 |
| --- | --- | --- | --- |
| P0 | 已完成 14 个基础提交；整体未关闭 | 能力真值与 mutation freeze、可信 mutation authority、tenant-scoped candidate/release/promotion、独立监督 Eval Gate、证据投影与制品端口、tamper-evident ledger、类型化领域事件、规范执行清单、持久账本端口契约 | 缺真实跨进程 durability/attestation authority、真实进程级 Eval supervisor、矩阵评测与统计聚合、完整 promotion evidence/人工 quorum、端到端事务控制面和生产崩溃/攻击测试 |
| P1 | 部分底座提前落地；主能力未开始验收 | target matrix 数据模型、content-addressed registry、ledger/event/port 等依赖已具备基础实现 | Canonical Raw/Wiki/Skill、Maintainer、Proposer、目标矩阵 Eval、统一 Registry 接线、结构化 Memory、InvocationReceipt 和有界评分循环均未形成生产纵切 |
| P2 | 未开始 | 尚未把任何 P2 产品能力声明为已交付 | Pilot、Workbench、Retrieval Router、跨设备/团队知识、跨模型市场治理、Wiki pruning 与长时在线适应应在 P0/P1 验收后实施 |

P0 的逐项状态如下；“基础完成”特指底层安全原语已提交，不代表生产接线已经完成：

| 路线项 | 状态 | 已完成部分 | 提交证据 | 未关闭项 |
| --- | --- | --- | --- | --- |
| EVO-P0-1 能力真实性与 mutation freeze | 基础完成，路线项待生产切换验证 | canonical capability/runtime status、candidate-only writer 边界、mutation 路径盘点与冻结、Desktop Skill 生命周期证据接线 | `3fdff6c1ee`、`0da1f36a8b`、`c16e1a3912` | 对全部生产入口做最终 cutover/E2E，确认旧壳不会绕过门禁或继续报告幻影成功 |
| EVO-P0-2 Candidate、Promotion 与 Rollback 事务 | tenant 隔离基础完成，生产控制面未关闭 | 不可变 candidate、可信 mutation authority、tenant root/marker 与显式 legacy migration、完整 execution manifest 绑定、有界目录/制品解析、crash-safe release/promotion/recovery、transition subject 绑定、持久账本端口契约 | `3fdff6c1ee`、`fe16c72d5e`、`ed7882d004`、`233e1bdc3a`、`4cffc53054`、`dfa21b4ba4`、`4f22d70bb5` | 统一两阶段事务与真实 durable authority；commit-unknown/concurrency 生产 E2E；active/last-known-good/canary 控制面；运行中会话 digest pinning；permission/policy/model/tool/grader 变化后的 approval/Eval cache 失效；生产 adapter 构造权、ACL/只读 CAS、Windows directory fsync 与持续审计 |
| EVO-P0-3 独立真实 Eval Gate | 监督与证据基础完成，生产接线 HOLD | 隔离 target、角色/信任分权、签名 receipt v3、调用/撤销独立证据、hard-termination 收敛、全 run 单调 deadline、descriptor-bound authority root、后验防 TOCTOU 与 fail-closed watchdog | `52427b742c` | train/validation/test 隔离、同条件 baseline/candidate、多目标统计 gate、anti-gaming、target-matrix receipt 聚合与真实 grader；生产 attested loader 绑定 descriptor↔callable；进程级 kill/资源回收；PKI keyId 唯一性；目标平台 2500ms settlement grace 基准 |
| EVO-P0-4 Raw、入模投影与 Skill 编译安全边界 | 基础部分完成 | attested evidence projection、authenticated artifact ports、tenant-bound dependency lock/runtime manifest/target matrix 规范格式与校验 | `b8490faa94`、`b4dca1ee05`、`4cffc53054` | 生产 raw/model-visible 双层存储、secret/PII 脱敏、trust/quarantine、完整 derivation receipt、人工 quorum 与生产 adapter 接线 |
| EVO-P0-5 Fail-closed 证据与审计 | 账本基础完成，生产可用性 HOLD | append-only tamper-evident ledger、typed domain events、subject-bound transition、认证制品解析与持久账本组合端口 | `d073bdf3c7`、`233e1bdc3a`、`d098a64253`、`b4dca1ee05`、`dfa21b4ba4` | 真实跨进程持久 authority、增量索引/快照与规模基准、冲突/并发回归、旧 projection/journal 迁移、故障注入、离线审计导出验证以及生产 wiring |

P1/P2 当前状态按路线项展开如下，防止提前把“已有依赖”计为“能力完成”：

| 路线项 | 当前状态 | 已复用或提前完成的底座 | 下一关闭条件 |
| --- | --- | --- | --- |
| EVO-P1-1 Canonical Raw/Wiki/Skill | 未开始验收 | ledger、typed events、artifact ports | 建成单一 `EvolutionRun` 与 Raw/Wiki/Skill authority，并让 CLI/Desktop/Graph 共用 |
| EVO-P1-2 Evidence-backed Wiki Maintainer | 未开始 | 可引用认证 evidence/artifact | 实现 pattern/index/evolution-log/skill-impact 及 merge/conflict/expiry/revoke |
| EVO-P1-3 Single-Skill Proposer | 部分边界已完成 | writer 已被限制为 candidate-only，candidate registry 已有基础 | 接入 Wiki/Raw lineage，只允许单 Skill proposal，并生成 PURPOSE、diff、边界和反例 |
| EVO-P1-4 目标运行时 Eval | 数据模型与单次受监督 gate 部分完成 | dependency lock、runtime manifest、target matrix canonical schema、独立 target/grader/safety receipt 验证 | 实现逐 matrix cell 的 before/after receipt、负迁移 gate、shadow/canary 与统计聚合判定 |
| EVO-P1-5 Registry 与单写者治理 | tenant 存储基础完成 | content-addressed tenant candidate/release、promotion controller、lease/CAS/journal/recovery 原语 | 唯一 production writer、kill switch、active/last-known-good/canary 生产接线与跨进程持久权威 |
| EVO-P1-6 统一生产接线 | 未开始 | capability status 与 Desktop evidence 已校正部分入口 | 真实 Agent 事件统一进入控制面，并退役或降级重复的 self-evolving 壳 |
| EVO-P1-7 Memory 与多 Agent 权力分离 | 部分安全底座完成 | Eval Gate 已建立 target/grader/safety/supervisor/verifier 的最小监督与证据分权 | 完成 memory 分层、compaction 约束及 proposer/critic/evaluator/governor 隔离，并由可证明的生产组合根强制执行 |
| EVO-P1-8 SkillInvocationReceipt | 部分观测底座完成 | Desktop lifecycle metrics/evidence、ledger/artifact port | 固定 skill digest、router reason、模型段、环境/权限、真实 outcome/cost，并可反向 join Eval/Wiki |
| EVO-P1-9 有界评分改进循环 | 未开始 | 现有 GoalConditionEngine、预算、Eval、worktree/checkpoint 可复用 | 串成 candidate-only 离线纵切，证明单候选、独立评分、best 保留、失败分类与根预算停止 |
| EVO-P2-1～P2-6 | 未开始 | 无生产能力提前宣称 | P0/P1 验收通过后，再依次开展受控 Pilot、Workbench、Router、团队知识、跨模型治理和 Wiki pruning |

当前验证快照如下；各行均对应已提交的基础批次。测试均采用串行执行以避免 Windows 并发测试进程造成误判：

| 批次 | 验证快照 | 结论 |
| --- | --- | --- |
| 证据投影与认证制品端口 | evidence projector 46/46 通过；artifact ports 25 项通过，Windows 无权限创建 symlink 时另有 1 项按条件跳过 | 基础批次已提交；真实外部 artifact authority 仍需生产实现 |
| Tamper-evident ledger 与 typed events | 相关账本测试 45/45 通过 | 数据模型与 fail-closed 校验基础已提交 |
| Canonical execution manifests | manifest + mutation authority 测试 57/57 通过 | canonicalization、tenant-bound lock、runtime manifest、target matrix 基础已提交 |
| Durable ledger ports + release/promotion compatibility | ledger ports 10/10、release registry 14/14、promotion controller 11/11 通过 | 端口契约可发布为 foundation；当前 O(N) 扫描和缺真实 durability authority 使生产接线继续 HOLD |
| 独立监督 Eval Gate | 128/128 通过，终轮独立复审 RELEASE | 提交 `52427b742c`；可发布为监督/证据 foundation，但真实进程终止、attested loader 与矩阵聚合仍为生产阻断 |
| Tenant Candidate/Release/Promotion | candidate + release + promotion 65/65 通过，终轮独立复审 RELEASE | 提交 `4f22d70bb5`；tenant 隔离、恢复和制品绑定基础可发布，生产持久 authority、adapter 组合权与同权限外部篡改防护仍 HOLD |

## 2. 外部方案实际提供了什么

### 2.1 WikiSkill：它是研究框架，不是已发布的 Google 产品功能

本文所称 WikiSkill，是 Google Research 与 Virginia Tech 作者于 2026-08-27 发布的 v1 预印本框架，而不是 Google 已正式交付的产品功能。论文没有链接官方实现仓库，因此目前可借鉴的是论文机制和实验结果，不能把其生产成熟度、安全性或可复现性视为已经得到证明。参见 [WikiSkill 论文](https://arxiv.org/html/2608.27454)。

还需限定其适用范围：WikiSkill 验证的是**按数据集运行的离线、批量 Skill 优化**，不是从单次生产任务即时学习的在线系统。每个数据集及独立演化运行从空 Skill/Wiki 开始；每轮对训练集 rollout、提出一个单 Skill 变更，再用反复复用的留出验证集平均分决定是否接受。因此论文中的“persistent”首先指同一演化运行内跨迭代保留，尚未验证跨项目、跨部署或终身持续演化。

WikiSkill 的关键设计不是更新模型权重，而是把 Agent 经验编译为外部、可复用的程序性知识：

| 层 | 论文机制 | 对 ChainlessChain 的启发 |
| --- | --- | --- |
| `raw/` | 保存完整且不可变的执行轨迹 | 原始证据不能被 outcome 回填或后续总结原地改写；应采用 append-only event + deterministic projection |
| `wiki/` | 保存 pattern pages、索引、演化日志和 `skill-impact.md` | 日志不等于知识；需要介于轨迹和 Skill 之间的持久、可纠错、可合并中间表示 |
| `skills/` | 保存 active `SKILL.md` 和回指 Wiki 模式的 `PURPOSE.md` | 每个 Skill 必须回答“为何存在、由哪些证据产生、对什么运行时有效” |
| Inference Agent | 演化训练 rollout 中只读取 active skills，不读取 Wiki | 可作为本项目 Pilot 的默认隔离实验；是否适用于所有生产推理，应按领域对照验证，不能由一次消融直接推广 |
| Wiki Maintainer | 从成功和失败轨迹提炼、更新模式 | 失败不是一次性日志，而应成为跨轮积累的反例与边界知识 |
| Skill Proposer | 基于 Wiki 和选择性 Raw 证据提出单 Skill patch | 一次演化只改一个可归因单元；这是变更粒度，不代表文件或部署事务原子性 |
| Gate | 在留出但每轮复用的 validation split 上严格比较；未提升则恢复上一轮 Skill 配置，Wiki 保留 | 可借鉴“候选不提升就不采用”；它不是统计晋级门、部署事务或外部副作用回滚 |

WikiSkill 直接验证到的是单 Skill 提案、validation score gate 和优化工作区内的 Skill 配置回退；本报告提出的安全/权限门、人工审批、content-addressed registry、shadow/canary 与生产回滚，都是面向 ChainlessChain 的工程化扩展，不应反写成论文已交付能力。

论文结果说明了四个值得直接转化为工程约束的事实：

- Gemini-3.5-Flash 四基准消融中，在 Inference Agent 均不读 Wiki 时，启用 Maintainer 并让 Proposer 使用持久 Wiki，使最终测试平均分由 `48.7%` 提升至 `63.7%`；这支持的是**完整持久知识管线**在该实验设置中的价值，不能只归因于 Wiki 数据结构。
- 同一组消融中，让 Inference Agent 在演化训练 rollout 也读取 Wiki，平均分由 `63.7%` 降至 `60.9%`。论文把可能原因表述为假设，因此本项目应把隔离设为 Pilot 默认和可配置实验，而不是宣布生产推理永远不得访问 Wiki/Memory。
- 五基准测试平均中，Qwen-3.5-9B + WikiSkill 为 `47.4%`，高于无 Skill 的 Qwen-3.6-27B `39.4%`；这说明程序性知识在这组基准中弥补了部分模型规模差距，不能泛化为普遍替代模型规模。
- 跨模型迁移既可能增益，也可能严重负迁移：Qwen-3.5-4B 的 Spreadsheet Skill 曾把 Gemini 从 `50.5%` 降到 `18.1%`；因此“源模型有效”不能替代目标模型、工具集和环境上的重新验证。

WikiSkill 本身也有明确边界：论文采用全量 Skill 注入，没有验证大规模检索和触发；严格 `>` gate 会拒绝中性但可能有后续价值的基础 patch；没有自动 Wiki pruning；验证集较小；没有覆盖数百步、数小时的在线适应；也没有报告隐私、prompt injection、恶意 Skill、权限扩大或供应链安全评测。

### 2.2 Claude Code 最新进展与不足

截至审计日，Claude Code 官方 changelog 最新版本为 `2.1.251`（2026-08-28）。相关能力已经形成很强的执行底座：Auto Memory、agent memory、Skills、Hooks、Plugins、`/goal`、Dynamic Workflows、Agent Teams、跨会话消息和模型切换 hooks。参见 [Claude Code changelog](https://code.claude.com/docs/en/changelog)、[Memory](https://code.claude.com/docs/en/memory)、[Goals](https://code.claude.com/docs/en/goal)、[Workflows](https://code.claude.com/docs/en/workflows) 和 [Hooks](https://code.claude.com/docs/en/hooks)。

`2.1.251` 的直接增量包括 `PreModelSwitch`/`PostModelSwitch` hooks、前台 subagent 工具调用可见性，以及多项 team/subagent 通信修复。该版本还修复了 file tool symlink-swap TOCTOU、plugin command path traversal、Workflow `scriptPath` 在权限检查前读取、Grep/Glob 经 symlink 绕过 deny，以及 project settings 绕过 managed tracing/logging policy 等问题。这些变化增强了观测、编排和路径/策略边界，但仍没有把模型切换、验证或多 Agent 结果自动连接到 Skill candidate 的强制 promotion gate。

对 ChainlessChain 最直接的借鉴不是再复制两个 hook 名称，而是把**每次模型变化变成证据分段边界**。仓库的 WS 路径已经发送 [`model-switch`](../packages/cli/src/gateways/ws/ws-agent-handler.js#L1365)，部分 headless provider fallback 也有 raw event，但独立 `--fallback-model` 路径主要通过 [`onFallback` 写 stderr](../packages/cli/src/commands/agent.js#L1395)，REPL 另有自己的日志/状态。各路径应统一为结构化事件：记录 from/to provider、model/version、原因、失败类别和预算归属；模型变化后关闭上一 trajectory segment、失效兼容性/Eval cache，并禁止把混合模型结果当成单一 Skill 的因果证据。前台 subagent 可见性则应复用到候选审阅页，展示 proposer/critic/evaluator 的实时 tool receipt 与权限，而不是只显示最终自然语言结论。

它当前更接近：

`自动记笔记 → 人工或模型编写 Skill/Workflow → 可选 skill-creator 隔离评测/版本 A/B → 用户决定提交或启用`

而不是：

`轨迹归因 → 候选 Skill → 隔离评测 → 灰度晋级 → 监控回滚`

主要不足如下：

| 能力 | 最新进展 | 相对 WikiSkill 的差距 | 可借鉴的优化方向 |
| --- | --- | --- | --- |
| Memory | 自动记录反馈、项目知识；agent 可拥有独立 memory | 仍以本机 Markdown 笔记为主，缺少统一 source event、测试凭证、置信度、矛盾关系和 Skill impact | 将 memory 分为 episodic、semantic、procedural、policy，并为派生知识建立 evidence lineage |
| Skill / Workflow | 支持热加载、嵌套、fork 到子代理；官方 `skill-creator` 可用隔离 subagent 做 assertions grading、with/without benchmark、两个 Skill 版本盲测 A/B 和 HTML review | 已有很实用的用户触发评测迭代，但不是所有 Skill 变更必经的 candidate registry、promotion、canary 和 rollback 状态机 | 复用其用例/断言/A-B 工作流，接入强制 candidate gate 与版本固定；无需重造评测 UX |
| `/goal` 与验证 | 独立小模型持续判断目标是否完成；部分环境可自主启动 code review | goal evaluator 本身不运行文件或命令；自动验证策略与 skill-creator 仍未组成强制发布事务 | 确定性测试证据 + 独立 verifier 双门禁，模型判断不能替代真实退出码和产物哈希 |
| Hooks / Plugins | 生命周期扩展面完整，插件可持久化数据 | command hook 具有较大宿主权限；自动生成的 Hook/Plugin 缺少演化专用权限清单和原生回滚 | restricted sandbox、capability manifest、签名、SBOM、权限 diff 和 fail-closed promotion |
| Agent Teams | 能并行探索和验证 | 官方仍列出实验性与恢复、状态、嵌套等限制；并行本身不会形成组织学习 | 用持久 evidence ledger 做共享黑板，并用 proposer/evaluator/governor 做权力分离 |

Claude Code 对 ChainlessChain 的最大参照价值是：Skills、Hooks、Agents、Workflows、Plugins 和 Skill 评测 UX 已证明载体形态有效；差距应准确收窄为“这些能力尚未被强制串成自动 candidate/promotion/rollback 控制平面”。

### 2.3 OpenAI Codex 生态最新进展与不足

截至审计日，OpenAI 官方 changelog 最新列出的 CLI 版本为 Codex CLI `0.151.0`（2026-08-29）。Codex 生态已有 Skills、Plugins、Hooks、Memories、Goals、长任务、Subagents、Tasks、Sandbox、Approvals 和多级权限能力；其中 Computer History 与 Record & Replay 是 macOS ChatGPT desktop 产品面，不应归属于 CLI `0.151.0`。参见 [Codex changelog](https://learn.chatgpt.com/docs/changelog)、[Memories](https://learn.chatgpt.com/docs/customization/memories)、[Computer History](https://learn.chatgpt.com/docs/customization/computer-history) 和 [Record & Replay](https://learn.chatgpt.com/docs/extend/record-and-replay)。

`0.151.0` 的直接增量包括可配置的可选 MCP discovery grace period、extension 在结果进入模型前检查或替换 MCP tool result、仓库级 plugin catalog 合并，以及权限恢复、远程沙箱、模型切换和嵌套 subagent 预算等修复；它还修复了权限状态变化后陈旧 Guardian classification 继续授权操作的问题。这些变化继续补强扩展治理和执行稳定性，但仍没有定义 experience→Wiki→candidate→Eval→promotion 的演化事务。对应到本项目，permission/policy digest 改变时，历史批准、分类结果和 Eval cache 都必须失效。

这些增量给本项目三条很具体的优化：第一，在工具结果进入模型和 Maintainer 前增加统一 `ResultProjection`，分别保存受 ACL 保护的 raw evidence 与脱敏、限长、带 trust label 的 model-visible projection，并记录 transformation digest；第二，把 MCP 发现超时、权限拒绝、provider transient、sandbox/环境错误与 Skill 程序错误分开，避免系统围绕瞬时基础设施故障“优化”错误步骤；第三，所有 proposer/evaluator/subagent 消耗都必须计入根 `EvolutionRun` 的 token/cost/time/turn 硬预算。

OpenAI 官方还给出“[用带评分的改进循环迭代困难问题](https://learn.chatgpt.com/use-cases/iterate-on-difficult-problems)”的工作方式：提供评估脚本或可审阅产物，每次只做一个聚焦改动，重跑评估并记录分数直到达到目标。这仍是用户定义目标、单次任务内的 artifact 优化，不是持久 Skill 自动晋级；但它与 ChainlessChain 已有 `GoalConditionEngine + Eval + worktree/checkpoint` 高度贴合，适合先做最小闭环，再决定是否建设完整 Wiki。

它已经形成“经验采集 → 记忆/历史 → 识别重复流程 → 起草或建议 Skill/Automation → 人工确认”的半闭环，但官方文档没有描述“自动评测候选 → canary → 晋级 → 监控 → 自动回滚”的完整闭环。

| 能力 | 最新进展 | 相对 WikiSkill 的差距 | 可借鉴的优化方向 |
| --- | --- | --- | --- |
| History / Memories | 从会话和 Computer History 生成记忆，可识别重复操作并建议 Skill | generated state 主要服务召回；[配置参考](https://learn.chatgpt.com/docs/config-file/config-reference)显示外部 MCP/Web/Tool Search 上下文默认也可能进入记忆生成，缺少演化隔离区 | 为来源增加 trust domain、TTL、污染标签和可撤销依赖；外部来源默认 quarantine |
| Record & Replay（macOS desktop） | 用户发起录制，停止后系统起草 Skill，并可继续 refinement 或在新会话请求复用 | 官方没有描述强制的候选 Eval、promotion 或验证性 replay gate | ChainlessChain 可复用现有跨平台录制原语，但必须接入统一 Eval 与 Registry |
| Hooks / Extensions | 可在生命周期检查、转换和观测工具结果；最新版本允许结果进模型前检查/替换 | `PostToolUse` 无法撤销已发生副作用；raw 与 model-visible 结果若不分层会污染证据 | active write 门禁必须在副作用前；同时建立 pre-model projection、双摘要/digest 与转换审计 |
| Sandbox / Approval | 技术沙箱、审批、auto-review 和权限 profile 较完整 | 解决的是“能否执行”，不是“新 Skill 是否更好且可晋级” | 复用其职责分离思想，新增独立 promotion controller 和 last-known-good |
| Multi-agent / Goal | 长任务和多代理已稳定化，任务与成本归属持续增强 | 多代理提高吞吐，但没有自动产生持久 Wiki 和可验证 Skill | 将 proposer、critic、evaluator、governor 配置为不同能力角色和唯一写入者 |
| Skill 选择 | 渐进加载并根据 description 触发 | Skill 多时目录会被压缩或省略；同名和描述重叠可能造成错选 | 命名空间、semver、依赖图、混合检索和 outcome-aware reranking |

Codex 的关键启发是：自进化需要的传感器、记忆、Skill 载体、Hooks、长任务、多代理和安全基础已经可以分别产品化；真正稀缺的是把它们连接起来的、可验证且可回滚的控制平面。

### 2.4 四方能力对照

下表中的“无”表示在本次论文、官方文档或本仓库静态审计范围内没有发现相应的完整机制，不代表厂商内部不存在未公开实现。

| 维度 | WikiSkill | Claude Code 2.1.251 | OpenAI Codex 生态（CLI 0.151.0） | ChainlessChain 当前基线 |
| --- | --- | --- | --- | --- |
| 经验采集 | 完整训练轨迹 | Memory、Hooks、OTel、Workflow | Memories、Hooks；Computer History/Record & Replay 为 macOS desktop | Trajectory、Hooks、Rollout、Record & Replay 均有原语 |
| 持久中间知识 | 独立 Wiki，含模式、日志、impact | Memory 笔记，无独立 Skill impact Wiki | Memories/desktop History，无官方 Skill impact Wiki | 无 canonical Wiki；多套 memory/knowledge/decision 模块并存 |
| 自动 Skill 候选 | Wiki-informed proposer | 可由 Agent 编写，通常需用户固化 | 可起草或建议，通常需用户确认 | Synthesizer CLI 入口不可用；Record & Replay 可形成 draft，但不是通用 proposer |
| Skill 验证门 | 反复复用的留出 validation split 严格提升 gate | `skill-creator` 有隔离评测/A-B，但非自动强制发布门 | 可用 eval/hooks/auto-review 拼装，无官方完整演化门 | Record & Replay 有 replay receipt 验证纵切；通用 Eval 尚未接 Synthesizer/Improver 的 promotion 事务 |
| 单 Skill 变更粒度 | 每轮 proposal 只改一个 Skill；不代表事务原子性 | 无原生强制约束 | 无官方演化级约束 | Record & Replay 以单 recorded Skill 为单位；Improver 自身无 candidate 粒度约束 |
| 回退/回滚 | candidate 未提升时恢复上一 Skill set，Wiki 保留；非部署事务 | Git/插件缓存等可辅助，无原生 Skill 生命周期 | 版本/审批基础可辅助，无官方演化 rollback 状态机 | recorded Skill 与 Plugin 有局部 CAS/rollback；无统一 Skill active/last-known-good 控制面 |
| 跨模型兼容 | 已实验，且发现负迁移 | 无原生 Skill 兼容矩阵 | 无原生 Skill 兼容矩阵 | 无 target model × tools × OS × runtime gate |
| 生产安全 | 论文未评测 | restricted、hooks/plugins 权限仍需治理 | sandbox/approval 较强，但非演化专用 | 已有安全基础，但学习 writer 未统一接入 |

## 3. 本项目已经具备、应保留的能力

以下能力不建议推倒重做，而应作为统一演化控制面的 adapter 或底层端口：

| 能力 | 当前证据 | 判断 |
| --- | --- | --- |
| Canonical capability manifest | [`capability-manifest.js`](../packages/cli/src/lib/capability-manifest.js#L2) 已是 CLI、IDE negotiation、协议文档、fixture、behavior matrix 与 release diff 的单一来源；[`cc agent --capabilities`](../packages/cli/src/lib/headless-manifest.js#L127) 可机器读取 | 不应新增平行 `capability-status.json`；静态 manifest 声明 capability/gate，易变 wiring/evidence 由绑定 manifest digest 的 runtime projection 输出，保留纯函数与 drift guard |
| 目标条件与硬预算 | [`goal-condition-engine.js`](../packages/cli/src/lib/goal-condition-engine.js#L1) 已支持确定性/模型条件、outer turn、token、cost、time 预算和 snapshot/restore；[`agent.js`](../packages/cli/src/commands/agent.js#L493) 已暴露 CLI 参数 | 是“评分改进循环”的现成 orchestration 骨架；补 candidate/eval adapter 与 root-run budget 归集即可形成最小纵切，不必先造新 scheduler |
| Worktree / Checkpoint | [`agent.js`](../packages/cli/src/commands/agent.js#L295) 默认对 Git workspace mutation 建 checkpoint，并提供隔离 worktree；[`worktree-isolator.js`](../packages/cli/src/harness/worktree-isolator.js#L266) 对清理路径 fail closed | 代码/工作区候选先复用现有隔离与恢复；Skill registry 仍需补 content-addressed candidate、active pointer 和 promotion transaction |
| 轨迹存储 | [`trajectory-store.js`](../packages/cli/src/lib/learning/trajectory-store.js#L61) 可记录 intent、tool calls、结果、response 和 outcome | 是 Raw 层原语，但当前会通过 UPDATE 重写 `tool_chain`、score 和 synthesized 标记，不是 immutable event log |
| Outcome Feedback | [`outcome-feedback.js`](../packages/cli/src/lib/learning/outcome-feedback.js#L34) 支持自动和用户反馈 | 可作为候选信号，不可作为 correctness 或 promotion oracle |
| Reflection | [`reflection-engine.js`](../packages/cli/src/lib/learning/reflection-engine.js) 可生成工具统计、趋势和报告 | 可成为 Wiki Maintainer 的分析端口；当前 CLI 传入 null LLM，只有统计反思 |
| Skill Synthesizer | [`skill-synthesizer.js`](../packages/cli/src/lib/learning/skill-synthesizer.js#L186) 可从轨迹抽取 pattern 并写 `SKILL.md` | 是 Raw→Skill writer 原语；应改为只生成 content-addressed candidate |
| Skill Improver | [`skill-improver.js`](../packages/cli/src/lib/learning/skill-improver.js#L207) 支持错误、纠正和更优轨迹三类触发；未发现生产构造点 | 可复用 patch 生成逻辑；必须限制 `skillsDir` 只能指向 candidate store，不能由它决定 active 目标 |
| Eval | [`packages/cli/src/lib/eval`](../packages/cli/src/lib/eval) 与 [`graph-kernel/eval.js`](../packages/cli/src/lib/graph-kernel/eval.js) 已有运行和趋势基础 | 应升级为独立 validator，并增加模型、工具、OS、安全和成本矩阵 |
| Rollout | [`rollout-store.js`](../packages/cli/src/lib/app-server/rollout-store.js) 与 [`sqlite-rollout-store.js`](../packages/cli/src/lib/app-server/sqlite-rollout-store.js) 已有存储端口 | 应成为 Raw event/artifact authority，而不是另建一套不可互通的轨迹库 |
| Record & Replay 生命周期 | [`recorded-skill-store.js`](../packages/cli/src/lib/record-replay/recorded-skill-store.js#L35) 已定义 `draft→approved→validated→enabled→revoked`；approval/replay 与 digest 绑定且 enable 用 revision CAS；[`record-replay.js`](../packages/cli/src/commands/record-replay.js#L516) 有 staged enable/revoke 失败补偿 | 是最接近目标的 Skill 安全纵切，应抽象为通用 Registry adapter；仍缺 Wiki、通用 proposer、shadow/canary、全局 active pointer 与 last-known-good |
| Plugin 制品事务 | [`plugin-runtime/install.js`](../packages/cli/src/lib/plugin-runtime/install.js#L1) 已有不可变版本目录、staging、签名/SBOM、active version、rollback 与 recovery；[`scopes.js`](../packages/cli/src/lib/plugin-runtime/scopes.js#L1) 对断裂 pointer fail closed | 可抽取共享 `VersionedArtifactActivation` 内核给 Skill Registry，避免重写锁、journal、pointer 与恢复；Skill 再叠加 Eval/lineage 专属策略 |
| Memory Kernel | [`context-memory-kernel`](../packages/cli/src/lib/context-memory-kernel) 已有 authority、privacy purge、compaction 和 adapter | 应承载 episodic/semantic memory；policy 与 validated procedural knowledge 仍须分层 |
| Skill Runtime | CLI [`skill-loader.js`](../packages/cli/src/lib/skill-loader.js#L436) 有 execution authority lease；[`materializeSkill`](../packages/cli/src/lib/skill-loader.js#L914) 每次重读 `SKILL.md+handler` digest，内容变化需再授权/fail closed；Desktop 另有 [`skill-loader.js`](../desktop-app-vue/src/main/ai-engine/cowork/skills/skill-loader.js) | 保留 digest/lease/TOCTOU 防线并接 Registry active digest；它是执行时防御，不等于 candidate/promotion 生命周期 |
| Skill metrics | [`skill-metrics-collector.js`](../desktop-app-vue/src/main/ai-engine/cowork/skills/skill-metrics-collector.js#L100) 的数据结构可记录 skill ID、时延、成功、token、成本和 context JSON | 修复 Desktop IPC/事件接线后可作为 InvocationReceipt adapter；当前既未可靠接线，也没有强制 digest、路由理由、模型/工具/权限指纹与任务 outcome |
| 模型选择/回退 | WS 已发 [`model-switch`](../packages/cli/src/gateways/ws/ws-agent-handler.js#L1365)；headless runner 有 [`provider_fallback`](../packages/cli/src/runtime/headless-runner.js#L2612) raw event；独立 [`fallback-model.js`](../packages/cli/src/runtime/fallback-model.js#L250) 支持同/跨 provider 回退 | 已有切换原语但 WS/headless/REPL/独立 fallback 事件口径分裂；应统一结构化证据分段和成本归属，而不是新增另一套模型生命周期 |
| Desktop Phase 20 | [`phase-16-20-skill-evo.js`](../desktop-app-vue/src/main/ipc/phases/phase-16-20-skill-evo.js#L399) 初始化知识图谱、Decision KB、Prompt Optimizer、Skill Discoverer、Debate Review、A/B Comparator | 组件丰富，但目前是六个并列 manager 与 35 个 IPC handler，不是一个原子演化事务 |
| 自改进 Skill | [`self-improving-agent/handler.js`](../desktop-app-vue/src/main/ai-engine/cowork/skills/builtin/self-improving-agent/handler.js#L293) 可记录错误、instinct 和 JSON skill | 可复用交互；“extract-skill”只写 JSON，写入失败可被吞且仍报 success，也未发现自动消费这些 learnings 的闭环，修复前不能作为持久学习证据 |

### 3.1 当前实现的关键事实差距

| 对象 | 源码事实 | 差距判断 |
| --- | --- | --- |
| CLI `evolution-system.js` | [`assessCapability`](../packages/cli/src/lib/evolution-system.js#L144) 接受外部 score；[`trainIncremental`](../packages/cli/src/lib/evolution-system.js#L226) 只按公式增加 accuracy；部分 V2 governance 使用进程内 Map，而相关 CLI 操作拆成多次进程调用 | 指标/状态账本，不是模型训练或 Skill 演化器；跨命令生命周期需要持久 store，不能靠进程内状态 |
| Desktop `self-evolving-system.js` | [`trainIncremental`](../desktop-app-vue/src/main/ai-engine/evolution/self-evolving-system.js#L209) 同样公式递增；[`selfRepair`](../desktop-app-vue/src/main/ai-engine/evolution/self-evolving-system.js#L338) 多数只返回动作字符串；[`predictBehavior`](../desktop-app-vue/src/main/ai-engine/evolution/self-evolving-system.js#L361) 使用固定概率；生产扫描未找到该模块接线 | 演示和指标壳，不应作为“真实自进化”证据；注意不要把它与已接线的 cowork Phase 20 混为一体 |
| learning hooks | [`learning-hooks.js`](../packages/cli/src/lib/learning/learning-hooks.js#L38) 定义四个入口，`SessionEnd` 仍是 no-op；生产源码静态扫描未找到定义外调用点 | 当前没有源码证据证明真实 Agent turn 自动产出该 Raw 数据 |
| `learning reflect` | [`learning.js`](../packages/cli/src/commands/learning.js#L196) 以 null LLM 构造 ReflectionEngine | 命令可输出统计，但 LLM 根因归纳未启用 |
| `learning synthesize` | [`learning.js`](../packages/cli/src/commands/learning.js#L270) 以 null LLM、无 outputDir 构造；[`_extractPattern`](../packages/cli/src/lib/learning/skill-synthesizer.js#L254) 无 LLM 即返回 null | 当前产品入口不会真实创建 Skill，因此不会走到后述 phantom-created 分支 |
| Synthesizer artifact | 组件在“有 LLM、无 outputDir”时不写文件，却仍标记 synthesized/created；[`_persistSkill`](../packages/cli/src/lib/learning/skill-synthesizer.js#L305) 直接拼接 LLM 提供的 name | 组件存在“无 artifact 也报 created”的潜在幻影成功分支；该文件内没有确定性名称校验和 realpath containment |
| Skill Improver | LLM 自报 confidence 只需 `>=0.4`；[`_writeSkill`](../packages/cli/src/lib/learning/skill-improver.js#L420) 覆盖配置的 `<skillsDir>/<name>/SKILL.md`，但 `_readSkill` 已拒绝 symlink/非文件并限长；[`_logImprovement`](../packages/cli/src/lib/learning/skill-improver.js#L439) 失败被吞 | 未发现生产构造点；若 `skillsDir` 指向 runtime tree，会绕过 candidate/Eval/CAS/audit，随后 CLI loader 的 digest 再授权只能提供执行时补防，不能替代 mutation gate |
| Improvement log | [`learning-tables.js`](../packages/cli/src/lib/learning/learning-tables.js#L59) 只有 skill、trigger、detail、created_at | 无 evidence、diff、digest、validator、模型、环境、accept/reject、rollback 或 revocation |
| 自动评分 | [`outcome-feedback.js`](../packages/cli/src/lib/learning/outcome-feedback.js#L40) 从 0.5 起，按错误率、retry 和最后工具 completed 固定加减 | 可能奖励“工具调用成功但任务答案错误”，只能用于筛选候选 |
| Skill 使用归因 | [`skill_execution_metrics`](../desktop-app-vue/src/main/database/database-schema.js#L2922) 记录 skill ID、pipeline、成功、token、cost 和自由形态 context；CLI usage ledger 有 name-level Skill/model attribution | 没有强制 Skill content digest、selector 候选/分数/理由、canonical 模型段、环境/权限指纹、terminal outcome 或 evidence digest；“执行未抛错”不能证明 Skill 改善任务结果 |
| Desktop Skill metrics 接线 | [`phase-16-20-skill-evo.js`](../desktop-app-vue/src/main/ipc/phases/phase-16-20-skill-evo.js#L30) 给 pipeline IPC 传 `{hookSystem}`、给 metrics/workflow IPC 传空依赖；[`skill-metrics-ipc.js`](../desktop-app-vue/src/main/ai-engine/cowork/skills/skill-metrics-ipc.js#L13) 实际要求 `metricsCollector`；`BaseSkill` 事件字段与 collector 监听字段也不一致 | 当前 metrics 不是“字段少但已生产可用”，而是依赖与事件 contract 均有断点；先修接线/contract tests，再扩展 Receipt schema |
| Tool result 入模 | MCP 有 [`mcp-tool-result.js`](../packages/cli/src/lib/mcp-tool-result.js#L320) 的 JSON/size/depth/node admission；Agent 随后主要 [`JSON.stringify + cap`](../packages/cli/src/runtime/agent-core.js#L14962) 后直接加入下一轮 model messages | 解决结构与上下文放大，不等于 secret/PII、prompt injection、来源 trust 的 pre-model projection；raw evidence 与 model-visible 内容也未形成可审计双层 |
| 模型切换证据 | WS 与部分 headless provider fallback 已有结构化 raw event，独立 `--fallback-model`/REPL 仍主要写日志或变量；Skill usage 未绑定 loader 的 exact content digest | 现有证据是碎片化事件，不是 canonical segment receipt；同一任务混用模型时仍无法稳定失效 Eval cache 或完成 Skill 版本因果归因 |
| Desktop A/B | [`ab-comparator.js`](../desktop-app-vue/src/main/ai-engine/cowork/ab-comparator.js#L349) 在 Agent 不可用时生成 placeholder；[`_benchmarkVariant`](../desktop-app-vue/src/main/ai-engine/cowork/ab-comparator.js#L362) 主要按长度、正则错误处理和可读性评分，且 winner 可进入 Decision KB 路径 | 不仅不能作为生产晋级门，placeholder 还可能形成 phantom winner 并污染后续知识 |
| Prompt Optimizer | [`getActiveVariant`](../desktop-app-vue/src/main/ai-engine/cowork/prompt-optimizer.js#L212) 从多个 active variant 中排序；[`optimizePrompt`](../desktop-app-vue/src/main/ai-engine/cowork/prompt-optimizer.js#L255) 只返回建议 | 有统计原语，没有真正生成、验证、晋级和回滚变体 |
| Skill Discoverer | [`skill-discoverer.js`](../desktop-app-vue/src/main/ai-engine/cowork/skill-discoverer.js#L215) 优先搜索 marketplace，失败后返回 `keyword-inference` 名称 | fallback 是关键词建议，不是可安装、可验证的真实 Skill，UI 必须明确区分 |

## 4. 优先级总览

### 4.1 P0：真实性、安全与可恢复性

| ID | 任务 | 当前差距 | 目标 | 建议投入 |
| --- | --- | --- | --- | --- |
| EVO-P0-1 | 能力真实性与 mutation freeze | CLI 空入口、指标壳、phantom created、Desktop IPC/事件误接线；配置不当时 Improver 可覆盖 runtime Skill | 扩展现有 canonical capability manifest；未接线能力显示 experimental/unavailable；默认阻止自动 active write | S～M |
| EVO-P0-2 | Candidate、Promotion 与 Rollback 事务 | Record & Replay/Plugin 有局部 CAS 与恢复，但 Synthesizer、Improver、普通 Skill 未共用 canonical lifecycle | 推广现有事务原语；所有变更先写不可变 candidate；独立 controller 原子晋级；60 秒内回滚 | M |
| EVO-P0-3 | 独立真实 Eval Gate | heuristic score、LLM confidence、placeholder A/B 都可能误判 | train/validation/test 隔离；真实任务 grader、安全 hard gate、统计门槛与成本预算 | M～L |
| EVO-P0-4 | Raw、入模投影与 Skill 编译安全边界 | Raw 含不可信用户/工具内容；当前结构/限长 admission 不等于入模脱敏；名称和内容可进入文件 | raw/model-visible 双层、脱敏、trust/quarantine、schema/name/realpath/capability diff、沙箱和人工 quorum | M～L |
| EVO-P0-5 | Fail-closed 证据与审计 | 改写后审计失败可被吞；日志缺少 diff、digest、validator 和 target runtime | append-only/tamper-evident ledger；无审计即拒绝晋级；100% lineage | M |

### 4.2 P1：统一演化控制面

| ID | 任务 | 当前差距 | 目标 | 建议投入 |
| --- | --- | --- | --- | --- |
| EVO-P1-1 | Canonical Raw/Wiki/Skill 架构 | 轨迹、memory、decision KB、reflection 和 Skill writer 分散 | 单一 EvolutionRun 状态机和三层 authority，CLI/Desktop/Graph 共用 | L |
| EVO-P1-2 | Evidence-backed Wiki Maintainer | 无持久 pattern/index/evolution-log/skill-impact | 模式可合并、矛盾、过期、撤销，并回指全部证据 | M～L |
| EVO-P1-3 | Wiki-informed Single-Skill Proposer | Synthesizer 从单一 Raw 直接生成 Skill，缺少 PURPOSE 和多证据归纳 | proposer 只写单 Skill candidate；生成 PURPOSE、diff、边界和反例 | M |
| EVO-P1-4 | 目标运行时 Eval 与负迁移检测 | 没有 model × version × tools × OS × domain 兼容矩阵 | before/after 同种子评测，shadow/canary，跨模型重新验证 | L |
| EVO-P1-5 | Registry、生命周期与单写者治理 | recorded Skill/Plugin 已有局部生命周期；普通 Skill、CLI/Desktop/Graph 与 learning writers 没有共享 Registry | 抽取 content-addressed registry、lease/fence/CAS、唯一 promotion writer、kill switch | M～L |
| EVO-P1-6 | 统一生产接线并退役重复壳 | learning hooks、Improver 未接线；CLI/Desktop 有多套“self-evolving”语义 | 真实 Agent 事件进入统一 adapter；旧壳降级为 metrics view 或退役 | M～L |
| EVO-P1-7 | 结构化 Memory/Compaction 与多 Agent 权力分离 | 摘要、个人记忆和多 Agent 消息不能保证保留关键证据与职责边界 | episodic/semantic/procedural/policy 分层；proposer/critic/evaluator/governor 隔离 | M～L |
| EVO-P1-8 | SkillInvocationReceipt 与因果归因 | metrics 只有 skill ID/执行成功等弱字段；模型切换事件口径分裂 | 每次选择与执行固定 Skill digest、router reason、模型段、环境/权限、outcome 与成本，可反向 join Eval/Wiki | M |
| EVO-P1-9 | 有界评分改进循环 | 已有 GoalConditionEngine、预算、Eval、worktree/checkpoint，但未组成 candidate 优化循环 | 一次一候选、独立评分、保留 best、失败分类、根预算停止；先离线 candidate-only | M |

### 4.3 P2：体验、生态与规模化

| ID | 任务 | 当前差距 | 目标 | 建议投入 |
| --- | --- | --- | --- | --- |
| EVO-P2-1 | 窄域受控生产 Pilot | P1 离线纵切通过后，真实流量 ROI 与安全性仍未知 | opt-in、低风险 cohort，人工 review→shadow→canary；按样本量而非固定百分比扩量 | M |
| EVO-P2-2 | Evolution Workbench | 用户看不到 evidence→pattern→diff→eval→promotion 全链路 | 可解释时间线、权限 diff、兼容范围、一键回滚 | M |
| EVO-P2-3 | Skill Retrieval Router | 全量注入不可扩展，description 路由会错选 | namespace + BM25/vector + outcome-aware rerank + 冲突说明 | M～L |
| EVO-P2-4 | 跨设备、团队和组织知识 | 当前知识多为本机或模块私有 | 加密同步、RBAC、tenant scope、冲突合并、组织批准知识 | L |
| EVO-P2-5 | 跨模型 Skill 来源/目标适配与市场治理 | 迁移可能增益也可能负迁移，市场缺少可复现效果凭证 | target-specific adapter、兼容矩阵、签名 lockfile、Eval badge、分阶段升级 | L |
| EVO-P2-6 | Wiki Pruning 与长时在线适应 | WikiSkill 本身未解决无限增长、检索和小时级在线学习 | merge/decay/TTL/tombstone；离线闭环稳定后再做无提权在线适应 | M～L |

## 5. P0：立即修复的真实性、安全与可恢复问题

### 5.1 EVO-P0-1：能力真实性与 mutation freeze

当前最先要解决的不是“让系统更主动”，而是让能力声明、生产接线和真实副作用一致。

建议：

1. 在现有 `CAPABILITY_MANIFEST` 增加 evolution capability ID、静态 dependency/gate 与 mutation scope；由运行时 probe/receipt 生成 `evolutionStatus`，至少含 `implemented`、`wired`、`verified`、`defaultEnabled`、`lastEvidence`、`manifestDigest`、`evidenceDigest`。`cc agent --capabilities`、IDE negotiation、文档和 fixture 继续共享 capability 定义；禁止另建平行 `capability-status.json`，也禁止让时间戳等易变状态污染 canonical manifest digest。
2. `learning synthesize` 在缺少 LLM、output registry 或 evaluator 时应明确返回 `UNAVAILABLE`，不能把空扫描包装为成功完成。
3. Synthesizer 只有在 artifact 成功持久化并取得 digest 后，才能标记 source trajectory；不允许“无 artifact 也 created”。
4. `SkillImprover` 在新 gate 上线前强制 `skillsDir` 指向 candidate-only root，或以 feature flag 强制只输出 diff；不能依赖 loader 的事后 digest 再授权代替写入门禁。
5. Desktop 未接线的 `self-evolving-system` 改名为 `evolution-metrics`、移除或明确标记 simulated；CLI `evolution-system.js` 保留真实治理/维护动作，但把公式型 `trainIncremental` 等接口单独标为 metrics-only，避免一刀切隐藏有效功能。
6. `keyword-inference` 结果必须显示为“搜索关键词建议”，不能显示为可安装 Skill。
7. 修复 Phase 16 pipeline/metrics/workflow IPC 依赖注入、`BaseSkill`↔collector 事件字段和 token 字段 contract；在真实实例与事件测试通过前，这些能力保持 `wired=false`。

验收标准：

- capability 清单中 `wired=false` 的功能无法通过正式入口产生“已创建/已进化”成功状态。
- 对所有 learning/evolution IPC 与 CLI 命令做 contract test，artifact、数据库状态、UI 状态三者一致。
- 自动 learning/proposer 身份对 active Skill 的非 promotion-controller 写入 100% 被拒绝并记录审计；人工编辑也必须通过显式 import/review 路径重新取得 digest 授权。
- 产品文档、命令 help、UI badge 与 runtime capability manifest 一致。

### 5.2 EVO-P0-2：Candidate、Promotion 与 Rollback 事务

建议把 Skill 当作不可变制品，而不是可原地编辑的 Markdown 文件。实现上不要绿地重写：以 `recorded-skill-store` 的 approval/replay/CAS 生命周期和 Plugin runtime 的 immutable version/active pointer/journal/recovery 为种子，抽取共享 `VersionedArtifactActivation` 端口，再补 Skill 专属 Eval、Wiki lineage、shadow/canary 和 last-known-good。

候选制品至少包含：

```yaml
candidateId: sha256:...
skillName: example-skill
parentDigest: sha256:...
contentDigest: sha256:...
sourceEvidenceRefs: []
derivationMode: wiki | record-replay | manual-import
wikiRevision: null
proposerModel: null
targetRuntimes: []
requestedCapabilities: []
evalRunId: null
status: draft
```

状态机建议为：

`draft → validating → validated → shadow → canary → active → deprecated / rolled-back / revoked`

关键约束：

- Proposer 只能创建 candidate，无权修改 active pointer。
- 默认一次 proposal 只改变一个 Skill；不可分割的依赖升级必须声明显式 transaction group，并在同一 gate 中全成或全败，不能把普通多文件修改伪装成一项原子证据。
- Promotion controller 校验 parent/candidate digest、真实 derivation receipt（Wiki revision 或 recording/approval/replay chain）、eval receipt、policy receipt 和签名后，用 CAS 原子切换 active pointer。
- approval、Guardian/分类结果和 Eval cache 必须绑定 permission/policy digest；权限、managed policy、模型、工具或 grader 版本变化时自动失效并重新验证。
- 运行中的会话固定到启动时的 Skill digest，不允许热加载导致半轮语义变化。
- last-known-good 和依赖 lock 必须一起回滚。

验收标准：

- 候选失败或进程在任意写入点崩溃时，active bytes 与 pointer 均保持不变。
- 100 轮并发 proposal/promotion 压测中无 lost update、双 active 或部分写入。
- 任一 active 版本可在 60 秒内回滚到字节级一致的上一版本。
- crash/restart 后能从 ledger 确定性恢复事务终态。

### 5.3 EVO-P0-3：独立真实 Eval Gate

现有 `autoScore`、LLM confidence、Prompt success rate 和 A/B 可读性分数都可以参与候选排序，但不能决定生产晋级。

最低可用 gate 应包含：

1. **数据隔离**：training 用于提炼；validation 用于选择；test 只用于最终报告。Proposer 不得读取 validation/test 答案和 grader；按时间、项目、用户和任务近重复做 group split，限制单一 workspace/user/replayed trace 的贡献，防止泄漏、投毒和反馈回路放大。
2. **真实 grader**：代码任务运行真实测试；文件任务校验 artifact；检索任务检查引用与答案；UI 任务回放真实状态，而不是只看 tool completed。
3. **同条件对照**：baseline 与 candidate 使用相同模型版本、seed、工具、权限、OS 镜像和输入集。
4. **多目标门禁**：质量、错误率、安全、权限、token、延迟和工具调用预算同时判定；安全是 hard gate。
5. **统计稳健性**：至少三次独立运行，或预注册置信区间/序贯检验；小样本不确定时进入 `needs-more-evidence`，而不是强制晋级或永久拒绝。
6. **防评测投机**：candidate 不能读取测试文件、grader 实现、隐藏答案或历史 validation 结果。

以下仅是**窄域 Pilot 默认起点**，不是跨任务通用发布标准。正式门槛应按风险等级、样本基线、统计功效、流量规模和成本目标预注册；样本不足时进入 `needs-more-evidence`：

- 安全与权限回归必须为零。
- 主要任务成功率的置信下界不得低于 baseline。
- 成功率提升至少 5 个百分点，或同等成功率下 token/延迟降低至少 10%。
- 低风险 Pilot 可先以 30 个 replay、20 个 holdout 作为最低探索量；高风险或高方差任务必须根据功效分析扩大样本，不足时只能停留 draft。

### 5.4 EVO-P0-4：Raw、入模投影与 Skill 编译安全边界

Raw trajectory 同时包含用户输入、工具参数、工具结果和模型输出。任何一层都可能携带秘密、个人信息、prompt injection、恶意路径、伪造成功信息或跨租户内容。把这些内容交给 Maintainer/Proposer，会把一次性攻击编译为持久 Skill。

需要明确区分三种表示：受 ACL 与保留策略保护的 raw evidence、经过脱敏/截断/来源标注后允许进入模型的 model-visible projection，以及可进入 Wiki/Skill 编译的 trusted projection。当前 MCP result admission 已限制结构、大小、深度和节点数，但这不能替代秘密/PII 清理、prompt-injection 标注和来源信任策略。每次转换都应记录 source digest、projection digest、规则版本和删改摘要，使模型看到的内容与审计原文可关联但不混存。

建议建立四道边界：

| 边界 | 必须执行的控制 |
| --- | --- |
| Raw 入库前 | secret/PII redaction、tenant scope、来源 trust、sensitivity、retention、加密与 ACL |
| 工具结果进模型前 | 生成 model-visible projection；secret/PII redaction、trust label、注入标记、内容预算；raw 与 projection 各自 digest |
| Wiki 归纳前 | 只读允许进入学习面的 trusted projection；untrusted/external trace quarantine；区分用户陈述、工具观察、模型推断和真实验证 |
| Candidate 写入前 | 严格 JSON schema、kebab-case 名称、realpath containment、symlink/size 限制、静态恶意指令扫描 |
| Promotion 前 | capability/permission/network/secret diff；独立 sandbox；高风险变更双人或 policy+human quorum |

Maintainer 和 Proposer 默认只应拥有读取指定证据、写 candidate 的最小权限，不应拥有 shell、任意网络、secret 或 active registry write 权限。

验收标准：

- prompt injection、伪成功、secret 泄漏、目录逃逸、symlink、跨租户和恶意重复轨迹负测全部通过。
- 1,000 条对抗轨迹中，零未经审查的 active Skill 修改，零 secret 进入 Wiki/Skill 明文。
- 删除或撤销源证据后，所有派生 pattern 和 candidate 在 60 秒内被定位并降权、隔离或撤销。
- capability 扩张必须显式显示且不能由自动 proposer 自批。

### 5.5 EVO-P0-5：Fail-closed 证据与审计

建议新增 append-only `evolution_events` 和 content-addressed artifacts。每次 proposal 至少记录：

- source trace/artifact digest 与数据分片版本；
- derivation mode；Wiki 路径记录 revision/pattern/evidence counts，Record & Replay 路径记录 recording/approval/replay digests；
- parent/candidate unified diff 与 digest；
- proposer/evaluator/governor 模型、版本、prompt 和权限快照；
- target model、OS、tool/API、sandbox 和依赖 lock；
- before/after 分项分数、置信区间、成本和安全报告；
- accepted/rejected/rolled-back 原因、actor 和时间；
- 签名、hash chain 和 revocation 状态。

日志持久化不是“non-critical”。任何 promotion receipt 写入失败、校验失败、签名失败或 ledger 不可用都必须 fail closed。

验收标准：

- 100% **自动晋级的 active Skill 版本**可从 digest 反查 source evidence、derivation mode、proposal diff、Eval 和审批者；Wiki 派生版本必须回指 Wiki pattern，Record & Replay 可回指 recording/approval/replay receipts，不强迫伪造 Wiki 中转。手工/导入的 legacy Skill 至少有 owner、source/import digest、权限与 migration 状态。
- 100 次数据库异常、磁盘满、断电、hook timeout 和 evaluator crash 故障注入中零误晋级。
- rejected proposal 的非敏感 metadata、digest、原因和 tombstone 按 retention policy 可查；敏感 payload 服从 TTL、用户删除与 crypto-shredding，Proposer 仍可用 tombstone 避免无证据重复提案。
- 审计导出可离线验证 hash chain、签名和 artifact digest。

## 6. P1：建立统一演化控制面

### 6.1 EVO-P1-1：Canonical Raw/Wiki/Skill 架构

建议新增唯一权威对象 `EvolutionRun`，而不是让 TrajectoryStore、Reflection、Decision KB、Prompt Optimizer、SkillImprover 和 Desktop Phase 20 各自定义一次“进化”。

```text
Agent / Tool / User events
          ↓
Canonical Rollout & Artifact Store
          ↓
Raw projection ──→ Wiki Maintainer ──→ Wiki revision
                                       ↓
Active Skill ──→ Single-Skill Proposer ──→ Candidate
                                       ↓
Independent Eval / Policy / Human Review
                                       ↓
Registry promotion / rollback
```

Wiki 是跨轨迹归纳型学习的中间表示，不应成为所有 Skill 的形式主义中转站。现有 Record & Replay 若已具备 recording、人工 approval 和 replay validation receipts，可以通过 `derivationMode=record-replay` 直接进入同一 Candidate/Registry gate；只有需要跨案例归纳的经验才走 Wiki Maintainer/Proposer。

建议目录或逻辑等价物：

```text
evolution/
  raw/events/
  raw/artifacts/
  wiki/index/
  wiki/patterns/
  wiki/evolution-log/
  wiki/skill-impact/
  registry/candidates/
  registry/releases/
  eval/runs/
  policies/
```

Raw 应是逻辑 append-only event 与 content-addressed artifact reference，查询需要的完整轨迹由 deterministic reducer 投影；outcome、tag、合成状态和删除 tombstone 都作为新事件追加，而不是修改原始事件。敏感 payload 使用独立加密对象和 key reference，使法定删除/用户删除可通过 crypto-shredding 完成，同时保留不含敏感内容的 lineage metadata。

验收标准：重复事件、乱序、crash/replay 和 compaction 后，得到相同 Raw/Wiki/Registry 投影；CLI、Desktop 和 Graph 对同一 run ID 返回相同状态与 digest。

### 6.2 EVO-P1-2：Evidence-backed Wiki Maintainer

每个 Wiki pattern 建议至少包含：

```yaml
patternId: pat-...
kind: success | failure | constraint | anti-pattern
summary: ...
rootCause: ...
procedure: ...
appliesWhen: []
doesNotApplyWhen: []
positiveEvidence: []
negativeEvidence: []
contradicts: []
supersedes: []
confidence: 0.0
trustDomains: []
lastVerifiedAt: ...
expiresAt: ...
```

Maintainer 需要完成去重、聚类、根因归纳、成功模式提炼、反例维护、矛盾检测和 evidence count 更新。不能因为某次 Skill proposal 被拒绝就回滚 Wiki，但必须记录拒绝结果，降低或修正关联模式的可操作性。

WikiSkill 只对 Skill proposal 评分，Maintainer 生成的 Wiki pattern 本身不经过同等 gate 且不会随候选回退。本项目因此应把 pattern 定义为可纠错假设，而非已验证事实，至少区分 `hypothesis / corroborated / contradicted / revoked`；单条 LLM 总结不能直接成为可编译 procedure，必须有多源证据或真实 grader receipt。proposal 被拒绝时保留历史，但要更新关联 pattern 的 impact 与反证，防止错误 Wiki 跨轮累积。

知识不是无限追加：pattern 需要 merge、decay、stale、tombstone 和 revocation。非敏感审计 metadata 可按策略保留；敏感 payload 必须服从 retention、用户删除与 crypto-shredding，默认检索视图同时剪枝，并沿依赖图使派生对象 stale/revoked。

### 6.3 EVO-P1-3：Wiki-informed Single-Skill Proposer

Proposer 初始只读取 Wiki index、Skill impact、active Skill digest 和训练任务结果摘要；需要时按权限选择性读取 pattern 和 Raw，避免一次性塞入全部轨迹。

每个 proposal 必须：

- 只创建或修改一个 Skill；
- 提供 `PURPOSE.md` 或等价结构，回指 pattern 和 source evidence；
- 提供适用条件、不适用条件、失败反例、回退步骤和验证方法；
- 明确 requested capabilities、target runtimes 和上下文成本；
- 生成 machine-readable diff，不直接写 active 文件；
- 如果证据矛盾或样本不足，输出 `no-proposal` 或 `needs-evidence`，不能为了完成循环强行修改。

WikiSkill 的研究结果支持在**演化训练 rollout 的 Pilot** 中默认让执行 Agent 只读 active Skill、Wiki 只对 Maintainer/Proposer 开放。ChainlessChain 应把该实验条件实现为可配置 capability policy，并做按域对照；它不是所有生产推理永远禁止访问 Wiki/Memory 的通用结论。

### 6.4 EVO-P1-4：目标运行时 Eval、Shadow 与 Canary

每个已验证 Skill 都应附兼容矩阵：

`model family/version × OS/arch × tool/API version × permission profile × domain/data version`

跨模型 Skill 只能先进入 target-specific validation。对于模型特有 workaround，应允许生成 adapter 或 variant，不能把源模型 Skill 静默设为全局 active。

上线流程建议：

1. offline replay；
2. hidden holdout；
3. shadow，只记录候选决策、不产生副作用；
4. canary 按 tenant/user/session 固定路由；低流量部署使用“接下来 N 个低风险会话/显式 cohort”，有足够流量时再使用预注册百分比；
5. 逐级扩大；
6. 达到预注册质量/成本回归界限、安全违规或预算越界时自动回滚；界限按风险和样本功效校准，不把固定 `+2pp` 当通用标准。

模型、工具或依赖版本变化时，受影响 Skill 自动进入 `stale-needs-revalidation`，而不是继续沿用历史徽章。

### 6.5 EVO-P1-5：Registry、生命周期与单写者治理

Skill Registry 应统一名称空间、semver、content digest、依赖 lock、owner、tenant、trust、sensitivity、allowed tools/sinks、target runtime 和 revocation。

落地时优先把 recorded Skill store 与 Plugin lifecycle 包装成同一 artifact activation port：前者提供 Skill approval/replay/expectedRevision 语义，后者提供 immutable version、active pointer、签名/SBOM、journal、lock 和 recovery。不要让新 Registry 绕过这两套已验证的防线；也不要直接复用整个 Plugin 模块而把 Plugin 专属 marketplace/source policy 强耦合进 Skill，应抽取最小公共事务内核并用 contract test 证明旧路径行为不变。

多 Agent 只用于职责分离和并行评测：

- proposer：只写 candidate；
- critic：只读，寻找反例和过拟合；
- evaluator：只运行固定评测；
- governor：只校验 policy、签名和权限；
- promotion controller：唯一 active pointer 写入者。

Registry 写入必须使用 lease/fence/CAS，避免两个 proposer 或两个客户端同时晋级导致覆盖。任何 Agent 都不能通过自修改 prompt 或 Skill 获得更高权限。

P1 必须同时交付一个最小 reviewer surface：展示 evidence 摘要、candidate diff、权限变化、Eval receipt、target runtime，并支持 approve/reject。P2 Workbench 再补完整时间线、搜索、解释、批量治理和高级可视化；不能因为完整 Workbench 排在 P2，就让 P1 人工门禁退化为盲批。

### 6.6 EVO-P1-6：统一生产接线并退役重复壳

建议把真实生产事件接到统一 adapter：

- UserPrompt/TurnStarted → Raw start event；
- ToolRequested/ToolCompleted/ToolFailed → Raw tool events；
- ResponseCompleted/UserCorrection/TestReceipt → outcome evidence；
- SessionEnd/GoalEnd/ScheduledBatch → Maintainer trigger；
- CandidateCreated/EvalCompleted/HumanTaskSettled → Registry transition。

CLI `learning-hooks.js` 不应继续作为无人调用的平行接口；Desktop Phase 20 的六个 manager 应作为 Maintainer、Eval 或 UI adapter，不能各自写“进化终态”。Desktop 未接线的 `self-evolving-system` 可降级为 metrics projection 或退役；CLI evolution 模块中的真实治理动作保留，只有公式型训练指标移出“训练成功”语义。

### 6.7 EVO-P1-7：结构化 Memory、Compaction 与多 Agent 权力分离

借鉴 Claude Code 和 Codex 的最新能力，但补上其共同缺口：

| 层 | 内容 | 自动经验是否可覆盖 |
| --- | --- | --- |
| Episodic | 原始会话、工具、artifact、用户反馈 | 只追加或依法删除，不静默覆盖 |
| Semantic | 稳定事实、约束、架构决定、矛盾 | 可提案，需证据和冲突处理 |
| Procedural | validated Skill、恢复步骤、workflow | 只能经 promotion gate 更新 |
| Policy | AGENTS、组织规则、权限和合规 | 不得由自动经验覆盖 |

Compaction 必须保存 requirements、decisions、open risks、failed attempts、tests、goal state、delegated tasks 和 memory lineage。`PostCompact` 运行一致性检查；失败时恢复上一快照。

多 Agent 共享的是有证据和 scope 的事实黑板，而不是自由文本“结论”。子 Agent 的经验先进入统一提炼队列，不能直接污染组织 procedural memory。

### 6.8 EVO-P1-8：SkillInvocationReceipt 与因果归因

修复 IPC 依赖注入、`BaseSkill`/collector 事件字段和 token 字段不一致后，现有 `skill_execution_metrics` 才可作为 adapter；CLI 现有 name-level usage attribution 也应接入。即便如此，“Skill execute 未抛错”只说明局部调用完成，不能回答 Skill 是否被正确选择、是否改善最终任务、是否因模型或环境变化才成功。每次**选择、暴露与执行**至少记录：

```yaml
receiptId: ...
evolutionRunId: ...
traceId: ...
trajectorySegmentId: ...
selectedSkillDigests: []
routerCandidates: [{digest: ..., score: ..., reason: ...}]
providerModelVersion: ...
toolSetDigest: ...
osSandboxPermissionPolicyDigest: ...
taskCohort: ...
executionStatus: ...
graderReceipts: []
userCorrectionRef: null
tokenCostLatency: {}
```

模型切换、fallback、tool set、permission/policy 或关键依赖变化都关闭当前 segment 并开启新 segment；不得把跨 segment 的结果直接归因给同一个 Skill 版本。Receipt 只保留归因所需的 bounded metadata/digest，敏感输入输出继续通过受控 artifact reference 访问。

验收标准：自动候选与 canary 运行 100% 产生可 join 的 exposure/outcome receipt；同一 trace 可确定性回答“选了什么、为何选择、在哪个环境、结果由谁判定、花费多少”；在该覆盖率达标前，不启用 outcome-aware reranking 或自动效果声明。

### 6.9 EVO-P1-9：复用现有底座的有界评分改进循环

建议先实现 `cc lab evolution pilot` 或等价内部入口，不先建设新调度服务：

1. 固定 baseline digest、训练/验证 split、grader、runtime fingerprint 与 root budget。
2. 在现有 worktree/checkpoint 或 candidate store 中，每轮只产生一个聚焦候选。
3. 优先运行确定性测试/产物 grader，再运行隔离模型 evaluator；记录 receipt。
4. 对比 best；满足预注册 gate 才更新本次 run 的 best candidate，否则丢弃候选，active 始终不变。
5. 将失败分类为 `procedure | model | data | infrastructure | permission/policy | security`。MCP discovery timeout、provider transient、sandbox 缺失和权限拒绝默认不记为 Skill 负样本，除非任务目标本身就是恢复这类故障。
6. proposer、critic、evaluator、subagent 的 token/cost/time/turn 全部记入根 `EvolutionRun`；任一预算耗尽、证据未知或 receipt 写入失败即停止，不允许隐藏的子任务继续优化。
7. snapshot/restore 延用 `GoalConditionEngine` 的确定性状态；代码候选复用 worktree/checkpoint，Skill 发布仍走 candidate registry，不把 Git checkpoint 当作 active Skill promotion transaction。

这一步是 P1 的离线 candidate-only 纵切，用来验证控制协议和 ROI；P2 才把通过的闭环接入 opt-in 真实流量、人工 review、shadow/canary。验收时应覆盖 budget exhaustion、provider/MCP transient、permission denial、evaluator crash、resume 和相同输入重放，并证明不会误改 active 或把基础设施失败编译成错误 Skill。

## 7. P2：产品体验、生态与规模化

### 7.1 EVO-P2-1：窄域、受控生产 Pilot

在 P1 离线 candidate-only 纵切通过后，选择高重复、低副作用、答案可自动验真的窄域，例如固定仓库的测试失败修复建议、结构化数据导入或 Record & Replay 稳定流程。

生产 Pilot 默认 opt-in、单租户或明确 cohort；自动阶段仍只生成 candidate。用户旅程为：

`查看 Why/Evidence → 审查 Diff/权限 → 查看 Before/After → 批准 Shadow → Canary → Active`

至少跨一个预注册观测窗口记录 adoption、success delta、cost delta、用户修订率、误晋级率、回滚率和安全事件；按所需样本量决定窗口，不机械固定 30 天或 5% 流量。未达到门槛不扩域。

### 7.2 EVO-P2-2：Evolution Workbench

工作台应提供一条可解释时间线：

`Raw/Recording evidence → Wiki pattern 或 direct replay derivation → Candidate diff → Eval receipt → Approval → Promotion/Rollback`

这是对 P1 最小 reviewer surface 的产品化扩展：增加检索、完整历史、冲突解释、批量治理与长期指标，而不是 P1 人工门禁的前置依赖。

用户能够回答：

- 为什么产生这个 Skill？
- 哪些成功和失败轨迹支持它？
- 哪些模型、工具和环境验证过？
- 相比上一版改变了什么权限、成本和行为？
- 为什么被接受、拒绝或回滚？
- 当前会话实际固定到了哪个 digest？

### 7.3 EVO-P2-3：Skill Retrieval Router

不要照搬 WikiSkill 的 full injection。建议采用：

`namespace/tag/path filter → BM25 + vector recall → compatibility filter → outcome-aware rerank → conflict resolver`

路由结果显示选择理由、版本、上下文成本和冲突。`500` 个 prompt、Recall@5 `≥95%`、误调用率 `<2%`、本地 p95 `<100ms` 可作为低风险 Pilot 的示例起点，正式阈值按语料规模、错误成本与设备档位预注册；同名或不兼容版本不得静默选择。

### 7.4 EVO-P2-4：跨设备、团队和组织知识

支持 personal/project/team/org scope、端到端加密、RBAC、租户隔离、离线冲突合并、批准与撤销。两台机器或 cloud session 只同步已授权、已批准知识；个人 memory 不因 Agent Team 协作自动升级为团队规则。

删除证据、用户行使隐私删除或组织撤销知识时，反向依赖图必须定位并处理派生 Wiki、candidate 和 active Skill。

### 7.5 EVO-P2-5：跨模型 Skill 来源/目标适配与市场治理

WikiSkill 实验的是 source-model-evolved Skill 文件向 target inference model 的直接迁移，不是教师/学生蒸馏。实验既有正迁移，例如 Qwen-3.6-27B 的 ALFWorld Skill 使 Qwen-3.5-9B 达到 `70.2%`、高于其 self-evolved Skill 的 `63.4%`，也有 Spreadsheet 的严重负迁移。因此可以把“强模型 proposer 为小模型起草候选”作为产品假设，但必须在目标模型上重新评测，且不能预设更强 source 必然更可迁移。

Skill/Plugin 市场增加：签名、来源 commit、SBOM、依赖 lock、权限 manifest、模型/OS/工具兼容矩阵、可复现 Eval badge、演化 lineage、分阶段更新和一键回滚。排名不能只看安装量或 LLM 自报 confidence。

### 7.6 EVO-P2-6：Wiki Pruning 与长时在线适应

建立 pattern 合并、重复检测、evidence decay、TTL、stale、tombstone、矛盾解析和压缩。审计证据保留，默认检索索引可清理过时知识。

只有离线闭环长期稳定后才研究单次长任务内适应；online change 不获得新增权限、不跨过 promotion gate、不跨租户，并在任务结束后重新进入离线验证。

## 8. 90 天建议路线图

90 天目标应限定为“一个窄域、candidate-only 到受控 shadow 的纵切”，不是交付全部 P1/P2 平台。跨组织同步、市场治理、通用 Router 和长期在线适应均不进入本周期承诺。

### 阶段 A：第 1～2 周，冻结风险并校正真实性

- 扩展现有 canonical capability manifest 的 evolution 状态投影，并校正产品文案。
- 强制 `SkillImprover.skillsDir` 只能指向 candidate root，Synthesizer 改为 diff-only/candidate-only。
- 修复无 artifact 仍 created、self-improving 持久化失败仍 success、keyword fallback 冒充 Skill、metrics-only 模块命名问题。
- 修复 Phase 16 pipeline/metrics/workflow IPC 依赖注入与 Skill metrics 事件字段 contract，并用真实实例测试证明 `wired=true`。
- 建立当前所有 learning/evolution 入口、调用点和 writer inventory。

退出条件：没有未登记的 active Skill writer；所有正式入口的状态与 artifact 一致。

### 阶段 B：第 3～5 周，建立 Candidate 与安全门

- 从 recorded Skill lifecycle 与 Plugin activation transaction 抽取公共端口，补 content-addressed Skill candidate、统一 active pointer、last-known-good 和 rollback；代码/工作区候选先复用现有 worktree/checkpoint。
- 上线 Raw redaction、tenant scope、quarantine、名称/路径/schema/capability 校验。
- 建立 append-only evolution ledger 和 fail-closed receipt。
- 对目录逃逸、注入、秘密、跨租户、磁盘/数据库失败做负测。

退出条件：所有自动变更只能进入 candidate；故障注入零误晋级；60 秒回滚达标。

### 阶段 C：第 6～9 周，接入真实 Eval 与三层架构

- 复用 rollout/eval/record-replay，建立 replay、holdout、对抗和成本评测。
- 建立 Raw event projection、Wiki pattern/index/log/impact 和 `EvolutionRun` 状态机。
- 实现 Maintainer 与 Single-Skill Proposer 的 capability 隔离。
- 扩展 Skill metrics 为 `SkillInvocationReceipt`，统一 model-switch/fallback segment、failure taxonomy 和根预算归属。
- 用 `GoalConditionEngine + Eval + worktree/checkpoint` 跑通有界评分改进循环。
- 输出目标模型、工具、OS 和权限 profile 的兼容 scorecard。

退出条件：至少一个窄域 Skill 能完成 evidence→candidate→eval→reject/validate 全流程，且不修改 active。

### 阶段 D：第 10～13 周，Shadow Pilot 与统一接线

- 将真实 CLI/Desktop Agent events 接入 canonical adapter。
- 退役或降级重复 self-evolving 壳和未接线 learning hooks。
- 上线最小 reviewer surface、人工 review 与 shadow；只有样本功效和风险门满足时才进入显式低风险 cohort canary。
- 启动预注册 Pilot 观测窗口，不因演示节点或固定日期而放宽 P0 门禁。

退出条件：至少一个 Skill 在真实目标环境完成可审阅晋级和自动回滚演练；是否扩大范围由量化结果决定。

## 9. 建议验收标准

下列“零越权/零 secret/无审计不晋级”等安全性质是硬门；样本数、时延、百分比和观测窗口是 Pilot 默认值，落项时必须按风险等级与统计功效校准并写入版本化 policy，不能把示例数字当成跨域 SLA。

### 9.1 P0 发布门槛

| 类别 | 必须满足 |
| --- | --- |
| 真实性 | artifact、数据库、UI、CLI 状态一致；未接线能力不得显示成功 |
| 写入权 | active registry 只有 promotion controller 可写；其他路径 100% 阻止 |
| 安全 | 注入、secret、路径逃逸、symlink、跨租户、权限扩大负测全部通过 |
| 审计 | 100% 自动晋级的 active 版本有完整 evidence、derivation mode、diff、eval、policy、actor 和 digest lineage；Wiki/record-replay 各保留真实来源链，legacy/imported 有来源与迁移标记 |
| 故障 | 100 次关键故障注入零误晋级；crash 后可确定恢复 |
| 回滚 | 60 秒内恢复上一版本及依赖 lock，字节级一致 |

### 9.2 P1 Definition of Done

- CLI、Desktop、Graph 对同一 `EvolutionRun` 使用相同 schema、状态和 digest。
- Raw 是 append-only event/artifact，重放结果确定；outcome 和合成状态不修改原始证据。
- Wiki 至少支持 pattern、index、evolution log、skill impact、矛盾、过期和撤销。
- 每个 candidate 默认只改一个 Skill，并有 PURPOSE/evidence、权限 diff 和 target runtime；显式 dependency transaction group 必须全成或全败。
- Proposer 无 validation/test 答案和 active write 权；Evaluator 无 proposal write 权。
- 每个可晋级 Skill 有 replay、holdout、对抗、安全、成本和兼容 scorecard。
- 每次 Skill exposure/execution 有可 join 的 InvocationReceipt；模型、工具、permission/policy 变化产生新 segment 并失效相关批准/Eval cache。
- raw evidence、model-visible projection 与 trusted learning projection 有独立 digest、ACL、转换 receipt 和删除传播。
- 有界改进循环把所有子 Agent 消耗计入根预算，并能区分 procedure 与 infrastructure/permission/provider failure。
- shadow/canary 回归越界时自动回滚，且不会切换正在运行会话的 Skill digest。

### 9.3 P2 Definition of Done

- Workbench 可从任意 active Skill 回溯完整演化时间线并一键回滚。
- Router 在真实基准达到 Recall@5、误调用率、延迟和上下文预算目标。
- 跨设备/团队同步通过 RBAC、加密、冲突和隐私删除测试。
- 市场 Skill 有签名、lock、权限、兼容和可复现 Eval 信息。
- Pilot 在成功率、成本、修订率、误晋级、回滚和安全上达到预注册样本量与门槛后才扩域。

## 10. 不建议照搬的部分

1. **不要把 WikiSkill 写成 Google 已发布产品。** 它当前是预印本研究框架；论文未链接官方实现，也未报告生产安全验证。
2. **不要把“自进化”写成模型权重训练。** 本报告讨论的是外部经验、知识和 Skill 的受控演化。
3. **不要照搬全量 Skill 注入。** 论文为排除触发误差而这样设计，生产规模下会遇到上下文、冲突和错误触发问题。
4. **不要机械照搬严格 `score > best`。** 小验证集有噪声，中性基础变更也可能为后续迭代铺路，应允许 needs-more-evidence 分支。
5. **不要让执行 Agent 同时当提案者和裁判。** 会形成自证、评测污染、权限混合和难以归因的问题。
6. **不要把 Memory 当 Policy。** 自动摘要或个人偏好不能覆盖 AGENTS、组织规则、权限和合规要求。
7. **不要把多 Agent 并行当作组织学习。** 没有 evidence ledger、scope、冲突和晋级门，多代理只会更快地产生不一致。
8. **不要自动启用生成的 Skill、Hook 或 Plugin。** 热加载能力越强，candidate/active 隔离和版本固定越重要。
9. **不要让 Wiki 永久只增不减。** 生产系统必须支持 stale、merge、tombstone、revocation 和隐私删除传播。
10. **不要重建已有 Manifest、Goal/Budget、Worktree/Checkpoint、Eval、Rollout、Memory、Record & Replay 和 Skill Runtime。** 应通过 canonical ports 收敛，而不是再复制一套。
11. **不要把所有失败都归因给 Skill。** MCP/provider transient、权限拒绝、sandbox/依赖缺失与程序步骤错误必须分开，否则自进化会固化环境噪声。
12. **不要跨模型段做伪因果归因。** model switch/fallback 后应产生新 trajectory segment；没有 InvocationReceipt 时不启用 outcome-aware reranking。

## 11. 审计范围与限制

### 11.1 审计口径

- 外部事实仅使用一手来源：WikiSkill 原论文、Anthropic Claude Code 官方文档/官方仓库、OpenAI Codex 官方文档。
- “官方未描述”表示在本次所列官方页面中没有发现该完整机制，不等于证明厂商内部绝对不存在。
- 本仓库判断基于基线提交的静态源码审计、入口与引用扫描；“未找到生产调用点”不排除运行时字符串、动态加载或外部集成，但当前仓库没有给出可验证证据。
- 审计期间工作区存在与本报告无关的 graph/CI 未提交改动；本报告未修改或依赖这些文件，所引用的 learning/Skill/runtime 事实均按上述 HEAD 基线核对。
- 本次没有启动真实 provider、执行 E2E、修改 Skill 或验证运行时性能；建议优先用 P0 inventory 和 contract tests 复核静态结论。
- WikiSkill 是 2026-08-27 的 v1 预印本，结论可能随论文修订、代码发布和更大规模实验变化。

### 11.2 主要外部来源

- [WikiSkill: Compiling Agent Experience into Persistent Knowledge for Skill Evolution](https://arxiv.org/html/2608.27454)
- [Claude Code changelog](https://code.claude.com/docs/en/changelog)
- [Claude Code memory](https://code.claude.com/docs/en/memory)
- [Claude Code goals](https://code.claude.com/docs/en/goal)
- [Claude Code subagents](https://code.claude.com/docs/en/subagents)
- [Claude Code agent teams](https://code.claude.com/docs/en/agent-teams)
- [Claude Code workflows](https://code.claude.com/docs/en/workflows)
- [Claude Code hooks](https://code.claude.com/docs/en/hooks)
- [Claude Code skills：evaluate and iterate](https://code.claude.com/docs/en/skills)
- [Claude Code plugins reference](https://code.claude.com/docs/en/plugins-reference)
- [OpenAI Codex changelog](https://learn.chatgpt.com/docs/changelog)
- [OpenAI Codex Memories](https://learn.chatgpt.com/docs/customization/memories)
- [OpenAI Codex Computer History](https://learn.chatgpt.com/docs/customization/computer-history)
- [OpenAI Codex Record & Replay](https://learn.chatgpt.com/docs/extend/record-and-replay)
- [OpenAI Codex Build Skills](https://learn.chatgpt.com/docs/build-skills)
- [OpenAI Codex：Iterate on difficult problems](https://learn.chatgpt.com/use-cases/iterate-on-difficult-problems)
- [OpenAI Codex Hooks](https://learn.chatgpt.com/docs/hooks)
- [OpenAI Codex Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)
- [OpenAI Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)

## 12. 最终建议

ChainlessChain 不缺“会记、会反思、会写 Skill”的功能点，真正缺的是把这些功能变成可信闭环的演化控制平面。

建议把近期资源集中到两个阻断式 P0：

1. **所有自动变更 candidate-only，独立评测后才能由单写者原子晋级并可回滚。**
2. **Raw→model-visible/trusted projection→Wiki→Skill 全链路建立不可信数据、权限、秘密、路径和审计边界。**

最短 P1 路径是：扩展已有 `CAPABILITY_MANIFEST` 并修复 metrics 接线 → 把 recorded Skill lifecycle 与 Plugin activation transaction 抽成通用 Registry 端口 → 用 `GoalConditionEngine + Eval + worktree/checkpoint` 跑通有界 candidate-only 改进循环 → 补 `SkillInvocationReceipt`、模型分段和失败分类 → 再接 Wiki Maintainer。这个顺序能先验证 ROI 和控制协议，也最大限度复用现有实现。

完成这些前提后，再以现有 Rollout、Memory、Record & Replay、Skill Runtime 和 Desktop Phase 20 为 adapter 扩展到受控生产 Pilot，而不是继续新增平行的“自进化”模块。这样才能把 WikiSkill 的研究启发、Claude Code 的评测/扩展载体和 Codex 的安全/编排基础，转化为 ChainlessChain 可验证、可维护、可规模化的产品能力。
