# Plan Mode 规划模式

> **版本: v0.29.0 | Claude Code风格 | 安全规划**

## 概述

Plan Mode 提供类似 Claude Code 的安全规划模式，AI 在执行敏感操作前自动进入规划模式，仅使用只读工具进行分析并生成执行计划，经用户审批后才执行写入操作。系统通过 PreToolUse 钩子自动检测高风险操作，支持完整批准、部分批准、计划修改和单步调试执行。

Plan Mode 提供类似 Claude Code 的安全规划模式，让 AI 在执行敏感操作前先制定计划并获得用户批准。

## 核心特性

- 📋 **安全规划模式**: AI 执行敏感操作前自动进入规划模式，生成执行计划供用户审批
- 🔒 **工具分级限制**: 规划模式下仅允许只读工具（Read/Glob/Grep），写入工具需审批后执行
- ✅ **灵活审批流**: 支持完整批准、部分批准、拒绝和计划修改，逐步或自动执行
- 🪝 **Hooks 集成**: 通过 PreToolUse 钩子自动检测高风险操作，强制进入规划模式
- ⏱️ **计划生命周期**: 支持计划过期、自动保存、历史查询和单步调试执行

## 系统架构

```
用户请求
    │
    ▼
┌──────────────────┐
│  风险评估引擎     │──── 低风险 ──▶ 直接执行
│  (PreToolUse钩子) │
└────────┬─────────┘
         │ 高风险
         ▼
┌──────────────────┐
│  规划模式引擎     │
│  (只读工具分析)   │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐    ┌──────────────┐
│  执行计划生成     │───▶│  用户审批界面  │
│  (步骤/风险/依赖) │    │ (批准/拒绝/改) │
└──────────────────┘    └──────┬───────┘
                               │ 批准
                               ▼
                        ┌──────────────┐
                        │  计划执行器   │
                        │ (逐步/自动)   │
                        └──────────────┘
```

## 工作原理

### 模式切换

```
普通模式 ←→ 规划模式

普通模式: AI 可以直接执行工具
规划模式: AI 只能读取和分析，执行操作需要审批
```

### 规划模式流程

```
1. 进入规划模式
      ↓
2. AI 分析任务，只使用只读工具
      ↓
3. 生成执行计划
      ↓
4. 用户审批计划
      ↓
5. 批准后执行（或修改计划）
      ↓
6. 退出规划模式
```

---

## 进入规划模式

### 自动进入

某些情况下系统自动进入规划模式：

- 检测到高风险操作
- 配置了需要审批的工具
- 用户设置了强制规划模式

### 手动进入

```javascript
// 通过命令进入
/plan

// 通过 API 进入
await planMode.enter({
  task: '重构认证模块',
  reason: '涉及多文件修改'
})
```

---

## 规划模式工具限制

### 允许的工具（只读）

| 工具        | 说明     |
| ----------- | -------- |
| `Read`      | 读取文件 |
| `Glob`      | 搜索文件 |
| `Grep`      | 搜索内容 |
| `WebFetch`  | 获取网页 |
| `WebSearch` | 搜索网络 |

### 阻止的工具（写入）

| 工具           | 说明       |
| -------------- | ---------- |
| `Write`        | 写入文件   |
| `Edit`         | 编辑文件   |
| `Bash`         | 执行命令   |
| `NotebookEdit` | 编辑笔记本 |

### 配置工具限制

```javascript
// 自定义允许的工具
planMode.configure({
  allowedTools: ["Read", "Glob", "Grep", "WebFetch"],
  blockedTools: ["Write", "Edit", "Bash", "NotebookEdit"],
});
```

---

## 生成计划

### 计划结构

```javascript
{
  "id": "plan-123",
  "task": "重构认证模块",
  "status": "pending",  // pending, approved, rejected, partial
  "createdAt": "2026-02-11T10:00:00Z",

  "analysis": {
    "summary": "需要重构 3 个文件，添加 1 个新文件",
    "risks": ["可能影响现有登录流程"],
    "dependencies": ["auth-service", "user-model"]
  },

  "steps": [
    {
      "id": "step-1",
      "description": "备份现有认证模块",
      "tool": "Bash",
      "params": { "command": "cp -r src/auth src/auth.bak" },
      "status": "pending"
    },
    {
      "id": "step-2",
      "description": "更新认证逻辑",
      "tool": "Edit",
      "params": { "file_path": "src/auth/index.js", "..." },
      "status": "pending"
    },
    // ...更多步骤
  ]
}
```

