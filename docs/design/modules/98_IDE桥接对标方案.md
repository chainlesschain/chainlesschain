# 98. IDE 桥接对标方案 (Claude-Code IDE Integration Parity v1.1)

> **状态**: 🚧 Phase 0 ✅（CLI 发现层 `abe6c561d`）· Phase 1 ✅ MVP（VS Code 扩展 `packages/vscode-extension/` `3c36b2a79`）· Phase 2 ✅（openDiff accept/reject 回传）· Phase 3(JetBrains)/Phase 4(发布) 待办 — v1.1 细化:env 直连发现 / 多根 workspace / transport 实况(无 ws) / openDiff 阻塞 / 生命周期 / 端到端自验 / 安全权限
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
| **lockfile 发现协议** | `~/.claude/ide/<port>.lock`(port+workspaceFolders+authToken) | **无**任何 IDE 发现约定 | **HIGH** | **Phase 0** |
| **集成终端 env 直连** | 扩展在它拥有的集成终端注入端口 env,CLI 直连(免扫描/免猜) | **无** | **HIGH** | **Phase 0** |
| **终端内 IDE 检测** | CLI 检测 VS Code 集成终端自动连 | **无**(`TERM_PROGRAM`/env 零判断) | **HIGH** | **Phase 0** |
| **IDE 工具:getSelection** | 当前选区(file/range/text)注入 agent | 无 | **MEDIUM** | Phase 1(扩展) |
| **IDE 工具:getDiagnostics** | lint/类型错注入 | 无 | **MEDIUM** | Phase 1(扩展) |
| **IDE 工具:openDiff(评审)** | 编辑器原生 diff,用户 accept/reject | 桌面有 worktree 批量评审;编辑器内无 | **HIGH**(IDE 核心价值) | Phase 1(扩展) |
| **VS Code 扩展包** | 官方扩展(marketplace) | 无(仅 Chrome `browser-extension/`) | **HIGH** | Phase 1 |
| **JetBrains 扩展包** | 官方插件 | 无 | **HIGH** | Phase 3(后置) |

### 1.3 已有优势(复用,不重复造轮子)

- **MCP client transport**:`harness/mcp-client.js` 支持 stdio + http/https + **SSE**(`isHttpTransport`)—— 扩展内的 IDE-MCP-server 用 **SSE**,CLI 用现成 client 连,**零新 transport**。⚠️ **`ws` 当前 client 未实现**(`connect` 仅路由 HTTP-family / stdio,其余 throw "not supported");DB schema 虽列 ws 但运行时不通。故本方案 **Phase 0/1 一律 SSE**;若要真·Claude-Code ws 平价,需先给 client 加 ws transport(列为 Phase 3+ 可选项,非阻塞)。
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

目录 `~/.chainlesschain/ide/`(**`0700`**),每个运行中的 IDE 实例写一个 `<port>.json`(**`0600`**):

```jsonc
{
  "ide": "vscode",                 // "vscode" | "jetbrains" | …
  "version": 1,
  "transport": "sse",              // 当前仅 "sse"/"http"(client 已支持);ws 待 client 补
  "url": "http://127.0.0.1:53690/sse",
  "port": 53690,
  "workspaceFolders": [            // 多根工作区(VS Code 可多 folder),数组
    "/abs/workspace/path"
  ],
  "token": "<random-bearer>",      // 每实例随机,localhost 鉴权(走 MCP OAuth Bearer 基建)
  "pid": 12345,
  "started_at": 1718000000000
}
```

约定:
- **localhost only**:`url` host 必须是 `127.0.0.1`/`::1`;非本地一律忽略(防远程伪造)。
- **transport 受限**:只接受 client 已实现的 `sse`/`http`(见 1.3);`ws` 等未知值 → 跳过该锁(不 throw,best-effort)。
- **token 必带 + 文件权限**:CLI 连接注入 `Authorization: Bearer <token>`;扩展侧 server 校验。锁文件 `0600` + 目录 `0700`,防同机他用户读 token 劫持本地 server(共享机器关键)。
- **stale 清理**:`pid` 不存活(`process.kill(pid,0)` 跨平台)**或** mtime 超 TTL(默认 30s,防 pid 复用误判)→ CLI 视为失效跳过(扩展退出应自删,此为兜底)。
- **多根 workspace 匹配**:CLI 选 `cwd` **相等或落在任一 `workspaceFolders[]` 下**的锁;多匹配先按**最长前缀**(最具体的 folder)、再按 `started_at` 最新。

