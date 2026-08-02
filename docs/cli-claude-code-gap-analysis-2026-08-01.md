# ChainlessChain CLI 对照 Claude Code CLI 补齐与优化方案

> 分析日期：2026-08-01
>
> ChainlessChain 基线：`packages/cli` v0.162.189
>
> Claude Code 参考基线：官方文档与 2.1.220 changelog（2026-07-25）
>
> 文档性质：现状审计、实施方案与持续进度记录；未标记“已完成”的项目仍是待办

## 实施进展（更新至 2026-08-02）

| 方案项                                             | 状态                             | 落地结果与验证证据                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P0 lazy dispatch、单次执行与启动 SLO               | 已完成                           | `c42820ab13`：phase-0 dispatch、生成式帮助、`OutputContext`、轻量 status 与启动基准落地；Windows 冷启动四项 p95 均满足仓库阈值                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| P0 typed config、secret、文件权限与 Sandbox 默认值 | 已完成                           | `a4d1c05133`：版本化 schema、统一 redaction、OS secret store、原子迁移、POSIX mode、Windows 当前用户 ACL、doctor 修复和 fail-closed sandbox；179 项目标测试通过                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| P0 MCP `ws/wss` 与 scope                           | 实现完成，release 证据未关闭     | `392398a09d`：WebSocket transport、作用域与运行时契约落地；`0de8744151` 修复 `configScope/configSource/projectPath` 传播，并确立 `managed/显式 > local > project（.mcp.json 优先于 legacy project DB）> user > plugin`，新增真实 `type:"ws"` runtime socket、结构化 close/timeout 回归。本地变更集 70/70，扩大 9 文件 156/156；CLI CI `30743223135` cancelled，无同 SHA Strict/Host 完成证据                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| P0 Session 事实源与可恢复 Agent runtime            | 仓库安全闭包继续收口，发布门未关 | `ca4fe4ef73`、`199b2cb7c6`、`4c656ac7ec` 完成索引、增量持久化、WS 恢复和测试工作区隔离；`a72d75d153` 收口 MCP authority 读写、transcript 锚点、严格 started→terminal 状态、Headless/Stream/Cowork 恢复与 semantic-compaction 计费；`b21ba58c2c` 至 `ab32a57e4b` 继续加固 schema、malformed projection、动态 latch、transport outcome-unknown、REPL 原子恢复和各宿主共享 authority。`24349b05fd` 收紧 WS recovery projection/refresh，`842691eedf` 覆盖 roots-only MCP client，`223c0f505c` 使 Stream resume 的 authority 切换保持事务一致；`1c572b213f` 新增独立 `mcp_call_recovery_adjudication` authority event、verified head/recovery digest、单次 CAS、TTY typed confirmation 与单调 exact-replay deny，`confirmed_not_applied` / `confirmed_applied` 均不伪造机器 terminal record。提交前干净索引快照的 12 文件矩阵 263/263、REPL MCP 目标 6/6 通过；独立安全审计无剩余高/中 blocker。裁决要求键入包含 `HOST STOPPED` 的完整 challenge，但这只是所有既有宿主已停止的操作性证明，不是跨进程 lease/revision；新 authority 仅在 restart/resume 后采用。真实 kill/restart、恶意 MCP、长期矩阵及待发布 exact commit 的 `CLI CI` + `CLI Strict Sandbox` 全平台权威矩阵仍未关闭 |
| P0 Skill 受控执行与内容身份授权                    | 已完成基础                       | `c841a58e2b`：用户可写 Skill 默认不受信，执行前异步复核精确 digest，经隔离 Agent 与 host-owned 工具边界运行，并透传 LLM 配置、命令侧失败关闭；`a72d75d153` 接通 runtime 的异步 materializer 与子 Agent 用量来源归因；`c2ffbb7f22` 将子 Agent 的提示上下文与 `fresh/fork` authority 分离，并把已 resolve 但状态为 failed 的隔离 Skill 规范化为结构化失败。真实宿主/恶意 Skill 长期矩阵仍未完成                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| P0 exact-SHA 发布门禁与原生发行链                  | 门禁已实现，发布阻断             | `6d229d0df4`、`55b3c55a1c` 提供三平台 exact-SHA gate、不可变 npm tarball、六目标 manifest、同版本身份校验、禁止覆盖 versioned asset 与 stable-channel 激活协议；发布契约 28 项通过。`223c0f505c` 的 Strict Sandbox run `30715641925` 与 `b6a2c096ea` 的 run `30716039185` 均在 Ubuntu 24.04、macOS 15、Windows 全绿，但只能授权各自 SHA，不能替代同 SHA 的完整 `CLI CI`。`8990999771` 的 `CLI CI` run `30716233638` 已失败，且同 SHA 没有成功的 Strict Sandbox；`1c572b213f` 也尚无待发布 exact-SHA 双门结果。没有待发布精确提交上的完整 `CLI CI` + `CLI Strict Sandbox` 权威矩阵，不得发布                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| P0 签名更新与回滚链                                | 仓库级事务加固已提交，发布阻断   | `4d3a4ee788` 提供签名 manifest、健康检查与初版自动回滚；`8990999771` 提交原生 installer/OTA 的锁、状态、sidecar、alias、backup lineage、结果消费与 rollback/rescue 事务加固，冻结后的 8 文件定向矩阵最终为 142/142，此前中间审计快照不再作为证据。`a1c9eed07e` 又关闭下载目标替换恢复缺口，下载器 30/30、相邻更新矩阵 122/122，通过只读复审的该批范围为 P0=0、P1=0。当前证据仍只是仓库/进程级验证：尚缺 durable intent/phase journal 或原子 generation pointer、真实 taskkill/断电一致性、Linux/macOS 与 ARM64 实机执行、签名/notarization/Authenticode，以及待发布 exact SHA 的完整发行矩阵；不得标记为 release-ready                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| P1 `/btw` 临时旁路与统一输出契约                   | 已完成                           | `316f7497b4`、`c42820ab13`：旁路问题不污染主会话历史与上下文，quiet/verbose/json 统一经输出上下文收口                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| P1 后台 Agent 恢复配置与隔离                       | 已完成                           | `34414b64f9`、`b1b0570091`：持久化、去敏的 background launch profile、指纹与兼容性校验、外部凭据注入、跨平台 canonical path 恢复；本地单文件 39 项通过，`CLI Strict Sandbox` 在 Ubuntu 24.04、macOS 15、Windows 全绿                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| P1 默认 Agent 与命令面 manifest                    | 基础完成，长尾迁移进入 pilot     | `6b2b394fd1`：修复 14 个域的嵌套帮助路由和跨 OS help 漂移，175 条命令写入 stability/category/visibility/replacement 元数据，默认命令与核心分组由 manifest 驱动；单元 30 项、E2E 57 项通过。`c50d2f8a53` 新增虚拟 `lab` namespace，以 `dao`、`evomap` 完成首批迁移，旧顶层入口在至少两个 release cycle 内保留兼容转发与弃用提示，注册顶层命令净增长为 0，并生成 completion 与 README；命令组 3 文件 35/35 通过。`1f2a9caf3d` 补强 lifecycle 契约，补充 13/13 通过。其余长尾迁移和兼容窗口后的实际移除仍待完成                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| P1 Plan/Todo/会话可靠性                            | 已完成                           | `ece470137d`、`d28dd7d9fc`、`70306bd8ee`：Plan/Todo 持久化、revision 冲突保护和结构化 handoff 落地                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| P2 Provider-neutral Advisor                        | 已完成                           | `8e6e617373`：Advisor runtime、命令与 REPL 接口落地；83 项测试通过                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| P2 交互输入、提示建议与 Session recap              | 模块完成，生产 REPL 接线待办     | `6845c4a6ac`、`ca4fe4ef73`：剪贴板图片、编辑器、stash、suggestions、快捷键、终端布局与 recap 模块及独立 UX 回归 49 项已完成；复核确认 `PromptInteractionController`、`registerPromptInteractionCommands` 与 `SlashCommandRegistry` 尚未进入生产 REPL，`/suggestions refresh` 尚未携带 assistant context，`/paste-image` attachment 尚未进入消息/vision LLM 路径，因此不得宣称端到端接线完成                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

本轮安全批次已覆盖真实 Windows Unicode 路径及目录/文件 ACL 修复。Windows PowerShell ACL 的冷启动延迟仍列为后续 P2 性能优化，不影响当前安全语义与提交边界。`a72d75d153`、`223c0f505c`、`b6a2c096ea` 和 `5df2e1bdac` 各自已有三平台 `CLI Strict Sandbox` 成功证据；其中 `5df2e1bdac` 把完整 MCP recovery/adjudication 生产与测试边界纳入触发路径，run `30724810078` 在 Ubuntu 24.04、macOS 15、Windows 全绿。`925a49fb7b` 的 Strict Sandbox run `30725436007` 三 OS 全绿，但同提交的 `CLI CI` run `30725436119` 被取消；`963c6d46dd` 的 Strict run `30725805331` 三 OS 全绿，但其 `CLI CI` run `30725805407` 也被取消；`6b4570c80f` 的 Strict run `30727179738` 三 OS 全绿，而同 SHA 的 `CLI CI` run `30727179832` 已失败。`1cd36e4212` 的 Strict run `30728860734` 三 OS 均失败；`2e50772542` 修正注入 transcript 缺失 hash chain 的 fixture 后，本地 headless-runner 67/67，其 Strict run `30729294491` 在 Ubuntu 24.04、Windows、macOS 15 全绿，但同 SHA 的 `CLI CI` run `30729294557` 被取消。最新 `6a1ebaa188` 的 Strict run `30729639108` 也在三 OS 全绿，但同 SHA 的 `CLI CI` run `30729639052` 已因 resume role-alternation E2E 失败。这些结果只能授权对应精确 SHA 与对应门禁，不授权更晚 SHA，也不能替代同 SHA 的完整双门。npm/原生发行物不得依据本地测试、旧提交矩阵或仅成功生成的 artifact 发布，必须以待发布精确提交上的 `CLI CI` 与 `CLI Strict Sandbox` 全矩阵、签名/安装/升级/回滚和公开渠道回读全部通过为最终门禁。

### 2026-08-02 原生事务增量与当前证据边界

