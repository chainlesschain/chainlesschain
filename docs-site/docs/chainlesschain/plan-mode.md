# Plan Mode 规划模式

> **版本: v0.29.0 | Claude Code风格 | 安全规划**

Plan Mode 提供类似 Claude Code 的安全规划模式，让 AI 在执行敏感操作前先制定计划并获得用户批准。

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

**先规划，再执行，更安全** 📋
