# RSIAgent 对 ChainlessChain 的启示与实施建议

- 整理日期：2026-09-17
- 分析基线：`ea28e0c8ce26d692496e3db4e839361c3d391805`
- 状态：架构分析与实施建议，尚未实施本文提出的新增能力
- 依据：当前仓库源码、已有演化差距分析文档，以及 RSIAgent 论文和官方项目资料

## 1. 核心判断

ChainlessChain 已有 Agent、Memory、评测、审核、发布与回滚等基础能力。最值得借鉴 RSIAgent 的地方，是增加面向真实软件环境的自主探索流程，让 Agent 经验证的操作经验持续进入现有演化链。

仓库已有以下受治理流程：

```text
Raw → Wiki → Candidate → Eval/Review → Pilot/Release → Rollback/Pruning
```

结构化 Memory、独立评测、运行时失效检查和审计账本也已具备代码基础。现有治理体系覆盖的发布与恢复环节较丰富，但这不等于已证明真实任务能力优于 RSIAgent，也不等于生产自主进化已经上线。

[现有自进化差距分析](./AGENT_SELF_EVOLUTION_GAP_ANALYSIS_2026-09-01.md)明确区分了“仓库闭环”和“目标环境生产化”：真实 runner/grader、身份与密钥基础设施、独立 witness、真实租户与流量，以及部署级恢复验收仍是重要条件。

本文基于源码阅读提出建议，没有重新运行完整测试或复现论文实验。

## 2. 与项目现状的对应关系

| RSIAgent 思路                 | ChainlessChain 已有基础                            | 值得补齐的部分                                                |
| ----------------------------- | -------------------------------------------------- | ------------------------------------------------------------- |
| Curriculum / Actor / Verifier | 任务分解、Computer Use、Eval Gate、人工 Review     | 专门规划“下一步探索什么”的环境探索器，以及真实环境验证适配器  |
| Broad → Deep 探索             | 并行 Agent、重试和有界评分循环                     | 将“广域探索→失败点深挖”明确为可审计、可恢复、有预算的探索流程 |
| 经验写入 Memory               | episodic、semantic、procedural、policy 四层 Memory | 将旧 Desktop 学习模块积累的经验纳入统一证据与审核流程         |
| 冻结 Memory 后复用            | Skill Release、Registry、运行时 revalidation       | 让浏览器和桌面操作经验通过正式演化链成为可复用版本            |
| 环境变化后重新学习            | 环境、模型、工具、依赖锁和宿主绑定                 | 将绑定贯穿探索轨迹与调用回执，并接入环境变化后的再探索调度    |
| 通过实验评价效果              | Eval、Pilot、成本延迟指标、大量 E2E                | 真实目标环境 runner、隐藏评测集与等预算对照实验               |

对应代码入口：

- [Agent Evolution Runtime Composition](../packages/cli/src/lib/evolution/agent-evolution-runtime-composition.js)
- [Evolution Release Train Domain Stages](../packages/cli/src/lib/evolution/evolution-release-train-domain-stages.js)
- [Structured Memory Agent Control Plane](../packages/cli/src/lib/evolution/structured-memory-agent-control-plane.js)

## 3. 最值得学习的五件事

### 3.1 增加环境探索层

建议在现有 Raw Evidence 入口前增加 `Environment Exploration Run`，由它提出探索任务、调度执行和收集验证证据，再交由既有 Wiki、Candidate 和发布流程处理。

```text
Broad Explorer
  ├─ 探索工具、API、UI 结构
  ├─ 探索权限与输入边界
  └─ 探索常见失败路径
            ↓
Deep Explorer
  ├─ 针对失败任务继续试验
  ├─ 验证隐藏前置条件
  └─ 比较不同恢复策略
            ↓
独立验证与证据采集
            ↓
Raw Evidence → Wiki → Skill Candidate → Eval → Review → Pilot
```

建议复用现有能力：

- [AgentCoordinator](../desktop-app-vue/src/main/ai-engine/agents/agent-coordinator.js)：任务编排及其 canonical Graph 执行入口。
- [AutonomousAgentRunner](../desktop-app-vue/src/main/ai-engine/autonomous/autonomous-agent-runner.js)：参考其规划、执行和观察循环；接入时遵守现有运行时权限边界，不能因探索需求重新启用受限的 legacy 路径。
- [ComputerUseAgent](../desktop-app-vue/src/main/browser/computer-use-agent.js)：浏览器和桌面动作能力。
- EvolutionRun、Wiki Maintainer、Release Train：证据归档、经验提炼、候选生成与发布。

