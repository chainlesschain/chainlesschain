# 84. 自主学习闭环系统 (Autonomous Learning Loop v1.0)

> **状态**: ✅ 已实现 (P0-P3 全部完成)
> **日期**: 2026-04-12
> **作用范围**: `packages/cli`
> **灵感来源**: [Hermes Agent](https://github.com/NousResearch/hermes-agent) — Nous Research
> **关联文档**: [65. 自进化AI系统](./65-self-evolving-ai.md) · [16. AI技能系统](./16-ai-skills.md) · [76. 技能创建系统](./76-skill-creator.md)

## 概述

自主学习闭环系统将 ChainlessChain 现有的 Evolution System、Instinct Manager 和 Skill System 连接成一个闭合反馈回路，**从经验中自动创建和改进技能**。

借鉴 Hermes Agent 的 "Agent That Grows With You" 架构，通过基于轨迹的学习管道将这些模块串联起来。

## 架构

```
+----------------------------------------------------------+
|              自主学习闭环 (Autonomous Learning Loop)      |
|                                                          |
|  TrajectoryStore --> SkillSynthesizer --> SkillImprover   |
|  (轨迹存储)          (技能合成)           (技能改进)      |
|       ^                                       |          |
|       |           ReflectionEngine <----------+          |
|       |           (周期性自省)                             |
|       |           OutcomeFeedback                        |
|       |           (结果反馈)                              |
|       +-------------------+                              |
|                                                          |
|  集成层: PostToolUse / SessionEnd Hooks + Events         |
+----------------------------------------------------------+
```

## 核心模块

### 1. TrajectoryStore — 执行轨迹存储

记录完整的执行轨迹：用户意图 -> 工具调用链 -> 结果 -> Agent 响应。

**触发点**: `UserPromptSubmit` / `PostToolUse` / `response-complete` 钩子和事件。

**每条轨迹存储的数据**:
- 会话 ID 和用户意图（原始输入）
- 工具调用链: `[{tool, args, result, duration_ms, status}]`
- Agent 最终响应（截断至 500 字符）
- 结果评分 (0-1, 由 OutcomeFeedback 回填)
- 复杂度级别: simple (<=2 工具) / moderate (3-5) / complex (6+)

**保留策略**: 默认 90 天，可通过 `chainlesschain learning cleanup --days N` 配置。

### 2. OutcomeFeedback — 结果质量反馈

将执行结果与质量评分关联，产生奖励信号。

**三种信号来源**:

| 来源 | 机制 | 优先级 |
| --- | --- | --- |
| 自动评分 | 错误率、重试次数、最终状态 | 基线 |
| 用户反馈 | `positive`/`negative` 或数值 0-1 | 覆盖自动评分 |
| 修正检测 | 否定模式匹配（中英双语）+ 文件引用 | 降低 0.3 分 |

**自动评分规则**:
- 基线: 0.5
- 无错误: +0.2 | 错误率 >50%: -0.3
- 有重试（连续相同工具）: -0.1 | 最后一个工具成功: +0.1
- 结果夹持到 [0, 1] 范围

**传播路径**:
- 高分 (>=0.8) -> InstinctManager 记录工具偏好
- 低分 (<=0.3) -> InstinctManager 记录应避免的工作流
- 所有评分 -> EvolutionSystem 能力评估

### 3. SkillSynthesizer — 自动技能合成

从成功的复杂执行轨迹中提取可复用模式，生成 SKILL.md 文件。

**触发条件**（全部满足才触发）:

| 条件 | 阈值 |
| --- | --- |
| 工具调用数 | >= 5 (可配置) |
| 结果评分 | >= 0.7 (可配置) |
| 未被合成过 | `synthesized_skill IS NULL` |
| 模式可复用 | >= 2 条相似轨迹 (Jaccard >= 0.5) |

**处理流程**:
1. 查找符合条件的轨迹（复杂 + 高分 + 未处理）
2. 检查去重（工具链指纹 Jaccard >= 0.7）
3. 发送到辅助 LLM 进行模式提取（JSON 格式）
4. 生成含 Procedure / Pitfalls / Verification 节的 SKILL.md
5. 写入 workspace 技能层

**去重算法**: 基于工具名集合的 Jaccard 指数，排序后取指纹，重叠度 >= 0.7 视为重复。

### 4. SkillImprover — 技能持续改进

在技能使用过程中发现问题时自动 patch。

**三种改进触发方式**:

| 触发方式 | 方法 | 数据来源 |
| --- | --- | --- |
| 错误驱动修复 | `repairFromError()` | 错误信息 + 上下文 |
| 用户修正驱动 | `updateFromCorrection()` | 用户消息 + 工具链对比 |
| 对比改进 | `improveFromBetterTrajectory()` | 更高评分轨迹 |

**改进流程**:
1. 读取当前 SKILL.md 文件
2. LLM 分析并建议改进（JSON 格式，需 confidence >= 0.4）
3. 替换 Procedure / Pitfalls / Verification 节
4. 自动递增版本号 (1.0.0 -> 1.1.0)
5. 记录到 `skill_improvement_log` 表

**批量扫描**: `scanForImprovements()` 自动发现有更优轨迹可用的已合成技能。

### 5. ReflectionEngine — 周期性自省

定时回顾会话轨迹，生成统计报告和改进建议。

**触发方式**:
- 手动: `chainlesschain learning reflect`
- 定时: 可配置间隔（默认 24 小时），通过 `isReflectionDue()` 检查

**自省报告内容**:
- 轨迹总数 / 已评分数
- 工具使用统计（使用次数 + 错误率）
- 评分趋势分析: improving / declining / stable
- 易错工具识别（错误率 > 30% 且调用数 >= 2）
- 可选 LLM 分析（优势 / 劣势 / 建议）

**趋势算法**: 将已评分轨迹分为前后两半，比较平均分差值，>0.05 为 improving，<-0.05 为 declining。

## CLI 命令

```bash
chainlesschain learning stats              # 学习闭环统计概览
chainlesschain learning stats --json       # JSON 格式输出

chainlesschain learning trajectories       # 最近 20 条执行轨迹
chainlesschain learning trajectories -n 50 # 指定数量
chainlesschain learning trajectories --session <id>  # 按会话筛选
chainlesschain learning trajectories --json

chainlesschain learning reflect            # 手动触发自省
chainlesschain learning reflect --json     # JSON 报告

chainlesschain learning synthesize         # 扫描并合成新技能
chainlesschain learning synthesize --json

chainlesschain learning cleanup            # 清理 90 天前的旧轨迹
chainlesschain learning cleanup --days 30  # 自定义保留期
chainlesschain learning cleanup --json
```

## 数据库表

### learning_trajectories

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PK | 轨迹唯一 ID |
| session_id | TEXT NOT NULL | 所属会话 |
| user_intent | TEXT | 用户原始输入 |
| tool_chain | TEXT NOT NULL | JSON 工具调用链 |
| tool_count | INTEGER | 工具调用数 |
| final_response | TEXT | Agent 最终响应 |
| outcome_score | REAL | 质量评分 0-1 |
| outcome_source | TEXT | auto / user / reflection |
| complexity_level | TEXT | simple / moderate / complex |
| synthesized_skill | TEXT | 已合成的技能名称 |
| created_at | TEXT | 创建时间 |
| completed_at | TEXT | 完成时间 |

**索引**: session_id, outcome_score, complexity_level

### learning_trajectory_tags

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| trajectory_id | TEXT NOT NULL | 轨迹 ID |
| tag | TEXT NOT NULL | 标签 |

**约束**: UNIQUE(trajectory_id, tag)

### skill_improvement_log

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| skill_name | TEXT NOT NULL | 技能名称 |
| trigger_type | TEXT NOT NULL | error_repair / user_correction / better_trajectory / reflection |
| detail | TEXT | 改进详情 |
| created_at | TEXT | 创建时间 |

## 配置项

```json
{
  "learning": {
    "enabled": true,
    "trajectory": {
      "retentionDays": 90,
      "maxToolChainLength": 50
    },
    "synthesis": {
      "minToolCount": 5,
      "minOutcomeScore": 0.7,
      "minSimilarTrajectories": 2,
      "outputLayer": "workspace"
    },
    "reflection": {
      "intervalMs": 86400000,
      "auxiliaryModel": null
    },
    "feedback": {
      "autoScore": true,
      "correctionDetection": true
    }
  }
}
```

## 数据流

```
用户输入
  -> [UserPromptSubmit] TrajectoryStore.start()
  -> Agent Loop (工具调用)
    -> [PostToolUse x N] TrajectoryStore.append()
  -> [response-complete] TrajectoryStore.complete()
    -> OutcomeFeedback.autoScore()
      -> InstinctManager (偏好)
      -> EvolutionSystem (能力)
  -> [下一条用户消息] detectCorrection()
    -> SkillImprover.updateFromCorrection()
  -> [SessionEnd / 定时器]
    -> ReflectionEngine.reflect()
      -> SkillSynthesizer (新技能)
      -> SkillImprover (更优方案)
```

## 实施阶段

| 阶段 | 说明 | 状态 | 测试数 |
| --- | --- | --- | --- |
| P0: 轨迹存储 | TrajectoryStore + Hook 接入 + 数据库表 | ✅ 完成 | 77 |
| P1: 结果反馈 | 自动评分 + 用户反馈 + 修正检测 + 传播链路 | ✅ 完成 | 33 |
| P2: 技能合成 | SkillSynthesizer + SkillImprover | ✅ 完成 | 60 |
| P3: 自省与集成 | ReflectionEngine + CLI 命令 + E2E | ✅ 完成 | 54 |
| **合计** | | **全部完成** | **224** |

## 与 Hermes Agent 的对比

| 维度 | Hermes Agent | ChainlessChain |
| --- | --- | --- |
| 合成触发 | 5+ 工具 + 成功 | 5+ 工具 + 评分>=0.7 + 2+ 相似轨迹 |
| 改进方式 | skill_manage patch/edit | LLM patch + section 替换 + 版本递增 |
| 自省机制 | nudge_interval 定时 | 24h 定时 + 手动 CLI 命令 |
| 质量信号 | 仅 Agent 自评 | 自动评分 + 用户反馈 + 修正检测（中英双语） |
| 技能格式 | SKILL.md | 同款格式，兼容 4 层 loader |
| 去重 | 无 | Jaccard 工具链指纹 (阈值 0.7) |
| 版本历史 | 无 (in-place) | skill_improvement_log 全量记录 |
| 本能集成 | 无 | 直接连接 instinct-manager |

## 文件清单

| 文件 | 用途 | 阶段 | 状态 |
| --- | --- | --- | --- |
| `src/lib/learning/learning-tables.js` | 数据库建表 (3 表 + 3 索引) | P0 | ✅ |
| `src/lib/learning/trajectory-store.js` | 执行轨迹存储 (12 方法) | P0 | ✅ |
| `src/lib/learning/learning-hooks.js` | Hook 注册 (4 钩子 + 工厂) | P0 | ✅ |
| `src/lib/learning/outcome-feedback.js` | 结果质量反馈 (3 信号源) | P1 | ✅ |
| `src/lib/learning/skill-synthesizer.js` | 自动技能合成 (6 helper + 类) | P2 | ✅ |
| `src/lib/learning/skill-improver.js` | 技能持续改进 (3 触发器 + 扫描) | P2 | ✅ |
| `src/lib/learning/reflection-engine.js` | 周期性自省 (统计 + LLM 分析) | P3 | ✅ |
| `src/commands/learning.js` | CLI 命令组 (5 子命令) | P3 | ✅ |

### 测试文件

| 文件 | 类型 | 测试数 |
| --- | --- | --- |
| `__tests__/unit/learning-tables.test.js` | 单元 | 5 |
| `__tests__/unit/learning-hooks.test.js` | 单元 | 22 |
| `__tests__/unit/trajectory-store.test.js` | 单元 | 50 |
| `__tests__/unit/outcome-feedback.test.js` | 单元 | 33 |
| `__tests__/unit/skill-synthesizer.test.js` | 单元 | 32 |
| `__tests__/unit/skill-improver.test.js` | 单元 | 28 |
| `__tests__/unit/reflection-engine.test.js` | 单元 | 27 |
| `__tests__/integration/learning-integration.test.js` | 集成 | 10 |
| `__tests__/e2e/learning-commands.test.js` | E2E | 17 |
| **合计** | | **224** |

## 已知局限

| 局限 | 缓解措施 |
| --- | --- |
| 自评偏差 | 用户反馈覆盖；修正检测提供负信号 |
| 无版本回滚 | improvement_log 保存变更历史，可手动恢复 |
| LLM 提取质量不稳定 | 要求 2+ 相似轨迹才合成，confidence >= 0.4 |
| 每次自省的 Token 成本 | 批量处理轨迹；可配置辅助模型 |
| 低质量技能累积 | 手动 `skill remove`；可扩展 decay 机制 |
| MockDB 不支持 datetime 算术 | cleanup 依赖真实 SQLite；单元测试验证逻辑正确性 |
