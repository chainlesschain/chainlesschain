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

状态：已完成首版（2026-07-10）。

Claude Code VS Code 已有图形化 plugin management。

已落地（双端，全部落在 CLI `--json` 表面上，CLI store 是唯一事实源）：

- 统一管理页：VS Code `ChainlessChain: Manage Plugins & MCP`（webview，三区）/ JetBrains Tools → Manage Plugins & MCP（对话框，三 tab）。
- 运行时插件（`cc plugin installed --json`，统一 plugin runtime）：列表带 scope 徽章（user/project/workspace）+ manifest 有效性；操作 = Trust / Untrust（签名信任门）、Uninstall（按行的 scope，先确认）、Add（本地目录或 `--registry <url>` 远程源）。
- MCP 服务器（`cc mcp servers --json`，带 policy 注解）：transport/endpoint/auto-connect/allowed-blocked（含 block 原因）；操作 = Test connect（`mcp connect --json` 结果回显）、Remove（先确认）。新增服务器参数面较宽（command/url/transport/headers），引导用 `cc mcp add`。
- 技能：`cc skill list --json` 只读列表 + 实时筛选（id/name/category/description，VS 显示前 60 / JB 前 200 防巨列表）。

明确不做/边界（判定记录）：

- `plugin list/install/enable/disable`（DB 记账系统）不 surfaced——那是 legacy bookkeeping store，非统一运行时；enable/disable 概念在运行时侧由 trust/uninstall 承担。
- hooks 与 memory 不进本页：hooks 归 settings.json（有专门 settings 工具链），memory 已有独立命令（memory.init / memory.files）。
- 来源 URL / 签名详情 / 最近更新时间 —— CLI-blocked：`plugin installed --json` 未输出这些字段（trust 状态、签名验证细节在 CLI 内部）；CLI 补字段后 UI 直接跟上。

### 8. Browser / App Preview 融合

状态：已完成首版（2026-07-10）。

本地已有 App Preview 基础，但还可向 Claude Code 的 `@browser` 体验靠拢。

已落地：

- **CLI 层 Chrome connector（本轮新建）**：`cc browse chrome status|launch|state`——CDP attach 用户自己的 Chrome（区别于 `browse fetch/scrape` 的冷启空白 headless），页面状态带登录会话。`launch` 默认用专用配置目录（登录一次持久复用；`--default-profile` 可选复用真实配置、要求 Chrome 全关）；`state` 观察窗口期 console/失败网络请求（CDP 无追溯历史，`--reload` 捕获加载期）+ DOM 快照（150k cap）+ 截图，断开不杀浏览器。真 Chrome 145 live e2e 全链验证。
- **IDE 入口（双端）**：VS Code `ChainlessChain: Chrome Connector`（未连接→一键 launch；已连接→Capture / Capture with reload → markdown 报告 + 截图打开）/ JetBrains Tools → Chrome Connector（对话框流同构）。报告尾注明 agent 可用同一 `cc browse chrome state --reload` 命令自取上下文——「定位错误→修复→验证」循环的 agent 侧入口即 shell 工具跑该命令。
- DOM/console/network/screenshot 四类上下文全覆盖；`getPreviewState`（P0 #3 已落地）提供 dev server 侧状态，两者合起来覆盖「本地应用 → 浏览器页面」全链。

剩余/边界：

- 安全注记：CDP 端口是本机无鉴权控制通道（仅 loopback）；文档引导用完关闭。`--default-profile` 的风险（远控真实登录浏览器）已在 CLI 输出明示。
- agent 一等工具化（`browser_state` 进 AGENT_TOOLS）为后续增量——现阶段 agent 经 shell 工具跑 `cc browse chrome state --json` 已可用，一等工具需要 toolset/policy 面配套。
- Preview 面板记录 agent 操作轨迹 —— agent 不经面板操作浏览器（直接跑 CLI），轨迹在会话 transcript 里天然留痕；面板侧不重复记账。

### 9. Worktree 并行任务 UI

状态：已完成首版（2026-07-10）。