探索应在一次性数据库、临时工作区或可重置的测试环境中运行，预先固定允许的工具、操作范围、token、时间与重试预算。探索产物先进入 Raw Evidence，后续是否成为可执行经验由现有治理流程决定。

### 3.2 使用独立验证确认任务结果

所检查的 AutonomousAgentRunner ReAct 循环主要根据工具返回值和模型判断记录结果；ComputerUseAgent 主要保留动作、返回结果、时长和重试历史。它们本身不足以证明用户要求的最终状态已经实现。

可以按任务类型接入独立 Verifier：

| 任务类型 | 验证方式                                         |
| -------- | ------------------------------------------------ |
| 文件处理 | 检查文件格式、内容断言、必要的 hash 和输出位置   |
| UI 操作  | 检查 DOM、截图、持久状态及刷新后的结果           |
| 项目管理 | 查询数据库、IPC 状态和业务约束，验证完整流程结果 |
| 网络操作 | 检查响应字段和实际副作用，区分请求成功与业务成功 |
| 代码修改 | 隔离构建、测试、静态检查和行为断言               |

Verifier 应读取真实执行产物，产生可回读的 grader receipt。它不能只复述 Actor 的自评，也不能把单次工具调用返回 `success: true` 当作整个任务成功。

已有 [Evolution Eval Gate](../packages/cli/src/lib/evolution/evolution-eval-gate.js) 可以承接评测治理；需要补齐的是具体环境的 runner、grader 和证据适配。

### 3.3 将旧学习模块纳入统一流程

Desktop 内置 [Self-Improving Agent Handler](../desktop-app-vue/src/main/ai-engine/cowork/skills/builtin/self-improving-agent/handler.js) 会保存错误、修正、instinct 和技能提取记录。其 `handleVerifyInstinct()` 根据调用者传入的成功标记更新统计，并将 `verified` 设为真；置信度来自使用次数、成功次数、失败次数和新鲜度等启发式规则。

这些记录可以作为经验线索，但不能直接充当独立验证证据。建议统一其语义：

- `capture-instinct` 生成 semantic proposal，并附带证据引用。
- `verify-instinct` 引用独立 grader receipt，区分“已检查”“检查失败”和“验证通过”。
- `extract-skill` 产生 Candidate，交给既有 Eval、Review 和 Promotion 流程。
- 正式 procedural Memory 仍通过 Promotion Controller 写入。
- `history.json`、`learnings.json` 逐步成为兼容导入源或只读展示投影。

现有 [Structured Evolution Memory](../packages/session-core/lib/structured-evolution-memory.js) 已区分四层写入权限：semantic 接受需要 critic、evaluator 与 governor；procedural 通过 promotion controller 修改；policy 需要明确的人工治理权限。这套约束适合继续复用。

### 3.4 让经验绑定可验证的环境版本

项目已具备 [Skill Runtime Revalidation](../packages/cli/src/lib/evolution/skill-runtime-revalidation.js)：它将 Skill 与 `targetEnvironmentRef`、`environmentDigest`、模型、工具、依赖锁和宿主运行时绑定。绑定变化或无法验证时，会进入 `stale-needs-revalidation`。

下一步建议将相同的环境绑定贯穿：

- 浏览器与桌面探索轨迹。
- Wiki 中的操作流程及前置条件。
- Procedural Memory 的来源与适用范围。
- SkillInvocationReceipt。
- Eval 和 Pilot 的任务分组与指标。

当前 [SkillInvocationReceipt](../packages/session-core/lib/skill-invocation-receipt.js) 已记录模型版本、工具集、沙箱权限、任务 cohort、grader、用户修正、成本与延迟，但没有直接包含 `environmentDigest`。扩展时需要通过版本化协议兼容历史回执，不能只修改字段而遗漏生产者和消费者。

建议的失效处理流程：

```text
检测环境指纹变化
→ 暂停使用受影响的旧经验
→ 在隔离环境中执行小规模再探索
→ 独立复评
→ 恢复使用或生成新版本
```

环境指纹应来自可信运行时观测，可覆盖应用版本、工具 schema、必要配置和权限状态。避免将一次性的任务数据变化误判为整个环境失效。

### 3.5 用等预算实验衡量收益

不更新模型权重仍会消耗探索调用、验证调用、环境运行和存储资源。对项目而言，应把这些成本全部计入效果评价。

建议同时报告：

