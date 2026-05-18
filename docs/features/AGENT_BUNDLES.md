# Agent Bundle (Agent 打包部署系统)

**Status**: ✅ Implemented (v5.0.2.10 — session-core 0.3.0)
**Added**: 2026-04-16
**Updated**: 2026-04-16

Agent Bundle 是 ChainlessChain 的可打包、可迁移的 Agent 标准单元。一个 Bundle 目录包含 Agent 的全部配置：系统指令、技能、MCP 服务器、用户记忆种子、审批策略、沙箱策略。

**设计文档**: [92. Deep Agents Deploy 借鉴落地方案](../design/modules/92_Deep_Agents_Deploy借鉴落地方案.md)
**相关系统**: [Session-Core](./SESSION_CORE.md) | [MCP 用户指南](./MCP_USER_GUIDE.md)

## 核心功能

1. **约定式目录结构**: `chainless-agent.toml` + `AGENTS.md` + `skills/` + `mcp.json` + `USER.md` + `policies/`
2. **三种运行模式**: `local` (默认) / `lan` / `hosted`，模式决定 MCP 传输可用性
3. **系统指令注入**: `AGENTS.md` 自动编译为 system prompt，注入 agent 会话
4. **用户记忆种子**: `USER.md` 自动解析为 MemoryStore 条目，首次加载时写入
5. **MCP 配置**: `mcp.json` 声明 bundle 依赖的 MCP 服务器，按模式过滤
6. **审批策略**: `policies/approval.json` 设定会话级 ApprovalGate 策略
7. **沙箱策略**: `policies/sandbox.json` 设定 sandbox 生命周期与资源限制
8. **CLI 集成**: `cc agent --bundle <path>` / `cc serve --bundle <path>`
9. **Desktop IPC**: `bundle:load` / `bundle:info` / `bundle:unload` 三通道

## Bundle 目录结构

```
my-agent-bundle/
├── chainless-agent.toml   # 必须：清单文件（或 .json）
├── AGENTS.md              # 可选：系统指令 Markdown
├── USER.md                # 可选：用户记忆种子
├── skills/                # 可选：技能目录（SKILL.md 文件）
├── mcp.json               # 可选：MCP 服务器配置
└── policies/              # 可选：策略目录
    ├── approval.json      # 审批策略
    └── sandbox.json       # 沙箱策略
```

## 快速开始

### 1. 创建清单文件

**TOML 格式** (`chainless-agent.toml`):

```toml
id = "my-code-reviewer"
name = "Code Reviewer Agent"
version = "1.0.0"
defaultModel = "claude-sonnet-4-20250514"
mode = "local"
sandbox = "thread"
```

**JSON 格式** (`chainless-agent.json`):

```json
{
  "id": "my-code-reviewer",
  "name": "Code Reviewer Agent",
  "version": "1.0.0",
  "defaultModel": "claude-sonnet-4-20250514",
  "mode": "local",
  "sandbox": "thread"
}
```

### 2. 编写系统指令

**AGENTS.md**:

```markdown
# Code Reviewer Agent

你是一个专注于代码质量的 reviewer，擅长发现安全漏洞、性能问题和可维护性缺陷。

## 审查规则

1. 对每个问题标注严重程度：critical / warning / info
2. 引用具体行号
3. 提供修复建议
4. 最终给出 APPROVE / NEEDS_WORK / REJECT 判定
```

### 3. 编写用户记忆种子（可选）

**USER.md**:

```markdown
## 偏好

- 用户偏好 TypeScript，不喜欢 any 类型
- 团队使用 ESLint + Prettier，缩进 2 空格
- CI 使用 GitHub Actions

## 约定

- 提交信息使用 Conventional Commits
- PR 标题不超过 70 字符
```

种子中的每个 `##` 小节会解析为一条 MemoryStore 记忆条目，首次加载时写入 `scope=user`。已存在的条目不会重复写入。

### 4. 配置 MCP 服务器（可选）

**mcp.json**:

```json
{
  "servers": [
    {
      "name": "filesystem",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/workspace"],
      "transport": "stdio"
    },
    {
      "name": "github",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "transport": "stdio",
      "env": { "GITHUB_TOKEN": "${GITHUB_TOKEN}" }
    }
  ]
}
```

> **模式限制**: `hosted` 模式下 `stdio` 传输不可用，仅允许 `sse` / `streamable-http`。`local` 和 `lan` 模式支持所有传输。

