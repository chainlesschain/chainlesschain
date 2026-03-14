# 70. Agent 智能增强系统

> v0.40.3+ — agent-core.js 提取与 run_code 智能增强

## 概述

Agent 智能增强系统将 Agent 模式的核心业务逻辑从 `agent-repl.js` 提取到独立的 `agent-core.js` 模块，使得终端 REPL 和 WebSocket 会话处理器可以共享同一套工具定义、执行逻辑和 LLM 代理循环。同时为 `run_code` 工具增加了自动 pip 安装、脚本持久化、错误分类和环境检测等智能增强功能。

## 架构

### agent-core.js 模块提取

```
之前 (v0.40.2):
  agent-repl.js (REPL 模块)
    ├── TOOLS[] (9 工具定义)          ← 重复
    ├── executeTool()                  ← 重复
    ├── chatWithTools()                ← 重复
    ├── agentLoop()                    ← 重复
    └── REPL 显示逻辑

  ws-agent-handler.js (WebSocket 模块)
    ├── 需要独立实现工具执行

之后 (v0.40.3+):
  agent-core.js (核心模块)             ← 新增
    ├── AGENT_TOOLS[] (9 工具定义)
    ├── executeTool()
    ├── chatWithTools() → 8 LLM providers
    ├── agentLoop() → 异步生成器
    ├── classifyError()                ← 新增
    ├── isValidPackageName()           ← 新增
    ├── getEnvironmentInfo()           ← 新增
    ├── getCachedPython()              ← 新增
    └── formatToolArgs()

  agent-repl.js (薄包装层)
    ├── import { ... } from agent-core.js
    ├── executeTool() → coreExecuteTool + hookDb + cwd
    └── agentLoop() → coreAgentLoop + chalk 显示

  ws-agent-handler.js (WebSocket 包装层)
    ├── import { ... } from agent-core.js
    └── agentLoop() → coreAgentLoop + WebSocket 事件推送
```

### run_code 工具增强

```
_executeRunCode(args, cwd)
    │
    ├── 1. 确定脚本路径 (persist → agent-scripts/ | temp)
    ├── 2. 写入脚本文件
    ├── 3. 确定解释器 (getCachedPython → python3/python | node | bash)
    ├── 4. 执行脚本
    │     ├── 成功 → { success, output, duration, scriptPath }
    │     └── 失败 → classifyError()
    │            ├── import_error + python → auto pip-install
    │            │     ├── isValidPackageName() 安全验证
    │            │     ├── pip install → 成功 → 重试执行
    │            │     │                └── 失败 → { hint: "Failed to auto-install" }
    │            │     └── 无效包名 → { error: "Invalid package name" }
    │            └── 其他错误 → { errorType, hint, stderr, exitCode }
    └── 5. finally: persist=false 时清理临时文件
```

## 核心组件

### 1. 错误分类 (classifyError)

```javascript
classifyError(stderr, message, exitCode, lang)
// → { errorType: "import_error" | "syntax_error" | "timeout" | "permission_error" | "runtime_error",
//    hint: "actionable guidance string" }
```

5 种错误类型按优先级匹配：
1. **import_error**: `ModuleNotFoundError`, `ImportError`, `No module named`
2. **syntax_error**: `SyntaxError`, `IndentationError`, `TabError`
3. **timeout**: `ETIMEDOUT`, `timed out`, exitCode === null
4. **permission_error**: `EACCES`, `Permission denied`, `PermissionError`
5. **runtime_error**: 兜底（含行号提取）

### 2. 包名安全验证 (isValidPackageName)

```javascript
isValidPackageName(name)
// 正则: /^[a-zA-Z0-9_][a-zA-Z0-9._-]*$/ && length <= 100
```

防止命令注入：拒绝分号、管道、反引号、`$()`、空格等 Shell 元字符。

### 3. 环境检测 (getEnvironmentInfo)