- 完整任务成功率，作为主指标。
- 部分完成分，作为辅助诊断指标。
- token、API 调用和环境运行成本。
- p50、p95、p99 延迟。
- 工具调用数、重试次数和人工介入次数。
- 权限违规与不可逆副作用。
- 环境升级后恢复到可用状态所需的时间和成本。
- 错误经验进入可执行 Memory 的比例。

Baseline 与探索增强版本应固定模型、工具、任务集和评价规则，并在相同总预算下比较。若将探索成本摊销到多次任务，还应单独报告一次性学习成本及收支平衡点。

## 4. 首个试点：项目管理完整旅程

建议从现有 [Project Management Journey E2E](../tests/e2e/project-management-journey.e2e.test.ts) 提取试点任务和确定性断言。该测试覆盖团队、权限、项目、看板、任务、Sprint、报告、导出与最终状态验证，便于在项目自身环境内开展实验。

现有 E2E 是编排好的测试脚本，不能直接当作 Agent 自主完成任务的证据。试点需要让 Agent 通过受控工具实际执行，再由隔离的 grader 使用相应业务断言评分。

建议实验步骤：

1. **建立 Baseline**：固定模型和预算，让 Agent 直接执行自然语言任务，记录完整结果与成本。
2. **执行 Broad 探索**：在一次性测试数据库中探索项目管理 IPC、状态转换和常见错误路径。
3. **执行 Deep 探索**：针对权限拒绝、并发修改、Sprint 状态及导出失败继续练习。
4. **生成经验版本**：只有附带有效证据的经验进入提炼流程；冻结评测所用 Memory 和 Skill 版本。
5. **执行隐藏评测**：重置环境，更换任务名称、成员权限、初始状态和合法操作顺序；隐藏答案和 grader 实现。
6. **进行受控试用**：达到预注册门槛后进入 Shadow/Pilot，按现有人工审核与发布条件决定是否晋级。

分别评价“看到目标任务后的针对性练习”和“先学习环境、再处理未见任务”。两类结果反映的能力不同，需要独立报告。

## 5. 实施顺序与验收重点

| 顺序     | 工作                                                       | 验收重点                                                                    |
| -------- | ---------------------------------------------------------- | --------------------------------------------------------------------------- |
| 第一阶段 | 沙箱化 Broad/Deep Explorer 接入 EvolutionRun 与独立 grader | 真实操作、可重置环境、有界预算、证据可回读、正式 Skill 状态不被探索直接修改 |
| 第二阶段 | 旧 Self-Improving Agent 与学习记录统一收口                 | 提案、验证、候选、晋级语义清晰，调用者自报成功不能成为独立验证证据          |
| 第三阶段 | 完整环境绑定与失效传播                                     | 环境变化后旧经验停止参与执行，通过新评测才能恢复资格                        |
| 第四阶段 | 真实任务上的等预算评测与受控 Pilot                         | 完整成功率、成本、延迟、错误经验和恢复指标均可审计                          |
| 第五阶段 | 环境变化驱动的持续再探索                                   | 调度有预算、有停止条件，可重启恢复，并有真实部署观测证据                    |

生产自动晋级应继续遵守既有部署门槛。本文不构成开启 `autoPromotion`、解除 `HOLD` 或绕过运行时权限边界的依据。

## 6. 应保留的工程边界

- 将能力描述为“经验证的环境经验积累”，避免由局部实验推导无限制的自主进化能力。
- 将探索限定在明确授权且可恢复的环境中。
- Actor 的自评只作为线索，正式经验需要独立结果证据。
- 复用现有 Memory、Skill Registry 和发布控制面。
- 同时考察完整任务结果与成本，不以部分分提升替代发布验收。
- 严格区分代码已实现、测试已验证、部署已配置和真实流量效果已验证。

## 7. 参考资料

- [头条原文：RSIAgent：开源 Kimi-K3 反超 GPT-6](https://www.toutiao.com/article/7686015843095839258/)
- [论文：RSIAgent: Autonomous Exploration for Recursive Self-improvement in New Environments](https://arxiv.org/abs/2609.15364)
- [RSIAgent 官方代码仓库](https://github.com/AetherLabsAI/RSIAgent)
- [RSIAgent 官方项目页及评测范围说明](https://aetherlabsai.github.io/RSIAgent/)
- [ChainlessChain 自进化差距与优化建议](./AGENT_SELF_EVOLUTION_GAP_ANALYSIS_2026-09-01.md)
