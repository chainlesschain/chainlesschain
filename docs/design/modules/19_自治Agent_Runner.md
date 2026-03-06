# 自治 Agent Runner

## 模块概述

**版本**: v1.0.0
**状态**: ✅ 已实现
**IPC处理器**: 18个
**最后更新**: 2026-03-05

基于 ReAct (Reason-Act-Observe) 循环的自治代理执行系统。支持目标分解、多步骤自动执行、用户交互、任务队列和执行状态管理。

### 核心特性

- **ReAct 循环**: 推理→行动→观察的自治执行模式
- **目标分解**: LLM 驱动的自动任务分解
- **6 种动作类型**: skill, tool, search, file, ask_user, complete
- **任务队列**: 优先级队列管理并发目标
- **用户交互**: 执行过程中可请求用户输入
- **自动重规划**: 步骤失败时 LLM 驱动的重新规划
- **Token 预算**: 可配置的每目标 Token 上限

---

## 1. 架构设计

### 1.1 整体架构图

```
┌──────────────────────────────────────────────────────────────────┐
│                        前端 (Vue3)                                │
├──────────────────────────────────────────────────────────────────┤
│           Pinia Store: autonomous-agent.ts (986行)                │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────────────┐   │
│  │ 目标管理  │ │ 步骤查看  │ │ 配置面板  │ │ 用户输入/日志     │   │
│  └──────────┘ └──────────┘ └──────────┘ └───────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
                              ↕ IPC (18个通道 + 9个事件)
┌──────────────────────────────────────────────────────────────────┐
│                        主进程 (Electron)                          │
├──────────────────────────────────────────────────────────────────┤
│                   autonomous-ipc.js (489行)                       │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  AutonomousAgentRunner (2,072行, extends EventEmitter)      │  │
│  │  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐  │  │
│  │  │ ReAct Loop   │  │ Goal Decomp  │  │ Replan Engine    │  │  │
│  │  │ Reason→Act   │  │ LLM 目标分解  │  │ 失败重规划       │  │  │
│  │  │ →Observe     │  │              │  │                  │  │  │
│  │  └─────────────┘  └──────────────┘  └──────────────────┘  │  │
│  │  ┌─────────────┐  ┌──────────────┐                        │  │
│  │  │ Skill/Tool  │  │ Permissions  │                        │  │
│  │  │ Executors   │  │ Check        │                        │  │
│  │  └─────────────┘  └──────────────┘                        │  │
│  └────────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  AgentTaskQueue (550行)          │  SQLite Database         │  │
│  │  优先级队列 + 并发控制             │  4 tables               │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

### 1.2 ReAct 循环

```
submitGoal(goalSpec)
    ↓ LLM 目标分解
Plan: { steps: [...], strategy }
    ↓
┌────────────────────────────────────┐
│ while (RUNNING && step < maxSteps) │
│                                    │
│  ┌──────────────────────────┐      │
│  │ REASON: _reason(goalId)  │      │
│  │ - 构建上下文 (最近10步)    │      │
│  │ - LLM 推理下一步动作      │      │
│  │ → { thought, action }    │      │
│  └──────────────────────────┘      │
│           ↓                        │
│  complete? → _completeGoal()       │
│           ↓ (否)                   │
│  ┌──────────────────────────┐      │
│  │ ACT: _act(goalId, action)│      │
│  │ - 权限检查                │      │
│  │ - 120s 超时              │      │
│  │ - 执行 skill/tool/...    │      │
│  │ → { success, output }    │      │
│  └──────────────────────────┘      │
│           ↓                        │
│  ┌──────────────────────────┐      │
│  │ OBSERVE: _observe()      │      │
│  │ - 记录步骤到DB           │      │
│  │ - 更新Token/步数         │      │
│  │ - 发送 goal-progress     │      │
│  └──────────────────────────┘      │
│           ↓                        │
│  Checkpoint → Sleep → 检查暂停/输入 │
└────────────────────────────────────┘
```

### 1.3 核心组件

| 组件                  | 文件                         | 行数  | 说明           |
| --------------------- | ---------------------------- | ----- | -------------- |
| AutonomousAgentRunner | `autonomous-agent-runner.js` | 2,072 | ReAct执行引擎  |
| AgentTaskQueue        | `agent-task-queue.js`        | 550   | 优先级任务队列 |
| AutonomousIPC         | `autonomous-ipc.js`          | 489   | 18个IPC处理器  |
| Pinia Store           | `autonomous-agent.ts`        | 986   | 前端状态管理   |

---

## 2. 核心模块

### 2.1 AutonomousAgentRunner

```javascript
class AutonomousAgentRunner extends EventEmitter {
  // 目标管理
  async submitGoal(goalSpec)          // 提交目标 (分解+入队)
  async pauseGoal(goalId)             // 暂停执行
  async resumeGoal(goalId)            // 恢复执行
  async cancelGoal(goalId)            // 取消目标
  async retryGoal(goalId)             // 重试失败目标

