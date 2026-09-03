# 模块 84：自主学习组件与受治理接线

**状态**：组件可用，自动闭环尚未完成
**更新日期**：2026-09-03

> **关联文档**：[65. 历史自进化模拟壳（已退役）](./65-self-evolving-ai.md) · [112. 受治理 Skill 自进化](./112-governed-skill-evolution-design.md) · [Agent 自进化差距分析](../../AGENT_SELF_EVOLUTION_GAP_ANALYSIS_2026-09-01.md)

## 一、真实性边界

本模块保留轨迹查询、结果评分、反思和 candidate-only Skill 提议组件，但不宣称这些组件已经形成无人值守的生产学习闭环。

历史 `packages/cli/src/lib/learning/learning-hooks.js` 从未接入 REPL、headless 或 Agent runtime。它会把原始 prompt、工具参数、工具结果和最终回答直接写入旧 `TrajectoryStore`，吞掉持久化错误，并保留一个永远 no-op 的 `SessionEnd`。该文件及只验证它自身的测试已于 2026-09-03 退役，不能再作为“Agent 自动采集轨迹”的证据。

真实 Agent 事件必须通过宿主持有的 `AgentEvolutionIngress`：先完成加密 Raw、脱敏/可信投影、认证 artifact 和 append-only ledger 持久确认，才允许模型或工具生命周期继续。未注入生产 authority 时采集保持关闭。

## 二、仍然有效的组件

| 组件                   | 当前职责                          | 不拥有的权限                                  |
| ---------------------- | --------------------------------- | --------------------------------------------- |
| `learning-tables.js`   | 旧学习表 schema 与迁移辅助        | 不能证明事件来自真实 Agent run                |
| `trajectory-store.js`  | 显式写入、查询与保留期管理        | 不能绕过 evidence ingress 或直接晋升 Skill    |
| `outcome-feedback.js`  | 公式评分、用户反馈与修正检测      | 不是独立 grader 或发布证据                    |
| `reflection-engine.js` | 对已有轨迹生成统计/反思报告       | 不自动成为 Wiki truth 或 active mutation      |
| `skill-synthesizer.js` | 在完整依赖注入后尝试生成隔离候选  | 不能写 active Skill；缺依赖时必须 unavailable |
| `skill-improver.js`    | 生成 candidate/diff-only 改进建议 | 不能覆盖源 Skill 或自批晋升                   |

CLI 的 `learning stats`、`trajectories`、`reflect`、`cleanup` 是显式运维/查询入口。`learning synthesize` 只有在 LLM、candidate registry、evaluator 和 active-root 描述全部由可信宿主注入时才能产生候选；默认缺少这些依赖时返回非零 unavailable。

## 三、规范数据流

```text
Agent runtime event
  → host-owned AgentEvolutionIngress
  → encrypted Raw + model/trusted projections
  → authenticated ArtifactPorts + EvolutionLedger
  → Evidence-backed Wiki Maintainer
  → single-Skill candidate
  → independent target-matrix Eval
  → human review
  → mutation authority + promotion CAS
  → release / active / last-known-good
```

旧学习表可以作为迁移来源或显式查询表面，但不得与 canonical `EvolutionRun` 并行接收同一运行时事件，也不得被当作 promotion evidence。

### 3.1 Evolution 工程四阶段

| 阶段                  | ChainlessChain 控制面映射                                             | 强制边界                                                          |
| --------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------- |
| 突变（Mutation）      | 从认证 evidence/reflection 产生单 Skill candidate                     | 自动生成最多到 immutable candidate；不能直接改 active             |
| 筛选（Selection）     | 预注册 train/validation/hidden-test target matrix 与独立 grader       | proposer 看不到隐藏答案，缺 cell、receipt 或安全证据即拒绝        |
| 提拔（Promotion）     | 人工 review、shadow/canary、mutation authority 与 active revision CAS | 流量比例由生产策略显式授权；不能默认自动开启 1% 流量              |
| 稳定（Stabilization） | accepted evidence 回写 Wiki，release/LKG 成为下一轮基线               | 反证、回滚、撤销与 lineage 必须保留，不能把单次成功固化为永久真理 |

因此这里的 Evolution 是对 Skills、Prompts、Wiki/知识、Hooks 等可版本化软件资产进行受控演进，不是修改神经网络权重。任何“自动编写、自动测试、自动灰度”都只是经过策略授权后的控制面动作，而非提议者自身权限。

## 四、生命周期触发

`SessionEnd`、`GoalEnd` 和 `ScheduledBatch` 的仓库级 durable Maintainer 控制协议已完成：tenant/source/evidence-bound request 写入 ArtifactPorts + EvolutionLedger，enqueue 和处理前均重新认证触发源，Maintainer 用 request digest 保证 Wiki revision 幂等，settlement 只在反向验证已提交 revision 后持久。因此响应丢失、重复投递、Wiki commit 后崩溃和进程重启都恢复同一结果；并发 worker 仍可能重复 derive 计算，但不会重复提交 Wiki state。

Agent completion 已有真实 source/producer 接线缝：它按 tenant/run id 重新解析 branded production composition 并重放认证 `EvolutionRun`，只从已完成 run 生成 `session-end`，且 `goal-end` 必须存在持久 `goal-ended` evidence。`AgentEvolutionIngress.complete()` 在 run commit 后幂等 enqueue，对已完成 run 的重试仍会补投，不会留下 commit/enqueue crash window。