`8990999771`、`a1c9eed07e`、`dc69dbb62d` 与 `ab17a76048` 已同步到 GitHub 和 Gitee；这只固定了提交边界，不表示发布验收完成。`8990999771` 冻结后的 8 文件定向矩阵最终为 142/142，相关 Node 语法、Prettier、ESLint、`bash -n`、PowerShell parser/import 与 diff-check 通过；此前的较小矩阵和单个 `cli-aliases` 超时属于中间快照。`a1c9eed07e` 随后完成下载目标替换事务：覆盖前保留旧 destination，提交后验证、目录持久化或恢复失败均 fail closed；锁丢失时停止写目标并保留可验证恢复副本。下载器定向测试 30/30、checker/downloader/applier/auto-update 相邻矩阵 122/122 通过，该批最终只读复审为 P0=0、P1=0。`dc69dbb62d` 再修复 POSIX lineage 回滚：fresh install 即使在 lineage 的 `os.replace` 成功后才报错也会清除本事务 lineage；upgrade 使用同目录原子 rename 恢复旧 lineage，不再先删除公共路径，恢复失败时保留可见 lineage、快照与锁。本地 8 文件相邻矩阵为 146 passed、7 个 POSIX 动态用例在 Windows 按平台条件跳过。`ab17a76048` 又把 `priorTarget` 硬链接快照纳入 durable recovery pointer，以同一 `O_NOFOLLOW` 描述符覆盖 validate→retire，重检 inode/content，并增加 final anchor 父目录 durability barrier、SIGKILL、同字节 inode 替换及最终 fsync 故障回归；Windows 定向为 6 passed、24 个 POSIX 用例按平台跳过，bash/sh/dash 语法检查通过。`6a1ebaa188` 的 macOS CI 中本文件 28 passed / 2 个 PowerShell 用例跳过，但 Ubuntu 的 alias 同内容新 inode successor 用例失败并发生 target 部分回滚；Linux blocker 正在修复，Windows exact-SHA native job 尚未形成结论。该 pointer 不等于完整 generation transaction。

证据更正：`4145508010` 只是 retained tombstone cleanup 语义的中间提交，后续独立审计仍发现 lock、cleanup、orphan quarantine 与 candidate pathname race，不能作为安全闭包。`1354be776a` 才是本轮 successor-safe follow-up：单文件本地结果为 10 passed / 43 skipped，其中 10 个通过项包含 `wsl.exe` 下 bash/dash × backup/lineage 的 4 个真实动态用例；第六轮独立只读审计在该提交范围内为 P0=0、P1=0。它采用保守保留和 fail-closed，因此仍有人工处置 orphan、retained evidence 累积与常态 cleanup-degraded 等 P2，不等于完整 generation transaction 或 release-ready。

尚未关闭的发布阻断为：

1. 为 target、`.previous`、lineage、alias、sidecar 与 result 建立 durable intent/phase journal 或原子 generation pointer，保证任意阶段强杀/断电后能确定恢复到一个完整 generation。
2. 在真实 Linux、macOS、Windows 上进行进程强杀、断电等价故障注入、文件与目录持久化、重复恢复、fresh install、upgrade 和 rollback；x64 与 ARM64 必须实际运行目标二进制，不能以 workflow 声明或仅完成构建代替。
3. 完成 macOS signing/notarization、Windows Authenticode、Linux 发行签名及公开 manifest/asset/package-manager 回读。
4. 在最终待发布 exact SHA 上让 `CLI CI` 与 `CLI Strict Sandbox` 的全部配置 OS 同时通过。`8990999771` 的 `CLI CI` run `30716233638` 已失败，且没有同 SHA 成功的 Strict Sandbox，当前不得发布。

### 2026-08-02 Session scale 组件门进展

`b5c50bb513` 已提交独立 `CLI Session Scale` 门禁、canonical session index/repair 加固和 exact-SHA artifact。仓库定向测试为 79 passed、1 skipped；Windows 默认 smoke 覆盖 3 个 writer 各 25 次并发 append、250 sessions、64 MiB transcript，以及 2 个原始写入进程和 2 个生产 append pipeline 的 SIGKILL 边界，全部通过。手工 formal run `30724908237` 以输入 `commit_sha=b5c50bb51368a849d649fb8d27bd790d46217c20` checkout 精确提交，Ubuntu、Windows、macOS 三个 formal job 全部成功并上传 exact-SHA artifact。该成功只证明本节所述组件门，不授权更晚提交，也不替代最终 release SHA 的重跑。

`9cbe020b08` 已为覆盖到的 canonical resume 路径提交 forward verified projection、checkpoint 后缀消息重建和增量 MCP reducer；`213c3ae7c5` 又让 Headless/Stream 与 WS 的覆盖路径使用同一 verified sample，并加入 canonical WS request claim。因此不能继续笼统表述为“Stream/MCP 恢复必须整体 materialize 全部 event”。但是普通 hash-chained JSONL 仍需要 O(N) 前向认证，sidecar 不是独立 anti-rollback anchor；真实冷进程 1 GiB 恢复 p95 `< 2s`、RSS `< 100MB`、10k session、断电/fsync 与所有 legacy/create/IDE/background 入口一致性仍未完成。组件门、宿主一致性门和本地测试均不得外推为这些产品级验收已通过。

### 2026-08-02 MCP 调用边界后续加固

`925a49fb7b` 已提交统一的 MCP wire input 深冻结快照，admission、durable ledger identity 与原始 transport 使用同一对象；Proxy、accessor、稀疏数组、非 JSON 数值和 thenable 等歧义输入在网络调用前失败。公开 recovery projection 只接受 `read/unknown/write/destructive` effect。非持久 REPL、普通 headless 与 ephemeral stream 也始终把 host runtime 的 guarded ledger 传入 `agent-core`：第一次不安全 transport 出现 `outcome_unknown` 后，同进程第二次调用在 prewrite 阶段以 `blockMode=unsafe` 阻断，底层 `callTool` 不会再次执行。提交前复核为 7 文件核心矩阵 132/132、REPL MCP 子集 32/32；Prettier、Node 语法和 diff-check 通过，ESLint 为 0 error、100 个既有 warning。该提交仍不把 `HOST STOPPED` 升级为跨进程 lease，也不替代恶意 MCP、kill/restart、长期和最终 exact-release 双门矩阵。

### 2026-08-02 命令生命周期与会话资源预算基础

`c50d2f8a53` 已提交虚拟 `cc lab` namespace、`dao`/`evomap` 首批迁移、至少两个 release cycle 的旧入口兼容转发与弃用提示，以及由 manifest 驱动的帮助、completion 和 README；注册顶层命令净增长为 0。命令组 3 文件 35/35 通过。`1f2a9caf3d` 随后补齐真实 dispatch、弃用输出与 completion 等 lifecycle 契约，补充矩阵 13/13 通过。该结果只表示 pilot 阶段完成，其余长尾命令仍须按使用率和兼容窗口逐批迁移。

`008335171f` 提交 session resource budget primitive 与 SubAgent 本地 adapter；`f9c3a7d258` 提交后台任务 cleanup 基础，`65796e6ec6` 将后台 lease 保持到子进程实际退出，`9611afb8c8` 收紧 usage aggregate/details 一致性，`6383e66201` 为 TeamRunner 增加 fail-closed fence 与 scoped authority，`6b4570c80f` 将对应矩阵纳入 Strict Sandbox gate。`e5963e8a2b` 将运行数修正为活跃 PID 与 `RUNNING` task ID 的并集，恢复后台 `maxConcurrent` admission；后台矩阵 44/44、并发目标 2/2 通过。`35d9ce9aba` 使 PowerShell completion 生成在不同平台保持确定性。

`6a1ebaa188` 提交持久化 session budget runtime：unknown-usage intent 采用 marker-first，read 绑定 main revision 与 marker revision/SHA-256，所有 sidecar 操作共用 per-session 主锁，finalize 只清除精确观察到的 marker；后到 marker 会 durable merge 后冲突并保留证据。authority 持久化失败会回滚本地 release/end/usage/recovery 状态，custom signal cleanup 不再泄漏 runtime reference。独立扩大回归为 10 files、181 passed / 2 个 POSIX 用例在 Windows 跳过，三文件 Node 语法和 Prettier 通过。

当前仍只是 **foundation、process-local runtime 与 cooperating-writer CAS**：生产 root 与全部 WS/REPL/headless/tool/token/turn 入口尚未统一接线；sidecar 不是 machine-wide authority，也没有独立 anti-rollback/transcript-head 绑定。host snapshot 仍缺跨进程 head lease/fencing，真实恢复仍有 O(N) 全量读取，精确竞态回归也不是 fork 进程证明。因此不得把本轮状态标记为“统一全会话预算”或“真实长会话完成”。`6a1ebaa188` 的 Strict run `30729639108` 三 OS 全绿，但同 SHA 的 `CLI CI` run `30729639052` 已失败，暴露 resume legacy fixture、Linux alias rollback、macOS synthetic Windows-sidecar 和 Windows 8.3 path fixture 问题；前两项 fixture 分别由 `b6e648a820`、`2f0182226c` 修复，安全语义相关的 Linux alias 与 macOS sidecar 仍在处理。在最终待发布 SHA 的 `CLI CI` 与 `CLI Strict Sandbox` 双门全绿之前不得发布。

后续预算增量为：`2a85acb901`、`be86097be2` 加固持久预算 authority、persist-first final close、失败后的 durable dirty recovery 与旧 handle/lease 撤权；`73ad3b7378` 又绑定精确 budget sidecar 文件身份，本地单文件为 36 passed / 3 skipped。独立复审确认它在“私有目录 + `withFileLock` 协作写入者”边界内无 P0/P1，但非协作 same-UID 写入者仍可触发临时路径 cleanup、sidecar rename 覆盖和 usage-unknown marker retirement 的 successor 风险；这些在 machine-wide/hostile-writer 声明下仍是 P1 NO-GO。生产 root 和全部入口统一接线前，不得把该 foundation 升级为全机预算 authority。

> **历史基线阅读说明**
>
> 以下第 1～13 节保留 2026-08-01 审计时的现状、方案与验收目标。正文中的“当前”“尚未”“下一步”均按该历史快照理解，不再直接代表仓库最新状态。2026-08-02 的组件实现、本地测试、独立审计、exact-SHA CI 与 release 判定，以文末“实施状态附录”为准。

## 1. 结论先行

ChainlessChain CLI 已经不是“功能少于 Claude Code”的阶段。当前清单有 **175 个顶层命令、28 个静态 Agent 工具**，权限、Sandbox、MCP、Skills、Plugins、Hooks、后台 Agent、Agent Teams、Worktree、Goal、Routine、Remote Control、IDE、语音、全屏 TUI、Artifacts 等主体能力大多已经落地。

