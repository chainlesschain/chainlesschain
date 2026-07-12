# ChainlessChain IDE 对照 Claude Code IDE 差距与优化建议

> 评估日期：2026-07-11  
> 范围：VS Code、JetBrains、IDE Bridge 与 CLI/IDE 协作

## 结论

ChainlessChain IDE 已越过“聊天侧栏”阶段。VS Code 0.37.4、JetBrains 0.4.46
已经具备编辑器上下文、原生 diff、审批模式、会话恢复、checkpoint、终端和诊断上下文等核心能力。
下一阶段不应继续堆菜单，而应优先补齐协议、安全、远程开发和可靠性。

建议顺序：协议与安全 → 断线恢复与远程开发 → Plan/Review → 后台 Agent/worktree → 治理与可观测性。

## 落地状态（2026-07-11 实施）

本轮先做 4 路审计（协议 / 连接与隐式上下文安全 / 会话生命周期 / 远程与质量门），逐项核实
「已有 / 部分 / 缺失」后，落地了 Windows 可做的真缺口。CLI/IDE 改动均未发 npm/未发插件，
随下次各自 release；对已发布 CLI 全部优雅降级。

| 领域 | 本轮收口 | Commit |
| --- | --- | --- |
| P0#1 协议产品化 | 跨语言协议 fixture 契约（TS↔Java 从「对文档」升级为读同一批 fixture 的机器强制断言）+ `tool_use_id` + 事件 `seq`（additive，PROTOCOL_VERSION 不变） | `190a973a7a` |
| P0#2 隐式上下文安全 | IDE 选区/标签/terminal/diagnostics 注入前过 read-deny（凭据文件剔除）+ 凭据脱敏（PEM/Bearer/AWS/厂商 token 前缀/秘密赋值）；逃生门 `CC_IDE_CONTEXT_REDACTION=0` | `492f89a5fd` |
| P0#2 连接安全 | MCP 工具路径边界守卫（`..`/UNC/工作区外/前缀混淆全拒，双端纯核孪生）+ Windows lockfile bearer token owner-only ACL（icacls / AclFileAttributeView，fail-open） | `c299976aff` |
| P0#2 写路径风险提升 | auto-exec 配置写守卫接入 CLI 写路径（`.vscode/tasks·launch·settings`、`.mcp.json`、`.idea/runConfigurations`、devcontainer、code-workspace → 写前确认，headless fail-closed） | `492f89a5fd` |
| P0#3 远程开发 | 声明 `extensionKind: ["workspace"]`，锁死扩展与注入终端在 repo host（Remote/WSL/Container 确定性）；Remote/WSL Doctor 四类检查此前已 landed | `1abdce5d1b` |
| P0#4 会话可靠性 | 修复 supervisor 3 个 pinned gaps（pid 复用身份校验 / 孤儿 agent 子进程回收 / follow 截断全量重放）+ prompt 队列有界（100 上限背压） | `fe3e139ede` |
| P0#5 质量门 | 修 CI 路径过滤缺口（只改扩展源码的 PR 现在会跑 76 个 vscode-ext 测试）；协议 fixture 契约兼作跨端机器强制 | `1abdce5d1b` / `190a973a7a` |
| P1 diff 加固 | diff apply 乐观并发守卫（评审期盘上漂移 → 确认再写，默认取消）+ 二进制文件守卫（NUL 探测，UTF-8 中文不误判），双端纯核孪生 | `1abdce5d1b` |
| P1 diff 编辑器缓冲区 stale 拒绝 | VS 漂移门原只读磁盘 → 评审期目标文件在他处标签**未保存**编辑时盲写会静默销毁；改为优先比对**活缓冲区**文本（内容比对而非版本号，edit-then-undo 不误报），与 JB（早已读内存 Document）对齐；文案两端刷新覆盖"未保存/磁盘"两态 | `2a21a587ad` |

### 仍缺（环境阻塞 / 大改 / 待拍板）

- **协议（P0#1）剩项**：capability 双向协商与 N/N-1 降级、跨事件 trace id、stream/bg 事件面的
  event seq gap 回放与 ack/replay（当前仅远程接管控制面有）、背压协议、remote URI/path mapping。
  这些是协议层较大改动，非 Windows 环境阻塞，建议单独规划一轮。
- **隐式上下文（P0#2）度量项**：200 种凭据样本脱敏召回率 ≥99% / 误报 <2% 需真实语料基线，
  本轮实现保守正则，度量未做；approvalId 绑定操作指纹（工具名+参数哈希）属 P2。
- **远程开发（P0#3）**：五类远程环境（WSL/SSH/Dev Containers/Codespaces/Gateway）的连接/上下文/
  diff/审批/取消/resume 统一 E2E 矩阵、URI/path round-trip 100% 正确 = 需真实远程环境，环境阻塞。
- **会话可靠性（P0#4）**：统一状态机（starting/ready/…/recovering，当前 3 套发散表示）属抽象整合；
  IDE 聊天面板的危险工具幂等覆盖（当前 ledger 仅 WS 端点）需 headless resume 侧改动；
  1000 次启停 / 8 小时 soak = 环境阻塞。
