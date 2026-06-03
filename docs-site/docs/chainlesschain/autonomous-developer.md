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

## 使用示例

### 完整开发流程

1. 打开「自主开发者」页面，点击「新建会话」
2. 输入标题和业务意图描述（如"实现用户注册模块"）
3. AI 进入多轮需求细化阶段，根据提问补充细节（最多 20 轮）
4. 确认 PRD 后，AI 自动进行架构决策和代码生成
5. 查看四维审查报告（安全/性能/可维护性/正确性），关注低分项
6. 审查通过后，代码文件可直接导出到项目目录

### 查看历史会话

1. 在会话列表中筛选状态（INTENT / COMPLETE 等）
2. 点击会话查看完整的 PRD、架构决策和生成代码
3. 可基于已完成会话的架构决策指导新项目开发

### 利用架构决策库

1. 查看 `architecture_decisions` 表中的历史决策
2. AI 自动参考相似场景的历史选型方案
3. 置信度高的决策可直接复用，降低重复决策成本

## 配置参考

在 `.chainlesschain/config.json` 中配置：

```json
{
  "autonomousDeveloper": {
    "enabled": true,
    "maxRefineTurns": 20,
    "reviewDimensions": ["SECURITY", "PERFORMANCE", "MAINTAINABILITY", "CORRECTNESS"],
    "reviewPassThreshold": 0.75,
    "architectureDecisionHistory": true,
    "codeStyle": {
      "autoDetect": true,
      "lintOnGenerate": true
    },
    "llm": {
      "intentRefiner": "deep",
      "codeGenerator": "deep",
      "codeReviewer": "reasoning"
    }
  }
}
```

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `maxRefineTurns` | 20 | 多轮需求细化最大对话轮数 |
| `reviewPassThreshold` | 0.75 | 四维审查通过最低总分 |
| `architectureDecisionHistory` | true | 是否持久化架构决策供后续会话参考 |
| `codeStyle.autoDetect` | true | 自动检测项目编码规范 |
| `llm.codeGenerator` | `"deep"` | 代码生成使用的 LLM 类别（Category Routing） |
| `llm.codeReviewer` | `"reasoning"` | 代码审查使用的 LLM 类别 |

---

## 性能指标

| 操作 | 目标 | 实际 | 状态 |
| --- | --- | --- | --- |
| 会话启动 | < 500ms | ~200ms | ✅ |
| 单轮需求细化 | < 10s | ~5-8s | ✅ |
| 架构决策生成 | < 15s | ~10s | ✅ |
| 全栈代码生成（中等规模） | < 60s | ~40s | ✅ |
| 四维代码审查 | < 30s | ~20s | ✅ |
| 会话列表查询 | < 100ms | ~30ms | ✅ |
| 架构决策历史检索 | < 200ms | ~80ms | ✅ |

---

## 测试覆盖率

| 文件 | 类型 | 测试数 |
| --- | --- | --- |
| ✅ `autonomous-developer.test.js` | 单元 | 28 |
| ✅ `intent-refiner.test.js` | 单元 | 22 |
| ✅ `architecture-decision.test.js` | 单元 | 18 |
| ✅ `code-reviewer.test.js` | 单元 | 24 |
| ✅ `autonomous-dev-ipc.test.js` | 集成 | 15 |
| **合计** | | **107** |

---

## 故障排查

| 问题 | 可能原因 | 解决方案 |
| --- | --- | --- |
| 会话启动失败 | 数据库表未初始化 | 重启应用触发自动建表，检查 `dev_sessions` 表 |
| 需求细化无响应 | LLM 服务不可用或上下文过长 | 确认 Ollama 运行中，减少单次描述长度 |
| 代码生成质量低 | 项目风格分析未完成 | 先运行技术栈检测，确保 AI 了解项目规范 |
| 审查分数全为 0 | 未生成代码即触发审查 | 确保会话状态为 GENERATING 后再调用审查 |
| 架构决策不合理 | 历史决策库为空 | 积累更多会话数据后决策质量会逐步提升 |
| 会话状态卡在 PRD | 多轮细化达到 20 轮上限 | 手动跳过细化阶段，直接触发代码生成 |

## 安全考虑

- **代码审查强制化**: 所有生成代码必须经过四维安全审查才能标记为 COMPLETE
- **注入防护检查**: SECURITY 维度自动检测 SQL 注入、XSS、CSRF 等常见漏洞
- **架构决策审计**: 所有架构决策记录完整上下文和理由，支持事后审计回溯
- **会话隔离**: 每个开发会话独立运行，不共享敏感上下文信息
- **输入验证**: 用户输入的业务意图经过清洗，防止 Prompt 注入攻击
- **代码沙箱**: 生成的代码不自动执行，需用户确认后手动集成到项目
- **数据本地化**: 所有会话数据和生成代码仅存储在本地数据库中

## 相关文档

- [自主技术学习](/chainlesschain/tech-learning)
- [协作治理](/chainlesschain/collaboration-governance)
- [流水线编排](/chainlesschain/pipeline)
- [自然语言编程](/chainlesschain/nl-programming)
