# 98. IDE 桥接对标方案 (Claude-Code IDE Integration Parity v1.0)

> **状态**: 📝 设计中（Phase 0 待落地；Phase 1+ 评估）
> **日期**: 2026-06-10
> **作用范围**: `packages/cli`（Phase 0，CLI 发现层）+ 未来独立 VS Code / JetBrains 扩展包（Phase 1+）
> **对标对象**: Claude Code IDE Integration（VS Code / JetBrains 扩展 + `~/.claude/ide/<port>.lock` 发现协议 + IDE-as-MCP-server）
> **关联文档**: [88. Open-Agents 对标补齐方案](./88_OpenAgents对标补齐方案.md) · [91. Managed Agents 对标计划](./91_Managed_Agents对标计划.md) · [97. 桌面版 UI ClaudeDesktop 重构计划](./97_桌面版UI_ClaudeDesktop重构计划.md) · CLI MCP OAuth（memory `cli_mcp_oauth`）

---

## 1. 概述

### 1.1 背景

ChainlessChain 的 `cc` CLI 与 `desktop-app-vue` 已对齐 Claude Code 的绝大多数 CLI / 桌面能力（permissions / hooks / subagents / output styles / status line / web_search / extended thinking / 多模态 / MCP OAuth；桌面有 worktree 隔离评审 + 多套 rollback）。对照 Claude Code **desktop/IDE** 维度,逐项核实后,唯一**真结构性缺口**是 **IDE 集成**：在真实编辑器(VS Code / JetBrains)内,让 agent 读当前选区 + 诊断、把编辑以**编辑器原生 diff** 提交评审。项目目前是**独立 Electron 应用**,在编辑器里零存在。

**关键洞察:Claude Code 的"IDE bridge"本质就是一个 MCP server。** IDE 扩展内部跑一个本地 MCP server(暴露 `getSelection`/`getDiagnostics`/`openDiff` 等"IDE 工具"),`claude` CLI 作为 MCP **client** 连上去,这些工具就进了 agent 循环;再加一点 CLI 侧的**发现**(`~/.claude/ide/<port>.lock` + 终端环境检测)。

**项目的重型 MCP 管道已全部就绪**,因此 bridge 的 90% 已存在,真缺的只是:**编辑器侧首方扩展**(内部跑 IDE-MCP-server)+ **CLI 自动发现**。本方案把发现层(Phase 0,纯 CLI、可单测、零扩展)与扩展层(Phase 1+,新产品面)分离,先落 Phase 0 把协议与接口定死。

### 1.2 对标差距总览

| 维度 | Claude Code | ChainlessChain 现状 | 差距等级 | 方案 |
|------|-------------|---------------------|---------|------|
| **IDE-as-MCP-server 协议** | IDE 扩展跑 MCP server,暴露 IDE 工具 | MCP client/transport(stdio+http+sse+ws)、`setupMcpFromConfig`、`cc mcp scaffold` 全有 | **LOW**(管道现成) | 复用,不重写 |
| **lockfile 发现协议** | `~/.claude/ide/<port>.lock`(port+workspace+token) | **无**任何 IDE 发现约定 | **HIGH** | **Phase 0** |
| **终端内 IDE 检测** | CLI 检测 VS Code 集成终端自动连 | **无**(`TERM_PROGRAM`/env 零判断) | **HIGH** | **Phase 0** |
| **IDE 工具:getSelection** | 当前选区(file/range/text)注入 agent | 无 | **MEDIUM** | Phase 1(扩展) |
| **IDE 工具:getDiagnostics** | lint/类型错注入 | 无 | **MEDIUM** | Phase 1(扩展) |
| **IDE 工具:openDiff(评审)** | 编辑器原生 diff,用户 accept/reject | 桌面有 worktree 批量评审;编辑器内无 | **HIGH**(IDE 核心价值) | Phase 1(扩展) |
| **VS Code 扩展包** | 官方扩展(marketplace) | 无(仅 Chrome `browser-extension/`) | **HIGH** | Phase 1 |
| **JetBrains 扩展包** | 官方插件 | 无 | **HIGH** | Phase 3(后置) |

### 1.3 已有优势(复用,不重复造轮子)