  // 用户交互
  async requestUserInput(goalId, question, options)
  async provideUserInput(goalId, input)

  // 查询
  async getGoalStatus(goalId)
  async getActiveGoals()
  async getGoalHistory(limit?, offset?)
  async getGoalSteps(goalId)
  async getGoalLogs(goalId, limit?)
  async getStats()
  async exportGoal(goalId)

  // 配置
  updateConfig(config)
  getConfig()
  async clearHistory(before?)
}
```

**配置**:

```javascript
DEFAULT_CONFIG = {
  maxStepsPerGoal: 100, // 每目标最大步数
  stepTimeoutMs: 120000, // 步骤超时 (2分钟)
  maxConcurrentGoals: 3, // 最大并发目标
  tokenBudgetPerGoal: 50000, // Token预算
  evaluationIntervalMs: 1000, // 评估间隔
  maxRetriesPerStep: 3, // 步骤重试次数
  maxReplanAttempts: 3, // 重规划次数
};
```

### 2.2 AgentTaskQueue

```javascript
class AgentTaskQueue extends EventEmitter {
  async enqueue(task)             // 入队 (按优先级排序)
  async dequeue()                 // 出队 (最高优先级)
  async remove(goalId)            // 移除
  async markComplete(goalId)      // 标记完成
  async getQueueStatus()          // 队列状态
  async updatePriority(goalId, newPriority) // 更新优先级
  async clear()                   // 清空队列
}
```

### 2.3 动作类型

| 类型       | 执行器              | 说明                   |
| ---------- | ------------------- | ---------------------- |
| `skill`    | `_executeSkill()`   | 调用 SkillExecutor     |
| `tool`     | `_executeTool()`    | 调用 ToolRegistry 工具 |
| `search`   | `_executeSearch()`  | 搜索工具               |
| `file`     | `_executeFileOp()`  | 文件读写操作           |
| `ask_user` | `_executeAskUser()` | 请求用户输入           |
| `complete` | 直接返回            | 标记目标完成           |

### 2.4 权限类别

```javascript
TOOL_PERMISSION_CATEGORIES = {
  skills: "skills", // 技能执行
  "file-ops": "file-ops", // 文件操作
  browser: "browser", // 浏览器自动化
  network: "network", // 网络请求
};
```

---

## 3. 数据模型

### 3.1 autonomous_goals

| 字段             | 类型       | 说明                                                                  |
| ---------------- | ---------- | --------------------------------------------------------------------- |
| id               | TEXT PK    | 目标ID                                                                |
| description      | TEXT       | 目标描述                                                              |
| priority         | INTEGER    | 优先级 (默认5)                                                        |
| status           | TEXT       | 状态 (queued/running/paused/waiting_input/completed/failed/cancelled) |
| tool_permissions | TEXT(JSON) | 工具权限列表                                                          |
| context          | TEXT(JSON) | 上下文信息                                                            |
| plan             | TEXT(JSON) | 分解计划 { steps, strategy }                                          |
| result           | TEXT       | 执行结果                                                              |
| step_count       | INTEGER    | 已执行步数                                                            |
| tokens_used      | INTEGER    | 已使用Token                                                           |
| error_message    | TEXT       | 错误信息                                                              |
| created_at       | TEXT       | 创建时间                                                              |
| completed_at     | TEXT       | 完成时间                                                              |

### 3.2 autonomous_goal_steps

| 字段          | 类型       | 说明                      |
| ------------- | ---------- | ------------------------- |
| id            | TEXT PK    | 步骤ID                    |
| goal_id       | TEXT FK    | 目标ID                    |
| step_number   | INTEGER    | 步骤序号                  |
| phase         | TEXT       | 阶段 (reason/act/observe) |
| thought       | TEXT       | 推理思路                  |
| action_type   | TEXT       | 动作类型                  |
| action_params | TEXT(JSON) | 动作参数                  |
| result        | TEXT       | 执行结果                  |
| success       | INTEGER    | 是否成功                  |
| tokens_used   | INTEGER    | Token消耗                 |
| duration_ms   | INTEGER    | 耗时                      |

### 3.3 autonomous_goal_logs

| 字段       | 类型       | 说明                   |
| ---------- | ---------- | ---------------------- |
| id         | INTEGER PK | 日志ID                 |
| goal_id    | TEXT FK    | 目标ID                 |
| level      | TEXT       | 级别 (info/warn/error) |
| type       | TEXT       | 类型                   |
| content    | TEXT       | 内容                   |
| created_at | TEXT       | 创建时间               |

### 3.4 autonomous_task_queue

| 字段        | 类型    | 说明                            |
| ----------- | ------- | ------------------------------- |
| id          | TEXT PK | 队列项ID                        |
| goal_id     | TEXT    | 目标ID                          |
| priority    | INTEGER | 优先级                          |
| description | TEXT    | 描述                            |
| status      | TEXT    | 状态 (queued/started/completed) |
| created_at  | TEXT    | 创建时间                        |

---

## 4. IPC接口 (18个)

### 4.1 目标管理 (6个)

| 通道                  | 说明         | 参数                                                           |
| --------------------- | ------------ | -------------------------------------------------------------- |
| `agent:submit-goal`   | 提交目标     | goalSpec: { description, priority, toolPermissions, context? } |
| `agent:pause-goal`    | 暂停目标     | goalId                                                         |
| `agent:resume-goal`   | 恢复目标     | goalId                                                         |
| `agent:cancel-goal`   | 取消目标     | goalId                                                         |
| `agent:provide-input` | 提供用户输入 | goalId, input                                                  |
| `agent:batch-cancel`  | 批量取消     | goalIds[]                                                      |

### 4.2 查询 (7个)

| 通道                     | 说明         | 参数            |
| ------------------------ | ------------ | --------------- |
| `agent:get-goal-status`  | 目标状态     | goalId          |
| `agent:get-active-goals` | 活跃目标列表 | -               |
| `agent:get-goal-history` | 历史目标     | limit?, offset? |
| `agent:get-goal-steps`   | 目标步骤     | goalId          |
| `agent:get-goal-logs`    | 目标日志     | goalId, limit?  |
| `agent:get-queue-status` | 队列状态     | -               |
| `agent:get-stats`        | 统计信息     | -               |

### 4.3 配置/工具 (5个)

| 通道                  | 说明     | 参数    |
| --------------------- | -------- | ------- |
| `agent:update-config` | 更新配置 | config  |
| `agent:get-config`    | 获取配置 | -       |
| `agent:clear-history` | 清除历史 | before? |
| `agent:export-goal`   | 导出目标 | goalId  |
| `agent:retry-goal`    | 重试目标 | goalId  |

---

## 5. 文件结构

```
desktop-app-vue/src/main/ai-engine/autonomous/
├── autonomous-agent-runner.js  # ReAct执行引擎 (2,072行)
├── agent-task-queue.js         # 优先级任务队列 (550行)
└── autonomous-ipc.js           # 18个IPC处理器 (489行)

desktop-app-vue/src/renderer/
└── stores/autonomous-agent.ts  # 自治代理状态管理 (986行)
```

---

## 6. 相关文档

- [多代理系统](13_多代理系统.md)
- [AI技能系统](16_AI技能系统.md)
- [AI优化系统](06_AI优化系统.md)

---

**文档版本**: 1.0
**最后更新**: 2026-03-05
