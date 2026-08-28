# IDE 插件使用指南（VS Code / JetBrains）

> **当前推荐组合（2026-08-28）：CLI `0.166.7` + VS Code 扩展 `0.37.72`（Open VSX）+ JetBrains 插件 `0.4.103`（Marketplace）。两端保持只读投影与 CLI authority，并重新认证 Graph Kernel entry cutover、fenced recovery 与 legacy mutation containment。三者的稳定契约均绑定精确 SHA `19834a1845`。**
>
> 把 ChainlessChain 的 `cc` agent 变成**编辑器里的一等公民**：侧边栏 Chat 面板直接对话、计划以可编辑 Markdown 文档审阅、文件改动走编辑器原生 diff 评审（可逐块接受、可行级批注）、代理自动感知你的选区与诊断。VS Code 与 JetBrains 双端同一套协议、同一套功能面，会话还能跨 IDE 互相续接。
>
> **发布提示**：Open VSX `0.37.72` 已公开回读且累计下载突破 **3.1 万**；JetBrains `0.4.103` 已由 Marketplace API 回读为 approved/listed。npm `latest` CLI `0.166.7` 已完成精确 SHA 的三平台完整门禁、发布与独立 registry/provenance 回读。微软 VS Code Marketplace 与 JetBrains 作者签名仍未完成。

## 概述

ChainlessChain IDE 插件是 `cc` CLI 在编辑器内的完整工作台，由两层能力组成：

1. **桥接层（IDE-as-MCP-server）**：插件在编辑器内起一个 localhost MCP server，把选区、诊断、打开的文件、原生 diff 评审等编辑器能力暴露为 `mcp__ide__*` 工具；任何在集成终端里跑的 `cc agent` 自动发现并连上。桥接机制详见姊妹篇 [IDE 桥接](/chainlesschain/ide-bridge)。
2. **工作台层（本文重点）**：Chat 面板（多标签会话、流式回复、Plan 模式、审批卡、图片粘贴）、Plan Review 可编辑审阅文档、原生 Diff 评审（hunk 级部分接受 + 行锚点批注 + 用户修订回读）、CodeLens / 快速修复 / ghost-text 补全、App Preview、后台代理 / 团队监控 / 远程控制 / Worktree 任务等一整套面板。

两端严格遵循**纯核 + 胶水**分层：协议与业务逻辑是零编辑器依赖的纯模块（VS Code 侧纯 Node、JetBrains 侧纯 JDK），可在无编辑器宿主下测试并做过跨语言 interop 实证；只有薄薄一层 glue 碰编辑器 SDK。因此双端功能面长期保持对齐，会话经**共享 IDE 会话索引**（`~/.chainlesschain/ide/session-index.json`）跨 IDE 可见、可续接。

## 安装与首次配置

需要两样东西：**`cc` CLI** + **编辑器插件**。

### 1. 安装 / 升级 `cc` CLI

```bash
npm i -g chainlesschain@0.166.7  # 需要 Node ≥ 22.12.0；当前完整门禁基线
cc --version                # 建议 ≥ 0.162.157
cc ide --help               # 确认有 ide 子命令
```

### 2. 安装编辑器插件

**VS Code 及兼容编辑器**（VSCodium / Cursor / Gitpod / 通义灵码 …）

