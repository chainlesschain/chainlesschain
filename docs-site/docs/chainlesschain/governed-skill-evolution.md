# 受治理的 Skill 自进化

> 适用版本：Agent Platform CLI `0.166.16`；更新：2026-09-02
>
> 适用对象：使用学习合成、Desktop Skill Creator、Skill Sync，或评估自动 Skill 改进能力的用户与管理员

## 概述

受治理的 Skill 自进化把学习结果先变成隔离候选，再通过评测、证据和发布事务决定是否可以进入 active。它解决旧路径中“生成成功”和“已经安装”容易混淆的问题：候选生成、内容改进、跨设备导入都不再直接覆盖正在运行的 Skill。

`0.166.16` 已交付 candidate、目标矩阵 Eval、证据投影、不可篡改账本、mutation authority、promotion/release 和租户隔离等基础组件。面向普通用户的一体化 review/promote/rollback 控制台仍未开放，因此当前版本不宣称会无人值守地升级 active Skill。

## 核心特性

- 自动生成和改进只写隔离候选或返回 diff，active Skill 保持不变。
- 缺少 LLM、候选存储、评测器或 active roots 时明确返回 unavailable。
- 候选绑定 Skill/版本/内容摘要、依赖锁、运行时、权限和目标矩阵。
- target、grader、safety、supervisor 与 verifier 分权，缺少任一必要 receipt 即失败。
- 所有目标矩阵 cell 必须合取通过，不能用平均分掩盖缺失平台或负迁移。
- release、active、last-known-good 与 rollback 使用 lease、CAS、journal 和 recovery。
- append-only `EvolutionLedger` 提供签名链、witness、receipt 与 subject-bound 状态转换。
- candidate/release registry 绑定 tenant 与真实文件身份，拒绝链接逃逸和跨租户复用。

## 系统架构

```text
Trajectory / Skill Creator / Skill Sync
                 │
                 ▼
       candidate-only boundary
                 │
                 ▼
      Tenant Candidate Registry
          │               │
          ▼               ▼
 Target-matrix Eval   Evidence Projector
          │               │
          └───────┬───────┘
                  ▼
         EvolutionLedger
                  │
                  ▼
 Mutation Authority + Promotion CAS
                  │
          Release / Active / LKG
```

生成器没有 active 写权限，评测器没有发布写权限，同步 peer 也没有晋升权限。只有受信宿主组合完整证据与当前 active revision 后，才能调用 promotion/release 原语。

## 快速开始

查看学习数据：

```bash
cc learning stats
cc learning trajectories --limit 20
cc learning reflect
```

尝试合成候选：

```bash
cc learning synthesize
cc learning synthesize --json
```

默认 CLI bootstrap 没有伪造 candidate evaluator 或生产 candidate store。依赖未由可信宿主注入时，命令会以非零状态返回 `LEARNING_SYNTHESIS_UNAVAILABLE`；这表示自动写入被安全阻断，不表示 active Skill 损坏。

## 使用示例

CI 中应同时检查进程退出码和 JSON `status`：

```powershell
cc learning synthesize --json
if ($LASTEXITCODE -ne 0) {
  Write-Error "候选合成不可用或失败；不要继续发布"
}
```

成功结果中的 `created` 只表示候选已经过 evaluator 并持久化到隔离候选区。它仍不是 active Skill。Desktop Skill Creator 返回 `candidateOnly: true`、`persisted: false`、`activeMutation: false` 时，只应展示为“待审阅候选”。

## 配置参考

当前公开 CLI 没有稳定的 candidate/promotion 配置文件。可信宿主构造合成器或改进器时必须提供以下边界；普通用户不应自行伪造：

| 依赖 | 用途 | 缺失结果 |
| --- | --- | --- |
| LLM callable | 从 trajectory 提取单 Skill 模式 | unavailable |
| candidate output registry | 隔离持久化不可变候选 | unavailable |
| candidate evaluator | 对内容和证据做独立判定 | unavailable |
| active Skill roots | 证明候选目录不与 active 树重叠 | unavailable |
| tenant authority/marker | 隔离候选与 release namespace | fail closed |
| durable ledger/release adapters | 跨进程持久证据和 CAS 状态 | promotion HOLD |

## 状态与结果

| 状态 | 含义 | 是否改变 active |
| --- | --- | --- |
| `completed` | 返回项已评测并持久化为隔离候选 | 否 |
| `candidate-proposed` | 返回内存候选、文件集合或 diff | 否 |
| `diff-only` | 只提供内容差异 | 否 |
| `unavailable` | 缺少必需的可信依赖 | 否 |
| `error` | 生成、评测、持久化或审计失败 | 否 |
| `validated` | 基础原语已确认候选证据完整 | 否，仍需 promotion |
| `active` | 仅受信发布事务可以形成 | 是 |

