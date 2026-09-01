# 自进化系统 (evolution)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

> **版本边界（2026-09-02）**：既有 `cc evolution` 命令继续提供评估/诊断表面；受治理 Skill candidate、独立 Eval、证据账本、promotion/release 原语已进入 `0.166.16@15bd3636b8`。这些原语尚未组成面向普通用户的生产自动晋级控制面，P1-11 仍为部分完成。

## 核心特性

- 📊 **能力评估**: 量化评分（0-1）+ 趋势检测（improving / declining / stable）
- 🧪 **增量训练**: 基于新数据的模型增量学习，无需完整重训
- 🩺 **自我诊断**: 自动检测记忆、能力、模型、成长四维度健康状态
- 🔧 **自我修复**: 检测到异常时自动触发修复流程
- 🔮 **行为预测**: 基于历史数据预测未来能力变化趋势
- 📈 **成长日志**: 完整记录 AI 能力成长轨迹

## 概述

ChainlessChain CLI 自进化系统赋予 AI 自我评估、自我诊断和自我修复能力。通过 `assess` 命令持续追踪各项能力的得分变化，系统自动分析趋势——连续三次以上提升判定为 improving，连续三次以上下降判定为 declining。

系统提供全面的自我诊断功能，覆盖记忆系统健康度、能力评分分布、模型运行状态、成长趋势四个维度。当诊断发现异常（如能力持续下降、模型响应变慢）时，`repair` 命令可自动尝试修复。`predict` 命令基于历史评估数据，使用线性回归预测未来能力变化。

`0.166.16` 包含 candidate-only/diff-only writer、Skill writer inventory、mutation authority、target-matrix Eval、promotion/release registry、认证制品端口与 tamper-evident ledger。mutation transition subject 绑定确切 operation、candidate/rollback target、dependency lock 与 active CAS，防止有效授权或 receipt 被换用于另一状态转换。它们尚无统一的普通用户 production wiring；`cc evolution` 不会因此直接创建、晋升或回滚 active Skill。缺少受信 candidate store、receipt、CAS 或 promotion authority 时必须失败闭合。

## 0.166.16 新增能力与 `cc evolution` 的关系

新能力治理的是 **Skill 制品生命周期**，而本页下方 `cc evolution assess/learn/diagnose/repair/predict/growth/stats/export` 治理的是既有能力指标、模型记录和诊断数据。二者不能互相替代：

| 表面 | 负责什么 | 不负责什么 |
| --- | --- | --- |
| `cc evolution ...` | 能力评分、趋势、诊断、修复记录、模型参数导出 | 不创建或晋升 active Skill |
| `cc learning synthesize` | 从合格 trajectory 提议并评测隔离候选 | 不直接安装、启用或回滚 Skill |
| Desktop Skill Creator | 返回 Skill scaffold/description 候选、diff 和评测证据 | 不写 active Skill 树 |
| Candidate/Eval/Ledger/Promotion foundation | 为可信宿主提供不可变候选、证据与事务原语 | 当前不是完整的最终用户控制台 |