一次性检测并缓存：
- `os` / `arch`: `process.platform` / `process.arch`
- `python`: 复用 `cli-anything-bridge.detectPython()`
- `pip`: `python3 -m pip --version`
- `node`: `node --version`
- `git`: `git --version`

注入到 System Prompt 的 `## Environment` 部分。

### 4. 自动 pip 安装

触发条件：`lang === "python" && errorType === "import_error" && 存在模块名匹配`

流程：
1. 从 stderr 匹配 `No module named '([^']+)'`
2. 取顶层包名：`foo.bar.baz` → `foo`
3. `isValidPackageName(foo)` 安全验证
4. `execSync("python3 -m pip install foo", { timeout: 120000 })`
5. 重新执行脚本
6. 成功时返回 `autoInstalled: ["foo"]`

### 5. 脚本持久化

- **默认 (`persist !== false`)**: 保存到 `{cwd}/.chainlesschain/agent-scripts/{timestamp}-{lang}.{ext}`
- **临时 (`persist: false`)**: 保存到 `os.tmpdir()/cc-agent-{Date.now()}.{ext}`，finally 中清理

### 6. SlotFiller 意图检测集成

agentLoop 调用 LLM 前增加 slot-filling 阶段，使用 `CLISlotFiller.detectIntent()` 检测用户意图：

```javascript
CLISlotFiller.detectIntent(userMessage)
// → { type: "create_file" | "deploy" | "refactor" | "test" | "analyze" |
//        "search" | "install" | "generate" | "edit_file",
//    entities: { path?, target?, fileType?, platform?, package? } }
//   或 null (无匹配)
```

- 9 种意图类型，按正则关键词优先级匹配
- `_extractEntities()` 从消息中提取文件路径、扩展名、平台、包名等实体
- 终端 REPL 和 WebSocket handler 均传入 `slotFiller` + `interaction` 选项

## Desktop 集成

桌面版通过 `conversation:agent-chat` IPC channel 接入 Agent 模式：

```
AIChatPage.vue → ipcRenderer.invoke("conversation:agent-chat", chatData)
    → conversation-ipc.js handler
        → FunctionCaller.chatWithFunctions(conversationHistory, model, provider)
            → function-caller.js (9 工具, agentLoop 逻辑)
```

## 测试矩阵

| 测试文件 | 测试数 | 覆盖范围 |
|---------|--------|---------|
| agent-core.test.js | 43 | 工具定义、执行、chatWithTools providers、agentLoop |
| agent-core-run-code.test.js | 18 | classifyError、isValidPackageName、环境检测、run_code 持久化 |
| agent-core-pip-install.test.js | 4 | pip auto-install 流程（mock child_process） |
| agent-core-python-cache.test.js | 3 | Python 缓存、环境不可用场景 |
| agent-repl.test.js | 40 | REPL 包装层契约、工具执行逻辑 |
| agent-core-integration.test.js | 3 | SlotFiller + agentLoop 集成 |
| agent-enhancements.test.js | 21 | E2E 源码验证 + 运行时导出 |

**共 132 个 Agent 相关测试**，CLI 总计 2503 测试（113 文件）。

## 文件清单

| 文件 | 说明 |
|------|------|
| `packages/cli/src/lib/agent-core.js` | Agent 核心逻辑（工具、LLM、agentLoop、错误分类） |
| `packages/cli/src/repl/agent-repl.js` | 终端 REPL 薄包装层 |
| `packages/cli/src/lib/ws-agent-handler.js` | WebSocket Agent 会话处理器 |
| `desktop-app-vue/src/main/ai-engine/function-caller.js` | 桌面版 Agent FunctionCaller |
| `desktop-app-vue/src/main/conversation/conversation-ipc.js` | 桌面版 conversation:agent-chat handler |
| `desktop-app-vue/src/renderer/pages/AIChatPage.vue` | 桌面版 Agent 模式 UI |