Claude Code 推荐使用 worktree 并行处理多个任务。

已落地（双端）：

- Worktree Tasks 面板：VS Code `ChainlessChain: Worktree Tasks`（webview）/ JetBrains Tools → Worktree Tasks（对话框）。枚举 agent 任务 worktree（`cc agent --worktree` → `cc-agent-*`、`cc batch` → `batch/*`、team 隔离 → `agent/*`；人类 feature 分支不掺入）。
- 每行展示：branch + worktree 路径、改动范围（`git diff --shortstat` 压缩为 `+40 −2 (3 files)` + 领先 commit 数）、运行状态（dirty=agent 工作中）、**合并冲突预判**（`git merge-tree --write-tree`，与 CLI previewWorktreeMerge 同 plumbing；git < 2.38 显示 `?` 不猜）。
- 新建隔离任务：输入任务 → 集成终端跑 `cc agent --worktree -p "<task>"`（`--bg --worktree` 被 CLI 明确拒绝，终端交互式=可观察可打断；JB 走 terminal 插件 `createLocalShellWidget`，插件缺席回退为展示命令）。
- 合并：主 checkout 内 `git merge --no-ff <branch>`；冲突则立刻 `merge --abort` 保持主树干净，并提示手工 `git merge <branch>` 解决。
- 放弃：确认后 `git worktree remove --force` + `git branch -D`（明示未合并 commit 会丢失）。

边界/判定：

- 全部走 plain git（CLI 未把 worktree lib 暴露为命令）；冲突预判/merge 语义与 CLI 内部实现同源。
- 「重新运行」= 新建隔离任务再跑一次（worktree 是一次性的，无重启语义）；「转交人工审阅」= 面板展示的 branch 本身就是普通 git 分支，走正常 PR/review 流程。
- Team monitor 集成已有（双端 team-monitor 面板读 `cc team run --state`），本面板管的是 worktree 维度。

### 10. IDE 原生补全收尾

状态：已收口（2026-07-10 parity 审计 + 修复）。

本地 VS Code 已有 completion 基础，JetBrains 侧也在推进 inline completion。

审计结论（逐维对比两端实现）：

- 行为统一（本已一致）：双端均 manual-only 触发（VS Invoke triggerKind / JB DirectCall，不做 per-keystroke LLM 流量，故无需 debounce）；ghost text 渲染、dismiss、Tab accept 走平台原生；accept word/line 为平台自带能力（VS `inlineSuggest.acceptNextWord` 等），不自造。
- 上下文边界（本已一致且安全）：双端只发当前文档 caret 前后各 4000 字符 + language id——不含 selection、其它文件、环境变量；敏感内容不会越出当前编辑文件。超时双端一致 12s；后端同为 `cc complete --json` stdin 管道（复用用户配置的 LLM，无新增鉴权）。
- 修复①（VS 落后 JB）：VS 缺防御性 `cleanCompletion`——JB/CLI 均剥 markdown fence、`<CURSOR>` 哨兵、2000 字符 cap、只修尾部空白；VS 原样透传 CLI 输出，换后端即裸奔。已补齐（镜像 JB 契约，保留行首缩进）。
- 修复②（取消不杀进程，双端）：VS 原来只在 spawn 完成后检查 cancellation token——用户继续输入/dismiss 后，在途 `cc complete` 子进程仍跑完整个 LLM 调用；现 `token.onCancellationRequested` 即刻杀子进程（已取消 token 直接短路不 spawn）。JB 原来 `withContext(Dispatchers.IO)` 下协程取消不中断阻塞的 `fetch`（白等最长 12s）；改 `runInterruptible`——取消打断 `waitFor` → InterruptedException 路径 + finally `destroyForcibly` 杀子进程。
- 并发保护：平台自身序列化（VS 对被取代的 provider 调用发 cancel、JB inline completion session 取消旧请求），叠加上述取消→杀进程后不再有并发残留子进程。
- 性能基准：不做微基准——manual-trigger 路径延迟由 LLM 主导（本地 FIM 模型 vs 云模型差两个量级），`extractContext` 纯切片无热路径；后端延迟可用 `cc complete` CLI 直接计时。专项测试已有（VS vscode-ext-completion 17 项 / JB CcCompletionTest + smoke），本轮新增 clean 契约 + 取消杀进程用例。

