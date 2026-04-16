# Agent Bundle 打包部署系统

> **版本: v1.0 (2026-04-16) | 状态: ✅ 生产就绪 | CLI + Desktop IPC 双端 | 40 测试通过**
>
> Agent Bundle 是 ChainlessChain 的可打包、可迁移的 Agent 标准单元。一个 Bundle 目录包含 Agent 的全部配置：系统指令、技能、MCP 服务器、用户记忆种子、审批策略、沙箱策略。借鉴 Anthropic Deep Agents Deploy 的约定式目录结构设计。

## 概述

Agent Bundle 解决的核心问题：一个 Agent 的配置散落在多处（系统指令写在代码里、MCP 配置在 DB 中、审批策略硬编码），无法轻松迁移、分享或版本管理。Bundle 将所有配置聚合到一个约定式目录中，只需 `cc agent --bundle <path>` 即可一键加载完整的 Agent 运行环境。

## 核心特性

- 📦 **约定式目录结构**: `chainless-agent.toml` + `AGENTS.md` + `skills/` + `mcp.json` + `USER.md` + `policies/`
- 🌐 **三种运行模式**: `local`（默认）/ `lan` / `hosted`，模式决定 MCP 传输可用性
- 📝 **系统指令注入**: `AGENTS.md` 自动编译为 system prompt，注入 agent 会话
- 🧠 **用户记忆种子**: `USER.md` 按 `##` 小节自动解析为 MemoryStore 条目，幂等写入
- 🔌 **MCP 配置**: `mcp.json` 声明 bundle 依赖的 MCP 服务器，按模式自动过滤
- 🛡️ **审批策略**: `policies/approval.json` 设定会话级 ApprovalGate 策略
- 🏖️ **沙箱策略**: `policies/sandbox.json` 设定 sandbox 生命周期与资源限制
- ⌨️ **CLI 集成**: `cc agent --bundle <path>` / `cc serve --bundle <path>`
- 🖥️ **Desktop IPC**: `bundle:load` / `bundle:info` / `bundle:unload` 三通道
- ✅ **Schema 验证**: 清单字段类型检查 + 模式白名单 + 传输兼容性校验

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

## 清单文件

### TOML 格式（推荐）

```toml
id = "my-code-reviewer"
name = "Code Reviewer Agent"
version = "1.0.0"
defaultModel = "claude-sonnet-4-20250514"
mode = "local"
sandbox = "thread"
```

### JSON 格式

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

### 清单字段参考

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `id` | string | `null` | Bundle 唯一标识（可选） |
| `name` | string | `null` | 显示名称（可选） |
| `version` | string | `"0.1.0"` | 语义版本 |
| `defaultModel` | string | `null` | 默认 LLM 模型 |
| `mode` | string | `"local"` | 运行模式：`local` / `lan` / `hosted` |
| `sandbox` | string | `"thread"` | 沙箱类型 |

## AGENTS.md — 系统指令

`AGENTS.md` 的全部内容会编译为 system prompt 注入 agent 会话。

```markdown
# Code Reviewer Agent

你是一个专注于代码质量的 reviewer，擅长发现安全漏洞、性能问题和可维护性缺陷。

## 审查规则

1. 对每个问题标注严重程度：critical / warning / info
2. 引用具体行号
3. 提供修复建议
4. 最终给出 APPROVE / NEEDS_WORK / REJECT 判定
```

## USER.md — 用户记忆种子

每个 `##` 小节解析为一条 MemoryStore 记忆条目（`scope=user`）。首次加载时写入，已存在的条目不会重复写入（幂等）。

```markdown
## 偏好

- 用户偏好 TypeScript，不喜欢 any 类型
- 团队使用 ESLint + Prettier，缩进 2 空格
- CI 使用 GitHub Actions

## 约定

- 提交信息使用 Conventional Commits
- PR 标题不超过 70 字符
```

## mcp.json — MCP 服务器配置

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

### 运行模式与 MCP 传输兼容性

| 传输类型 | local | lan | hosted |
|----------|-------|-----|--------|
| `stdio` | ✅ | ✅ | ❌ |
| `sse` | ✅ | ✅ | ✅ |
| `streamable-http` | ✅ | ✅ | ✅ |