- **质量门（P0#5）**：capability manifest 单一真源生成文档/测试/行为清单、Marketplace 安装包
  smoke、nightly 远程矩阵 = 部分需 CI 配额与真实安装环境。
- **P1 剩项**：diff 的 rename/delete 语义（需协议/agent 侧携带改名与删除意图，属跨层大改，
  非纯守卫）；可观测性的 traceId 端到端贯穿与脱敏诊断包打包。编辑器文档 stale 拒绝已于
  `2a21a587ad` 收口（活缓冲区内容比对，双端对齐）。

每个已落地项均含 RED 反证与定向测试（详见各 commit）。

## 当前基线

| 领域 | 已有能力 |
| --- | --- |
| 发布 | VS Code 0.37.4 已发 Open VSX；JetBrains 0.4.46 已发 JetBrains Marketplace |
| Bridge | cc ide 自动发现编辑器 MCP server；集成终端自动连接 |
| 上下文 | 选区、文件与行范围、workspace symbol、diagnostics、terminal output |
| 评审 | openDiff、Accept/Reject、行批注 Request changes、openMultiDiff |
| 会话 | 多 tabs、resume、retry、checkpoint rewind、后台完成与待审提示 |
| 控制 | normal、auto、bypass、plan，扩展思考与 context/cost 指示 |
| 工作流 | Fix、Explain、Refactor、App Preview、CLI 版本检测与升级 |
| 质量 | 最近已修复二进制劫持、shell 注入、EDT 冻结、会话竞态、UTF-8 截断 |
| 测试 | VS Code 51 文件/456 测试；JetBrains compileJava、smokeTest、buildPlugin |

## Claude Code IDE 基线

Claude Code VS Code 强项是原生 diff、自动选择/文件上下文、权限模式、上下文指示，
以及可作为完整 Markdown 文档打开并逐行批注的 Plan。

Claude Code JetBrains 支持 IDE diff、选择和 diagnostics 共享、外部终端通过 /ide 连接，
并明确说明 JetBrains Remote Development、WSL2 NAT、防火墙和 mirrored networking。

官方安全要求还强调：自动 IDE 上下文必须受 Read deny 约束，IDE 配置文件可能形成执行绕过，
权限规则与 OS 沙箱应形成纵深防御。

## P0

### 1. IDE Bridge 协议产品化

建立共享版本化 schema，覆盖 handshake/capabilities、session/turn/tool/approval/trace id、
事件序号、ack/replay、cancel/resume、文档 version、remote URI/path mapping、背压和错误码。
TypeScript 与 Java 模型从同一 schema 生成。

验收：

- VS Code 与 JetBrains 共用 100% protocol contract tests。
- runtime 兼容当前 N 与前一 N-1 插件。
- 断连后 3 秒内进入 disconnected；恢复后事件零丢失、零重复。
- cancel P95 小于 500ms；未知 capability 可降级而不崩溃。
- 10,000 条录制事件在两端回放得到相同最终状态。

### 2. 本地连接与隐式上下文安全

Bridge 只绑定 loopback/OS socket，使用短期随机凭据和 challenge-response。
选区、标签、diagnostics、terminal 等隐式上下文统一经过 Read deny 与凭据脱敏。
修改 .vscode、.idea、tasks、launch、run configuration 和构建脚本时提升风险等级。

验收：

- deny 文件在模型请求、日志、trace、诊断包中均为 0 字节。
- 未认证进程无法调用 IDE tool。
- path traversal、symlink、UNC/WebDAV、命令拼接和恶意 workspace 测试 100% 阻断。
- 200 种凭据样本脱敏召回率不低于 99%，误报率低于 2%。
- 每个副作用关联唯一 approvalId；managed deny 不可被 bypass 覆盖。

### 3. 远程开发正式支持

将 WSL2、Remote SSH、Dev Containers、Codespaces、JetBrains Gateway 纳入支持矩阵。
Agent、文件、git 和命令必须运行在 repo 所在 host，本地插件只负责 UI。

验收：

- 五类远程环境运行同一套连接、上下文、diff、审批、取消和 resume 测试。
- URI/path round-trip 100% 正确，覆盖空格、中文、symlink 和 multi-root。
- 网络闪断 30 秒后可恢复，已确认工具调用不会重复。
- 本地插件不能读取未经 remote host 授权的远端文件。
- Doctor 能诊断 WSL NAT、mirrored networking、防火墙和版本不兼容。

### 4. 会话生命周期可靠性

统一 starting、ready、running、waitingApproval、cancelling、disconnected、recovering、
completed、failed、stopped 状态机；所有状态持久化，危险工具恢复时不得静默重试。

验收：

- IDE 重启后 5 秒内可重新附着运行中会话。
- 连续 1,000 次启停/重连无残留进程和端口。
- 随机 kill CLI、Bridge、extension host 后最终状态一致率 100%。
- 8 小时 soak 内存增长低于 10%；stop 不阻塞 JetBrains EDT 或 extension host。
- 满队列时明确背压或降级，不允许 UI 假死。