### 5. 配置审批策略（可选）

**policies/approval.json**:

```json
{
  "policy": "trusted"
}
```

策略值：`strict`（每次工具调用需审批）| `trusted`（仅高风险需审批）| `autopilot`（全自动）

### 6. 运行 Bundle

**CLI — 交互式 Agent 会话**:

```bash
chainlesschain agent --bundle ./my-agent-bundle
```

**CLI — WebSocket 服务器**（所有连入会话共享 bundle 配置）:

```bash
chainlesschain serve --bundle ./my-agent-bundle --port 18800
```

**Desktop — 通过 IPC**:

```javascript
// Renderer (Pinia store)
const store = useSessionCoreStore();
await store.loadBundle({ bundlePath: "/path/to/my-agent-bundle" });
console.log(store.activeBundle); // { bundle, resolved, loadedAt }
await store.unloadBundle();
```

## 清单字段参考

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `id` | string | `null` | Bundle 唯一标识（可选） |
| `name` | string | `null` | 显示名称（可选） |
| `version` | string | `"0.1.0"` | 语义版本 |
| `defaultModel` | string | `null` | 默认 LLM 模型 |
| `mode` | string | `"local"` | 运行模式：`local` / `lan` / `hosted` |
| `sandbox` | string | `"thread"` | 沙箱类型 |

## 运行模式与 MCP 传输兼容性

| 传输类型 | local | lan | hosted |
|----------|-------|-----|--------|
| `stdio` | ✅ | ✅ | ❌ |
| `sse` | ✅ | ✅ | ✅ |
| `streamable-http` | ✅ | ✅ | ✅ |

## Desktop IPC 通道

| 通道 | 参数 | 返回值 | 说明 |
|------|------|--------|------|
| `bundle:load` | `{ bundlePath, sessionId? }` | `{ ok, data: { bundle, resolved } }` | 加载 bundle，可选绑定到 session |
| `bundle:info` | - | `{ ok, data: { bundle, resolved, loadedAt } \| null }` | 查询当前活跃 bundle |
| `bundle:unload` | - | `{ ok, data: { unloaded: boolean } }` | 卸载当前 bundle |

## 验证规则

- 清单必须存在（`.toml` 或 `.json`）
- `mode` 必须是 `local` / `lan` / `hosted` 之一
- `hosted` 模式下含 `stdio` 传输的 MCP 服务器会被自动过滤
- `USER.md` 种子仅首次加载写入，已存在条目跳过（幂等）
- Bundle 路径必须是绝对路径或可解析为绝对路径

## 性能指标

- **加载耗时**: < 50ms（本地文件系统读取 + 解析）
- **USER.md 种子写入**: < 10ms per entry
- **MCP 配置解析**: < 5ms

## 测试

```bash
# session-core bundle 单元测试
cd packages/session-core && npx vitest run __tests__/agent-bundle-schema.test.js __tests__/agent-bundle-loader.test.js __tests__/agent-bundle-resolver.test.js

# CLI bundle 集成测试
cd packages/cli && npx vitest run __tests__/unit/agent-bundle-integration.test.js

# Desktop IPC bundle 测试
cd desktop-app-vue && npx vitest run tests/unit/session/session-core-ipc.test.js
```

## 实现文件

| 模块 | 路径 | 说明 |
|------|------|------|
| Bundle Schema | `packages/session-core/lib/agent-bundle-schema.js` | 目录结构常量 + 验证 |
| Bundle Loader | `packages/session-core/lib/agent-bundle-loader.js` | 文件系统读取 + 解析 |
| Bundle Resolver | `packages/session-core/lib/agent-bundle-resolver.js` | AGENTS.md→prompt + USER.md→memory |
| MCP Policy | `packages/session-core/lib/mcp-policy.js` | 模式级 MCP 传输过滤 |
| Sandbox Policy | `packages/session-core/lib/sandbox-policy.js` | 沙箱生命周期策略 |
| CLI Agent 命令 | `packages/cli/src/commands/agent.js` | `--bundle` 选项 |
| CLI Serve 命令 | `packages/cli/src/commands/serve.js` | `--bundle` 选项 |
| Desktop IPC | `desktop-app-vue/src/main/session/session-core-ipc.js` | `bundle:load/info/unload` |
| Pinia Store | `desktop-app-vue/src/renderer/stores/sessionCore.ts` | `loadBundle/unloadBundle` actions |