### 2.3 发现的两条路径(env 直连优先,lockfile 扫描兜底)

**路径 A — 集成终端 env 直连(主,确定性):** 扩展拥有它 spawn 的集成终端,在其 env 注入 `CHAINLESSCHAIN_IDE_PORT`(+ `CHAINLESSCHAIN_IDE_TOKEN` 可选,亦可仍从该 port 的锁文件读 token)。CLI 见到 env → **直接锁定该 port 的锁文件**,免扫描、免 workspace 猜测、免多实例歧义。这是最可靠信号,等价 Claude Code 的 `CLAUDE_CODE_SSE_PORT`。

**路径 B — lockfile 扫描(兜底):** 无 env(如用户在外部终端手动 `cd` 进项目跑 `cc`)→ 扫 `~/.chainlesschain/ide/` 按 2.2 的 workspace 匹配挑一条。

新增 `packages/cli/src/lib/ide-bridge.js`(`_deps` 注入 fs/homedir/now/processAlive,可单测):
- `ideLockDir()` → `~/.chainlesschain/ide/`。
- `readIdeLocks()` → 扫目录,解析 `*.json`,丢弃畸形 / 非 localhost / 不支持 transport / stale。
- `isInIdeTerminal(env)` → `env.CHAINLESSCHAIN_IDE_PORT` 存在,或 `TERM_PROGRAM==='vscode'`,或 JetBrains 标记(`TERMINAL_EMULATOR=JetBrains-JediTerm`)。
- `discoverIdeServer({cwd, env})` → **先 env 直连(路径 A)**,否则 workspace 匹配(路径 B),返回一条锁或 null。
- `ideServerToMcpConfig(lock)` → `{ url, transport, headers:{ Authorization:'Bearer '+token } }`,喂给 `setupMcpFromConfig`。

### 2.4 自动连接(Phase 0,接 MCP 解析口)

`resolveAgentMcp`(`runtime/mcp-config.js`)现把 `--mcp-config` 文件经 `loadMcpConfig` → `cc mcp add` 注册经 `loadRegisteredMcp(into:result)` 串联累加。新增**第三步 `loadIdeMcp(into:result)`**:`discoverIdeServer` 命中 → `ideServerToMcpConfig` → 合并进同一 `mcpClient`(沿用现成的 `into` 累加器 seam,零改既有两路)。触发:
- 默认:在 IDE 集成终端内(`isInIdeTerminal`)自动发现并连接;
- `cc agent --ide`:强制启用(即便检测不到终端标记,用于外部终端手动接);
- `cc agent --no-ide`:禁用 IDE 自动连接(兜底)。

**保留名 `ide`**:IDE server 命名固定 `ide`,工具即 `mcp__ide__getSelection` 等,受 permission-rules 治理。若用户已 `cc mcp add ide` 自建同名 server → **用户显式注册优先,IDE 发现让位并打印一次 WARN**(避免本地伪 `ide` 锁静默顶替用户配置)。

### 2.5 两个运行期约束(早定,免返工)

- **`openDiff` 是长阻塞工具调用**:`ide_openDiff` 弹出原生 diff 后 **阻塞到用户 accept/reject**(可能数分钟)。agent 工具循环若对每个工具调用设了超时,会误杀 IDE 评审。约定:**IDE 工具(`mcp__ide__*`)豁免/放宽工具调用超时**(或扩展侧立即返回 `pending` + 后续事件回传,二选一,Phase 1 实测定)。Phase 0 在 `setupMcpFromConfig` 注入 IDE 源时给该 server 标 `longRunning: true` 元数据,供循环识别。
- **IDE 重启 → port 变 → 连接失效**:lockfile 的 port 随 IDE 进程生命周期变化;会话中途 IDE 重启会让已建连接悬空。Phase 0 限定:**连接在 agent 启动时一次性解析**(重启 IDE 需重跑 `cc agent`);自动重发现/热重连列为 Phase 2 增强,文档显式声明此边界,避免用户误期。

---

## 3. 分期实施

### Phase 0 — CLI 发现 + 自动连接(纯 CLI,本方案先落地)