> `hosted` 模式下含 `stdio` 传输的 MCP 服务器会被自动过滤（防止远程执行本地命令）。

## 审批策略 — policies/approval.json

```json
{
  "policy": "trusted"
}
```

策略值：`strict`（每次工具调用需审批）| `trusted`（仅高风险需审批）| `autopilot`（全自动）

## 沙箱策略 — policies/sandbox.json

```json
{
  "scope": "thread",
  "ttl": 3600000,
  "idleTimeout": 300000
}
```

## 系统架构

```
┌────────────────────────────────────────────────────────┐
│                   Bundle 目录                           │
│  chainless-agent.toml / .json                          │
│  AGENTS.md  USER.md  mcp.json  policies/               │
└──────────────────────┬─────────────────────────────────┘
                       │
┌──────────────────────▼─────────────────────────────────┐
│            agent-bundle-schema.js                       │
│  BUNDLE_FILES 常量 + validateManifest()                 │
└──────────────────────┬─────────────────────────────────┘
                       │
┌──────────────────────▼─────────────────────────────────┐
│            agent-bundle-loader.js                       │
│  loadBundle(path) → { manifest, agentsMd, userMd,      │
│                       mcpConfig, approvalPolicy,       │
│                       sandboxPolicy }                   │
└──────────────────────┬─────────────────────────────────┘
                       │
┌──────────────────────▼─────────────────────────────────┐
│            agent-bundle-resolver.js                     │
│  resolveBundle(bundle) → { systemPrompt, memorySeed[], │
│                            mcpServers[], policies }     │
│  compileAgentsMd(md) → system prompt string            │
│  parseUserMdSeed(md) → memory entries[]                │
│  applyUserMemorySeed(entries, memoryStore)              │
└──────────────────────┬─────────────────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
┌──────────────┐ ┌──────────┐ ┌──────────────┐
│ CLI agent.js │ │CLI serve │ │ Desktop IPC  │
│ --bundle     │ │--bundle  │ │bundle:load   │
│ 交互式会话   │ │WS 服务器 │ │bundle:info   │
│              │ │          │ │bundle:unload │
└──────────────┘ └──────────┘ └──────────────┘
```

### Desktop IPC 通道

| 通道 | 参数 | 返回值 | 说明 |
|------|------|--------|------|
| `bundle:load` | `{ bundlePath, sessionId? }` | `{ ok, data: { bundle, resolved } }` | 加载 bundle，可选绑定到 session |
| `bundle:info` | - | `{ ok, data: { bundle, resolved, loadedAt } \| null }` | 查询当前活跃 bundle |
| `bundle:unload` | - | `{ ok, data: { unloaded: boolean } }` | 卸载当前 bundle |

## 配置参考

### 清单验证规则

```javascript
{
  // 必须
  manifest: "chainless-agent.toml 或 chainless-agent.json 必须存在",

  // mode 白名单
  mode: ["local", "lan", "hosted"],

  // 自动过滤
  hostedStdioFilter: "hosted 模式下含 stdio 的 MCP 服务器自动移除",

  // 幂等种子
  userMdSeed: "已存在的记忆条目不重复写入",

  // 路径
  bundlePath: "必须为绝对路径或可解析为绝对路径",
}
```

### CLI 选项

```bash
# 交互式 Agent 会话
chainlesschain agent --bundle <path>

# WebSocket 服务器（所有连入会话共享 bundle）
chainlesschain serve --bundle <path> --port 18800
```

## 性能指标

### 响应时间

| 操作 | 目标 | 实际 | 状态 |
|------|------|------|------|
| Bundle 加载 (本地 FS) | &lt; 100ms | &lt; 50ms | ✅ |
| TOML 清单解析 | &lt; 10ms | &lt; 5ms | ✅ |
| AGENTS.md 编译 | &lt; 5ms | &lt; 2ms | ✅ |
| USER.md 种子解析 | &lt; 5ms | &lt; 2ms | ✅ |
| USER.md 种子写入 | &lt; 20ms/entry | &lt; 10ms/entry | ✅ |
| MCP 配置解析 + 过滤 | &lt; 10ms | &lt; 5ms | ✅ |

