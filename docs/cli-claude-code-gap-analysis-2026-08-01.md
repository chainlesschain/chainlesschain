# ChainlessChain CLI 对照 Claude Code CLI 补齐与优化方案

> 分析日期：2026-08-01
>
> ChainlessChain 历史候选基线：`packages/cli` v0.162.194 release candidate；v0.162.190 / v0.162.191 / v0.162.192 未发布；v0.162.193 已被非权威通用 workflow 发布且不得视为门禁通过。当前收口基线见第 16 节：v0.162.197 已完成 exact-SHA npm 发布与公网回读。
>
> Claude Code 参考基线：官方文档与 2.1.220 changelog（2026-07-25）
>
> 文档性质：现状审计、实施方案与持续进度记录；未标记“已完成”的项目仍是待办。第 14～15 节保留逐次历史证据，第 16 节是当前判定入口。

## 历史实施进展（截至 2026-08-05 `0.162.194` 失败快照）

| 方案项                                             | 状态                                      | 落地结果与验证证据                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0 lazy dispatch、单次执行与启动 SLO               | 已完成                                    | `c42820ab13`：phase-0 dispatch、生成式帮助、`OutputContext`、轻量 status 与启动基准落地；Windows 冷启动四项 p95 均满足仓库阈值                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| P0 typed config、secret、文件权限与 Sandbox 默认值 | 已完成                                    | `a4d1c05133`：版本化 schema、统一 redaction、OS secret store、原子迁移、POSIX mode、Windows 当前用户 ACL、doctor 修复和 fail-closed sandbox；179 项目标测试通过                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| P0 MCP `ws/wss` 与 scope                           | 实现完成，release 证据未关闭              | `392398a09d`：WebSocket transport、作用域与运行时契约落地；`0de8744151` 修复 `configScope/configSource/projectPath` 传播，并确立 `managed/显式 > local > project（.mcp.json 优先于 legacy project DB）> user > plugin`，新增真实 `type:"ws"` runtime socket、结构化 close/timeout 回归。本地变更集 70/70，扩大 9 文件 156/156；CLI CI `30743223135` cancelled，无同 SHA Strict/Host 完成证据                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| P0 Session 事实源与可恢复 Agent runtime            | 仓库安全闭包继续收口，发布门未关          | `ca4fe4ef73`、`199b2cb7c6`、`4c656ac7ec` 完成索引、增量持久化、WS 恢复和测试工作区隔离；`a72d75d153` 收口 MCP authority 读写、transcript 锚点、严格 started→terminal 状态、Headless/Stream/Cowork 恢复与 semantic-compaction 计费；`b21ba58c2c` 至 `ab32a57e4b` 继续加固 schema、malformed projection、动态 latch、transport outcome-unknown、REPL 原子恢复和各宿主共享 authority。`24349b05fd` 收紧 WS recovery projection/refresh，`842691eedf` 覆盖 roots-only MCP client，`223c0f505c` 使 Stream resume 的 authority 切换保持事务一致；`1c572b213f` 新增独立 `mcp_call_recovery_adjudication` authority event、verified head/recovery digest、单次 CAS、TTY typed confirmation 与单调 exact-replay deny，`confirmed_not_applied` / `confirmed_applied` 均不伪造机器 terminal record。提交前干净索引快照的 12 文件矩阵 263/263、REPL MCP 目标 6/6 通过；独立安全审计无剩余高/中 blocker。当前 exact-SHA Windows Session Host gate 又验证双进程 request claim fencing、claim owner 崩溃不自动接管、模型期间同 UID 伪造 transcript+sidecar 的失败关闭及五类宿主 tamper 拒绝。裁决要求键入包含 `HOST STOPPED` 的完整 challenge，但这只是所有既有宿主已停止的操作性证明，不是通用跨进程 host lease；新 authority 仅在 restart/resume 后采用。恶意 MCP/Skill、磁盘与 pipe 故障、长期矩阵及三平台权威 artifact 仍未关闭 |
| P0 Skill 受控执行与内容身份授权                    | 已完成基础                                | `c841a58e2b`：用户可写 Skill 默认不受信，执行前异步复核精确 digest，经隔离 Agent 与 host-owned 工具边界运行，并透传 LLM 配置、命令侧失败关闭；`a72d75d153` 接通 runtime 的异步 materializer 与子 Agent 用量来源归因；`c2ffbb7f22` 将子 Agent 的提示上下文与 `fresh/fork` authority 分离，并把已 resolve 但状态为 failed 的隔离 Skill 规范化为结构化失败。真实宿主/恶意 Skill 长期矩阵仍未完成                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| P0 exact-SHA 发布门禁与原生发行链                  | 发布绕过已遏制，待权威验证                | `6d229d0df4`、`55b3c55a1c` 提供三平台 exact-SHA gate、不可变 npm tarball、六目标 manifest、同版本身份校验、禁止覆盖 versioned asset 与 stable-channel 激活协议。2026-08-03 新增的通用 workspace publisher 覆盖了专用 `npm-publish.yml`，run `30820089779` 在 `CLI CI` 尚未完成且最终失败时从 `e8e7ba…` 发布 `0.162.193`；该版本无 `v-npm-0-162-193`、无 exact-SHA attestation、无专用 immutable tarball/SBOM handoff，不得视为权威发布。当前修复恢复专用 workflow；通用 workflow、产品 release 与本地 publisher 均被移出 CLI 写权限，产品 release 只消费已验证的 registry/tag/exact-gate 身份。候选前进到 `0.162.194`，仍须由修复所在 exact SHA 完成全部门禁                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| P0 签名更新与回滚链                                | 仓库级事务加固已提交，发布阻断            | `4d3a4ee788` 提供签名 manifest、健康检查与初版自动回滚；`8990999771` 提交原生 installer/OTA 的锁、状态、sidecar、alias、backup lineage、结果消费与 rollback/rescue 事务加固，冻结后的 8 文件定向矩阵最终为 142/142，此前中间审计快照不再作为证据。`a1c9eed07e` 又关闭下载目标替换恢复缺口，下载器 30/30、相邻更新矩阵 122/122，通过只读复审的该批范围为 P0=0、P1=0。当前证据仍只是仓库/进程级验证：尚缺 durable intent/phase journal 或原子 generation pointer、真实 taskkill/断电一致性、Linux/macOS 与 ARM64 实机执行、签名/notarization/Authenticode，以及待发布 exact SHA 的完整发行矩阵；不得标记为 release-ready                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| P1 `/btw` 临时旁路与统一输出契约                   | 已完成                                    | `316f7497b4`、`c42820ab13`：旁路问题不污染主会话历史与上下文，quiet/verbose/json 统一经输出上下文收口                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| P1 后台 Agent 恢复配置与隔离                       | 已完成                                    | `34414b64f9`、`b1b0570091`：持久化、去敏的 background launch profile、指纹与兼容性校验、外部凭据注入、跨平台 canonical path 恢复；本地单文件 39 项通过，`CLI Strict Sandbox` 在 Ubuntu 24.04、macOS 15、Windows 全绿                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| P1 默认 Agent 与命令面 manifest                    | 第三批与 telemetry 接线完成，观察窗未满   | `6b2b394fd1`：修复 14 个域的嵌套帮助路由和跨 OS help 漂移，175 条命令写入 stability/category/visibility/replacement 元数据，默认命令与核心分组由 manifest 驱动；`c50d2f8a53` 以 `dao`、`evomap` 完成首批 `lab` 迁移，`1f2a9caf3d` 补强 lifecycle 契约。`0.162.194` 候选的第二批迁移 8 个明确标注旧版/in-memory governance 的入口，`56c87fa5d0` 又迁移 15 个内部 V2 governance overlay；原顶层拼写均至少保留两个 minor cycle，只在 stderr 发弃用提示。registered graph 仍为 175、净增长 0；deprecated compatibility entry 为 25，推荐面降到 151，manifest、README 与四种 shell completion 同源生成。当前增量为显式启用 OTLP 的 migrated command 增加无参数 lifecycle usage/duration 指标，区分 legacy 与 replacement route；产品入口 `todo`、`subagent`、`webfetch`、`planmode` 仍保持 active。至少两个 minor cycle 的真实观察、代表性汇总及据此作出的 alias 保留/移除决策仍待完成                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| P1 Plan/Todo/会话可靠性                            | 已完成                                    | `ece470137d`、`d28dd7d9fc`、`70306bd8ee`：Plan/Todo 持久化、revision 冲突保护和结构化 handoff 落地                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| P2 Provider-neutral Advisor                        | 已完成                                    | `8e6e617373`：Advisor runtime、命令与 REPL 接口落地；83 项测试通过                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| P2 交互输入、提示建议与 Session recap              | 生产 REPL 接线完成，待真实终端/发布门验证 | `6845c4a6ac`、`ca4fe4ef73` 完成剪贴板图片、编辑器、stash、suggestions、快捷键、终端布局与 recap 模块；当前 `0.162.194` 候选又把每会话 `PromptInteractionController`、`SlashCommandRegistry` 和五个交互命令接入真实 `agent-repl`，优先消费已配置快捷键，给手动刷新与自动建议传入实时 assistant/session context，并将本地 data-image clipboard chip 合并进既有消息/vision provider 路径。定向矩阵 **10 files / 200 tests passed**；真实 TTY、SSH/screen-reader、Windows/macOS 键盘与 clipboard host 矩阵及待发布 exact SHA 权威门仍未完成                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

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
| `d465de2013` | `30781904317` failure   | `30781907923` success | `30781910691` success          | **NO-GO** |

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

- 截至 **2026-08-03**，npm registry `latest` 仍为 `0.162.189`，并绑定 `gitHead=2607af0dadeb951583139942e5f2add3e95e1208`；仓库 package version 已唯一前进到 **`0.162.190` release candidate**，不会尝试覆盖已发布版本。
- 从该 npm gitHead 到代码冻结提交 `767fdada75`，`packages/cli` 已累计 **164 个提交、391 个文件变化、137,900 行新增/4,015 行删除**。变更规模和用户可见能力足以发布 patch release，候选版本保持 **`0.162.190`**。
- public recovery 现同时提供窄 `checkpoint recovery resume` 与 verified `checkpoint recovery rollback --yes`。前者只收敛 session/workspace 均证明 already-completed 的 timeline restore；后者只处理持久 saga 已证明的 partial mutation，绑定 exact seq/head、当前 live owner digest、原始 target count、持久 engine 与双向 session resolution。两者都不等于一般自动 resume、多资源事务或 checkpoint recovery GA。
- 最新冻结证据包括 mutation/terminal × Git/copy 真实 kill/restart **4/4**、recovery 四文件 **142/142**、`file-checkpoint` **86 passed / 1 skip**、Git retention/predecessor **12/12**、timeline command **27/27**，以及 ESLint、Prettier、Node/帮助生成器和 `git diff --check`。独立终审为新增 P0=0、P1=0；这些仍只是本地补充证据。
- 结论保持：**应该完成 `0.162.190` release-candidate 验证，但现在不要发布**。只有版本/changelog 所在的最终精确 SHA 的 `CLI CI` 与 `CLI Strict Sandbox` 在 Ubuntu 24.04、macOS 15、Windows 全绿，并通过受影响的 Session Host/checkpoint 门和 immutable npm tarball 校验，才允许打 `v-npm-0-162-190` tag。任何 queued、cancelled、failure、旧 SHA、docs 前一 SHA 或局部成功都不能授权发布；门禁通过后仍需用户明确授权才执行 tag/npm publish。

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

### 14.13 Checkpoint already-completed resume 与 rollback v2 协议收口

- `4b85468917` 将 `checkpoint recovery resume` 接入生产 CLI：只接受 clean、pending、retained-owner 的 timeline `workspace_applied` / `session_committed` saga，并同时要求 `--yes`、exact seq/head、当前 live owner digest、verified session already-completed 与 exact workspace target。成功动作对外仍叫 `resume`，内部明确记录为 `complete_already_completed`；错误输出只返回稳定公共码，不泄露 owner、workspace root 或底层诊断。
- production workspace verifier 复用 Git `statusAgainst` 与 copy `diffCheckpoint` 的 canonical planner，绑定 immutable checkpoint identity/namespace、workspace scope、target poststate 与 domain-separated digest，并在读取前后共三次验证 workspace lease。`5f48437b0b` 加入真实 Git/copy exact-pass 与 drift-reject 组合测试；`59ec5bb9b8` 去除并行测试中的全局 home 竞争，`8facbdc3de` 进一步 canonicalize macOS `/var` 与 Windows 8.3 temp alias。这里的“exact”仍受引擎边界约束：Git 是 canonical Git tree，copy 只覆盖 checkpoint targets/tombstones，协作 lease 也不能消除非协作外部写者的验证后 TOCTOU。
- `5ac697dfa2` 把 rollback saga 升级为 current v2 / legacy v1：`rollback_prepared → rollback_started → workspace_rolled_back → session_rollback_committed → rolled_back` 每一阶段都固定 request、安全快照、write plan、prestate、target/state/result 与 commit digest；terminal 不可重开，v1 pending 只能追加严格 v2 边界，future v3、v2→v1 降级和伪造 direct rollback 均 fail closed。
- `5654e1ac1f` 新增 `checkpoint_restore_recovery_resolution` session authority 原语：workspace settlement event hash 进入 resolution，resolution hash 再生成 saga `sessionRollbackCommitDigest`，形成双向跨存储绑定；同步 transaction exact-head CAS、append 后复核以及 response-lost reconciliation 禁止 blind reappend。`db90af42c5` 让 recovery reader/CLI 从 saga 单源读取 phase 词表并保守投影 rollback request/evidence。
- 该阶段冻结代码经两组独立只读审计均为 P0=0、P1=0，saga 为 **90 passed / 2 skipped**，session/read-model/CLI/timeline 为 **96/96**，当时合并恢复矩阵为 **209 passed / 2 skipped**。这些数字只描述 rollback v2 协议、读模型、already-completed resume 与 session resolution primitive；后续生产 controller、公开 rollback、跨存储 journey 与 mutation kill/restart 的完成状态见下一节。

### 14.14 Verified partial rollback、kill/restart 与 retention 闭包

- `e8a58bd585` 与 `f27495bca7` 分别实现 production Git/copy rollback adapter：只消费 saga 固定的 immutable namespace/identity、safety、write plan、prestate 与 target state；不会在恢复时重新猜测 engine。`000d3af245` 将其接入 crash-safe controller，严格推进 `rollback_prepared → rollback_started → workspace_rolled_back → session_rollback_committed → rolled_back`，并在 response-lost/restart 路径重读和对账。
- `bac192c488` 先让 active saga 的 original/safety checkpoint 成为 retention authority；`767fdada75` 再把 Git/copy 的 manual delete、clear 与自动 prune 接入 canonical workspace lock 和 saga guard。Git 使用 expected-OID `update-ref --stdin` transaction，并在删除 latest 时验证唯一 predecessor ref 后原子回退 `_tip`；孤儿/不唯一 tip 均 fail closed。Copy 使用同 root 私有 sentinel 与维护锁、manifest hard-link no-replace、独占 ID publication、全组 blob-layout preflight，并拒绝嵌套 custom store，避免删除 successor 或 recovery authority。
- `4fca29f2f3` 的真实子进程矩阵覆盖 Git/copy × terminal/mutation 四路径，**4/4 无 skip**；mutation 用例在 saga `mutation_started` 后强杀，重启进程通过真实 controller/adapter 恢复 pre-restore workspace、保留第三方文件、提交 session resolution、终结为 `rolled_back` 并释放/归档 authority。它证明的是这四个确定窗口，不是断电等价、任意 fsync 点或非协作写者下的全局原子性。
- `805706136e` 公开同步 `cc checkpoint recovery rollback --yes`。命令在打开任何 authority 前检查显式确认，随后绑定 exact seq/head、当前 live owner digest 与 cycle-bound original target count；只允许已证明的 rollback phase，沿 persisted engine 调度 Git/copy adapter。公开输出和错误使用稳定白名单；普通函数返回 thenable、恶意 `then` getter、unknown adapter error 与零目标 cycle 均 fail closed。recovery 四文件最终为 **142/142**，Session Host gate 路径同步覆盖。
- retention 最终冻结回归为 `file-checkpoint` **86 passed / 1 个平台 skip**、Git retention/predecessor **12/12**、timeline command **27/27**；独立终审另跑核心嵌套回归 **4/4**，结论为 P0=0、P1=0。非阻断 P2 是 filesystem/UNC 卷根祖先检查在极端终止顺序下可能形成不可删的混合目录，但严格非递归删除仍 fail closed，不会跨 store 误删；后续可把 root authority 检查移到终止判断前。
- `d465de2013` 的本地 clean-worktree release artifact 已完成 generator、Web/changelog build、pack、manifest create/verify 与仓库 audit policy；tarball 为 `5,823,024` bytes、SHA-256 `f6e422bf1f401ffb1b5b41f348891887ffd22f9cbcb4a5bb4f5733b9b49d402c`。同 SHA 的 Strict Sandbox `30781907923`、Session Host `30781910691` 与 Background Interaction `30781914093` 成功，但 CLI CI `30781904317` failure，因此 artifact 和三个组件门不能授权发布。
- 失败不是 flake：macOS 与 Windows 的 unit shard 3/4 在同一个 `checkpoint-store` 文件各报相同 10 项，分别由 `/var`→`/private/var` 与 `RUNNER~1`→长路径造成。新增 retention fixture 从未 canonicalize 的 `tmpdir()` 根派生 state/lock，而 production saga 按设计拒绝 durable authority alias；其余 CAS/prune 断言是 retention 初始化 fail-closed 后的级联。`bb15105561` 只在 fixture 源头执行 `realpathSync.native(mkdtempSync(...))`，生产安全策略未放宽；本地相关 retention/delete/prune 组 **12/12** 通过。
- 边界仍需保守表述：当前是 **verified partial restore rollback**，不是 checkpoint recovery GA，也不是 workspace+session+外部副作用的通用分布式事务。真实断电/fsync 故障注入、非协作 same-UID writer、任意 checkpoint/store 损坏修复、长期 soak 与文档提交后的最终 exact-SHA 三平台发布门仍待验收。因此 `0.162.190` 仍为 **release NO-GO**；修复后的最终 SHA 必须重新跑完整 `CLI CI`、`CLI Strict Sandbox` 与受影响组件门，不能重跑或沿用 `d465de2013` 的部分成功。

