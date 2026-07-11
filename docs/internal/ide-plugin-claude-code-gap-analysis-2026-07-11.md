# IDE 插件对照 Claude Code 后续补齐建议

日期：2026-07-11  
范围：ChainlessChain VS Code / JetBrains IDE 插件，对照 Claude Code VS Code 与 JetBrains 集成能力

## 结论

当前 ChainlessChain IDE 插件已经进入“基础平价完成”阶段。VS Code `0.37.12` 与 JetBrains `0.4.56` 已覆盖 Chat、Plan Review、原生 diff、行范围 `@mention`、diagnostics、terminal、App Preview、后台 agent、Remote Control QR、Plugin/MCP 管理、Chrome connector 等主干能力。

后续优先级不应继续堆普通聊天能力，而应转向安装成功率、跨端会话、可运营性、安全边界、稳定性和更深 IDE 语义。

## 落地状态（2026-07-11 当日实施，12/12 全部收口）

| 项 | 状态 | Commits |
| --- | --- | --- |
| #1 VS 官方 Marketplace | ✅ CI VSIX 元数据门禁（17 检查 + 自测先行）；⏳ Azure publisher / `VSCE_PAT` secret 仍需人工创建（workflow 已备好：tag 缺 secret 优雅跳过、dispatch backfill 缺则报错） | `3bcfa105c8` |
| #2 托管/内置 CLI | ✅ VS + JB 双端（npm 下载/sha512 校验/缓存/回滚，36 共享 fixture 深比对锁孪生；显式 `cli.path` 永不静默替换） | `25d925710c` / `75b87d0db8` |
| #3 跨端会话工作台 | ✅ VS 面板 + JB 工具窗（chat/ide-index/后台/远控四源聚合，待审批优先，15s 可见时自刷） | `d95f33691d` / `975236eec7` |
| #4 用量归因 | ✅ CLI 打标（origin/skill/subagent + tool/MCP 桶，子代理用量原先被整体丢弃已顺带修正并计入预算）+ `--by` + 两端面板渲染与成本提示（旧 CLI 字节级降级） | `6cd5f127c7` / `1e34a31176` / `0b39f69cc0` |
| #5 稳定性矩阵 | ✅ 24 新回归测试 + 矩阵文档；根治 supervisor rename flake（两个真并发写 bug：terminal 复活 + rename 丢失），10/10 soak；3 个 pinned-gap 待修（pid 复用无身份校验 / 孤儿 agent 子进程 / follow 截断重放） | `fee7dfe25e` |
| #6 Browser Action | ✅ `browser_act`（HIGH 风险强制审批、plan mode 阻断、逐步审计 JSONL、loopback-only、截图路径永不由 agent 指定）+ `cc browse chrome act`；AGENT_TOOLS 25→26（文档面随下次 cli 发版扫） | `43857e1201` |
| #7 深 IDE 语义工具 | ✅ VS 12 工具（execute*Provider）+ JB 7 工具（PSI，dumb-mode 降级）：hover/定义/引用/重命名预览/调用层级/符号归属/项目模型 | `847b3aa3c8` / `56c0d7e29f` |
| #8 JB GUI 自动化门禁 | ✅ 骨架落地：Remote Robot uiTest source set + `uiSmokeTest`/`runIdeForUiTests`（guard 保证 buildPlugin 永不受影响）+ nightly workflow（非 required、无 continue-on-error）；首跑真机验证 + 7 场景扩展在 GLUE_TODO | `0b39f69cc0` |
| #9 Artifacts 面板 | ✅ VS drawer + JB dialog（按 mime 预览、html 只外链、元数据不入正文） | `8d29ad636e` / `f8de3ec5b2` |
| #10 权限/安全策略 UI | ✅ VS + JB 只读可视化（allow/ask/deny+来源+managed、近期拒绝、auto-mode 决策矩阵+优先链） | `8d29ad636e` / `f8de3ec5b2` |
| #11 插件/LSP 质量看板 | ✅ VS + JB（8 组件计数、broken/unused 三态、LSP unknown 不造假、lsp-only 永不判 unused、无计时不给 slow） | `0afcffeb24` / `2336dd43f0` |
| #12 远程/WSL 一键修复 | ✅ VS + JB（安全项白名单直用、防火墙生成 .ps1 带提权头+幂等守卫、.wslconfig 剪贴板；注入防护测试反证；JB 加 Remote Dev host 检查） | `0afcffeb24` / `2336dd43f0` |

