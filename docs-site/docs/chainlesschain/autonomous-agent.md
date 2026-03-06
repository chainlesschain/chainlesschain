# 自治 Agent Runner

> **版本: v1.0.0+ | ReAct 循环 | 目标分解 | 自主任务执行**

自治 Agent Runner 是一个基于 ReAct (Reason-Act-Observe) 循环的自主任务执行引擎，能够将复杂目标分解为可执行步骤并自主完成。

## 系统概述

### ReAct 循环

```
        ┌─────────────┐
        │   接收目标    │
        └──────┬──────┘
               ▼
        ┌─────────────┐
   ┌───→│   Reason     │ ← 分析当前状态，决定下一步
   │    │   (推理)      │
   │    └──────┬──────┘
   │           ▼
   │    ┌─────────────┐
   │    │    Act       │ ← 执行动作（调用工具/技能）
   │    │   (行动)      │
   │    └──────┬──────┘
   │           ▼
   │    ┌─────────────┐
   │    │   Observe    │ ← 观察结果，评估进度
   │    │   (观察)      │
   │    └──────┬──────┘
   │           │
   │     目标完成？
   │     ├─ 否 ──→ ┘ (继续循环)
   │     └─ 是
   │           ▼
   │    ┌─────────────┐
   │    │  Complete    │
   │    │  (完成)      │
   │    └─────────────┘
   │
   └── 异常？→ 自我修正 / 重新规划
```

### 核心特性

- **目标分解**: 将复杂目标自动拆分为可执行步骤
- **自主执行**: 无需人工干预即可完成多步骤任务
- **并发执行**: 支持同时处理最多 3 个目标
- **暂停/恢复**: 随时暂停执行，恢复后继续
- **用户输入**: 遇到不确定情况主动请求用户确认
- **自我修正**: 步骤失败时自动重试或重新规划
- **检查点**: 定期保存执行状态，支持故障恢复

---

## 目标生命周期

```
queued → running → completed
                 → failed
         ├→ paused → running
         └→ waiting_input → running
```

| 状态            | 说明             |
| --------------- | ---------------- |
| `queued`        | 已创建，等待执行 |
| `running`       | 正在执行中       |
| `paused`        | 用户暂停         |
| `waiting_input` | 等待用户输入     |
| `completed`     | 执行完成         |
| `failed`        | 执行失败         |

---

## 动作类型

Agent 在执行过程中可使用以下动作：

| 动作类型   | 说明              | 示例                         |
| ---------- | ----------------- | ---------------------------- |
| `skill`    | 调用内置技能      | `/code-review`, `/unit-test` |
| `tool`     | 调用注册工具      | 文件读写、搜索、计算         |
| `search`   | 搜索知识库/代码库 | RAG 检索、代码搜索           |
| `file`     | 文件操作          | 创建、编辑、删除文件         |
| `ask_user` | 请求用户输入      | 确认方案、提供信息           |
| `complete` | 标记目标完成      | 提交最终结果                 |

---

## 配置参数

```json
{
  "autonomousAgent": {
    "maxStepsPerGoal": 100,
    "stepTimeoutMs": 120000,
    "maxConcurrentGoals": 3,
    "tokenBudgetPerGoal": 50000,
    "evaluationIntervalMs": 1000,
    "maxRetriesPerStep": 3,
    "maxReplanAttempts": 3
  }
}
```

| 参数                   | 默认值          | 说明                  |
| ---------------------- | --------------- | --------------------- |
| `maxStepsPerGoal`      | 100             | 每个目标最大执行步数  |
| `stepTimeoutMs`        | 120,000 (2分钟) | 单步执行超时          |
| `maxConcurrentGoals`   | 3               | 最大并发目标数        |
| `tokenBudgetPerGoal`   | 50,000          | 每个目标的 Token 预算 |
| `evaluationIntervalMs` | 1,000 (1秒)     | 进度评估间隔          |
| `maxRetriesPerStep`    | 3               | 单步最大重试次数      |
| `maxReplanAttempts`    | 3               | 最大重新规划次数      |

---

## 使用示例

### 创建自治目标

```
用户: "帮我重构 user-service 模块，提升代码质量"

Agent 分解:
  Step 1: 搜索并阅读 user-service 所有源文件
  Step 2: 分析代码结构，识别问题
  Step 3: 制定重构方案（请求用户确认）
  Step 4: 逐文件执行重构
  Step 5: 运行测试确保功能正常
  Step 6: 生成重构报告
```

### 暂停与恢复

```
执行中 → 用户点击"暂停"
  → 保存当前检查点
  → 状态变为 paused

用户点击"恢复"
  → 加载检查点
  → 从上次断点继续执行
```

### 自我修正

```
Step 4 执行失败（测试不通过）
  → 观察错误信息
  → 分析失败原因
  → 调整方案（重新规划）
  → 重新执行 Step 4
  → 最多重试 3 次
  → 仍然失败 → 请求用户帮助
```

---

## 数据库表

### `autonomous_goals`

| 字段              | 类型     | 说明         |
| ----------------- | -------- | ------------ |
| `id`              | TEXT     | 目标 ID      |
| `description`     | TEXT     | 目标描述     |
| `status`          | TEXT     | 生命周期状态 |
| `steps_total`     | INTEGER  | 总步数       |
| `steps_completed` | INTEGER  | 已完成步数   |
| `created_at`      | DATETIME | 创建时间     |
| `completed_at`    | DATETIME | 完成时间     |

### `autonomous_steps`

| 字段          | 类型 | 说明             |
| ------------- | ---- | ---------------- |
| `id`          | TEXT | 步骤 ID          |
| `goal_id`     | TEXT | 所属目标 ID      |
| `action_type` | TEXT | 动作类型         |
| `description` | TEXT | 步骤描述         |
| `status`      | TEXT | 执行状态         |
| `result`      | TEXT | 执行结果（JSON） |
| `error`       | TEXT | 错误信息         |

---

## 关键文件

| 文件                                                       | 职责                |
| ---------------------------------------------------------- | ------------------- |
| `src/main/ai-engine/autonomous/autonomous-agent-runner.js` | 自治 Agent 核心引擎 |
| `src/renderer/stores/autonomous.ts`                        | 自治 Agent 状态管理 |