## P2：工程化与安全补强

### 11. URI / Deep Link 完整化

状态：已完成（2026-07-10）。

Claude Code VS Code 支持 URI handler 打开 prompt/session。

已落地（双端，参数一致）：

- `parseDeepLink`（VS `uri-handler.js`）/ `DeepLink.parse`（JB `DeepLink.java`）从只支持 `/open?prompt=` 扩展为 `prompt` + `session`（resume）+ `file` + `line` + `workspace` + `mode`。宿主动作顺序统一：resume（repoint tab）→ mode → prompt seed → file reveal。VS `registerUriHandler` / JB `CcProtocolCommand` 两处胶水同步接线（`resumeSessionId`/`openFileAtLine`/`applyApprovalMode`）。
- 安全（deep link = 不可信输入）：prompt 只 **seed** 从不自动发送（人复核后按 Send）；`mode` 只收安全审批模式（default/acceptEdits/plan），**永不接受 `bypassPermissions`**（外链不得武装自动批准，见 #13）；session id 形状校验（`[A-Za-z0-9._-]{1,128}`，拒 `../` 与超长）；`line` 校验 1-based 正整数，无 file 的 line 丢弃；`workspace` 原样返回由宿主比对当前打开目录不符则忽略（防「A 仓库的链接作用到 B 仓库」）。
- 路径鲁棒性专项测试：Windows 盘符（`C:\Users\me\My Project\…`）、含空格、中文/emoji 路径（`/home/me/项目/文件.ts`、`D:\代码\a b\📁\main.rs`）经 percent-decode 后逐字节 round-trip；VS 12 项 + JB DeepLinkTest 6 新用例 + 双端 smoke。
- JetBrains DeepLink 与 VS Code URI 参数保持一致（同名 key、同安全策略、同动作顺序）。

### 12. Remote Development / WSL Doctor

状态：已完成（2026-07-10）。

Claude Code JetBrains 文档特别强调 WSL2、Remote Development、firewall、CLI path 等问题。

已落地（双端）：

- 纯核 `analyzeRemoteEnv`（VS `remote-doctor.js`）/ `RemoteDoctor.analyze`（JB `RemoteDoctor.java`）：注入环境信号（platform / isWsl / remoteUncPath / isRemote / cliFound / cliVersion / minCliVersion / bridgePort / portProbe），产出分级检查（ok/warn/error）+ 每条**可复制修复命令**。检查覆盖：WSL2 mirrored networking（`.wslconfig` `networkingMode=mirrored` + `wsl --shutdown`）、CLI 缺失/版本落后（remote-aware 提示 + `npm install -g chainlesschain[@latest]`）、bridge 端口停/不可达（Restart Bridge）、远程会话防火墙/回环可达性（`netsh advfirewall` 规则）。
- 版本比较 `compareVersions` 忽略 prerelease 尾，用于 CLI 兼容判定。
- 宿主接线：VS 新命令 `chainlesschain.remote.doctor`（采集真实信号：`vscode.env.remoteName`/`\\wsl` UNC 路径/`cc --version`/bridge `_port`/loopback socket 探测 → 报告写 output channel + Copy report）；JB 折进既有 `DiagnoseBridgeAction`（`cc ide status/doctor/jetbrains` 之后追加「Remote / WSL Doctor」段，同样真采集 `WSL_DISTRO_NAME`/UNC/`--version`/端口探测）。
- 测试：VS 8 项 + JB RemoteDoctorTest 7 项 + 双端 smoke。

### 13. 可自动执行配置保护

状态：已完成（2026-07-10）。

官方 JetBrains 文档提示，IDE 配置文件可能带来自动执行风险。

已落地（双端）：

