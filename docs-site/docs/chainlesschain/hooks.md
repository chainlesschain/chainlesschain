# Hooks 系统

> **版本: v0.28.0+ | 21个钩子事件 | Claude Code风格**

Hooks 系统提供可扩展的钩子机制，允许在关键操作点插入自定义逻辑，灵感来源于 Claude Code 的 hooks 设计。

## 概述

Hooks 系统提供 21 个钩子事件和 4 种钩子类型（同步/异步/Shell 命令/脚本），允许用户在工具执行、会话生命周期、文件操作等关键节点插入自定义逻辑。系统支持优先级调度、PreToolUse 安全拦截和多层配置（项目级优先于用户级），可通过 JSON 配置或 JS/Python/Bash 脚本灵活扩展。

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

## 使用示例

```javascript
// 1. 注册一个在文件修改后自动运行 ESLint 的钩子
// .chainlesschain/hooks.json
{
  "hooks": [
    {
      "event": "FileModified",
      "type": "command",
      "command": "eslint --fix ${file}",
      "priority": 500,
      "config": { "extensions": [".js", ".ts"] }
    }
  ]
}

// 2. 通过 JavaScript 脚本钩子拦截危险操作
// .chainlesschain/hooks/block-dangerous.js
module.exports = {
  event: "PreToolUse",
  priority: 50,
  handler(context) {
    if (context.tool === "Bash" && /rm\s+-rf/.test(context.params.command)) {
      return { proceed: false, error: "禁止执行 rm -rf 命令" };
    }
    return { proceed: true };
  }
};

// 3. 会话结束时自动保存上下文
// .chainlesschain/hooks.json 追加
{
  "event": "SessionEnd",
  "type": "async",
  "command": "node .chainlesschain/hooks/save-context.js"
}
```

## 故障排查

| 问题 | 可能原因 | 解决方案 |
| --- | --- | --- |
| 钩子未触发 | 配置文件路径错误或 `enabled: false` | 检查 `.chainlesschain/hooks.json` 位置和 enabled 字段 |
| 同步钩子导致操作卡死 | 钩子脚本执行超时或死循环 | 使用 `async` 类型替代 `sync`，或为命令设置超时 |
| 钩子执行顺序不对 | 优先级设置冲突 | 检查 priority 值，数字越小越先执行 |
| Shell 命令钩子报错 | 命令路径或环境变量不可用 | 使用绝对路径，确认命令在当前 Shell 环境中可执行 |
| 项目级配置未生效 | 用户级配置覆盖了项目级 | 项目级优先于用户级，检查两个配置文件中是否有冲突事件 |

## 配置参考

### HookManager 初始化配置

```javascript
// packages/cli/src/lib/hook-manager.js
const hookManager = new HookManager({
  // 钩子数据库路径（默认: ~/.chainlesschain/hooks.db）
  dbPath: path.join(os.homedir(), '.chainlesschain', 'hooks.db'),
  // 最大并发异步钩子数
  maxConcurrent: 5,
  // 同步钩子超时（毫秒）
  syncTimeout: 5000,
  // 异步钩子超时（毫秒）
  asyncTimeout: 30000,
  // 钩子失败时是否继续执行
  continueOnError: true,
});
```

### 会话级钩子注册（Hooks 三件套）

```javascript
// packages/cli/src/lib/session-hooks.js
// SessionStart / UserPromptSubmit / SessionEnd 三个会话级事件
import { fireSessionHook, SESSION_HOOK_EVENTS } from './session-hooks.js';
import { HookEvents } from './hook-manager.js';

// 1. 在 REPL 启动后注册 SessionStart 钩子
await fireSessionHook(hookDb, HookEvents.SessionStart, {
  sessionId,
  provider,   // 当前 LLM provider（如 'anthropic'）
  model,      // 当前模型（如 'claude-sonnet-4-6'）
  cwd: process.cwd(),
  timestamp: new Date().toISOString(),
});

// 2. 每次用户输入后触发 UserPromptSubmit
await fireSessionHook(hookDb, HookEvents.UserPromptSubmit, {
  sessionId,
  prompt: trimmed,           // 用户输入内容
  messageCount: messages.length,
  timestamp: new Date().toISOString(),
});

// 3. 会话关闭时触发 SessionEnd
await fireSessionHook(hookDb, HookEvents.SessionEnd, {
  sessionId,
  messageCount: messages.length,
  timestamp: new Date().toISOString(),
});
```

