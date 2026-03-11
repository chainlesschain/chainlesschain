# 自主开发者

> **Phase 63 | v3.0.0 | 5 IPC 处理器 | 2 张新数据库表**

## 核心特性

- 💬 **意图理解**: 多轮对话（最多 20 轮）逐步提炼业务需求，生成 PRD 文档
- 🏗️ **架构决策**: 基于历史决策库自动选型，记录完整决策上下文与理由
- 💻 **全栈代码生成**: 符合项目风格的端到端代码产出
- 🔍 **四维自审**: 安全/性能/可维护性/正确性多维度代码审查
- 📋 **会话管理**: 完整的开发会话生命周期与状态跟踪

## 系统架构

```
┌──────────────────────────────────────────────────┐
│              自主开发者 (Phase 63)                  │
├──────────────────────────────────────────────────┤
│                                                    │
│  INTENT → PRD → ARCHITECTURE → GENERATING →       │
│                          REVIEWING → COMPLETE      │
│                                                    │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐   │
│  │ Intent   │  │Architecture│ │ Code         │   │
│  │ Refiner  │  │ Decision  │  │ Generator    │   │
│  │ (需求细化)│  │ Engine    │  │ (全栈生成)   │   │
│  └────┬─────┘  └────┬─────┘  └──────┬────────┘   │
│       │              │               │             │
│  ┌────▼──────────────▼───────────────▼─────────┐  │
│  │          Code Review Engine                 │  │
│  │  SECURITY | PERFORMANCE | MAINTAINABILITY   │  │
│  │                CORRECTNESS                  │  │
│  └─────────────────┬──────────────────────────┘  │
│                    │                               │
│  ┌─────────────────▼──────────────────────────┐   │
│  │  SQLite: dev_sessions | architecture_decisions │
│  └────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────┘
```

## 概述

Phase 63 实现端到端的自主开发流程，从用户业务意图出发，AI 自主完成需求理解、架构决策、代码生成和自我审查的完整开发循环。

**核心目标**:

- **意图理解**: 多轮对话逐步提炼业务需求，生成 PRD
- **架构决策**: 基于历史决策库自动选型，记录决策上下文
- **代码生成**: 符合项目风格的全栈代码生成
- **自我审查**: 安全/性能/可维护性/正确性多维度审查

---

## 开发会话流程

```
INTENT → PRD → ARCHITECTURE → GENERATING → REVIEWING → COMPLETE
  │        │         │             │            │           │
 用户描述  多轮细化   决策记录     代码产出     质量评审    交付
 业务意图  需求文档   技术选型     全栈代码     4维打分     完成
```

---

## 核心功能

### 1. 启动开发会话

```javascript
const session = await window.electronAPI.invoke('autonomous-dev:start-session', {
  title: '用户注册模块',
  intent: '需要一个支持邮箱/手机号注册的用户模块，包含验证码验证和密码强度检查'
});

console.log(session);
// {
//   id: 'dev-001',
//   title: '用户注册模块',
//   intent: '...',
//   status: 'INTENT',
//   turnCount: 0
// }
```

### 2. 多轮需求细化

```javascript
// 最多 20 轮细化对话
const refined = await window.electronAPI.invoke('autonomous-dev:refine', {
  sessionId: 'dev-001',
  feedback: '还需要支持第三方 OAuth 登录（Google/GitHub），注册后自动创建 DID'
});

// refined.prd: {
//   features: ['邮箱注册', '手机号注册', 'OAuth 登录', 'DID 创建'],
//   acceptanceCriteria: [...],
//   nonFunctional: ['注册响应 < 2s', '密码 bcrypt 加密']
// }
```

### 3. 代码生成

```javascript
// 自动进行架构决策 → 代码生成 → 自我审查
const result = await window.electronAPI.invoke('autonomous-dev:generate', {
  sessionId: 'dev-001'
});

// result.architecture: { decisions: [{ type: 'BACKEND', title: '使用 Express + JWT', ... }] }
// result.generatedCode: { files: ['routes/auth.js', 'middleware/auth.js', ...] }
// result.reviewResult: 初始自审结果
```

### 4. 代码审查

