# 自进化 AI：受治理的 Skill 演进

> 更新：2026-09-03

## 概述

ChainlessChain 不提供无人值守的模型自训练、自动修复或直接改写 active Skill。早期 Phase 100 文档描述的 NAS、增量训练、行为预测、自诊断/自修复和 8 个 `evolution:*` IPC 从未接入 Desktop 生产 registry，相关模拟器已经退役。

当前实现采用证据驱动、候选优先的受治理流程：

## 系统架构

```text
Agent evidence
  → 加密 Raw 与可信投影
  → Evidence-backed Wiki
  → 单 Skill candidate
  → 独立 target-matrix Eval
  → 人工 review
  → promotion controller
  → release / active / last-known-good
```

## 核心特性

- Agent 输入、工具调用、结果和最终响应只能通过宿主注入的可信 evolution composition 进入持久证据链。
- 自动生成、学习合成、Desktop Skill Creator 和跨设备导入最多产生 candidate 或 diff，不会直接修改 active Skill。
- candidate 必须绑定内容摘要、依赖锁、运行时清单、能力变化、目标平台和 evidence lineage。
- 晋级必须通过独立 Eval、持久人工 review、mutation authority 与 release CAS；任一证据缺失都会失败关闭。
- release、active、last-known-good 与 rollback 使用可恢复的持久状态和审计账本。

## Desktop Evolution Metrics

Desktop Phase 20 仍提供 Code Knowledge Graph、Decision Knowledge Base、Prompt Metrics、Skill 搜索建议、Debate 和 A/B 记录。这些接口是分析、指标或候选输入，不是模型训练结果，也不拥有 active Skill 写权限。

## 当前限制

- 默认安装不内置测试密钥或本地伪造的 KMS/PKI/witness authority。
- 目标部署仍需注入并运营生产 identity、policy、signer/verifier、密钥轮换与独立 witness。
- 最终用户 reviewer surface、canary/kill switch 状态和部分 Maintainer/transition 调度仍在实施。
- “candidate created”不等于“Skill 已安装或已启用”。

## 配置参考

生产部署必须由宿主注入 tenant-scoped artifact/ledger adapter、签名与验证 authority、review policy 和 promotion controller。缺少任一依赖时保持 candidate-only 或显式 unavailable。

## 性能指标

系统不把公式化 loss、调用次数或 Phase 20 A/B 指标解释为模型训练成效。发布判定以预注册 target matrix 的质量、安全、权限、延迟和成本门槛为准；证据不足时返回 `needs-more-evidence`。

## 测试覆盖

回归测试覆盖 candidate/active 隔离、证据投影、独立 Eval、人工 review receipt、mutation authority、release CAS、恢复/回滚，以及历史 Desktop 模拟器保持不存在的 truth-surface 断言。

## 安全考虑

Raw evidence 与模型可见投影分层保存；secret/PII、prompt injection、跨租户路径、符号链接、receipt 重放和 capability 扩张均在晋升前失败关闭。自动提议者不能自批或直接写 active registry。

## 故障排查

若候选停留在 draft/candidate，依次检查 evidence manifest、trusted projection、target-matrix receipt、人工 review quorum、authority 有效期和 active revision。不要通过复制候选文件绕过 promotion controller。

## 关键文件

- `packages/cli/src/lib/evolution/`：受治理演进内核、端口与策略。
- `desktop-app-vue/src/main/ai-engine/cowork/evolution-ipc.js`：Phase 20 指标与知识图谱 IPC，不是模型训练器。
- `docs/AGENT_SELF_EVOLUTION_GAP_ANALYSIS_2026-09-01.md`：逐项验收状态和剩余边界。

## 使用示例

通过 CLI 发起学习或评测时，将返回结果中的 `candidateOnly`、decision、evidence lineage 和 review 状态作为事实来源。只有 promotion receipt 与 active revision 同时确认后，才能将结果称为已启用。

## 相关文档

详细架构和安全边界见 [受治理 Skill 演进](/chainlesschain/governed-skill-evolution)。仓库维护者还应以 `docs/AGENT_SELF_EVOLUTION_GAP_ANALYSIS_2026-09-01.md` 中的验收表为准。