下一阶段最值得做的，不是继续增加顶层命令，而是把已有能力收敛成一个更快、更安全、更可预测的 coding-agent 产品。优先级建议如下：

1. **P0：修复启动路径与重复执行风险**——当前所谓 lazy dispatch 被静态导入破坏，且 action 抛错后可能回退并再次执行。
2. **P0：收紧密钥、文件权限与 Sandbox 默认值**——避免 secret 出现在 argv、终端输出和弱权限文件中，避免 Sandbox 初始化失败后静默裸跑。
3. **P0：让 npm 发布门禁满足仓库自己的 exact-SHA 三平台规则**。
4. **P0：修复 MCP `ws/wss`“配置可接受、运行不可连接”的契约错误**。
5. **P0：统一 Session 事实源并解决长会话全量读取、并发 hash 链分叉问题**。
6. **P1：把 175 个顶层命令收敛为核心入口 + 兼容别名 + 扩展域**，并让 `cc` 在 TTY 中默认进入 Agent。
7. **P1：统一后台 Agent 的恢复配置、隔离、并发与预算取消语义**。
8. **P1：修正 `/btw` 语义，统一 `quiet/verbose/json` 输出契约和配置来源解释**。
9. **P1：基于现有 `cc pack` 建立官方签名原生发行物、包管理器和可回滚更新链**。
10. **P2：再做多模型 Advisor、提示建议、Session recap 等体验增强**。

一句话判断：**能力广度已经足够，当前竞争差距主要在“核心路径的完成度”，而不是 feature count。**

## 2. 分析范围与方法

本次结论来自四类证据：

- 静态核对 `packages/cli` 的 command manifest、Agent contract、REPL、MCP、Session、Sandbox、配置、后台任务和发布工作流。
- 对照仓库现有的 [CLI Runtime 当前实现](./design/cli-runtime-current.md)、[2026-07-11 Claude Code gap 分析](./internal/cli-claude-code-gap-analysis-2026-07-11.md) 与 [自动生成 CLI Reference](./cli/CLI_REFERENCE.generated.md)。
- 对照 Claude Code 官方 overview、CLI reference、interactive mode、MCP、subagents、sandbox、advisor 和 changelog。
- 在 Windows 10、Node.js 22.22.2、Intel i7-4770HQ 环境进行新进程诊断计时。该计时用于定位量级，不等同于正式跨平台基准。

本次没有执行完整测试套件、渗透测试或真实 LLM 长会话压测，因此所有“已具备”判断以代码与现有测试/文档为准；性能目标需要进入三平台 CI 后再校准。

## 3. 已经具备、不建议重复建设的能力

| 领域                      | 当前状态                                                                                                                          | 判断                                   |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Agent / Headless          | text、json、stream-json、JSON Schema、模型/provider、图片、resume/fork、checkpoint、工具 allow/deny、max turns/token/USD 等已存在 | 强，不应重做基础 Agent loop            |
| 权限与 Sandbox            | allow/ask/deny、managed policy、Docker/bwrap/Seatbelt/Windows 隔离、Process Broker、credential agent 已存在                       | 实现广，重点应改默认值和降级语义       |
| MCP                       | stdio、HTTP/SSE、OAuth、tools/resources/prompts、roots、elicitation、`list_changed`、ToolSearch 已存在                            | 主体完整，优先修 transport 契约        |
| Skills / Agents / Plugins | 多 scope skill、`.claude/agents`、hooks/MCP/LSP/native bin、签名/SBOM、marketplace 已存在                                         | 强，重点做加载性能、治理一致性和文档   |
| Session / Background      | list/show/resume/export/search/verify/tail/usage、attach/dashboard/logs/stop、外部 session index 已存在                           | 功能广，但底层事实源与长会话性能需收敛 |
| Agent Teams / Worktree    | DAG、mailbox、lease、预算、worktree、batch、分布式 queue 已存在                                                                   | 强，重点统一运行时上限与取消           |
| 自动化                    | agenda、loop、cron、routine、channels、cloud handoff、remote control 已存在                                                       | 不缺入口，缺调度内核收敛               |
| 交互                      | Vim、voice、fullscreen TUI、fast、rewind/compact、plan、custom commands 已存在                                                    | 基础强，仍有语义与日常输入体验差距     |
| IDE / SDK / CI            | VS Code、JetBrains、Agent SDK、headless、多个 CLI 专项 CI 已存在                                                                  | 强，重点收紧发布权威性                 |

此前两份 gap 文档列出的权限模式、后台 attach、MCP Tool Search、Agent SDK、远控、动态 workflow、PowerShell、Artifacts、Agent View、Channels、Computer Use、Routines、PR/session link、Voice、Fast mode、Plugin 治理和外部 Session Store 等项目，大部分已经实现。继续按旧清单“补功能”会造成重复建设。

## 4. 关键现状数据

### 4.1 命令与文档规模