## 性能指标

目标矩阵评测按 cell 独立执行并受全 run deadline、settlement 上限和资源回收约束；安全性优先于吞吐。当前仓库测试验证 10,000 task / 64 worker 的 Team 调度门与大量治理单元场景，但这不是 Skill 自动晋级的生产 SLA。真实 P50/P95 必须绑定模型、grader、OS/arch、工具版本、样本数和 exact release SHA。

## 测试覆盖

- Candidate、release 与 promotion：租户隔离、摘要绑定、lease/CAS、journal/recovery、LKG/rollback。
- Eval Gate：角色分权、签名 receipt、deadline、撤销、后验校验、hard termination 边界。
- Target matrix：signed plan、reserve/finalize、完整 child receipt、有序摘要根与 all-cell conjunction。
- Ledger/artifact ports：append-only hash chain、witness、回读绑定、篡改和 schema 拒绝。
- Desktop：Skill Creator candidate-only、Skill Sync candidate store、Phase 16 metrics wiring。
- 路径安全：canonical ancestor alias、leaf link、父目录逃逸与 marketplace fail-closed 路径。

本地测试通过不能替代发布提交自己的 Linux、Windows、macOS CI 与 Strict Sandbox 门禁。

## 安全考虑

- 不要把 candidate 目录加入 active Skill 搜索路径。
- 不要通过复制文件绕过 promotion；这样会丢失内容摘要、授权、评测、policy 和 active revision 绑定。
- candidate/release root 必须是受信目录，叶节点不能是符号链接或重解析跳转。
- 评测结果必须绑定同一 tenant、candidate、依赖锁、runtime manifest、target matrix 和 grader identity。
- Ledger 缺失、断链、witness 不一致或 transition subject 不匹配时必须拒绝发布。
- 同步导入内容默认是不受信 candidate；peer 身份不能变成 active-layer authority。

## 故障排查

| 现象/错误 | 原因 | 处理 |
| --- | --- | --- |
| `LEARNING_SYNTHESIS_UNAVAILABLE` | 缺 LLM、candidate registry、evaluator 或 active roots | 使用提供完整受信依赖的宿主；不要手工安装候选 |
| `candidate-output-overlaps-active-skill-tree` | 候选目录与 active 根重叠 | 改用独立、owner-private 的候选根 |
| candidate persistence failed | 回读摘要、schema、文件身份或 tenant 绑定不一致 | 保留证据并检查 adapter/文件系统，不要重试晋升 |
| matrix `needs-more` / rejected | 缺 cell、receipt 或真实 grader 未通过 | 补齐同一计划的目标证据后重新评测 |
| revision/CAS conflict | active 已被另一事务更新 | 重新读取当前 revision，重新评测并审批 |
| ledger verify failed | 日志断链、签名/witness 或 subject 不一致 | 停止发布，使用可信备份和审计流程恢复 |

## 关键文件

- `packages/cli/src/lib/evolution/skill-candidate-registry.js`
- `packages/cli/src/lib/evolution/evolution-eval-gate.js`
- `packages/cli/src/lib/evolution/skill-target-matrix-eval.js`
- `packages/cli/src/lib/evolution/evolution-evidence-projector.js`
- `packages/cli/src/lib/evolution/evolution-ledger.js`
- `packages/cli/src/lib/evolution/skill-mutation-authority.js`
- `packages/cli/src/lib/evolution/skill-promotion-controller.js`
- `packages/cli/src/lib/evolution/skill-release-registry.js`
- `packages/cli/src/lib/learning/skill-synthesizer.js`
- `desktop-app-vue/src/main/ai-engine/cowork/skills/builtin/skill-creator/handler.js`
- `desktop-app-vue/src/main/ai-engine/cowork/skills/skill-sync-manager.js`

## 最佳实践与限制

- 把 candidate 视为待审代码：查看 diff、来源、反例、权限和目标矩阵后再决定下一步。
- 使用确定性测试与独立 grader；模型自评不能替代退出码、产物哈希和真实 UI 状态。
- 任何 permission、policy、model、tool、grader 或 dependency lock 变化都应使旧 approval/Eval cache 失效。
- 当前没有统一最终用户 promotion/rollback CLI，也没有承诺自动 active mutation、canary 或跨进程生产 durability。

## 相关文档

- [受治理的 Skill 自进化设计](/design/modules/112-governed-skill-evolution-design)
- [自进化 AI 系统](/chainlesschain/self-evolving-ai)
- [自进化 CLI 命令](/chainlesschain/cli-evolution)
- [Skill Creator](/chainlesschain/skill-creator)
- [Desktop Graph 调试与 Skill 安全](/chainlesschain/desktop-graph-skill-security)
- [Agent Platform 发布与证据边界](/chainlesschain/agent-platform-release)
