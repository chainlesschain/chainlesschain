# Claude Code IDE 插件对照优化建议

更新时间：2026-07-10

本文对照 Claude Code 官方 VS Code / JetBrains IDE 插件能力，梳理 ChainlessChain IDE 插件后续值得补齐和优化的方向。

参考资料：

- Claude Code VS Code 文档：https://code.claude.com/docs/en/vs-code
- Claude Code JetBrains 文档：https://code.claude.com/docs/en/jetbrains
- Claude Code Remote Control 文档：https://code.claude.com/docs/en/remote-control

## 当前基线

本地 IDE 插件已经具备较多基础能力：

- VS Code 插件已有 chat view、native diff、diagnostics、memory、LLM 配置、App Preview、CLI upgrade、completion、team monitor 等入口。
- JetBrains 插件已有 chat tool window、MCP server、multi-diff、preview、session、slash commands、team monitor 等模块。
- 最近一轮 IDE 插件审计已覆盖多项 P0/P1/P2 安全、并发、diff、session 和性能问题。

因此下一轮不应只追求“把 CLI 功能搬进 IDE”，而应优先补齐 IDE 原生工作流：计划审阅、上下文选择、权限确认、diff 反馈、远程续接、多会话并行和图形化插件管理。

## 本轮实施状态

- 已完成：Plan Review editor tab + inline comments。VS Code 与 JetBrains 均已支持真实 Markdown editor tab、inline comments、批准、拒绝、要求修改、重新生成计划；批准/拒绝会携带计划审阅快照写回会话，CLI/SDK 协议已支持审阅 payload。
- 已部分完成：Session history / remote resume 统一模型。新增共享 IDE session index，VS Code 与 JetBrains 都写入 `~/.chainlesschain/ide/session-index.json`，会话 picker 合并 CLI session list 与 IDE index，列表可展示 IDE 来源和状态，为跨 IDE/跨 workspace 搜索与后续 remote handoff 打基础。picker 已升级为两步式（选会话 → Resume / Rename / Delete）：status 与 workspace 进入 picker 行参与模糊搜索（跨 workspace 检索）；Rename 走 IDE index title overlay（对 CLI-only 会话同样生效）；Delete 统一走 `cc session delete --force` + IDE index 清理，并清空指向该会话的 tab resume id。
- 已部分完成：IDE MCP parity。VS Code / JetBrains bridge 已统一增加 `getActiveFile` 工具，agent 可直接读取 active file、language、dirty state 和 cursor，不再只能从 selection 间接推断。
- 已完成首版：remote/cloud session handoff 的 IDE 入口。两端 `/handoff` 把当前对话转成后台 agent（`cc agent --bg --resume <sessionId>`），可从浏览器 web-panel 后台面板、`cc attach`、IDE Background Agents 面板续接；两端新增 Remote Control 命令（VS Code `chainlesschain.remote.control` / JetBrains Tools → Remote Control）封装 `cc remote-control start/status/stop --json`，展示一次性配对 URI（手机/网页配对后可 observe/prompt/approve/interrupt 本机 agent），状态查看与停止、断线后 `--prune` 清理死宿主并重启重发 token。
- 已基本完成：IDE MCP parity（P0 #3）。JetBrains `getTerminalOutput` 已对齐；双端新增 `getPreviewState`（dev server URL + 输出尾）；大 payload/超时/token/trust 统一审计完成（修 VS token 时序比较 + 显式 untrustedWorkspaces 声明，详见 §3）。notebook JetBrains 对齐判 product-blocked；页面侧 browser state 归入 P1 #8 Chrome connector 方向。

## P0：优先补齐

### 1. Plan Review 作为一等工作流

状态：已完成首版。

Claude Code VS Code 的 Plan mode 会打开完整 Markdown 计划文档，用户可以在文档中直接加 inline comments，再批准执行。

建议：

- VS Code / JetBrains 都将计划审阅做成真实 editor tab，而不是普通聊天消息。
- 支持 inline comments、批准、要求修改、重新生成计划。
- 批准后将计划快照写入会话，方便审计和回放。
- JetBrains 侧可用 Markdown editor + gutter action 实现。

已落地：

- VS Code 在收到 `plan_update` 后打开/同步可编辑 Markdown review document，并在 editor title 提供 Approve、Request changes、Regenerate、Reject 命令。
- JetBrains 在收到 active plan 后打开 Markdown editor tab，保留 reviewer 已编辑内容，计划卡提供 Request changes、Regenerate、Approve、Reject。
- `approve` / `reject` 会发送 `{ type: "plan", action, review }`，review 内含会话、计划状态、条目数量和截断后的 Markdown 快照。
- `requestChanges` / `regenerate` 会把 review 文档内容作为用户反馈 prompt 发回 agent。