CLI 侧改动（#4/#5/#6）未发 npm，随下次 cli release；IDE 两端对已发布 CLI 全部优雅降级。

## P0：最值得优先补

### 1. VS Code 官方 Marketplace 上架

现状：当前 VS Code 扩展仍主要发布到 Open VSX，stock Microsoft VS Code 用户在官方扩展市场里搜索不到。

价值：

- 降低安装门槛。
- 提升可信度和自然发现。
- 减少“插件装不上”的支持成本。

建议：

- 补齐 Azure-backed publisher / `VSCE_PAT` 发布链路。
- 继续保留 Open VSX，同步双 registry 发布。
- CI 增加 VSIX 与 marketplace package 元数据解析门禁。

### 2. 插件托管/内置 CLI

现状：插件仍偏向依赖全局 `cc` 可用；Claude VS Code 图形面板则有私有 CLI 副本，用户不必先处理 PATH。

建议：

- IDE 插件内增加 managed CLI runtime。
- 按插件所需最小版本自动下载、校验、缓存、回滚 `cc`。
- 保留用户自定义 CLI path，但默认不依赖全局安装。
- JetBrains 与 VS Code 共用下载校验核心。

目标体验：

- 首启插件即可用。
- CLI 缺失、过旧、损坏时自动修复。
- 失败时给出明确诊断，而不是只报 `cc not found`。

### 3. 跨端 Remote/Cloud Session 入口

现状：已有 web-panel、mobile remote-control、background agents、共享本地 session index，但 IDE 内还缺统一的“远端/后台会话”工作台。

建议：

- 在 `/sessions` 或独立面板中加入 Remote tab。
- 聚合本机 IDE 会话、CLI 会话、后台 agent、Web/mobile 发起的任务。
- 支持搜索、接管、重命名、删除、继续、停止。
- 展示 workspace、状态、最后活动时间、是否等待审批。

价值：

- 把 ChainlessChain 的跨端能力变成 Claude Code 之外的差异化优势。
- 避免后台任务完成或等待输入时用户不知道。

### 4. 用量归因

现状：IDE usage report 已指出 per-skill / per-subagent / per-plugin attribution 需要 CLI 侧事件打标。

建议：

- CLI transcript / usage ledger 为每次模型调用、工具调用、MCP、skill、plugin、subagent 写入 attribution tag。
- IDE usage 面板按会话、模型、工具、MCP server、skill、plugin、subagent 汇总。
- 对高成本模式给出可执行建议，例如长上下文、subagent-heavy、cache miss。

价值：

- 企业用户可审计。
- 个人用户能控制成本。
- 插件生态可看到真实消耗来源。

## P1：稳定性与工作流闭环

### 5. 后台 agent / worktree 稳定性矩阵

Claude Code 最新 changelog 仍大量修复 background agents、worktree、attach/resume、daemon、PATH/env、删除 cwd、状态显示等问题。ChainlessChain 已有相关面板，应补系统级回归矩阵。

建议覆盖：

- 升级过程中 attach / resume。
- worktree 内 symlink / junction / nested repo。
- cwd 被删除、锁定、替换。
- Windows PATH / PowerShell / `cmd.exe /c` 进程树。
- 后台 agent `Needs input`、`Working`、`Completed` 状态一致性。
- dirty merge rollback 与冲突预览。
- 后台 tab 审批、隐藏 tab 完成提示、重新接管。

### 6. Browser Action 模式

