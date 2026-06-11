# IDE 桥接（IDE Bridge）

> **版本: v0.1 (Design Module 98, 2026-06-10) | 状态: ✅ 五 Phase 全落地（marketplace 上架待 secret）| VS Code + JetBrains 双编辑器 | 4 IDE 工具 | 58+ 专项测试 | 跨语言 interop 实证**
>
> 让 `cc` agent 在真实编辑器（VS Code / JetBrains）内读取当前选区、诊断、打开的文件，并以**编辑器原生 diff** 提交改动评审。核心洞察：**"IDE 桥接"本质就是一个 MCP server** —— 编辑器扩展内跑一个本地 MCP server，`cc` 作为 MCP client 自动连上，编辑器能力就成了 agent 可调用的工具。

## 概述

ChainlessChain 是独立应用，此前在编辑器里"零存在"。对照 Claude Code，唯一真正的结构性缺口就是 **IDE 集成**。IDE 桥接补齐这一缺口，且**复用项目已有的重型 MCP 管道**（client / 多 transport / OAuth / 工具注入），因此 90% 的能力已就绪，真缺的只是：

- **编辑器侧首方扩展**：在 VS Code / JetBrains 内跑一个本地 MCP server，暴露 IDE 工具。
- **CLI 侧发现层**：自动发现运行中的编辑器 server 并连接。

整套方案分五个阶段落地（Design Module 98）：

| Phase | 内容 | 提交 |
|---|---|---|
| **0** | CLI 发现层（lockfile + env 直连 + `cc ide` 命令 + 自动连接） | `abe6c561d` |
| **1** | VS Code 扩展 MVP（MCP server + 4 工具 + 终端 env 注入） | `3c36b2a79` |
| **2** | `openDiff` 阻塞评审 + accept/reject 回传 | `b737e88ec` |
| **3** | JetBrains 平价（纯 JDK 协议核 + IntelliJ glue） | `507b45c7d` |
| **4** | 发布与维护基建（CI 管线 + 版本治理） | `ab70095a7` |
| — | 交互 REPL `--ide`/`--no-ide` 一致性 | `635b0ae0c` |

## 核心特性

### 1. 双发现路径（env 直连优先，lockfile 扫描兜底）

- **路径 A — 集成终端 env 直连（主，确定性）**：扩展在它拥有的集成终端注入 `CHAINLESSCHAIN_IDE_PORT`（+ 可选 `CHAINLESSCHAIN_IDE_TOKEN`），CLI 直接锁定该端口的 server，**免扫描、免歧义**。等价 Claude Code 的 `CLAUDE_CODE_SSE_PORT`。
- **路径 B — lockfile 扫描（兜底）**：用户在外部终端手动 `cd` 进项目跑 `cc` 时，扫描 `~/.chainlesschain/ide/*.json`，按 `workspaceFolders[]` 与 `cwd` 的**最长前缀**匹配挑一条（多匹配取 `started_at` 最新）。

### 2. 四个 IDE 工具（`mcp__ide__*`）

编辑器 server 以保留名 **`ide`** 接入，工具自动进入 agent 循环：

| 工具 | 作用 |
|---|---|
| `getSelection` | 当前文件 + 选中范围 + 选中文本（无编辑器返回 null） |
| `getDiagnostics` | lint / 类型错（可按文件 `path` 过滤） |
| `getOpenEditors` | 打开的标签页，标记当前活动文件 |
| `openDiff` | 打开原生并排 diff 供评审，**阻塞**到用户 accept/reject |
| `executeCode` | 在活跃 Jupyter notebook 的 **kernel** 里执行代码并取回输出（变量跨调用保持）。仅 VS Code 端、需 `ms-toolsai.jupyter` + 运行中 kernel；**条件暴露**——不支持 notebook 的宿主（如 JetBrains 插件）保持 4 工具不变 |

### 3. openDiff 阻塞评审 + accept/reject 回传

`openDiff` 打开编辑器原生 diff（左=原文只读 / 右=提案**可编辑**），**阻塞到用户裁决**再返回：

- **Accept** → 读右侧最终文本（含用户改动）→ 写回目标文件 → 返回 `{ outcome:"accepted", path, finalText }`。
- **Reject / 关闭提示** → 不改文件，返回 `{ outcome:"rejected", path }`（**fail-safe，绝不自动应用**）。

### 4. 双编辑器，CLI 零改动