### 2. 会话历史和远程续接

状态：已部分完成。

Claude Code VS Code 支持本地/远程会话历史、多 tab/window、搜索、重命名、删除和恢复关闭会话。

建议：

- 做统一 session index，覆盖 VS Code 与 JetBrains。
- 支持跨 workspace 的会话搜索、重命名、删除、恢复。
- 支持 remote/cloud session handoff，能从手机或浏览器续接本地 IDE 会话。
- 会话列表展示状态：running、waiting approval、errored、stopped、completed。

已落地：

- 新增共享 index：`~/.chainlesschain/ide/session-index.json`，只保存 metadata，不保存 transcript。
- VS Code / JetBrains 均在会话运行、等待审批、完成、错误、停止等生命周期写入 index。
- VS Code `/sessions` picker 合并 `cc session list --json` 与共享 IDE index；JetBrains `/sessions` picker 同步合并两类来源。
- index 字段覆盖 `sessionId`、title、IDE 来源、conversation id、workspace、状态、权限模式和更新时间。
- 两端 `/sessions` picker 升级为两步式：选中会话后可 Resume / Rename / Delete。
- 搜索：status 与 workspace 进入 picker 行（VS Code matchOnDescription/matchOnDetail；JetBrains popup speed search），支持跨 workspace 检索。
- 重命名：写入 IDE index 的 title overlay（merge 时 IDE title 优先），CLI-only 会话（CLI 无 rename 命令）同样生效。
- 删除：`cc session delete <id> --force` 删 CLI transcript + IDE index 条目清理（另一端 picker 不再出现）+ 指向该会话的 tab resume id 置空（防止下一条消息 `--resume` 已删除会话），删除前有 modal 确认。
- 恢复关闭会话：VS Code 有 tab reload 持久化，JetBrains 有 reopen-closed（§6），picker resume 覆盖任意历史会话。
- remote/cloud session handoff（首版）：
  - `/handoff`（两端）：停掉面板子进程，`cc agent --bg --resume <sessionId> -p <prompt>` 把同一会话转成后台 agent（后台 worker 成为该会话唯一写者），从浏览器 web-panel 后台面板、`cc attach <id>`、IDE Background Agents 面板均可续接；tab 稍后可重新 pick 该会话回到 IDE。
  - Remote Control 命令（两端）：启动 `cc remote-control start --json` 配对宿主（长驻子进程），解析配对 JSON 展示一次性 URI（复制到剪贴板/QR 由 CLI 终端渲染），`status --json --prune` 列宿主并清理死 pid，`stop --port` 优雅停止（VS Code 兜底 taskkill 树杀 / JetBrains destroyForcibly 后代进程）。
  - 断线恢复：宿主意外退出时 IDE 弹提示（重启重发一次性 token）；`--prune` 清掉硬杀残留的 state 文件。

剩余：

- 配对 URI 的 IDE 内 QR 渲染（现引导用 CLI 终端 QR 或直接粘贴 URI）。
- relay（E2EE 跨网）配置的 IDE 设置面（现走 CLI env/config）。

### 3. IDE MCP 能力补齐和统一

状态：已部分完成。

官方 IDE 插件内置 IDE MCP server，用于读取 selection、打开 diff、访问 IDE 上下文等。

建议统一两端能力：

- selection、open editors、active file、diagnostics、terminal output。
- native diff、multi-file diff、accept/reject hunk。
- notebook/Jupyter cell 读取和执行。
- preview/browser state：DOM、console、network、screenshot。
- 大 payload 分片、超时、鉴权 token、workspace trust 边界。

已落地：

- VS Code / JetBrains 已统一暴露 `getActiveFile`，返回 active file、language、dirty state、cursor。
- 既有能力已覆盖 selection、diagnostics、open editors、native diff、multi-file diff；VS Code 侧已有 terminal output 与 notebook executeCode 条件工具。
- JetBrains `getTerminalOutput`：与 VS Code 同名同字段（terminal/command/exitCode/output）的条件工具。JetBrains 终端无 per-command shell integration API，返回每个终端 tab 的 buffer tail（16k 上限，classic JediTerm widget；reworked 终端 tab 报名字+空输出而非丢弃）。terminal 插件缺席时返回空列表，与 VS Code「无 shell integration 则为空」契约一致；bundled 依赖仅编译期（同 `com.intellij.java` 先例），plugin.xml 不加硬依赖。

