# Hooks 系统

> **版本: v0.28.0+ | 21个钩子事件 | Claude Code风格**

Hooks 系统提供可扩展的钩子机制，允许在关键操作点插入自定义逻辑，灵感来源于 Claude Code 的 hooks 设计。

## 核心特性

- 🪝 **21 个钩子事件**: 覆盖工具执行、会话生命周期、文件操作、消息传递等关键节点
- 🔄 **4 种钩子类型**: 同步/异步/Shell 命令/脚本（JS/Python/Bash）灵活适配各场景
- 📦 **优先级调度**: 系统级(0) → 高优先级(100) → 普通(500) → 监控(1000)，有序执行
- 🛡️ **安全拦截**: PreToolUse 钩子可阻止危险操作，保护敏感文件和目录
- 🔧 **多层配置**: 项目级 + 用户级配置，项目级优先，支持内置钩子与自定义钩子

## 系统架构

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  工具/IPC 调用   │────→│  Hook Dispatcher │────→│  Hook Registry  │
│  触发钩子事件    │     │  优先级排序执行   │     │  配置加载管理    │
└─────────────────┘     └────────┬─────────┘     └─────────────────┘
                                 │
                 ┌───────────────┼───────────────┐
                 ▼               ▼               ▼
           ┌──────────┐   ┌──────────┐   ┌──────────┐
           │ Sync     │   │ Async    │   │ Command/ │
           │ Handlers │   │ Handlers │   │ Script   │
           │ 阻塞执行  │   │ 非阻塞   │   │ 外部脚本 │
           └──────────┘   └──────────┘   └──────────┘

配置来源:
  项目级: .chainlesschain/hooks.json (优先)
  用户级: ~/.chainlesschain/hooks.json
```

## 系统概述

### 钩子事件

| 事件              | 触发时机     | 用途                 |
| ----------------- | ------------ | -------------------- |
| `PreToolUse`      | 工具执行前   | 权限检查、参数验证   |
| `PostToolUse`     | 工具执行后   | 结果处理、日志记录   |
| `SessionStart`    | 会话开始     | 初始化、加载配置     |
| `SessionEnd`      | 会话结束     | 清理、保存状态       |
| `PreCompact`      | 上下文压缩前 | 保存重要信息         |
| `PostCompact`     | 上下文压缩后 | 验证压缩结果         |
| `FileModified`    | 文件修改后   | 自动格式化、触发构建 |
| `FileCreated`     | 文件创建后   | 初始化模板           |
| `FileDeleted`     | 文件删除后   | 清理相关资源         |
| `MessageSent`     | 消息发送后   | 消息记录             |
| `MessageReceived` | 消息接收后   | 消息处理             |
| `ErrorOccurred`   | 错误发生时   | 错误处理、通知       |
| ...               | ...          | ...                  |

### 钩子类型

| 类型      | 说明      | 执行方式               |
| --------- | --------- | ---------------------- |
| `Sync`    | 同步钩子  | 阻塞执行               |
| `Async`   | 异步钩子  | 非阻塞执行             |
| `Command` | Shell命令 | 执行系统命令           |
| `Script`  | 脚本钩子  | 执行JS/Python/Bash脚本 |

---

## 配置钩子

### 配置文件位置

```
项目级: .chainlesschain/hooks.json
用户级: ~/.chainlesschain/hooks.json
```

项目级配置优先于用户级配置。

### 配置格式

```json
{
  "hooks": [
    {
      "event": "PreToolUse",
      "type": "sync",
      "handler": "checkPermission",
      "priority": 100,
      "enabled": true,
      "config": {
        "allowedTools": ["Read", "Glob", "Grep"]
      }
    },
    {
      "event": "FileModified",
      "type": "command",
      "command": "npm run lint --fix ${file}",
      "priority": 500
    }
  ]
}
```

---

## 钩子优先级

| 优先级 | 名称    | 范围    | 用途             |
| ------ | ------- | ------- | ---------------- |
| 0      | SYSTEM  | 0-99    | 系统内置钩子     |
| 100    | HIGH    | 100-299 | 高优先级用户钩子 |
| 500    | NORMAL  | 300-699 | 普通优先级       |
| 900    | LOW     | 700-899 | 低优先级         |
| 1000   | MONITOR | 900+    | 监控和日志       |

数字越小，优先级越高，越先执行。

---

## 内置钩子

### 权限检查钩子

```json
{
  "event": "PreToolUse",
  "type": "sync",
  "handler": "builtins/permissionCheck",
  "priority": 0,
  "config": {
    "blockedTools": ["Write", "Edit"],
    "blockedPaths": ["/etc", "/usr/bin"]
  }
}
```

### 自动格式化钩子

```json
{
  "event": "FileModified",
  "type": "command",
  "command": "prettier --write ${file}",
  "priority": 500,
  "config": {
    "extensions": [".js", ".ts", ".json"]
  }
}
```

### 日志记录钩子

```json
{
  "event": "PostToolUse",
  "type": "async",
  "handler": "builtins/logToolUse",
  "priority": 1000
}
```

---

## 脚本钩子

### JavaScript 脚本

在 `.chainlesschain/hooks/` 目录下创建脚本：

```javascript
// .chainlesschain/hooks/validate-commit.js

