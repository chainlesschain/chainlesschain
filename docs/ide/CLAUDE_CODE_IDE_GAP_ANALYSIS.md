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
- 待继续：IDE MCP parity 剩余项（JetBrains terminal output、notebook 对齐、preview/browser state、大 payload 分片审计）。

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

剩余：

- JetBrains terminal output 能力。
- notebook/Jupyter cell 读取和执行的 JetBrains 对齐。
- preview/browser state 的 DOM、console、network、screenshot 上下文。
- 大 payload 分片、超时、鉴权 token、workspace trust 边界的统一审计。

### 4. Diff Review UX

Claude Code IDE diff 的关键不是“展示补丁”，而是让用户能编辑 proposed content，并把编辑反馈给 agent。

建议：

- 支持逐文件、逐 hunk accept/reject。
- 支持在 diff 中 request changes。
- 用户直接编辑 proposed content 后，agent 能感知修改内容。
- JetBrains 尽量使用 native diff viewer，而不是只用 HTML 渲染。

## P1：产品体验提升

### 5. Prompt Context UX

Claude Code VS Code 支持 `@` 文件/文件夹、selection indicator、PDF 页面、附件拖入、context indicator 等。

建议：

- `@file`、`@folder`、`@symbol`、`@terminal`、`@browser` 统一成一个 fuzzy picker。
- 支持文件行范围、PDF 页码、图片附件、当前 selection 显示/隐藏。
- 增加 context budget 可视化，提示哪些上下文会被压缩或丢弃。
- 对敏感文件、密钥文件、配置文件加入上下文确认。

### 6. 权限模式和账户/用量 UI

Claude Code IDE 有 Manual、Plan、Edit automatically 等权限模式，也有 account/usage 面板。

建议：

- IDE 顶部或状态栏持续显示当前权限模式、模型、会话状态。
- 增加 usage 面板：session、daily、weekly、monthly 维度。
- 将消耗按 skill、subagent、plugin、MCP、tool 分类归因。
- 对高风险操作给出更清晰的 IDE 原生确认界面。

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