| 项 | 内容 |
|---|---|
| `src/lib/ide-bridge.js` | env 直连 + lockfile 读取 + localhost/transport/stale 过滤 + 终端检测 + 多根 workspace 匹配 + → MCP config(`_deps` 注入) |
| `resolveAgentMcp` 接线 | 第三步 `loadIdeMcp(into:result)` 合并;`--ide`/`--no-ide` flag;保留名 `ide` 让位用户显式注册 |
| `cc ide status\|list\|doctor` 命令 | `list` 列发现到的 IDE server + 产出的 MCP config;**`doctor`** 解释发现**为何失败**(无锁 / 全 stale / workspace 不匹配 / transport 不支持 / 不在 IDE 终端)——自动连接静默失败极难排查,doctor 是必需可见性 |
| 测试 | env 直连 / 扫描兜底 / localhost·transport·stale 过滤 / 多根+最长前缀匹配 / config 生成 纯函数单测;`resolveAgentMcp` 注入 IDE 源 + 保留名让位 的接线测试 |
| **端到端自验(免扩展)** | **无需任何扩展即可全链路验证**:`cc mcp scaffold` 生成一个 SSE MCP server 当"假 IDE",手写一条 `<port>.json` 锁指向它 → 跑 `cc agent --ide` → 确认 `mcp__ide__*` 工具真进 loop 且 Bearer 鉴权通。把整条 connect 路径在扩展存在前就焊死。 |
| 文档 | `docs/cli/managed-agents.md` 记 `cc ide` + lockfile 协议 + env 约定 |

**价值**:即便扩展未出,Phase 0 独立有用 —— 用户能 `cc mcp add` 任意第三方 IDE-MCP-server,并让 cc 自动发现;同时把 lockfile 协议 + env 约定 + 接口冻结,扩展只需"遵循协议写文件 + 跑 server"。**零扩展依赖、零风险、可单测、可端到端自验。**

### Phase 1 — VS Code 扩展 MVP(新 package,净增)✅ 已落 MVP

