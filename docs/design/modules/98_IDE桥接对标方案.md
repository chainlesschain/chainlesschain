# 98. IDE 桥接对标方案 (Claude-Code IDE Integration Parity v1.1)

> **状态**: ✅ 全 7 Phase 落地 + 双端已上架 — Phase 0 ✅（CLI 发现层 `abe6c561d`）· Phase 1 ✅（VS Code 扩展 `3c36b2a79`）· Phase 2 ✅（openDiff accept/reject `b737e88ec`）· Phase 3 ✅（JetBrains:协议核+interop 实证 `507b45c7d`,IntelliJ glue 已 against 真 SDK 构建出 `.zip`）· Phase 4 ✅（已发布:**VS Code 扩展上架 Open VSX** `chainlesschain.chainlesschain-ide`;**JetBrains 插件上传 Marketplace** v0.1.0 待审）· Phase 6 ✅（Chat Panel P0:webview 驱动长驻 stream-json 双工子进程,实时感知/diff 审批自动组合生效)· Phase 5 ✅（IDE 实时感知:提交时 `<ide-context>` 选区/打开文件自动注入 + 编辑后诊断回喂 `391a24767`+`2fbb03b1a`）— v1.1 细化:env 直连发现 / 多根 workspace / transport 实况(无 ws) / openDiff 阻塞 / 生命周期 / 端到端自验 / 安全权限
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

### Phase 3 — JetBrains 平价 🚧 协议核已落 + 验证,IntelliJ glue 待 SDK 构建

落地于 `packages/jetbrains-plugin/`。**分两层**:
- **协议核**(`com.chainlesschain.ide`,**纯 JDK 无 IntelliJ 依赖**):`MiniJson`(零依赖 JSON)+ `McpServer`
  (`com.sun.net.httpserver` 跑同一 Streamable-HTTP MCP 协议 + Bearer)+ `LockfileWriter`(写
  `<port>.json`,`ide:"jetbrains"`,0600/0700)+ `IdeTools`/`EditorFacade`(同 4 工具,注入 facade)。
- **IntelliJ glue**(`com.chainlesschain.ide.intellij`,SDK-bound):`IntellijEditorFacade`(Editor/PSI/Diff
  API)+ `IdeBridgeService`(生命周期)+ `IdeBridgeStartup`(postStartupActivity)+
  `IdeBridgeTerminalCustomizer`(注入终端 env)+ `ShowStatusAction`;`plugin.xml` + `build.gradle.kts`
  (`org.jetbrains.intellij.platform`)。

**"CLI 侧零改动" 已被实证(双重)**:① CLI 单测 `ide-bridge-jetbrains.test.js`(4 测试)证 `ide:"jetbrains"`
lock 被 Phase-0 发现/映射与 vscode 完全一致(含 vscode/jetbrains 共存取最新)。② **跨语言 interop 实跑**
(本机无 IntelliJ SDK / 无 Kotlin):`javac --release 8` 编译纯 JDK 协议核 → `InteropSmokeMain` 起 Java
MCP server → **真 Node CLI `MCPClient` 驱动**列 4 工具 + call getSelection/openDiff + 错 token 拒,全通(见
`packages/jetbrains-plugin/README.md` 复现步骤 + `interop-smoke.mjs`)。

**剩**:IntelliJ glue 层需 JetBrains SDK 构建(`./gradlew buildPlugin`,本机无 SDK,code-complete 待构建,
类比 VS Code 扩展待 Extension Host);`getDiagnostics` markup 遍历 + `LocalTerminalCustomizer` 签名按目标
平台版本微调;Marketplace 发布(Phase 4)。

### Phase 4 — 发布与维护 ✅ 已发布