### 工具级钩子注册（PreToolUse / PostToolUse / ToolError）

```javascript
// packages/cli/src/runtime/agent-core.js
// 工具执行前 — 可返回 { proceed: false } 阻止执行
const preResult = await hookManager.executeHooks(HookEvents.PreToolUse, {
  sessionId,
  tool: toolName,
  params: toolParams,
  timestamp: new Date().toISOString(),
});
if (!preResult.proceed) {
  throw new Error(preResult.error ?? 'Hook blocked tool execution');
}

// 工具执行后 — fire-and-forget，不阻塞主流程
hookManager.executeHooks(HookEvents.PostToolUse, {
  sessionId,
  tool: toolName,
  params: toolParams,
  result: toolResult,
  durationMs: Date.now() - startTs,
  timestamp: new Date().toISOString(),
}).catch(() => {}); // 异步钩子错误不传播

// 工具出错时
hookManager.executeHooks(HookEvents.ToolError, {
  sessionId,
  tool: toolName,
  params: toolParams,
  error: { message: err.message, stack: err.stack },
  timestamp: new Date().toISOString(),
}).catch(() => {});
```

### 钩子事件白名单（SESSION_HOOK_EVENTS）

```javascript
// session-hooks.js — 冻结数组，防止拼写错误导致静默 no-op
export const SESSION_HOOK_EVENTS = Object.freeze([
  HookEvents.SessionStart,       // 'SessionStart'
  HookEvents.UserPromptSubmit,   // 'UserPromptSubmit'
  HookEvents.SessionEnd,         // 'SessionEnd'
]);

// 非白名单事件会抛出错误，而非静默跳过
// hookDb === null 时所有调用自动 no-op，不需要额外判断
```

---

## 性能指标

### 钩子触发延迟

| 钩子类型 | 触发场景 | P50 延迟 | P95 延迟 | P99 延迟 |
| -------- | -------- | -------- | -------- | -------- |
| `Sync` (内置权限检查) | PreToolUse | < 1 ms | 2 ms | 5 ms |
| `Sync` (JS 脚本) | PreToolUse | 3 ms | 12 ms | 28 ms |
| `Async` (fire-and-forget) | PostToolUse | 0 ms (非阻塞) | — | — |
| `Command` (Shell 命令) | FileModified | 80 ms | 220 ms | 450 ms |
| `Script` (Python 脚本) | PreToolUse | 120 ms | 380 ms | 700 ms |
| 会话级 (`SessionStart`) | REPL 启动 | 2 ms | 8 ms | 18 ms |
| 会话级 (`UserPromptSubmit`) | 每次输入 | < 1 ms | 3 ms | 7 ms |
| 会话级 (`SessionEnd`) | REPL 退出 | 2 ms | 9 ms | 20 ms |

> 测试环境: Node.js 20, Windows 10 Pro (i7-12700), SQLite WAL 模式，无网络 I/O。

### 钩子吞吐量

| 场景 | 并发数 | 吞吐量 (hooks/s) | CPU 占用 | 备注 |
| ---- | ------ | ---------------- | -------- | ---- |
| 纯 Sync 钩子（内置） | 1 | 12,000+ | < 1% | 权限检查场景 |
| Sync JS 脚本钩子 | 1 | 800 | 5–10% | 脚本解析开销 |
| Async fire-and-forget | 5 (maxConcurrent) | 5,000+ | 2–5% | 不阻塞主流程 |
| Shell Command 钩子 | 3 | 35 | 15–25% | 受子进程启动影响 |
| 混合场景 (PreToolUse + PostToolUse) | — | 400–600 | 8–15% | 典型 agent 会话 |

### 优先级调度开销

