# 84. 自主学习闭环系统 (Autonomous Learning Loop v1.0)

> **状态**: ✅ 已实现 (P0-P3 全部完成, 224 tests)
> **日期**: 2026-04-12
> **作用范围**: `packages/cli`
> **灵感来源**: [Hermes Agent](https://github.com/NousResearch/hermes-agent) — Nous Research
> **关联文档**: [65. 自进化AI系统](./65_自进化AI系统.md) · [16. AI技能系统](./16_AI技能系统.md) · [76. 技能创建系统](./76_技能创建系统.md)

## 1. 概述

自主学习闭环系统（Autonomous Learning Loop）借鉴 Hermes Agent 的 "Agent That Grows With You" 理念，在 ChainlessChain 现有的 Evolution System、Instinct Manager、Skill System 之上构建**经验驱动的技能自动创建与持续改进闭环**。

当前系统的核心差距：**基础设施约 80% 就位，但各模块间缺乏反馈回路**。Evolution 追踪能力但不触发学习，Instinct 记录偏好但不更新技能，Tool Telemetry 记录执行但不评估结果质量。本系统的目标是将这些孤立的模块串联为一条自动化的学习链路。

### 1.1 设计目标

| 目标 | 描述 |
| --- | --- |
| 轨迹存储 | 完整记录 (意图 → 工具调用链 → 结果 → 用户反馈) 执行轨迹 |
| 自动技能合成 | 从成功的复杂任务中自动提取模式、生成 SKILL.md |
| 技能持续改进 | 使用中发现问题时自动 patch 技能步骤 |
| 周期性自省 | 定时回顾会话，持久化有价值的知识 |
| 结果质量反馈 | 工具执行结果与用户满意度关联，形成奖励信号 |
| 零破坏集成 | 不修改现有 agent-core / skill-loader / evolution-system 核心接口 |

### 1.2 非目标

- 不做模型微调/LoRA — 本系统是 prompt-level 学习，非权重级
- 不做 A/B 测试框架 — 技能改进是 in-place 的
- 不做外部评估基准 — 依赖用户反馈 + 执行结果作为信号

## 2. 技术架构

```
┌──────────────────────────────────────────────────────────────────────┐
│                  Autonomous Learning Loop v1.0                       │
│                                                                      │
│  ┌────────────────┐   ┌────────────────┐   ┌─────────────────────┐  │
│  │ TrajectoryStore │   │ SkillSynthesizer│   │ SkillImprover       │  │
│  │ 执行轨迹存储    │──▶│ 模式提取+技能生成│──▶│ 使用中诊断+patch    │  │
│  │ 全链路追踪      │   │ 复杂度阈值触发  │   │ 错误驱动+偏好驱动   │  │
│  └────────────────┘   └────────────────┘   └─────────────────────┘  │
│          ▲                                          │                │
│          │              ┌────────────────┐          │                │
│          │              │ ReflectionEngine│          │                │
│          │              │ 周期性自省      │◀─────────┘                │
│          │              │ 知识持久化      │                           │
│          │              └────────────────┘                           │
│          │              ┌────────────────┐                           │
│          └──────────────│ OutcomeFeedback │                           │
│                         │ 用户反馈+结果  │                           │
│                         │ 质量评分       │                           │
│                         └────────────────┘                           │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │         Integration Layer (Hooks + Events)                    │   │
│  │  PostToolUse → TrajectoryStore                                │   │
│  │  SessionEnd → ReflectionEngine                                │   │
│  │  UserFeedback → OutcomeFeedback → Instinct + Evolution        │   │
│  └──────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘

依赖的现有模块:
  ├── agent-core.js          (工具执行 + Hook 触发)
  ├── evolution-system.js    (能力评估 + 成长日志)
  ├── instinct-manager.js    (用户偏好学习)
  ├── skill-loader.js        (技能加载 4 层)
  ├── skill-creator.js       (技能创建)
  ├── tool-telemetry.js      (执行遥测)
  ├── session-hooks.js       (会话级钩子)
  └── hierarchical-memory.js (层次化记忆)
```

## 3. 核心模块设计

### 3.1 TrajectoryStore — 执行轨迹存储

**职责**: 记录完整的 (意图 → 工具调用链 → 结果 → 响应) 执行轨迹，为后续模式提取提供数据源。

**文件**: `packages/cli/src/lib/learning/trajectory-store.js`

**数据库表**:

```sql
-- 轨迹主表
CREATE TABLE IF NOT EXISTS learning_trajectories (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  user_intent TEXT,              -- 用户原始输入
  tool_chain TEXT NOT NULL,      -- JSON: [{tool, args, result, duration_ms, status}]
  tool_count INTEGER DEFAULT 0,
  final_response TEXT,           -- Agent 最终回复
  outcome_score REAL,            -- 结果质量评分 (0-1, 由 OutcomeFeedback 回填)
  outcome_source TEXT,           -- 评分来源: "auto" | "user" | "reflection"
  complexity_level TEXT,         -- "simple" | "moderate" | "complex"
  synthesized_skill TEXT,        -- 已从此轨迹合成的技能名 (nullable)
  created_at TEXT DEFAULT (datetime('now')),
  INDEX idx_traj_session (session_id),
  INDEX idx_traj_score (outcome_score),
  INDEX idx_traj_complexity (complexity_level)
);

-- 轨迹标签 (用于模式匹配)
CREATE TABLE IF NOT EXISTS learning_trajectory_tags (
  trajectory_id TEXT NOT NULL,
  tag TEXT NOT NULL,
  FOREIGN KEY (trajectory_id) REFERENCES learning_trajectories(id),
  UNIQUE(trajectory_id, tag)
);
```

**核心方法**:

```javascript
class TrajectoryStore {
  constructor(db) { ... }

  // 开始记录一条新轨迹 (UserPromptSubmit 钩子触发)
  startTrajectory(sessionId, userIntent) → trajectoryId

  // 追加工具调用记录 (PostToolUse 钩子触发)
  appendToolCall(trajectoryId, { tool, args, result, durationMs, status }) → void

  // 完成轨迹 (response-complete 事件触发)
  completeTrajectory(trajectoryId, { finalResponse, tags }) → trajectory

  // 回填结果评分 (OutcomeFeedback 调用)
  setOutcomeScore(trajectoryId, score, source) → void

  // 查询复杂轨迹 (SkillSynthesizer 消费)
  findComplexUnprocessed(options) → trajectory[]
  // options: { minToolCount: 5, minScore: 0.7, limit: 10 }

  // 按模式搜索相似轨迹 (SkillImprover 消费)
  findSimilar(toolPattern, options) → trajectory[]

  // 清理过期轨迹 (默认保留 90 天)
  cleanup(retentionDays) → deletedCount
}
```

**复杂度判定**:

```javascript
function classifyComplexity(toolChain) {
  const count = toolChain.length;
  if (count <= 2) return "simple";
  if (count <= 5) return "moderate";
  return "complex"; // 5+ 工具调用 → 技能合成候选
}
```

**与现有模块的集成点**:

- **PostToolUse Hook** → `appendToolCall()` — 利用现有 `session-hooks.js` 的 PostToolUse 事件
- **agentLoop yield `response-complete`** → `completeTrajectory()` — 监听 agent-core 事件流
- **UserPromptSubmit Hook** → `startTrajectory()` — 利用已实现的会话级钩子

---

### 3.2 SkillSynthesizer — 自动技能合成

**职责**: 从成功的复杂执行轨迹中自动提取模式，生成 SKILL.md 文件。

**文件**: `packages/cli/src/lib/learning/skill-synthesizer.js`

**核心方法**:

```javascript
class SkillSynthesizer {
  constructor(db, llmChat, skillLoader) { ... }

  // 扫描未处理的高质量复杂轨迹，尝试合成技能
  // 由 ReflectionEngine 在会话结束或定时自省时调用
  async synthesize(options) → { created: skill[], skipped: string[] }

  // 从单条轨迹提取技能模板
  async extractPattern(trajectory) → skillDraft | null

  // 检查是否与已有技能重复
  async isDuplicate(skillDraft) → { isDuplicate: boolean, existingSkill?: string }

  // 生成 SKILL.md 内容
  async generateSkillMd(skillDraft) → string

  // 写入 workspace 层技能目录
  async persistSkill(name, content) → { skillDir, skillFile }
}
```

**合成触发条件** (全部满足才触发):

| 条件 | 阈值 | 说明 |
| --- | --- | --- |
| 工具调用数 | >= 5 | Hermes 同款阈值 |
| 结果评分 | >= 0.7 | 只从成功经验学习 |
| 未被合成过 | `synthesized_skill IS NULL` | 防重复 |
| 非一次性任务 | 至少 2 条相似轨迹 | 确保模式可复用 |

**LLM 提取模板** (发送给 Auxiliary LLM):

```markdown
你是一个技能提取专家。分析以下执行轨迹，提取可复用的工作流模式。

## 执行轨迹
用户意图: \{\{userIntent\}\}
工具调用链:
\{\{#each toolChain\}\}
  \{\{@index\}\}. \{\{tool\}\}(\{\{args\}\}) → \{\{status\}\} (\{\{durationMs\}\}ms)
\{\{/each\}\}
最终响应: \{\{finalResponse\}\}

## 要求
提取为以下结构:
1. **技能名称** (kebab-case, 简洁)
2. **描述** (一句话)
3. **步骤** (Procedure, 编号列表)
4. **常见陷阱** (Pitfalls, 从错误/重试中提取)
5. **验证方法** (Verification, 如何确认成功)
6. **所需工具** (tools 列表)

如果此轨迹不适合提取为技能 (过于特定、无可复用性)，回复 "NOT_APPLICABLE"。
```

**生成的 SKILL.md 格式**:

```yaml
---
name: \{\{extracted-name\}\}
description: \{\{extracted-description\}\}
version: 1.0.0
category: auto-learned
tags: [auto-synthesized, \{\{domain-tags\}\}]
metadata:
  source: trajectory
  trajectory_id: \{\{trajectoryId\}\}
  confidence: \{\{pattern-match-score\}\}
  created_by: learning-loop
tools: [\{\{tool-list\}\}]
---

## Procedure
\{\{extracted-steps\}\}

## Pitfalls
\{\{extracted-pitfalls\}\}

## Verification
\{\{extracted-verification\}\}
```

**去重策略**:

1. 按技能名模糊匹配 (Levenshtein distance < 3)
2. 按工具链指纹匹配 (工具名序列的 Set 交集 > 70%)
3. 命中已有技能 → 转交 SkillImprover 而非重复创建

---

### 3.3 SkillImprover — 技能持续改进

**职责**: 在技能使用过程中检测问题，自动 patch 技能内容。

**文件**: `packages/cli/src/lib/learning/skill-improver.js`

**数据库表**:

```sql
CREATE TABLE IF NOT EXISTS skill_improvement_log (
  skill_name TEXT NOT NULL,
  trigger_type TEXT NOT NULL,      -- "error_repair" | "user_correction" | "better_trajectory" | "reflection"
  detail TEXT,                     -- 改进详情 (JSON 或文本描述)
  created_at TEXT DEFAULT (datetime('now'))
);
```

**核心方法**:

```javascript
class SkillImprover {
  constructor(db, llmChat, skillLoader) { ... }

  // 技能执行失败后分析原因并尝试修复
  // 由 agent-core 的 ToolError hook 在 run_skill 失败时触发
  async repairFromError(skillName, error, trajectory) → { patched: boolean, changes: string[] }

  // 技能执行成功但用户纠正了做法 → 更新技能
  // 由 OutcomeFeedback 在检测到用户修正时触发
  async updateFromCorrection(skillName, correction, trajectory) → { patched: boolean }

  // 从更优轨迹更新技能步骤
  // 由 ReflectionEngine 在自省时调用
  async improveFromBetterTrajectory(skillName, oldTrajectory, betterTrajectory) → { patched: boolean }

  // 获取技能改进历史
  getImprovementHistory(skillName, options) → log[]

  // 内部: 读取 SKILL.md → LLM 生成 patch → 写回
  async _patchSkillMd(skillPath, patchInstructions) → { success, diff }
}
```

**三种改进触发方式**:

| 触发方式 | 时机 | 数据来源 |
| --- | --- | --- |
| 错误驱动修复 | `run_skill` 工具返回错误 | 错误信息 + 执行上下文 |
| 用户修正驱动 | 用户在 Agent 回复后纠正做法 | 用户消息 + 前一轮轨迹 |
| 对比改进 | 自省时发现新轨迹优于旧技能 | 两条轨迹的结果评分对比 |

**Patch 策略** (token 效率优先):

```javascript
// 优先 patch (只传变更部分)，其次 edit (替换整个 section)
async _patchSkillMd(skillPath, instructions) {
  const content = await fs.promises.readFile(skillPath, "utf-8");
  const sections = parseSkillSections(content);

  // LLM 生成 patch 指令
  const patch = await this.llmChat([{
    role: "system",
    content: `你是技能文档编辑器。根据以下改进指令，输出需要修改的部分。
    格式: { "section": "Procedure|Pitfalls|Verification", "action": "replace|append", "content": "..." }
    只输出变更部分，不要输出完整文档。`
  }, {
    role: "user",
    content: `当前技能:\n${content}\n\n改进指令:\n${instructions}`
  }]);

  // 应用 patch
  return applyPatch(content, patch);
}
```

**改进版本追踪**:

- SKILL.md 的 `version` 字段自动递增 (patch 版本: 1.0.0 → 1.0.1)
- `skill_improvement_log` 保留完整变更历史
- 未来扩展: 支持回滚到特定版本

---

### 3.4 OutcomeFeedback — 结果质量反馈

**职责**: 将工具执行结果与用户满意度关联，产生奖励信号回馈给 TrajectoryStore 和 Instinct。

**文件**: `packages/cli/src/lib/learning/outcome-feedback.js`

**核心方法**:

```javascript
class OutcomeFeedback {
  constructor(db, instinctManager, evolutionSystem) { ... }

  // 自动评分: 基于执行结果推断质量
  autoScore(trajectory) → score (0-1)

  // 用户显式反馈 (CLI: 回复 👍/👎 或 /feedback 命令)
  recordUserFeedback(trajectoryId, { rating, comment }) → void

  // 检测用户修正 (用户在 Agent 回复后立即修改同一文件/重做同一操作)
  detectCorrection(currentMessage, previousTrajectory) → { isCorrection: boolean, detail: string }

  // 将反馈信号传播到 Instinct 和 Evolution
  propagateFeedback(trajectoryId, score, source) → void
}
```

**自动评分规则**:

```javascript
function autoScore(trajectory) {
  let score = 0.5; // 基线

  const chain = trajectory.toolChain;
  const errorCount = chain.filter(t => t.status === "error").length;
  const totalCount = chain.length;

  // 无错误完成 → +0.2
  if (errorCount === 0) score += 0.2;

  // 错误率 > 50% → -0.3
  if (errorCount / totalCount > 0.5) score -= 0.3;

  // 有重试 (同一工具连续调用 2+ 次) → -0.1
  if (hasRetries(chain)) score -= 0.1;

  // 最终工具成功 → +0.1
  if (chain.at(-1)?.status === "completed") score += 0.1;

  // 用户后续未修正 (30 秒内无新输入) → +0.1
  // (此信号由 detectCorrection 提供)

  return Math.max(0, Math.min(1, score));
}
```

**用户修正检测**:

```javascript
function detectCorrection(currentMessage, previousTrajectory) {
  // 策略 1: 用户消息包含否定词 + 之前工具名
  const negationPatterns = [
    /不[是对]/, /错了/, /重[新做来]/, /别这样/, /not right/i, /wrong/i, /redo/i, /don't/i
  ];

  // 策略 2: 用户对同一文件再次请求编辑 (15 秒内)
  // 策略 3: 用户手动执行了 Agent 刚执行过的操作

  return { isCorrection, detail };
}
```

**反馈传播链路**:

```
OutcomeFeedback.propagateFeedback()
  ├── TrajectoryStore.setOutcomeScore(id, score, source)
  ├── InstinctManager.recordInstinct(category, pattern)
  │   └── 高分 → 记录工具偏好 (TOOL_PREFERENCE)
  │   └── 低分 → 记录避免模式 (WORKFLOW)
  └── EvolutionSystem.assessCapability(db, toolName, score)
      └── 更新工具维度能力评分 + 成长日志
```

---

### 3.5 ReflectionEngine — 周期性自省

**职责**: 定时回顾会话中的执行轨迹，触发技能合成/改进，持久化有价值的知识。

**文件**: `packages/cli/src/lib/learning/reflection-engine.js`

**核心方法**:

```javascript
class ReflectionEngine {
  constructor(db, trajectoryStore, skillSynthesizer, skillImprover, memoryManager) { ... }

  // 会话结束时触发 (SessionEnd 钩子)
  async onSessionEnd(sessionId) → reflectionReport

  // 定时触发 (可配置间隔, 默认 30 分钟)
  async periodicReflection() → reflectionReport

  // 内部: 回顾并决策
  async _reflect(trajectories) → {
    skillsCreated: string[],
    skillsImproved: string[],
    memoriesSaved: string[],
    instinctsRecorded: string[]
  }

  // 启动定时器
  startPeriodicReflection(intervalMs) → void

  // 停止定时器
  stopPeriodicReflection() → void
}
```

**自省流程**:

```
SessionEnd / PeriodicTimer
    ↓
收集本轮未处理的轨迹
    ↓
┌─ 复杂 + 高分轨迹 → SkillSynthesizer.synthesize()
│    └─ 与已有技能重复 → SkillImprover.improveFromBetterTrajectory()
│    └─ 全新模式 → 创建新技能
├─ 失败轨迹 → 分析失败原因 → 记录为 Pitfall
├─ 用户修正轨迹 → SkillImprover.updateFromCorrection()
└─ 有价值的上下文 → MemoryManager.addMemory()
    ↓
生成 ReflectionReport
    ↓
记录到 evolution_growth_log
```

**自省 LLM 提示** (发送给 Auxiliary LLM):

```markdown
回顾以下会话中的执行轨迹，判断:
1. 有哪些值得记住的事实/偏好？(→ 记忆)
2. 有哪些重复出现的工作流模式？(→ 技能)
3. 有哪些失败教训？(→ 陷阱)
4. 用户的工具偏好有什么变化？(→ 本能)

只报告非显而易见的发现。如果没有值得保存的内容，回复 "NOTHING_NOTABLE"。
```

---

## 4. 集成方案

### 4.1 Hook 接入点

本系统通过现有的 Hook 机制和事件流接入，**不修改 agent-core.js 核心逻辑**:

```javascript
// packages/cli/src/lib/learning/learning-hooks.js

import { HookEvents } from "../hook-manager.js";
import { fireSessionHook } from "../session-hooks.js";

/**
 * 注册学习闭环钩子 (在 agent-repl.js 初始化时调用)
 */
export function registerLearningHooks(hookDb, learningLoop) {
  // 1. UserPromptSubmit → 开始轨迹记录
  hookDb.registerInternalHook(HookEvents.UserPromptSubmit, async (ctx) => {
    learningLoop.trajectoryStore.startTrajectory(ctx.sessionId, ctx.prompt);
  });

  // 2. PostToolUse → 追加工具调用
  hookDb.registerInternalHook(HookEvents.PostToolUse, async (ctx) => {
    learningLoop.trajectoryStore.appendToolCall(
      learningLoop.currentTrajectoryId,
      { tool: ctx.tool, args: ctx.args, result: ctx.result, durationMs: ctx.durationMs, status: ctx.status }
    );
  });

  // 3. SessionEnd → 触发自省
  hookDb.registerInternalHook(HookEvents.SessionEnd, async (ctx) => {
    await learningLoop.reflectionEngine.onSessionEnd(ctx.sessionId);
  });
}
```

### 4.2 Agent Loop 事件接入

```javascript
// 在 agent-repl.js 的 agentLoop 消费循环中
for await (const event of agentLoop(messages, options)) {
  switch (event.type) {
    case "response-complete":
      // 完成当前轨迹
      learningLoop.trajectoryStore.completeTrajectory(
        learningLoop.currentTrajectoryId,
        { finalResponse: event.content, tags: extractTags(event.content) }
      );
      // 自动评分
      learningLoop.outcomeFeedback.autoScore(trajectory);
      break;
  }
}
```

### 4.3 CLI 命令接入

```bash
# 新增 learning 命令组 (5 个子命令)
chainlesschain learning stats              # 学习闭环统计概览
chainlesschain learning stats --json       # JSON 格式输出
chainlesschain learning trajectories       # 最近 20 条执行轨迹
chainlesschain learning trajectories -n 50 # 指定数量
chainlesschain learning trajectories --session <id>  # 按会话筛选
chainlesschain learning reflect            # 手动触发自省
chainlesschain learning synthesize         # 扫描并合成新技能
chainlesschain learning cleanup            # 清理 90 天前的旧轨迹
chainlesschain learning cleanup --days 30  # 自定义保留期
```

### 4.4 Desktop IPC 接入

```javascript
// desktop-app-vue/src/main/ai-engine/cowork/learning-ipc.js
// 注册 8 个 IPC Handler:
"learning:get-status"          // 闭环状态概览
"learning:get-trajectories"    // 轨迹列表 (分页)
"learning:get-trajectory"      // 单条轨迹详情
"learning:get-synthesized"     // 自动合成的技能列表
"learning:get-improvements"    // 技能改进日志
"learning:trigger-reflect"     // 手动触发自省
"learning:set-config"          // 更新配置
"learning:feedback"            // 用户反馈提交
```

---

## 5. 配置项

```javascript
// 默认配置 (可通过 .chainlesschain/config.json 覆盖)
const LEARNING_DEFAULTS = {
  enabled: true,                      // 总开关
  trajectory: {
    enabled: true,                    // 轨迹记录开关
    retentionDays: 90,                // 轨迹保留天数
    maxToolChainLength: 50,           // 单轨迹最大工具调用数
  },
  synthesis: {
    enabled: true,                    // 自动合成开关
    minToolCount: 5,                  // 最低工具调用数触发
    minOutcomeScore: 0.7,             // 最低质量分触发
    minSimilarTrajectories: 2,        // 最少相似轨迹数
    outputLayer: "workspace",         // 合成技能写入的层 (workspace/managed)
  },
  improvement: {
    enabled: true,                    // 自动改进开关
    maxPatchesPerSession: 3,          // 每会话最多 patch 次数
  },
  reflection: {
    enabled: true,                    // 自省开关
    intervalMs: 1800000,              // 定时自省间隔 (30 分钟)
    onSessionEnd: true,               // 会话结束时自省
    auxiliaryModel: null,             // 辅助 LLM (null = 使用当前模型)
  },
  feedback: {
    autoScore: true,                  // 自动评分
    correctionDetection: true,        // 用户修正检测
    correctionWindowMs: 15000,        // 修正检测时间窗口
  },
};
```

---

## 6. 数据流全景图

```
用户输入
  │
  ▼
[UserPromptSubmit Hook]
  │ TrajectoryStore.startTrajectory()
  ▼
Agent Loop (LLM + 工具调用)
  │
  ├─ [PostToolUse Hook] × N
  │   TrajectoryStore.appendToolCall()
  │   ToolTelemetry.record()           ← 现有
  │
  ├─ [ToolError Hook]
  │   SkillImprover.repairFromError()  ← 新增
  │
  ▼
[response-complete 事件]
  │ TrajectoryStore.completeTrajectory()
  │ OutcomeFeedback.autoScore()
  │   ├── score → TrajectoryStore
  │   ├── instinct → InstinctManager   ← 现有
  │   └── capability → EvolutionSystem ← 现有
  ▼
用户下一条消息
  │ OutcomeFeedback.detectCorrection()
  │   └── isCorrection → SkillImprover.updateFromCorrection()
  ▼
... (循环)
  │
  ▼
[SessionEnd Hook / 定时器]
  │ ReflectionEngine._reflect()
  │   ├── 复杂高分轨迹 → SkillSynthesizer.synthesize()
  │   │     └── 新技能写入 workspace 层
  │   ├── 失败轨迹 → 提取 Pitfall
  │   ├── 知识 → MemoryManager.addMemory()     ← 现有
  │   └── 成长日志 → EvolutionSystem.growthLog  ← 现有
  ▼
技能库更新 → 下次 Agent 会话可用
```

---

## 7. 实施计划

### Phase 1: 轨迹存储 (P0) — ✅ 完成, 77 tests

| 任务 | 文件 | 状态 |
| --- | --- | --- |
| TrajectoryStore 实现 | `src/lib/learning/trajectory-store.js` | ✅ 12 方法 |
| 数据库建表 | `src/lib/learning/learning-tables.js` | ✅ 3 表 + 3 索引 |
| Hook 接入 | `src/lib/learning/learning-hooks.js` | ✅ 4 钩子 + 工厂 |
| 单元测试 | `__tests__/unit/trajectory-store.test.js` | ✅ 50 tests |
| 单元测试 | `__tests__/unit/learning-hooks.test.js` | ✅ 22 tests |
| 单元测试 | `__tests__/unit/learning-tables.test.js` | ✅ 5 tests |

### Phase 2: 结果反馈 (P1) — ✅ 完成, 33 tests

| 任务 | 文件 | 状态 |
| --- | --- | --- |
| OutcomeFeedback 实现 | `src/lib/learning/outcome-feedback.js` | ✅ 3 信号源 |
| 自动评分 + 用户反馈 + 修正检测 | 同上 | ✅ 中英双语 |
| Instinct + Evolution 传播 | 同上 | ✅ 高分/低分自动传播 |
| 单元测试 | `__tests__/unit/outcome-feedback.test.js` | ✅ 33 tests |

### Phase 3: 技能合成与改进 (P2) — ✅ 完成, 60 tests

| 任务 | 文件 | 状态 |
| --- | --- | --- |
| SkillSynthesizer 实现 | `src/lib/learning/skill-synthesizer.js` | ✅ 6 helper + 类 |
| 去重策略 | 同上 | ✅ Jaccard 工具链指纹 (阈值 0.7) |
| SkillImprover 实现 | `src/lib/learning/skill-improver.js` | ✅ 3 触发器 + 扫描 |
| 单元测试 | `__tests__/unit/skill-synthesizer.test.js` | ✅ 32 tests |
| 单元测试 | `__tests__/unit/skill-improver.test.js` | ✅ 28 tests |

### Phase 4: 自省与集成 (P3) — ✅ 完成, 54 tests

| 任务 | 文件 | 状态 |
| --- | --- | --- |
| ReflectionEngine 实现 | `src/lib/learning/reflection-engine.js` | ✅ 统计 + LLM 分析 |
| learning 命令组 | `src/commands/learning.js` | ✅ 5 个子命令 |
| 集成测试 | `__tests__/integration/learning-integration.test.js` | ✅ 10 tests |
| E2E 测试 | `__tests__/e2e/learning-commands.test.js` | ✅ 17 tests |
| 单元测试 | `__tests__/unit/reflection-engine.test.js` | ✅ 27 tests |

---

## 8. 测试策略

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

**测试原则**:
- LLM 调用全部 mock — 测试逻辑而非 LLM 输出质量
- 使用 MockDatabase (内存 SQLite mock) 实现隔离
- `_deps` 注入模式用于 FS/LLM 等外部依赖
- 浮点精度使用 `toBeCloseTo()` 而非严格相等

---

## 9. 已知局限与缓解措施

| 局限 | 来源 | 缓解 |
| --- | --- | --- |
| 自评偏差 — Agent 评估自己的输出质量 | Hermes 同款问题 | 用户反馈覆盖自动评分；修正检测提供负信号 |
| 无版本回滚 | Hermes 同款问题 | `skill_improvement_log` 记录旧内容，可手动恢复 |
| LLM 模式提取质量不稳定 | 依赖 LLM 理解力 | `minSimilarTrajectories: 2` 确保模式可复用 |
| Token 成本 | 每次自省需 LLM 调用 | 使用 QUICK 类别模型；合并多条轨迹一次分析 |
| 过期技能累积 | 自动生成可能产生低质量技能 | 定期 decay (类似 Instinct)；手动 `skill remove` |

---

## 10. 与 Hermes Agent 的对比

| 维度 | Hermes Agent | ChainlessChain (本设计) |
| --- | --- | --- |
| 合成触发 | 5+ tool calls + 成功 | 5+ tool calls + score >= 0.7 + 2+ 相似轨迹 |
| 改进方式 | skill_manage patch/edit | LLM 生成 patch + section 替换 |
| 自省机制 | nudge_interval 定时 | SessionEnd Hook + 30min 定时器 |
| 评分来源 | Agent 自评 (无外部验证) | 自动评分 + 用户反馈 + 修正检测 (三信号源) |
| 技能格式 | SKILL.md (Procedure/Pitfalls/Verification) | 同款格式，兼容现有 4 层 skill-loader |
| 渐进加载 | 3 级 (名称 → 全文 → 引用) | 现有 parseMetadataOnly + ensureFullyLoaded |
| 版本管理 | 无 (in-place) | improvement_log 记录历史 (可恢复) |
| 去重 | 无 | Levenshtein + 工具链指纹 |
| 记忆集成 | MEMORY.md + USER.md | 现有 hierarchical-memory + permanent-memory |
| 本能集成 | 无 | 直接连接 instinct-manager (偏好传播) |

---

## 11. 核心文件清单

| 文件路径 | 说明 | Phase | 状态 |
| --- | --- | --- | --- |
| `src/lib/learning/learning-tables.js` | 数据库建表 (3 表 + 3 索引) | P0 | ✅ |
| `src/lib/learning/trajectory-store.js` | 执行轨迹存储 (12 方法) | P0 | ✅ |
| `src/lib/learning/learning-hooks.js` | Hook 注册 (4 钩子 + 工厂) | P0 | ✅ |
| `src/lib/learning/outcome-feedback.js` | 结果质量反馈 (3 信号源) | P1 | ✅ |
| `src/lib/learning/skill-synthesizer.js` | 自动技能合成 (6 helper + 类) | P2 | ✅ |
| `src/lib/learning/skill-improver.js` | 技能持续改进 (3 触发器 + 扫描) | P2 | ✅ |
| `src/lib/learning/reflection-engine.js` | 周期性自省 (统计 + LLM 分析) | P3 | ✅ |
| `src/commands/learning.js` | CLI 命令组 (5 子命令) | P3 | ✅ |

> 所有文件路径相对于 `packages/cli/`

---

**维护者**: 开发团队
**最后更新**: 2026-04-12 — P0-P3 全部完成