### 自动生成计划

```javascript
// AI 分析任务并生成计划
const plan = await planMode.generatePlan({
  task: "添加用户头像功能",
  context: "当前使用 Gravatar，需要支持自定义上传",
});

console.log("计划步骤:", plan.steps.length);
console.log("预计修改文件:", plan.analysis.files);
```

---

## 审批工作流

### 完整批准

```javascript
// 批准整个计划
await planMode.approve(planId, {
  comment: "计划看起来没问题",
});

// 批准后自动执行
```

### 部分批准

```javascript
// 只批准部分步骤
await planMode.approvePartial(planId, {
  approvedSteps: ["step-1", "step-2"],
  rejectedSteps: ["step-3"],
  comment: "step-3 需要修改",
});
```

### 拒绝计划

```javascript
// 拒绝计划
await planMode.reject(planId, {
  reason: "需要更多分析",
  feedback: "请先确认现有测试覆盖率",
});
```

### 修改计划

```javascript
// 修改计划中的步骤
await planMode.modifyStep(planId, 'step-2', {
  description: '更新为使用新的 API',
  params: { ... }
})

// 添加步骤
await planMode.addStep(planId, {
  afterStep: 'step-2',
  description: '添加单元测试',
  tool: 'Write',
  params: { ... }
})

// 删除步骤
await planMode.removeStep(planId, 'step-3')
```

---

## 执行计划

### 自动执行

```javascript
// 批准后自动执行所有步骤
await planMode.execute(planId);
```

### 单步执行

```javascript
// 逐步执行，每步确认
await planMode.executeStep(planId, 'step-1')

// 执行结果
{
  "stepId": "step-1",
  "status": "completed",
  "result": { ... },
  "duration": 150
}
```

### 暂停和恢复

```javascript
// 暂停执行
await planMode.pause(planId);

// 恢复执行
await planMode.resume(planId);
```

---

## Hooks 集成

Plan Mode 与 Hooks 系统集成：

### PreToolUse 钩子

```javascript
// .chainlesschain/hooks/plan-mode-check.js
module.exports = {
  event: "PreToolUse",
  priority: 10,

  async handler(context) {
    const { tool, params } = context;

    // 检查是否需要进入规划模式
    if (isHighRiskOperation(tool, params)) {
      const inPlanMode = await planMode.isActive();

      if (!inPlanMode) {
        // 阻止操作，提示进入规划模式
        return {
          proceed: false,
          error: "此操作需要在规划模式下执行",
          suggestion: "使用 /plan 进入规划模式",
        };
      }
    }

    return { proceed: true };
  },
};
```

---

## 配置选项

### 全局配置

```javascript
{
  "planMode": {
    // 是否默认启用
    "defaultEnabled": false,

    // 强制需要规划的操作
    "requirePlanFor": [
      { "tool": "Bash", "pattern": "rm -rf" },
      { "tool": "Edit", "pathPattern": "src/core/**" }
    ],

    // 计划过期时间
    "planExpiration": 24 * 60 * 60 * 1000,  // 24小时

    // 自动保存计划
    "autoSave": true
  }
}
```

---

## IPC 处理器

Plan Mode 提供 14 个 IPC 处理器：

| 处理器                    | 功能               |
| ------------------------- | ------------------ |
| `planMode:enter`          | 进入规划模式       |
| `planMode:exit`           | 退出规划模式       |
| `planMode:isActive`       | 检查是否在规划模式 |
| `planMode:generatePlan`   | 生成计划           |
| `planMode:getPlan`        | 获取计划           |
| `planMode:approve`        | 批准计划           |
| `planMode:approvePartial` | 部分批准           |
| `planMode:reject`         | 拒绝计划           |
| `planMode:modify`         | 修改计划           |
| `planMode:execute`        | 执行计划           |
| `planMode:executeStep`    | 执行单步           |
| `planMode:pause`          | 暂停执行           |
| `planMode:resume`         | 恢复执行           |
| `planMode:getHistory`     | 获取历史计划       |

---

## 使用场景

### 1. 大型重构

```
用户: 帮我重构整个认证模块，使用 JWT 替换 Session

AI: 这是一个较大的改动，让我进入规划模式分析...

[自动进入规划模式]

AI: 我已经分析了代码库，生成了以下执行计划：

1. 备份现有认证模块
2. 安装 JWT 依赖 (jsonwebtoken)
3. 创建 JWT 工具模块
4. 修改登录逻辑
5. 修改验证中间件
6. 更新相关测试
7. 更新文档

预计修改 8 个文件，风险评估：中等

是否批准执行？
```