### 资源使用

| 指标 | 数值 |
|------|------|
| Bundle 解析内存 | &lt; 1MB |
| 典型 Bundle 目录大小 | 5-50KB |
| MCP 配置最大服务器数 | 无限制 |

## 测试覆盖率

### 单元测试

```
✅ agent-bundle-schema.test.js         - 14 测试 (目录结构常量/验证规则)
✅ agent-bundle-loader.test.js         - 9 测试 (TOML+JSON加载/错误处理)
✅ agent-bundle-resolver.test.js       - 17 测试 (AGENTS.md编译/USER.md种子/MCP过滤)
✅ mcp-policy.test.js                  - 19 测试 (传输过滤/模式白名单)
✅ sandbox-policy.test.js              - 26 测试 (沙箱策略/TTL/idle)
```

**总覆盖率**: 85 测试（含 mcp-policy + sandbox-policy）

### CLI 集成测试

```
✅ agent-bundle-integration.test.js    - 15 测试 (cc agent/serve --bundle 端到端)
```

### Desktop 测试

```
✅ session-core-ipc.test.js            - 含 bundle:load/info/unload 通道测试
```

## 安全考虑

### MCP 传输安全

1. **模式级过滤** — `hosted` 模式自动禁止 `stdio` 传输，防止远程执行本地命令
2. **配置验证** — MCP 服务器配置经过 `validateMcpServerConfig()` 过滤，缺 name/command 的条目自动跳过
3. **传输白名单** — 仅允许 stdio / sse / streamable-http 三种已知传输

### 审批策略安全

1. **策略注入** — Bundle 的 `policies/approval.json` 直接设定会话级策略，用户知情
2. **默认 strict** — 未指定 approval.json 时，默认使用 `strict` 策略
3. **不可越权** — Bundle 设定的策略不能超过系统级策略上限

### 种子安全

1. **幂等写入** — USER.md 种子仅首次写入，不覆盖已存在的记忆
2. **scope 限制** — 种子默认写入 `scope=user`，不会污染 global 或 session 级记忆
3. **内容审查** — 种子内容可在加载前人工审查（纯 Markdown 文件）

## 故障排查

### 常见问题

**Q: Bundle 加载报 "manifest not found"?**

检查以下几点:

1. Bundle 目录下是否有 `chainless-agent.toml` 或 `chainless-agent.json`
2. 文件名是否正确 — 必须是 `chainless-agent`，不是 `chainless_agent`
3. 路径是否为绝对路径 — 相对路径需要可解析

**Q: hosted 模式下 MCP 服务器消失?**

这是预期行为:

1. `hosted` 模式自动过滤 `stdio` 传输的服务器
2. 如需使用 stdio 服务器，切换到 `local` 或 `lan` 模式
3. 为远程场景改用 `sse` 或 `streamable-http` 传输

**Q: USER.md 种子未写入?**

可能原因:

1. 记忆条目已存在 — 种子是幂等的，已存在则跳过
2. `##` 小节格式不正确 — 需要二级标题 `##`，不是一级 `#`
3. MemoryStore 未初始化 — 检查 `~/.chainlesschain/memory-store.json`

**Q: AGENTS.md 中的指令未生效?**

检查:

1. 文件名是否正确 — 必须是 `AGENTS.md`（全大写）
2. 文件是否在 Bundle 根目录 — 不是在子目录里
3. 使用 `bundle:info` IPC 查看 resolved.systemPrompt 是否包含内容

### 调试模式

```bash
# 查看 bundle 加载结果
node -e "
  const { loadBundle } = require('@chainlesschain/session-core');
  loadBundle('/path/to/bundle').then(b => console.log(JSON.stringify(b, null, 2)));
"

# 查看 resolve 结果
node -e "
  const { loadBundle, resolveBundle } = require('@chainlesschain/session-core');
  loadBundle('/path/to/bundle')
    .then(b => resolveBundle(b))
    .then(r => console.log(JSON.stringify(r, null, 2)));
"
```