### 14.15 `0.162.190` 发布门失败与 `0.162.191` 重试身份

- 用户明确授权后，`v-npm-0-162-190` 作为 lightweight tag 精确绑定 `ec4941b0630ffdfb5470be9814052ea690f3776f` 并同步 GitHub/Gitee。正式 [npm workflow `30790359741`](https://github.com/chainlesschain/chainlesschain/actions/runs/30790359741) 的 `exact-sha-gate` 成功，但综合 `test` 在 `Run Agent SDK tests` 失败；依赖它的 `package-cli` 与 `publish` 都是 skipped，因此 npm registry 没有 `chainlesschain@0.162.190`，也不存在可误认为已发布的 CLI tarball。
- 根因是 `packages/agent-sdk/__tests__/e2e-agent-session.test.ts` 同时把临时 `home` 用作 `CHAINLESSCHAIN_HOME` 和 CLI `cwd`。新 owner-private 路径保护正确拒绝 control state 包含 active workspace，并返回 `CONFIG_HOME_UNSAFE`。修复只把 control-state home 与 workspace 改为同一临时根下的 sibling，并把真实写入目标留在 workspace；没有修改或放宽生产 `getHomeDir()` 安全判断。
- 修复后的 Agent SDK build 成功，完整套件为 **7 test files / 50 tests passed**，包括真实 CLI 的 stream/result、Write approval、实际落盘与 session resume。失败 tag 保持不可变且不强推；候选 package version 前进到 **`0.162.191`**。只有新版本/文档/夹具所在 exact SHA 重新取得 `CLI CI`、`CLI Strict Sandbox`、受影响的 Background/Session Host 门和 immutable npm tarball 验证后，才允许创建 `v-npm-0-162-191` 并再次进入 npm Trusted Publishing。

### 14.16 `0.162.191` SBOM 门失败与 `0.162.192` 重试身份

- `0.162.191` 的 exact release SHA `9e2a3238426499a3de1d228034e66dab91cbfa2c` 完成 [CLI CI `30791273745`](https://github.com/chainlesschain/chainlesschain/actions/runs/30791273745)、[CLI Strict Sandbox `30791273563`](https://github.com/chainlesschain/chainlesschain/actions/runs/30791273563) 与 [Session Host `30791273622`](https://github.com/chainlesschain/chainlesschain/actions/runs/30791273622)。[npm workflow `30793513643`](https://github.com/chainlesschain/chainlesschain/actions/runs/30793513643) 中 core packages、Agent SDK、PDH、Web Panel 和完整 CLI tests 全部成功，证明上一轮 fixture 修复有效；但 `package-cli` 的 SBOM 子命令失败，artifact upload 与 publish skipped，npm registry 仍无 `0.162.191`。
- 根因是工作流在 monorepo root 对总 lock 执行 `npm sbom --package-lock-only`，把不属于 CLI 发布载荷的 Electron/React Native peer graph 一并纳入，确定性返回 `ESBOMPROBLEMS`。修复将 pack/manifest 与 SBOM 分步：从已生成的 immutable CLI tarball 解包到名为 `chainlesschain` 的临时根，使用 `--ignore-scripts --legacy-peer-deps` 只生成该发布包 lock，再产出 CycloneDX，并校验 root `name/version/purl` 与非空 components/dependencies。
- 本地 tarball 路径验证成功：CycloneDX 1.5，root purl `pkg:npm/chainlesschain@0.162.191`，606 components、607 dependency entries；root-monorepo 直接生成继续按预期失败，证明隔离边界有效。`v-npm-0-162-191` 不移动、不覆盖，候选版本前进到 **`0.162.192`**。新 workflow、版本和文档所在 final SHA 必须重新通过三平台 CLI CI / Strict Sandbox 和 immutable package/SBOM/publish gate 后，才允许创建 `v-npm-0-162-192`。

### 14.17 `0.162.192` rerun 门禁误判与 `0.162.193` 重试身份

- `0.162.192` 的 exact release SHA `19dcdea87a87892fe9eb22a23b4f3fe9ce05af93` 完成 [CLI CI `30795367296` attempt 2](https://github.com/chainlesschain/chainlesschain/actions/runs/30795367296)、[CLI Strict Sandbox `30795367089`](https://github.com/chainlesschain/chainlesschain/actions/runs/30795367089) 与 [Session Host `30795366927`](https://github.com/chainlesschain/chainlesschain/actions/runs/30795366927)。CLI CI 首次执行的 7,259 个 macOS unit 4/4 用例仅真实双进程 CAS 竞争测试失败一次；同一 SHA 重跑后该分片和三平台 `verify-cli` 全绿。
- [npm workflow `30799974832`](https://github.com/chainlesschain/chainlesschain/actions/runs/30799974832) 的 `exact-sha-gate` 仍失败：验证脚本请求 jobs 时显式使用 `filter=all`，把同一 run 第 1 次 attempt 的失败/skip 与第 2 次 attempt 的成功 jobs 混合，因而错误拒绝已经全绿的 SHA。门禁失败使 package/publish 不可达，npm registry 没有 `0.162.192`。
- 修复把 jobs 查询改为 `filter=latest`，保留 exact SHA、成功 workflow run、全平台 job 和非 optional job 必须成功的全部约束；回归单测 **6/6** 通过，并用真实 `19dcdea…` / GitHub API 成功验证 CLI CI 与 Strict Sandbox。`v-npm-0-162-192` 不移动、不覆盖，候选版本前进到 **`0.162.193`**；包含修复、版本与文档的 final SHA 必须重新通过完整发布门后才允许打 `v-npm-0-162-193`。

### 14.18 `0.162.193` 预标签 CAS 竞争修复

- 首个 `0.162.193` 候选的 Strict Sandbox `30800529966` 与 Session Host `30800529893` 成功，但 [CLI CI `30800530258`](https://github.com/chainlesschain/chainlesschain/actions/runs/30800530258) 再次仅在 macOS unit 4/4 的真实双进程 checkpoint CAS 用例失败。因为失败在打 tag 前被门禁拦截，在该候选时点 `v-npm-0-162-193` 未创建、npm registry 也未写入；此后发生的非权威通用发布事故见下一节 14.19。
- 根因不是期望值不稳定，而是协作锁的正常释放竞争：非 owner 安全检查先确认锁目录，owner 可在后续目录枚举或 `owner.json` `lstat/read` 前释放它；旧实现把该瞬时 `ENOENT` 归类为 `LOCK_FAILED`，所以输掉 CAS 的进程没有重试获取锁，也就没有在串行 stale-head 校验返回 `CONFLICT`。
- 修复仅在 `requireOwner=false` 的 unlocked pre/postflight 对该精确消失返回“当前无锁”，让 `withFileLock` 重新建立锁并在回调前验证精确 owner；`requireOwner=true` 的临界区 owner 丢失仍严格失败。新增目录枚举和 owner 文件消失两个确定性回归；完整 checkpoint restore saga 为 **105 passed / 2 skipped**，真实双进程 CAS 独立重复 5 次均通过，相邻 file-lock/release-gate 为 **23/23**。这些本地结果只证明修复边界，最终版本仍必须以新 exact SHA 通过全部 GitHub 权威门和 immutable tarball/SBOM 验证。

### 14.19 `0.162.193` 非权威发布事故与 `0.162.194` 遏制身份

- 权威 registry 回读确认 `chainlesschain@0.162.193` 已于 **2026-08-03 13:58:27 UTC** 发布，npm provenance 的 `gitHead` 为 `e8e7ba274b487ed491c04ec3359841a0e545debb`，但 GitHub/Gitee 均没有 `v-npm-0-162-193`。来源不是上述专用 CLI release workflow，而是手工触发的通用 [Publish to npm run `30820089779`](https://github.com/chainlesschain/chainlesschain/actions/runs/30820089779)：它在 auto mode 将 registry `0.162.189` 与工作树 `0.162.193` 比较后直接选择 `packages/cli`，只执行 package lifecycle build 后即发布。
- 根因是提交 `734a438156` 没有新增独立 workflow，而是以同一路径 `.github/workflows/npm-publish.yml` 覆盖了既有专用流程，删除了完整测试、exact-SHA `CLI CI` / `CLI Strict Sandbox` 校验、immutable tarball、manifest/SBOM create-verify 与 artifact handoff。发布发生时，同 SHA 的 [CLI CI `30819465463`](https://github.com/chainlesschain/chainlesschain/actions/runs/30819465463) 尚在运行且随后因 6 个 IDE 集成回归失败；因此 npm provenance 只能证明来源，不能补造发布授权。
- 遏制修复恢复覆盖前的专用 `.github/workflows/npm-publish.yml`，并把它的 tag trigger 从可能与其他发行面重叠的 `v*` 收紧为唯一 `v-npm-*`；live path 还会从 exact checkout 读取版本，要求事件 ref 精确等于 `refs/tags/v-npm-<package-version>` 且 `GITHUB_SHA` 等于 checkout `HEAD`。通用 workspace 发布器迁为 `.github/workflows/workspace-npm-publish.yml`，只响应不与 CLI 重叠的 `v-packages-*` 和数字产品 tag。通用 detector 从候选集合排除目录 `cli` 和包名 `chainlesschain`，显式选择也 fail closed；publish loop 在读取实际 `package.json` 后再次拒绝同一目录/名称，避免 detector 回归单点绕过。
- 继续枚举所有 `npm publish` 入口后又关闭两条旁路：产品 `.github/workflows/release.yml` 删除 token-backed `publish-cli` 与 `skip_tests`，finalize 前只允许消费已经存在的 CLI release，并复核 `v-npm-<version>` tag、registry `gitHead` 以及该 tag SHA 的完整 `CLI CI` / `CLI Strict Sandbox`；`scripts/npm-publish.js/.mjs` 从发布顺序移除 CLI 并保留运行时名称/目录拒绝。PDH 与普通 workspace 发布说明全部改指独立通用 workflow。发布契约测试同步固定这些边界，并用隔离临时仓库执行真实 detector，验证 tag 自动检测只产出普通 workspace 包、显式 CLI 选择返回失败。
- 同一 `e8e7ba…` CLI CI 暴露的 6 个 IDE 阻断也已在候选树修复：删除第二套 inline-chat 注册和不存在的 `open/runAction` 调用，统一使用既有 `ChatViewProvider` 与模块 logger，消除 `outputLog` ReferenceError；六个 contributed command 进入 canonical public IDE capability manifest。测试 fake 新增 selection/decoration host API，使 activation 回归实际走到 decorator 注册，而不是依赖 catch 掩盖。当前 release/changelog/gate/IDE 定向矩阵为 **11 files / 63 tests passed**，其中 activation + manifest 为 **10/10**；这仍是本地补充证据。
- 已发布的 `0.162.193` 不删除、不覆盖，也不补打会造成“当时已过门”误解的 release tag；后续候选唯一前进到 **`0.162.194`**。只有包含遏制代码、版本与文档的 final exact SHA 重新通过完整 `CLI CI`、`CLI Strict Sandbox`、受影响组件门和专用 immutable tarball/SBOM 验证后，才允许在用户明确授权下创建 `v-npm-0-162-194` 并发布。当前仍为 **release NO-GO**。

### 14.20 生产 REPL 交互接线闭包

- `agent-repl` 现在为每个生产会话建立独立 `PromptInteractionController` 与 `SlashCommandRegistry`，通过统一 registry 路由 `/paste-image`、`/editor`、`/stash`、`/suggestions`、`/recap`；既有成熟 slash handler 不迁移，未知命令也不会被交互层吞掉。`/suggestions on|off` 仍通过 config manager 持久化，controller 在 REPL 关闭时清理 timer、生成任务和按键 listener。
- 生产 keypress dispatcher 以受控 wrapper 和 `prependListener` 先于 readline 原生 listener 判断 Esc、Shift+Tab 及用户配置的交互快捷键；被消费的按键不会再进入行编辑器。Vim NORMAL/INSERT 边界、turn abort 与 idle Esc 保持显式优先级，非法配置只告警并回退到安全默认值。
- 手动 `/suggestions refresh` 与结算后自动调度都读取实时消息快照、最后一条 assistant 文本和 session ID，不再以缺失 assistant context 的空壳生成。剪贴板 attachment 只接受本地 `data:image/(png|jpeg|gif|webp);base64`，拒绝远程 URL；显式图片与文本、已有路径图片合并为 multimodal content，并复用 `resolveVisionLlm` 选择的 provider。slot-fill 追加文本时也保留既有 multimodal block，不再把数组隐式转成字符串。
- 定向回归覆盖交互 surface 的真实 registry、未知命令、实时建议上下文、本地/远程图片边界及生产 REPL 源契约；连同既有 prompt、keybinding、image-input、REPL 与 provider 集成用例共 **10 files / 200 tests passed**，Node 语法、Prettier 与 `git diff --check` 通过。这是本地仓库级证据；尚未在真实交互 TTY、SSH/screen-reader、Windows/macOS clipboard 与键盘布局矩阵运行，也尚未通过 `0.162.194` final exact SHA 的权威发布门，因此本项不能标记为公开 release-ready。

### 14.21 命令面第二批兼容迁移

- 第二批只选择摘要明确声明为旧版或 in-memory governance 的 8 个入口：`bm25`、`ccron`、`compt`、`consol`、`fflag`、`pdfp`、`sganal`、`vcheck`。它们与既有 `dao`、`evomap` 一起进入虚拟 `lab` namespace；旧拼写不删除，继续路由到同一 lazy registrar，并从 `0.162.194` 起至少保留到 `0.164.0`，满足两个 minor release cycle 的兼容下限。
- 注册的 Commander 顶层图仍是 175 条、净增长 0；排除 10 条 deprecated compatibility entry 并加入虚拟 `lab` 后，推荐顶层面从 174 降到 166。manifest 是 lifecycle、namespace help、`help --all --json`、package README 以及 Bash/Zsh/Fish/PowerShell completion 的共同事实源；第二批不会新增 eagerly registered `lab` command，也不会污染 JSON stdout。
- 生成器的原生 ESM 扫描同时发现 `SlashCommandRegistry` 引用了 `doctor-status.js` 不存在的 `runDoctorChecks` export。现已改为公开的纯函数 `buildDoctorChecks` + `renderDoctor`，并给 `/doctor` handler 增加有效渲染回归；这避免 Vitest 转换层通过、但 release manifest generator 在原生 Node 导入阶段失败。命令生命周期、shell completion、slash registry、prompt registry、doctor 与 changelog 定向矩阵当前为 **8 files / 63 tests passed**；manifest/help-index/completion 三个生成物漂移门全部通过。完整 CLI 门和更多长尾迁移仍未完成。

### 14.22 `0.162.194` 首轮 exact-SHA 门禁与 PR 修复闭环

- 首轮候选 SHA `a8bead4f039d90be67a5efdf7f47bce467f4c8ee` 包含发布权限遏制、生产 REPL 交互接线、第二批 `lab` 迁移及同步文档。本地 clean-worktree 在真实 Web Panel 构建后完成 `npm pack`、immutable manifest create/verify 与 4 个 Web Panel asset 回读；tarball 为 `5,831,728` bytes、SHA-256 `1f04757d5223d227651cf70f4445b6175c95a44f7c40f643bafe9a66b2140d38`。这只是本地补充证据，不会越过远端门禁授权发布。
- 同 SHA 的 [CLI Strict Sandbox `30913987937`](https://github.com/chainlesschain/chainlesschain/actions/runs/30913987937) 与 [CLI Session Host Consistency `30913989204`](https://github.com/chainlesschain/chainlesschain/actions/runs/30913989204) 成功，但 [CLI CI `30913988771`](https://github.com/chainlesschain/chainlesschain/actions/runs/30913988771) 在 Ubuntu、Windows、macOS 的 unit shard 4/4 各失败 1 项。三份 JUnit artifact 指向同一确定性断言：第二批迁移已把 `recommendedTopLevelCommandCount` 从 174 降为 166，而 `lazy-dispatch` 漂移守卫仍硬编码 174。`f7c6d5cce6` 只同步该契约期望；`lazy-dispatch` 与 `command-lifecycle` 本地为 **2 files / 34 tests passed**，没有放宽 manifest 或命令生命周期策略。
- 同 SHA 的 [IDE Extensions `30913987997`](https://github.com/chainlesschain/chainlesschain/actions/runs/30913987997) 也失败：VS Code 的 macOS/Windows host gate 先被异步 host-version resolver 的未 `await` 单测阻断；JetBrains Windows 2025.2 则因插件请求 Java 17 toolchain、runner 只配置 Java 21 且没有 toolchain 下载源而在 Gradle 配置阶段失败。PR [#84](https://github.com/chainlesschain/chainlesschain/pull/84) 的 `68f9d871c2` 让 resolver 契约真实等待 Promise，将插件 Java/Kotlin 与 2024.2/2025.2 host matrix 统一到 Java 21，并在首个不可变 Marketplace upload 前同时预检 Open VSX 与 VS Marketplace 凭据，避免只发布一个渠道就消耗版本。Windows 本地 `compileUiTestJava buildPlugin`、workflow actionlint 与 VS Code runner **9/9** 通过。
- PR 的第一次 IDE 重跑 `30915928538` 通过上述单测后，进一步暴露 macOS stable VS Code 真实 host journey 的 profile 路径过长：GitHub runner 的 `/var/folders/...` 临时根叠加长目录名会超过 Darwin 主进程 Unix socket 路径预算。`bac4184427` 将 macOS 默认 host 根固定在短 `/tmp` 基线，并用短 `ccv-XXXXXX` 私有目录保持每次运行隔离，同时增加长度契约回归。包含 `f7c6d5cce6` 与该修复的 PR head 已触发新的 [CLI CI `30916359144`](https://github.com/chainlesschain/chainlesschain/actions/runs/30916359144) 和 [IDE Extensions `30916359029`](https://github.com/chainlesschain/chainlesschain/actions/runs/30916359029)；截至本节记录时矩阵仍在运行。
- 因此 `a8bead4f03` 明确为 **release NO-GO**，其 Strict/Session 成功与本地 tarball 不得沿用到更晚提交。PR 结果也只验证 PR exact SHA；合并后的最终候选还必须在同一精确 SHA 重新完成仓库要求的 `CLI CI`、`CLI Strict Sandbox` 全平台矩阵、受影响 IDE/Session/Background 组件门和专用 immutable tarball/SBOM 验证。没有这些终态前，不得创建 `v-npm-0-162-194` 或执行 npm publish。

### 14.23 PR exact-SHA 复验与 macOS host hang 收敛

- PR SHA `8d84ec6a7f71a8c49c731fdef1ac5a6c8b6f03c5` 的 [CLI CI `30917381845`](https://github.com/chainlesschain/chainlesschain/actions/runs/30917381845) 已完整成功：50 个主矩阵 job、Ubuntu/macOS/Windows 的 unit 4/4，以及三平台 `verify-cli` 均为 success。它证明 `f7c6d5cce6` 的 166 条推荐命令契约已经通过 PR exact-SHA 权威 CLI CI；但该 SHA 仍不是合并后的最终候选，也没有替代最终 SHA 必须重跑的 Strict Sandbox 与 immutable package/SBOM 门。
- 同 SHA 的 [IDE Extensions `30917382308`](https://github.com/chainlesschain/chainlesschain/actions/runs/30917382308) 中，VS Code Windows 真实 host gate、JetBrains 2024.2 与 2025.2 的 Windows/macOS/Ubuntu 六个平台组合，以及 JetBrains build gate 全部成功。唯一未闭环的是 `VS Code extension (macOS host gate)`：`macos-latest` 上 stable smoke 从 `2026-08-04 14:09:48 UTC` 一直没有退出，运行 36 分钟后于 `14:46:05 UTC` 被取消；随后 `always()` evidence upload 因证据目录尚未建立而失败。这不是测试断言失败，而是 Electron/test bootstrap 或退出链路无界等待；取消状态不能视为通过。
- `47c6afc550` 先将 macOS 真实 host job 从会滚动的 `macos-latest` 固定到 macOS 15，并修复 Unix 平台 checkpoint duplicate archive fixture 的权限确定性；`563d756581` 随后进一步使用 GitHub 明确提供的 x64 标签 `macos-15-intel`，以 workflow 契约测试锁定 Intel runner，避开当前 ARM host bootstrap hang。`fa983db9f5` 把 install/initial/restart 的 `--user-data-dir` 分离、共享同一已安装 extensions 目录，消除两次 Electron 启动复用 profile mutex 的耦合；VS Code CLI install/list 子进程上限为 120 秒，两个 macOS smoke step 各自上限为 15 分钟。
- host runner 现在会在不可变 journey evidence 目录的同级位置先创建独占 `*.progress.jsonl`，依次记录 install、list、download、initial、restart、assertions 与 evidence 阶段；即使 GitHub 在 step deadline 杀死进程，`if: always()` 上传路径也已有可定位卡点的文件。诊断日志发现同时覆盖三个隔离 profile。VS Code 扩展完整单测为 **34/34 passed**，其中 runner 定向为 **13/13 passed**；Prettier、workflow actionlint 与 `git diff --check` 通过。
- 上述 runner 固定、超时与诊断改动仍须以包含本节文档的最新 PR exact SHA 取得新的 IDE Extensions 结果。只有 macOS stable/minimum 两个真实 host journey、Windows host、JetBrains 全矩阵和 CLI 门在同一最终候选上成功，才可把 IDE 阻断标为闭环；在新结果产生前，状态继续为 **release NO-GO**，不得创建 `v-npm-0-162-194` 或发布 npm 包。

### 14.24 Intel host 证据定位与命令面第三批迁移

- 最新 PR SHA `e230bc83c096c20eac04ddca2db87f1e694d554f` 的 [IDE Extensions `30921980801`](https://github.com/chainlesschain/chainlesschain/actions/runs/30921980801) 已证明 `macos-15-intel` runner 能正常完成 checkout、Node setup、当时的扩展单测、VSIX 打包/metadata 校验及 host runtime 安装；VS Code Windows host gate 和已完成的 JetBrains host job 也成功。但 macOS stable smoke 进入真实 host journey 后仍未自行退出，并在运行 313 秒后随该 run 被取消；minimum journey 因此前置取消而 skipped，因此该 run 仍为失败证据而非通过证据。
- 本次 `vscode-macos-host-evidence` artifact 成功上传，`macos-stable.progress.jsonl` 精确停在 `initial_started`：install、list 与 exact host download 均已完成，没有进入 `initial_completed`。这证明前一批 progress journal/`always()` 上传修复有效，并把问题范围从下载、打包或 runner 架构进一步收窄到 initial `runTests` / CDP journey 的启动或退出边界。
- `4b5102a313` 让 `runTests` 与 CDP journey 并行结算：host 先失败时立即中止 CDP；CDP 先完成或报错时，先给 VS Code host 有界退出宽限，再通过 `@vscode/test-electron` 的 SIGINT 管理路径终止残留进程树。driver 同时输出进入、发现已安装 VSIX、激活完成和 bridge 验证等阶段，下一次远端失败不再只能依赖一个 `initial_started` 标记。本地 VS Code 扩展完整单测为 **36/36 passed**；真实 macOS stable/minimum journey 仍必须在新 exact SHA 复验。
- `56c87fa5d0` 完成命令面第三批兼容迁移，只选择 15 个实现源码明确声明为 in-memory V2 governance overlay 的内部缩写：`execbe`、`itbudget`、`mcpscaf`、`meminj`、`orchgov`、`promcomp`、`seshhook`、`seshsearch`、`seshtail`、`seshu`、`slotfill`、`svccont`、`tms`、`topiccls`、`uprof`。它们的 canonical spelling 统一为 `cc lab ...`，旧顶层拼写至少保留到 `0.164.0`；`todo`、`subagent`、`webfetch`、`planmode` 等产品入口被显式回归锁定为 active，不按摘要关键字机械迁移。
- 第三批不新增 eager `lab` 命令：Commander 注册图仍是 175、相对基线净增长 0，deprecated compatibility entry 从 10 增至 25，推荐顶层面从 166 降至 151。manifest、namespace help、package README、根 CHANGELOG/offline changelog 和 Bash/Zsh/Fish/PowerShell completion 已从同一 lifecycle policy 重生成。核心 lifecycle/lazy/completion 为 **3 files / 39 tests passed**；加入 command registration、changelog 与 docs drift 后为 **103 tests passed**，其中本机完整 eager graph 导入使用显式 30 秒测试预算而没有修改 CI 默认契约；三项生成物 drift check、Node syntax 与 `git diff --check` 通过。
- 这两批新提交及本节文档会形成新的 PR exact SHA，旧的 `e230bc83c0` IDE 取消结果和更早的 CLI 成功都不能授权它。新 SHA 仍须重新取得完整 CLI CI、CLI Strict Sandbox、IDE host matrix 与专用 immutable npm tarball/SBOM 证据；当前继续为 **release NO-GO**。

### 14.25 CDP 无 target 根因与 host launch 参数修复

- `4b5102a3136cdf42dc85f239f04099ca4cd94030` 的 [IDE Extensions `30923194189`](https://github.com/chainlesschain/chainlesschain/actions/runs/30923194189) 已把 macOS 失败从无界 hang 收敛成有界诊断：单测、VSIX 打包/校验与 runtime 安装成功，stable host 在约 157 秒后明确失败，evidence upload 成功，minimum host 因前置失败 skipped。VS Code Windows host 与当时已完成的 JetBrains jobs 成功，但整个 run 尚有并行 JetBrains job 在执行，不能写成全矩阵成功。
- artifact 中的 `initial-host-ready.json` 证明测试 driver 已加载到正确的已安装 `chainlesschain.chainlesschain-ide@0.37.40` 和隔离 workspace；extension log 证明主扩展已激活、IDE bridge 已在 loopback 启动。真正失败点是 `cdp-journey.jsonl` 的 `targets=[]`：remote-debugging port 在 120 秒窗口内始终没有暴露任何 target，因此不是 VSIX 缺失、扩展未激活或 bridge 未启动。
- 根因是旧 `buildHostLaunchArgs()` 把 workspace positional argument 放在所有 VS Code switches 之前；该顺序在 Windows host 偶然可用，但 macOS CLI 没有按预期应用其后的 remote-debugging switches。`86c936d0d9` 将 profile/CDP/telemetry/crash switches 全部放在前面，显式加入 `--new-window`，并把 workspace 放到 argv 最后；回归锁定精确顺序。本地 VS Code 扩展完整单测仍为 **36/36 passed**，适用文件 Prettier check 通过。
- 该 PR artifact 的 `releaseCommit` 是 Actions checkout 的合并候选 `38e6b92d4c0e766b33fffd66c8d1c42e60e367e3`，而 workflow metadata 的 `head_sha` 是 `4b5102a313...`。因此这些 PR host 结果只能证明对应合并候选/分支上下文，不能冒充最终 main 或 release tag exact SHA；文档中“PR exact SHA”均应按这一限制理解。
- 最新分支 head `86c936d0d93f2cb91a11194694d7a459cc605fe7` 已触发 [IDE Extensions `30924118914`](https://github.com/chainlesschain/chainlesschain/actions/runs/30924118914) 与 [CLI CI `30924121034`](https://github.com/chainlesschain/chainlesschain/actions/runs/30924121034)。前者必须证明 macOS stable 与 minimum 均获得非空 CDP targets、完成 initial/restart 控制旅程并正常结算；后者还必须验证第三批 151 条推荐命令面。两者当前均在队列中，发布状态仍是 **NO-GO**。

### 14.26 Chromium browser WebSocket 卡点与无效绕行排除

- 后续 macOS artifact 证明上一节的 argv 顺序修复有效：VS Code 已公开 `/json/version`、带 GUID 的 `ws://127.0.0.1:<port>/devtools/browser/<id>` browser endpoint，已安装 VSIX、扩展激活、IDE bridge 与聊天 WebView 也都就绪。新的唯一卡点是对该 loopback browser endpoint 的 HTTP Upgrade 一直不完成，最终稳定报 `Opening handshake has timed out`；Windows 的同一 DOM journey 继续成功。因此“没有 CDP target”已关闭，但“macOS 签名宿主拒绝外部 browser WebSocket”成为新的 release blocker。
- Playwright Electron 路径没有形成独立解法：其启动流程仍会先连接 Electron Node Inspector，再连接同一个 Chromium remote-debugging browser WebSocket，因而最终停在相同的 browser 握手边界。`--remote-debugging-pipe` 的 FD 3/4、NUL framing 方案也未取得 `Target.getTargets` 响应；这两条路径不能因为进程已启动或端点已打印就记为真实 DOM 通过。
- 三项权限/网络假设均被真实 `macos-15-intel` 结果否定：`7d22ebe9df` 加入 DevTools approval bypass 后的 run `30934906577` 未闭环；`96d9451b4f` 在 0.21 秒内成功完成 app firewall authorization，但 [IDE Extensions `30935600378`](https://github.com/chainlesschain/chainlesschain/actions/runs/30935600378) 仍在相同 browser WebSocket 握手处失败；显式 loopback Origin 也没有改变结果。端点带 GUID 且 `/json` 可读，不符合 Chromium approval-only 模式；Origin 拒绝按协议应快速返回 403，而不是无响应超时，因此不再继续扩大防火墙、approval 或 Origin 权限。
- `96d9451b4f` 的同 SHA [CLI CI `30935600421`](https://github.com/chainlesschain/chainlesschain/actions/runs/30935600421) 成功，Windows VS Code host 与已完成的 JetBrains matrix 也成功，但 macOS stable 失败、minimum skipped，故这些部分成功不能授权 IDE 或 npm 发布。此阶段仍是 **release NO-GO**。

### 14.27 Electron Inspector 诊断、限时扫描与 WebView relay

- `0ba35631cc` 改用 Electron 主进程 Node Inspector，直接通过 `electron.webContents` 访问真实 WebView DOM，避开 Chromium browser WebSocket。[IDE Extensions `30939965540`](https://github.com/chainlesschain/chainlesschain/actions/runs/30939965540) 的 macOS 日志确认 `Debugger listening` 与 `Debugger attached` 均成功，但连接后精确 15 秒仍未进入 DOM scan，随后 Inspector 结束并由 host runner 有界终止。该证据把问题进一步收敛到 Inspector command，而不是 socket 建连；`d152668e86` 最终确认 `Runtime.enable` 在 VS Code 1.131 macOS Electron 主进程接受连接后不结算，并将其移除，因为后续 `Runtime.evaluate` 不依赖该命令。
- `32498ddb7d` 同时硬化保留的 Inspector 路径：所有 `webContents` 并行探测，每个 `executeJavaScript` 最多等待 1.5 秒，避免一个无关窗口吃满 CDP command 的 15 秒总预算；新增回归用永久 pending 的窗口证明聊天 WebView 仍可被发现。该提交本地 runner/workflow 定向为 **31/31 passed**，Prettier 与 `git diff --check` 通过；其 [IDE run `30940776808`](https://github.com/chainlesschain/chainlesschain/actions/runs/30940776808) 在 macOS stable 执行中被后续提交自动取消，取消不能冒充通过。
- `81915ce162` 将 macOS 正式门禁切换为 VS Code 自己的 WebView message boundary：每次 host 启动生成随机 256 位 token，只有 token 存在时才注册内部命令并把 token 注入该次聊天 WebView；请求只接受 `snapshot`、`send` 和固定目标 `click` 三类语义动作，使用 request ID 关联响应并有界超时。正常产品启动不含 token，因此 relay 不注册、HTML 侧保持 inert；测试仍驱动安装后的 VSIX、真实 Extension Host、真实 WebView DOM、fixture CLI、initial/restart 两次隔离 profile，并生成与原 journey 兼容的 trace、snapshot 与 fail-closed evidence。
- `d152668e863883a81cfafb129d3cee5cf593ddd5` 的独立本地复验为 VS Code 扩展单测 **54/54 passed**，其中覆盖 token mismatch、非法 action/target、无 token inert、响应关联、真实 phase ledger/snapshot、Inspector stalled probe 与 workflow contract；适用文件 Prettier、workflow actionlint、`git diff --check` 全部通过。[IDE Extensions `30941235587`](https://github.com/chainlesschain/chainlesschain/actions/runs/30941235587) 中 Windows stable/minimum 成功，已完成的 JetBrains 2024.2/2025.2 jobs 也成功，但 macOS stable 在 8 分钟后被主动取消以提前取证，minimum skipped。artifact 只保留到 `initial_started`；作业日志显示测试 driver 已被扫描，却始终没有输出首行 `driver entered`，说明 relay 语义尚未开始，卡点是 macOS `extensionTestsPath` bootstrap。
- `05555dddea` 首先为 relay host 保留随机 loopback-only Chromium 启动开关，`ed0ae0d0d8` 又尝试让测试 driver 通过 `*` activation 与 `extensionTestsPath` 共用 `runOnce()`；但 [IDE Extensions `30943191758`](https://github.com/chainlesschain/chainlesschain/actions/runs/30943191758) 的真实日志已否定这两项假设：`DevTools listening` 正常，driver 被扫描为 development/local/my extension，却仍无 `driver entered`，startup activation 也没有执行机会。该 run 在约 3 分 40 秒主动取消，stable/minimum 均未通过；不过 Windows stable/minimum 已成功，提前创建的 progress artifact 再次证明停在 `initial_started`。
- `d3c700f990` 撤销无效的 wildcard activation，并把 bootstrap 改为随机 loopback Electron `--inspect` 开关；但 [IDE Extensions `30944031856`](https://github.com/chainlesschain/chainlesschain/actions/runs/30944031856) 再次证明“Inspector + `--folder-uri`”仍不够：driver 继续只被扫描、不进入，stable 被主动取消，minimum skipped。`caedb61369` 又证明过早 attach 只会产生 `Debugger attached`，依然没有 driver trace。提前建立 artifact 目录及 installed VSIX、activation、command、bridge 四个里程碑继续保留。更新后的本地扩展单测仍为 **54/54 passed**，Prettier 与 `git diff --check` 通过；远端 macOS stable/minimum 未通过，当前仍为 **release NO-GO**。

### 14.28 macOS `extensionTestsPath` 阻断定界与发布结论

- 重新读取 [IDE Extensions `30939965540`](https://github.com/chainlesschain/chainlesschain/actions/runs/30939965540) 的原始 macOS job 日志后，纠正上一轮对 `0ba35631cc` 的记忆性误判：该 run 从未输出 `driver entered`。它在扫描出 `chainlesschain-extension-host-smoke-driver` 后连接主进程 Inspector，并因 `Runtime.enable` 超时进入有界终止；期间出现的 ChainlessChain IDE 日志来自已安装产品扩展的 startup activation，不是测试 runner 已执行的证据。因此不存在一个“macOS driver 已进入”的已知参数基线。
- `95e9ef8edd` 进一步覆盖了“随机 loopback `--inspect` + positional workspace + 不连接 Inspector”的剩余组合。[IDE Extensions `30946343303`](https://github.com/chainlesschain/chainlesschain/actions/runs/30946343303) 的 stable smoke 从 `2026-08-04 20:09:43 UTC` 运行到约 4 分 26 秒后主动取消；日志只有 `Debugger listening` 和 development/local/my extension 扫描，没有 `Debugger attached`、`driver entered` 或 driver trace，artifact 仍精确停在 `initial_started`，minimum skipped。该结果与 `--folder-uri`、提前 attach、wildcard activation、Chromium CDP 和 Electron Inspector 等前序失败共同把阻断定界为：VS Code 1.131 / `@vscode/test-electron` 3.1.0 在 `macos-15-intel` 上识别了 development extension，却没有调用 `--extensionTestsPath` 指定的 runner。
- 在没有更强证据前，不再继续排列组合 Inspector、firewall、Origin、workspace 参数或 activation event。下一技术前置是把上述现象缩成不含产品扩展的最小 `@vscode/test-electron` macOS reproducer，并据此确认上游缺陷、可接受的 host pin 或修复版本；若改用 Extension Host 自身 Inspector 直接启动 runner，则必须先单独评审 loopback 隔离、固定表达式边界、超时和 artifact 完整性，不能把诊断通道直接升级为发布权威通道。
- 当前分支本地 VS Code 扩展单测为 **54/54 passed**，适用文件 Prettier、workflow actionlint、Node 语法与 `git diff --check` 通过；这些只属于补充证据。远端 macOS stable/minimum 未通过，latest exact SHA 的 CLI Strict Sandbox 也因当前 `gh` 凭据对 workflow dispatch 返回 `HTTP 401` 而没有形成权威矩阵，immutable npm tarball/SBOM 发布门同样未完成。最终结论是 **release NO-GO**：不得创建 `v-npm-0-162-194`、不得发布 CLI npm 包，也不得把任何取消 run 或其他 SHA 的局部成功沿用为授权。

### 14.29 固定命令回退实机取证与新阻断边界

- `350ef5601e15e63051a67ce5e1bf810d4fa24e38` 增加 token-gated 固定命令 `chainlesschainTests.runHostJourney`：只有本次 host journey 持有有效随机 token 时，已安装的产品扩展才会调度测试 driver；正常产品启动没有 token，路径保持 inert。driver 以 `runOnce()` 保证至多执行一次，host runner 则以结构化 result file 结算 relay，并在 relay 终态后执行有界 shutdown。该变更绕过了 macOS 上未调用 `extensionTestsPath` runner 的 bootstrap 缺陷，但没有把诊断入口暴露为普通产品能力。
- 本地补充证据为 VS Code 扩展完整单测 **55/55 passed**、真实 activation wiring **7/7 passed**，适用的 10 个文件 Prettier、Node 语法与 `git diff --check` 通过。上述结果验证的是回退接线、无 token inert、固定命令契约与 run-once 行为，仍不能替代真实宿主或发布门。
- 同 SHA 的 [IDE Extensions `30947671847`](https://github.com/chainlesschain/chainlesschain/actions/runs/30947671847) 首次给出了 driver 已实际执行的结构化证据。`macos-stable.progress.jsonl` 从 `prepared`、安装和下载推进到 `initial_started`，最终记录 `journey_failed` 与 evidence 完成；driver trace 依次通过 `installed-vsix-discovered`、`vsix-activated`、`commands-verified`（17 个命令）和 `bridge-verified`。因此 14.28 所述 `extensionTestsPath` bootstrap 仍是上游行为缺陷，但已不再是当前回退路径的直接阻断。
- 新的唯一已证实 macOS stable 失败点是聊天 Webview relay 就绪：driver 在真实 `smoke.cjs` 调用栈中运行，45 秒内持续得到 `chat webview DOM is not ready`，最终以 `chat webview relay did not become true within 45000ms` 失败。日志同时记录 UI protocol 2 probe 超时和 Webview 重建。该结果证明目标发现、产品扩展激活、命令面与 IDE bridge 均已跨过，不能据此声称真实聊天 DOM journey 已通过。
- macOS stable 失败后，minimum 被前置条件跳过；为提取失败工件而取消整个 workflow 后，其余被取消 job 不构成功能失败或成功证据。Windows stable 在取消前成功，但不能替代 macOS stable/minimum，也不能沿用到包含本节文档的后续 SHA。`350ef5601e` 的 [CLI CI `30947673915`](https://github.com/chainlesschain/chainlesschain/actions/runs/30947673915) 截至本次取证仍为 queued；CLI Strict Sandbox 仍因当前 GitHub CLI 凭据无效而无法 dispatch。

### 14.30 macOS Webview 阻断复核与候选版本前进

- `c9d46b4a7a` 的 macOS evidence 将状态细化为 `view=true/visible=true/ready=false/protocol=false`；`521c35a77a` 去除 Inspector 后的 IDE run `30958675402` 仍在同一边界失败，说明 debugger bootstrap 与后台渲染开关不是直接根因。`7f323aa188` 再前台激活外层 `.app` 并等待真实 Chat focus，`54db9c8ff7` 把无响应探针的单次重建宽限从 750ms 调整为 5 秒；对应 macOS jobs 仍未收到任何 ready/protocol 消息。已排除范围因此扩展到视图隐藏、Inspector 干扰、应用未激活、focus 未落定和 750ms 冷启动误判，但不能据此把 hosted runner/VS Code Webview renderer 的上游限制写成已确认结论。
- VS Code candidate 已从 `0.37.40` 前进到 `0.37.41`；本地扩展单测 **58/58**、协议专项 **8/8**、VSIX self-test **11/11**、包元数据 **18/18** 通过。`54db9c8ff7` 的 Workspace Publish Staleness Check `30959722765` 成功；同 SHA 的 IDE workflow `30959722716` 中 macOS stable job `92160841699` 失败且 minimum 跳过，其他在途 job 不计通过。
- 权威 CLI 证据不能跨 SHA 拼接：`9327ea0ad2` 的 CLI CI `30948439064` 成功；`7f323aa188` 的 CLI Strict Sandbox `30959399318` 成功，但同 SHA CLI CI cancelled 且 IDE macOS 门失败。`54db9c8ff7` 已重新触发 CLI CI 与 Strict Sandbox，只有其最终结果可描述该实现提交；后续文档提交仍会形成新的 SHA，不能直接继承发布授权。
- `61f8235105` 停止对 token-gated fresh Webview 做无消息超时重建，并让 minimum 在 stable 失败后继续运行；本地扩展单测 **59/59**、协议专项 **8/8** 通过。IDE run `30960237759` 中 current stable `1.131.0` 仍因 relay 45 秒未 ready 失败；minimum `1.85.2` 首次完整通过 initial 的 stream/retry/plan/permission/interrupt 与 restart-resume，evidence 为 `result=passed`、`evidenceComplete=true`、15 个 artifact。Windows host 同 SHA 成功，CLI Strict Sandbox `30960275491` 三 OS 成功，CLI CI `30960238100` 后来被后续提交取消；阻断现已精确为 current stable 路径，不再是“macOS minimum 未运行”或 relay 在所有 macOS host 上不可用。
- `2bad1d4c94` 只给隔离的 macOS real-DOM host 增加 `--disable-gpu` 软件渲染与 `--verbose` renderer/service-worker 诊断；IDE run `30960717723` 证明 current stable 仍失败，而 minimum、Windows、JetBrains 六格与 build 成功。已结算候选 SHA `f72dc01c4f` 的 CLI CI `30960881488` 和 CLI Strict Sandbox `30960888570` 同 SHA 成功；IDE Extensions `30960881338` 再次得到相同宿主边界：macOS current stable job `92164590186` 失败、minimum 成功，最终 VSIX package/publish job `92165638115` 跳过。软件渲染实验已结算，不能关闭 stable 门。
- `b86ea54468` 的 IDE run `30964554075` 证明固定 stable `1.130.0` 仍失败、minimum `1.85.2` 再次完整通过，因此不采用 host pin。`5860747f0a` 恢复 current stable 门、删除 `--disable-gpu`，并加入 VS Code 自动化使用的 `--use-inmemory-secretstorage`，避免 fresh macOS CI profile 在 Webview 启动前阻塞于无界面的 Keychain。
- 已结算候选 `fb39e2cbe6` 的 IDE Extensions `30965289911` 整体成功：Windows/macOS/Linux stable + minimum、JetBrains 2024.2/2025.2 × 三 OS 六格、VSIX package/artifact 及 JetBrains build/compatibility 全部通过；macOS `1.131.0` 与 `1.85.2` evidence 均为 `result=passed`、`evidenceComplete=true`、15 个 artifact。CLI CI `30965290031`、CLI Strict Sandbox `30965296663` 与 staleness gate `30965289905` 同 SHA 成功。本轮 required local-host gate 已关闭，但 PR publish/readback 按条件跳过。
- 在没有形成新的发布授权时，GitHub tag `v-npm-0-162-194` 随后被创建并指向 `fb39e2cbe6`。正式 npm workflow `30966796114` 的 `exact-sha-gate` 成功，但 `test` job 在 Agent SDK build 中因 `packages/agent-sdk/node_modules/.bin/tsc` 缺失而失败，`dry-run`、`package-cli` 与 `publish` 全部跳过。registry 仍为 `chainlesschain@0.162.193`、`gitHead=e8e7ba274b487ed491c04ec3359841a0e545debb`。该失败 tag 不移动、不删除、不复用；若修复后继续发布，版本与 tag 必须前进。

## 15. 2026-08-05 `0.162.194` 失败快照与当时剩余行动（历史）

| 判定对象                         | 当前状态                      | 权威边界                                                                                                         |
| -------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 差距分析、优先级与实施路线       | **文档收口**                  | 第 1～13 节保留 2026-08-01 历史基线，第 14 节按时间记录实现、审计与 exact-SHA 证据；两者不得混读                 |
| CLI/Session/installer 等仓库实现 | **分项完成、产品验收未完成**  | 只承认顶部状态表和第 14 节为各切片声明的范围；组件测试、旧 SHA 或单门成功不得外推                                |
| VS Code macOS host journey       | **required 双门已通过**       | `fb39e2cbe6` 的 current stable `1.131.0` 与 minimum `1.85.2` 真实 DOM initial/restart journey 及 evidence 均通过 |
| `0.162.194` release candidate    | **tag 已消耗、未发布、NO-GO** | required gates 成功，但正式 workflow 的 Agent SDK test 失败，immutable tarball/SBOM 与 publish 均未执行          |
| tag、npm publish 与公开渠道激活  | **标签已存在，publish 失败**  | `v-npm-0-162-194` 固定指向 `fb39e2cbe6`；不得移动、删除、复用或直接重跑 publish，npm `latest` 仍为 `0.162.193`   |

后续只按以下顺序推进，任一步失败都保持 NO-GO：

1. 保持失败的 `v-npm-0-162-194` 不变；修复 Agent SDK 依赖安装/构建门后，把 package version、changelog 与后续 tag 身份前进到新版本。
2. 在新版本 final exact SHA 重跑 Windows/macOS/Linux VS Code、JetBrains required matrix、`CLI CI`、`CLI Strict Sandbox` 与所有受影响组件门；取消、跳过和部分矩阵不计通过。
3. 保留 macOS current stable + minimum 的真实 DOM initial/restart journey，不重新引入失败的旧 host pin，也不把激活级检查降格替代 DOM evidence。
4. 生成并验证绑定 exact SHA 的 immutable npm tarball、SBOM、签名、安装、升级、回滚与公开渠道回读。
5. 继续完成不阻塞本次文档收口、但仍阻塞对应产品级声明的真实长会话/1 GiB、kill/restart、fsync/断电、恶意 writer/MCP、跨架构和长期 soak 验收。

因此，本文件可以作为当前差距分析与实施路线的收口版本；这只表示分析、证据边界和剩余行动已经明确，**不表示产品实现全部完成，也不构成任何发布授权**。

## 16. 2026-08-05 `0.162.197` 发布闭环与当前未完成项

本节取代第 15 节的“当前”判定；第 15 节继续保留 `0.162.194` 失败 tag 的历史证据，不得据此把已经完成的 npm 子范围重新判为 NO-GO，也不得把 npm 成功外推到 native、ARM64 或长期可靠性范围。

### 16.1 已关闭的 `0.162.194` 后续行动

| 原行动                                            | 当前判定                 | 权威证据                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 修复 Agent SDK 安装/构建门并前进版本身份          | **已完成**               | `9350e8c948` 修复 workspace publish，失败 tag `v-npm-0-162-194` 保持不可变；候选依次前进并最终使用 `v-npm-0-162-197` / `a03ad1b548cc6f15c9bef8f82d519e9c625eef8d`                                                                                                                                                                                                                                                                                |
| final exact SHA 的 CLI/Strict/IDE required matrix | **已完成**               | `a03ad1b548` 的 [CLI CI `30978007430`](https://github.com/chainlesschain/chainlesschain/actions/runs/30978007430)、[CLI Strict Sandbox `30978007359`](https://github.com/chainlesschain/chainlesschain/actions/runs/30978007359) 与 [IDE Extensions `30978007086`](https://github.com/chainlesschain/chainlesschain/actions/runs/30978007086) 均成功；IDE 门覆盖 VS Code stable/minimum × Windows/macOS/Linux 与 JetBrains 2024.2/2025.2 × 三 OS |
| 保留 macOS stable + minimum 真实 DOM journey      | **已完成**               | 上述 IDE run 在发布 SHA 上成功，未采用失败的旧 host pin；更早 `fb39e2cbe6` 的 required local-host matrix 也已给出完整 evidence                                                                                                                                                                                                                                                                                                                   |
| immutable tarball、SBOM、npm publish 与公网回读   | **CLI npm 子范围已完成** | [npm workflow `30979565206`](https://github.com/chainlesschain/chainlesschain/actions/runs/30979565206) 的 exact-SHA gate、测试、package、SBOM 与 publish 成功；[readback `30983536627`](https://github.com/chainlesschain/chainlesschain/actions/runs/30983536627) 验证 npm 签名/SLSA、精确 repo/workflow/tag/SHA、原始不可变 artifact 与 registry tarball 逐字节一致。npm 公网 `latest` 为 `chainlesschain@0.162.197`                          |

因此 P0-3 的 **CLI npm exact-SHA 交付链为 GO**。该结论只覆盖 npm CLI，不授权 Microsoft Marketplace、Desktop/native installer、Homebrew/WinGet 或其他公开渠道。

### 16.2 P0-5 / P1-6 冷进程长会话 SLO 增量

当前变更集把既有 `CLI Session Scale` 从 `canonical-store-hot-process` 证据扩展为完整 CLI 冷进程证据：

- `session show` 的 canonical JSONL 只读路径使用独立 registrar，不再为只读恢复静态加载 Session DB、Process Broker、observability 与 Event Runtime；legacy DB 缺失回退仍按需动态加载，语义未删除。
- PR link 的只读 ledger 与可能启动 `git`/`gh` 的写侧模块分离，冷恢复只读取有界 JSON 文件。
- 每个冷样本都启动新的 `packages/cli/bin/chainlesschain.js session show <id> --json` 进程；计时包含 Node 启动、phase-0 dispatch、Commander、模块加载与 canonical resume。子进程在退出时独立记录峰值 RSS，formal profile 固定不少于 15 个冷进程样本，不能通过环境变量缩减。
- 1 GiB fixture 由 production hasher 构造完整有效链，并在计时前通过 production metadata builder 建立、复核 `last_hash` / `event_count` sidecar。缺少该 sidecar 的 synthetic/legacy transcript 会触发一次 O(N) index rebuild，不得混入正常 indexed-session SLO，也不得把后续缓存样本冒充首次正常恢复。

本地 Windows x64 补充证据（非发布授权）：1,073,741,824 字节完整链和 production sidecar 均 verified；canonical hot resume p95 `1.79 ms`、峰值 RSS `49.49 MiB`、最大读取 `65,537` 字节；5 个完整 CLI 冷进程 p95 `854.76 ms`、峰值 RSS `59.50 MiB`，均满足 `<2 s` / `<100 MiB`。冷路径、1 GiB gate contract、PR ledger、Session eager/lazy、参数校验、legacy fallback 与 usage attribution 相邻矩阵串行复验 **64/64 passed**；较小默认超时下的并行扩大运行只出现资源竞争型 timeout，逐文件复跑没有断言失败。

实现提交 `f99f18e4cb3832b8848534186ba32756e98c66c9` 又以 clean tracked worktree 运行 Windows x64 **formal** profile，`expectedSha` / `exactSha` 均精确命中该提交，gate source list 无漂移。564.72 秒的完整运行得到：20 个 writer × 1,000 次 append 共 `20,000/20,000` 唯一事件且链 verified；10,000 sessions indexed list p95 `132.94 ms`、峰值 RSS `54.03 MiB`；1 GiB hot resume p95 `2.21 ms`、峰值 RSS `49.54 MiB`、最大读取 `65,537` 字节；15 个完整 CLI 冷进程 p95 `990.41 ms`、峰值 RSS `60.14 MiB`；8 次真实进程强杀（6 次 partial append、2 次 pipeline）及 344 个 exhaustive partial-record cuts 均零失败。结果文件记录 tree `82bfb6c040ec0fcf3d718448567552b8ec19a93c` 和空 violations。

因此 Windows x64 本地 formal 子格已补齐，但 Ubuntu、macOS 以及 GitHub-hosted Windows exact-SHA artifact 尚未形成，**P0-5/P1-6 冷进程 SLO 仍是 NO-GO**。只有该实现提交在 `.github/workflows/cli-session-scale.yml` 三平台 formal job 全部成功并上传 exact-SHA artifact 后，才可关闭这一子项；本地 formal 成功不能替代权威矩阵。

### 16.3 P1 命令生命周期 telemetry 增量

当前增量为 25 个 migrated compatibility command 接入真实命令入口的 opt-in OTLP 指标：

- phase-0 只从受信 manifest 解析 canonical command 与 `legacy` / `replacement` route；嵌套命令、选项、参数、workspace、session 和内容均不进入 telemetry。
- 仅在用户显式配置 OTLP Collector 时发送 `chainlesschain.cli.command.lifecycle.invocations` 与 `chainlesschain.cli.command.lifecycle.duration`；属性限定为 canonical command、route、完成/错误结果、CLI version、`deprecatedSince` 和 `removalNotBefore`。Collector/queue 失败保持 best-effort，不改变命令结果。
- help、version、active command 和无效 namespace 不计作 migrated command 执行；legacy stderr warning 与 `lab` rewrite 语义不变，也没有删除任何兼容入口。

本地验证覆盖 lifecycle policy/路由与无参数投影、OTLP exporter 边界、真实 HTTP Collector 的 legacy + replacement 双路由，以及相邻 lazy dispatch，共 **50/50 passed**；真实 Collector payload 断言不含被执行的 nested command 参数。

该增量只建立可观测性，不能伪造尚未发生的使用周期。必须在包含该接线的发布版本上积累至少两个 minor release cycle 的代表性数据，明确 collector 覆盖/偏差，并按 command 比较 legacy 与 replacement 用量后，才能逐项决定是否移除 alias；因此 **P1 lifecycle telemetry 接线完成，alias removal 仍为 NO-GO**。

### 16.4 Session Host 对抗性本地证据

clean implementation SHA `5a7bc85f9f91a5d92908f8aebd99437e63b535bb` 在 Windows x64 运行 `CLI Session Host Consistency`，`expectedSha` / `exactSha` 与 tracked gate source list 均精确匹配，tree 为 `f0f603a6e0e94a0546cc6c04e685587251ea818b`。有效复跑 67.58 秒、violations 为空，六个场景全部通过：

- REPL、headless、authenticated background attach、WebSocket 与独立 rebuild 使用同一 verified revision/head/MCP recovery authority；branch/fork provenance、atomic WS turn、CAS retry 与 restart 后 role 交替保持一致。
- 两个真实子进程竞争同一 request id 时只有一个 durable claim、一次 model/tool execution 和一个 settlement；claim owner 以真实进程退出后，同 request 不自动接管并返回 pending，新 request id 可继续但不伪造旧 claim 的裁决。
- 在 model 执行期间，非协作同 UID writer 同时伪造 transcript settlement 和 sidecar head；合法 handler 不返回伪造响应，settlement 标为 outcome-unknown，随后同 request 重试在 model/tool 前以 `SESSION_TRANSCRIPT_UNVERIFIED` 拒绝。
- 另一 transcript interior tamper 在 REPL commit、headless/stream bootstrap/hooks/MCP/model、配置写、background attach 与 WebSocket resume 之前全部拒绝，公开证据不含原始会话内容。

一次较早的本机运行跨越宿主暂停，虽然最终断言通过但 wall-clock 约 65 分钟并触发外层超时，已排除为无效性能证据；上述 67.58 秒 clean rerun 才是本节采用的结果。该门本身明确只证明 host-adapter conformance + per-request WS fencing：它没有通用跨进程 session-host lease、独立 anti-rollback anchor、fsync/断电/remote-host 证明，也未覆盖恶意 MCP/Skill、即时撤权或磁盘/pipe 故障。因此该切片仍须三平台 exact-SHA artifact，完整 Session/Skill/MCP 安全项继续 **NO-GO**。

### 16.5 MCP 裁决后的旧宿主写栅栏增量

实现提交 `a3a15f5cfb01f02e8a61e4774c63e50f363c9abf` 为所有生产 MCP ledger sink 增加 recovery-generation fence：

- canonical JSONL store 新增同一 writer lock 内的“完整 verified projection → 校验 → authority append”原子路径，消除先读 recovery、再追加 started/settled 之间的竞态。REPL、普通 headless、stream、Cowork 与 WebSocket 都在建立持久 MCP runtime 时绑定已验证 recovery；WebSocket 只有在 verified recovery revision 前进后才替换 fence。
- fence 只绑定 session、integrity incidents、人工 adjudications 与 exact replay denies；普通 transcript 消息、head 变化、当前宿主自己的 started/settled 和由它产生的 unsettled 不旋转 fence。因此同一代宿主可正常完成调用，而裁决或新的完整性事件会使旧代宿主在下一次 ledger write 前以 `CC_MCP_LEDGER_HOST_FENCE_STALE` 失败。
- 真实 store 回归先由旧宿主持久化 write prewrite，再执行 `confirmed_not_applied` 裁决；旧 ticket 的 settlement 和旧宿主的下一次 write prewrite 都被拒绝，transcript 中旧 ledger 仍只有一个 started event。重新读取 verified authority 后建立的新宿主可完整持久化 started + completed。公开与内部 adjudication projection 的 fence 输入归一为相同最小字段，避免 resume surface 不同造成误拒绝。

目标矩阵最终为 **10 个相关测试文件 / 422 个唯一测试通过**；Node 语法、Prettier、`git diff --check` 通过，目标 ESLint 为 0 error（只报告既有 warning）。随后在 clean tracked worktree 对实现 SHA 运行 Windows x64 formal `CLI Session Host Consistency`：`expectedSha` / `exactSha` 均为 `a3a15f5cfb01f02e8a61e4774c63e50f363c9abf`，tree 为 `fe428d5e03443b756ce925bb2237f0ff2c206e4c`，90.03 秒内七个场景全部通过、violations 为空、`gateSourcePathsExact=true`。新增 `mcpRecoveryHostFence` 场景用 8.32 秒证明 stale settlement/prewrite 均拒绝且 resumed host 完成。

该增量关闭的是**遵守 production sink 的 MCP 宿主在 authority 旋转后的下一次持久写边界**，不是 machine-wide process lease：已经完成 prewrite、正在外部执行的旧调用不会被瞬时中断，其结果仍必须按 outcome-unknown/人工裁决处理；恶意同 UID 代码仍可绕过 sink，通用 session host、Skill、非 MCP side effect 也不受此 fence 直接约束。它同样不提供独立 anti-rollback anchor、fsync/断电、三平台或长期 soak 证明。因此 scoped MCP old-host fencing 本地已完成，但完整 Session/Skill/MCP 产品项仍为 **NO-GO**。

### 16.6 Canonical transcript 外部丢失与恢复冲突失败关闭增量

实现提交 `b53671b260a7f0970c101a30f3ac28d2e9fa5f47` 关闭了一个更窄但可生产触发的故障窗口：canonical `.jsonl` 被外部删除、而其 per-session meta 仍存活时，旧实现可能把同一 ID 静默当作新 genesis，或让命令回退到 stale legacy history。提交 `311396d6497e5ce885a1e5e53575cfcca6ec4897` 又修正 latest resolution 的毫秒级并列反例：健康旧会话与 missing/conflict 同时刻时，先选择 damaged candidate 失败关闭，只在同风险级内按 ID 破平。

- store 现在区分 `absent`、`present`、`missing-transcript`、`tombstoned` 与 `conflict`。普通 append、`session_start`、verified projection、raw compatibility read/rebuild、repair、强制 migration 与显式 resume 都不能把 surviving live witness 解释成空会话；只有显式 delete 先提交 tombstone，随后显式 `session_start` 才能建立新的 verified genesis。
- delete 在 meta 之外先提交 owner-only `<id>.tombstone` namespace witness。它让 `--continue` 无须读取每一个 live sidecar，就能在 disposable activity journal 被删除、全坏或只剩合法旧前缀时发现“tombstone 后恢复旧 transcript”的 conflict。普通 tombstone/absent 不会被 stale pre-delete journal 复活；conflict-only 连续 list 不会反复重建或无限扩张 journal。
- exact-ID command fallback、普通 headless resume、persist-only headless、stream、REPL admission、authenticated background attach 与 WebSocket resume 均在 config/bootstrap/hooks/MCP/model/tool 或状态 commit 前拒绝 damaged authority；`session tail` 在启动和每次 poll 前重新检查 presence，doctor 将 missing/conflict 与 tamper 一样报告为完整性错误。公开失败 snapshot 只含稳定错误码、摘要与空消息，不复制 transcript 内容。
- `getLastSessionId()` 同时合并 indexed live candidate、sidecar-only missing candidate 与 marker-backed conflict candidate；相同 `updated_at_ms` 时 `missing/conflict` 优先于 healthy session。正式 fixture 固定同一毫秒，并故意让 conflict ID 的字典序小于 healthy ID，避免测试靠 ID 偶然通过。

本地回归包括 canonical store **107/107**、headless runner + session list index **75/75**、session tail **9/9**、新增 doctor 完整性用例 **1/1**，以及 Session Host gate test **5/5**；Node 语法、Prettier 与 `git diff --check` 均通过。随后在 clean tracked worktree 对最终实现 SHA `311396d6497e5ce885a1e5e53575cfcca6ec4897` 运行 Windows x64 / Node `22.22.2` exact-SHA 门禁：

- `CLI Session Host Consistency` 的 `expectedSha` / `exactSha` 均命中最终提交，tree 为 `b2ceb8c14869171c7eefd1a395814dea1025de5f`，84.83 秒内九个场景全部通过、violations 为空、`gateSourcePathsExact=true`、`trackedWorktreeDirty=false`。新增 `restoredTranscriptConflictRefusal` 同时证明 parseable stale journal、同毫秒风险并列、REPL、`--continue`、persist-only、stream、background attach 与 WebSocket 的副作用前拒绝。
- 同一 SHA 的 `CLI Session Scale` smoke 也精确通过：3 个 writer × 25 次 append 为 `75/75` 唯一事件且链 verified；250 sessions indexed list p95 `13.60 ms`、峰值 RSS `51.43 MiB`；64 MiB hot resume p95 `3.17 ms`、最大读取 `65,537` 字节，3 个完整 CLI 冷进程 p95 `812.66 ms`、峰值 RSS `60.80 MiB`；4 次真实进程强杀和 5 个 smoke byte cuts 零失败。该 smoke 只作当前改动的性能回归证据，不能替代第 16.2 节的三平台 1 GiB formal matrix。

本节关闭的是 **exact-ID / latest-continue 在 per-session meta+tombstone witness set 完整存活时的 pre-write deletion/conflict fencing**。它不证明并发 pathname replace/unlink 的 FD identity 事务，也不检测“删除 interior/prefix record 但保留原 tail”的所有 append 前篡改；meta 或 tombstone witness 任一遭外部删除时仍缺独立 anchor。prefix/interactive picker、`JSONL_SESSION` feature flag 关闭时的 legacy fallback、mirror/search/raw session-index consumers、合法替换链与 chain-only `verifySession` 的语义统一也仍未闭合。以上限制以及通用跨进程 lease、fsync/断电、三平台 artifact 均不得由本地成功外推。

### 16.7 MCP HTTP/SSE、WebSocket 边界、响应生命周期与 JSON-RPC 错误隔离增量

实现提交 `3c4ec8873d8266ea6d29b4884d6bf9237f00495e`（tree `3b9a4ac4aaafcbe99fcb597be1840c2a1a6f1e7f`）关闭了 production Node `fetch` 路径中有限 MCP HTTP 响应的无界读取窗口：

- 成功 JSON 与一次性 SSE 响应现在受宿主固定的 16 MiB UTF-8 字节上限约束；`maxBufferChars` 只能收紧，`0`、负值、非有限值或超大有限值都不能关闭或抬高该上限。声明的 `Content-Length` 超限会在正文读取前以 `CC_MCP_HTTP_RESPONSE_TOO_LARGE` / `limitBytes` 拒绝并取消 body；无长度的真实流按收到的字节累计，溢出或 reader/decoder 异常都会 cancel + release。
- 非 2xx 不再调用无界 `response.text()`。`401`、`403` 与配置 `headersHelper` 的错误完全不读取正文并立即取消；其他状态最多读取 `min(有效响应上限, 4 KiB)` 的诊断前缀、对外仍只保留 200 字符，然后取消余下正文。`404` 也统一携带 `CC_MCP_HTTP_STATUS` 与结构化 `status`。
- 后台 SSE 把上限定义为**单事件**字节预算，而不是长连接累计总量。完整带 delimiter 的事件在 JSON 解析/notification 派发前检查，未终止事件也检查；超限会取消 reader、公开稳定 size code，并停止自动重连，不能通过“超大事件与 delimiter 同批到达”绕过。

新增真实 loopback/fake-stream 对抗套件为 **11/11 passed**：chunked 且无 `Content-Length` 的 `200` / `401` / `404` / `503` 均在 64 KiB canary 前关闭；`Content-Length=16 MiB+1` 只发送 headers 即证明 `maxBufferChars=0` 与 `Number.MAX_SAFE_INTEGER` 都不能绕过；完整/未终止 SSE fixture 固定“字符数等于 cap、UTF-8 字节数大于 cap”，并断言 cancel、零 notification、一次 fetch、无重连。提交 `aa436917c6bb5522ebf879cdc362cfbc2d0ae05d` 又只补齐 5 个旧 stdio discovery fixture 对 `resources/templates/list` 的响应，消除每例等待默认 timeout 的假挂起；其 clean tracked worktree（tree `97b8bfff01e5ce8aded488dd8d6e335073a5b53d`）在 Windows x64 / Node `22.22.2` 复跑全部 `mcp-client*` 单测为 **17 files / 147 tests passed**、5.81 秒。目标 Prettier、ESLint、Node 语法与 `git diff --check` 均通过。

实现提交 `92cb2e3c2154c46141219902e93791bd297d50e6`（tree `71f66275eaf248bd2673c17ad80cc33b1c494fc2`）继续关闭 WebSocket 配置绕过：finite `maxPayloadBytes` 保留既有 1 KiB 下界并新增不可抬高的 16 MiB 上界，undefined/NaN/±Infinity 回默认 16 MiB；因此 `2 ** 32`、`Number.MAX_SAFE_INTEGER` 等值不能再经 `ws` 内部整数转换关闭检查。普通 frame/fragment、`permessage-deflate` 解压输出的两类 `ws` size error 与 close `1009` 都映射为 `CC_MCP_WS_PAYLOAD_TOO_LARGE` + `limitBytes` + `closeCode`；错误使用中性固定文案，不复制 payload 或 peer reason，error→close 保持一次 error/一次 disconnect、清空 pending 并维持 `ERROR`。该码在宽泛 WebSocket connection heuristic 前被显式排除，不能自动 reconnect 后再次接收同一恶意结果。

新增 WebSocket 套件为 **5/5 passed**：constructor 矩阵逐值证明 1 KiB/16 MiB 双钳制；真实未压缩与真实 `permessage-deflate` fixture 都用 1 KiB client cap 拒绝 8 KiB 结果，peer 观察到 close `1009`，并断言零 notification、零 reconnect、单次 tool call、pending 清空、状态为 `ERROR` 且 canary 不进入公开 error/event；另以带 canary reason 的 peer `1009` 与 declared-length error 覆盖两条稳定映射。clean implementation SHA `92cb2e3c2154c46141219902e93791bd297d50e6` 在 Windows x64 / Node `22.22.2` 复跑全部 `mcp-client*` 单测为 **18 files / 152 tests passed**、6.47 秒。

实现提交 `9de651412cdc695dc898c4f23ebb6166874c2c99`（tree `28cd40c0b25ebee46ccc7242ba4add133d0e2a4f`）继续关闭 Streamable HTTP 中语义上不消费 response body 的生命周期缺口：

- notification、server-to-client request callback 的 JSON-RPC response 与 session DELETE 现在共用 response-discard helper；每次调用持有独立 `AbortController`，收到 headers 后立即取消 body，不能让成功或错误正文继续占用连接。默认 30 秒宿主 deadline 不可抬高；正有限 `requestTimeoutMs` 只能收紧，`0`、负值、非有限值与超大值都回到 30 秒，`longRunning` 也不豁免 fire-and-forget 清理。
- connect 失败与 disconnect 会中止并清空已经发出的 discard POST；disconnect 在任何 await 前同步转为 `DISCONNECTED`、安装单航班 Promise 并禁止新 notification/response。pending DELETE 期间的 tool/resource 请求稳定返回 `CC_MCP_SERVER_DISCONNECTING`，该码显式排除于热重连 heuristic，因此不会把调用方主动关闭的服务器重新拉起；延迟 teardown 也只删除同一 entry，不会误删同名 replacement。
- 新增 lifecycle 套件为 **12/12 passed**，覆盖三类 body cancel、deadline/无效配置/`longRunning` 矩阵、忽略 signal 的测试 adapter 注册表退休、connect-failure cleanup、双 disconnect 单 DELETE、零 late POST/零 reconnect，以及真实 loopback 的 64 MiB chunked canary 和 peer 永不发 headers。与 HTTP timeout 合并为 **2 files / 17 tests passed**；独立对抗复现给出 scoped GO。提交后的 clean tracked worktree 在 Windows x64 / Node `22.22.2` 复跑全部 `mcp-client*` 加 `ide-hot-reconnect` 为 **20 files / 175 tests passed**、9.03 秒；目标 Prettier、ESLint、Node 语法与 staged diff 检查均通过。

实现提交 `2da0cf50990143e061799fd758342d811a6fdce9`（tree `2089aa2d264bb906172757529595c0c854fc6d2a`）进一步关闭普通 Streamable HTTP tool/resource 主请求的 caller cancellation 与 disconnect 生命周期：

- 每个 HTTP 主请求现在始终持有宿主管理的独立 `AbortController`；`longRunning` 与 `requestTimeoutMs=0` 只关闭 deadline，不再关闭断连/调用方取消。agent-core 将当前调用的 `AbortSignal` 传到 HTTP `tools/call` 与 resource read；dispatch 前取消稳定返回 `CC_MCP_REQUEST_ABORTED` 且标记 `dispatched=false` / `outcomeUnknown=false`，不会发出网络请求或泄漏 caller reason。
- dispatch 后由 caller、deadline 或 disconnect 中最先发生的原因胜出。caller cancel 会用独立 controller 最多发送一次固定原因的 `notifications/cancelled`；disconnect 稳定返回 `CC_MCP_SERVER_DISCONNECTING`。两者都取消已取得的 response body，并在 fetch adapter 忽略 signal、随后晚到成功时继续拒绝而不读取/返回正文；连接型 heuristic 显式排除 caller-abort，因此零 reconnect、零自动重放。已经 dispatch 的不安全 `tools/call` 仍由 side-effect ledger 记为 `outcome_unknown`，同一调用不会因取消而自动 replay。
- 新增 fake-stream 与真实 loopback 取消套件为 **9/9 passed**，覆盖 pre/post-dispatch caller cancel、disconnect/deadline first-wins、忽略 signal 的 late success、两条并发 POST、永不发 headers 与无限 chunked body。clean implementation SHA 上全部 `mcp-client*` 加 `ide-hot-reconnect` 为 **21 files / 184 tests passed**，受影响的 agent-core ledger/scheduler/Skill-MCP/resource 矩阵为 **4 files / 53 tests passed**；Prettier、ESLint、Node 语法与 `git diff --check` 均通过，独立对抗复审结论为 scoped GO。

实现提交 `3ce3e158d1e36c3f0e0e4a7bb8dc0e5dda97fa26`（tree `cb8d4e1008b63967c30dd296f2ea81647ec94a52`）废止了前述非认证 HTTP error-body preview，并关闭其向 stderr/tool-result/model/session 的传播链：

- 所有非 2xx 响应现在都不调用 `getReader()` 或 `text()`，收到 headers 后立即 best-effort cancel body；对外错误只保留稳定 `CC_MCP_HTTP_STATUS`、数值 `status`、transport 与净化 URL。普通状态固定为 `HTTP <status>`；`404` 继续保留去除 userinfo/query/hash 的 endpoint 与 MCP config 指引，但不复制 peer body、reason phrase、控制字符、prompt 文本或反射 credential。
- agent-core 对携带正式 `CC_MCP_HTTP_STATUS` 契约的错误再按数值 status 生成固定消息；可信只读 tool、`read_mcp_resource`、tool-result、下一次 model call 与持久化投影均不再依赖 transport message 中的 peer detail。fake adapter 用带 OSC/NUL/secret canary 的正文证明 body cancel 一次、reader/text 零调用；真实 chunked `401` / `404` / `503` 在 64 KiB canary 前关闭且连可见前缀也不进入错误对象。agent-loop 用例进一步断言 canary 不进入 stream tool event、第二轮模型上下文或持久化捕获。
- clean implementation SHA 在 Windows x64 / Node `22.22.2` 上复跑全部 `mcp-client*` 加 `ide-hot-reconnect` 为 **21 files / 184 tests passed**，agent-core ledger/scheduler/Skill-MCP/resource 影响矩阵为 **4 files / 56 tests passed**；目标 Prettier、ESLint、Node 语法与 `git diff --check` 均通过。独立对抗复审另跑相邻 discovery/header-helper/agent-loop 矩阵 **6 files / 116 tests passed**，结论为 scoped GO。

实现提交 `9e7a09f3e6fc5d51ea4cc59be5c985275c09d1f8`（tree `1223dde0de53e7cc9e9b73863e12ebd40736ef4d`）继续关闭 `200` HTTP/SSE 外壳中的 JSON-RPC application error 泄漏与误控制：

- wire `error.code` 只接受 own-data safe integer，`message` 只校验为 own-data string 而不复制内容；公开 Error 的 message/stack/enumerable diagnostics 全由宿主按数值 code 固定生成，普通 `data` 不再挂到 Error。真实 RPC 身份保存在不可伪造的私有 `WeakSet`；invalid error/envelope/message 只产生固定 `CC_MCP_RPC_*_INVALID`，因此 peer 的 `HTTP 401`、`HTTP 503`、`ECONNRESET`、`not connected`、控制字符或 prompt 文本不能再驱动 auth helper、discovery retry、hot reconnect/tool replay，也不能进入 stderr、tool result、下一轮 model、session capture 或 ledger digest。
- HTTP JSON 与一次性 SSE 都严格校验 `jsonrpc="2.0"`、精确 response id、response 不含 method，以及 `result` / `error` 恰好二选一；malformed JSON 的 `SyntaxError` 不保留为 cause。stdio/WS/SSE 的共享 message boundary 在删除 pending/timer 前先做 descriptor-only snapshot；非法 top-level getter/Proxy 会稳定拒绝全部 pending。WebSocket malformed text 与 binary frame 同样使用固定错误并显式 non-retryable。
- `-32042` 仍保留协议所需 URL flow，但只有私有 `WeakMap` 中冻结的 `mode`、`elicitationId`、`url`、`message` allowlist 能驱动它；批次最多 16 项，四字段只接收 primitive string，并有 UTF-8 字节上限与控制字符拒绝。任意额外 `data`、Proxy/accessor、重复/超长字段都 fail closed。elicitation id 在一个 client lifetime 内只使用一次；1000 项历史满后拒绝新 flow 而不淘汰旧 completion，collision、handler failure 或竞态仍重抛原固定 `-32042`，不能借旧 completion 自动授权第二次 tool retry。
- agent-core 只把私有品牌的有效 RPC application rejection 判为确定失败并结算 ledger `failed`；真正的 dispatch/transport 不确定性对不安全 tool 继续保持 `outcome_unknown`。结算前错误会重新投影为宿主 Error，agent 与 ledger 对 accessor/Proxy 只读 own-data descriptor，不执行 getter、`toString` 或 peer-dependent digest。

clean implementation SHA 在 Windows x64 / Node `22.22.2` 上复跑全部 `mcp-client*` 加 `ide-hot-reconnect` 为 **22 files / 217 tests passed**，agent-core ledger/scheduler/Skill-MCP/resource 与 ledger matrix 为 **5 files / 75 tests passed**。新增 31 项 RPC 对抗套件覆盖 HTTP JSON + SSE、malformed JSON、auth/discovery/reconnect spoof、strict envelope、pending getter/Proxy、合法/非法/重复 URL flow、history cap 与公开 canary；目标 Prettier、Node 语法、`git diff --check` 均通过，ESLint 为 0 error（`agent-core` 保留既有 23 warnings）。独立对抗复审另跑 9 个定向文件 **185 tests passed**，对本实现范围给出 scoped GO；最终增加的 SSE/history/error-Proxy 测试不再修改生产实现。

实现提交 `e86a92ecfe453ca19c2b5842ef3e0e374ad3294e`（tree `01f13d7e1f3d4ef1185395cf18713f8921fa3e26`）关闭泛 WebSocket close reason、结果未知重放与 elicitation 断连清理缺口：

- runtime close 不再读取或投影 peer reason；公开 Error 与 `server-disconnected` 只包含宿主生成的固定消息、校验后的数值 close code、`peer_closed` reason 和稳定 error code。普通 socket error 与 send failure 也不再复制 adapter message。请求进入 pending 后发生 close/error/send failure 会标记 `dispatched=true`、`outcomeUnknown=true`，高层 hot reconnect 在这一调用上 fail closed，因此对端不能用 `HTTP 503` / `ECONNRESET` 形状的 close reason 触发非幂等 tool 自动重放；断连后的下一次独立调用仍可正常重连。
- elicitation 现在有按精确 server 身份维护的 direct-handler disconnect guard；WS close/error/协议失败、stdio close/error、connect failure 与主动 disconnect 共用即时清理。事件式 pending 会稳定返回 `cancel`，未结算 direct handler 会与断连竞争并及时释放并发槽，accepted URL completion waiter 会立即返回 `false`、清 timer/集合并进入不可复活的 terminal cancel。清理不再用字符串 key prefix，因此名为 `srv` 的断连不会误取消 `srv:child`；迟到 handler/completion 也不能把已取消 flow 重新变成 accepted/completed。
- clean implementation SHA 在 Windows x64 / Node `22.22.2` 上复跑全部 `mcp-client*` 加 `ide-hot-reconnect` 为 **22 files / 219 tests passed**，agent-core MCP/ledger 相邻矩阵为 **5 files / 182 tests passed**；目标 Prettier、ESLint、Node 语法与 `git diff --check` 均通过。真实 loopback 用带 canary 的 `1011` close 证明 error/event 零 reason 泄漏、单次 dispatch，并证明首个失败调用零自动 reconnect/replay、下一次显式调用可恢复；另一条真实 socket 用例同时验证悬挂 direct handler 与 10 秒 URL waiter 在 peer close 后立即取消。事件式测试覆盖相似 server name 的精确隔离。

实现提交 `307cbe9d7a1170e23010d5bd680f681fec172caa`（tree `90ac306d25e512b34ae802627ae548682237de36`）补齐普通 JSON 配置到 WebSocket sink 的 payload 上限传播：

- `parseMcpServers` 现在只保留 finite number 类型的 `maxPayloadBytes`，因此 `--mcp-config`、managed MCP 与已信任 project `.mcp.json` 的共用解析链可以设置更严格上限；字符串等隐式数值不被转换。OAuth reconnector 继续使用包含该字段的 base config。最终 WebSocket constructor 仍统一执行既有 1 KiB 下限与 16 MiB 宿主硬上限钳制，所以配置只能收紧、不能以 `0`、负值或超大值关闭/抬高边界。
- clean implementation SHA 在 Windows x64 / Node `22.22.2` 上复跑全部 `mcp-client*`、`ide-hot-reconnect` 与 agent MCP config 为 **23 files / 271 tests passed**，全部 `*mcp-config*` loader 矩阵为 **9 files / 112 tests passed**；目标 Prettier、ESLint、Node 语法与 `git diff --check` 均通过。新增端到端测试从 JSON 文件经 parser/setup 走到注入 WebSocket constructor，直接观察 2 KiB sink limit；解析测试同时固定数值保留、字符串拒绝。

实现提交 `468e953584dc61ba19c4bb633ba855765fe71a0b`（tree `a584755f08406a0f6cfc37ad2b1277ac09537993`）删除成功 HTTP Response-like 的无界 `text()` 兼容分支：

- 需要解析正文的 JSON、一次性 SSE 与后台 SSE 现在都必须取得 byte reader，才能在每个 chunk 后执行宿主字节上限；没有 `body.getReader()` 的非标准成功 response 会先 best-effort cancel body，再以固定 `CC_MCP_HTTP_RESPONSE_STREAM_REQUIRED` fail closed，绝不调用 `text()`。该错误显式 non-retryable；后台 SSE 也在第一次错误后停止，不进入 reconnect loop。非 2xx response 继续沿用零 reader/零 text 的状态码路径，声明超限的 `Content-Length` 仍在取得 reader 前拒绝。
- 既有 text-only fake Response 全部迁为 byte-reader double，避免测试环境继续依赖生产已删除的 fail-open。clean implementation SHA 在 Windows x64 / Node `22.22.2` 上复跑全部 `mcp-client*` 加 `ide-hot-reconnect` 为 **22 files / 222 tests passed**；agent-core MCP/ledger、prompt/resource 与 VS Code bridge 相邻矩阵为 **8 files / 230 tests passed**。目标 Prettier、ESLint、Node 语法与 `git diff --check` 均通过。新增 JSON 与后台 SSE 对抗用例均证明单次 fetch、body cancel、`text()` 零调用和固定不可重试错误；后台 stream registry 最终清空。

实现提交 `0352496949f184a01fdadaf7a038f25aaa9a3c47`（tree `943bfbda588d71debc854d578619df4e5151bca2`）关闭孤立 peer WebSocket close `1009` 的方向误判：

- 只有本地 WebSocket payload error 才能证明本机因 host-owned inbound 上限拒绝消息，并继续固定映射为 `CC_MCP_WS_PAYLOAD_TOO_LARGE`；peer 单独发送的 `1009` 不再凭 close code 冒充本地超限，而是按方向中立的 `CC_MCP_WS_CLOSED` 结算，保留 `closeCode: 1009`、`dispatched: true` 与 `outcomeUnknown: true`，不附带虚假的 `limitBytes` 或 host-cap 文案，也不把不可信 close reason 投影到诊断/事件。
- 对非幂等调用，该结果未知围栏保持单次 dispatch、零自动 reconnect/replay；连接进入 `DISCONNECTED`，只发固定 `peer_closed` disconnect event，不生成伪造的 `server-error`。本地实际 wire/解压超限的既有映射测试继续通过。目标矩阵为 **2 files / 15 tests passed**；clean implementation SHA 在 Windows x64 / Node `22.22.2` 上复跑全部 `mcp-client*` 加 `ide-hot-reconnect` 为 **22 files / 222 tests passed**，目标 Prettier、ESLint、Node 语法与 `git diff --check` 均通过。

实现提交 `9c5500515bee6169b171e2e9ec1fc9ffad15d92f`（tree `cad7a75539486a037e01a7111103603278e6fbd4`）关闭有限成功 HTTP response 的慢滴答与 response callback deadline 诊断缺口：

- `longRunning` 和 `requestTimeoutMs=0` 仍可豁免 server computation / response headers 等待，但成功 headers 到达后，JSON 或 request-scoped SSE 正文必须在新的 host-owned 绝对 deadline 内完成；正有限配置只能收紧，`0`、无效值与超大值不能关闭或抬高 30 秒上限。reader 每次 `read()` 都与宿主 `AbortSignal` 竞争，因此即使非标准 reader 忽略 signal、持续在 byte cap 内逐字节滴答，本地 Promise 仍按时结算并 best-effort cancel/release reader。
- 正文 deadline 固定返回 `CC_MCP_HTTP_RESPONSE_TIMEOUT`，只保留方法、净化 URL、`dispatched` 与 `outcomeUnknown`，发送一次固定 cancellation；非幂等调用保持单次 dispatch、零 reconnect/replay。server-to-client response callback 的 discard deadline 也固定投影为 `CC_MCP_HTTP_DISCARD_TIMEOUT` 与宿主文案，不再把 adapter/Node `AbortError` 文案或 URL secret 带入 `server-stream-error`；忽略 abort 后晚到的 response 仍先 cancel body 再按 deadline 失败。
- 新增 byte-at-a-time、永不 settle reader、`longRunning`/`requestTimeoutMs=0`/超大配置以及 callback canary 用例，目标矩阵为 **2 files / 17 tests passed**。clean implementation SHA 在 Windows x64 / Node `22.22.2` 上复跑全部 `mcp-client*` 加 `ide-hot-reconnect` 为 **23 files / 227 tests passed**；agent-core MCP ledger/scheduler/Skill、headless ledger、call ledger/store、prompt/resource 与 recovery admission 相邻矩阵为 **8 files / 179 tests passed**。目标 Prettier、ESLint、Node 语法与 `git diff --check` 均通过。

实现提交 `7bbdc0a360403828529f9c8f17d499df53a9c080`（tree `807c474071bf0da892de02b09819239d2b74323d`）关闭 stdio 完整/未终止 stdout frame 的配置绕过与字符计数缺口：

- 每个 newline-delimited JSON-RPC frame 与其跨 chunk 未终止 tail 现在共用不可关闭、不可抬高的 16 MiB host-owned UTF-8 字节上限；`maxBufferChars` 只兼容为更严格的字节值，`0`、负值、非有限值和超大有限值全部回到宿主上限。实现按 delimiter 增量扫描，在把 segment 拼到既有 tail 或调用 `JSON.parse` / message handler 前检查累计字节，因此单 chunk 携带的完整超大行不能再借 newline 清空 tail 绕过；split UTF-8 字符仍由连接级 decoder 正确重组。
- 超限固定返回 `CC_MCP_STDIO_FRAME_TOO_LARGE`、`limitBytes` 与中性 host 文案，不复制 frame 内容。已经 pending 的调用标记 `dispatched=true` / `outcomeUnknown=true`，保持单次 dispatch、零 reconnect/replay；所有 pending 和 elicitation 即时结算，buffer 清零并 best-effort kill process。fatal `ERROR` 在随后 process close 时不再降级为普通 `DISCONNECTED`，后续 stdout chunk 也不再解析。
- 对抗用例覆盖无 newline、完整 newline frame 在 parse/dispatch 前拒绝、字符数小于 cap 但 UTF-8 字节超限、`0`/`Number.MAX_SAFE_INTEGER` 绕过、固定错误/零 canary、结果未知防重放、fatal state 及既有 split UTF-8/process death 行为；目标矩阵为 **3 files / 13 tests passed**。clean implementation SHA 在 Windows x64 / Node `22.22.2` 上复跑全部 `mcp-client*` 加 `ide-hot-reconnect` 为 **23 files / 231 tests passed**，相邻 MCP ledger/scheduler/Skill/resource/recovery 矩阵为 **8 files / 179 tests passed**；目标 Prettier、ESLint、Node 语法与 `git diff --check` 均通过。

实现提交 `b3409c5746c2f400b305c3945028c4b6ee7d54d1`（tree `762d5bc06877a46ea7843e8aa544ef0c36d2cf5c`）关闭 stdio stderr 原文传播与 malformed JSON aggregate 缺口：

- stdio stderr 不再 decode、复制或逐 chunk 投影不可信内容；首次非空输出只发一个固定 `CC_MCP_STDIO_STDERR_OUTPUT` 通知和首 chunk 字节数，后续 bounded chunk 合并计数。每连接累计超过不可配置的 1 MiB 时，以固定 `CC_MCP_STDIO_STDERR_TOO_LARGE` / `limitBytes` fail closed，因此 terminal-control、URL、secret/prompt canary 均不能经 `server-error` 传播，很多小 stderr chunk 也不能制造无界事件流。
- 非空、JSON 语法无效的 stdout frame 在既有 16 MiB 单帧上限之外，再按连接 lifetime 累计完整 frame 字节与次数；最多容忍 32 帧且累计不超过 1 MiB，任一预算超出就固定返回 `CC_MCP_STDIO_MALFORMED_BUDGET_EXCEEDED`、`limitFrames` 与 `limitBytes`。合法 JSON-RPC frame 不消费该预算；很多小 malformed 行不能无限触发 `JSON.parse`，单个仍受单帧硬上限约束。
- 两类 fatal error 共用 stdio cleanup：pending 调用保留 `dispatched` / `outcomeUnknown`，零 reconnect/replay，清 buffer、pending、elicitation，best-effort kill process 并保持 `ERROR`。新增测试覆盖 stderr 两 chunk 合并/原文零传播/累计超限、malformed 第 32/33 帧边界、单帧耗尽累计字节预算、固定事件和既有 50 条合法 notification 不误报；目标矩阵为 **3 files / 17 tests passed**。clean implementation SHA 在 Windows x64 / Node `22.22.2` 上复跑全部 `mcp-client*` 加 `ide-hot-reconnect` 为 **23 files / 235 tests passed**，相邻 MCP ledger/scheduler/Skill/resource/recovery 矩阵为 **8 files / 179 tests passed**；目标 Prettier、ESLint、Node 语法与 `git diff --check` 均通过。

实现提交 `fabbcae9a3ca6d4a91ad341c0d7dc1e6cb908639`（tree `b130f99421dbd2b24e7d1ae5ae7cdc3386af0298`）关闭普通 WebSocket / stdio tool 与 resource 请求的 caller cancellation 生命周期：

- 两种 transport 都在 dispatch 前检查 caller `AbortSignal`，已取消调用固定返回 `CC_MCP_REQUEST_ABORTED`、`dispatched=false`、`outcomeUnknown=false`，不写入 peer 且不传播 caller reason。dispatch 后取消则先从 pending registry 退休请求、清 timeout 与 abort listener，再 best-effort 发送且只发送一次固定 `notifications/cancelled`；错误标记 `dispatched=true` / `outcomeUnknown=true`，因此非幂等 tool 不会 reconnect/replay。
- response、transport failure、deadline 与 caller abort 共用 first-settlement cleanup；response 先到会移除 listener，后续 abort 不会补发 cancellation，abort 先到后的 late response 也不能改变结算。契约测试同时覆盖 WS/stdio 的 pre-dispatch 零写入、post-dispatch 单次取消/零重放/canary 隔离、late response，以及 `resources/read` 正常响应后的 listener 清理。目标矩阵为 **4 files / 30 tests passed**；clean implementation SHA 在 Windows x64 / Node `22.22.2` 上复跑全部 `mcp-client*` 加 `ide-hot-reconnect` 为 **24 files / 241 tests passed**，相邻 MCP ledger/scheduler/Skill/resource/recovery 矩阵为 **8 files / 179 tests passed**；目标 Prettier、ESLint、Node 语法与 `git diff --check` 均通过。

实现提交 `155b9438239254317bde07e18a7bb23276863d6e`（tree `400d09b50d6fe09bc53d5854a3532d969af1b839`）关闭后台 Streamable HTTP GET/SSE 的 handler-owner lifecycle 与单事件慢滴答缺口：

- `setElicitationHandler` 的可选 caller `AbortSignal` 现在拥有对应 resolver route；预先取消的 owner 不启动 GET。最后一个 global/session handler 被 signal 取消或显式清除时，同步标记 stream stopped、abort 当前 fetch/read、唤醒 reconnect backoff 并退休 registry。即使非标准 fetch 忽略 abort，本地 stream Promise 仍先结算；迟到 response 会 best-effort cancel body，且旧 stream 的 finally 不能删除同名 replacement。Headless stream 把外部生命周期 signal 接入该 route，多 session 共享连接则只在最后一个 resolver 离开时停止。
- 长连接本身仍可无限期正常空闲，但每个 SSE event 从首个 wire byte 到空行 delimiter 必须在 host-owned 绝对期限内完成：默认/最大 30 秒，正有限 `requestTimeoutMs` 只能收紧；`0`、超大值与 `longRunning` 不能关闭或抬高。预算按原始字节和四种合法 CR/LF delimiter 扫描，因此单个未完成 UTF-8 lead byte 也会启动 deadline；完整 event 会重置 timer，随后正常 idle 不误杀。超时固定返回 `CC_MCP_SSE_EVENT_TIMEOUT` / `timeoutMs`，非阻塞地 cancel reader，停止自动重连且不派发半事件。
- 新增对抗测试覆盖 pre-abort 零 GET、ignored-fetch abort 与 late-body cancel、最后一个 session handler 清理、完整事件后的正常 idle、未解码 UTF-8 慢滴答，以及 `7` / `0` / `Number.MAX_SAFE_INTEGER` deadline 边界。MCP 目标矩阵为 **5 files / 57 tests passed**，隔离 `CHAINLESSCHAIN_HOME` 的 headless lifecycle 为 **1 file / 11 tests passed**；clean implementation SHA 在 Windows x64 / Node `22.22.2` 上复跑全部 `mcp-client*` 加 `ide-hot-reconnect` 为 **25 files / 248 tests passed**，相邻 MCP ledger/scheduler/Skill/resource/recovery 矩阵为 **8 files / 179 tests passed**。目标 Prettier、Node 语法、`git diff --check` 和 ESLint 0 error 均通过；headless 文件保留 3 个既有 unused-variable warning。

实现提交 `4d5b8a25dc4656cf9d043ca77dcd9a0100440504`（tree `b02bf92bbe50918289f6e26a11f74f4dca521eb5`）关闭 stdio、WebSocket 与后台 SSE 的持续有效入站消息速率和滚动累计流量缺口：

- 三种长连接 transport 共用宿主拥有的 per-server token bucket：消息容量默认为 128、按 1 秒补满，字节容量默认为 64 MiB、按 60 秒补满。普通配置只接受 finite number，并可用 `maxInboundMessagesPerSecond` / `maxInboundBytesPerMinute` 收紧；`0`、负值、字符串、非有限值与 `Number.MAX_SAFE_INTEGER` 都不能关闭或抬高宿主上限。使用可补充 token 而非 lifetime total，既限制持续洪泛，也不会让健康的永久连接仅因累计运行时间最终必然失败。
- stdio 在每个非空 newline frame、WebSocket 在每个 text message、后台 SSE 在每个 event 的 JSON parse 与 notification/result dispatch 前先记账，malformed 或空 SSE event 也不能绕过消息预算。超限固定返回不可重试的 `CC_MCP_INBOUND_RATE_EXCEEDED` 或 `CC_MCP_INBOUND_TRAFFIC_EXCEEDED`，只公开宿主 limit/window，不复制 peer payload；stdio 终止进程，WebSocket 以固定 `1008` policy close 结算，SSE 取消 reader 并停止重连。已经 dispatch 的 pending 请求标记 `outcomeUnknown=true`、清空且不自动重放，迟到消息也不能恢复连接状态。
- 新增的 stdio/WS/SSE 对抗测试覆盖速率 burst、半窗口 refill、滚动字节 refill、单消息字节耗尽、配置绕过、pre-dispatch 截断、canary 隔离与非幂等 pending fencing。clean implementation SHA 在 Windows x64 / Node `22.22.2` 上的目标矩阵为 **6 files / 114 tests passed**，全部 `mcp-client*` 加 `ide-hot-reconnect` 为 **26 files / 260 tests passed**，相邻 MCP ledger/scheduler/Skill/resource/recovery 矩阵为 **8 files / 179 tests passed**；目标 Prettier、ESLint、Node 语法与 `git diff --check` 均通过。

实现提交 `baf914649c2b0fe30f4ed8f6a582694dc93d59af`（tree `95cfe953fc5d3619f9dcd671e42c2e8043b18700`）关闭 MCP 入站 JSON 对象图放大缺口：

- HTTP JSON、request-scoped SSE、后台 SSE、WebSocket text 与 stdio newline frame 五条 production 入站路径都在 `JSON.parse` 前执行迭代式结构扫描；默认/最大预算为 100 层容器深度和 100,000 个结构节点（包含对象键），因此短 wire 也不能生成超深或超宽对象后再把递归/内存成本转嫁给消费者。扫描器正确跳过 JSON string 内的括号、花括号和 escape；解析后再用显式 stack、own-data descriptor 与 `WeakSet` 复核图，不递归，也不执行 getter 或 Proxy trap。直接注入/custom adapter 的 result/params 遇到 Proxy、accessor、稀疏数组、cycle/shared identity 或非 JSON value 会 fail closed；RPC error/data 继续只走既有的固定错误投影与有界 URL-flow allowlist，不因本项重新获得控制权。
- `maxJsonDepth` / `maxJsonNodes` 只接受 finite number 并只能收紧；`0`、负值、字符串、非有限值和 `Number.MAX_SAFE_INTEGER` 不能关闭或抬高硬上限。超限分别固定返回不可重试的 `CC_MCP_JSON_DEPTH_EXCEEDED` / `CC_MCP_JSON_NODES_EXCEEDED`，只公开宿主 limit 与净化 transport 元数据，不复制 payload。stdio 终止 peer，WebSocket 固定 close `1008`，后台 SSE cancel reader 且停止重连；已 dispatch 的 HTTP/WS/stdio mutation 保留 `outcomeUnknown=true` 并禁止自动重放。
- 新增 14 项对抗测试覆盖五条解析路径、100,000 节点硬上限、深度/节点配置绕过、精确健康边界、string 伪结构符、直接深图、Proxy 零 trap、canary 隔离和 pending fencing。clean implementation SHA 在 Windows x64 / Node `22.22.2` 上的目标矩阵为 **7 files / 136 tests passed**，全部 `mcp-client*`、`ide-hot-reconnect` 与 `agent-mcp-config` 为 **28 files / 327 tests passed**，相邻 MCP ledger/scheduler/Skill/resource/recovery 矩阵为 **8 files / 179 tests passed**；目标 Prettier、ESLint、Node 语法与 `git diff --check` 均通过。

实现提交 `2e9a37c453a8cdf1a9860f5062862914f5e64c10`（tree `044268500e290d6d2b8a740a635a1841031a7e67`）关闭 MCP tool schema/description 专用预算与 ToolSearch token 估算 fail-open 缺口：

- `tools/list` 初次发现与 `notifications/tools/list_changed` 刷新都必须先通过宿主接纳器：硬上限为每 server 1,000 tools、名称 256 UTF-8 bytes、description 16 KiB、每个 input/output schema 256 KiB / 32 层 / 25,000 nodes、完整 definition 512 KiB / 50,000 nodes、单 server 8 MiB，以及单 client 32 MiB。`maxTools`、`maxToolDescriptionBytes`、`maxToolSchemaBytes`、`maxToolSchemaDepth`、`maxToolSchemaNodes`、`maxToolDefinitionBytes` 与 `maxToolMetadataBytes` 只允许 positive finite number 收紧；`0`、负值、字符串、非有限值与超大值都不能关闭或抬高硬上限。
- 接纳只读取 own data descriptor，不执行 Proxy trap/getter；稀疏数组、symbol/accessor、cycle/shared identity、非 JSON 值、重复名称和终端控制字符都固定拒绝，错误只公开宿主 limit，不复制 peer canary。健康 definition 会复制为独立的深冻结快照；初次恶意 inventory 保持连接但不暴露任何 tool，恶意 list-changed 保留最后一份健康快照且不发送伪 `tools-changed`，断连会释放 client 聚合记账。模型 wiring 还会对 injected/custom client 的返回值独立复核，未接纳 definition 不能进入 provider schema、executor 或 ToolSearch registry。
- ToolSearch 无法序列化 definition 时按 `Number.MAX_SAFE_INTEGER` 记账；token estimator 抛错、返回 `0`、负数或非有限值时退回到非零 UTF-8 byte 计数，所有聚合使用饱和加法，因此自动 deferral 不再因估算器失败而 fail open。clean implementation SHA 在 Windows x64 / Node `22.22.2` 上的目标矩阵为 **3 files / 105 tests passed**，全部 `mcp-client*` 加 `agent-mcp-config`、`ide-hot-reconnect`、`mcp-tool-search`、metadata budget、subagent inheritance 与 WS session manager 为 **32 files / 483 tests passed**，相邻 MCP ledger/scheduler/Skill/resource/recovery 矩阵为 **8 files / 171 tests passed**；目标 Prettier、ESLint、Node 语法与 staged `git diff --check` 均通过。

实现提交 `a8d23e7e97aa2401d27d84bce09006c9d5ff3e70`（tree `a7745248f157174bfbf4c82a077e06e36ec45703`）关闭 MCP `tools/call` 最终 result 到 ledger/model/stream 投影的专用预算缺口：

- 每个最终 tool result 在 transport 通用 frame/body 与 JSON 图校验之后，还必须通过 result 专用接纳器；硬上限为 1 MiB UTF-8 JSON、64 层容器深度和 50,000 个结构节点（包含对象键）。`maxToolResultBytes`、`maxToolResultDepth`、`maxToolResultNodes` 只接受 positive finite number 收紧；`0`、负值、字符串、非有限值与超大值不能关闭或抬高宿主上限。接纳只读取 own data descriptor，不执行 Proxy trap/getter，并拒绝 accessor/symbol、稀疏数组、cycle/shared identity、非 JSON 值和非对象协议结果；健康结果复制成独立的深冻结快照。
- production `MCPClient._callToolOnce` 在 stdio/HTTP/WS 共享返回点执行第一次接纳，agent-core 在 injected/custom client 返回后独立复核，`McpCallLedger` 在摘要和持久化前再兜底。超限固定返回 `CC_MCP_TOOL_RESULT_TOO_LARGE` / `CC_MCP_TOOL_RESULT_DEPTH_EXCEEDED` / `CC_MCP_TOOL_RESULT_NODES_EXCEEDED` 或 `CC_MCP_TOOL_RESULT_INVALID`，只公开宿主 limit，不复制 peer canary；连接保持可用且不热重连。非 host-trusted-read 的 mutation/unknown 调用保持 started ledger、结算为 `outcome_unknown` 并锁住自动重放，host-trusted read 则固定结算为已知失败；超限原文不能进入 ledger digest、`stream-json`、下一轮模型或 recovery wrapper 返回值。
- 模型侧 `MAX_TOOL_RESULT_CHARS` 的 50,000 字符上限改为宿主硬上限；`CC_MAX_TOOL_RESULT_CHARS` 与显式函数参数只能收紧，`0`、负值、非有限值和超大值不能放宽。clean implementation SHA 在 Windows x64 / Node `22.22.2` 上的目标矩阵为 **6 files / 189 tests passed**，全部 `mcp-client*` 加 result budget 与 `ide-hot-reconnect` 为 **28 files / 292 tests passed**，MCP ledger/recovery/scheduler、headless runner/stream 与 IDE context 单 worker 消费者矩阵为 **11 files / 271 tests passed**；目标 Prettier、ESLint（0 errors）、Node 语法与 clean `git diff --check` 均通过。

实现提交 `f0f4d3dacec488057a78fe8a419e5e1cbbba7734`（tree `7fcac0996a1e924e7ed83cb8438dd4dcb7bd0b74`）关闭 CLI Skill 文件、递归发现与模型投影的宿主预算缺口：

- `SKILL.md` 与 `handler.js` 在整文件读取前先做 regular non-symlink 元数据检查，单文件硬上限 256 KiB、单 Skill 两个身份组件合计 512 KiB；身份发现、异步授权后复核和每次 materialize 都复用同一不可放宽的预算。全加载器递归发现改为逐项读取目录，硬上限为 16,384 个目录项、4,096 个 Skill 身份文件、64 MiB 身份组件总字节和 5 层分组目录；因此海量空目录不能再通过一次性 `readdirSync` 分配绕过已识别文件计数。`SkillImprover` 也会在读文件和调用模型前执行同一单文件预检，并在写回前复核结果大小。
- 单个 Skill 正文的最终模型投影硬上限为 48,000 UTF-8 bytes，并以 UTF-8 byte count 作为不信任可配置 estimator 的保守 token 上界；auto persona 的完整投影在追加系统提示前还受 192,000 bytes / token-upper-bound 聚合限制。`run_skill` 不再先读取任意大正文再静默截成 48,000 字符，而是在主模型/隔离子 Agent 的最终消费者边界重新接纳不可变字符串快照；injected/custom loader、observer 回调修改、非字符串 coercion 和多字节 UTF-8 均不能绕过或把 canary 带入模型。所有 `maxSkill*` 选项只接受 positive finite number 收紧，`0`、负值、字符串、非有限值与超大值不能关闭或抬高宿主上限。
- 对抗测试覆盖精确健康边界、超一字节、读取前拒绝、两组件合计、递归目录项/文件数/总字节/深度、配置绕过、UTF-8 与 token 收紧、persona 聚合、缓存/ledger 零 canary、自定义 loader 主模型/子 Agent 二次接纳和 observer 后修改。clean implementation SHA 在 Windows x64 / Node `22.22.2` 上的完整 Skill 单测矩阵为 **24 files / 571 tests passed**，相邻主模型、隔离 Skill、子 Agent、Headless、WS persona 消费者矩阵为 **13 files / 392 tests passed**；目标 Prettier、Node 语法、clean `git diff --check` 与 ESLint **0 errors** 均通过（`agent-core.js` 保留 23 条既有 warning）。

上述增量只证明 **production Node WHATWG `ReadableStream` 上的有限 HTTP response body、成功正文的 host-owned 绝对 deadline、非 2xx HTTP body 零读取/零传播、HTTP/SSE `200` JSON-RPC error 的固定投影与防误重试、无 byte reader 成功 response 的固定 fail-closed、response callback deadline 的固定投影、后台 SSE 单事件字节/绝对时间预算与 handler-owner 生命周期、`ws` 单消息 wire/解压 payload 内存上限及普通 JSON 配置收紧、stdio 完整/未终止 stdout frame 的 UTF-8 字节上限、stderr 原文隔离/累计预算、malformed JSON frame 次数/字节累计预算、stdio/WS/后台 SSE 的持续有效消息速率与滚动累计流量预算、五条入站 JSON 路径的 parse 前深度/节点预算与共享对象边界的 descriptor-only 迭代复核、MCP tool schema/description 的逐项与聚合预算、MCP `tools/call` 最终 result 的专用接纳与 ledger/model/stream 失败关闭、Skill 文件/递归发现/主模型与隔离子 Agent 投影的逐项及聚合预算、ToolSearch token 估算失败关闭、peer `1009` 的方向中立 outcome-unknown、泛 WS close 的固定投影/结果未知防重放/elicitation waiter 清理、HTTP discard-response 与普通 HTTP tool/resource 主请求的 cancel/deadline/断连生命周期，以及普通 WS/stdio tool/resource 请求的 caller cancellation 生命周期**。合法 `-32042` 的四个 allowlist 字段仍会按协议进入显式用户 elicitation，不能外推为“所有 peer 内容都被删除”。非标准 fetch 若忽略 `AbortSignal`，宿主可以退休 controller registry/后台 stream 并拒绝或清理 late success，却不能强制一个永不 settle 的 adapter Promise/底层请求结束；非标准 response 若没有可用 `body.cancel()` 也只能保证零读取，不能强制其底层 socket 关闭。共享 token bucket 已覆盖持续有效消息速率与滚动累计流量；为避免健康永久连接必然耗尽，这不等同于 lifetime total。recovery generation、run_skill 父级取消、即时撤权、Skill/stdio 子进程树、可执行字节身份绑定、三平台 artifact 与长期 soak 仍不在本节范围内，因此完整 Skill/MCP 产品项继续 **NO-GO**。

### 16.8 仍未完成的产品级任务

1. 在实现 SHA `f99f18e4cb3832b8848534186ba32756e98c66c9` 上完成三平台 `CLI Session Scale` formal matrix：本地 Windows x64 formal 已通过，仍须取得 GitHub-hosted Ubuntu、macOS、Windows 的 exact-SHA artifacts；每格的 20 个 writer × 1,000 次 append、10,000 sessions、1 GiB transcript、至少 15 个完整 CLI 冷进程样本、真实进程强杀与 exhaustive partial-record cuts 必须全部成功。
2. 完成 Session 剩余事实源与竞态闭包：本节只关闭 exact-ID/latest-continue 的 pre-write missing/conflict；仍须处理 damaged prefix namespace 与 ambiguity、interactive/recent picker、feature flag 关闭时的 canonical-over-legacy fence、mirror/search/raw index consumer、合法 replacement chain、append 的 interior/prefix deletion、检查到 append 之间的 pathname/FD identity TOCTOU、meta/tombstone 任一 witness 丢失与独立 anti-rollback anchor，并形成三平台 exact-SHA artifact。通用 machine-wide session-host lease 与非 MCP side effect fencing 仍未完成。
3. 完成 Skill/MCP 真实恶意矩阵：第 16.7 节关闭了 production Node `ReadableStream` 的有限 HTTP response body、有限成功正文的 host-owned 绝对 deadline、非 2xx error body 零读取/零传播、HTTP/SSE `200` JSON-RPC error 固定投影与防误重试、无 byte reader 成功 response 的固定 fail-closed、response callback deadline 的固定投影、malformed HTTP JSON 和 WS malformed/binary frame 的固定 non-retryable error、后台 SSE 单事件字节/绝对时间预算与 handler-owner lifecycle、`ws` 单消息 wire/解压上限及普通 JSON 配置收紧、stdio 完整/未终止 stdout frame 的 UTF-8 字节上限、stderr 原文隔离/累计预算、malformed JSON frame 次数/字节累计预算、stdio/WS/后台 SSE 的持续有效消息速率与滚动累计流量预算、HTTP JSON/request SSE/后台 SSE/WS/stdio 的 parse 前 JSON 深度/节点预算与共享对象边界复核、MCP tool schema/description 的逐项与聚合预算、MCP `tools/call` 最终 result 的逐项预算及 ledger/model/stream 失败关闭、Skill 单文件/身份组件合计/递归目录项与文件数/总字节/深度预算、SkillImprover 读取预检、persona 聚合及主模型/隔离子 Agent 最终投影复核、ToolSearch token estimator 的失败关闭、peer `1009` 的方向中立 outcome-unknown、泛 WS close 的固定投影/结果未知防重放/elicitation waiter 清理、HTTP notification/server response/DELETE 的 body cancel、普通 HTTP tool/resource 在途请求的 caller cancel/宿主 deadline/断连/late-success fencing，以及普通 WS/stdio tool/resource 请求的 caller cancellation。明确的有效 RPC application rejection 结算为已知失败；真正的 dispatch/transport 不确定性对非幂等 `tools/call` 继续保持 outcome-unknown 且不自动重放。普通 HTTP/WS/stdio tool/resource caller `AbortSignal` 与后台 SSE handler owner 已贯穿到 transport；recovery generation 仍须贯穿，stdio/Skill 子进程还须按 deadline 清理完整进程树。还须覆盖 run_skill 父级取消、即时 revoke、可执行字节身份绑定，以及“任意 stdio command 等价于信任本地代码执行”的明确边界。现有 Session Host MCP 场景只证明 ledger recovery fence，不是真实 transport 恶意矩阵。
4. 完成 native generation transaction 与公开发行链：POSIX pointer、PowerShell installer 与 OTA 需要统一 durable WAL/phase/commit decision、restart recovery 与 stale-lock 处置；任意阶段 taskkill/断电/fsync 后必须确定恢复。随后补齐 Linux/macOS/Windows x64 + ARM64 目标二进制实机、notarization/Authenticode/Linux 签名、fresh install/upgrade/rollback 及 Homebrew/WinGet/公开 manifest/asset 回读，不能用 cross-target synthetic skip 代替六目标真实 host。
5. 完成 P1 命令生命周期观察窗：在包含当前 OTLP 接线的发布版本上积累至少两个 minor cycle，报告 collector 覆盖与抽样偏差，并按 command 比较 legacy/replacement 用量后逐项决定兼容 alias 是否可移除；在此之前不得删除旧入口。
6. 完成真实磁盘、pipe、终端与长期运行矩阵：修正 EPIPE 直接 `process.exit(0)` 绕过 cleanup、stdout/stderr write(false) backpressure、stream 非 finally cleanup，以及 ENOSPC/EROFS 的 commit-state 语义；覆盖真实 TTY、SSH、screen reader、Windows/macOS clipboard 与键盘布局、1,000+ turns、超大 MCP output、20+ 并发 Agent、FD/handle/orphan/worktree 清理和长期 soak。各矩阵必须报告 p95、RSS、I/O、FD/handle/process-descendant 差值与 cleanup deadline，不能只记录“测试最终通过”。

当前总判定：**CLI npm 子范围 GO；完整产品实现仍为 NO-GO**。后续每关闭一个子项，都必须在本节追加 exact-SHA、矩阵范围、artifact 和未覆盖边界，不能改写历史失败，也不能用不同 SHA 的局部成功拼接授权。