### 2. 数据库迁移

```
用户: 执行数据库迁移脚本

AI: 数据库迁移是敏感操作，需要在规划模式下进行。

[进入规划模式]

执行计划：
1. 备份当前数据库
2. 执行迁移脚本
3. 验证数据完整性
4. 回滚准备（如果失败）

请确认是否继续？
```

---

## 最佳实践

### 1. 适时使用规划模式

```javascript
// 配置需要规划的场景
{
  "requirePlanFor": [
    { "tool": "Bash", "pattern": "npm publish" },
    { "tool": "Bash", "pattern": "git push" },
    { "tool": "Edit", "pathPattern": "**/config/**" }
  ]
}
```

### 2. 详细的计划描述

```javascript
// 好的计划步骤描述
{
  "description": "修改 AuthService.login() 方法，添加 JWT token 生成逻辑",
  "changes": [
    "添加 generateToken() 方法",
    "修改返回值包含 token",
    "添加 token 过期时间配置"
  ]
}
```

### 3. 保存计划历史

```javascript
// 查看历史计划
const history = await planMode.getHistory({
  limit: 10,
  status: "completed",
});
```

---

## 下一步

- [Hooks系统](/chainlesschain/hooks) - 钩子扩展
- [Skills系统](/chainlesschain/skills) - 技能系统
- [权限系统](/chainlesschain/permissions) - RBAC权限

---

## 关键文件

| 文件 | 职责 |
| --- | --- |
| `src/main/ai-engine/plan-mode/plan-mode-manager.js` | Plan Mode 核心引擎 |
| `src/main/ai-engine/plan-mode/plan-mode-ipc.js` | IPC 处理器（14 个） |
| `src/main/hooks/plan-mode-check.js` | PreToolUse 风险检测钩子 |
| `src/renderer/stores/planMode.ts` | Pinia 规划模式状态管理 |

## 使用示例

### CLI 规划模式

```bash
# 进入 Agent 模式（支持 Plan Mode）
chainlesschain agent

# 在对话中使用 /plan 命令
> /plan 重构用户认证模块，使用 JWT 替换 Session
```

### 桌面端规划操作

```javascript
// 进入规划模式
await planMode.enter({
  task: '迁移数据库从 SQLite 到 PostgreSQL',
  reason: '涉及多表结构变更和数据迁移'
});

// 生成执行计划
const plan = await planMode.generatePlan({
  task: '添加用户头像上传功能',
  context: '需要图片压缩、存储和CDN分发'
});

// 部分批准（只批准安全的步骤）
await planMode.approvePartial(planId, {
  approvedSteps: ['step-1', 'step-2'],
  rejectedSteps: ['step-3'],
  comment: 'step-3 的删除操作需要修改'
});

// 单步执行并确认
await planMode.executeStep(planId, 'step-1');
```

---

## 故障排查

### 规划模式未自动触发

- **风险检测规则**: 确认 `requirePlanFor` 配置覆盖了目标操作模式
- **Hooks 未注册**: 检查 `PreToolUse` 钩子是否正确加载和启用
- **模式冲突**: 确认当前未处于另一个活跃的规划模式会话中

### 计划生成失败

- **LLM 不可用**: 计划生成依赖 AI 分析，确认本地 LLM 服务正常运行
- **上下文不足**: 提供更详细的任务描述和上下文信息提高计划质量
- **工具限制**: 规划模式下仅允许只读工具，确认分析所需文件可访问

### 计划执行中断

- **步骤依赖失败**: 前置步骤失败会阻塞后续步骤，检查错误日志
- **计划已过期**: 超过 `planExpiration`（默认 24 小时）的计划需重新生成
- **权限不足**: 某些操作可能需要额外权限，检查当前用户的角色权限

### 审批流程异常

- **审批超时**: 默认 24 小时超时，超时后需重新提交审批请求
- **部分批准冲突**: 被拒绝的步骤如有依赖关系，后续步骤可能无法执行
- **并发修改**: 多人同时修改计划可能导致冲突，建议使用版本锁定

---

## 安全考虑

### 操作安全

- 高风险操作（`rm -rf`、核心配置修改等）**强制进入规划模式**，必须人工审批
- 规划模式下 AI 仅能使用 **只读工具**（Read/Glob/Grep），无法执行写入操作
- 所有计划步骤在执行前需要显式批准，支持逐步执行和随时暂停