### 5. 跨 IDE 质量门

由 capability manifest 生成文档、协议测试和两端行为清单，缩小 VS Code 与 JetBrains 测试深度差。

验收：

- 每个 PR 跑协议、安全和核心 UI E2E。
- nightly 覆盖 VS Code stable/insiders、当前/前一 JetBrains platform、三大 OS。
- 远程矩阵 nightly 全跑；P0 flaky rate 低于 1%。
- 对 Marketplace 安装包执行真实安装 smoke test。

## P1

### Plan 文档评审

Plan 作为 Markdown 文档打开，支持逐行批注、修订和批准；批准时选择 normal、
accept edits 或受限 auto，并把 Plan 与执行 turn、diff、checkpoint 关联。

验收：未批准前源码写入为 0；批注到修订 E2E 100%；执行权限与批准选择一致。

### IDE 语义上下文

在现有 symbol mention 上补 symbol range、references、implementation、call hierarchy、
结构化 diagnostics、测试树、覆盖率、SCM 和 dirty buffer version，并按 token budget 裁剪。

验收：TypeScript/Java/Python 均有真实项目测试；定位准确率不低于 99%；
stale version 拒绝率 100%；相同任务 token 中位数下降至少 20%。

### 后台 Agent 与 worktree UI

复用 CLI Supervisor，展示 Agent 树、审批、模型、token、费用、worktree 和任务状态，
支持 attach、cancel、resume、open diff、merge、discard；IDE 关闭后任务继续。

验收：10 Agent 并发状态 P95 小于 1 秒且无串流串台；可独立取消；
worktree merge/discard 不丢未跟踪文件；IDE/CLI attach 状态一致。

### Diff 与 Checkpoint 加固

覆盖 dirty buffer、create/rename/delete、mode change、二进制、部分 hunk、formatter 并发修改。

验收：接受后工作区与预览逐字节一致；文档 version 冲突强制重算；
checkpoint 不覆盖用户修改；外部进程修改时标记 coverage: partial。

### 可观测性与 Doctor

traceId 贯穿 Webview、Bridge、CLI、模型、tool、approval、diff 和 checkpoint；
提供脱敏诊断包与协议录制回放。

验收：95% 交互具备端到端 trace；诊断包 secret scan 零命中；
80% 常见连接故障给出具体修复；协议可离线回放 UI 问题。

## P2

- 测试与 Review 闭环：失败测试或 review comment 一键转受控任务；未运行测试不得报成功。
- 企业治理：managed settings、签名、版本 pin、灰度、SBOM、MCP/provider allowlist、审计导出。
- 分发：补齐 Microsoft VS Code Marketplace，发布后验证实际 registry 安装包。
- 可访问性：全键盘、屏幕阅读器、高对比度、200% 缩放和中英文错误信息。

P2 验收：comment-to-fix E2E 全绿；策略绕过 100% 阻断；审计完整率 100%；
5 分钟内可回滚；核心流程无鼠标可完成，WCAG 2.2 AA 无严重问题。

## 实施顺序

### 阶段 1：协议与安全

交付 schema/capabilities、TS/Java 生成模型、本地认证、上下文 policy/redaction。
退出门：contract、安全攻击集和 N/N-1 兼容测试全部通过。

### 阶段 2：可靠性与远程

交付状态机、幂等恢复、五类远程环境、path mapping 和 Doctor。
退出门：远程矩阵全绿，随机断连/kill 无重复副作用。

### 阶段 3：工作流

交付可批注 Plan、语义 context providers、diff 冲突处理、后台 Agent/worktree UI。
退出门：核心旅程 E2E、10 Agent 并发与 8 小时 soak 达标。

### 阶段 4：运营治理

交付 OTel、录制回放、能力文档生成、Marketplace、签名、灰度与企业策略。
退出门：发布矩阵、审计完整率、回滚时间和 flaky rate 达标。

## 暂不优先

- 继续堆斜杠命令和右键菜单。
- 在 IDE 重算 CLI 已有的 cost、context、权限和 session。
- 在恢复协议稳定前扩展大规模 Team UI。
- 复制 Claude 账号、订阅等供应商专属界面。
- 优先做云端 Remote Control；先保证本地与 remote-host 可靠性。

## 参考资料

- [ChainlessChain 更新日志](https://docs.chainlesschain.com/changelog.html)
- [ChainlessChain Agent 模式](https://docs.chainlesschain.com/chainlesschain/cli-agent-mode.html)
- [ChainlessChain CLI Agent Runtime](https://docs.chainlesschain.com/chainlesschain/cli-agent-runtime-plan.html)
- [Claude Code VS Code](https://code.claude.com/docs/en/ide-integrations)
- [Claude Code JetBrains](https://code.claude.com/docs/en/jetbrains)
- [Claude Code Platforms](https://code.claude.com/docs/en/platforms)
- [Claude Code Permissions](https://code.claude.com/docs/en/permissions)
- [Claude Code Security](https://code.claude.com/docs/en/security)