- `getPreviewState`（双端）：App Preview dev server 的 running/URL/npm script/最后退出码/最近输出尾（16k，URL 检出后仍持续捕获——构建/运行时报错恰好发生在其后）。agent 由此拿到预览 URL 与 server 侧报错，无需用户贴终端；页面内容可由 agent 自行抓取该 URL。
- 大 payload/超时/token/workspace trust 统一审计（2026-07-10 完成，结论如下）：
  - body 上限：双端一致 4MB + HTTP 413（VS `MAX_BODY_BYTES` / JB `readBody` 中断），多字节字符跨 chunk 双端均安全（VS StringDecoder / JB 整段字节后一次解码）。
  - 超时：双端一致允许长阻塞 tools/call（openDiff 等分钟级审阅）——VS 显式 `requestTimeout=0`，JDK HttpServer 天然持开 + cached pool 防串行阻塞；仅限 loopback + bearer，slow-loris 风险接受并记录。
  - 鉴权 token：审计发现 VS 端 bearer 比较为普通字符串比较（timing oracle，loopback 低风险）而 JB 已是常数时间——已修，VS 改 `crypto.timingSafeEqual`（含长度不匹配防护）；另修 VS 长阻塞响应期间 client 消失时 `_send` 抛错成 unhandled rejection 的问题。token 存储双端一致（lockfile 0600 / 目录 0700），绑定双端一致 127.0.0.1。
  - workspace trust：VS package.json 原未声明 `capabilities.untrustedWorkspaces`（默认即 Restricted Mode 禁用，安全但隐式）——已显式声明 `supported: false` 固化意图；JetBrains 侧信任由 IDE 打开项目时的 trust 对话框前置把关，插件在授信后运行，无需额外声明。
  - 分片：MCP Streamable HTTP 无标准分片语义，双端一致用 4MB 上限 + 413 让 CLI 客户端收到明确错误（而非断连），超大 diff 由 CLI 侧拆分，维持现状。

剩余：

- notebook/Jupyter cell 读取和执行的 JetBrains 对齐 —— 判 product-blocked：Jupyter kernel 执行 API 在 JetBrains 侧属付费 IDE（DataSpell/PyCharm Pro）的 Jupyter 插件，IDEA Community 无可编程 kernel 表面，不强行对齐。
- 页面侧 browser state（DOM、console、network、screenshot）——需真浏览器 connector（P1 #8 Chrome connector 方向），Simple Browser/JCEF 均无该 API 面；server 侧状态已由 `getPreviewState` 覆盖。

### 4. Diff Review UX

Claude Code IDE diff 的关键不是“展示补丁”，而是让用户能编辑 proposed content，并把编辑反馈给 agent。

建议：

- 支持逐文件、逐 hunk accept/reject。
- 支持在 diff 中 request changes。
- 用户直接编辑 proposed content 后，agent 能感知修改内容。
- JetBrains 尽量使用 native diff viewer，而不是只用 HTML 渲染。

## P1：产品体验提升

### 5. Prompt Context UX

状态：大部分已覆盖（2026-07-10 盘点）。

Claude Code VS Code 支持 `@` 文件/文件夹、selection indicator、PDF 页面、附件拖入、context indicator 等。

已覆盖：

- `@file`/`@symbol` fuzzy picker（VS 30s TTL 缓存 / JB Mentions）、selection indicator、图片粘贴/拖入附件、context indicator（本地 token_usage 推导 + 模型窗口一次探测）双端已有。
- `@terminal`/`@browser` 不再做用户侧 mention：agent 侧已有 `getTerminalOutput` / `getPreviewState` 桥工具，模型可自取，无需用户手工粘贴。
- 敏感文件/密钥/配置的上下文确认由 CLI 审批层把守（敏感文件 gate + PermissionRequest 钩子），IDE 面板以审批卡呈现——无需 IDE 重复造门。

剩余：

- 文件行范围 / PDF 页码 mention 语法。
- context budget「哪些内容会被压缩/丢弃」提示 —— CLI-blocked：压缩决策数据（pin/丢弃明细）CLI 未输出，先决条件在 CLI 侧。

### 6. 权限模式和账户/用量 UI

状态：基本完成（2026-07-10）。

Claude Code IDE 有 Manual、Plan、Edit automatically 等权限模式，也有 account/usage 面板。

已落地：