`ScheduledBatch` 也已有真实 source/producer 接线缝：它从 `SchedulerStore` 重开已成功结算的 tenant occurrence，固定校验 job payload、occurrence result、evidence-set digest 与 job revision，并在 enqueue 和 Maintainer 处理前由独立 scheduler authority 重新认证完整 job/occurrence；只有该 authority 的 durable receipt 能进入 trigger request。真实 SQLite close/reopen、未完成/替换结果和 authority 撤销回归 4/4 通过。

Registry transition 也已有 durable adapter：认证的 `CandidateCreated / EvalCompleted / HumanTaskSettled` 三事件链先写 request，再按当前 active CAS 写 attempt，之后才由真实 mutation authority 签发不落盘的一次性 capability 并进入 evaluated+human-reviewed 窄控制面。Registry 已提交但 settlement 未写时，新 adapter 会从不可变 release/state 的 candidate、mutation request、transition subject、authority receipt 和 transaction 绑定恢复；不会重复晋级。真实双 cell Gate、签名 matrix、双人审批与 `SkillReleaseRegistry` 联合回归覆盖 source 撤销、commit crash 和 settlement 响应丢失。

对应的 branded source 会分别调用三个独立 durable resolver，逐项校验 schema、tenant、source ref、candidate、Skill、时间和 authority receipt，并强制 Candidate≤Eval≤HumanTask 顺序；Candidate 的 candidate/actor/parent/target、Eval 的 matrix/eval 与 HumanTask 的 policy 最终合成六类完整 receipt envelope 和唯一 source receipt。source 4/4、与真实晋级纵切合计 7/7 通过；目标部署只需提供三个 resolver 的真实存储/PKI 后端，不能用调用者自报结果替代。

这不等于所有产品事件都已启用：目标部署仍需配置 Agent composition/SchedulerStore/transition-event resolver、trigger stream/worker、真实 scheduler/transition authority/PKI，并让默认 launcher 和其他产品入口注入这些 composition。通用 Hooks 仍服务于用户配置的生命周期扩展，但不会自动取得 evolution evidence 写权限。

## 五、安全约束

- 不把 raw prompt、工具结果、secret 或 PII 直接写入模型可见 Wiki/Candidate。
- 不吞掉 evolution persistence、ledger 或 transition 错误。
- proposer、reflection 和 formula score 不能充当 grader、reviewer 或 promotion authority。
- candidate 创建不等于安装；active 更新必须消费绑定同一 candidate、Eval、review、policy 与 active revision 的 receipt。
- 任何自动触发器都必须有 tenant scope、预算、撤销和审计边界。

## 六、验证

- `learning-commands.test.js` 验证六个仍有效模块与 CLI 命令表面。
- `learning-integration.test.js` 直接验证 Store、Feedback、Synthesizer、Improver 和 Reflection 的组合，不再用不存在的 Hook 假装生产接线。
- evolution truth-surface 回归断言历史 `learning-hooks.js` 保持不存在。
- 真实 Agent ingress、ArtifactPorts、EvolutionLedger 和三种 CLI runtime 的持久顺序由各自 evolution 测试覆盖。
- Wiki trigger 联合回归覆盖三种 trigger、真实 Ledger 文件/witness 重开、源撤销、结果替换和 commit/settlement crash recovery；55 项通过，1 项按平台条件跳过。
- Agent completion source/trigger 联合回归 15/15，production composition 与跨 runtime 9/9；覆盖已完成 run 重放、goal evidence 强制、源撤销、重复 complete 和幂等 enqueue。
- ScheduledBatch source 回归 4/4；覆盖真实 SQLite close/reopen、tenant/job revision/evidence digest 绑定、未完成或替换结果拒绝、authority 撤销和 branded producer。
- Registry transition 与相关控制面 50 项通过、1 项按平台条件跳过；纵向用例覆盖三方独立 source resolver、真实双 cell Gate、签名 matrix、双人人工审批、mutation authority、真实 Release Registry、source 撤销、commit crash 和 settlement 响应丢失恢复。

## 七、剩余工作

1. 在目标部署配置 Agent composition/SchedulerStore/transition-event resolver、trigger stream/worker 和真实 scheduler/transition authority/PKI。
2. 将旧学习表数据显式迁移到认证 evidence/Wiki 输入，或标记为 legacy/untrusted 并限定用途。
3. 完成目标部署的 KMS/PKI/policy/witness authority 与 reviewer/promotion 生产接线。

公式型训练壳已于 2026-09-03 收口：公开 CLI 使用
`record-model-metrics`、`record-training-metrics-v2` 和
`training-metrics-v2`；记录明确返回 `performedTraining=false`，V2 只把
调用者给出的 loss 投影为 `retentionAssessment`，不再返回 `completed`
或自动产生 `KNOWLEDGE_EXPANSION`。旧 JavaScript 函数名只作为 deprecated
兼容别名保留，并复用相同的 metrics-only 结果。

历史“4 个学习 Hook 已接入、SessionEnd 自动反思、P0-P3 全部完成”的设计内容仍可从 Git 记录查阅，但不再属于当前产品事实。