- **已发布到 [Open VSX Registry](https://open-vsx.org/extension/chainlesschain/chainlesschain-ide)**（扩展 ID `chainlesschain.chainlesschain-ide`，需 VS Code ≥ 1.85）。在使用 Open VSX 的编辑器里，扩展面板搜 **ChainlessChain IDE** 一键安装。
  > 官方 VS Code Marketplace（marketplace.visualstudio.com）**暂未上架**。官方版 VS Code 不查询 Open VSX，不要点 Open VSX 的通用 **Install** 链接；请直接下载 [0.37.72 VSIX](https://open-vsx.org/api/chainlesschain/chainlesschain-ide/0.37.72/file/chainlesschain.chainlesschain-ide-0.37.72.vsix)，再运行 **Extensions: Install from VSIX...**。也可从源码打包：
  ```bash
  cd packages/vscode-extension
  npx @vscode/vsce package --no-dependencies
  code --install-extension chainlesschain-ide-*.vsix
  ```

**JetBrains（IDEA / PyCharm / WebStorm / GoLand …，2024.2+）**

- **已上架 [JetBrains Marketplace](https://plugins.jetbrains.com/plugin/32208-chainlesschain-ide-bridge)**（插件 ID `com.chainlesschain.ide`）：_Settings → Plugins → Marketplace_ 搜 **ChainlessChain IDE** 一键安装。仅依赖 platform 模块，非 Java IDE 同样可装。
- 离线 / 源码安装：`./gradlew buildPlugin` 得 `build/distributions/*.zip` → _Settings → Plugins → ⚙ → Install Plugin from Disk_。

当前 VS Code `0.37.72` 已从 Open VSX 公开回读，JetBrains `0.4.103` 已由 Marketplace API 回读为 approved/listed。两端已消费 Protocol `0.1.5` 的生成 payload union，并重新认证 CLI `0.166.7` 的 Graph authority、durable cutover evidence 与 fenced recovery；IDE 继续只提交宿主已审阅决定、消费无正文投影，不重建 CLI writer。消息正文/摘要、attempt/agent 身份、artifact id 和 authority digest 不进入 Webview。微软 VS Code Marketplace 未发布，不能把 Open VSX 的公开状态扩写到该渠道。

### 3. 配置大模型（首次）

- **VS Code**：命令面板跑 **ChainlessChain: Configure LLM**（或 Chat 面板标题栏 ⚙ 按钮）。
- **JetBrains**：**Tools → ChainlessChain: Configure LLM**。

向导列出十余家预设提供商（火山引擎 / Ollama / Anthropic / OpenAI / DeepSeek / 百炼 / Kimi / Gemini / Mistral / MiniMax …），选提供商 → 填模型 / API key / Base URL；普通配置经 `cc config set` 写入，schema secret 经 `cc config set-secret` 的隐藏输入与 OS 凭据库（或 owner-only fallback）保存，**key 不进 IDE 设置，也不再写入普通配置字段**。最后用 `cc llm test` 验证连通。图片识别用的视觉模型经 **Configure Vision Model** 单独配置。Chat 面板在未配置或连接失败时也会自动弹引导卡。

### 4. 验证

```bash
cc ide status       # 在编辑器集成终端里跑 → "In IDE terminal: yes"
cc ide doctor       # 发现失败时解释原因
```

装好后插件自动起桥接 server、写发现 lockfile、给新开的集成终端注入连接信息——之后不管是 Chat 面板还是终端里的 `cc agent`，都自动带上编辑器感知。

## 核心特性

### 1. Chat 面板（编辑器内对话）

侧边栏（VS Code：Activity Bar → ChainlessChain IDE → Chat；JetBrains：右侧 **ChainlessChain** 工具窗）直接和 agent 对话，内部为每个会话维护一个长驻 `cc agent` stream-json 双工子进程：

- **多会话标签页**：每个 tab 独立进程，随开随切；标签、resume id、审批模式、思考档位**跨 IDE 重启持久化**，首条消息自动命名标签；**Reopen Closed** 按标题 / 日期搜索重开已关会话。
- **流式渲染**：逐 token 回复 + 实时工具调用轨迹；XSS 安全的 Markdown 渲染（代码块 / GFM 表格 / 任务列表），代码块带 **Copy / 插入编辑器** 按钮。
- **扩展思考**：`/think`、`/ultrathink`、`/think-off` 三档，推理过程以可折叠暗色块实时展示。
- **图片 / 视觉**：Ctrl/Cmd+V 粘贴截图或拖拽图片（单条最多 4 张），走独立视觉模型。
- **`@` 提及**：文件（排序下拉）、`@folder/`（递归目录树）、**类 / 方法符号**（按符号名找文件）、`@terminal`、`@selection` / `@diagnostics`；支持 `@file#L5-10` 行区间引用。
- **审批卡与提问卡**：危险动作（危险 shell、settings `ask` 规则）弹 Approve/Deny 卡片阻塞等裁决（默认 120s 超时回落拒绝）；agent 拿不准时经 `ask_user_question` 弹单选 / 多选 / 自由文本卡而不是瞎猜。
- **结构化授权（VS Code 0.37.72）**：单次批准仍是快速路径；展开后可选当前回合、当前会话、拒绝或取消。回合/会话 grant 只采用 CLI 请求中的 exact capability/scope/binding，Webview 不能扩权。
- **用量与重试可视化**：工作中实时 token 计数、回合结束 `in→out` 汇总、迭代预算预警、常驻**上下文窗口占用指示条**；CLI `0.162.184+` 还提供真实工具耗时、同轮观测重试，以及不含密钥/参数的流式 LLM retry 原因和实际 provider/model。
- **后台 tab 信号**：非活动标签回合完成亮绿点、等待审批亮蓝点 + "Show" 提示，不抢焦点。
- **Context Center（VS Code 0.37.54+ / JetBrains 0.4.90+）**：只读展示 CLI-owned context envelope、included source、scope、freshness、token allocation、symbol/file evidence、Git diff、项目记忆、bounded diagnostics 与 metadata-only MCP resource evidence。未知、超限、跨版本或不可用来源显式失败闭合，不把 MCP payload 或凭据值复制进 IDE 投影。
- **权限与 Side-effect Center（VS Code 0.37.54+ / JetBrains 0.4.90+）**：解释 workspace-scoped authority、实际 filesystem/network/process/runtime/credential-name 资源、irreversibility、decision source、call chain、recovery coverage 与 unresolved resource。IDE 创建/撤销临时规则时只执行 CLI 提供、绑定 authority generation/rule revision 的 exact argv，不直接编辑 authority store。
- **Governed Automation Center**：展示 CLI-owned versioned flow/Routine projection、scope、execution preflight 与 history；run-now、失败重试、pause/resume、disable/delete 和 Routine create/edit 都会在确认前重读 revision，并只执行 CLI 提供的 exact argv。过期投影失败闭合，IDE 不直接写权威存储。
- **CLI-owned Sessions Workbench（公开版 VS Code 0.37.72 / JetBrains 0.4.103）**：会话列表只消费 CLI 生成的 immutable projection revision；resume、attach、delivery 与 remote-control 动作必须由该 revision 明确声明，过期按钮失败闭合。公开版显示跨会话消息的 delivered/refused/full/expired 结果，并包含分组、多选批量移动与 Focus View。
- **生成事件与无正文协作投影（VS Code 0.37.72 / JetBrains 0.4.103）**：双端使用 Schema 生成的 known-event 类型并保留未知未来事件；VS Code 额外显示 canonical message/follow-up 与 custody handoff 计数。malformed、oversize 或 duplicate 可选投影失败闭合，发送、接收、ACK 与 handoff authority 始终留在 CLI-owned agent bridge。
- **可恢复交付与 rewind timeline（VS Code 0.37.50 / JetBrains 0.4.86）**：交付覆盖 GitHub、Gitee、configured remote 与 manual handoff，每步要求显式确认并校验 result/effect digest；`/rewind` 展开为绑定 session、workspace、repository head、checkpoint revision 与 manifest digest 的 detail/restore/fork 流程。
- **编辑器内联聊天与 ARM64 宿主门（VS Code 0.37.50）**：在当前选区旁打开独立浮层会话，逐字流式响应，代码块可复制、插入或替换；Explain / Refactor / Fix / Generate Docs / Generate Tests 六个 command 已进入 canonical IDE capability manifest。stable/minimum × 三系统 ARM64 的真实宿主与双端共享聚合证据继续保留。

**面板斜杠命令**（双端一致，输入 `/` 有自动补全）：

| 命令                                | 作用                                          |
| ----------------------------------- | --------------------------------------------- |
| `/new` / `/stop`                    | 新会话 / 中断当前回合（子进程存活）           |
| `/sessions`                         | 会话选择器（合并 CLI + 双 IDE 会话索引）      |
| `/plan` `/approve` `/reject`        | 进出 Plan 模式 / 裁决计划或审批卡             |
| `/review`                           | 审查当前未提交 git diff                       |
| `/rewind` / `/retry`                | 回退到检查点 / 重试上一轮                     |
| `/compact` / `/expand`              | 手动压缩 / 展开历史                           |
| `/cost` / `/context`                | 本会话花费 / 上下文占用                       |
| `/auto` `/bypass` `/normal`         | 切换审批模式（状态栏有指示）                  |
| `/think` `/ultrathink` `/think-off` | 扩展思考档位                                  |
| `/handoff`                          | 把会话交接给后台代理（`cc agent --bg`）继续跑 |
| `/help`                             | 命令帮助                                      |

### 2. Plan 模式与计划审阅

- **Plan 模式**：只读规划，被拦截的写操作聚成实时 plan 卡片（impact 着色 + 风险），Approve & run 解锁执行。
- **Plan Review 可编辑审阅文档**：计划以真实 Markdown editor tab 打开，每个条目自带 `comment:` 行可逐条批注，四个动作——**Approve / Reject / Request changes / Regenerate**；批准与拒绝把**审阅快照（含你的全部批注）写回会话转录**供审计回放。详见 [IDE 计划审阅与会话索引](/chainlesschain/ide-plan-review)。

### 3. 原生 Diff 评审（agent 改文件的安全闸）

agent 的文件编辑不直接落盘，而是弹**编辑器原生并排 diff**（左=原文只读 / 右=提案**可编辑**），阻塞到你裁决：

- **Accept**：右栏最终文本写盘——**你在 diff 里顺手改过的内容就是最终落盘的内容**，且 agent 能通过 `userAmendments`（-/+ 行级修订摘要，cc ≥ 0.162.157+）看到你改了什么。
- **Pick hunks…**：hunk 级部分接受，勾选的应用、未勾选的保留原文，Esc / 全不选 = 不写（fail-safe）。
- **Request changes…**：inline 批注发回 agent 要求修改；JetBrains 侧（0.4.55+）支持 **`12:` / `12-15:` 行锚点前缀**（全角冒号也认），批注精确挂到代码行。
- **Reject / 关闭标签**：文件不动（**绝不自动应用**）。
- **多文件批量评审**（`openMultiDiff`）：一次改动多个文件时打开批量视图，Accept all / 挑子集 / Reject。
- VS Code 快捷键：`Ctrl/Cmd+Enter` 接受、`Ctrl/Cmd+Shift+Backspace` 拒绝；并发多个评审 tab 可堆叠，裁决后过期 tab 自动关闭。

settings 权限规则对 `Write`/`Edit` 配了 `ask` 且在交互会话时，终端 y/N 确认自动升级为这套原生 diff 评审（`CC_IDE_DIFF_APPROVAL=0` 关闭）。

### 4. 编辑器智能

- **CodeLens**：函数 / 方法 / 类上方 ✨ **Explain / Refactor** 一键入 Chat（可关）。
- **快速修复**：诊断行上 **Fix with ChainlessChain**（VS Code 灯泡 / JetBrains Alt+Enter intention），把报错上下文种进 Chat。
- **右键菜单**：Explain Selection / Refactor Selection / Insert File Reference（`@file#L5-10`）。
- **Ghost-text 行内补全**：`Alt+\` 手动触发保持不变；当前公开版可另行启用默认关闭的自动路径。自动请求等待 650ms、继续输入即取消，按 exact context 去重并缓存，独立限制每小时请求数/上下文字数以及单次输出行数/字符数；超过 5 秒或质量不足时静默丢弃，不阻塞编辑。
- **项目记忆**：Generate Project Memory 生成 `cc.md`；Show Project Memory Files 查看记忆链（`cc.md` / `CLAUDE.md` / `AGENTS.md`）。
- **App Preview**：自动找 dev script 起服务、探测 URL，VS Code 嵌 Simple Browser / JetBrains 嵌 JCEF 面板，支持 HMR、崩溃恢复、一键 Restart，Stop 杀整棵进程树。

### 5. 实时上下文与诊断回喂（自动感知）

- **提交时自动共享**：每次发消息自动携带活动文件、打开的标签、选区（`<ide-context>` 块，只进在途消息不进持久化）。
- **编辑后诊断回喂**：agent 改完文件，等语言服务器消化（默认 600ms）后把新的 error/warning 附回工具结果——agent 在同一循环内看到自己刚引入的报错并修掉。
- **终端上下文**：`getTerminalOutput` 让 agent 读最近的终端命令 / 输出 / 退出码（VS Code 需 1.93+ shell integration；JetBrains 读终端缓冲）。
- **质量上下文 (`cc-ide-quality/v1`)**：有界发送最近测试结果、覆盖率摘要与调试器状态，并携带 Context v2 新鲜度元数据；过期快照会被标注而不是伪装成当前状态。
- **Notebook 实际上下文**：VS Code 侧 Jupyter 执行使用当前 notebook / cell 的真实上下文，不再只按普通文本编辑器推断。
- 总开关 `CC_IDE_CONTEXT=0`（IDE 工具本身仍可被显式调用）。

### 6. 插件生命周期与供应链信息

“Manage Plugins & MCP” 由 CLI runtime 执行实际变更，IDE 不维护第二份插件状态：

- 按 `user / project / local` scope 启用或禁用插件。升级先在 staging 重新校验 manifest 与签名 SBOM，再原子激活；复制、加载、post-install 或新增 capability 未获同意时自动恢复旧版本。
- IDE 解析受控的 `activated / rolled_back / unchanged` 结果，只在确认激活后重载当前会话；扩大 capability 前先展示新增能力并要求显式批准。
- 当前会话可重载插件状态；签名、SBOM、registry / Git / local 来源、managed-policy 来源与生效范围在同一视图展示。
- 来源元数据在展示前脱敏，不从不可信工作区目录探测 Node、Java 或 `cc`。
- Token Usage / session usage 可按插件 id/version 归因 plugin-bin 和插件提供的 MCP 调用，并显示有界耗时/重试摘要；不保存工具参数、输出或凭据。

命令行等价操作：

```bash
cc plugin installed
cc plugin enable <name> --scope user
cc plugin disable <name> --scope project
cc plugin upgrade <source> --scope user
```

### 7. 后台与协作面板

| 面板                  | 入口（命令面板 / Tools 菜单）        | 作用                                                                                                                                                                                    |
| --------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Background Agents** | ChainlessChain: Background Agents    | 列出 `cc agent --bg` 后台会话，追加指令 / 停止 / 重命名 / 续接                                                                                                                          |
| **Team Monitor**      | ChainlessChain: Team Monitor         | 只读观察 local v6 / queue v1 authority、任务图、lease、预算与进度；takeover、managed recovery 和副作用裁决携精确 digest/lease/evidence fence 交回 CLI，IDE 不直接改权威 JSON            |
| **Remote Control**    | ChainlessChain: Remote Control       | 起 `cc remote-control` 配对主机，IDE 内直接渲染一次性配对 URI 的 QR 码（0.37.12/0.4.56+，手机扫码即配对），relay（E2EE 跨网）可在 IDE 设置面配置，手机 / Web 观察-提问-审批-中断        |
| **Worktree Tasks**    | ChainlessChain: Worktree Tasks       | 新建受监督的隔离后台任务；显示 worktree 与 team/batch 协作记录的 owner/session、权限模式、资源预算、生命周期、副作用计数、变更足迹与冲突预览；仅 worktree 任务提供 Merge back / Discard |
| **Plugin & MCP 管理** | ChainlessChain: Manage Plugins & MCP | 分 scope 启停 / 升级 / 重载、签名与 SBOM 摘要、managed-policy 来源；MCP server 测试 / 移除，技能列表过滤                                                                                |
| **Chrome Connector**  | ChainlessChain: Chrome Connector     | 驱动 `cc browse chrome`，抓取页面 console / network / DOM / 截图成报告                                                                                                                  |
| **Token Usage**       | ChainlessChain: Show Token Usage     | 全时段 / 24h / 7d / 30d 用量、按模型汇总、Top 会话，以及工具耗时、观测重试和脱敏 LLM retry 归因                                                                                         |
| **Dashboard**         | ChainlessChain IDE: Open Dashboard   | 桥接状态卡 + 实时工具调用流 + Restart                                                                                                                                                   |
| **What's New**        | ChainlessChain: What's New           | 渲染 `cc changelog`，配合 CLI 版本检查 / 一键升级                                                                                                                                       |

Worktree 后台任务与 `cc team` / `cc batch` 协作单元都使用 durable 治理记录；协作记录不保存 prompt、argv、工具参数、输出或凭据。**managed** 表示治理状态可审计，不代表 team/batch 获得后台进程控制能力；只有真正拥有后台会话的 worktree 任务显示 attach/stop/Merge back/Discard。

Agent Team 的 human-control 与后台进程控制是两套 authority：IDE 可以针对当前 state/queue digest 发起 takeover、checkpoint recovery 或 side-effect adjudication，但实际 compare-and-swap 由 CLI 完成；过期 digest、lease 或 evidence 会失败关闭。原始团队状态仍是只读投影，不能通过编辑文件绕过 CLI 的迁移、预算或 fencing 规则。

### 8. Installation Doctor 与离线恢复

- VS Code / JetBrains Doctor 同时检查 `cc`、Node.js、Java、managed CLI 与插件 registry。
- managed CLI 损坏或 registry 暂时离线时会显示可恢复状态与操作建议；诊断不会从工作区目录执行同名程序。
- 远程 / WSL 环境继续检查桥接端口、远端 CLI 与网络模式；输出中的 token、路径型来源与凭据会脱敏。

### 9. 深链与本地化

- **深链**：`vscode://chainlesschain.chainlesschain-ide/open` / `jetbrains://…/chainlesschain/open`，参数 `prompt` / `session` / `file` / `line` / `workspace` / `mode`——prompt 只**预填不自动发送**，`mode` 永拒 `bypassPermissions`，异 workspace 链接被忽略（详见「安全考虑」）。
- **本地化**：界面按 IDE 语言呈现英文或中文（VS Code l10n / JetBrains `CcBundle` DynamicBundle），双语 key 齐平由测试门禁保证。

## 系统架构

```
┌──────────────────────────────────────────────┐
│            VS Code / JetBrains 插件           │
│                                              │
│  Chat 面板 ──每 tab 一个──▶ cc agent 子进程    │
│  (webview / Swing)   stream-json 双工 NDJSON  │
│         │                     │               │
│  Plan Review tab / 原生 Diff ◀─┘ (事件驱动)    │
│                                              │
│  ┌────────────────────────┐   MCP(HTTP+Bearer)│
│  │ 本地 MCP server         │◀───────────────── │──▶ 终端里的 cc agent
│  │ getSelection/Diagnostics│                  │    (mcp__ide__* 工具)
│  │ getOpenEditors/ActiveFile│                 │
│  │ openDiff/openMultiDiff  │                  │
│  │ getTerminalOutput/…     │                  │
│  └────────────────────────┘                  │
│  写 lockfile ~/.chainlesschain/ide/<port>.json │
│  写会话索引 ~/.chainlesschain/ide/session-index.json（跨 IDE 共享）
└──────────────────────────────────────────────┘
```

### IDE 工具面（agent 可调用的 `mcp__ide__*`）

| 工具                | 作用                                                                     | 端                     |
| ------------------- | ------------------------------------------------------------------------ | ---------------------- |
| `getSelection`      | 当前文件 + 选中范围 + 选中文本                                           | 双端                   |
| `getActiveFile`     | 活动文件路径 / 语言 / 脏状态 / 光标                                      | 双端                   |
| `getOpenEditors`    | 全部打开标签（含后台 + 未保存状态）                                      | 双端                   |
| `getDiagnostics`    | lint / 类型错（可按文件过滤）                                            | 双端                   |
| `openDiff`          | 原生并排 diff 阻塞评审（accept / reject / pick hunks / request changes） | 双端                   |
| `openMultiDiff`     | 多文件批量评审                                                           | 双端                   |
| `getTerminalOutput` | 最近终端命令 / 输出 / 退出码                                             | 双端                   |
| `getPreviewState`   | App Preview dev server 状态                                              | 双端                   |
| `executeCode`       | 在活跃 Jupyter kernel 执行代码（变量跨调用保持）                         | 仅 VS Code（条件暴露） |

### 纯核 + 胶水两层

| 端        | 纯核（无编辑器 SDK 依赖，可独立测试）                                                                                                                            | 胶水（唯一碰 SDK 的薄层）                                             |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| VS Code   | `mcp-http-server.js` / `ide-tools.js` / `lockfile.js` / `chat/*`（事件解析、会话索引、md-lite …）/ `vendor/agent-sdk`（Agent Protocol v1 argv + NDJSON framing） | `vscode-facade.js` / `extension.js`                                   |
| JetBrains | `com.chainlesschain.ide.*` 纯 JDK：`MiniJson` / `McpServer` / `IdeTools` / `ConversationManager` / `ReviewNote` / `AutoExecGuard` / `RemoteDoctor` …（40+ 类）   | `com.chainlesschain.ide.intellij.*`：facade / 工具窗 / actions / JCEF |

JetBrains 纯核在**无 IntelliJ SDK 的机器**上用 `javac --release 8` 编译并由真实 Node CLI MCPClient 驱动过全链路（interop 实证）；Chat 子进程协议以 `@chainlesschain/agent-sdk` 的 `PROTOCOL.md` 为单一契约来源，CLI / SDK / 双插件四端对齐。

## 配置参考

### VS Code 设置（`chainlesschain.*`）

| 设置                                                                             | 默认         | 作用                                        |
| -------------------------------------------------------------------------------- | ------------ | ------------------------------------------- |
| `chainlesschain.ide.enabled`                                                     | `true`       | 是否启动桥接 MCP server                     |
| `chainlesschain.cli.path`                                                        | `"cc"`       | `cc` CLI 路径（不在 PATH 时设绝对路径）     |
| `chainlesschain.chat.provider`                                                   | `""`         | Chat 面板 LLM 提供商（空 = 跟随 CLI 配置）  |
| `chainlesschain.chat.model`                                                      | `""`         | Chat 面板模型（空 = 跟随 CLI 配置）         |
| `chainlesschain.chat.contextIndicator`                                           | `true`       | Chat 下方常驻上下文窗口占用指示条           |
| `chainlesschain.codeLens.enabled`                                                | `true`       | 函数上方 ✨ Explain / Refactor CodeLens     |
| `chainlesschain.completion.enabled`                                              | `true`       | `Alt+\` 手动 ghost-text 补全                |
| `chainlesschain.completion.automatic.enabled`                                    | `false`      | 启用受治理自动 ghost-text；手动补全不受影响 |
| `chainlesschain.completion.automatic.debounceMs`                                 | `650`        | 停止输入后的自动请求延迟（100–3000ms）      |
| `chainlesschain.completion.automatic.maxRequestsPerHour`                         | `60`         | 自动路径每小时请求预算                      |
| `chainlesschain.completion.automatic.maxContextCharsPerHour`                     | `240000`     | 自动路径每小时上下文字符预算                |
| `chainlesschain.completion.automatic.cacheTtlMs`                                 | `30000`      | exact-context 缓存有效期                    |
| `chainlesschain.completion.automatic.maxCompletionChars` / `.maxCompletionLines` | `800` / `12` | 自动建议的字符与行数上限                    |

### JetBrains 设置（Settings → Tools → ChainlessChain IDE）

| 设置                   | 默认        | 作用                                                   |
| ---------------------- | ----------- | ------------------------------------------------------ |
| cc CLI path            | 空=自动探测 | `cc` / `chainlesschain` 不在 IDE PATH 时设绝对路径     |
| Show context indicator | `true`      | Chat 面板上下文窗口指示条                              |
| Automatic ghost text   | `false`     | 启用后可配置 debounce、请求/上下文预算、缓存和输出上限 |

> LLM 配置**不存 IDE 设置**——统一在 `~/.chainlesschain/config.json`（Configure LLM 向导写入，CLI 与双端插件共用）。

### 快捷键

| 功能                  | VS Code                                       | JetBrains              |
| --------------------- | --------------------------------------------- | ---------------------- |
| 聚焦 Chat 面板        | `Ctrl/Cmd+Escape`                             | 工具窗快捷键           |
| 新会话                | `Ctrl/Cmd+Alt+N`                              | `Ctrl/Cmd+Alt+Shift+D` |
| 重开已关会话          | `Ctrl/Cmd+Shift+T`（面板内）                  | `Ctrl/Cmd+Alt+Shift+R` |
| 插入 `@file` 引用     | `Ctrl/Cmd+Alt+K`                              | `Ctrl/Cmd+Alt+Shift+K` |
| 手动行内补全          | `Alt+\`                                       | `Alt+\`                |
| 接受 / 拒绝 Diff 评审 | `Ctrl/Cmd+Enter` / `Ctrl/Cmd+Shift+Backspace` | diff 视图按钮          |

### 环境变量与 CLI 旗标

| 变量 / 旗标               | 作用                                                     |
| ------------------------- | -------------------------------------------------------- |
| `CC_IDE_CONTEXT=0`        | 关闭实时上下文注入 + 诊断回喂（工具仍可显式调用）        |
| `CC_IDE_DIFF_APPROVAL=0`  | 文件编辑 `ask` 不再升级为 IDE 原生 diff 评审             |
| `CC_IDE_DIAG_SETTLE_MS`   | 编辑后等语言服务器重新 lint 的延迟（默认 600，`0` 跳过） |
| `CC_APPROVAL_TIMEOUT_MS`  | 审批卡超时（默认 120000，超时回落拒绝）                  |
| `CC_API_KEY`              | 面板子进程经 env（而非 argv）传 API key                  |
| `cc agent --ide/--no-ide` | 外部终端强制启用 / 禁用 IDE 连接                         |

## 性能指标

| 维度             | 表现                                                                                                              |
| ---------------- | ----------------------------------------------------------------------------------------------------------------- |
| 桥接发现         | 集成终端 env 直连亚毫秒；lockfile 扫描 < 数毫秒                                                                   |
| Chat 流式渲染    | 流事件合并到 60fps 批量渲染；转录上限 800 节点防长会话卡顿                                                        |
| 面板启动         | 首条消息才 spawn `cc agent` 子进程，空面板零开销                                                                  |
| Diff 评审阻塞    | 时长由用户决定；server 端挂起响应不受超时切断，一个阻塞评审不影响其它请求                                         |
| 补全             | 手动 `Alt+\` 保持 12 秒边界；自动路径默认关闭、5 秒失败静默，并记录至少 20 个样本后的滚动 P50/P95（目标 ≤2s/≤5s） |
| 资源占用         | 每窗口一个 localhost HTTP server + 每会话 tab 一个子进程；关 tab / Stop 即回收（Windows `taskkill /T /F` 树杀）   |
| JetBrains 兼容性 | since-build 242（2024.2+）无硬上限，Plugin Verifier 对 2025.2 验证通过                                            |

## 测试覆盖

全部可在**无编辑器宿主**下运行：

| 端        | 套件                                                             | 规模                                                                                                                                                                                                                                                          |
| --------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VS Code   | `packages/cli/__tests__/unit/vscode-ext-*.test.js` 等 ~71 个文件 | **~596 用例**：桥接协议、Chat 面板 / 标签 / 事件 / 安全、diff（hunk / 多文件 / 快捷键 / 并发）、补全、CodeLens、l10n 门禁、auto-exec-guard、remote-doctor、uri-handler、plan-review、session-index、各面板；CI 含"逐命令激活 smoke"（每个注册命令都真调一遍） |
| JetBrains | JUnit 5（`./gradlew test`，纯核层）                              | **314 个 `@Test` / 40 个测试类**（含 `ReviewNoteTest` 等）                                                                                                                                                                                                    |
| JetBrains | `PureLogicSmokeMain`（`./gradlew smokeTest`，任一失败即 exit 1） | 静态 515 断言、运行时展开 **~795 项**；同时门禁中英 bundle key 齐平                                                                                                                                                                                           |
| 跨语言    | `InteropSmokeMain` + `interop-smoke.mjs`                         | 真实 Node CLI MCPClient 驱动纯 JDK server：列工具、调 `getSelection`/`openDiff`、错 token 被拒                                                                                                                                                                |

发布前另有解析级包验：`.vsix` 解包验模块存在性、JetBrains zip 解包验 `plugin.xml` 版本 / change-notes / 关键 class / 双语 bundle key。

## 安全考虑

### 网络与鉴权

- **localhost only**：MCP server 绑 `127.0.0.1`；每实例随机 Bearer token，**常数时间比较**（`timingSafeEqual`）防时序侧信道；token 永不显示（诊断输出脱敏为 `Bearer ***`）。
- 锁文件 `0600` / 目录 `0700`（POSIX），防同机其它用户读 token。

### 输入与执行安全

- **工作区信任门控**：VS Code 未信任的工作区里桥接保持禁用（`untrustedWorkspaces.supported=false`）。
- **Auto-exec 配置扫描**（Scan Workspace for Auto-Exec Config）：识别"打开即可能执行代码"的工作区文件——`.mcp.json`、git/husky hooks、shell profile、`.vscode/tasks.json` / `launch.json`、JetBrains run configs / `.idea/`——列出并让你显式 **Trust** 该工作区（按项目路径持久化）。
- **深链安全**：`prompt` 只预填**绝不自动发送**；`mode` 永拒 `bypassPermissions`；session id 形状校验；workspace 与当前打开目录不符即忽略。
- **Windows CWD 劫持防护**：spawn 全部注入 `NoDefaultCurrentDirectoryInExePath`，仓库里放个恶意 `cc.bat` 也不会被执行。
- **设置注入防护**：`chat.model` / `chat.provider` 过 shell 元字符消毒；MCP 请求体按 UTF-8 多字节重组防截断。
- **API key 走 env**：面板子进程经 `CC_API_KEY` 环境变量传 key，不进 argv（防进程列表泄露）。
- **插件策略失败闭合**：插件 hook、MCP、LSP、monitor、PTY、后台任务与原生 bin 都服从 CLI runtime 的 capability / sandbox policy；缺少声明、授权或隔离能力时 IDE 不提供绕过按钮。
- **供应链摘要不等于信任放行**：签名、SBOM 和来源只用于展示与策略判断；被组织策略禁用的插件仍可在管理视图中看见，但不能加载执行。

### fail-safe 语义

- Diff 评审 Reject / 关闭标签 / Esc 一律**不写文件**；Pick hunks 全不选 = 不写。
- 审批卡超时回落**拒绝**；Plan 的 Request changes 明确指示 agent 保持 Plan 模式、修订获批前不得执行写操作。
- headless（`cc agent -p`）保持 fail-closed，不弹 UI 评审。

## 故障排除

### 首选诊断命令

```bash
cc ide doctor          # 解释桥接发现为何成功/失败
cc ide status          # 此刻会连哪台 + MCP config（token 脱敏）
```

编辑器内：**Diagnose Bridge**（含 Node/Java、managed CLI、插件 registry 离线恢复及 **Remote / WSL Doctor**：WSL2 mirrored networking / 远端缺 cc / 桥接端口死掉，每项带可复制的修复命令）、**Show Bridge Status**、**Restart Bridge**、**Open Dashboard**（实时工具调用流）。

### 常见问题

| 现象                                   | 原因 / 处理                                                                                       |
| -------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 官方 VS Code 里搜不到扩展              | 官方 Marketplace 未上架——用 Open VSX 系编辑器（VSCodium / Cursor …）或 `.vsix` 本地装             |
| Chat 面板报 `cc` not found             | `npm i -g chainlesschain`；或设 `chainlesschain.cli.path` / JB Settings 的 cc CLI path 为绝对路径 |
| 面板能开但发消息无响应                 | LLM 未配置 / 连不通 → 跑 Configure LLM 向导，`cc llm test` 验证；看首次引导卡                     |
| 终端里 `cc agent` 没自动连             | 只有**插件启动后新开**的集成终端才有注入 env；或 `cc ide doctor` 看 lockfile 匹配原因             |
| WSL / Remote 下桥接连不上              | 跑 **Remote / WSL Doctor**：常见为 WSL2 需 mirrored networking、远端未装 cc、端口未通             |
| 旧会话不见了 / 想续接另一台 IDE 的会话 | `/sessions` 合并 CLI + 双 IDE 索引；跨 IDE 会话来自 `~/.chainlesschain/ide/session-index.json`    |
| Stop 后进程残留                        | 双端 Stop / 关 tab 都做进程树击杀；仍残留时重启桥接（Restart Bridge）                             |
| 深链点了没反应                         | 检查 workspace 参数是否与当前打开目录一致；`mode=bypassPermissions` 会被拒                        |
| JetBrains 装完菜单是英文               | 界面语言跟随 IDE：装中文语言包后重启即中文                                                        |
| 升级 CLI 后行为不一致                  | 命令面板 **Check for CLI Updates** / **Upgrade CLI**，插件与 CLI 版本步调见 What's New            |

## 关键文件

### VS Code 扩展（`packages/vscode-extension/`）

| 文件                                                                     | 作用                                                 |
| ------------------------------------------------------------------------ | ---------------------------------------------------- |
| `src/extension.js`                                                       | 激活、桥接生命周期、全部命令接线                     |
| `src/mcp-http-server.js` / `src/ide-tools.js`                            | localhost MCP server + `mcp__ide__*` 工具实现        |
| `src/chat/chat-view.js` / `chat-html.js`                                 | Chat 面板控制器 + webview                            |
| `src/chat/agent-session.js`                                              | 长驻 `cc agent` stream-json 子进程 + 树杀            |
| `src/chat/conversation-manager.js` / `ide-session-index.js`              | 多标签会话 + 跨 IDE 共享会话索引                     |
| `src/chat/plan-review.js` / `src/multi-diff.js` / `src/diff-hunks.js`    | Plan 审阅 tab / 多文件评审 / hunk 部分接受           |
| `src/auto-exec-guard.js` / `src/remote-doctor.js` / `src/uri-handler.js` | 安全扫描 / WSL 诊断 / 深链                           |
| `src/hardened-env.js`                                                    | 加固 spawn env（Windows CWD 劫持修复）               |
| `src/vendor/agent-sdk/`                                                  | vendored `@chainlesschain/agent-sdk`（协议单一来源） |

### JetBrains 插件（`packages/jetbrains-plugin/`）

| 文件                                                   | 作用                                                                                                                                   |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main/java/com/chainlesschain/ide/*.java`          | 纯 JDK 核：`McpServer` / `IdeTools` / `ConversationManager` / `ReviewNote` / `AutoExecGuard` / `RemoteDoctor` / `DeepLink` …（40+ 类） |
| `src/main/java/com/chainlesschain/ide/intellij/*.java` | IntelliJ glue：工具窗 / actions / facade / JCEF / 设置页                                                                               |
| `…/intellij/CcInlineCompletionProvider.kt`             | 唯一 Kotlin：ghost-text 补全 provider                                                                                                  |
| `src/main/resources/META-INF/plugin.xml`               | 插件清单（change-notes 构建时从 CHANGELOG 自动生成）                                                                                   |
| `src/main/resources/messages/CcBundle*.properties`     | 中英双语 bundle（key 齐平由 smoke 门禁）                                                                                               |

### 发布 / 文档

| 文件                                        | 作用                                   |
| ------------------------------------------- | -------------------------------------- |
| `.github/workflows/ide-extensions.yml`      | 双端打包发布 CI（tag + secret 双门控） |
| `docs/internal/ide-extensions-releasing.md` | 发版与维护 runbook                     |

## 使用示例

### 日常：选中代码直接问

```text
1. 编辑器里选中一段代码
2. Ctrl/Cmd+Escape 聚焦 Chat（或右键 → Explain Selection）
3. 输入 "这段有并发问题吗"——选区自动随 prompt 带上，无需粘贴
```

### 让 agent 改文件并评审

```text
1. Chat 里说 "把这个函数改成异步"
2. 弹出原生 diff：右栏可编辑，顺手润色两行
3. Ctrl/Cmd+Enter 接受——落盘的是你润色后的版本，agent 也知道你改了什么
   （只想要一半改动 → Pick hunks…；想让它重改 → Request changes… 写 `12: 这里保留同步路径`）
```

### Plan 模式跑大改动

```text
1. 输入 /plan 进入只读规划
2. 计划出现 → 自动打开 Plan Review Markdown 文档
3. 在条目的 comment: 行逐条批注 → Request changes 让它修订
4. 满意后 Approve —— 审阅快照（含批注）写进会话转录，随后自动执行
```

### 后台跑长任务

```text
1. 会话进行中输入 /handoff → 交接给 cc agent --bg 后台继续
2. 关 IDE 都行；回来后 ChainlessChain: Background Agents 面板查看/追加指令/续接
```

### 终端派（不开面板）

```bash
# 集成终端里直接跑，自动带 IDE 感知（选区/诊断/原生 diff 评审）：
cc agent -p "修一下我选中的这段代码"
cc agent --no-ide -p "..."     # 显式禁用
```

### 深链唤起

```text
vscode://chainlesschain.chainlesschain-ide/open?prompt=看下这个文件&file=src/app.ts&line=42
jetbrains://idea/chainlesschain/open?session=sess-xxxx
# prompt 只预填不发送；bypassPermissions 模式会被拒绝
```

## 相关文档

- [IDE 桥接（IDE Bridge）](/chainlesschain/ide-bridge) — 桥接机制细节：发现协议 / lockfile / MCP 传输 / 保留名让位
- [IDE 计划审阅与会话索引](/chainlesschain/ide-plan-review) — Plan Review 文档审阅、共享会话索引、`getActiveFile` 的完整设计
- [`cc agent` 托管智能体](/chainlesschain/cli-agent) — 面板背后的 agent CLI 全量能力
- [Agent SDK](/chainlesschain/agent-sdk) — 面板 ⇆ CLI 的 stream-json 协议单一契约来源（`@chainlesschain/agent-sdk`）
- [MCP 集成](/chainlesschain/cli-mcp) — 桥接复用的 MCP client / transport / 鉴权基建
- [权限系统](/chainlesschain/permissions) — `ask` 规则如何升级为 IDE 原生 diff 评审
- [远程控制](/chainlesschain/remote-control) — Remote Control 配对面板的服务端
- 设计方案：[Module 98 IDE 桥接对标方案](/design/modules/98-ide-bridge)