```javascript
const review = await window.electronAPI.invoke('autonomous-dev:review', {
  sessionId: 'dev-001'
});

console.log(review);
// {
//   overall: 0.85,
//   checks: {
//     SECURITY: { score: 0.9, findings: ['输入验证完整', 'CSRF 令牌已添加'] },
//     PERFORMANCE: { score: 0.85, findings: ['数据库查询已优化'] },
//     MAINTAINABILITY: { score: 0.8, findings: ['建议拆分 auth 中间件'] },
//     CORRECTNESS: { score: 0.88, findings: ['边界条件已覆盖'] }
//   }
// }
```

### 5. 会话列表

```javascript
const sessions = await window.electronAPI.invoke('autonomous-dev:list-sessions', {
  filter: { status: 'COMPLETE' }
});
```

---

## 审查维度

| 维度                | 检查项                               | 权重 |
| ------------------- | ------------------------------------ | ---- |
| **SECURITY**        | 输入验证、注入防护、认证/授权、加密  | 25%  |
| **PERFORMANCE**     | 查询优化、缓存策略、内存使用         | 25%  |
| **MAINTAINABILITY** | 代码结构、命名规范、注释、模块化     | 25%  |
| **CORRECTNESS**     | 边界条件、错误处理、类型安全         | 25%  |

---

## IPC 通道

| 通道                            | 参数                         | 返回值       |
| ------------------------------- | ---------------------------- | ------------ |
| `autonomous-dev:start-session`  | `{ title, intent }`         | 会话对象     |
| `autonomous-dev:refine`         | `{ sessionId, feedback }`   | 细化结果     |
| `autonomous-dev:generate`       | `{ sessionId }`             | 代码生成结果 |
| `autonomous-dev:review`         | `{ sessionId }`             | 审查报告     |
| `autonomous-dev:list-sessions`  | `{ filter? }`               | 会话列表     |

---

## 数据库表

### dev_sessions

| 字段           | 类型    | 说明                                     |
| -------------- | ------- | ---------------------------------------- |
| id             | TEXT PK | 会话 ID                                 |
| title          | TEXT    | 开发任务标题                             |
| intent         | TEXT    | 用户业务意图                             |
| prd            | JSON    | 产品需求文档                             |
| architecture   | JSON    | 架构决策                                 |
| generated_code | JSON    | 生成的代码文件                           |
| review_result  | JSON    | 审查结果                                 |
| status         | TEXT    | INTENT/PRD/ARCHITECTURE/.../COMPLETE     |
| turn_count     | INTEGER | 细化对话轮数（最多 20）                  |
| created_at     | INTEGER | 创建时间                                 |
| updated_at     | INTEGER | 更新时间                                 |

### architecture_decisions

| 字段          | 类型    | 说明                         |
| ------------- | ------- | ---------------------------- |
| id            | TEXT PK | 决策 ID                     |
| session_id    | TEXT FK | 关联会话 ID                 |
| decision_type | TEXT    | 决策类型                     |
| title         | TEXT    | 决策标题                     |
| context       | TEXT    | 决策上下文                   |
| options       | JSON    | 候选方案                     |
| chosen_option | TEXT    | 选定方案                     |
| rationale     | TEXT    | 选择理由                     |
| confidence    | REAL    | 置信度                       |
| created_at    | INTEGER | 创建时间                     |

---

## 关键文件

| 文件 | 职责 |
| --- | --- |
| `desktop-app-vue/src/main/ai-engine/autonomous/autonomous-developer.js` | 自主开发者核心引擎 |
| `desktop-app-vue/src/main/ai-engine/autonomous/intent-refiner.js` | 多轮意图理解与 PRD 生成 |
| `desktop-app-vue/src/main/ai-engine/autonomous/architecture-decision.js` | 架构决策引擎 |
| `desktop-app-vue/src/main/ai-engine/autonomous/code-reviewer.js` | 四维代码审查 |
| `desktop-app-vue/src/main/ai-engine/autonomous/autonomous-dev-ipc.js` | 自主开发 IPC 处理器 |

## 相关文档

- [自主技术学习](/chainlesschain/tech-learning)
- [协作治理](/chainlesschain/collaboration-governance)
- [流水线编排](/chainlesschain/pipeline)
- [自然语言编程](/chainlesschain/nl-programming)