## 关键文件

### session-core Bundle 模块

| 文件 | 职责 | 行数 |
|------|------|------|
| `packages/session-core/lib/agent-bundle-schema.js` | 目录结构常量 + 验证 | ~120 |
| `packages/session-core/lib/agent-bundle-loader.js` | 文件系统读取 + TOML/JSON 解析 | ~180 |
| `packages/session-core/lib/agent-bundle-resolver.js` | AGENTS.md→prompt + USER.md→memory | ~220 |
| `packages/session-core/lib/mcp-policy.js` | 模式级 MCP 传输过滤 | ~150 |
| `packages/session-core/lib/sandbox-policy.js` | 沙箱生命周期策略 | ~200 |

### CLI 集成

| 文件 | 职责 |
|------|------|
| `packages/cli/src/commands/agent.js` | `--bundle` 选项，加载 bundle → 注入会话 |
| `packages/cli/src/commands/serve.js` | `--bundle` 选项，所有连入会话共享 bundle |

### Desktop 集成

| 文件 | 职责 |
|------|------|
| `desktop-app-vue/src/main/session/session-core-ipc.js` | `bundle:load/info/unload` IPC 通道 |
| `desktop-app-vue/src/renderer/stores/sessionCore.ts` | `loadBundle/unloadBundle` Pinia actions |

### 测试文件

| 文件 | 测试数 |
|------|--------|
| `packages/session-core/__tests__/agent-bundle-schema.test.js` | 14 |
| `packages/session-core/__tests__/agent-bundle-loader.test.js` | 9 |
| `packages/session-core/__tests__/agent-bundle-resolver.test.js` | 17 |
| `packages/cli/__tests__/unit/agent-bundle-integration.test.js` | 15 |

## 使用示例

### 创建并运行一个 Code Reviewer Bundle

```bash
# 创建 bundle 目录
mkdir my-reviewer && cd my-reviewer

# 创建清单
cat > chainless-agent.toml << 'EOF'
id = "code-reviewer"
name = "Code Reviewer"
version = "1.0.0"
defaultModel = "claude-sonnet-4-20250514"
mode = "local"
EOF

# 创建系统指令
cat > AGENTS.md << 'EOF'
# Code Reviewer

你是代码审查专家。对每个问题标注 critical/warning/info 严重程度，
引用具体行号，提供修复建议，最终给出 APPROVE/NEEDS_WORK/REJECT 判定。
EOF

# 创建审批策略
mkdir policies
echo '{"policy": "trusted"}' > policies/approval.json

# 运行
chainlesschain agent --bundle ./my-reviewer
```

### 带 MCP 的 Full-Stack Agent

```bash
# 创建 mcp.json
cat > mcp.json << 'EOF'
{
  "servers": [
    {
      "name": "filesystem",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."],
      "transport": "stdio"
    }
  ]
}
EOF

# 以 WebSocket 服务器模式运行
chainlesschain serve --bundle . --port 18800
```

### Desktop IPC 加载

```javascript
// Renderer (Pinia store)
const store = useSessionCoreStore();

// 加载
await store.loadBundle({ bundlePath: "/path/to/my-reviewer" });
console.log(store.activeBundle);
// { bundle: { manifest, agentsMd, ... }, resolved: { systemPrompt, ... }, loadedAt }

// 查询
const info = await store.getBundleInfo();

// 卸载
await store.unloadBundle();
```

## 相关文档

- [Session-Core 会话运行时 →](/chainlesschain/session-core)
- [QualityGate 通用质量门控 →](/chainlesschain/quality-gate)
- [代理模式 (agent) →](/chainlesschain/cli-agent)
- [WebSocket 服务器 (serve) →](/chainlesschain/cli-serve)
- [MCP 服务器 (mcp) →](/chainlesschain/cli-mcp)
- [Managed Agents 对标 →](/chainlesschain/managed-agents-parity)

---

> 本文档为 Agent Bundle 完整参考。设计文档详见：
>
> - [92. Deep Agents Deploy 借鉴落地方案](/design/modules/92-deep-agents-deploy)