- **MCP client 多 transport**:`harness/mcp-client.js` 支持 stdio + http/https + SSE + ws —— 扩展内的 IDE-MCP-server 直接用 SSE,CLI 用现成 client 连。
- **工具注入 agent 循环**:`setupMcpFromConfig` 把任意 MCP server 的工具命名空间化(`mcp__<server>__<tool>`)注入 agent loop —— IDE 工具自动可被 LLM 调用。
- **MCP scaffold**:`cc mcp scaffold` 已能生成 http+SSE / stdio MCP server 模板 —— 扩展内 server 复用此骨架。
- **MCP OAuth / Bearer**:刚落地的 `mcp-oauth.js` + connect 时注入 `Authorization: Bearer` —— **直接当扩展↔CLI 的本地 token 鉴权**(防同机进程劫持本地 server)。
- **权限/审批**:`permission-rules` + `--permission-prompt-tool` —— IDE 工具同样受权限网关治理。

---

## 2. 架构

### 2.1 总体(IDE-as-MCP-server)

```
┌─────────────────────────────┐         ┌──────────────────────────────┐
│  VS Code / JetBrains 扩展    │         │  cc agent (CLI, MCP client)  │
│  ┌───────────────────────┐  │  MCP    │                              │
│  │ 本地 MCP server (SSE)  │◀─┼─(SSE)──▶│  setupMcpFromConfig          │
│  │  ide_getSelection      │  │  +Bearer│  → mcp__ide__* 工具进 loop   │
│  │  ide_getDiagnostics    │  │  token  │                              │
│  │  ide_getOpenEditors    │  │         │  agent 读选区/诊断、         │
│  │  ide_openDiff (评审)    │  │         │  把编辑以 openDiff 提交评审  │
│  └───────────────────────┘  │         │                              │
│  写 lockfile ───────────────┼─────────┼─▶ ide-bridge 发现 + 自动连接  │
└─────────────────────────────┘ file    └──────────────────────────────┘
        ~/.chainlesschain/ide/<port>.json
```

- **方向 1(IDE → agent)**:扩展暴露选区/诊断 → agent 上下文。
- **方向 2(agent → IDE)**:agent 调 `ide_openDiff` → 编辑器原生 diff 弹出 → 用户 accept/reject → 结果回 agent。
- CLI 侧只多两件事:**读 lockfile** + **把它当一个 MCP server 连上**(其余全复用)。

### 2.2 Lockfile 协议(Phase 0 定死,供未来扩展遵循)

目录 `~/.chainlesschain/ide/`,每个运行中的 IDE 实例写一个 `<port>.json`:

```jsonc
{
  "ide": "vscode",                 // "vscode" | "jetbrains" | …
  "version": 1,
  "transport": "sse",              // "sse" | "http" | "ws"
  "url": "http://127.0.0.1:53690/sse",
  "port": 53690,
  "workspace": "/abs/workspace/path",   // 用于和 cc 的 cwd 匹配
  "token": "<random-bearer>",      // localhost 鉴权(走 MCP OAuth Bearer 基建)
  "pid": 12345,
  "started_at": 1718000000000
}
```

约定:
- **localhost only**:`url` host 必须是 `127.0.0.1`/`::1`;非本地一律忽略(防远程伪造)。
- **token 必带**:CLI 连接时注入 `Authorization: Bearer <token>`;扩展侧 server 校验。
- **stale 清理**:`pid` 不存活 或 文件 mtime 过老 → CLI 视为失效跳过(扩展退出应自删,但兜底)。
- **workspace 匹配**:CLI 选 `cwd` 落在 `workspace` 下(或相等)的那个;多个匹配取 `started_at` 最新。

### 2.3 CLI 发现层(Phase 0,纯逻辑)

新增 `packages/cli/src/lib/ide-bridge.js`(`_deps` 注入 fs/homedir/now/processExists,可单测):
- `ideLockDir()` → `~/.chainlesschain/ide/`。
- `readIdeLocks()` → 扫目录,解析全部 `*.json`,丢弃畸形/非 localhost/stale。
- `isInIdeTerminal(env)` → `TERM_PROGRAM==='vscode'` 或 `env.CHAINLESSCHAIN_IDE` 或 JetBrains 标记(`TERMINAL_EMULATOR=JetBrains-JediTerm`)。
- `discoverIdeServer({cwd, env})` → 过滤 workspace 匹配 + 选最新,返回一条或 null。
- `ideServerToMcpConfig(lock)` → `{ url, transport, headers:{ Authorization:'Bearer '+token } }`,喂给 `setupMcpFromConfig`。

### 2.4 自动连接(Phase 0,接 MCP 解析口)