VS Code 与 JetBrains 写**同一份 lockfile**、说**同一套 MCP 协议**，只有 `ide` 字段不同（`"vscode"` / `"jetbrains"`）。CLI 发现层**编辑器无关**，新增编辑器无需改 CLI 一行。

### 5. 保留名让位 + 安全默认

- 保留名 `ide`：若用户已 `cc mcp add ide` 自建同名 server，**用户显式注册优先**，IDE 自动发现让位并打印一次 WARN。
- localhost 绑定 + 每实例随机 Bearer token + 锁文件 `0600` / 目录 `0700`，防同机其它进程/用户劫持。

### 6. IDE 实时上下文 + 编辑后诊断回喂（自动感知）

桥接连上后 agent 不只是"有工具可调"，还会**主动感知编辑器**（对标 Claude Code 的 at-submit selection sharing 与 diagnostics sharing）：

- **提交时自动共享选区/打开文件**：每次提交 prompt（headless 单轮、stream 每轮、REPL 每条），CLI 自动取一次当前选区 + 打开的标签页，作为 `<ide-context>` 块附进**本轮**用户消息——模型无须自己决定调 `getSelection`。该块**短暂存在**：只进在途消息、不写会话持久化（`--resume` 回放的是你的原话，不是过期的编辑器快照）；IDE 无响应 1.5s 超时放弃，绝不阻塞回合。
- **编辑后诊断自动回喂**：`write_file`/`edit_file` 成功后，CLI 等语言服务器消化变更（默认 600ms），拉取该文件的 **error/warning** 诊断附在工具结果里——模型在**同一循环**内看到自己刚引入的报错并修掉。

两者共用开关 `CC_IDE_CONTEXT=0`（IDE 工具本身仍可被模型显式调用）。

### 7. 编辑审批走 IDE 原生 diff（ask → openDiff accept/reject）

settings 权限规则对 `Write`/`Edit` 配了 `ask`、会话是**交互 REPL**（headless 保持
fail-closed）、IDE 已连时，文件编辑的确认从终端 y/N 升级为**编辑器原生 diff 评审**：

- **Accept** → IDE 自己把（可能被你在右侧顺手改过的）最终文本写盘，**工具自身的写入被跳
  过**——审批替代执行，从机制上杜绝"IDE 写一次、工具又写一次"的双写冲突；结果带
  `appliedVia:"ide-diff"`（你改过则再带 `userEdited:true`）。
- **Reject / 关闭** → 拒绝执行，文件不动（fail-safe）。
- **IDE 中途挂掉 / 拟议内容无法计算**（如 `old_string` 不命中）→ 自动回落终端确认，工具
  照常产出自己的诊断。

`CC_IDE_DIFF_APPROVAL=0` 关闭此路由。

### 8. Chat 面板（编辑器内对话,0.4.0+）

Activity Bar → **ChainlessChain IDE → Chat**:不开终端直接和 agent 对话。面板内部维护
**一个长驻 `cc agent` 双工子进程**(`--input/output-format stream-json
--include-partial-messages`),逐 token 流式渲染回复 + 实时工具调用轨迹 + 多轮上下文。
子进程继承本窗口桥接的 env,因此**实时感知/诊断回喂/IDE diff 审批在面板里自动全部生效**。
需要 `cc` CLI 在 PATH(`npm i -g chainlesschain`,或设 `chainlesschain.cli.path`);
首条消息才启动子进程,Stop 杀进程,下条消息自动重启。

> **PreToolUse hook 的 `ask` 同样走此路由（v0.162.40+）**：settings.json hooks 对文件编辑工具返回 `ask` 决策时，与权限规则 `ask` 一致升级为 IDE 原生 diff 评审，同样的 Accept 替代执行 / Reject fail-safe / IDE 掉线回落终端语义。

## 安装

需要两样东西:**`cc` CLI**(命令行 agent) + **编辑器扩展**(桥接)。

**1. 安装/升级 `cc` CLI**(含 `cc ide`,需 ≥ 0.162.36):

```bash
npm i -g chainlesschain
cc --version          # ≥ 0.162.36
cc ide --help         # 确认有 ide 子命令
```

**2. 安装编辑器扩展（已上架）:**