落地于 `packages/vscode-extension/`(非 workspace 包,零运行时 npm 依赖)。激活时起本地
**Streamable-HTTP MCP server**(`mcp-http-server.js`,纯 Node `http`,Bearer 鉴权)+ 写 lockfile
(`lockfile.js`,0600/0700)+ 注入终端 env(`CHAINLESSCHAIN_IDE_PORT`/`_TOKEN`)+ 暴露 4 工具
`getSelection`/`getDiagnostics`/`getOpenEditors`/**`openDiff`**(命名空间 `mcp__ide__*`)。工具逻辑
(`ide-tools.js`)经注入 `editor` facade 与 `vscode` API 解耦,facade(`vscode-facade.js`)+ 入口
(`extension.js`)是唯二碰 `vscode` 的薄层。

**免 VS Code host 全验证**:`packages/cli/__tests__/unit/vscode-ext-ide-bridge.test.js`(10 测试)用
**真 CLI `MCPClient` 驱动扩展的 MCP server**(initialize→tools/list→tools/call 全 4 工具 + 鉴权拒绝
+ tool error→isError)+ lockfile↔Phase-0 reader 往返契约。这就是 §2 设计的"端到端自验"落地。

**注**:CLI 的 "SSE" 支持实为 **Streamable HTTP POST**(client `_sendHttpRequest` 对 sse/http 都
POST JSON-RPC 读 `application/json`),故 server 走 HTTP POST 即通,无需持久 SSE GET 通道。`openDiff`
的 accept/reject 回传已在 Phase 2 落地(见下)。**剩**:vsce 打包(Phase 4)。

**附带(低成本复用)`@selection`/`@diagnostics` 引用**:CLI 已有 `@file` 引用展开(`file-ref-expander`)。Phase 1 落地后,加 `@selection`/`@diagnostics` 伪引用 → 展开时调 `ide_getSelection`/`ide_getDiagnostics` 把当前选区/诊断注入 prompt(等价 Claude Code 的 at-mention)。纯 CLI 侧增量,不需扩展再改。

### Phase 2 — openDiff accept/reject 回传 ✅ 已落

`openDiff` 现**阻塞到用户裁决**再返回 `{outcome:"accepted"|"rejected", path, finalText?}`:
- **server 侧**(`mcp-http-server.js`):`start()` 置 `requestTimeout=0`/`timeout=0`,长评审(数分钟)的
  HTTP 响应**保持挂起不被切**(localhost+Bearer 可信;CLI HTTP 路径本就无 client 超时,仅 stdio 有 30s)。
- **facade 侧**(`vscode-facade.js`):原生 diff 左=原文(只读)/右=提案(**可编辑**);弹非模态
  `showInformationMessage(Accept/Reject)` 阻塞;**Accept** → 读右侧最终文本(含用户改动)→ WorkspaceEdit
  全量替换目标文件 + save(失败回退 `fs.writeFileSync`)→ 返 `accepted`+`finalText`;**Reject/关闭**(undefined)
  → 不改文件,返 `rejected`(fail-safe 绝不自动应用)。
- **免 host 验证**(同测试文件 +3,共 13):facade `openDiff` 延迟 resolve 模拟用户耗时 → 真 CLI MCPClient
  调用**实测等待 ≥150ms 才拿到 `accepted`+finalText**(坐实响应挂起不被切)+ reject 路径 + server 超时已禁断言。

与桌面 worktree 评审的关系:IDE 内**单文件增量**评审 vs 桌面 worktree **批量**评审,二者互补(附录 A)。
**剩(后续打磨)**:部分接受(hunk 级)、diff 关闭即视为 reject 的事件钩子(当前靠提示按钮)。

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
- **安全**:本地 MCP server 必须 token 鉴权 + 绑 `127.0.0.1` + 锁文件 `0600`/目录 `0700`(防同机他用户读 token 劫持)—— 复用 MCP OAuth Bearer 基建。保留名 `ide` 让位用户显式注册,防伪锁静默顶替。
- **transport 限制**:client 当前无 `ws`,Phase 0/1 走 SSE;真 ws 平价需先补 client transport(Phase 3+ 可选,不阻塞)。
- **长阻塞工具**:`openDiff` 阻塞数分钟,需循环超时豁免(见 2.5),否则误杀评审。
- **生命周期**:IDE 中途重启 → 连接悬空,Phase 0 限"启动时一次性解析",热重连留 Phase 2。
- **JetBrains 平价**翻倍(第二扩展);WSL/Windows 跨边界(`runningInWindows` + 路径翻译)是另一独立工作面。
- **测试**:Phase 0 全可单测 + 可用 `cc mcp scaffold` 假 IDE 端到端自验;扩展侧需 VS Code 扩展宿主,CI 上跑 headless 是额外活。

---

## 5. 决策建议

- **Phase 0 先落**:纯 CLI、可单测、零扩展风险,且**冻结 lockfile 协议 + 接口**,独立可用。**本方案据此开工。**
- **Phase 1+ 视产品意愿**:若有意做 IDE 集成产品线 → MVP 现实(Phase 0 ~2 天 + Phase 1+2 ~2–3 周出能用版本);若只为"对齐功能" → Phase 1+ 超纲,可暂缓,并在文档说明"IDE bridge 协议即 MCP,第三方 IDE-MCP-server 现可手动 `cc mcp add` 接入"。

---

## 附录 A — 不做项(明确边界)

- ❌ 不重写 MCP client / transport / 工具注入(全复用)。
- ❌ Phase 0 不给 client 加 `ws` transport(SSE 够用;ws 仅为真·Claude-Code 字节级平价,列 Phase 3+ 可选)。
- ❌ 不动桌面 worktree 评审(IDE 内 diff 是另一交互维度,互补不替代)。
- ❌ Phase 0 不含任何扩展代码、不引 VS Code 依赖。
- ❌ Phase 0 不做 IDE 热重连(重启 IDE 重跑 `cc agent`)、不做 WSL↔Windows 路径翻译(JetBrains/WSL 是后置独立面)。

---

## 附录 B — 相对 Claude Code 的有意分歧

| 点 | Claude Code | 本方案 | 理由 |
|---|---|---|---|
| 锁文件名 | `<port>.lock` | `<port>.json` | 内容即 JSON,扩展名表意;无互操作需求(双方均首方) |
| 锁目录 | `~/.claude/ide/` | `~/.chainlesschain/ide/` | 品牌隔离,避免与已装 Claude Code 串台 |
| 终端 env | `CLAUDE_CODE_SSE_PORT` | `CHAINLESSCHAIN_IDE_PORT` | 同上;语义一致 |
| 默认 transport | WebSocket | SSE | client 现支持 SSE 不支持 ws,SSE 零新增 |

> 互操作备注:因目录/env 命名分歧,本 CLI **不会**误连用户机上已装的真 Claude Code IDE 扩展(反之亦然)——这是有意的隔离,非缺陷。