`resolveAgentMcp`(`runtime/mcp-config.js`)新增一路 IDE 源:`--mcp-config` 文件 + `cc mcp add` 注册 + **IDE 发现**三者合并进同一个 `mcpClient`。触发条件:
- 默认:在 IDE 集成终端内(`isInIdeTerminal`)自动发现并连接;
- `cc agent --ide`:强制启用(即便检测不到终端标记);
- `cc agent --no-ide`:禁用 IDE 自动连接(兜底)。

IDE server 命名固定为 `ide`,工具即 `mcp__ide__getSelection` 等,受 permission-rules 治理。

---

## 3. 分期实施

### Phase 0 — CLI 发现 + 自动连接(纯 CLI,本方案先落地)

| 项 | 内容 |
|---|---|
| `src/lib/ide-bridge.js` | lockfile 读取 + localhost/stale 过滤 + 终端检测 + workspace 匹配 + → MCP config(`_deps` 注入) |
| `resolveAgentMcp` 接线 | IDE 源合并进 MCP 集;`--ide`/`--no-ide` flag |
| `cc ide status\|list` 命令 | 列发现到的 IDE server + 它会产出的 MCP config(可见性 + 手动核验) |
| 测试 | 发现/过滤/匹配/config 生成纯函数单测;`resolveAgentMcp` 注入 IDE 源的接线测试 |
| 文档 | `docs/cli/managed-agents.md` 记 `cc ide` + lockfile 协议 |

**价值**:即便扩展未出,Phase 0 独立有用 —— 用户能 `cc mcp add` 任意第三方 IDE-MCP-server,并让 cc 自动发现;同时把 lockfile 协议 + 接口冻结,扩展只需"遵循协议写文件 + 跑 server"。**零扩展依赖、零风险、可单测。**

### Phase 1 — VS Code 扩展 MVP(新 package,净增)

激活时起 SSE MCP server + 写 lockfile + 暴露 4 工具:`ide_getSelection` / `ide_getDiagnostics` / `ide_getOpenEditors` / **`ide_openDiff`**(原生 diff + accept/reject 回传,IDE 最高价值)。vsce 打包。

### Phase 2 — openDiff 评审 UX 打磨

编辑器原生 diff 的 accept/reject/部分接受 + 与 worktree 评审的关系梳理(IDE 内增量 vs 桌面 worktree 批量,二者互补)。

### Phase 3 — JetBrains 平价(后置)

第二个扩展(不同 API),同一 lockfile + MCP 协议,CLI 侧零改动。

### Phase 4 — 发布与维护

VS Code Marketplace(vsce)、版本治理、扩展测试宿主接 CI。

---

## 4. 工作量与风险

| 阶段 | 工作量 | 说明 |
|---|---|---|
| **Phase 0** | **小(~1–2 天)** | 纯 CLI,复用 MCP client/OAuth,可单测 |
| Phase 1 | 中–大(~1–2 周) | 新 VS Code 扩展:激活 + MCP server + 4 工具 + 打包 + 扩展测试宿主 |
| Phase 2 | 中 | openDiff 评审交互(VS Code diff API 较重) |
| Phase 3 | 大 | JetBrains 另起一套 |
| Phase 4 | 持续 | marketplace + 维护面 |

**风险/取舍**:
- **新产品面**:VS Code 扩展是独立工具链(vsce / `engines.vscode` / 扩展测试宿主)+ marketplace + 长期维护 —— **Phase 1+ 是新方向,不是补丁**。
- **安全**:本地 MCP server 必须 token 鉴权 + 绑 `127.0.0.1`(防同机进程劫持)—— 复用 MCP OAuth Bearer 基建。
- **JetBrains 平价**翻倍(第二扩展)。
- **测试**:Phase 0 全可单测;扩展侧需 VS Code 扩展宿主,CI 上跑 headless 是额外活。

---

## 5. 决策建议

- **Phase 0 先落**:纯 CLI、可单测、零扩展风险,且**冻结 lockfile 协议 + 接口**,独立可用。**本方案据此开工。**
- **Phase 1+ 视产品意愿**:若有意做 IDE 集成产品线 → MVP 现实(Phase 0 ~2 天 + Phase 1+2 ~2–3 周出能用版本);若只为"对齐功能" → Phase 1+ 超纲,可暂缓,并在文档说明"IDE bridge 协议即 MCP,第三方 IDE-MCP-server 现可手动 `cc mcp add` 接入"。

---

## 附录 A — 不做项(明确边界)

- ❌ 不重写 MCP client / transport / 工具注入(全复用)。
- ❌ 不动桌面 worktree 评审(IDE 内 diff 是另一交互维度,互补不替代)。
- ❌ Phase 0 不含任何扩展代码、不引 VS Code 依赖。
