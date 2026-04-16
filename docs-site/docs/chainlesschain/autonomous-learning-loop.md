# 自主学习闭环系统 (Autonomous Learning Loop v1.0)

> **版本: v1.0 | 状态: ✅ 生产就绪 | 5 核心模块 | 8 源文件 | 3 数据库表 | 224 tests**

ChainlessChain 自主学习闭环系统借鉴 [Hermes Agent](https://github.com/NousResearch/hermes-agent) 的 "Agent That Grows With You" 设计理念，将现有的 Evolution System、Instinct Manager 和 Skill System 连接为一个闭合反馈回路。系统从每次 Agent 会话的执行经验中**自动创建和改进技能**，无需人工干预。

## 概述

自主学习闭环系统将 Evolution System、Instinct Manager 和 Skill System 连接为闭合反馈回路，实现 Agent 从执行经验中自动学习和成长。系统完整记录每次会话的执行轨迹，通过三信号源质量评分筛选优质经验，自动从成功轨迹中合成可复用技能，并通过错误修复、用户修正和更优轨迹对比三种方式持续改进已有技能。

## 核心特性

- 📊 **轨迹存储**: 完整记录每次 Agent 会话的 (意图 → 工具调用链 → 结果 → 响应) 执行轨迹
- 🎯 **智能评分**: 三信号源质量评分 (自动评分 + 用户反馈 + 修正检测)，中英双语支持
- 🧬 **技能合成**: 从成功的复杂轨迹中自动提取可复用模式，生成 SKILL.md 文件
- 🔧 **技能改进**: 三种触发方式 (错误修复 / 用户修正 / 更优轨迹对比) 自动 patch 技能
- 🔄 **周期性自省**: 定时回顾会话数据，生成统计报告和改进建议
- 🔗 **零破坏集成**: 通过 Hook + Event 机制接入，不修改 agent-core 核心逻辑

## 快速开始

```bash
# 查看学习闭环统计概览
chainlesschain learning stats

# 查看最近执行轨迹
chainlesschain learning trajectories

# 手动触发自省分析
chainlesschain learning reflect

# 扫描并合成新技能
chainlesschain learning synthesize

# 清理过期轨迹 (默认 90 天)
chainlesschain learning cleanup
```

## CLI 命令详解

### `chainlesschain learning stats`

显示学习闭环的统计概览，包括轨迹数量、评分分布、已合成技能等。

```bash
chainlesschain learning stats              # 文本格式
chainlesschain learning stats --json       # JSON 格式
```

**输出示例**:

```
📊 学习闭环统计
  轨迹总数: 42
  已评分: 38 (90.5%)
  平均分: 0.72
  复杂轨迹: 8
  已合成技能: 3
  技能改进: 5
```

### `chainlesschain learning trajectories`

查看最近的执行轨迹记录。

```bash
chainlesschain learning trajectories              # 最近 20 条
chainlesschain learning trajectories -n 50         # 指定数量
chainlesschain learning trajectories --session <id> # 按会话筛选
chainlesschain learning trajectories --json        # JSON 格式
```

每条轨迹包含：
- 用户原始输入 (意图)
- 工具调用链 (工具名、参数、结果、耗时、状态)
- Agent 最终响应
- 质量评分 (0-1)
- 复杂度级别 (simple / moderate / complex)

### `chainlesschain learning reflect`

手动触发一次自省分析。系统会回顾所有未处理的轨迹，生成包含以下内容的报告：

```bash
chainlesschain learning reflect            # 文本报告
chainlesschain learning reflect --json     # JSON 报告
```

**报告内容**:
- 轨迹总数和评分统计
- 工具使用频次和错误率排行
- 评分趋势分析 (improving / declining / stable)
- 易错工具识别 (错误率 > 30%)
- LLM 分析建议 (可选，需配置辅助模型)

### `chainlesschain learning synthesize`

扫描符合条件的高质量复杂轨迹，自动合成新技能。

```bash
chainlesschain learning synthesize         # 扫描并合成
chainlesschain learning synthesize --json  # JSON 输出
```

**合成触发条件** (全部满足):

| 条件 | 阈值 | 说明 |
| --- | --- | --- |
| 工具调用数 | >= 5 | 只从复杂任务中学习 |
| 结果评分 | >= 0.7 | 只从成功经验学习 |
| 未被合成过 | `synthesized_skill IS NULL` | 防止重复 |
| 模式可复用 | >= 2 条相似轨迹 | Jaccard >= 0.5 确认可泛化 |

合成的技能会写入 **workspace 层** (`~/.chainlesschain/skills/`)，可通过 `chainlesschain skill list` 查看。

### `chainlesschain learning cleanup`

清理过期的执行轨迹数据。

```bash
chainlesschain learning cleanup            # 清理 90 天前数据
chainlesschain learning cleanup --days 30  # 自定义保留期
chainlesschain learning cleanup --json     # JSON 输出
```

## 系统架构

```
┌──────────────────────────────────────────────────────────────┐
│               自主学习闭环 (Autonomous Learning Loop)        │
│                                                              │
│  TrajectoryStore ──▶ SkillSynthesizer ──▶ SkillImprover     │
│  (轨迹存储)          (技能合成)           (技能改进)         │
│       ▲                                       │             │
│       │           ReflectionEngine ◀──────────┘             │
│       │           (周期性自省)                                │
│       │           OutcomeFeedback                           │
│       │           (结果反馈)                                 │
│       └───────────────┘                                      │
│                                                              │
│  集成层: UserPromptSubmit / PostToolUse / SessionEnd Hooks   │
└──────────────────────────────────────────────────────────────┘
```

## 五大核心模块

### 1. TrajectoryStore — 执行轨迹存储

记录完整的执行轨迹：用户意图 → 工具调用链 → 结果 → Agent 响应。

**触发点**: 通过 `learning-hooks.js` 的 4 个钩子自动接入：

| 钩子 | 触发时机 | 动作 |
| --- | --- | --- |
| `onUserPromptSubmit` | 用户输入时 | `startTrajectory()` 开始记录 |
| `onPostToolUse` | 每次工具调用后 | `appendToolCall()` 追加记录 |
| `onResponseComplete` | Agent 回复完成 | `completeTrajectory()` 完成轨迹 |
| `onSessionEnd` | 会话结束 | 预留自省触发点 |

**每条轨迹存储的数据**:

```javascript
{
  id: "traj-abc123",           // 唯一 ID
  sessionId: "sess-001",       // 所属会话
  userIntent: "修复认证模块",    // 用户原始输入
  toolChain: [                 // 工具调用链
    { tool: "read_file", args: { path: "auth.js" }, result: "ok", durationMs: 50, status: "completed" },
    { tool: "edit_file", args: { path: "auth.js" }, result: "ok", durationMs: 120, status: "completed" },
    { tool: "run_shell", args: { cmd: "npm test" }, result: "pass", durationMs: 3000, status: "completed" }
  ],
  toolCount: 3,
  finalResponse: "已修复认证模块...",
  outcomeScore: 0.8,           // 质量评分 (0-1)
  outcomeSource: "auto",       // 评分来源
  complexityLevel: "moderate", // simple / moderate / complex
  synthesizedSkill: null       // 已合成的技能名 (nullable)
}
```

**复杂度判定**:
- **simple** (<=2 工具调用): 简单查询/单文件操作
- **moderate** (3-5 工具调用): 多步操作
- **complex** (6+ 工具调用): 技能合成候选

**保留策略**: 默认 90 天，可通过 `chainlesschain learning cleanup --days N` 配置。

### 2. OutcomeFeedback — 结果质量反馈

将执行结果与质量评分关联，产生奖励信号。

**三种信号来源**:

| 来源 | 机制 | 优先级 |
| --- | --- | --- |
| 自动评分 | 错误率、重试次数、最终状态 | 基线 |
| 用户反馈 | `positive` / `negative` 或数值 0-1 | 覆盖自动评分 |
| 修正检测 | 否定模式匹配 (中英双语) + 文件引用 | 降低 0.3 分 |

**自动评分规则**:

```javascript
function autoScore(trajectory) {
  let score = 0.5;  // 基线

  const chain = trajectory.toolChain;
  const errorCount = chain.filter(t => t.status === "error").length;
  const totalCount = chain.length;

  if (errorCount === 0) score += 0.2;           // 无错误: +0.2
  if (errorCount / totalCount > 0.5) score -= 0.3; // 错误率>50%: -0.3
  if (hasRetries(chain)) score -= 0.1;           // 有重试: -0.1
  if (chain.at(-1)?.status === "completed") score += 0.1; // 最终成功: +0.1

  return Math.max(0, Math.min(1, score));        // 夹持到 [0, 1]
}
```

**修正检测** (中英双语):

```javascript
// 否定模式匹配
const NEGATION_PATTERNS = [
  /不[是对]/, /错了/, /重[新做来]/, /别这样/,   // 中文
  /not right/i, /wrong/i, /redo/i, /don't/i    // 英文
];
```

**传播路径**:
- 高分 (>=0.8) → `InstinctManager` 记录工具偏好 (TOOL_PREFERENCE)
- 低分 (<=0.3) → `InstinctManager` 记录应避免的模式 (WORKFLOW)
- 所有评分 → `EvolutionSystem` 更新能力评估

### 3. SkillSynthesizer — 自动技能合成

从成功的复杂执行轨迹中提取可复用模式，生成 SKILL.md 文件。

**处理流程**:

1. 查找符合条件的轨迹 (复杂 + 高分 + 未处理)
2. 检查去重 (工具链指纹 Jaccard >= 0.7)
3. 发送到辅助 LLM 进行模式提取 (JSON 格式)
4. 生成含 Procedure / Pitfalls / Verification 节的 SKILL.md
5. 写入 workspace 技能层

**去重算法**: 基于工具名集合的 Jaccard 指数。

```javascript
// 工具链指纹: 排序后的工具名集合
toolChainFingerprint(["read_file", "edit_file", "run_shell", "read_file"])
// → ["edit_file", "read_file", "run_shell"]

// Jaccard 相似度 = |A ∩ B| / |A ∪ B|
// >= 0.7 视为重复，转交 SkillImprover 而非重复创建
```

**生成的 SKILL.md 格式**:

```yaml
---
name: auto-refactor-auth
description: 自动重构认证模块并验证
version: 1.0.0
category: auto-learned
tags: [auto-synthesized]
tools: [read_file, edit_file, run_shell]
---

## Procedure
1. 读取目标文件
2. 分析并重构代码
3. 运行测试验证

## Pitfalls
- 注意保持接口兼容性
- 先跑测试再提交

## Verification
- 所有测试通过
- 无回归错误
```

### 4. SkillImprover — 技能持续改进

在技能使用过程中发现问题时自动 patch。

**三种改进触发方式**:

| 触发方式 | 方法 | 数据来源 |
| --- | --- | --- |
| 错误驱动修复 | `repairFromError()` | 错误信息 + 执行上下文 |
| 用户修正驱动 | `updateFromCorrection()` | 用户消息 + 工具链对比 |
| 对比改进 | `improveFromBetterTrajectory()` | 更高评分轨迹 |

**改进流程**:

1. 读取当前 SKILL.md 文件
2. LLM 分析并建议改进 (JSON 格式，需 confidence >= 0.4)
3. 替换 Procedure / Pitfalls / Verification 节
4. 自动递增版本号 (1.0.0 → 1.1.0)
5. 记录到 `skill_improvement_log` 表

**批量扫描**: `scanForImprovements()` 自动发现有更优轨迹可用的已合成技能。

### 5. ReflectionEngine — 周期性自省

定时回顾会话轨迹，生成统计报告和改进建议。

**触发方式**:
- **手动**: `chainlesschain learning reflect`
- **定时**: 可配置间隔 (默认 24 小时)，通过 `isReflectionDue()` 检查

**自省报告内容**:
- 轨迹总数 / 已评分数
- 工具使用统计 (使用次数 + 错误率)
- 评分趋势分析: improving / declining / stable
- 易错工具识别 (错误率 > 30% 且调用数 >= 2)
- 可选 LLM 分析 (优势 / 劣势 / 建议)

**趋势算法**: 将已评分轨迹分为前后两半，比较平均分差值：
- 差值 > 0.05 → **improving** (能力在提升)
- 差值 < -0.05 → **declining** (需要注意)
- 其他 → **stable** (稳定状态)

## 数据流

```
用户输入
  → [UserPromptSubmit] TrajectoryStore.start()
  → Agent Loop (工具调用)
    → [PostToolUse × N] TrajectoryStore.append()
  → [response-complete] TrajectoryStore.complete()
    → OutcomeFeedback.autoScore()
      → InstinctManager (偏好)
      → EvolutionSystem (能力)
  → [下一条用户消息] detectCorrection()
    → SkillImprover.updateFromCorrection()
  → [SessionEnd / 定时器]
    → ReflectionEngine.reflect()
      → SkillSynthesizer (新技能)
      → SkillImprover (更优方案)
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

## 配置参考

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

## 性能指标

| 操作 | 目标 | 实际 | 状态 |
| --- | --- | --- | --- |
| 轨迹记录（单条追加） | < 50ms | ~10ms | ✅ |
| 自动评分计算 | < 5ms | ~2ms | ✅ |
| 修正检测（正则匹配） | < 10ms | ~3ms | ✅ |
| 技能合成（含 LLM 调用） | < 30s | ~15-25s | ✅ |
| 技能改进 patch | < 20s | ~10-15s | ✅ |
| 手动自省报告生成 | < 10s | ~5s | ✅ |
| 轨迹清理（90 天） | < 1s | ~200ms | ✅ |
| CLI stats 查询 | < 500ms | ~100ms | ✅ |

---

## 使用示例

### 完整学习闭环示例

```bash
# 1. 进行若干次 agent 会话（系统自动记录轨迹）
chainlesschain agent
# ... 执行复杂任务，系统自动记录工具调用链 ...

# 2. 查看已积累的轨迹统计
chainlesschain learning stats

# 3. 手动触发自省，生成分析报告
chainlesschain learning reflect

# 4. 扫描并合成可复用技能
chainlesschain learning synthesize

# 5. 查看新合成的技能
chainlesschain skill list --layer workspace
```

### 提交用户反馈

```javascript
// 在 Desktop 中通过 IPC 提交正向反馈
await window.electronAPI.invoke('learning:feedback', {
  trajectoryId: 'traj-abc123',
  feedback: 'positive'
});

// 提交数值评分
await window.electronAPI.invoke('learning:feedback', {
  trajectoryId: 'traj-abc123',
  feedback: 0.95
});
```

### 查看技能改进历史

```bash
# 查看最近 50 条轨迹，筛选复杂任务
chainlesschain learning trajectories -n 50 --json | \
  node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); \
    console.log(d.filter(t=>t.complexityLevel==='complex').length + ' complex trajectories')"

