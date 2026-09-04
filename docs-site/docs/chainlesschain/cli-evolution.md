# 自进化系统 (evolution)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

> **当前版本（2026-09-04）**：Agent Platform CLI `0.166.21`。既有 `assess`、`diagnose` 和 metrics 子命令仍只记录指标，不训练模型权重或修改 active Skill；新增 `workbench` 与 `knowledge` 子树会向受信部署宿主提交摘要/revision 绑定的治理动作，缺少宿主时失败闭合。

## 核心特性

- 📊 **能力评估**: 量化评分（0-1）+ 趋势检测（improving / declining / stable）
- 🧪 **训练指标记录**: 保存调用者提供的数据量、loss 和公式化 accuracy 指标；不执行模型权重训练
- 🩺 **自我诊断**: 自动检测记忆、能力、模型、成长四维度健康状态
- 🔧 **维护动作记录**: 根据显式 issue 执行既有维护策略并记录结果，不代表模型或 Skill 已自动修复
- 🔮 **行为预测**: 基于历史数据预测未来能力变化趋势
- 📈 **成长日志**: 完整记录 AI 能力成长轨迹
- 🧭 **Evolution Workbench**: 查询候选、比较版本、提交批准/拒绝与精确回滚请求
- 🔐 **知识冲突审核**: 分页查看删节冲突并提交认证的 canonical merge plan
- 🔎 **Skill Retrieval**: `cc skill search` 按 canonical digest、索引见证和 verified outcome evidence 排序

## 概述

ChainlessChain CLI evolution 表面记录能力评分、模型指标、诊断和维护动作。通过 `assess` 命令持续追踪各项能力的外部评分变化，系统按记录计算趋势——连续三次以上提升判定为 improving，连续三次以上下降判定为 declining。这些结果是指标投影，不是独立 Eval，也不是系统已经自我进化的证据。

系统根据数据库中的既有记录生成诊断投影。`repair <issue>` 只在用户显式指定 issue 后执行内置维护策略并记录结果，不训练模型，也不修改 active Skill。`predict` 命令根据历史记录生成公式化行为预测。

`0.166.21` 在 candidate-only/diff-only writer、target-matrix Eval、promotion/release registry、持久 `EvolutionRun`、Wiki/Memory 和 tamper-evident ledger 之上，增加 Evolution Workbench、摘要绑定 Skill Retrieval 与受治理加密知识同步。mutation 和 merge subject 绑定确切 operation、revision/digest、candidate/rollback target、dependency lock 与 CAS，防止有效授权或 receipt 被换用于另一状态转换。

## 0.166.21 命令面的职责边界

新能力治理的是 **Skill 制品生命周期**，而本页下方 `cc evolution assess/record-model-metrics/diagnose/repair/predict/growth/stats/export` 治理的是既有能力指标、模型记录和诊断数据。二者不能互相替代：

| 表面                                       | 负责什么                                              | 不负责什么                   |
| ------------------------------------------ | ----------------------------------------------------- | ---------------------------- |
| `cc evolution assess/diagnose/...`         | 能力评分、趋势、诊断、修复记录、模型参数导出          | 不创建或晋升 active Skill    |
| `cc evolution workbench ...`               | 候选查询、版本比较、人工 review 与 rollback 请求      | 客户端不直接写 active Skill  |
| `cc evolution knowledge ...`               | 删节冲突查询与认证 merge plan                         | 不向客户端暴露密钥或原始密文 |
| `cc skill search ...`                      | 多来源、证据排序的 Skill 检索                         | 不安装、激活或晋升 Skill     |
| `cc learning synthesize`                   | 从合格 trajectory 提议并评测隔离候选                  | 不直接安装、启用或回滚 Skill |
| Desktop Skill Creator                      | 返回 Skill scaffold/description 候选、diff 和评测证据 | 不写 active Skill 树         |
| Candidate/Eval/Ledger/Promotion foundation | 为可信宿主提供不可变候选、证据与事务原语              | 不绕过 Workbench/宿主策略    |