module.exports = {
  event: "PreToolUse",
  priority: 100,

  async handler(context) {
    const { tool, params } = context;

    if (tool === "Bash" && params.command?.includes("git commit")) {
      // 检查提交消息格式
      const messageMatch = params.command.match(/-m\s+"([^"]+)"/);
      if (messageMatch) {
        const message = messageMatch[1];
        if (!message.match(/^(feat|fix|docs|style|refactor|test|chore):/)) {
          throw new Error("Commit message must follow conventional format");
        }
      }
    }

    return { proceed: true };
  },
};
```

### Python 脚本

```python
# .chainlesschain/hooks/check-security.py

def handler(context):
    tool = context.get('tool')
    params = context.get('params', {})

    if tool == 'Write':
        content = params.get('content', '')
        # 检查敏感信息
        if 'password' in content.lower() or 'secret' in content.lower():
            return {'proceed': False, 'error': 'Sensitive content detected'}

    return {'proceed': True}
```

### Bash 脚本

```bash
#!/bin/bash
# .chainlesschain/hooks/run-tests.sh

# FileModified 事件后运行测试
if [[ "$FILE" == *.test.js ]] || [[ "$FILE" == *.spec.js ]]; then
    npm test -- --findRelatedTests "$FILE"
fi
```

---

## 钩子上下文

钩子接收的上下文信息：

```javascript
{
  // 事件信息
  event: 'PreToolUse',
  timestamp: '2026-02-11T10:30:00Z',

  // 工具信息（仅工具相关事件）
  tool: 'Write',
  params: {
    file_path: '/path/to/file.js',
    content: '...'
  },

  // 会话信息
  session: {
    id: 'session-123',
    startTime: '2026-02-11T10:00:00Z'
  },

  // 文件信息（仅文件相关事件）
  file: {
    path: '/path/to/file.js',
    action: 'modified'
  },

  // 错误信息（仅错误事件）
  error: {
    message: '...',
    stack: '...'
  }
}
```

---

## 钩子返回值

### 同步钩子

```javascript
// 继续执行
return { proceed: true }

// 阻止执行
return { proceed: false, error: 'Not allowed' }