**两端均已上架**(2026-06-10):
- **VS Code 扩展** → **Open VSX Registry**:[`chainlesschain.chainlesschain-ide`](https://open-vsx.org/extension/chainlesschain/chainlesschain-ide) v0.2.1,VSCodium / Cursor / Gitpod / 通义灵码 等可直接搜装。**官方 VS Code Marketplace 被挡**(发布需 Azure DevOps org,而建 org 现强制要 Azure 订阅,无),故主渠道走 Open VSX。
- **JetBrains 插件** → **JetBrains Marketplace**:`com.chainlesschain.ide` v0.1.0 已上传(`gradlew publishPlugin`,token 有效、无需签名),**待 JetBrains 人工审核**(首发 1–2 天)。

发布管线 + 版本治理 + 维护文档:
- **CI** `.github/workflows/ide-extensions.yml`:VS Code job(`@vscode/vsce package` → `.vsix` 产物上传;
  tag `ide-vscode-v*` + `VSCE_PAT` 才 `vsce publish`)+ JetBrains job(`./gradlew buildPlugin` → 插件 zip;
  tag `ide-jetbrains-v*` + `JETBRAINS_PUBLISH_TOKEN` 才 `publishPlugin`)。**普通 push 只 build+上传产物,
  publish 仅 tag+secret 双门控**;缺 secret 显式 fail-fast(不静默"成功");不建 GitHub Release(避开
  immutable-release/tag-burn 陷阱);无 `continue-on-error` 假绿。
- **VS Code 打包本机实证**:`npx @vscode/vsce package --no-dependencies` 真出 **13.3 KB `.vsix`**(11 文件:
  manifest+LICENSE+CHANGELOG+README+5 src,无 node_modules/tests)。
- **JetBrains**:vendored gradle wrapper(8.7,复用 android 仓的 jar)+ `build.gradle.kts` 加 publishing/signing
  token(读 env secret);buildPlugin 需 IntelliJ SDK 故只在 CI runner 构建。
- **版本治理 + 维护文档**:`docs/internal/ide-extensions-releasing.md`(版本/CHANGELOG/tag/secret/marketplace
  注册/陷阱清单)+ 各扩展 LICENSE(MIT)+ CHANGELOG。

**自动发布**:本机已存 `OVSX_PAT` + `JETBRAINS_PUBLISH_TOKEN` 用户环境变量(`npm run publish:ovsx` /
`gradlew publishPlugin` 自动认证);CI `ide-extensions.yml` tag `ide-vscode-v*` 触发 Open VSX(+官方
marketplace iff 有 `VSCE_PAT`)、`ide-jetbrains-v*` 触发 JetBrains。升级新版只需 bump version + CHANGELOG。
**剩**:官方 VS Code Marketplace（需 Azure 订阅,见上,可选）;JetBrains 审核通过后公开。

### Phase 6 — Chat Panel(编辑器内原生对话面板)✅ P0 已落 (2026-06-11)

对标 Claude Code 当前主形态(VS Code sidebar 对话面板)。**核心洞察:CLI 已有完整的
SDK 式双工**(`--input-format stream-json` 多轮 stdin + `--output-format stream-json
--include-partial-messages` 逐 token NDJSON)——面板不需要任何新协议,就是一个 webview
驱动一个长驻 `cc agent` 子进程;且子进程 env 注入本窗口的
`CHAINLESSCHAIN_IDE_PORT/_TOKEN` 后,**Phase 5 的全部实时感知(选区注入/诊断回喂)与
gap #4 的 IDE diff 审批自动点亮**——三个 feature 在面板里零额外代码组合生效。

**P0 实现**(`packages/vscode-extension/src/chat/`,0.4.0):
- `agent-session.js`(纯 Node,`deps.spawn` 注入):长驻子进程生命周期 + NDJSON 双向
  marshal(chunk 边界拼接、非 JSON 行降级 raw 事件、stderr 行回调、spawn 失败 →
  `session_error` 事件);`send()` 写一行 user 事件,`end()` 关 stdin 优雅收场,
  `stop()` 硬杀。Win 上 `shell:true`(npm 全局 shim 是 .cmd)。
- `chat-events.js`(纯函数):NDJSON 事件 → UI 消息小词表(init/delta/tool/tool_done/
  info/turn_end/error);**delta 去重**——本轮流过 delta 则 final result 文本置 null,
  防止答案渲染两遍。
- `chat-html.js`:自包含 webview HTML(严格 CSP+nonce、零外部资源、VS Code CSS 变量
  主题适配);`chat-view.js`(唯一碰 vscode 的 glue):WebviewViewProvider,**懒生成**
  (首条消息才 spawn,退出后下条消息自动重启),dispose 杀子进程。
- 接线:Activity Bar 容器新增 `Chat` webview view;`chainlesschain.cli.path` 配置
  (默认 PATH 上的 `cc`)。
- **测试 11**:`vscode-ext-chat-panel.test.js` 10(事件映射全词表 + 假子进程
  chunk-split/stderr/exit/spawn-fail + **真 node 子进程**管道往返 + HTML CSP smoke)
  + `chat-panel-e2e.test.js` 1(**真 cc bin** ⇆ 流式假 ollama:init → 逐 token
  delta → 双轮 result → `end()` 退出码 0)。
- **P1 首切片已落**(0.4.1):New 会话按钮 + `chainlesschain.chat.provider/model` 设置
  (buildSessionArgs 纯函数映射,空值回落 CLI 配置)。
- **P1 会话续接已落**(0.5.0 + CLI stream 持久化):显式 session id опt-in JSONL
  持久化(镜像 runner 的 store seam,匿名运行零变化),resume 重建历史(新 system
  prompt 领跑、丢持久化 system 轮),init 事件带 resumed_messages;面板存 workspaceState
  自动 --resume,New 清除。e2e 实证跨进程续接(子进程 #2 的 LLM 请求含 #1 轮次)。
- **P1 plan-mode UI 已落**(0.6.0):stream plan 控制事件(enter/approve/reject)+
  plan_update 快照,approve 注入 [PLAN APPROVED] 后自跑续轮;面板 Plan 卡片。
- **P1 停止单轮已落**(0.7.0 + CLI 并发 stdin 泵):stream 输入改为与 turn 并发消费,
  {type:interrupt} 即时 abort 当前轮的 AbortController(信号贯穿到 LLM fetch),
  emit result subtype:interrupted(非错误),会话存活;面板 Stop/Esc 触发,杀进程移到 New。
  e2e 实证:慢响应挂 60s 被中断秒断、同一子进程下一轮正常应答。
- **P1 审批路由已落**(0.9.0 + CLI 0.162.45 `--interactive-approvals`):confirm 级
  决策(ApprovalGate 危险 shell + settings/hook ask)opt-in 变成 approval_request/
  {type:approval} 双工往返(走 interrupt 同款并发泵,阻塞工具等裁决,timeout/stdin-close
  fail-closed);面板 Approve/Deny 卡片。CI/管道不加 flag 仍 fail-closed 不变。e2e:真 CLI
  批准→文件落盘 / 拒绝→不写。
- **P1 会话选择器已落**(0.10.0):/sessions QuickPick(经 cc session list --json,
  不复刻 home 解析);面板 slash 命令已落(0.9.0)。
- **hunk 级部分接受已落**(0.12.0):openDiff 评审加 Pick hunks…(纯函数 diff-hunks.js
  LCS 行 diff→可勾选块,双不变量 apply-all==proposal/apply-none==original,超大 diff
  size-guard 退化整块);原生 QuickPick 多选,零自绘编辑器。CLI 零改动(仍 accepted+finalText)。
- **LLM 配置引导已落(双端)**(VS Code 0.11.x + JetBrains 0.2.0):用户反馈"无配置
  引导/便捷入口"。统一模式=编辑器只做薄向导壳:10 提供商预设(id 对齐 CLI
  BUILT_IN_PROVIDERS),写入一律走 `cc config set llm.*`(单一真相 config.json,key 不进
  编辑器设置),`cc llm test` 验证连通;Windows 经 shell 跑 .cmd shim 无法可靠引号→不安全
  字符前置拒绝。入口:VS Code 命令面板+Chat 面板 ⚙+未配置/连接失败自动弹引导卡;
  JetBrains Tools 菜单(纯 JDK 核 LlmConfig+SDK 薄对话框,smoke 35 项含真 cc 往返)。
- **hunk 挑块真机验证**(0.12.1):VSCodium 实测全链路;**教训:阻塞型 QuickPick 必须
  ignoreFocusOut**(用户截图/切窗即失焦取消,连吞三轮演示)。
- **剩(P1+)**:diff 按钮内联化(长期)。

### Phase 5 — IDE 实时感知(自动上下文 + 诊断回喂)✅ 已落 (2026-06-10)

桥接从"被动工具箱"升级为"主动感知"(对标 Claude Code 的 at-submit selection sharing 与
automatic diagnostics sharing),纯 CLI 侧增量、扩展零改动:

- **提交时 `<ide-context>` 注入**(`391a24767`):`src/lib/ide-context.js` 新模块;三入口
  (headless-runner / headless-stream / agent-repl)在 UserPromptSubmit hook 注入点之后、
  user 消息入列之前调 `buildIdePromptContext(mcp)` —— 自动取 `getSelection` + `getOpenEditors`
  拼为 `<ide-context>` 块(选区截断 2000 字符 / 最多列 10 个 tab)。**Ephemeral 设计**:
  只进在途消息,持久化存的是用户原话(headless persist 在 MCP 解析之前;REPL 持久化
  `effectivePrompt` 而非 `userContent`),`--resume` 不回放过期编辑器快照。1.5s 超时、
  全程 never-throw,IDE 死掉绝不拖垮回合。多模态兼容(`appendTextToContent` 对 `--image`
  的 content 数组追加 text part)。
- **编辑后诊断回喂**(`2fbb03b1a`):agent-core `executeTool` wrapper 在
  `write_file`/`edit_file`/`edit_file_hashed` 成功后,等语言服务器消化(默认 600ms,
  `CC_IDE_DIAG_SETTLE_MS` 覆盖)再拉该文件 **error/warning**(info/hint 过滤,cap 10)
  → `toolResult.ideDiagnostics`,与 PostToolUse `hookFeedback` 同通道回喂模型 ——
  同一循环内自修刚引入的报错。
- **开关**:`CC_IDE_CONTEXT=0` 一并禁用两者(`mcp__ide__*` 工具仍可显式调用)。
- **测试 37**(`7c6b6266a`):单测 31(模块 + headless/stream/executeTool 接线)+ 集成 4
  (真扩展 MCP server ⇆ 真 MCPClient 全链路)+ e2e 2(**真 spawn `cc agent -p`** + lockfile
  发现 + 捕获式假 ollama 证明选区抵达模型请求;教训:假 server 在 vitest 进程内时必须
  **异步 spawn**,`spawnSync` 阻塞事件循环 → 死锁)。

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