# 查看特定会话的轨迹
chainlesschain learning trajectories --session sess_20260416_001
```

---

## 与 Hermes Agent 的对比

| 维度 | Hermes Agent | ChainlessChain |
| --- | --- | --- |
| 合成触发 | 5+ 工具 + 成功 | 5+ 工具 + 评分>=0.7 + 2+ 相似轨迹 |
| 改进方式 | skill_manage patch/edit | LLM patch + section 替换 + 版本递增 |
| 自省机制 | nudge_interval 定时 | 24h 定时 + 手动 CLI 命令 |
| 质量信号 | 仅 Agent 自评 | 自动评分 + 用户反馈 + 修正检测 (中英双语) |
| 技能格式 | SKILL.md | 同款格式，兼容 4 层 loader |
| 去重 | 无 | Jaccard 工具链指纹 (阈值 0.7) |
| 版本历史 | 无 (in-place) | skill_improvement_log 全量记录 |
| 本能集成 | 无 | 直接连接 instinct-manager |

## 关键文件

| 文件 | 用途 | 状态 |
| --- | --- | --- |
| `src/lib/learning/learning-tables.js` | 数据库建表 (3 表 + 3 索引) | ✅ |
| `src/lib/learning/trajectory-store.js` | 执行轨迹存储 (12 方法) | ✅ |
| `src/lib/learning/learning-hooks.js` | Hook 注册 (4 钩子 + 工厂) | ✅ |
| `src/lib/learning/outcome-feedback.js` | 结果质量反馈 (3 信号源) | ✅ |
| `src/lib/learning/skill-synthesizer.js` | 自动技能合成 (6 helper + 类) | ✅ |
| `src/lib/learning/skill-improver.js` | 技能持续改进 (3 触发器 + 扫描) | ✅ |
| `src/lib/learning/reflection-engine.js` | 周期性自省 (统计 + LLM 分析) | ✅ |
| `src/commands/learning.js` | CLI 命令组 (5 子命令) | ✅ |

> 所有文件路径相对于 `packages/cli/`

## 测试覆盖

| 文件 | 类型 | 测试数 |
| --- | --- | --- |
| `learning-tables.test.js` | 单元 | 5 |
| `learning-hooks.test.js` | 单元 | 22 |
| `trajectory-store.test.js` | 单元 | 50 |
| `outcome-feedback.test.js` | 单元 | 33 |
| `skill-synthesizer.test.js` | 单元 | 32 |
| `skill-improver.test.js` | 单元 | 28 |
| `reflection-engine.test.js` | 单元 | 27 |
| `learning-integration.test.js` | 集成 | 10 |
| `learning-commands.test.js` | E2E | 17 |
| **合计** | | **224** |

## 已知局限

| 局限 | 缓解措施 |
| --- | --- |
| 自评偏差 | 用户反馈覆盖；修正检测提供负信号 |
| 无版本回滚 | improvement_log 保存变更历史，可手动恢复 |
| LLM 提取质量不稳定 | 要求 2+ 相似轨迹才合成，confidence >= 0.4 |
| 每次自省的 Token 成本 | 批量处理轨迹；可配置辅助模型 |
| 低质量技能累积 | 手动 `skill remove`；可扩展 decay 机制 |

## 故障排查

### 轨迹未被记录

**症状**: `chainlesschain learning stats` 显示轨迹数为 0

**排查步骤**:
1. 确认学习闭环已启用: 检查配置 `learning.enabled` 是否为 `true`
2. 确认 `createLearningContext()` 返回非 null: 需要有效的 DB 连接
3. 检查 Hook 注册: `learning-hooks.js` 中的 4 个钩子是否正确接入 agent-repl

### 自动评分异常

**症状**: 所有轨迹评分都是 0.5

**原因**: 工具调用链为空或所有工具都没有 `status` 字段

**解决方案**:
```javascript
// 确保每个工具调用都有 status 字段
onPostToolUse(ctx, {
  tool: "read_file",
  args: { path: "foo.js" },
  result: "ok",
  durationMs: 50,
  status: "completed"  // 必须提供
});
```

### 技能合成未触发

**症状**: `chainlesschain learning synthesize` 无输出

**排查**:
- 检查是否有满足条件的轨迹 (工具数 >= 5, 评分 >= 0.7, 未合成过)
- 检查是否有 >= 2 条相似轨迹 (Jaccard >= 0.5)
- 查看是否已被去重 (Jaccard >= 0.7 视为已有技能的重复)

### 修正检测误报

**症状**: 正常对话被识别为用户修正，评分被错误降低

**原因**: 否定模式正则匹配过于宽泛

**缓解**: 修正检测同时要求否定词 + 文件引用匹配，单独的否定词不会触发

## 安全考虑

| 安全要点 | 说明 |
| --- | --- |
| 轨迹数据隐私 | 轨迹存储在本地 SQLite，不上传到外部服务 |
| LLM 调用安全 | 合成/改进/自省的 LLM 调用遵循现有 provider 配置和 API Key 管理 |
| 技能写入权限 | 自动合成的技能只写入 workspace 层，不影响 bundled/managed 层 |
| SQL 注入防护 | 所有数据库操作使用参数化查询 (`db.prepare()`) |
| 用户输入截断 | `finalResponse` 截断至 500 字符，防止大量数据存储 |
| 轨迹保留策略 | 默认 90 天自动清理，可通过 `cleanup --days` 调整 |

## 相关文档

- [65. 自进化AI系统](/design/modules/65-self-evolving-ai) — 能力评估与成长追踪
- [16. AI技能系统](/design/modules/16-ai-skills) — 4 层技能加载架构
- [76. 技能创建系统](/design/modules/76-skill-creator) — 手动技能创建
- [Instinct 学习系统](/chainlesschain/cli-instinct) — 用户偏好自动学习
- [84. 设计文档](/design/modules/84-autonomous-learning-loop) — 完整设计规格
