# 自主学习循环 (learning)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

> **版本边界**：公共 `0.166.15@22db04f559` 不包含本轮核对冻结的 `233e1bdc` evolution feature 快照；远端 GitHub `main` 仍为 `458b342f5f`。

## 核心特性

- 📊 **学习统计**: 查看轨迹总数、复杂度分布、评分和技能合成情况
- 📈 **轨迹管理**: 列出和检索最近的工具调用轨迹记录
- 🔍 **反思引擎**: 运行反思周期，分析趋势、高频工具和错误率
- 🧬 **候选合成**: 从高分轨迹生成待评估候选；不会直接写入 active Skill
- 🧹 **数据清理**: 删除超过保留期限的旧轨迹

## 概述

ChainlessChain CLI 学习模块记录并分析工具调用轨迹。`stats` 查看学习统计，`trajectories` 列出最近的轨迹，`reflect` 运行反思周期生成趋势报告，`synthesize` 尝试从合格轨迹生成候选，`cleanup` 清理过期数据。它不是已经接通生产 active Skill 的完整自进化闭环。

轨迹记录每次智能体会话中的工具调用序列、复杂度（工具数量）、结果评分和用户意图。反思引擎分析这些数据，识别趋势（改善/下降/稳定）、高频工具和高错误率工具。本轮冻结快照的技能合成器只允许写入与 active roots 隔离的 candidate registry，并要求独立 evaluator；当前命令入口没有注入 evaluator、`candidateOutputDir` 与 active roots，因此 `cc learning synthesize` 返回 `LEARNING_SYNTHESIS_UNAVAILABLE` 对应的非零结果，不会创建或覆盖 active Skill。

> 源码边界：本轮核对冻结快照为 `233e1bdc`；`b8490faa` 是 attested evidence projector 的具体提交，`d073bdf3` 是 tamper-evident evolution ledger 的具体提交，`233e1bdc` 再将 mutation transition subject 绑定到确切 operation、candidate/rollback target、dependency lock 与 active CAS。candidate/mutation/promotion/release/projector/ledger 均没有统一生产 import/实例化，P1-11 只完成一部分。

## 命令参考

### learning stats — 学习统计

```bash
chainlesschain learning stats
chainlesschain learning stats --json
```

查看学习循环统计数据：轨迹总数、复杂轨迹数（6+ 工具）、已评分数量和已合成技能数量。

### learning trajectories — 轨迹列表

```bash
chainlesschain learning trajectories
chainlesschain learning trajectories -n 50
chainlesschain learning trajectories --session sess_123 --json
```

列出最近的轨迹记录。`-n` 指定数量（默认 20），`--session` 按会话 ID 过滤。每条轨迹显示 ID、复杂度级别、工具数量、评分和已合成的技能名称。

### learning reflect — 反思报告

```bash
chainlesschain learning reflect
chainlesschain learning reflect --json
```

运行一个反思周期并生成报告。报告内容包括：

- **时间戳和轨迹数量**: 本轮反思覆盖的轨迹范围
- **平均评分**: 所有已评分轨迹的平均分
- **趋势**: improving（改善）/ declining（下降）/ stable（稳定）
- **高频工具 Top 5**: 使用次数和错误率
- **高错误率工具**: 错误率超过阈值的工具列表

### learning synthesize — 技能合成

```bash
chainlesschain learning synthesize
chainlesschain learning synthesize --json
```

扫描合格的轨迹并尝试生成待评估候选。当前公开装配未提供 evaluator、候选输出目录与 active roots，命令会报告 unavailable 并以非零状态失败闭合。只有未来同时提供这三项受信依赖时，持久化且通过 evaluator 的隔离候选才会计入 `created`；该结果也不是 active 安装或晋升。

### learning cleanup — 清理旧数据

```bash
chainlesschain learning cleanup
chainlesschain learning cleanup --days 30
chainlesschain learning cleanup --days 60 --json
```

删除超过保留期限的旧轨迹。`--days` 设置保留天数（默认 90 天）。返回删除的轨迹数量。

## 系统架构

```
用户命令 → learning.js (Commander)
                │
     ┌──────────┼──────────────┐
     ▼          ▼              ▼
  统计/轨迹    反思引擎       技能合成器
     │          │              │
     ▼          ▼              ▼
TrajectoryStore ReflectionEngine SkillSynthesizer
     │          │              │
     ▼          ▼              ▼
 SQLite (trajectories 表)   evaluator + isolated candidate registry
                                      │
                                      ▼
                            候选草稿（绝不直接写 active）
```

### 核心模块

| 模块               | 职责                               |
| ------------------ | ---------------------------------- |
| `TrajectoryStore`  | 轨迹的存储、查询、统计和清理       |
| `ReflectionEngine` | 分析轨迹趋势、工具使用模式和错误率 |
| `SkillSynthesizer` | 从高分轨迹模式生成、评估并隔离持久化候选；依赖不全即 unavailable |

## 关键文件

| 文件                                                 | 职责                |
| ---------------------------------------------------- | ------------------- |
| `packages/cli/src/commands/learning.js`              | learning 命令主入口 |
| `packages/cli/src/lib/learning/trajectory-store.js`  | 轨迹存储与查询      |
| `packages/cli/src/lib/learning/reflection-engine.js` | 反思引擎核心实现    |
| `packages/cli/src/lib/learning/skill-synthesizer.js` | 技能合成器核心实现  |
| `packages/cli/src/lib/evolution/skill-candidate-registry.js` | 内容寻址、不可变的候选注册表 |
| `packages/cli/src/lib/evolution/evolution-ledger.js` | source-only tamper-evident evolution ledger |
| `packages/cli/__tests__/unit/learning-command.test.js` | unavailable 与非零命令结果合同 |

