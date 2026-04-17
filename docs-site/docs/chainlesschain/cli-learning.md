# 自主学习循环 (learning)

> Headless 命令 — 不依赖桌面 GUI，直接使用核心包运行。适用于服务器、CI/CD、容器化等无桌面环境。

## 核心特性

- 📊 **学习统计**: 查看轨迹总数、复杂度分布、评分和技能合成情况
- 📈 **轨迹管理**: 列出和检索最近的工具调用轨迹记录
- 🔍 **反思引擎**: 运行反思周期，分析趋势、高频工具和错误率
- 🧬 **技能合成**: 从高分轨迹中自动合成新技能
- 🧹 **数据清理**: 删除超过保留期限的旧轨迹

## 概述

ChainlessChain CLI 自主学习循环模块实现了智能体从工具调用轨迹中自主学习的完整闭环。`stats` 查看学习统计，`trajectories` 列出最近的轨迹，`reflect` 运行反思周期生成趋势报告，`synthesize` 从合格轨迹中合成新技能，`cleanup` 清理过期数据。

轨迹记录每次智能体会话中的工具调用序列、复杂度（工具数量）、结果评分和用户意图。反思引擎分析这些数据，识别趋势（改善/下降/稳定）、高频工具和高错误率工具。技能合成器在发现可复用的高分工具组合模式时，自动生成新的 SKILL.md 文件。

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

扫描合格的轨迹（高分、可复用模式），自动合成新技能。返回已创建的技能名称列表和跳过的候选数量。

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
          SQLite (trajectories 表)
```

### 核心模块

| 模块 | 职责 |
|------|------|
| `TrajectoryStore` | 轨迹的存储、查询、统计和清理 |
| `ReflectionEngine` | 分析轨迹趋势、工具使用模式和错误率 |
| `SkillSynthesizer` | 从高分轨迹模式中自动生成 SKILL.md |

## 关键文件

| 文件 | 职责 |
|------|------|
| `packages/cli/src/commands/learning.js` | learning 命令主入口 |
| `packages/cli/src/lib/learning/trajectory-store.js` | 轨迹存储与查询 |
| `packages/cli/src/lib/learning/reflection-engine.js` | 反思引擎核心实现 |
| `packages/cli/src/lib/learning/skill-synthesizer.js` | 技能合成器核心实现 |

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
# 扫描并合成新技能
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

| 症状 | 可能原因 | 解决方案 |
|------|---------|---------|
| "No trajectories recorded" | 未运行过 agent 会话 | 使用 `chainlesschain agent` 运行会话 |
| "Database not available" | 数据库未初始化 | 运行 `chainlesschain db init` |
| "No new skills synthesized" | 轨迹评分不够高或模式不够明确 | 积累更多高质量会话后重试 |
| 反思趋势始终 "stable" | 样本量太少 | 需要足够多的已评分轨迹 |

## 安全考虑

- **轨迹隐私**: 轨迹数据存储在本地 SQLite 中，不上传到远程服务器
- **保留策略**: 默认 90 天保留期，使用 `cleanup` 定期清理敏感数据
- **技能审核**: 合成的技能以 SKILL.md 文件形式生成，建议人工审核后再投入使用

## 相关文档

- [演化系统](./cli-evolution) — 自诊断与演化学习
- [技能系统](./skill-system) — 技能管理与四层加载
- [自主学习循环](./autonomous-learning-loop) — 设计文档