- 纯核分类器 `classifyAutoExecTarget`/`scanAutoExecConfig`/`summarizeAutoExecScan`（VS `auto-exec-guard.js`）/ `AutoExecGuard`（JB `AutoExecGuard.java`）：识别可无显式操作即执行代码的配置文件并分级（severity 5→2）——MCP 配置（`.mcp.json`、`.vscode/mcp.json`、`.cursor/mcp.json`，可 spawn 进程）/ git·husky hooks（`.git/hooks/*`、`.husky/*`，排除 `.sample` 模板）/ shell profile（`.bashrc`/`.zshrc`/`.profile`/PowerShell profile）/ `.vscode/tasks.json`（可 folderOpen 自动跑）/ `.idea/runConfigurations/`（JetBrains 运行配置）/ `.vscode/launch.json` / `.vscode/settings.json` / `.idea/`。路径分隔符 + 大小写不敏感（Windows-safe），普通文件与 inert sample hook 不误报。
- 定位判定：cc agent 的文件写入由 CLI 自身 per-write 权限门把关（confirm 再写）；本项是 IDE 层的**互补** —— 提示人「刚打开的（未信任）工作区已经**包含**这些文件」，agent 可能经 tasks/hooks/MCP 触发它们。
- 宿主接线：VS 激活时一次性 per-workspace 咨询（扫工作区根 + `.vscode`/`.idea`/`.git/hooks`/`.husky` 一层，命中且未信任 → 非阻断警告 [Review]/[Trust workspace]，信任持久化 globalState per workspace path）+ 命令 `chainlesschain.workspace.scanAutoExec`；JB Tools → Scan Workspace for Auto-Exec Config（`AutoExecScanAction`，`PropertiesComponent` 持久化信任 per project path）。
- 测试：VS 7 项 + JB AutoExecGuardTest 6 项 + 双端 smoke。

### 14. 分发和内置 CLI

状态：分发面已完成；「插件私有 CLI 副本 + checksum/回滚」判定为**刻意不做**（2026-07-10）。

Claude Code VS Code 插件会为 chat panel 管理自己的 CLI 副本。

已完成：

- **VS Code 覆盖 Open VSX 与 Microsoft Marketplace**：CI「IDE Extensions」workflow 双渠道 —— Open VSX 每版 `ovsx publish`（0.37.10 已 live `🚀 Published`），官方 VS Marketplace step 存在但因缺 `VSCE_PAT` secret 优雅跳过（`::notice::… skipping`，非失败；配 secret 即启用，无需改代码）。
- **JetBrains Marketplace 发布包签名、兼容矩阵、smoke test 自动化**：`publishPlugin` 每版上架（0.4.53 已 `BUILD SUCCESSFUL`），Marketplace 服务端签名（本地 `signPlugin` 无证书时 SKIPPED，上架仍成功）；兼容矩阵 `sinceBuild=242`/`untilBuild=null` + `verifyPlugin`（对 2025.2）；CI 每版跑 smokeTest（PureLogicSmokeMain 775 断言）+ JUnit + buildPlugin 解析级包验。
- **自动安装 CLI（务实版）**：检测 cc 缺失/落后 → 一键 guarded `npm install -g chainlesschain@latest`（终端可见、用户确认），covered by version-check nudge；#12 Remote Doctor 亦对缺失/落后给可复制安装命令。

刻意不做（判定 + 理由）：

- **插件内置/私有 CLI 副本 + 独立 checksum 校验 + 回滚**：npm 是 CLI 的**单一分发渠道**（SSOT）。插件私有副本会（1）分叉更新路径（用户 `npm i -g` 与插件私有副本各自为政，版本诊断更难）；（2）膨胀 vsix/zip（cc ~2MB + node 依赖）；（3）重复 npm 自身的完整性保证（registry `dist.integrity` SHASUM + 锁文件）。故不引入私有安装位；「auto-install」以 npm 全局安装的 guarded nudge 实现，回滚 = `npm install -g chainlesschain@<旧版>`。此判定与项目「npm 先发、release 后拉」的既定分发纪律一致。

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
