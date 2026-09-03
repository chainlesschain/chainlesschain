# 自主学习组件：受治理的使用边界

> 更新：2026-09-03

## 概述

ChainlessChain 提供轨迹查询、结果评分、反思和 Skill 候选提议组件，但当前不宣称已经形成无人值守的生产学习闭环。历史 `learning-hooks.js` 没有接入真实 Agent runtime，且会绕过认证 evidence 边界，因此已经退役。

## 核心特性

- `learning stats`、`trajectories`、`reflect` 和 `cleanup` 提供显式查询与维护。
- `learning synthesize` 只能在可信宿主注入 LLM、隔离 candidate registry、独立 evaluator 和 active-root 描述后产生候选。
- Synthesizer、Improver 和 Desktop Skill Creator 只产生 candidate/diff，不直接修改 active Skill。
- 公式评分和 reflection 是分析信号，不是独立 Eval、人工审批或发布凭据。

## 系统架构

```text
Agent runtime
  → host-owned evolution ingress
  → encrypted Raw + trusted projection
  → authenticated artifact + ledger
  → Evidence-backed Wiki
  → Skill candidate
  → independent Eval + human review
  → promotion controller
  → release / active / last-known-good
```

旧 `TrajectoryStore` 只作为显式数据/迁移表面，不能与 canonical `EvolutionRun` 并行采集同一运行，也不能充当 promotion evidence。

工程上的 Evolution 分为四步：Mutation 只生成不可变 candidate；Selection 使用隔离的 target matrix 与独立 grader；Promotion 必须经过人工 review、生产策略授权的 shadow/canary 和 active revision CAS；Stabilization 将已接受证据写回 Wiki，并保留 release/LKG、反证与回滚 lineage。它演进的是 Skills、Prompts、知识与 Hooks 等版本化资产，不是模型权重。

“自动编写、自动测试、自动灰度”都不是默认权限。尤其是线上流量比例必须由生产策略显式授权，不能因候选通过本地测试就自动分配 1% 流量。

## 配置参考

默认 CLI 不构造测试签名或本地伪 authority。若宿主没有注入 production evidence、candidate 和 evaluator 依赖，自动采集保持关闭，合成命令返回明确的 unavailable 与非零结果。

## 性能指标

轨迹数量、工具成功率、平均分和公式 loss 只用于观测。Skill 是否可发布由预注册 target matrix 的质量、安全、权限、延迟和成本门决定；证据不足时保持 `needs-more-evidence`。

## 测试覆盖

测试直接覆盖 TrajectoryStore、OutcomeFeedback、SkillSynthesizer、SkillImprover、ReflectionEngine 和 CLI 命令。truth-surface 测试同时保证已退役的 `learning-hooks.js` 不会重新出现。

## 安全考虑

Raw prompt、工具参数/结果、secret 和 PII 不得直接写入 Wiki 或 Candidate。所有自动路径必须经过 tenant-scoped evidence projection、不可篡改账本、独立 Eval、人工 review 和 active revision CAS；任一步缺失都失败关闭。

## 故障排查

若 `learning synthesize` 返回 unavailable，请检查宿主是否提供 candidate registry、evaluator、LLM 与 active roots。不要复制候选到 active 目录，也不要用旧学习表或 formula score 绕过 promotion controller。

## 关键文件

- `packages/cli/src/lib/learning/trajectory-store.js`
- `packages/cli/src/lib/learning/outcome-feedback.js`
- `packages/cli/src/lib/learning/reflection-engine.js`
- `packages/cli/src/lib/learning/skill-synthesizer.js`
- `packages/cli/src/lib/learning/skill-improver.js`
- `packages/cli/src/lib/evolution/`

## 使用示例

```bash
cc learning stats
cc learning trajectories --limit 20
cc learning reflect
cc learning synthesize --json
```

只有结果携带完整 candidate、Eval、review、promotion receipt 和新的 active revision 时，才能称为已启用；`candidate created` 本身不代表安装成功。

## 相关文档

- [受治理 Skill 演进](/chainlesschain/governed-skill-evolution)
- [历史自进化模拟壳（已退役）](/design/modules/65-self-evolving-ai)
- 仓库 `docs/AGENT_SELF_EVOLUTION_GAP_ANALYSIS_2026-09-01.md`
