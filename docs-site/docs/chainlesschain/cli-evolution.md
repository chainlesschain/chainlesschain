# 自进化系统 (evolution)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

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

| 维度 | 检查内容 | 修复操作 |
|------|----------|----------|
| memory | 记忆完整性、容量使用、衰减状态 | 清理损坏条目、触发巩固 |
| capabilities | 评分分布、趋势异常、长期未评估 | 重新基准评估 |
| models | 模型加载状态、响应延迟、准确率 | 重置参数、重新训练 |
| growth | 成长速率、停滞检测、里程碑缺失 | 调整学习策略 |

## 数据库表

| 表名 | 说明 |
|------|------|
| `evolution_capabilities` | 能力记录（名称、分类、得分、趋势、历史数据） |
| `evolution_growth_log` | 成长日志（事件类型、能力名、变化详情、时间戳） |
| `evolution_diagnoses` | 诊断记录（维度、检查结果、建议、修复状态） |
| `evolution_models` | 模型注册表（名称、版本、参数、训练状态） |

## 系统架构

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

| 操作 | 目标 | 实际 | 状态 |
|------|------|------|------|
| assess 能力评估（含趋势计算） | < 100ms | ~ 30ms | ✅ |
| diagnose 全四维度诊断 | < 500ms | ~ 150-250ms | ✅ |
| learn 增量训练（50 样本） | < 3s | ~ 1-2s | ✅ |
| predict 线性回归预测 | < 100ms | ~ 20ms | ✅ |
| growth 日志查询 | < 100ms | ~ 30ms | ✅ |
| stats 综合统计 | < 150ms | ~ 40ms | ✅ |

## 测试覆盖率

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

## 使用示例

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

### 评估与学习问题

| 症状 | 可能原因 | 解决方案 |
|------|---------|---------|
| 能力评估始终返回 "stable" | 历史数据不足（<3条） | 多次执行 `assess` 积累历史数据后趋势检测才能生效 |
| 学习后精度未提升 | 样本数过少 | 增加 `--samples` 参数值，建议 ≥50 |
| 诊断结果全部 "healthy" | 系统状态良好（非故障） | 这是正常状态，无需处理 |
| 自修复无效果 | 无需修复的问题 | 查看 `diagnose` 结果确认具体问题 |
| 成长日志为空 | 未执行过 assess/learn 操作 | 先进行能力评估和学习操作 |

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

## 相关文档

- [层级记忆](./cli-hmemory) — 记忆系统（诊断对象之一）
- [A2A 协议](./cli-a2a) — 多智能体协作能力评估
- [BI 引擎](./cli-bi) — 能力数据分析与可视化