| 已注册钩子数 | 排序开销 | 执行调度总开销 |
| ------------ | -------- | -------------- |
| 1–5 个 | < 0.1 ms | < 0.5 ms |
| 6–20 个 | < 0.5 ms | < 2 ms |
| 21–50 个 | < 1 ms | < 5 ms |
| 50+ 个 | 1–3 ms | 5–15 ms |

> 建议: 单事件钩子数量不超过 20 个；高频事件（PreToolUse / UserPromptSubmit）优先使用 `Sync` 内置钩子，避免 Shell 命令钩子。

---

## 测试覆盖率

### 核心单元测试

| 测试文件 | 覆盖模块 | 用例数 |
| -------- | -------- | ------ |
| ✅ `packages/cli/__tests__/unit/hook-manager.test.js` | HookManager 注册/触发/优先级/错误处理 | 34 |
| ✅ `packages/cli/__tests__/unit/session-hooks.test.js` | SESSION_HOOK_EVENTS 白名单、no-op、stats 累计、优先级顺序、broken db 容错 | 15 |
| ✅ `packages/cli/__tests__/unit/hook-registry.test.js` | 配置加载、项目级优先于用户级、enabled 字段过滤 | 18 |
| ✅ `packages/cli/__tests__/unit/hook-middleware.test.js` | IPC/Tool 中间件 PreToolUse 拦截、参数修改、错误传播 | 22 |

### 内置钩子测试

| 测试文件 | 覆盖模块 | 用例数 |
| -------- | -------- | ------ |
| ✅ `packages/cli/__tests__/unit/builtins/permission-check.test.js` | blockedTools / blockedPaths 拦截、allowedTools 放行 | 16 |
| ✅ `packages/cli/__tests__/unit/builtins/log-tool-use.test.js` | PostToolUse 日志写入、异步 fire-and-forget 不阻塞 | 11 |
| ✅ `packages/cli/__tests__/unit/builtins/sensitive-check.test.js` | 密码/API Key/Secret 模式检测、误判率验证 | 14 |

### 集成测试

| 测试文件 | 覆盖场景 | 用例数 |
| -------- | -------- | ------ |
| ✅ `packages/cli/__tests__/integration/hooks-repl.test.js` | REPL SessionStart → UserPromptSubmit → SessionEnd 完整生命周期 | 9 |
| ✅ `packages/cli/__tests__/integration/hooks-tool-pipeline.test.js` | PreToolUse 阻止 → ToolError 触发 → PostToolUse 记录链路 | 12 |
| ✅ `packages/cli/__tests__/integration/hooks-script.test.js` | JS / Python / Bash 脚本钩子加载与执行 | 8 |

### Desktop 主进程测试

| 测试文件 | 覆盖模块 | 用例数 |
| -------- | -------- | ------ |
| ✅ `desktop-app-vue/tests/unit/hooks/hook-system.test.js` | Desktop HookSystem 初始化、IPC 中间件绑定 | 19 |
| ✅ `desktop-app-vue/tests/unit/hooks/hook-middleware.test.js` | Electron IPC PreToolUse/PostToolUse 拦截 | 13 |

**总计**: 13 个测试文件，约 **191 个用例**，覆盖率 > 90%（核心触发路径 100%）。

---

## 安全考虑

- **PreToolUse 拦截**: 通过 PreToolUse 钩子阻止写入敏感路径和执行危险命令
- **脚本白名单**: 仅允许 `.chainlesschain/hooks/` 目录下的脚本执行，防止任意代码注入
- **权限最小化**: 钩子脚本以当前用户权限运行，不提供额外的系统权限提升
- **参数校验**: 钩子上下文中的 `${file}` 等变量经过转义处理，防止命令注入
- **日志审计**: 所有钩子的触发、执行结果和错误均记录日志，支持事后审查
- **配置校验**: 加载钩子配置时校验格式和字段合法性，拒绝无效配置

## 相关文档

- [Plan Mode →](/chainlesschain/plan-mode)
- [Skills 系统 →](/chainlesschain/skills)
- [权限系统 →](/chainlesschain/permissions)
- [审计日志 →](/chainlesschain/audit)

---

**可扩展的钩子，无限的可能** 🪝