**VS Code 及兼容编辑器**（VSCodium / Cursor / Gitpod / 通义灵码 …）
- **已发布到 [Open VSX Registry](https://open-vsx.org/extension/chainlesschain/chainlesschain-ide)**。在用 Open VSX 的编辑器里,扩展面板搜 **ChainlessChain IDE** 一键装。
  > 官方 VS Code Marketplace 暂未上架(发布受 Azure 订阅限制),所以**官方版 VS Code 里搜不到**——用上面那些兼容编辑器,或本地 `.vsix` 装(见下)。
- *（官方 VS Code / 离线）* 从源码打本地 `.vsix` 装:
  ```bash
  cd packages/vscode-extension
  npx @vscode/vsce package --no-dependencies
  code --install-extension chainlesschain-ide-*.vsix
  ```

**JetBrains（IDEA / PyCharm / WebStorm …）**
- **已上传 JetBrains Marketplace**(`com.chainlesschain.ide`),**待官方审核**(首发 1–2 天);通过后在 IDE 的 *Settings → Plugins → Marketplace* 搜 **ChainlessChain IDE** 即可装。
- 审核期间可本地装:`./gradlew buildPlugin` 出 `build/distributions/*.zip` → *Settings → Plugins → ⚙ → Install Plugin from Disk*。

**3. 验证:**

```bash
cc ide status         # 在编辑器集成终端里跑 → "In IDE terminal: yes" + 会连的端口
cc ide doctor         # 发现失败时解释原因
```

装好后,扩展会自动起一个 localhost MCP server、写发现 lockfile、并给**新开**的集成终端注入连接信息——之后 `cc agent` 在编辑器里就自动连上了(用法见下「使用示例」)。

## 系统架构

### 整体架构图（IDE-as-MCP-server）

```
┌─────────────────────────────┐         ┌──────────────────────────────┐
│  VS Code / JetBrains 扩展    │         │  cc agent (CLI, MCP client)  │
│  ┌───────────────────────┐  │  MCP    │                              │
│  │ 本地 MCP server (HTTP) │◀─┼─(HTTP)─▶│  resolveAgentMcp             │
│  │  getSelection          │  │ +Bearer │  → mcp__ide__* 工具进 loop   │
│  │  getDiagnostics        │  │  token  │                              │
│  │  getOpenEditors        │  │         │  agent 读选区/诊断、         │
│  │  openDiff (阻塞评审)    │  │         │  把编辑以 openDiff 提交评审  │
│  └───────────────────────┘  │         │                              │
│  写 lockfile ───────────────┼─────────┼─▶ ide-bridge 发现 + 自动连接  │
│  注入终端 env ──────────────┼─env──────┼─▶ CHAINLESSCHAIN_IDE_PORT    │
└─────────────────────────────┘ file    └──────────────────────────────┘
        ~/.chainlesschain/ide/<port>.json
```

- **方向 1（IDE → agent）**：扩展暴露选区/诊断 → agent 上下文。
- **方向 2（agent → IDE）**：agent 调 `openDiff` → 编辑器弹原生 diff → 用户 accept/reject → 结果回 agent。

### 传输协议：Streamable HTTP

CLI 的 MCP client 对 `sse`/`http` 都走 **POST JSON-RPC 读 `application/json`**（捕获 `Mcp-Session-Id` 头），因此编辑器 server 只需处理 POST（`initialize` / `notifications/initialized` / `tools/list` / `tools/call`），**无需持久 SSE GET 通道**。

> ⚠️ CLI client 当前**不支持 `ws` transport**（仅 stdio / http / sse），故 lockfile 的 `transport` 只接受 `sse`/`http`。

### 发现协议：lockfile

每个运行中的编辑器实例写一个 `~/.chainlesschain/ide/<port>.json`：

```jsonc
{
  "ide": "vscode",                       // "vscode" | "jetbrains"
  "version": 1,
  "transport": "http",                   // "sse" | "http"（ws 暂不支持）
  "url": "http://127.0.0.1:53690/mcp",
  "port": 53690,
  "workspaceFolders": ["/abs/ws"],       // 多根工作区，数组
  "token": "<random-bearer>",            // 每实例随机，localhost 鉴权
  "pid": 12345,
  "started_at": 1718000000000
}
```

### 两层结构（以 JetBrains 插件为例）

| 层 | 内容 | IntelliJ SDK 依赖 |
|---|---|---|
| **协议核** | `MiniJson` / `McpServer`（HTTP MCP）/ `LockfileWriter` / `IdeTools` / `EditorFacade` | ❌ 纯 JDK，可独立编译 + 跨语言验证 |
| **编辑器 glue** | `IntellijEditorFacade` / `IdeBridgeService` / `IdeBridgeStartup` / `IdeBridgeTerminalCustomizer` | ✅ 需 SDK 构建 |

VS Code 扩展同理：`mcp-http-server.js` / `lockfile.js` / `ide-tools.js` 纯 Node 无 `vscode` 依赖，`vscode-facade.js` / `extension.js` 是唯二碰 `vscode` API 的薄层。

## 配置参考

### CLI 旗标

| 旗标 | 作用 |
|---|---|
| 默认（无旗标） | 在 IDE 集成终端内**自动**发现并连接 |
| `cc agent --ide` | **强制启用**（即便检测不到终端标记，用于外部终端手动接） |
| `cc agent --no-ide` | **禁用** IDE 自动连接 |

> headless（`cc agent -p`）与交互 REPL（`cc agent`）行为一致。

### 环境变量

| 变量 | 由谁设置 | 作用 |
|---|---|---|
| `CHAINLESSCHAIN_IDE_PORT` | 编辑器扩展（注入集成终端） | env 直连发现的端口 |
| `CHAINLESSCHAIN_IDE_TOKEN` | 编辑器扩展（可选） | Bearer token（也可从 lockfile 读） |
| `CHAINLESSCHAIN_IDE` | 用户 | 手动标记"在 IDE 终端内" |
| `CC_IDE_CONTEXT` | 用户 | `0`/`false`/`off` 关闭实时上下文注入 + 诊断回喂（工具仍可用） |
| `CC_IDE_DIAG_SETTLE_MS` | 用户 | 编辑后等语言服务器重新 lint 的延迟，默认 `600`，`0` 跳过等待 |

### 终端检测信号（`isInIdeTerminal`）

满足任一即视为"在 IDE 终端内"：`CHAINLESSCHAIN_IDE_PORT` 存在 / `TERM_PROGRAM=vscode` / `TERMINAL_EMULATOR=JetBrains-JediTerm` / `CHAINLESSCHAIN_IDE`。

### VS Code 扩展设置

| 设置 | 默认 | 作用 |
|---|---|---|
| `chainlesschain.ide.enabled` | `true` | 是否启动桥接 MCP server |

### lockfile 字段约束

- `url` host 必须是 `127.0.0.1` / `::1`，非本地一律忽略。
- `transport` 仅接受 `sse` / `http`；未知值（如 `ws`）跳过该锁。
- `pid` 不存活**且**文件 mtime 超 30s TTL → 视为 stale 跳过。

## 性能指标

| 维度 | 表现 |
|---|---|
| **发现延迟** | env 直连 = 一次 env 读 + 一次文件读（亚毫秒）；lockfile 扫描 = 一次目录扫 + 每锁一次解析/校验，通常 < 数毫秒（IDE 实例数极少） |
| **连接建立** | 一次 `initialize` + `tools/list` 往返（localhost HTTP）；跨语言 interop 实测近瞬时 |
| **工具调用开销** | 一次 localhost HTTP POST + JSON 编解码；`getSelection`/`getDiagnostics` 受编辑器线程编组约束，非热路径 |
| **openDiff 阻塞** | 时长由**用户**决定（非系统）；CLI HTTP 路径**无 client 超时**（仅 stdio 有 30s），server 端置 `requestTimeout=0`/`timeout=0` 使响应挂起不被切 |
| **并发** | server 用 cached thread pool（JetBrains）/ Node 异步事件循环（VS Code），一个阻塞的 `openDiff` 不会拖住 `initialize` 等其它请求 |
| **资源占用** | 单个 localhost HTTP server + 一个锁文件；无后台轮询、无持久连接 |

## 测试覆盖

IDE 桥接共 **58+ 专项测试**，全部可在**无编辑器宿主**下运行：

| 测试文件 | 数量 | 覆盖 |
|---|---|---|
| `ide-bridge.test.js` | 26 | env/扫描发现、localhost·transport·stale 过滤、多根最长前缀匹配、config 生成、`diagnoseIde` |
| `mcp-config-ide.test.js` | 8 | `resolveAgentMcp` IDE 门控、`loadIdeMcp` 连接 + 保留名让位 |
| `ide-command.test.js` | 6 | `cc ide list/status/doctor`（含 token 脱敏不泄） |
| `vscode-ext-ide-bridge.test.js` | 13 | **真 CLI MCPClient 驱动扩展 server**（initialize→tools/list→tools/call 全 4 工具 + 鉴权拒绝 + openDiff 阻塞回传）+ lockfile↔Phase-0 reader 往返 |
| `ide-bridge-jetbrains.test.js` | 4 | `ide:"jetbrains"` lock 与 vscode 发现/映射一致（CLI 零改动证明） |
| `agent-policy-mcp-config.test.js` | +1 | `--ide`/`--no-ide` 三态经 policy 白名单到达 REPL |
| `ide-context.test.js` | 31 | 实时上下文模块（收集/格式化/截断/超时/kill-switch）+ headless/stream 接线 + `executeTool` 诊断回喂接线 |
| `ide-context-interop.test.js` | 4 | **真扩展 MCP server ⇆ 真 MCPClient** 全链路：`<ide-context>` 渲染、write_file→诊断回传、kill-switch、死 server 降级 |
| `ide-context-e2e.test.js` | 2 | **真 spawn 的 `cc agent -p`**：lockfile/env 发现→Bearer 连接→捕获式假 LLM 证明选区进了模型请求 |

### 跨语言 interop 实证（JetBrains）

本机无 IntelliJ SDK / 无 Kotlin 的情况下，用 `javac --release 8` 编译纯 JDK 协议核，启动 **Java MCP server**，再用**真实 Node CLI MCPClient** 驱动：列全 4 工具、调用 `getSelection`/`openDiff`、错 token 被拒 —— 全通。这证明非-Node 编辑器服务端满足同一协议（复现见 `packages/jetbrains-plugin/README.md` + `interop-smoke.mjs`）。

## 安全考虑

### 网络与鉴权

- **localhost only**：MCP server 绑 `127.0.0.1`，lockfile 的 `url` 非本地一律忽略（防远程伪造）。
- **每实例 Bearer token**：连接注入 `Authorization: Bearer <token>`，server 校验；错 token 直接 401。
- **文件权限**：锁文件 `0600` / 目录 `0700`（POSIX），防同机其它用户读 token 劫持本地 server。

### 防滥用 / fail-safe

- **保留名让位**：用户显式 `cc mcp add ide` 优先，防本地伪 `ide` 锁静默顶替用户配置。
- **openDiff 绝不自动应用**：用户 Reject 或关闭提示（undefined）一律视为拒绝，不动文件。
- **token 脱敏**：`cc ide list/status/doctor` 的 JSON 输出剥去原始 token（只留 `hasToken`），`status` 的 MCP config 头显示 `Bearer ***`。
- **transport 受限**：只接受 client 已实现且可信的 `sse`/`http`。

### 优先级（headless）

权限判定 most-restrictive-wins：settings deny → host deny → settings ask → settings allow；IDE 工具同受 `permission-rules` 治理。

## 故障排除

### 首选：`cc ide doctor`

自动连接是静默的，排查第一步永远是：

```bash
cc ide doctor          # 解释发现为何成功/失败
cc ide doctor --ide    # 以 --ide（强制）的视角诊断
cc ide list            # 列出发现到的 IDE server（token 不显）
cc ide status          # 此刻会连哪台 + 它的 MCP config（token 脱敏）
```

### 常见问题

| 现象 | 原因 / 处理 |
|---|---|
| `no live IDE lockfiles` | 编辑器扩展未运行 / 已禁用（VS Code 查 `chainlesschain.ide.enabled`）/ 锁已 stale |
| `lockfiles present but none match cwd's workspace` | `cwd` 不在任一 `workspaceFolders` 下 → `cd` 进工作区，或 `cc agent --ide` 强制取最新 |
| 不在 IDE 终端却想连 | 用 `cc agent --ide` 强制 |
| 锁存在但连不上 | 端口被占/扩展重启 → 端口变（Phase 0 启动时一次性解析，中途重启 IDE 需重跑 `cc agent`） |
| Windows 上 workspace 不匹配 | 真扩展写原生路径（`C:\...`）；若手写锁用了 MSYS 路径（`/c/...`）会与 `process.cwd()` 不匹配 |
| `cc mcp add ide` 后 IDE 不自动连 | 设计如此——显式注册优先，看 WARN |

### 调试

- `cc ide doctor --json` 输出 `inIdeTerminal` / `locks[].matchScore` / `reason`，定位匹配失败点。
- VS Code：命令面板 *ChainlessChain IDE: Show Bridge Status* / *Restart Bridge*；输出面板 "ChainlessChain IDE" 频道。
- JetBrains：Tools 菜单 *ChainlessChain IDE: Show Bridge Status*。

## 关键文件

### CLI 侧（`packages/cli/`）

| 文件 | 作用 |
|---|---|
| `src/lib/ide-bridge.js` | 发现层：env 直连 + lockfile 扫描 + 过滤 + 匹配 + `diagnoseIde` |
| `src/runtime/mcp-config.js` | `loadIdeMcp` + `resolveAgentMcp` 第三步（门控 + 保留名让位） |
| `src/commands/ide.js` | `cc ide list/status/doctor` |
| `src/commands/agent.js` | `--ide`/`--no-ide` 旗标 + 透传 |
| `src/runtime/policies/agent-policy.js` | 把 IDE 三态带进交互 REPL |

### VS Code 扩展（`packages/vscode-extension/`）

| 文件 | 作用 |
|---|---|
| `src/mcp-http-server.js` | Streamable-HTTP MCP server（纯 Node，无 vscode 依赖） |
| `src/lockfile.js` | 写/删 lockfile |
| `src/ide-tools.js` | 4 工具（注入 editor facade） |
| `src/vscode-facade.js` / `src/extension.js` | 唯二碰 vscode API 的薄层 |

### JetBrains 插件（`packages/jetbrains-plugin/`）

| 文件 | 作用 |
|---|---|
| `src/main/java/com/chainlesschain/ide/*.java` | 纯 JDK 协议核（MiniJson/McpServer/LockfileWriter/IdeTools） |
| `src/main/java/com/chainlesschain/ide/intellij/*.java` | IntelliJ glue（facade/service/startup/terminal） |
| `src/main/resources/META-INF/plugin.xml` | 插件清单 |
| `build.gradle.kts` | IntelliJ Platform Gradle 构建 |

### 发布 / 文档

| 文件 | 作用 |
|---|---|
| `.github/workflows/ide-extensions.yml` | 两扩展打包/发布 CI（tag + secret 双门控） |
| `docs/internal/ide-extensions-releasing.md` | 发版与维护 runbook |
| `docs/design/modules/98_IDE桥接对标方案.md` | 设计方案（五 Phase） |

## 使用示例

### 在 IDE 集成终端内（最常见）

```bash
# 装好编辑器扩展后，在 VS Code / JetBrains 的集成终端里：
cc ide status                         # 确认桥接已起、会连哪台
cc agent -p "修一下我选中的这段代码"    # 自动连接，agent 能看到选区/诊断
```

### 外部终端手动连接

```bash
cd /path/to/project
cc agent --ide -p "看下当前打开的文件有没有类型错误"   # 强制启用 + workspace 匹配
cc agent --no-ide -p "..."                          # 显式禁用
```

### 让 agent 提交一次原生 diff 评审

```text
# agent 内部调用 openDiff，编辑器弹出原生 diff：
#   左=原文（只读）  右=提案（可编辑）
# 你 Accept → 改动写入文件并返回 finalText
# 你 Reject → 文件不变，agent 收到 rejected
```

### 排查与可见性

```bash
cc ide list --json      # 机读：发现到的 server（token 脱敏）
cc ide doctor           # 解释发现成功/失败的原因
```

### 打包扩展（发布）

```bash
# VS Code
cd packages/vscode-extension && npx @vscode/vsce package --no-dependencies   # → .vsix

# JetBrains（需 IntelliJ SDK）
cd packages/jetbrains-plugin && ./gradlew buildPlugin                        # → plugin .zip
```

## 相关文档

- [设计方案 · Module 98 IDE 桥接对标方案](/design/modules/98-ide-bridge) — 五 Phase 完整设计
- [`cc agent` 托管智能体](/chainlesschain/cli-agent) — agent CLI 与 `## IDE Bridge` 章节
- [MCP 集成](/chainlesschain/cli-mcp) — 复用的 MCP client / 多 transport / Bearer 鉴权基建
- [Cowork 多智能体协作](/chainlesschain/cowork) — 桌面侧 worktree 批量评审（与 IDE 内增量评审互补）
- 发版 runbook：`docs/internal/ide-extensions-releasing.md`