完整的新功能使用说明见[自进化 AI 系统：受治理的 Skill 候选生命周期](/chainlesschain/self-evolving-ai#新功能受治理的-skill-候选生命周期)。

## Evolution Workbench

```bash
cc evolution workbench list --status pending --limit 20
cc evolution workbench compare <left-packet-digest> <right-packet-digest>
cc evolution workbench review approve <packet-digest> --reason "评测与证据已复核"
cc evolution workbench review reject <packet-digest> --reason "证据不足"
cc evolution workbench rollback <from-packet-digest> <to-packet-digest> \
  --reason "canary 指标退化"
```

`list` 与 `compare` 返回经过验证的投影；`review` 支持一次提交一个或多个 packet digest。所有动作都通过 `EvolutionWorkbenchCliHost` 执行，宿主必须重新检查 revision、可用动作和 authority，不能相信客户端按钮状态。

## 加密知识冲突审核

```bash
cc evolution knowledge conflicts --cursor 0 --limit 20
cc evolution knowledge merge <conflict-envelope-digest> \
  --record '<canonical-record-json>' \
  --reason "已复核双方来源与撤销依赖"
```

冲突查询只返回删节投影，`--limit` 范围为 `1..256`。merge plan 由受信宿主做身份、策略、签名、dependency settlement 和 ledger 校验；缺少 `GovernedKnowledgeReviewHost` 时命令不会落盘。

Skill 搜索属于 `cc skill search`，不是 `cc evolution` 子命令：

```bash
cc skill search "知识冲突合并" --source managed --limit 8
cc skill search "Electron 性能" --category development --tag desktop --json
```

## 命令参考

### evolution assess — 能力评估

```bash
chainlesschain evolution assess <name> <score>
chainlesschain evolution assess "code-review" 0.85 --category "development"
chainlesschain evolution assess "translation" 0.72 --json
```

对指定能力进行评估并记录得分（0-1 范围）。系统自动计算趋势方向，返回包含历史评估记录的完整结果。

### evolution record-model-metrics — 公式指标记录

```bash
chainlesschain evolution record-model-metrics <model-name> --data <json>
chainlesschain evolution record-model-metrics "classifier" --data '[{"sample":1}]'
chainlesschain evolution record-model-metrics "embedder" --data '[{"text":"x"}]' --json
```

记录调用者为指定 model ID 提供的数据量，并更新旧数据库 `accuracy` 列中的合成公式估计；该值不是独立评测准确率。结果明确包含 `metricKind=synthetic-formula-estimate`、`status=metrics_recorded` 和 `performedTraining=false`，不加载训练框架、不更新模型权重，也不产出新的模型制品。

### evolution record-training-metrics-v2 — loss 指标记录

```bash
chainlesschain evolution record-training-metrics-v2 \
  --strategy replay --data-size 100 --loss-before 0.5 --loss-after 0.4
chainlesschain evolution training-metrics-v2 --strategy replay
```

根据调用者提供的 before/after loss 计算留存率。`status` 只表示
`metrics_recorded`，`retentionAssessment` 为 `threshold_met` 或
`retention_low`；该记录不会自动产生知识扩展里程碑。

### evolution diagnose — 自我诊断

```bash
chainlesschain evolution diagnose
chainlesschain evolution diagnose --area memory           # 仅诊断记忆系统
chainlesschain evolution diagnose --area capabilities     # 仅诊断能力
chainlesschain evolution diagnose --area models           # 仅诊断模型
chainlesschain evolution diagnose --area growth           # 仅诊断成长
chainlesschain evolution diagnose --json
```

执行自我诊断，分析系统各维度的健康状态。支持按区域指定诊断范围。

### evolution repair — 维护策略记录

```bash
chainlesschain evolution repair high-memory
chainlesschain evolution repair stale-cache --json
```

根据用户显式给出的 issue 类型执行既有维护策略并记录动作；它不会重训模型、修改 active Skill 或证明问题已经由独立 Eval 修复。

### evolution predict — 行为预测

```bash
chainlesschain evolution predict <capability-name>
chainlesschain evolution predict "code-review" --horizon 7  # 预测未来 7 天
chainlesschain evolution predict "translation" --json
```

基于历史评估数据预测指定能力的未来得分趋势。

### evolution growth — 查看成长日志

```bash
chainlesschain evolution growth
chainlesschain evolution growth --limit 20
chainlesschain evolution growth --json
```

显示 AI 能力成长的完整时间线，包括关键里程碑和能力变化事件。

### evolution stats — 综合统计

```bash
chainlesschain evolution stats
chainlesschain evolution stats --json
```

显示所有已评估能力的综合统计，包括平均分、最高/最低能力、整体趋势。

### evolution export — 导出模型

```bash
chainlesschain evolution export <model-name>
chainlesschain evolution export "classifier" --format json
chainlesschain evolution export "embedder" --json
```

导出模型指标记录和既有配置，便于备份或迁移；这不是训练后模型制品。

## 诊断维度

| 维度         | 检查内容                       | 修复操作               |
| ------------ | ------------------------------ | ---------------------- |
| memory       | 记忆完整性、容量使用、衰减状态 | 清理损坏条目、触发巩固 |
| capabilities | 评分分布、趋势异常、长期未评估 | 重新基准评估           |
| models       | 模型记录数量与公式估计         | 重置低值指标记录       |
| growth       | 成长速率、停滞检测、里程碑缺失 | 调整学习策略           |

## 数据库表

| 表名                     | 说明                                           |
| ------------------------ | ---------------------------------------------- |
| `evolution_capabilities` | 能力记录（名称、分类、得分、趋势、历史数据）   |
| `evolution_growth_log`   | 成长日志（事件类型、能力名、变化详情、时间戳） |
| `evolution_diagnoses`    | 诊断记录（维度、检查结果、建议、修复状态）     |
| `evolution_models`       | 兼容模型记录（名称、类型、公式估计、数据量）   |

## 系统架构

Skill evolution 的治理链为 `encrypted Raw → model-visible/trusted projection → EvolutionRun/Wiki → immutable candidate → target-matrix Eval + human review → Workbench → mutation authority → CAS promotion → release/LKG/rollback`。`0.166.21` 已提供文件 Ledger/witness、迁移、registry transition、Workbench、digest-bound Retrieval 与 knowledge merge host；下方 `evolution-system.js` 旧命令仍只是 metrics/diagnosis 表面。目标环境未注入生产 authority 时所有变更路径保持关闭。

```
用户命令 → evolution.js (Commander) → evolution-system.js
                                            │
                    ┌──────────────────────┼──────────────────────┐
                    ▼                      ▼                      ▼
             能力评估投影           诊断/维护记录           训练指标记录
          (评分+趋势分析)        (记录检查与动作)        (不更新模型权重)
                    │                      │                      │
                    ▼                      ▼                      ▼
        evolution_capabilities    evolution_diagnoses     evolution_models
```

## 配置参考

candidate store、mutation authority、promotion controller、release registry、Workbench host 与 knowledge merge host 不是公共 `0.166.21` 的本地绕过配置项。不能用 active Skill 目录替代 candidate root，也不能通过环境变量或客户端 payload 伪造 production composition。

```bash
chainlesschain evolution assess <name> <score> [--category <cat>] [--json]
chainlesschain evolution record-model-metrics <model-name> --data <json> [--json]
chainlesschain evolution record-training-metrics-v2 -s <strategy> --data-size <n> --loss-before <n> --loss-after <n> [--json]
chainlesschain evolution training-metrics-v2 [-s <strategy>] [-l <n>] [--json]
chainlesschain evolution diagnose [--area memory|capabilities|models|growth] [--json]
chainlesschain evolution repair [--area <area>] [--json]
chainlesschain evolution predict <capability-name> [--horizon <days>] [--json]
chainlesschain evolution growth [--limit <n>] [--json]
chainlesschain evolution stats [--json]
chainlesschain evolution export <model-name> [--format json] [--json]
chainlesschain evolution workbench list [--query <text>] [--status <status>] [--offset <n>] [--limit <n>]
chainlesschain evolution workbench compare <left-packet-digest> <right-packet-digest>
chainlesschain evolution workbench review <approve|reject> <packet-digests...> --reason <text>
chainlesschain evolution workbench rollback <from-packet-digest> <to-packet-digest> --reason <text>
chainlesschain evolution knowledge conflicts [--cursor <n>] [--limit <n>]
chainlesschain evolution knowledge merge <conflict-envelope-digest> --record <json> --reason <text>
```

## 性能指标

下表只描述既有 `cc evolution` 指标命令，不是 `0.166.21` Workbench、Retrieval 或知识治理链的 SLA；真实 Eval、Ledger、KMS/PKI 和跨主机 witness 的 P50/P95 必须由目标部署单独验收。

| 操作                          | 目标    | 实际        | 状态 |
| ----------------------------- | ------- | ----------- | ---- |
| assess 能力评估（含趋势计算） | < 100ms | ~ 30ms      | ✅   |
| diagnose 全四维度诊断         | < 500ms | ~ 150-250ms | ✅   |
| 公式指标记录（50 条输入）     | < 3s    | ~ 1-2s      | ✅   |
| predict 线性回归预测          | < 100ms | ~ 20ms      | ✅   |
| growth 日志查询               | < 100ms | ~ 30ms      | ✅   |
| stats 综合统计                | < 150ms | ~ 40ms      | ✅   |

## 测试覆盖率

治理回归覆盖 candidate/release/promotion、target matrix、evidence/artifact/ledger、Workbench、digest-bound Retrieval、governed knowledge、三模式 Agent ingress、Wiki/Memory/review、legacy migration、registry transition、进程重启和 crash recovery。CLI `0.166.21@1ff70b7856` 的发布结论来自该 exact SHA 的三平台 CLI CI、Strict Sandbox、Trusted Publishing 与公共 registry 回读；单个测试文件或旧快照不能替代发布门，也不能证明目标环境 authority 已部署。

```
✅ evolution.test.js  - 覆盖 CLI 主要路径
  ├── 参数解析
  ├── 正常路径
  ├── 错误处理
  └── JSON 输出
```

## 关键文件

- `packages/cli/src/commands/evolution.js` — 命令实现
- `packages/cli/src/lib/evolution-system.js` — 自进化系统库
- `packages/cli/src/lib/evolution/skill-candidate-registry.js` — tenant 候选注册表
- `packages/cli/src/lib/evolution/skill-mutation-authority.js` — mutation authority
- `packages/cli/src/lib/evolution/skill-promotion-controller.js` — evaluated/human-reviewed promotion 与 rollback
- `packages/cli/src/lib/evolution/skill-release-registry.js` — release/active/LKG registry
- `packages/cli/src/lib/evolution/agent-evolution-runtime-composition.js` — branded Agent 生产组合入口
- `packages/cli/src/lib/evolution/evolution-run-ledger-adapter.js` — 持久 EvolutionRun
- `packages/cli/src/lib/evolution/evidence-backed-wiki-maintainer.js` — 证据驱动 Wiki reducer
- `packages/cli/src/lib/evolution/structured-memory-agent-control-plane.js` — 四层 Memory 控制面
- `packages/cli/src/lib/evolution/skill-registry-transition-ledger-adapter.js` — registry transition 状态机
- `packages/cli/src/lib/evolution/evolution-ledger.js` — source-only hash-linked tamper-evident ledger
- `packages/cli/src/commands/evolution-workbench.js` — Workbench 命令与受信宿主边界
- `packages/cli/src/commands/evolution-knowledge.js` — 加密知识冲突审核与 merge 命令
- `packages/cli/src/lib/evolution/evolution-workbench-projection.js` — 可公开的受治理候选投影
- `packages/cli/src/lib/evolution/governed-knowledge-review-host.js` — 知识审核宿主合同

## 使用示例

以下三个场景只操作既有能力评估、模型状态与诊断数据，不会调用 Workbench 或知识 merge host，也不表示 active Skill 已发生变化。

### 场景 1：能力评估与趋势分析

```bash
# 评估代码生成能力
chainlesschain evolution assess code-generation 0.85

# 评估所有已注册能力
chainlesschain evolution stats --json

# 查看特定能力的趋势（improving/declining/stable）
chainlesschain evolution assess nlp-understanding 0.72 --json
```

### 场景 2：记录训练指标

```bash
# 为既有 model record 提交样本指标
chainlesschain evolution record-model-metrics nlp-model --data '[{"sample":1}]'

# 查看记录的模型指标
chainlesschain evolution stats --json | jq '.models'
```

### 场景 3：诊断与显式维护记录

```bash
# 执行全面自诊断（memory/capabilities/models/growth 四维度）
chainlesschain evolution diagnose

# 显式执行一种既有维护策略
chainlesschain evolution repair stale-cache

# 预测用户行为
chainlesschain evolution predict current-user --json

# 查看成长日志
chainlesschain evolution growth --limit 20
```

## 故障排查

若 Workbench 或知识审核返回 `a trusted deployment host is required`，说明当前 CLI 未接入部署方治理宿主；不要手工复制 candidate 到 active 或绕过知识 merge。`cc learning synthesize` 缺 evaluator、`candidateOutputDir` 或 active roots 时 unavailable，Skill Sync import 缺 `candidateStore` 时同样失败闭合。

### 评估与学习问题

| 症状                      | 可能原因                  | 解决方案                                         |
| ------------------------- | ------------------------- | ------------------------------------------------ |
| 能力评估始终返回 "stable" | 历史数据不足（<3条）      | 多次执行 `assess` 积累历史数据后趋势检测才能生效 |
| 公式估计被误认为准确率    | 旧数据库列名仍为 accuracy | 只把它当合成指标；准确率必须来自独立 Eval        |
| 诊断结果全部 "healthy"    | 系统状态良好（非故障）    | 这是正常状态，无需处理                           |
| 自修复无效果              | 无需修复的问题            | 查看 `diagnose` 结果确认具体问题                 |
| 成长日志为空              | 尚未记录评估或指标        | 先执行 assess 或 record-model-metrics            |

### 常见错误

```bash
# 错误: "Capability not found"
# 原因: 指定的能力名称未注册
# 修复: 先评估建立能力记录
chainlesschain evolution assess code-generation 0.5

# 错误: "Database not available"
# 原因: 数据库未初始化
# 修复:
chainlesschain db init

# 错误: "No models available for prediction"
# 原因: 尚无可供公式投影的指标记录
# 处理: 先为既有 model ID 记录输入指标（不会训练权重）
chainlesschain evolution record-model-metrics code-analysis --data '[{"sample":1}]'
```

## 安全考虑

- **能力数据隐私**: 能力评估和学习数据存储在本地加密数据库中，不会上传至外部服务器
- **指标记录边界**: `record-model-metrics` / `record-training-metrics-v2` 只写指标记录，不执行模型权重训练；输入仍应按敏感数据处理
- **维护动作约束**: `repair` 仅执行显式 issue 对应的既有维护策略，不应被解释为自主修复或独立 Eval 通过
- **诊断信息敏感性**: 诊断结果可能包含系统资源使用信息，`--json` 导出时注意不要泄露给不信任方
- **成长日志审计**: 所有能力变化都记录在 `evolution_growth_log` 中，支持回溯分析异常变化
- **Skill 写入边界**: 自动生成与改进只能产生 candidate/diff；active 只能由受信 promotion controller 在 CAS 与 receipt 校验后修改
- **证据分层**: 加密 Raw、脱敏 model-visible 与 schema-verifier 选择的 trusted projection 相互隔离；公开摘要只标识内容，不代表真实性或授权
- **账本边界**: `d073bdf3` ledger 只有 hash-linked tamper-evident 源码/测试合同；没有生产实例时不能证明运行时 active 状态

## 相关文档

- [层级记忆](./cli-hmemory) — 记忆系统（诊断对象之一）
- [A2A 协议](./cli-a2a) — 多智能体协作能力评估
- [BI 引擎](./cli-bi) — 能力数据分析与可视化