完整的新功能使用说明见[自进化 AI 系统：受治理的 Skill 候选生命周期](/chainlesschain/self-evolving-ai#新功能受治理的-skill-候选生命周期)。

## 命令参考

### evolution assess — 能力评估

```bash
chainlesschain evolution assess <name> <score>
chainlesschain evolution assess "code-review" 0.85 --category "development"
chainlesschain evolution assess "translation" 0.72 --json
```

对指定能力进行评估并记录得分（0-1 范围）。系统自动计算趋势方向，返回包含历史评估记录的完整结果。

### evolution learn — 增量训练

```bash
chainlesschain evolution learn <model-name> --data <json>
chainlesschain evolution learn "classifier" --data '{"samples":[...]}'
chainlesschain evolution learn "embedder" --data '{"texts":[...]}' --json
```

基于新数据对指定模型进行增量训练，更新模型参数但保留已有知识。

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

### evolution repair — 自我修复

```bash
chainlesschain evolution repair
chainlesschain evolution repair --area memory --json
```

根据最新诊断结果自动执行修复操作，如清理损坏的记忆条目、重置异常模型参数等。

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

导出训练好的模型参数和配置，便于备份或迁移。

## 诊断维度

| 维度         | 检查内容                       | 修复操作               |
| ------------ | ------------------------------ | ---------------------- |
| memory       | 记忆完整性、容量使用、衰减状态 | 清理损坏条目、触发巩固 |
| capabilities | 评分分布、趋势异常、长期未评估 | 重新基准评估           |
| models       | 模型加载状态、响应延迟、准确率 | 重置参数、重新训练     |
| growth       | 成长速率、停滞检测、里程碑缺失 | 调整学习策略           |

## 数据库表

| 表名                     | 说明                                           |
| ------------------------ | ---------------------------------------------- |
| `evolution_capabilities` | 能力记录（名称、分类、得分、趋势、历史数据）   |
| `evolution_growth_log`   | 成长日志（事件类型、能力名、变化详情、时间戳） |
| `evolution_diagnoses`    | 诊断记录（维度、检查结果、建议、修复状态）     |
| `evolution_models`       | 模型注册表（名称、版本、参数、训练状态）       |

## 系统架构

Skill evolution 的本地源码治理链为 `encrypted Raw → model-visible/trusted projection → tamper-evident ledger → immutable candidate → mutation authority → CAS promotion → release/LKG/rollback`。当前下方 `evolution-system.js` 命令路径没有把该链实例化为生产 active writer，ledger 也没有生产 import/实例化。

```
用户命令 → evolution.js (Commander) → evolution-system.js
                                            │
                    ┌──────────────────────┼──────────────────────┐
                    ▼                      ▼                      ▼
             能力评估引擎           诊断/修复引擎           增量训练引擎
          (评分+趋势分析)        (四维度健康检查)        (在线学习更新)
                    │                      │                      │
                    ▼                      ▼                      ▼
        evolution_capabilities    evolution_diagnoses     evolution_models
```

## 配置参考

candidate store、mutation authority、promotion controller 与 release registry 不是公共 `0.166.15` 配置项，不能用 active Skill 目录替代 candidate root 或绕过治理门。

```bash
chainlesschain evolution assess <name> <score> [--category <cat>] [--json]
chainlesschain evolution learn <model-name> --data <json> [--json]
chainlesschain evolution diagnose [--area memory|capabilities|models|growth] [--json]
chainlesschain evolution repair [--area <area>] [--json]
chainlesschain evolution predict <capability-name> [--horizon <days>] [--json]
chainlesschain evolution growth [--limit <n>] [--json]
chainlesschain evolution stats [--json]
chainlesschain evolution export <model-name> [--format json] [--json]
```

## 性能指标

下表只描述既有 `cc evolution` 命令，不是本轮冻结 `233e1bdc` 治理链的 SLA；source-only 原语尚无统一生产实例或发布性能证据。

| 操作                          | 目标    | 实际        | 状态 |
| ----------------------------- | ------- | ----------- | ---- |
| assess 能力评估（含趋势计算） | < 100ms | ~ 30ms      | ✅   |
| diagnose 全四维度诊断         | < 500ms | ~ 150-250ms | ✅   |
| learn 增量训练（50 样本）     | < 3s    | ~ 1-2s      | ✅   |
| predict 线性回归预测          | < 100ms | ~ 20ms      | ✅   |
| growth 日志查询               | < 100ms | ~ 30ms      | ✅   |
| stats 综合统计                | < 150ms | ~ 40ms      | ✅   |

## 测试覆盖率

新治理原语已有 `skill-candidate-registry.test.js`、`skill-writer-inventory.test.js`、`skill-mutation-authority.test.js`、`skill-promotion-controller.test.js`、`skill-release-registry.test.js`、`evolution-evidence-projector.test.js` 与 `evolution-ledger.test.js` 测试合同。`233e1bdc` exact working tree 的原六个治理测试文件为 6/6 文件、126/126 测试通过（28.84 秒）；ledger 独立定向结果仍为 34/35 通过，另 1 项触发默认 5 秒超时。六文件全绿仍不能表述为统一生产 wiring、qualification 或发布验收；ledger 独立结果也不是全绿。

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
- `packages/cli/src/lib/evolution/skill-candidate-registry.js` — source-only 候选注册表
- `packages/cli/src/lib/evolution/skill-mutation-authority.js` — source-only mutation authority
- `packages/cli/src/lib/evolution/skill-promotion-controller.js` — source-only promotion/rollback
- `packages/cli/src/lib/evolution/skill-release-registry.js` — source-only release/LKG registry
- `packages/cli/src/lib/evolution/evolution-evidence-projector.js` — source-only Raw/model/trusted 投影
- `packages/cli/src/lib/evolution/evolution-ledger.js` — source-only hash-linked tamper-evident ledger

## 使用示例

以下示例只操作既有能力评估、模型状态与诊断数据，不会调用当前本地快照的 Skill ledger/promotion/release 原语，也不表示 active Skill 已发生变化。

### 场景 1：能力评估与趋势分析

```bash
# 评估代码生成能力
chainlesschain evolution assess code-generation

# 评估所有已注册能力
chainlesschain evolution stats --json

# 查看特定能力的趋势（improving/declining/stable）
chainlesschain evolution assess nlp-understanding --json
```

### 场景 2：增量学习与模型训练

```bash
# 在自然语言处理领域进行增量学习
chainlesschain evolution learn --domain nlp \
  --samples 100

# 在代码分析领域学习
chainlesschain evolution learn --domain code-analysis \
  --samples 50

# 查看已训练模型的精度
chainlesschain evolution stats --json | jq '.models'
```

### 场景 3：自诊断与自修复

```bash
# 执行全面自诊断（memory/capabilities/models/growth 四维度）
chainlesschain evolution diagnose

# 执行自修复（垃圾回收、缓存清理、模型重训练）
chainlesschain evolution repair

# 预测用户行为
chainlesschain evolution predict --user-pattern "morning-coding"

# 查看成长日志
chainlesschain evolution growth --limit 20
```

## 故障排查

若期望 `cc evolution` 自动安装或回滚 Skill，这是当前未接线能力。不要手工复制 candidate 到 active；`cc learning synthesize` 缺 evaluator、`candidateOutputDir` 或 active roots 时 unavailable，Skill Sync import 缺 `candidateStore` 时同样失败闭合。

### 评估与学习问题

| 症状                      | 可能原因                   | 解决方案                                         |
| ------------------------- | -------------------------- | ------------------------------------------------ |
| 能力评估始终返回 "stable" | 历史数据不足（<3条）       | 多次执行 `assess` 积累历史数据后趋势检测才能生效 |
| 学习后精度未提升          | 样本数过少                 | 增加 `--samples` 参数值，建议 ≥50                |
| 诊断结果全部 "healthy"    | 系统状态良好（非故障）     | 这是正常状态，无需处理                           |
| 自修复无效果              | 无需修复的问题             | 查看 `diagnose` 结果确认具体问题                 |
| 成长日志为空              | 未执行过 assess/learn 操作 | 先进行能力评估和学习操作                         |

### 常见错误

```bash
# 错误: "Capability not found"
# 原因: 指定的能力名称未注册
# 修复: 先评估建立能力记录
chainlesschain evolution assess code-generation

# 错误: "Database not available"
# 原因: 数据库未初始化
# 修复:
chainlesschain db init

# 错误: "No models available for prediction"
# 原因: 未进行过增量学习
# 修复: 先训练模型
chainlesschain evolution learn --domain code-analysis --samples 100
```

## 安全考虑

- **能力数据隐私**: 能力评估和学习数据存储在本地加密数据库中，不会上传至外部服务器
- **模型训练安全**: 增量学习使用本地数据，训练结果仅保存在本地，防止模型数据泄露
- **自修复约束**: 自修复操作限于安全范围内（垃圾回收、缓存清理），不会删除用户数据或修改配置
- **诊断信息敏感性**: 诊断结果可能包含系统资源使用信息，`--json` 导出时注意不要泄露给不信任方
- **成长日志审计**: 所有能力变化都记录在 `evolution_growth_log` 中，支持回溯分析异常变化
- **Skill 写入边界**: 自动生成与改进只能产生 candidate/diff；active 只能由受信 promotion controller 在 CAS 与 receipt 校验后修改
- **证据分层**: 加密 Raw、脱敏 model-visible 与 schema-verifier 选择的 trusted projection 相互隔离；公开摘要只标识内容，不代表真实性或授权
- **账本边界**: `d073bdf3` ledger 只有 hash-linked tamper-evident 源码/测试合同；没有生产实例时不能证明运行时 active 状态

## 相关文档

- [层级记忆](./cli-hmemory) — 记忆系统（诊断对象之一）
- [A2A 协议](./cli-a2a) — 多智能体协作能力评估
- [BI 引擎](./cli-bi) — 能力数据分析与可视化