- 权限模式/模型/会话状态展示：VS 状态栏 mode item + 面板 context 行；JB status bar widget（modeLine tooltip）+ context 行。此前已有。
- **Usage 面板（本轮新增，双端）**：VS `ChainlessChain: Show Token Usage` 命令（markdown 预览）/ JB Tools → Show Token Usage（monospace 对话框）。联接 `cc session usage --json` 与 `cc session list --json`：全时段合计、活跃窗口归桶（24h/7d/30d，按会话最后活跃时间近似——usage 事件无逐条时间戳，报告内如实注明）、按 provider/model 汇总、top 会话（带标题）。
- 高风险操作确认：审批卡已带 risk/rule/reason（mapAgentEvent approval 字段），双端呈现。

剩余：

- 按 skill/subagent/plugin/MCP/tool 归因 —— CLI-blocked：usage 事件未打归因标签，先决条件在 CLI 侧（`cc session usage` 需先记录来源）。
- daily/weekly 精确归桶 —— 同上，需 CLI 逐事件时间戳。

### 7. 插件/MCP 图形管理器

Claude Code VS Code 已有图形化 plugin management。

建议：

- 在 VS Code / JetBrains 内提供统一管理页。
- 支持安装、启用、禁用、升级 plugin、MCP、hook、skill、memory。
- 区分 user scope、workspace scope、project scope。
- 显示权限、来源、版本、签名和最近更新时间。

### 8. Browser / App Preview 融合

本地已有 App Preview 基础，但还可向 Claude Code 的 `@browser` 体验靠拢。

建议：

- 增加 Chrome connector，复用用户登录态。
- 支持 DOM、console、network、screenshot 作为 agent 上下文。
- 从 IDE 一键让 agent 启动本地应用、打开页面、定位错误、修复并验证。
- Preview 面板记录 agent 操作轨迹和失败原因。

### 9. Worktree 并行任务 UI

Claude Code 推荐使用 worktree 并行处理多个任务。

建议：

- 在 IDE 中提供“新建隔离任务”入口。
- 每个任务绑定独立 worktree、branch、session、diff。
- Team monitor 展示任务状态、改动范围、冲突风险。
- 提供合并、放弃、重新运行、转交人工审阅入口。

### 10. IDE 原生补全收尾

本地 VS Code 已有 completion 基础，JetBrains 侧也在推进 inline completion。

建议：

- 两端统一行为：ghost text、accept word、accept line、dismiss、manual trigger。
- 做 debounce、cancel、timeout 和并发保护。
- 明确补全上下文边界，避免误带敏感 selection。
- 增加 completion 专项测试和性能基准。

## P2：工程化与安全补强

### 11. URI / Deep Link 完整化

Claude Code VS Code 支持 URI handler 打开 prompt/session。

建议：

- 支持 prompt prefill、resume session、file、line、workspace、mode。
- Windows 路径、中文路径、空格路径必须有专项测试。
- JetBrains DeepLink 与 VS Code URI 参数保持一致。

### 12. Remote Development / WSL Doctor

Claude Code JetBrains 文档特别强调 WSL2、Remote Development、firewall、CLI path 等问题。

建议：

- IDE Doctor 自动检测 WSL2 mirrored networking、firewall、端口占用。
- 检测远程主机是否安装插件、CLI 是否可执行、版本是否兼容。
- 给出可复制命令和一键修复入口。

### 13. 可自动执行配置保护

官方 JetBrains 文档提示，IDE 配置文件可能带来自动执行风险。

建议对以下文件加特殊确认：

- `.vscode/settings.json`
- `.vscode/tasks.json`
- `.vscode/launch.json`
- `.idea/`
- JetBrains run configurations
- shell profile
- hooks
- MCP 配置

### 14. 分发和内置 CLI

Claude Code VS Code 插件会为 chat panel 管理自己的 CLI 副本。

建议：

- 支持插件内置或自动安装 CLI。
- CLI 升级带 checksum 校验和回滚。
- VS Code 覆盖 Open VSX 与 Microsoft Marketplace。
- JetBrains Marketplace 发布包签名、兼容矩阵和 smoke test 自动化。

## 建议落地顺序

1. Plan Review editor tab + inline comments。
2. Session history / remote resume 统一模型。
3. IDE MCP parity：selection、diagnostics、diff、terminal、browser。
4. Diff Review 可编辑反馈闭环。
5. Context picker 和 context budget UI。
6. Plugin/MCP 图形管理器。
7. Browser connector 与 App Preview 自动验证。
8. Worktree 并行任务 UI。
9. JetBrains / VS Code inline completion parity。
10. Remote/WSL Doctor、安全配置保护和发布自动化。