## 配置参考

| 配置项                      | 含义                       | 默认            |
| --------------------------- | -------------------------- | --------------- |
| `trajectory.retentionDays`  | 轨迹保留期（天）           | 90              |
| `trajectory.minScoreToKeep` | 最低评分过滤               | 0.0（全部保留） |
| `reflect.sampleSize`        | 反思采样条数               | 200             |
| `reflect.trendWindow`       | 趋势窗口（天）             | 14              |
| `synthesize.minScore`       | 合成最低评分门槛           | 0.8             |
| `synthesize.minSupport`     | 模式最小支持度（命中次数） | 5               |
| `cleanup.days`              | `cleanup` 默认天数         | 90              |

`candidateOutputDir`、`evaluateCandidate` 与 active roots 是受信构造依赖，不是当前公开配置项。缺少任一项都不能通过配置绕过失败闭合，也不能把 candidate root 指向 active Skill 树。

可通过环境变量覆盖，例如 `CC_LEARNING_RETENTION_DAYS=60`。

## 性能指标

| 操作                    | 典型耗时        | 备注                     |
| ----------------------- | --------------- | ------------------------ |
| `learning stats`        | < 100 ms        | 索引化聚合               |
| `learning trajectories` | < 50 ms         | SQLite LIMIT 查询        |
| `learning reflect`      | 典型 300–800 ms | 取决于样本量             |
| `learning synthesize`   | 无生产 SLA       | 当前装配在扫描前返回 unavailable；source-only 候选路径尚无发布性能证据 |
| `learning cleanup`      | 依赖轨迹规模    | 批量 DELETE + VACUUM     |

## 测试覆盖率

```
__tests__/unit/trajectory-store.test.js
__tests__/unit/reflection-engine.test.js
__tests__/unit/skill-synthesizer.test.js
__tests__/unit/learning-command.test.js
__tests__/unit/skill-candidate-registry.test.js
__tests__/unit/evolution-ledger.test.js
__tests__/integration/learning-integration.test.js
```

测试文件位于 `packages/cli/__tests__/`，覆盖轨迹 CRUD、评分聚合、反思趋势、缺依赖 unavailable、候选隔离/不可变与持久化失败不得报告成功等合同。`233e1bdc` exact working tree 的原六个治理测试文件为 6/6 文件、126/126 测试通过（28.84 秒）；ledger 独立定向结果仍为 34/35 通过，另 1 项触发默认 5 秒超时。六文件全绿仍不是统一生产 wiring、qualification 或发布验收；ledger 也尚无生产 import/实例化。

## 使用示例

### 场景 1：查看学习进展

```bash
# 查看整体统计
chainlesschain learning stats

# 列出最近轨迹
chainlesschain learning trajectories -n 10

# 运行反思分析
chainlesschain learning reflect
```

### 场景 2：技能合成与维护

```bash
# 当前装配会失败闭合并报告 unavailable，不会写 active Skill
chainlesschain learning synthesize

# 清理 60 天前的旧数据
chainlesschain learning cleanup --days 60

# JSON 输出便于脚本处理
chainlesschain learning stats --json
```

### 场景 3：按会话分析

```bash
# 查看特定会话的轨迹
chainlesschain learning trajectories --session sess_abc123 --json

# 反思报告 JSON 输出
chainlesschain learning reflect --json | jq '.trend'
```

## 故障排查

| 症状                        | 可能原因                     | 解决方案                             |
| --------------------------- | ---------------------------- | ------------------------------------ |
| "No trajectories recorded"  | 未运行过 agent 会话          | 使用 `chainlesschain agent` 运行会话 |
| "Database not available"    | 数据库未初始化               | 运行 `chainlesschain db init`        |
| "No new skills synthesized" | 轨迹评分不够高或模式不够明确 | 积累更多高质量会话后重试             |
| `LEARNING_SYNTHESIS_UNAVAILABLE` | evaluator、candidateOutputDir 或 active roots 未注入 | 这是当前生产装配的预期失败闭合；不要把 candidate root 指向 active 树，也不要手工绕过晋升门 |
| 反思趋势始终 "stable"       | 样本量太少                   | 需要足够多的已评分轨迹               |

## 安全考虑

- **轨迹隐私**: 轨迹数据存储在本地 SQLite 中，不上传到远程服务器
- **保留策略**: 默认 90 天保留期，使用 `cleanup` 定期清理敏感数据
- **候选隔离**: 自动合成只能写隔离 candidate registry；candidate root 与 active roots 重叠、真实路径或文件身份不可验证时拒绝写入
- **晋升边界**: 候选不会自动安装或激活。promotion/release 原语尚未统一生产实例化，人工复制候选到 active 树不属于受支持流程
- **账本边界**: `d073bdf3` 的 hash-linked tamper-evident ledger 只有源码/测试合同；没有生产接线时不能为候选、receipt 或 active 状态提供运行时证明

## 相关文档

- [演化系统](./cli-evolution) — 自诊断与演化学习
- 技能系统 — 技能管理与四层加载
- [自主学习循环](./autonomous-learning-loop) — 设计文档