### 审批安全

- 计划审批记录保存在审计日志中，包含审批人、时间、评论等完整信息
- 支持部分批准机制，敏感步骤可单独审查，降低批量审批风险
- 计划过期自动失效，防止过时的计划被误执行

### 回滚保护

- 计划执行前建议包含备份步骤，支持在执行失败时快速回滚
- 单步执行模式允许在每步完成后检查结果，发现问题及时暂停
- 执行历史记录完整保留，支持事后审查和问题定位

### 钩子安全

- `PreToolUse` 钩子以最高优先级运行，确保风险检测不被绕过
- 钩子配置文件存储在 `.chainlesschain/hooks/` 中，受文件权限保护
- 自定义钩子脚本需要人工审查，防止恶意钩子绕过安全检查

---

## CLI SlotFiller 集成 (v0.41.0)

> 从桌面版 `slot-filler.js` 移植到 CLI，支持终端和 WebSocket 两种交互模式。

### SlotFiller 概述

当 AI 检测到用户意图但缺少关键参数时，SlotFiller 自动向用户提问收集缺失信息：

```
用户: "创建一个 API 文件"
    ↓
SlotFiller 检测: create_file 意图缺少 fileType, path
    ↓
尝试上下文推断: 项目是 Node.js → fileType = "javascript"
    ↓
仍缺 path → 通过 InteractionAdapter 向用户提问
    ↓
终端模式: readline 提问
WebSocket模式: 发送 question 消息，等待 session-answer
```

### 槽位定义

```javascript
REQUIRED_SLOTS = {
  create_file: ['fileType', 'path'],
  edit_file: ['target'],
  deploy: ['platform'],
  refactor: ['scope'],
  test: ['target'],
  analyze: ['target'],
}
```

### 使用方式

```bash
# 在 Agent REPL 中，SlotFiller 自动工作
chainlesschain agent

> /plan interactive 重构用户认证模块
# SlotFiller 检测缺少参数，自动提问：
# ? 重构范围是什么？ (全部/登录模块/注册模块)
# ? 使用什么认证方案？ (JWT/Session/OAuth)
```

### 关键文件

| 文件 | 职责 |
|------|------|
| `packages/cli/src/lib/slot-filler.js` | SlotFiller 核心引擎 |
| `packages/cli/src/lib/interaction-adapter.js` | 交互抽象层（终端/WebSocket） |

---

## CLI InteractivePlanner (v0.41.0)

> 从桌面版 `task-planner-interactive.js` 简化移植，支持 LLM 驱动的计划生成。

### 交互式规划流程

```
用户请求 → LLM 分析 → 生成计划 → 推荐技能 → 用户确认
    ↓           ↓           ↓           ↓          ↓
 /plan       分析上下文    步骤列表    匹配Skills   confirm/
interactive   + 代码库    + 风险评估   + 解释原因   adjust/
                                                  regenerate/
                                                  cancel
```

### CLI 命令

```bash
chainlesschain agent

# 进入交互式规划
> /plan interactive 添加用户头像上传功能

# 系统生成计划：
#   Plan: 用户头像上传功能
#   需要图片压缩、存储和 CDN 分发
#
#   1. 安装 sharp 依赖 [run_shell]
#   2. 创建 upload 中间件 [write_file]
#   3. 添加图片压缩逻辑 [write_file]
#   4. 更新路由 [edit_file]
#   5. 编写测试 [write_file]
#
#   Recommended skills:
#     - code-review: 代码审查
#     - unit-test: 单元测试生成

> /plan interactive:confirm    # 确认执行
> /plan interactive:cancel     # 取消
> /plan interactive:regenerate # 重新生成
```

### 关键文件

| 文件 | 职责 |
|------|------|
| `packages/cli/src/lib/interactive-planner.js` | 交互式计划生成器 |
| `packages/cli/src/lib/slot-filler.js` | 参数槽填充（计划前信息收集） |

---

## 相关文档

- [Hooks 扩展系统](/chainlesschain/hooks) - 钩子事件与 Plan Mode 集成
- [Skills 技能系统](/chainlesschain/skills) - 技能执行与规划模式
- [权限系统](/chainlesschain/permissions) - RBAC 权限与操作审批
- [Cowork 多智能体](/chainlesschain/cowork) - 多 Agent 协作中的规划
- [WebSocket 服务器](/chainlesschain/cli-serve) - WebSocket 会话中的规划模式

---

**先规划，再执行，更安全** 📋