现状：`browser_state` / Chrome connector 更偏只读观察，适合安全调试。

建议：

- 保持只读为默认。
- 新增显式审批的 `browser.act` 或 `cc browse chrome act`。
- 支持点击、输入、导航、等待 selector、截图断言。
- 每一步写审计日志，可回放。
- 专用 profile 默认，真实 profile 明确高风险提示。

安全边界：

- 每个破坏性或敏感动作必须审批。
- 默认仅 loopback CDP。
- 不允许 agent 自选截图覆盖路径。

### 7. 更深 IDE 语义工具

现状：已有 selection、diagnostics、active file、open editors、terminal output、diff。

建议新增：

- `getHover`
- `goToDefinition`
- `findReferences`
- `renamePreview`
- `getCallHierarchy`
- `getTestResults`
- `getSymbolOwner`
- `getProjectModel`

JetBrains 侧尤其适合用 PSI，不必只依赖文本检索。这样 agent 能理解“符号与项目结构”，而不是只读文件。

### 8. JetBrains GUI 自动化门禁

现状：JetBrains 已有 compileJava、smokeTest、buildPlugin，但不少真实问题仍需要 runIde GUI pass 才能发现。

建议：

- 使用 JetBrains Remote Driver / UI Robot 建立最低 GUI smoke。
- 覆盖首条消息、diff accept/request changes、plan review、`@mention`、terminal、inline completion、Remote QR。
- CI 至少在 nightly 或 release tag 上跑一次。

价值：

- 减少 Marketplace 发版后才暴露 UI 死面板。
- 降低人工 runIde 验证成本。

## P2：体验与生态增强

### 9. Artifacts IDE 面板

现状：CLI 已有 Artifacts v1，但 IDE 里可以进一步产品化。

建议：

- 增加 Artifacts drawer。
- 支持 Markdown / HTML / 图片预览。
- 支持下载、复制路径、重新发布、关联会话。
- artifact 只把元数据进对话，正文按需打开。

### 10. 权限/安全策略 UI

建议将以下能力变成 IDE 可视化：

- read-deny 规则。
- auto-mode decision rules。
- 敏感文件上下文屏蔽。
- auto-exec 扫描结果。
- session transcript tamper 状态。
- MCP server 权限与 OAuth 状态。

目标是让用户能看懂“agent 能读什么、能改什么、为什么被拦”。

### 11. 插件/LSP 质量看板

建议：

- 在 Plugin & MCP manager 中展示插件 LSP 是否正常初始化。
- 展示插件贡献的 skills、tools、hooks、LSP、commands。
- 标记失效插件、未使用插件、启动慢插件。
- 对 LSP-only 插件避免误判未使用。

### 12. 远程/WSL 一键修复

现状已有 Remote / WSL Doctor。

建议升级：

- 不只输出命令，还能一键应用安全范围内的修复。
- 对需要管理员权限的 Windows Firewall 规则生成 `.ps1` 修复脚本。
- 对 JetBrains Remote Development 检查 Host 插件安装位置。

## 可后置

- 自动触发 ghost-text 补全：当前手动 `Alt+\` 已够用，自动触发容易增加成本和干扰。
- 更多普通 slash command：除非能减少真实工作流步骤，否则优先级不高。
- 聊天 UI 继续美化：主干体验已完整，收益低于安装、会话、成本、安全。

## 参考来源

- Claude Code VS Code 文档：https://code.claude.com/docs/en/ide-integrations
- Claude Code JetBrains 文档：https://code.claude.com/docs/en/jetbrains
- Claude Code changelog：https://code.claude.com/docs/en/changelog
- 本仓库参考：
  - `README.md`
  - `CHANGELOG.md`
  - `packages/vscode-extension/README.md`
  - `packages/vscode-extension/CHANGELOG.md`
  - `packages/jetbrains-plugin/README.md`
  - `packages/jetbrains-plugin/CHANGELOG.md`
  - `packages/jetbrains-plugin/GLUE_TODO.md`