// 修改参数
return {
  proceed: true,
  modifiedParams: { ... }
}
```

### 异步钩子

```javascript
// 异步钩子不影响主流程
// 用于日志记录、通知等
await sendNotification(context);
```

---

## 中间件集成

### IPC 中间件

```javascript
// 为 IPC 处理器添加钩子
const ipcMiddleware = createIPCMiddleware({
  beforeHandle: async (channel, args) => {
    await hookSystem.trigger("PreIPCHandle", { channel, args });
  },
  afterHandle: async (channel, result) => {
    await hookSystem.trigger("PostIPCHandle", { channel, result });
  },
});
```

### Tool 中间件

```javascript
// 为工具执行添加钩子
const toolMiddleware = createToolMiddleware({
  beforeExecute: async (tool, params) => {
    const result = await hookSystem.trigger("PreToolUse", { tool, params });
    if (!result.proceed) {
      throw new Error(result.error);
    }
    return result.modifiedParams || params;
  },
  afterExecute: async (tool, result) => {
    await hookSystem.trigger("PostToolUse", { tool, result });
  },
});
```

---

## 调试钩子

### 启用调试模式

```json
{
  "debug": true,
  "hooks": [...]
}
```

### 查看钩子日志

```
设置 → 开发者选项 → Hooks日志
```

### 测试钩子

```javascript
// 手动触发钩子（仅开发模式）
await hookSystem.trigger("PreToolUse", {
  tool: "Write",
  params: { file_path: "/test/file.js", content: "test" },
});
```

---

## 最佳实践

### 1. 使用适当的优先级

```json
// 安全检查应该优先执行
{ "event": "PreToolUse", "priority": 100, "handler": "security-check" }

// 日志记录应该最后执行
{ "event": "PostToolUse", "priority": 1000, "handler": "logging" }
```

### 2. 避免阻塞操作

```javascript
// 不推荐：同步钩子中执行耗时操作
{
  "event": "FileModified",
  "type": "sync",
  "command": "npm run build"  // 可能很慢
}

// 推荐：使用异步钩子
{
  "event": "FileModified",
  "type": "async",
  "command": "npm run build"
}
```

### 3. 错误处理

```javascript
module.exports = {
  event: "PreToolUse",

  async handler(context) {
    try {
      // 钩子逻辑
    } catch (error) {
      // 记录错误但不阻止执行
      console.error("Hook error:", error);
      return { proceed: true };
    }
  },
};
```

---

## 常用钩子示例

### 自动保存到 Git

```json
{
  "event": "FileModified",
  "type": "command",
  "command": "git add ${file}",
  "priority": 600
}
```

### 敏感信息检查

```javascript
// .chainlesschain/hooks/sensitive-check.js
module.exports = {
  event: "PreToolUse",
  priority: 50,

  handler(context) {
    if (context.tool === "Write") {
      const sensitivePatterns = [
        /password\s*=\s*["'][^"']+["']/i,
        /api_key\s*=\s*["'][^"']+["']/i,
        /secret\s*=\s*["'][^"']+["']/i,
      ];

      for (const pattern of sensitivePatterns) {
        if (pattern.test(context.params.content)) {
          return {
            proceed: false,
            error: "Detected sensitive information in file content",
          };
        }
      }
    }

    return { proceed: true };
  },
};
```

### 代码风格检查

```json
{
  "event": "FileCreated",
  "type": "command",
  "command": "eslint --fix ${file}",
  "config": {
    "extensions": [".js", ".ts", ".jsx", ".tsx"]
  }
}
```

---

## 下一步

- [Plan Mode](/chainlesschain/plan-mode) - 安全规划模式
- [Skills系统](/chainlesschain/skills) - 技能扩展
- [权限系统](/chainlesschain/permissions) - RBAC权限控制

---

## 关键文件

| 文件 | 职责 |
| --- | --- |
| `src/main/hooks/hook-system.js` | Hooks 核心引擎（注册/触发/调度） |
| `src/main/hooks/hook-registry.js` | 钩子注册表与配置加载 |
| `src/main/hooks/hook-middleware.js` | IPC/Tool 中间件集成 |
| `src/main/hooks/builtins/` | 内置钩子（权限检查/日志记录等） |

## 相关文档

- [Plan Mode →](/chainlesschain/plan-mode)
- [Skills 系统 →](/chainlesschain/skills)
- [权限系统 →](/chainlesschain/permissions)
- [审计日志 →](/chainlesschain/audit)

---

**可扩展的钩子，无限的可能** 🪝