- [`command-manifest.json`](../packages/cli/src/command-manifest.json#L3) 注册 175 个顶层命令，来自 166 个模块、170 个唯一 registrar。
- 存在 4 组共享 registrar 的顶层入口：`attach/daemon/logs`、`auto/automation`、`decrypt/encrypt`、`orchestrate/router`。
- 以摘要关键字做启发式扫描，有 59 个顶层命令带 `Phase`、`governance`、`in-memory`、`experimental`、`preview` 或 `prototype` 标记。这不代表它们不可用，但说明公开入口混入了大量内部阶段/治理信息。
- [`packages/cli/README.md`](../packages/cli/README.md#L203) 仍写“19 个工具”，而自动生成 reference 已是 [28 个工具](./cli/CLI_REFERENCE.generated.md#L183)；README 版本说明也停留在 v0.162.160。
- 根帮助分类在 [`index.js`](../packages/cli/src/index.js#L63) 硬编码了实际不存在的 `rag`、`ukey`、`backup`、`trade`、`data`、`monitor` 顶层命令。

### 4.2 冷启动诊断

本地两组独立新进程采样得到：

| 命令                                                    |          观测值 |
| ------------------------------------------------------- | --------------: |
| `node packages/cli/bin/chainlesschain.js --version`     |   约 4.3–6.3 秒 |
| `node packages/cli/bin/chainlesschain.js agent --help`  |   约 3.3–4.6 秒 |
| `node packages/cli/bin/chainlesschain.js status --json` | 约 10.7–15.8 秒 |

根因不是 Commander 本身，而是入口结构：

- [`lazy-dispatch.js:4`](../packages/cli/src/lazy-dispatch.js#L4) 顶层静态导入 `createProgramAsync`。
- 被导入的 [`index.js:27`](../packages/cli/src/index.js#L27) 在模块求值阶段通过 top-level await 导入全部 175 个命令模块。
- 因此 [`lazy-dispatch.js`](../packages/cli/src/lazy-dispatch.js#L103) 后续“只动态加载一个命令”的 fast path 实际已经失去主要收益。
- `--version`、根帮助和无参数路径仍显式进入完整 program。
- `status` 还会同步探测 Docker/Compose 并串行扫描多个端口，缺少统一 deadline。

### 4.3 产品入口与 Claude Code 的差别

Claude Code 的官方 quickstart 是进入项目后直接执行 `claude`，默认启动 coding agent；大多数 coding 能力通过 flags、slash commands、skills 和 plugins 暴露。ChainlessChain 的无参数 `cc` 则进入完整根 program/help，核心 coding agent 只是 175 个顶层命令中的一个。

这不是单纯审美问题：它会同时放大冷启动、帮助可发现性、安装体积、回归矩阵和安全审计面的成本。

## 5. P0：必须先修的正确性、安全与发布问题

### P0-1 真正的 lazy dispatch，并保证命令最多执行一次

#### 现状与风险

[`lazy-dispatch.js`](../packages/cli/src/lazy-dispatch.js#L103) 把动态 import、registrar 和 `program.parseAsync()` 放在同一个 `try/catch` 中。如果 action 已产生副作用后抛错，catch 会创建完整 program 并再次 `parseAsync(argv)`，存在变更命令执行两遍的风险。

文件末尾的 `LazyDispatch.matches()` / `spawn()` 仍是恒定返回 `false` 的空壳，也会误导后续维护者。

#### 方案

1. 新建不依赖 `index.js` 的 phase-0 parser，只解析全局 flags、版本、已知命令 token 和最小帮助。
2. `--version` 直接读取轻量版本常量并退出；根帮助由 manifest 的精简索引生成，不导入 command modules。
3. 已知命令仅动态导入其 registrar；只有未知命令和显式 `help --all` 才动态导入完整 program。
4. 将 import/registration 错误边界与 action 执行边界分开；一旦进入 `parseAsync()`，失败就原样返回，禁止 eager fallback。
5. 删除空壳 `LazyDispatch`，或让 bin 真正通过该对象完成分发，避免双实现。
6. `status` 改为并行探针，所有外部探针有 deadline；提供默认快速状态和显式 `--deep`。

#### 验收标准

- 三平台 CI 冷进程 p95：`--version <= 250ms`，稳定后目标 `<= 150ms`。
- `<known-command> --help <= 400ms`，普通不依赖服务的只读命令 `<= 500ms`。
- `status --json` 在 Docker 不可用时 `< 1s`，正常本地环境 `< 2s`；单探针 deadline `<= 500ms`。
- 注入“写入一次后抛错”的 action，最终副作用计数必须为 1，退出码与原始错误不被 fallback 覆盖。
- 性能基准相对已批准基线回退超过 15% 时阻断合并。

### P0-2 密钥、文件权限与 Sandbox 使用安全默认值

#### 现状与风险

- [`config set`](../packages/cli/src/commands/config.js#L153) 会回显完整 value；API key 同时进入 shell history 与 process argv。
- `config get` 原样输出值，`config list` 在 [`printConfig`](../packages/cli/src/commands/config.js#L317) 中只按字段名包含 `key` 做遮罩，`token`、`password`、`secret` 等可能漏出。
- [`config-manager.js`](../packages/cli/src/lib/config-manager.js#L73) 写入含密钥的 JSON 时没有显式 `0600`；[`paths.js`](../packages/cli/src/lib/paths.js#L60) 创建运行目录时没有显式 `0700`。Session JSONL 也没有明确权限契约。
- 此前 README 曾示范 `config set llm.apiKey sk-...`，会鼓励用户把 secret 放进历史；本轮已迁移为 `set-secret` 示例。
- Process Broker 只有 [`CC_SANDBOX_STRICT=1`](../packages/cli/src/lib/process-execution-broker/index.js#L905) 才强制隔离失败闭合；部分初始化失败路径会警告后继续无 Sandbox 执行。

#### 方案

1. 建立 schema 驱动的 secret registry，不再靠字段名子串猜测；所有 text/json/get/list/doctor/export 使用同一个 redactor。
2. 新增 `cc config set-secret <key>`，从无回显 TTY、stdin 或 OS keychain 引用读取；普通 `config set` 遇到 secret key 时拒绝或引导迁移。
3. `--api-key` 保留兼容但显示弃用警告；推荐 provider credential helper、环境注入或 OS keychain，禁止写入 transcript/trace。
4. POSIX 目录 `0700`、配置与 transcript `0600`；Windows 使用当前用户 ACL。Doctor 检测并可修复历史文件权限。
5. 明确 `--sandbox-mode off|workspace-write|strict`。Safe/Auto 模式在平台能力可用时 fail closed；任何降级到裸执行都需要显式确认，并写入审计事件。
6. 对已有配置做幂等迁移：先备份、校验权限与内容、再原子切换；不可用 keychain 时保持安全文件 fallback。

#### 验收标准

- secret 不出现在 stdout、stderr、JSON、debug/OTel、session、argv 快照和错误对象中。
- 跨用户读取配置与 transcript 的权限测试失败；Windows ACL、Linux/macOS mode 均进入 CI。
- 所有 get/list/set/export 路径有统一泄漏测试，覆盖 `apiKey/token/password/secret/credential` 及 schema 自定义 secret。
- Safe/Auto 下 Sandbox 初始化失败不得静默继续；显式 off 模式必须可被 managed policy 禁止。

### P0-3 exact-SHA 三平台发布门禁与可信更新链

#### 现状与风险

仓库规则要求：CLI 发布前，同一精确提交的 `CLI CI` 与 `CLI Strict Sandbox` 必须在全部配置 OS 上通过。但当前 [`npm-publish.yml`](../.github/workflows/npm-publish.yml#L18) 提供 `skip_tests`，自身测试 job 只在 Ubuntu 执行，publish 只依赖该 job；权威三平台矩阵在其他 workflow 中，发布流没有对同一 SHA 强制核验。

此外，[`selfUpdateCli`](../packages/cli/src/commands/update.js#L95) 在版本验证命令异常时会“assume success”，这会把无法验证误报为更新成功。

#### 方案

1. 将 `CLI CI` 与 `CLI Strict Sandbox` 抽成 reusable required gate，或在发布 job 中通过 GitHub Checks API 校验 **当前 release SHA** 的完整矩阵。
2. 正式发布删除 `skip_tests` 通路；dry-run 可以跳过昂贵测试，但不得共享生产 publish job 的权限。
3. CI 先产生不可变 npm tarball，记录 SHA-256、SBOM、provenance；验证和 publish 必须使用同一个 tarball digest。
4. 启用 npm provenance；发布摘要记录 commit、workflow run、tarball digest、各矩阵结果。
5. 更新验证异常视为失败或 `unknown`，不得报告 success；原生更新采用 staging、签名校验、原子切换和 last-known-good rollback。

#### 验收标准

- 任一 OS、任一 required job 未通过、超时、来自旧 SHA 或被跳过，生产发布都必须失败。
- 发布后 registry tarball digest 与 CI 验证 digest 完全一致。
- 篡改、截断、错误版本、更新中断和校验进程异常的 fault-injection 在三平台均不会破坏可用旧版本。

### P0-4 修复 MCP WebSocket 与 scope 契约

#### 现状与风险

- [`cc mcp add`](../packages/cli/src/commands/mcp.js#L483) 接受 `ws/wss` transport 并持久化。
- [`inferTransport`](../packages/cli/src/harness/mcp-client.js#L71) 也保留 `ws/wss`。
- 实际 connect 分支在 [`mcp-client.js`](../packages/cli/src/harness/mcp-client.js#L711) 只处理 HTTP/SSE 或 stdio，没有 WebSocket 连接实现。

因此用户能成功保存一个运行时必定无法正常连接的配置。Claude Code 官方 MCP 文档已把 WebSocket 作为独立配置方式，并同时定义 local/project/user scope；ChainlessChain 不能只复制枚举而缺少执行契约。

#### 方案

短期优先保证诚实契约：

1. 若一个小版本内不能完成 WS，实现前在 add/import/validate 阶段明确拒绝 `ws/wss`，并给出迁移提示。
2. `cc mcp doctor` 对已有 WS 配置报告 `unsupported_transport`，而不是模糊连接失败。
3. 给 `mcp add/get/remove/list` 补齐 `local|project|user|managed` scope 与来源显示。

随后再按真实需求实现持久双向 WS、headers helper、重连/backoff、取消、消息大小上限、channels push 和集成测试。不要让“支持的枚举”领先于“支持的运行时”。

#### 验收标准

- 配置层支持的每种 transport 都必须通过真实 server 连接矩阵；否则在保存前失败。
- malformed URL、TLS、401/403、协议不匹配、断线重连、取消和超时都返回结构化诊断。
- scope precedence、项目信任和 managed deny 有端到端测试。

### P0-5 统一 Session 事实源和长会话存储

#### 现状与风险

- REPL 会在 JSONL 与 DB 路径之间切换；headless resume 主要读取 JSONL；session export 又先读 chat DB、再 fallback JSONL，存在多套事实源。
- [`jsonl-session-store.js`](../packages/cli/src/harness/jsonl-session-store.js#L64) 的 tail hash cache 明确假定单 writer。虽然 append 使用文件锁，但跨进程缓存可能在进入锁前已经过期，形成分叉 hash chain。
- `verifySession`、`readEvents`、`rebuildMessages`、`listJsonlSessions` 等路径会整文件读取；大量 session 或超大 transcript 会导致启动延迟和高 RSS。
- 当前 hash chain 能检测很多中间篡改，但不是外部 anchor，也不能代替机密性保护。

#### 方案

1. 选择 `session-core` 作为 canonical contract：append-only event log 是内容事实源，SQLite/sidecar index 只保存可重建元数据。
2. 在文件锁内部重新读取并 CAS 校验 tail hash；写入使用 framed record 或临时文件 + 原子 append 协议，允许识别最后一条 partial record。
3. transcript 分段，索引 title、count、mtime、lastHash、compact checkpoint、PR/branch/worktree；list/search 不再扫描所有正文。
4. resume 从最近 compact checkpoint + 增量事件恢复；verify/repair 使用流式读取，支持按段校验。
5. DB、旧 JSONL 和外部 store 通过版本化 adapter 迁移；所有 `resume/search/export/rename/delete/prune` 共享同一语义测试。
6. 可选增加 OS-keychain 管理的 transcript AEAD；完整性 anchor 可写入独立 ledger/HMAC，而不是把自包含 hash chain 宣传为防删除证明。

#### 验收标准

- 20 个并发 writer 各 append 1,000 条后 hash 链完整、无丢失、无重复。
- 10,000 个 session 中 `list --limit 10` p95 `< 200ms`，RSS `< 100MB`。
- 1GB transcript 恢复 p95 `< 2s`，且测试证明没有全量载入内存。
- 任意写入点 kill -9 后，最多丢弃一条 partial record；`session repair` 可诊断且不伪造成功。
- REPL、headless、IDE、background attach 对同一个 session 得到一致结果。

## 6. P1：高价值产品与架构优化

### P1-1 收敛命令面，让 Agent 成为默认产品入口

#### 目标形态

- `cc`：TTY 中默认进入 coding agent；stdin 有内容时默认进入 headless prompt，非交互且无输入时返回简洁帮助。
- `cc help`：只展示约 8–12 个稳定域，例如 `agent`、`session`、`mcp`、`plugin`、`config`、`doctor`、`auth`、`admin`。
- `cc help --all`：展示完整兼容面。
- 长尾业务命令迁移到 `cc lab ...`、领域子命令或插件；旧顶层命令保留 alias 与 deprecation 至少两个 release cycle。
- `command-manifest` 增加 `stability/category/visibility/replacement` 元数据，帮助、文档、completion 和弃用提示全部自动生成。

#### 原则

1. 不做破坏式“一次删 175 个命令”。先隐藏、归类、别名转发、采集使用率，再删除。
2. 核心安装 profile 只加载 coding-agent 所需依赖；web3、social、governance 等作为可选扩展 profile。
3. 新增顶层命令必须说明为什么不能是 slash command、skill、plugin 或现有域的子命令。
4. 建立“顶层命令净增长不高于 0”的阶段性约束，直到稳定面完成收敛。

#### 验收标准

- 新用户从安装到第一次 Agent 对话不需要先理解 175 个命令。
- 默认帮助只含真实存在且稳定的入口；完整帮助、completion、README 与 manifest 零漂移。
- 旧脚本在兼容窗口内继续工作，弃用信息写 stderr，不污染 JSON stdout。

### P1-2 统一后台 Agent 的恢复、隔离与预算取消

#### 现状

- Background supervisor 恢复时没有完整持久化原始 launch profile，可能丢 provider/model/tool allowlist/sandbox/MCP/settings。
- Background worktree 仍是显式选项，未必隔离当前工作区。
- 不同运行路径已有多种上限：Agent core 默认深度 5、单次共享 spawn 计数 32，registry 有 active/pending cap，TeamBudget 又有 task/token/USD/wall time；这些并非一个统一 session runtime budget。

#### 方案

1. 持久化脱敏的 launch profile 与 config fingerprint；resume 时重新校验 provider、model、权限、MCP、plugin、workspace 和 budget。
2. Git 仓库中的 mutating background task 默认创建 worktree；只读任务可共享，显式 `--no-worktree` 才覆盖。
3. 建立 session 级统一预算：concurrency、total spawns、depth、tokens、USD、wall time、max turns、tool time。
4. 预算耗尽时主动取消仍在运行的子 Agent/后台 shell，而不只是禁止下一次 spawn。
5. 所有嵌套 Agent 事件携带 parent/child tool-use id，stream-json、TUI、OTel 和 attach 使用同一棵执行树。

#### 验收标准

- resume 后有效配置与原 session 一致；不兼容变化明确拒绝，不能静默换模型或放宽权限。
- 任一预算耗尽后，所有受管后代在 deadline 内停止并完成审计归因。
- 并发 20 个 Agent、嵌套多层、主进程取消、断线重连和 worktree 清理进入长时 soak。

### P1-3 修正 `/btw` 与统一交互输出契约

#### `/btw` 语义

当前 [`btw-command.js`](../packages/cli/src/repl/btw-command.js#L4) 实际是“给下一条消息排队一个 aside”，并不是 Claude Code 的即时侧问。

Claude Code 官方语义是：在主任务运行时也可发起一个独立、即时、只读当前上下文、无工具、单回答且不写主历史的侧问，并可从 overlay fork 新会话。

建议改为：

1. `/btw <question>` 立即发起独立 ephemeral model call，复用父会话已缓存前缀。
2. 禁用工具、写入和 follow-up；结果显示在 overlay，默认不进入主 transcript。
3. 支持 `f`/`--fork` 将侧问变成独立 session。
4. 为兼容现有“下一轮 aside”，另命名为 `/note-next`，不要继续占用 `/btw`。

#### 输出契约

`program-base.js` 声明了全局 `--verbose/--quiet`，但 logger 的 `setVerbose/setQuiet` 没有统一绑定到 program lifecycle。建议建立一个 OutputContext：

- stdout 只承载用户结果或可解析 JSON/NDJSON。
- diagnostics、progress、deprecation、trace 全部走 stderr。
- `quiet` 抑制非错误文本；`verbose` 只增加 stderr 诊断。
- Commander preAction 一次绑定全局 flags，子命令不得各自猜测。

验收时对所有稳定顶层域执行 `default/quiet/verbose/json` 矩阵，并验证 JSON 可被单独解析。

### P1-4 建立统一、可解释的 typed config schema

当前 [`config-keys.js`](../packages/cli/src/lib/config-keys.js#L1) 从 `DEFAULT_CONFIG` 推导基础 key，再手工维护额外 key；`config set` 仍接受任意 dotted key 和弱类型 value。与此同时，`config.json`、`.claude/settings*.json`、managed policy 和环境层都有各自优先级。

建议：

- 发布版本化 JSON Schema，统一类型、enum、default、secret、scope、managed-lock、deprecation 和 migration。
- 增加 `cc config validate [--fix]`。
- 增加 `cc config effective --json`。
- 增加 `cc config explain <key>`，展示最终脱敏值、来源、被覆盖层、policy lock 与弃用迁移。
- 默认拒绝未知 key；插件通过命名空间注册 schema。保留显式 `--allow-unknown` 仅用于开发。

### P1-5 官方原生发行物与可回滚升级

Claude Code 官方提供 native installer、Homebrew、WinGet 和 native background update。ChainlessChain 仓库现已声明 macOS/Linux/Windows × x64/ARM64 六目标 workflow、manifest、shell/PowerShell installer 与 OTA 事务机制；`8990999771` 的本地冻结矩阵为 142/142，`a1c9eed07e` 又关闭下载目标替换恢复缺口。该证据仍不等于真实发行链：尚无六目标真实资产、签名与公开回读，ARM64 的构建标签也不能替代目标二进制执行；当前权威发布仍以 npm 为主。

后续继续复用现有 packer：

1. 为六目标生成真实 artifact，并在对应 OS/架构上执行 binary smoke、fresh install、upgrade 与 rollback。
2. 发布 manifest 必须绑定版本、精确 commit、平台、架构、SHA-256、签名、SBOM 和最低 schema 版本。
3. 完成 macOS notarization、Windows Authenticode、Linux 签名，以及 Homebrew tap、WinGet manifest；再评估 apt/dnf/apk。
4. 用 durable intent/phase journal 或 generation pointer 补足 updater/installer 的强杀与断电恢复，而不只依赖进程内 rollback。
5. 在同一待发布 exact SHA 上通过完整 `CLI CI`、`CLI Strict Sandbox`、签名验证、公开渠道回读和真实安装矩阵。

在这些退出条件完成前，只能声明“仓库级事务机制已加固”，不能声明原生发行链 release-ready。

### P1-6 建立长会话与运行时可靠性 SLO

Claude Code 近期 changelog 的高频主题不是增加命令，而是内存泄漏、长会话 O(n²)、并发 Agent、MCP 输出、worktree、stream、symlink、partial response 和终端恢复。ChainlessChain 也应把这些从零散回归测试升级成固定 SLO：

- 1,000+ turns、1GB transcript、10,000 sessions。
- 1,000 个 MCP tool schema，超大 tool output，长 MCP call 自动后台化。
- 20+ 并发 Agent、预算耗尽、主线程取消、后台仍运行、嵌套 stream forwarding。
- slow pipe、broken pipe、磁盘满、只读目录、文件被外部删除、symlink/worktree 改变。
- midstream API error 时保留已收到文本并明确标注 incomplete。
- 退出后无 orphan process、listener、timer、PTY、worktree 和未刷盘审计记录。

要求每项有延迟、RSS、FD/handle、落盘一致性和清理 deadline 指标，而不仅是“测试最终通过”。

## 7. P2：有价值，但不应抢占 P0/P1 的增强

### P2-1 多 Provider Advisor / Critic

Claude Code Advisor 会在选方案、连续失败和宣布完成前调用更强模型给第二意见。ChainlessChain 不宜复制 Anthropic server tool，而应复用现有 `review --multi/--verify` 与 sub-agent runtime，做 provider-neutral advisor：

- `advisorModel` / `advisorProvider` / `advisorBudgetUsd`。
- `/advisor on|off|once|status` 与单次启动 flag。
- 默认触发点：方案提交前、相同错误重复 N 次、完成前风险审查。
- advisor 只给建议，不直接获得更高权限；主 Agent 必须用本地证据验证建议。
- 调用次数、token、成本和命中效果可观测，支持 managed allowlist。

### P2-2 交互细节

在 `/btw` 修正后，再逐步补：

- 后台生成且可关闭的 prompt suggestions。
- `/recap`，从已有 session index 生成轻量回顾。
- 真正的系统剪贴板图片粘贴 chip，而不仅是路径识别。
- 外部编辑器编辑 prompt、prompt stash、自定义 keybindings。
- narrow terminal、screen reader、RTL/CJK 宽度和 resize 的快照回归。

Emoji completion 等装饰项优先级最低。

### P2-3 MCP 可选协议面

在 WS 契约修好后，按真实 server 使用数据决定是否补 sampling、logging level、completion、resource subscribe/templates 等。不要为了协议条目数量一次性实现所有可选 capability。

### P2-4 调度内核收敛

`automation schedule`、agenda、routine、loop/ccron 已分别存在。长期应收敛到一个持久 scheduler service，统一 timezone/DST、missed-run policy、幂等键、去重、history、权限与预算；外层命令只做不同视图。该项是降低维护成本，不是继续新增第五套调度入口。

## 8. 建议实施顺序

| 里程碑           | 内容                                                                                            | 依赖   | 退出条件                                    |
| ---------------- | ----------------------------------------------------------------------------------------------- | ------ | ------------------------------------------- |
| M0：契约止血     | lazy import、禁止 action fallback 重跑、secret 全局遮罩、临时拒绝未实现 WS、发布 exact-SHA gate | 无     | P0 回归全部通过，正式发布无 skip 通路       |
| M1：核心体验     | phase-0 parser、快速 status、默认 Agent 入口、生成式帮助、OutputContext、config explain         | M0     | 冷启动 SLO 达标，默认帮助与 manifest 零漂移 |
| M2：持久化与后台 | canonical session store/index、CAS hash、分段 transcript、launch profile、统一 budget/cancel    | M0     | 并发/1GB/10k session/kill-9 验收通过        |
| M3：发行与差异化 | signed native releases、rollback updater、Advisor、recap、交互 polish                           | M1、M2 | 三平台安装/升级/回滚和长会话 soak 通过      |

### 可以先独立落地的 Quick Wins

1. 把 `createProgramAsync` 改为 fallback 内动态 import。
2. 把 `parseAsync()` 移出 lazy registration 的 catch。
3. `--version` 走零 command-module 的直接路径。
4. 在 WS 实现前拒绝 `ws/wss` 保存，并给已有配置 doctor 诊断。
5. `config get/list/set` 复用统一 secret redactor，README 删除明文 key 示例。
6. 在 Commander preAction 绑定 `quiet/verbose`。
7. 根帮助和 README 计数从 manifest/Agent contract 生成，删除不存在的硬编码命令。
8. 生产 npm publish 禁止 `skip_tests`，强制校验 exact SHA 的两套三平台矩阵。

## 9. 工程门禁与 Definition of Done

### 必须新增的 CI 门禁

- `cli-startup-benchmark`：Windows/Linux/macOS 冷进程 p50/p95 与 RSS。
- `cli-command-idempotency`：所有 mutation action 的 exception/fallback 测试。
- `cli-secret-leak`：stdout/stderr/JSON/trace/session/argv/file mode/ACL 矩阵。
- `cli-mcp-transport-contract`：每个公开 transport 的真实 server E2E。
- `cli-session-scale`：并发 append、10k index、1GB restore、crash repair。
- `cli-long-session-soak`：Agent/MCP/PTY/worktree/stream/取消/预算/资源清理。
- `cli-release-gate`：exact SHA、三平台 checks、tarball digest、provenance。
- `cli-doc-drift`：manifest、根帮助、README、generated reference、Node/npm 要求和示例 smoke test。

### 代码覆盖策略

不要只追总体百分比。优先要求以下分支覆盖不低于 90%，并采用 ratchet 防止回退：

- 密钥处理与脱敏。
- Sandbox fail-closed 与 managed policy。
- updater 签名/原子切换/回滚。
- lazy dispatch 与 mutation failure。
- session append/verify/repair/migration。
- MCP transport、auth、scope 和 trust。

E2E retry-pass 应记为 flake，而不是普通 pass；超过阈值阻断发布。

## 10. 不建议近期投入的方向

- 继续增加 Web3、治理、社交或“Phase N”顶层命令。
- 为了数字好看，把已实现的 Hooks、MCP ToolSearch、Skills、Plugins、Agent Teams 再写一套。
- 直接复制 Anthropic-only 的云端 Advisor 或 Routines 基础设施。
- 在 Session 和预算一致性未完成前继续提高嵌套 Agent 深度。
- 把 emoji、动画、更多 alias 放在启动、安全和发布门禁之前。

## 11. 建议的产品指标

完成 M2 后，用以下指标判断优化是否真的有效：

- 首次安装到第一次有效 Agent 回复的中位时间。
- `cc` 启动到 prompt ready 的 p50/p95。
- 7 天内发生过一次有效 Agent 会话的安装用户比例。
- Session resume 成功率与配置不一致拒绝率。
- 每 1,000 次 tool call 的 orphan、重复执行、权限误放行、不可恢复 transcript 数。
- Background task 在预算/取消后按 deadline 清理的比例。
- MCP 连接失败中可直接定位到配置/认证/传输层的比例。
- 发布因 exact-SHA gate 被正确阻断的次数，以及 retry-pass flake 率。
- 稳定顶层命令使用覆盖率；长期无人使用命令进入插件/隐藏面的比例。

## 12. 官方参考资料

- [Claude Code Overview](https://code.claude.com/docs/en/overview)：默认入口、原生安装、Homebrew、WinGet、自动更新与产品表面。
- [Claude Code CLI Reference](https://code.claude.com/docs/en/cli-reference)：CLI flags、headless 与 `--bare`。
- [Claude Code Interactive Mode](https://code.claude.com/docs/en/interactive-mode)：快捷键、历史、图片粘贴、后台任务、`/btw`、suggestions 与 recap。
- [Claude Code MCP](https://code.claude.com/docs/en/mcp)：HTTP/SSE/stdio/WebSocket、scope、OAuth、ToolSearch、重连与长调用后台化。
- [Claude Code Subagents](https://code.claude.com/docs/en/sub-agents)：嵌套、并发、session 总量、background、worktree 与恢复。
- [Claude Code Sandboxing](https://code.claude.com/docs/en/sandboxing) 与 [Permissions](https://code.claude.com/docs/en/permissions)：隔离与权限的两层模型。
- [Claude Code Advisor](https://code.claude.com/docs/en/advisor)：决策点第二意见、模型配置、成本与限制。
- [Claude Code Changelog](https://code.claude.com/docs/en/changelog)：2.1.220 及近期长会话、并发 Agent、MCP、stream、worktree 和内存可靠性修复。

## 13. 最终建议

如果只能选择一条主线，建议定为：

> **“把 `cc` 从一个拥有 175 个入口的综合命令集合，收敛成一个启动快、默认安全、会话可信、后台可控的 coding-agent runtime；长尾能力通过子域和插件保留。”**

这条主线既能直接缩小与 Claude Code 的真实体验差距，也能保留 ChainlessChain 在多 Provider、去中心化、跨端、自动化和企业治理方面的差异化优势。

## 14. 2026-08-02 实施状态附录：当前证据边界

> 本附录覆盖第 1～13 节中的历史“当前状态”表述。组件实现、本地定向测试、独立审计和 exact-SHA CI 只授权各自明确范围；最终待发布 SHA 必须同时完成完整 `CLI CI` 与 `CLI Strict Sandbox` 全配置 OS 矩阵，并满足签名、安装、升级、回滚和公开渠道回读，否则一律为 **NO-GO**。

### 14.1 Canonical Session 与宿主恢复

- `63a67cc676` 只是 REPL canonical resume 提前校验的中间提交。后续独立审计发现 P1，不能引用该 SHA 或“REPL 87/87”宣称安全闭包。
- `9cbe020b08` 提交 forward verified projection、sidecar head/count anchor、checkpoint 后缀消息重建、增量 MCP reducer、WS turn lifecycle projection 与 index/export 接线；`213c3ae7c5` 将覆盖到的 Headless/Stream 恢复收敛到同一 verified sample，并为 canonical WS resume request 加入跨进程 opaque claim。owner 崩溃后的 claim 保持 pending，不自动接管或重放；它不是 general cross-process session lease。
- `3bf36193dc` 只恢复 JSONL compatibility export 完整性；`fa3aa32801` 补齐 canonical host consistency workflow 与测试覆盖，“close gate”不代表 release gate 已关闭。
- `13e0f074b3` 加固 canonical absence/error provenance、resume id、role/tool authority 与 canonical system admission。关键定向 30 项和相邻 40 项共 70 passed，独立增量审计为 P0=0、P1=0。该审计登记的 inherited live-switch host-prefix 风险由 `5c9f05494a` 跟进；其本地新行为 4/4、相邻 35/35，独立审计在该提交范围为 P0=0、P1=0。
- covered canonical path 已不再要求把全部 event materialize 成数组，但 hash-chain 身份认证仍为 O(N)，没有独立 anti-rollback anchor，也没有真实冷进程 1 GiB P95/RSS、fsync/断电、remote host 或全部 legacy/create 路径的完成证明。

### 14.2 会话资源预算

- `2a85acb901`、`be86097be2` 加固持久预算 sidecar、opaque authority、persist-first close、durable dirty recovery 与旧 handle/lease 撤权；`73ad3b7378` 进一步保持精确 budget 文件身份，本地单文件为 36 passed / 3 skipped。
- `73ad3b7378` 的独立审计只在“私有目录 + cooperating writer”范围为 P0=0、P1=0。非协作 same-UID writer 下的临时路径 unlink、CAS 后 rename overwrite 和 marker retirement successor 仍是 machine-wide P1 NO-GO。
- 这些提交不等于 machine-wide scheduler；生产 root、turn、token、tool、WS、REPL 与 Headless 入口尚未统一使用同一个 authority，sidecar 也不是独立 anti-rollback anchor。

### 14.3 原生 installer/rollback

- `4145508010` 是 retained tombstone cleanup 语义的中间提交，后续独立审计仍发现 P1，不得写成 installer 安全闭包。
- `1354be776a` 对 transaction successor、orphan 与 retained evidence 采用保守保留和 fail-closed。单文件本地结果为 10 passed / 43 skipped，其中包含 `wsl.exe` 下 4 个 bash/dash 动态用例；第六轮独立审计在该提交范围为 P0=0、P1=0。
- 剩余 P2 包括人工处置 orphan、retained evidence/cleanup-degraded 累积。完整 durable generation transaction、真实三 OS 强杀/断电、ARM64、签名/notarization/Authenticode 与公开资产回读仍未完成。

### 14.4 Exact-SHA CI 与发布判定

| Exact SHA    | `CLI CI`                | `CLI Strict Sandbox`  | `CLI Session Host Consistency` | Release   |
| ------------ | ----------------------- | --------------------- | ------------------------------ | --------- |
| `9cbe020b08` | `30732462105` cancelled | `30732462022` success | `30732462034` success          | **NO-GO** |
| `213c3ae7c5` | `30733555516` cancelled | `30733555412` success | `30733555422` success          | **NO-GO** |
| `fa3aa32801` | `30734282599` failure   | 无同 SHA 成功证据     | `30734282464` success          | **NO-GO** |
| `73ad3b7378` | `30737250661` cancelled | 无同 SHA 成功证据     | `30737250601` success          | **NO-GO** |
| `13e0f074b3` | `30737581680` cancelled | `30737581562` success | `30737581567` success          | **NO-GO** |
| `1354be776a` | `30737890854` cancelled | 无同 SHA 完成证据     | 无同 SHA 完成证据              | **NO-GO** |
| `5c9f05494a` | `30738312745` cancelled | `30738312596` success | `30738312610` success          | **NO-GO** |
| `9cadcaf4d6` | `30738491468` failure   | `30738576056` success | `30738491365` success          | **NO-GO** |
| `4bb6e25fe4` | `30739539943` failure   | 无同 SHA 完成证据     | 无同 SHA 完成证据              | **NO-GO** |
| `755ee07926` | `30742304070` cancelled | 无同 SHA 完成证据     | 无同 SHA 完成证据              | **NO-GO** |
| `d14a4eb8eb` | `30742425229` cancelled | `30742425145` success | `30742425143` success          | **NO-GO** |
| `741ffebff8` | `30742928259` cancelled | 无同 SHA 完成证据     | 无同 SHA 完成证据              | **NO-GO** |
| `0de8744151` | `30743223135` cancelled | 无同 SHA 完成证据     | 无同 SHA 完成证据              | **NO-GO** |
| `77639a241a` | `30743389086` cancelled | 无同 SHA 完成证据     | 无同 SHA 完成证据              | **NO-GO** |
| `4c95005a30` | `30743648603` failure   | 无同 SHA 完成证据     | 无同 SHA 完成证据              | **NO-GO** |
| `9a780a0c84` | `30745539604` failure   | `30745539476` success | `30745539474` success          | **NO-GO** |
| `c4f86903cc` | `30746466079` failure   | 无同 SHA 完成证据     | 无同 SHA 完成证据              | **NO-GO** |
| `43bc6d1a39` | `30748505309` cancelled | 无同 SHA 完成证据     | 无同 SHA 完成证据              | **NO-GO** |
| `60dbe9861c` | `30748579626` cancelled | `30748579537` success | `30748579499` success          | **NO-GO** |
| `7ce62ab756` | `30749148369` cancelled | 无同 SHA 完成证据     | 无同 SHA 完成证据              | **NO-GO** |
| `00905ff90c` | `30749292414` cancelled | 无同 SHA 完成证据     | 无同 SHA 完成证据              | **NO-GO** |
| `b81b84b9f9` | `30749410076` cancelled | 无同 SHA 完成证据     | `30749409955` success          | **NO-GO** |
| `b02c88b019` | `30749596847` queued    | 无同 SHA 完成证据     | 无同 SHA 完成证据              | **NO-GO** |
| `f22322edb1` | `30752225902` queued    | 无同 SHA 完成证据     | `30752225804` queued           | **NO-GO** |

当前没有任何待发布 exact SHA 同时取得完整 `CLI CI` 与 `CLI Strict Sandbox` 成功。queued、in-progress、cancelled、failure、部分矩阵、组件门成功、本地测试或旧 SHA 结果均不构成发布授权；文档提交后的新 SHA 也必须重新运行完整双门。

### 14.5 后续已提交增量与剩余边界

- `9cadcaf4d6` 保留摘要压缩后的 durable system provenance，避免 Stream、Headless 与恢复入口把可信宿主前缀降格为普通消息。该 SHA 的 Host Consistency 与 Strict Sandbox 三 OS 成功；CLI CI 中本切片目标测试通过，但整门仍因独立的 native installer 与 Windows packer 失败，故仍为 NO-GO。
- `4bb6e25fe4` 修正 POSIX fixture 的精确注入、Darwin fd 启动预检兼容与 PowerShell fixture 模块初始化。它把 Ubuntu native failures 从 40 项降到 5 项、macOS 从 39 项降到相同 5 项；Windows 仍有 2 项 `Get-FileHash` 命令可见性失败，另有当时尚未修复的 48 项 packer 文件身份误判。该 SHA 的 CLI CI 因此失败。
- `755ee07926` 为 packer 的稳定哈希、下载 partial、恢复快照、清理和两类更新锁建立可信 volume/share-root + parent handle authority；只在 Windows libuv 1.49/1.50 下桥接已知的 pathname `dev` 投影差异，打开句柄之间仍严格比较 BigInt `dev+ino`。Node 22.12/libuv 1.49.1 与 Node 22.22/libuv 1.51.0 的相关 3 文件均为 87/87；该 SHA 的 CLI CI 被后续提交取消，不能据本地结果宣称矩阵关闭。
- `d14a4eb8eb` 让默认 MCP recovery adjudication 使用单次 verified projection，并让 Cowork session binding 与 MCP ledger 在同一遍 verified scan 中折叠；projection factory/finish identity、accepted count、verified head、Promise/thenable/Proxy/accessor/toJSON 与 legacy reader 均 fail closed。独立复验的 5 个相关测试文件共 204/204；它去除了这两个恢复入口对完整 event 数组的强制 materialization，但 reducer authority 仍随唯一 ledger/replay-deny 状态增长，普通 hash-chain 认证仍为 O(N)，不能据此宣称 1 GiB 冷恢复或固定 RSS 目标已完成。
- `d14a4eb8eb` 的 Host Consistency 与 Strict Sandbox 已成功，但 CLI CI `30742425229` 最终 cancelled。取消前完成的 unit shard 4/4 只形成诊断证据：Ubuntu/macOS 各有相同 5 个 POSIX fault-injection failure；Windows 有 2 个 `Get-FileHash` failure 与 1 个 packer `SIDECAR_NOT_READY`；MCP/Cowork 目标集在每个 OS 均为 129/129；packer 在 Ubuntu/macOS 为 applier 54/54 + downloader 30/30、Windows 为 applier 53/54 + downloader 30/30。
- `0de8744151` 没有重写 WebSocket transport，而是修复 runtime scope/source/project 传播与优先级，并新增真实 `type:"ws"` socket、结构化 close/timeout 回归；本地 70/70 与扩大 9 文件 156/156。CLI CI `30743223135` cancelled，不能作为发布授权。
- `77639a241a` 将 READY token 改为临时文件写入后同目录 rename，本地三个 packer 文件 87/87；CLI CI `30743389086` cancelled。后继 Windows CI 仍在同一 case 报 `SIDECAR_NOT_READY`，所以不得宣称 readiness 已闭合。
- `4c95005a30` 以内置 SHA-256 helper 消除 `Get-FileHash` 依赖。CLI CI `30743648603` 的 Windows native 文件为 49 tests / 43 skipped / 0 failed，原两个 PowerShell failure 均通过；但 Windows packer 仍 1 失败，Ubuntu/macOS 仍各 5 个 POSIX failure，整门为 failure。
- `43bc6d1a39` 只调整 POSIX fault injection、signal 注入与 cleanup 断言 fixture，没有修改 installer 生产实现；CLI CI `30748505309` cancelled。后继 `60dbe9861c` 的 Ubuntu unit4 证明原 5 个旧 failure 已消失，但新暴露 `backup publication TERM` 1 项；macOS/Windows unit4 在完成前被取消，尚无跨平台闭合证据。
- `00905ff90c` 将 Windows sidecar、READY 与 READY_TEMP 发布到 canonical TEMP，同时保留 raw TEMP 的逐祖先 reparse 预检，解决 GitHub runner `RUNNER~1` long-path 误判且不放宽父端安全校验。本地三个 packer 文件 89/89、applier 56/56，Node 22.12 真实 8.3 TEMP 握手连续 3/3；CLI CI `30749292414` 被后续提交取消，Windows unit4 尚未进入测试，无同 SHA Strict/Host 完成证据。最终发布判定继续要求同一待发布 SHA 的完整 `CLI CI` 与 `CLI Strict Sandbox` 全配置 OS 同时成功。

### 14.6 Durable replay、branch/fork 与宿主投影事务增量

- `9cadcaf4d6` 只能视为 durable system provenance 的中间提交，不能再引用为完整恢复安全闭包。后续独立审计发现 forged wire tag、深层 Proxy/accessor/cycle、runtime provenance 克隆转移、WS recovery notice 与结构化 handoff/SUMMARY_TO 等边界仍可能错误晋升或阻断持久化；这些缺口由 `9a780a0c84` 统一收口。
- `741ffebff8` 让手工 compact 从一个 verified projection 同时取得 head、messages、provider 与 model，并以完整 canonical replay 指纹执行 compare-and-append；REPL 自动/退出 compact 也跟踪精确已持久化投影。并发新 turn 导致消息不匹配时会明确拒绝 stale compact，不再只依赖旧 head 或覆盖新消息。该 SHA 的 CLI CI `30742928259` cancelled，不能作为发布授权。
- `9a780a0c84` 将 durable system authority 固定为进程内 WeakMap 能力；持久 wire tag 只有在 transcript hash chain 与 sidecar head/count 同时验证后才能恢复。严格 JSON 克隆拒绝 Proxy、accessor、symbol、cycle、稀疏数组、非有限数字和超限图，且不会执行 getter/trap。REPL、Headless、WS、structured handoff、checkpoint `SUMMARY_TO`、branch 与 fork 共用 canonical projection；WS DB 只镜像显式 host prefix 与非 system conversation，不持久化 recovery/host scaffolding。
- branch 创建使用确定性完整计划、`session_branch_complete` input digest 与 exact-prefix 恢复；旧 sidecar 只有在它是当前计划前缀的严格祖先时才允许前推，高水位回滚或同计数异 hash 均 fail closed。fork 以 `(sourceId, requestId)` 绑定唯一 successor，把首次选定的 source head/count 写入 hash-protected `_cc_fork_authority`，provider 投影会剥离该字段；copy/lineage 在非枚举的确定性 `.fork.pending` 中完成，经 authority、hash chain 与 source ancestry 校验后同目录原子 rename 发布。`--fork-session` 默认每次生成独立请求键，`--fork-request-id` 为 unknown-commit 重试提供稳定入口；`/btw --fork` 继续使用独立 UUID。
- 最终本地验证：14 个核心测试文件 **626/626**；`CLI Session Host Consistency` 完整 gate passed，`branchForkProvenance` 同时证明 source-advance retry stable、independent fork distinct、unanchored fork refused、无遗留 successor；25 个目标文件的 Node 语法、Prettier 与 `git diff --check` 通过。四个真实子进程 `exit(91)` 窗口（copy、lineage、publish、meta）均在 crash 后先执行 session list、再推进 source、最后同 requestId 重试，最终只有一个 verified successor，pending 不会被提前列出或生成 meta。两路最终独立只读审计均为 P0=0、P1=0。
- 上述 gate 在提交前脏工作树运行，结果中的 `trackedWorktreeDirty=true`、`gateSourcePathsExact=false` 明确表示它是组件/工作树证据，不是 `9a780a0c84` 的 exact-SHA CI artifact。截至 **2026-08-02 20:50 +08:00**，该 SHA 的 CLI CI `30745539604` 已失败，Host Consistency `30745539474` 与 Strict Sandbox `30745539476` 成功；`c4f86903cc` 修正生成帮助索引中的 `--fork-request-id` 漂移，生成检查和 lazy-dispatch 21/21 通过，但其 CLI CI `30746466079` 仍在三 OS 的 unit shard 4/4 失败，且没有同 SHA 的 Strict/Host 完成证据。因此两者均为 **release NO-GO**。
- 未关闭边界：普通 hash-chain 验证和部分 authority 折叠仍为 O(N)；sidecar 不是独立 anti-rollback anchor；没有 general cross-process session/workspace lease；异常 pending/持续 Windows rename 失败尚无自动 GC/quarantine；真实冷进程 1 GiB P95/RSS、fsync/断电、remote host、长期 soak 与同一最终 SHA 的完整双门仍待验收。checkpoint 同 session 的普通/CAS writer 缺口已由下一节的 `60dbe9861c` 窄增量收紧，但不得外推为跨 workspace 或 hard-kill 原子事务。

### 14.7 Checkpoint timeline writer transaction 与 target pin 增量

- `60dbe9861c` 在 canonical transcript writer lock 内完成 exact-head 校验、intent、外部 restore、conversation commit 与 terminal audit；callback 返回后 writer 即撤权，不确定 append 会毒化 transaction，并在返回前结算 transcript/sidecar。它关闭的是同一 session 正常与可捕获失败路径中的交错写入窗口，不是 general session/workspace lease。
- Git checkpoint 使用 `git:<commit SHA>`、copy fallback 使用 `sha256:<canonical manifest digest>` 作为不可变 target identity；identity 直接进入 restore-code/restore-both action submission，VS Code code restore 强制校验，超过 4096 条的历史目标也直接绑定。Git ref 重定向、copy manifest 替换以及 copy blob 缺失/损坏均在工作区写入前 fail closed。
- 已覆盖的 restore 结果与操作层可捕获失败会携带 safety ID、不可变 safety identity、coverage、phase 与 created-path evidence；copy 无法为恢复前不存在的路径建立 tombstone 时显式标记为 `partial`，Git/copy 在上报 completed 前复核实际状态。Git plumbing 过滤父进程 secret，并只允许白名单内部环境覆盖与确定性 `GIT_AUTHOR_*`/`GIT_COMMITTER_*` 身份。
- 本地定向证据为 checkpoint 8 文件 189/189、credential-agent 1 文件 12/12；Node 语法、Prettier、ESLint 与 `git diff --check` 通过。Host Consistency 在脏工作树上通过，但 `trackedWorktreeDirty=true`、`gateSourcePathsExact=false`，仅是组件/工作树证据。最终只读审计结论为新增 P0=0；窄范围 writer fence/target pin 可成立，但当时发现的 P1 必须结合下一节 follow-up 判断，不得把本节解读为完整 failure-evidence 闭包。
- `60dbe9861c` 审计时登记的 P1 包括：callback 已成功但最终 settlement 单独失败时 safety/branch 输出丢失；copy `createdPaths` 过报计划但尚未实际创建的路径；Git checkpoint/safety ref 缺少 zero-old CAS/retry。这三项已分别由 `b81b84b9f9`、`7ce62ab756`、`b02c88b019` 修复。仍未关闭的是 workspace pre-state/diff digest、跨 session workspace 竞争、durable prepared/applied/recovery saga、copy safety tombstone 与 general lease 等跨资源边界。
- 该 SHA 的 Strict Sandbox `30748579537` 与 Host Consistency `30748579499` 已成功，但 CLI CI `30748579626` 被后续提交取消。取消前 Ubuntu unit4 已证明原 5 个 POSIX fixture failure 消失，并暴露 `backup publication TERM` 1 个残余；macOS/Windows unit4 未形成终态。cancelled run 与部分门成功均不构成发布授权；`60dbe9861c` 仍为 **release NO-GO**。

### 14.8 Checkpoint failure evidence 与 ref publication 后续收口

- `7ce62ab756` 将 copy restore 的 `createdPaths` 从“恢复前计划写且缺失”的全集改为每个 `atomicWriteFileSync` 成功返回后登记；多条缺失路径且第二条写入失败时只报告第一条实际创建路径。单文件 17/17、扩大只读复核 2 文件 26/26，Node 语法、Prettier、ESLint 与 `git diff --check` 通过；窄范围审计为新增 P0=0、P1=0。
- `b81b84b9f9` 为 session authority transaction 增加显式、白名单、限长并冻结的 recovery evidence；restore/branch 在外部副作用成功后登记 safety identity/coverage、created paths 与 branch session ID。callback 与 completed audit 均成功、最终 transcript/sidecar settlement 单独失败时仍输出这些恢复线索并标记 `commitState=unknown`，任意 callback result 与未知字段不会复制到 error/JSON。3 个定向文件 115/115，语法、Prettier、ESLint 与 exact diff-check 通过；独立审计为新增 P0=0、P1=0。
- `b02c88b019` 使用同一 `git update-ref --stdin` transaction 原子发布不可覆盖的 `cpNNNN` ref 与基于已观察 old OID 的 `_tip`；冲突会重读 tip、重建以 winner 为 parent 的 shadow commit、重新分配 ID，最多 16 次后以 `CHECKPOINT_REF_CONFLICT` fail closed。真实 Git 套件 35/35；确定性竞争验证 winner 不被覆盖、重试得到 `cp0003` 且 parent 指向 `cp0002`；独立 SHA-256 仓库验证 64 位 zero OID 与父链线性。语法、Prettier、ESLint、diff-check 通过，窄范围审计为新增 P0=0、P1=0。
- 仍未关闭的 P1：preview/confirmation 尚未绑定 workspace pre-state 或 diff digest；不同 session 仍可同时改同一 workspace；没有 durable prepared/applied/recovery saga，hard kill/fsync 后 intent 不足以确定恢复；copy safety 对恢复前不存在文件仍无 tombstone；`clearCheckpoints` 与 create 的既有跨操作竞争可在发布后删除 `_tip`。这批修复也不是 general execution/session/workspace lease，不能外推为 restore-both 跨资源原子事务。
- 非阻断 P2：Git ref 冲突识别依赖英文 stderr，本地化 Git 可能少一次 retry 但仍 fail closed；尚缺仅 `_tip` stale 的独立回归与 transaction verbs 最低 Git 版本探测。普通 hash-chain O(N)、独立 anti-rollback、真实 1 GiB、断电、remote host 与长期 soak 仍待产品级验收。
- 截至 **2026-08-02 21:17 +08:00**，`7ce62ab756` 的 CLI CI `30749148369` cancelled；`b81b84b9f9` 的 Host Consistency `30749409955` success，但 CLI CI `30749410076` cancelled，且无同 SHA Strict 完成证据；`b02c88b019` 的 CLI CI `30749596847` queued，且无同 SHA Strict/Host 完成证据。三者均为 **release NO-GO**。

### 14.9 Checkpoint workspace pre-state binding 增量

- `f22322edb1` 新增 `cc-checkpoint-workspace-binding/v1` 与 digest-bound `cc-checkpoint-timeline-confirmation/v1`。Git binding 覆盖 canonical repository scope、当前完整 tree、target tree 与确定性 write plan；copy binding 覆盖 canonical workspace、全部目标和 parent state、present/absent、content/stat identity、checkpoint target 与 write plan。preview 的展示列表即使截断，confirmation digest 仍覆盖完整 opaque identity。
- 原始 action 不能直接作为 `--confirm` 输入；CLI 只接受 preview 签发的精确 confirmation。public envelope 不泄露绝对 `workspaceRoot`，内部 full binding 仍传入 engine。VS Code 使用 `preview.confirmationSubmission`，conversation-only action 明确使用 `workspace: null`。
- Git/copy engine 在 safety checkpoint、Git ref 或工作区写入前重新计算并严格比较 binding；copy fallback 还在目标/blob 处理前拒绝文件系统根目录、cwd/abs/rel 不一致、遍历/重复别名、symlink/junction parent、非普通目标及损坏 blob。直接 restore（含 `--force`）也由即时 preflight binding 约束。
- 正确加载 `packages/cli/vitest.config.js` 的最终定向回归为 6 files、**96/96**；Prettier、ESLint、Node `--check` 与 `git diff --check` 全部通过。此前从仓库根运行导致的 5 秒超时没有加载 CLI 的 90 秒 test timeout，只是错误测试入口，不是产品失败。最终独立只读复核为新增 P0=0、P1=0。
- 本增量只关闭“preview/confirm 未绑定完整 workspace pre-state”的缺口。最终 confirm→intent→restore check/write 窗口仍需要 canonical workspace lifetime lock；锁顺序必须为 `workspace → session`，在锁内重载 authority、重算 binding，并保持到 restore、conversation 与 terminal audit 完成。hard kill 恢复还需要 durable prepared/applied/recovery saga，copy 对原先不存在文件需要 durable tombstone。因此目前仍是 **release NO-GO**，不能写成 restore-both 原子完成。

### 14.10 下一 CLI 版本判定

- npm registry 当前 `latest` 与仓库 package version 都是 `0.162.189`，registry 的该版本绑定 `gitHead=2607af0dadeb951583139942e5f2add3e95e1208`；同一版本不可重复发布。
- 从该 npm gitHead 到 `af2df894a8`，`packages/cli` 已累计 **122 个提交、352 个文件变化、95,885 行新增/3,716 行删除**。变更规模足以准备一个 patch release，建议候选版本为 **`0.162.190`**，而不是继续堆积到下一次大批量发布。
- 截至 **2026-08-02 23:08 +08:00**，`af2df894a8` 的 `CLI CI` run `30753644056` 与 `CLI Strict Sandbox` run `30753643956` 均为 queued，Host Consistency run `30753643953` 为 in progress。checkpoint workspace lifetime lock 已由下节增量关闭，但 durable restore saga/copy tombstone 等 hard-kill P1 仍未关闭。因此结论仍是：**值得准备 `0.162.190`，现在不要发布**。
- 推荐顺序：先提交并验证剩余 P1；再创建唯一版本提交将 CLI bump 到 `0.162.190`；对该精确版本 SHA 运行 `CLI CI` 与 `CLI Strict Sandbox` 的 Ubuntu 24.04、macOS 15、Windows 全矩阵；全部成功后再执行 npm dry-run/tarball digest 校验与正式 publish。任何 queued、cancelled、failure、旧 SHA 或局部成功都不能授权发布。

### 14.11 Checkpoint canonical workspace lifetime lock 增量

- `af2df894a8` 让 checkpoint restore 与 `WorkspaceTransactionManager` 共用同一 canonical workspace lock authority。锁根固定在生产 authority，workspace 必须解析为真实非文件系统根目录；大小写/alias、symlink/junction、parent/child overlap、活 owner 超时、dead/corrupt owner 和 ownership tamper 均 fail closed。公共 helper 只接受同步 callback，并在成功、异常和所有权丢失路径上验证并释放 exact owner。
- timeline restore 的顺序现为 `workspace → session`：取得 workspace lease 后重新加载 session authority 与 code status、重算并精确比较 preview confirmation/workspace binding，再写 intent、执行 restore、提交 conversation/audit 与 settlement；direct restore（包括 `--force`）也在同一 lease 内执行第二次完整 preflight。conversation-only action 不获取 workspace lock。
- crash recovery 的 dead-owner reclaim 现于同一个 canonical `coordination.lock` 临界区内完成 exact observed-owner CAS、liveness 复核、全 registry overlap 扫描以及 reclaim+acquire；只忽略待回收的 exact transaction owner。确定性竞态回归在 parent lock 的 `rm → mkdir` 窗口注入 child helper，child 得到 `WORKSPACE_LOCK_TIMEOUT`；另一个 overlapping dead checkpoint owner 会保持原样并返回 `RECOVERY_REQUIRED`，不会被 transaction recovery 自动接管。
- 最终组合回归为 6 files、**83 passed / 1 个既有平台 skip**，其中包含真实 multiprocess 与 Process Broker 互操作；Prettier、ESLint、4 个文件的 Node `--check` 和 `git diff --check` 全部通过。独立安全复核结论为本增量无剩余新增 P0/P1，可以提交。
- 本增量关闭的是活进程/跨 session/跨 process 的协作式 workspace 竞争，以及既有 transaction recovery 的 registry reclaim 窗口；它不把 hard kill 后的多阶段 restore 升级为原子事务。durable `prepared → intent → safety → mutation → applied → session_committed → completed` saga、copy 原先不存在路径的 durable tombstone、fsync/断电和 crash fixture 仍待完成，因此 `af2df894a8` 仍是 **release NO-GO**。

### 14.12 Copy checkpoint hard-kill safety 与 Windows identity 收口

- `4ddb5c9c98` 将 Windows Server 2025 / Node 22.12 / libuv 1.49/1.50 的可信 path↔fd device 投影兼容合入主线；path↔path 与 fd↔fd 仍保持完整身份字段精确比较，兼容仅在受信 volume/share-root authority 下生效。该提交同时把 copy restore 的写入、删除、tombstone、stage reservation、namespace 与 safety arm 绑定为不可替换的私有恢复证据。
- 被删除或覆盖的 workspace predecessor 现明确采用 `non-authoritative-trash/v1`：rename 前必须由私有 arm 绑定并两次复核内容与对象身份，rename 后 trash 永不作为恢复输入，也不进入私有 authority chain。trash 被篡改或删除不会阻断由 safety blob/tombstone 驱动的完整恢复；若 successor 在校验窗口出现，restore fail closed 且不会 unlink successor。
- 真实 Windows 回归将原目标显式授予 `Everyone:F`，在 target→trash rename 后强杀子进程，再由全新进程确认 trash 仍为非私有、篡改 trash，并只凭私有 safety evidence 完成恢复。冻结哈希下的组合回归为 **78 passed / 1 个平台条件 skip**；Node `--check`、ESLint、Prettier 与 `git diff --check` 全部通过，独立终审为 P0=0、P1=0、P2=0。
- 该提交只关闭 copy checkpoint identity、tombstone 与 rename 后 ACL crash window，不等于多资源 restore-both 已具备 durable saga。`4ddb5c9c98` 的 `CLI CI` run `30760248218` 已触发但截至 **2026-08-03 02:04 +08:00** 尚无完整终态，也没有同 SHA 的最终 `CLI Strict Sandbox` 全矩阵证据；因此候选版本仍为 **release NO-GO**。
