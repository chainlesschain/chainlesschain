# ChainlessChain CLI 对照 Claude Code CLI 补齐与优化方案

> 分析起始日期：2026-08-01；当前核验日期：2026-08-14
>
> ChainlessChain 历史候选基线：`packages/cli` v0.162.194 release candidate；v0.162.190 / v0.162.191 / v0.162.192 未发布；v0.162.193 已被非权威通用 workflow 发布且不得视为门禁通过。本次 CLI 发布核验基线为最终 release SHA `3e997168621c53708a1682868c6cc4edc9baf15b`（2026-08-14，PR #185）；公网 npm `latest` 为 v0.163.7，其 release SHA 同为 `3e997168621c53708a1682868c6cc4edc9baf15b`。v0.163.7 的 exact-SHA 发布子闭环已完成；当前收口和未完成项见第 18 节。
>
> Claude Code 参考基线：官方文档与 2.1.220 changelog（2026-07-25）
>
> 文档性质：现状审计、实施方案与持续进度记录；未标记“已完成”的项目仍是待办。第 14～17 节保留逐次历史证据，第 18 节是当前判定入口。

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
| P1 默认 Agent 与命令面 manifest                    | telemetry 汇总/决策工具完成，观察窗未满   | `6b2b394fd1`：修复 14 个域的嵌套帮助路由和跨 OS help 漂移，175 条命令写入 stability/category/visibility/replacement 元数据，默认命令与核心分组由 manifest 驱动；`c50d2f8a53` 以 `dao`、`evomap` 完成首批 `lab` 迁移，`1f2a9caf3d` 补强 lifecycle 契约。`0.162.194` 候选的第二批迁移 8 个明确标注旧版/in-memory governance 的入口，`56c87fa5d0` 又迁移 15 个内部 V2 governance overlay；原顶层拼写均至少保留两个 minor cycle，只在 stderr 发弃用提示。registered graph 仍为 175、净增长 0；deprecated compatibility entry 为 25，推荐面降到 151，manifest、README 与四种 shell completion 同源生成。显式启用 OTLP 的 migrated command 已增加无参数 lifecycle usage/duration 指标，区分 legacy 与 replacement route；当前变更集又增加 coverage/bias 输入、按 command 的 legacy/replacement 汇总及保守 remove/retain/insufficient-data artifact，且不会自动修改 alias。产品入口 `todo`、`subagent`、`webfetch`、`planmode` 仍保持 active。至少两个 minor cycle 的真实发布观察与代表性 collector 数据仍待积累；在此之前不能据工具输出删除旧入口                                                                                                                                                                                                                                                                          |
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

GitHub Actions [`CLI Session Scale` run `31085110318`](https://github.com/chainlesschain/chainlesschain/actions/runs/31085110318) 随后以 workflow-dispatch 输入 `commit_sha=f99f18e4cb3832b8848534186ba32756e98c66c9` 完成 Ubuntu、macOS、Windows 三个平台的 formal job，三份 artifact 内部 `expectedSha` / `exactSha` 均精确命中该实现提交、tree 均为 `82bfb6c040ec0fcf3d718448567552b8ec19a93c`，且 `trackedWorktreeDirty=false`、`gateSourcePathsExact=true`、violations 为空。每格均完成 20 writers × 1,000 append（20,000/20,000 唯一事件）、10,000 sessions、1 GiB verified transcript、15 个完整 CLI 冷进程样本、8 次真实进程强杀和 344 个 exhaustive byte cuts。macOS/Linux/Windows 的 indexed-list p95 分别为 `22.58/19.15/21.76 ms`，cold-process p95 分别为 `219.04/222.56/286.66 ms`，峰值 RSS 均低于 `76 MiB`。因此 **P0-5/P1-6 冷进程规模与 SLO 子项已取得指定 exact-SHA 三平台权威证据并关闭**；这不外推为第 16.8 节其余 Session 一致性、anti-rollback 或断电事务已经完成。

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

实现提交 `be01fe2249f4ff9f36382ed3ac446e50183420fa`（tree `8cce290ee6190bb2ba39adc1abd7dd2d3a0b4952`）关闭 `run_skill` 父级取消传播缺口：

- Headless、Stream、REPL 已产生的父级 `AbortSignal` 现在从 `agentLoop` 的 `toolContext` 继续贯穿 Skill 路径过滤、异步 materialize、执行摘要再授权、CLI 交互确认、受控命令 wrapper 与隔离 `SubAgentContext`；后者把信号链接到自身 controller 并继续传给子 `agentLoop`。预取消会在发现/创建子 Agent 前拒绝，在途授权与在途子循环会及时按父级原始 reason 退出；取消不再被投影成“正文加载失败”或“Sub-agent failed”，也不会追加迟到 tool message 或触发第二次模型调用。
- 新增 host-owned `raceWithAbort` 统一处理预取消、监听器注册竞态、listener 清理与迟到 Promise 结算；迟到授权成功不能写入执行摘要授权缓存，迟到子 Agent 成功/失败也不能复活已取消路径。若自定义 materializer、prompt adapter 或 child adapter 完全忽略信号，宿主仍只能退休父级等待并隔离其迟到结果，不能强制永不 settle 的底层 Promise 或完整进程树结束。
- clean exact implementation SHA 在 Windows x64 / Node `22.22.2` 上复跑 Skill 核心/消费侧单测矩阵为 **24 files / 593 tests passed**，父级/子 Agent/Headless/Stream/WS 取消矩阵为 **9 files / 133 tests passed**，Skill/persona integration 为 **3 files / 50 tests passed**，Skill command E2E 为 **3 files / 44 tests passed**。目标 Prettier、Node 语法、clean `git diff --check` 与 ESLint **0 errors** 均通过；ESLint 仅保留 `skill.js` 4 条、`agent-core.js` 23 条既有 warning。

实现提交 `8bded33d9a4b86f550863814f44fa80c747ef4a8`（tree `64c020fc5bf0564f42704cb14bc24b5027836441`）关闭同一 CLI Node runtime / JS isolate 内的 Skill 即时撤权缺口：

- `skill-loader` 新增宿主拥有的单调 `BigInt` execution-authority generation 与进程模块级 active lease 集合。任一 loader 调用 `revokeExecutionAuthorizations()` 都会同步推进 generation、以稳定 `CC_SKILL_EXECUTION_REVOKED` / `AbortError` 中断该 runtime 内所有未退休 lease；其他 loader 的旧 digest grant 即使仍留在私有 Map 中，也必须在下一次 cache read 前因 generation 不匹配而清空，不能继续作为授权。授权请求同时只公开 content-free generation 字符串，供宿主把确认绑定到精确代际。
- generation lease 贯穿异步 materialize/再授权、CLI `runControlledSkill`、`executeTool(run_skill)` 和隔离 `SubAgentContext` 子循环；授权 Promise、同步 authorizer、恶意 decision getter、模型/子 Agent 的迟到成功都必须在授权写缓存、创建子 Agent 或结果交接前复核同一 generation。`/reload-skills` 现在先撤销该 runtime 的 Skill grants 和在途 lease，再清 descriptor/body cache 并重扫；REPL 帮助及成功输出明确这一副作用。父级取消与撤权共享 signal 传播，但保持各自原始 reason/code。
- 对抗回归覆盖跨 loader 旧缓存失效、在途异步授权、同步授权回调内撤权、decision accessor 撤权、监听器注册竞态、受控命令迟到结果、隔离子 Agent 迟到结果和 `/reload-skills` 在重扫前中断 lease。clean exact implementation SHA 在 Windows x64 / Node `22.22.2` 上的 Skill 核心/消费侧矩阵为 **24 files / 601 tests passed**，父级/子 Agent/Headless/Stream/WS 取消与撤权矩阵为 **9 files / 139 tests passed**，Skill/persona integration 为 **3 files / 50 tests passed**，Skill command E2E 为 **3 files / 44 tests passed**。目标 Prettier、Node 语法、clean `git diff --check` 与 ESLint **0 errors** 均通过；被检查文件只保留 93 条既有 warning（`skill.js` 4、`agent-core.js` 23、`agent-repl.js` 66）。
- 该 generation 只存在于一个 ESM module instance / JS isolate；它不是 durable、machine-wide 或跨 Worker/子进程/独立 CLI/远端宿主的撤权 authority，也不持久化审计事件。撤权会立即退休宿主等待并隔离迟到结果，但忽略 signal 的底层 OS 进程仍须依赖尚未完成的完整进程树清理；package-owned trusted source 的后续新执行仍由 managed source trust policy 决定，而不是被一次 process grant revoke 永久 deny。

实现提交 `35e7d58d75d084466804d76410dab686d2781b0c`（tree `5fcfd4929270fa23d57614c763ca148da1c5c340`）把上述进程内 generation 扩展为同机、共享 `CHAINLESSCHAIN_HOME` 的 durable Skill execution authority：

- 权威状态固定为 `<CHAINLESSCHAIN_HOME>/state/skill-execution-authority.json`。每次 revoke 都先通过仓库统一的 strict cross-process lock 完成 generation 的原子 read-modify-write，再以 `fsync` 临时文件和原子 rename 发布，成功返回前 generation 已持久化；并发 Worker、子进程与独立 CLI 不会丢失推进。状态同时保存从 `0` 开始连续的 content-free 审计链（event ID、前后 generation、时间、PID、thread ID、稳定 reason code），不会持久化面向用户的撤权 message。
- loader 在授权缓存读取、lease 建立/复核和结果交接等 authority-sensitive transition 同步重读权威状态；活动 lease 另以 **50 ms nominal interval** 轮询，因此同一状态目录下的其他 Worker/子进程/独立 CLI 会中断在途授权与受控执行，并以稳定 `CC_SKILL_EXECUTION_REVOKED` 携带精确 generation。状态损坏、事件链断裂、活宿主已观察 generation 的回退，以及 lock/write failure 均失败关闭并中止本地活动 lease；`/reload-skills` 的 durable 审计 reason 固定为 `reload-skills`。
- 对抗回归使用真实 `Worker` 与真实 fork 子进程覆盖跨 isolate/跨进程活动 lease 中断、进程替换后的 generation 恢复、6 路并发 revoke 无丢失、损坏与 live-host rollback 失败关闭，以及原有跨 loader/授权竞态/迟到结果路径。exact implementation SHA 在 Windows x64 / Node `22.22.2` 上的 Skill/Agent Core 矩阵为 **27 files / 709 tests passed**，Skill integration 为 **4 files / 41 tests passed**，Skill/CLI-Anything E2E 为 **4 files / 57 tests passed**；目标 Prettier、Node 语法、`git diff --check` 与 ESLint **0 errors** 均通过（`agent-core.js` / `agent-repl.js` 保留 89 条既有 warning）。
- 本提交关闭的是同机且共享同一状态根的 recovery generation 与撤权传播，不是网络分布式 authority。不同 `CHAINLESSCHAIN_HOME`、远端宿主、被完全替换为旧快照后重新启动且没有活宿主高水位的独立 anti-rollback，以及 event loop 被阻塞时的 hard-real-time 中断保证仍不成立；这些边界不得从 50 ms nominal poll 或单机测试外推。

实现提交 `06c0653bd15d7f5d42e7363a545ef4cecc9bf64e`（tree `3001536ae0728114c619190071e55e7503e93cc2`）关闭 production MCP canonical stdio 的有界完整进程树清理缺口：

- stdio server 在 POSIX 上由独立 process group 持有；Linux strong workspace contract 存在时由 bubblewrap PID namespace/close fence 持有；Windows 则强制请求 Broker `process-tree` boundary，由 Job Object 防止根进程先退出后把后代变成不可枚举孤儿。普通配置不能移除 Windows boundary；Linux contract launch 保持 `detached:false`，非 contract POSIX launch 保持 group leader 身份。
- 新的共享 terminator 采用宿主上限 2,000 ms 的固定总 deadline 与最多 500 ms 的 grace：先关闭 stdin 并请求 `SIGTERM` / `taskkill /T`，未确认时升级为 process-group `SIGKILL`、Job root `SIGKILL` 或 `taskkill /T /F`。调用方配置只能收紧，不能以 `0`、非有限值或超大值关闭/放宽。结果分别记录 soft/hard request、escalation、root close、tree termination 与 deadline；direct-child fallback 永远不冒充 whole-tree proof。POSIX 必须同时观察 root close 与 group 消失，PID namespace/Windows Job 以 Broker close fence 为证，非 Broker Windows fallback 只接受成功的 `/T` tree walk 加 root close。
- 初始化/发现失败会在删除 registry 和移除 listener 前等待同一个 single-flight tree retirement，同时保留原始 connect error 并附加 content-free cleanup 结果；显式 `disconnect()` 在可验证树超期时固定失败为 `CC_MCP_STDIO_PROCESS_TREE_CLEANUP_TIMEOUT`，不再静默报告成功。根进程意外 `close` 也复用该 retirement：managed namespace/Job close 直接证明树为空，unmanaged POSIX close 后仍强杀并探测剩余 group，避免正常错误路径遗漏孙进程。
- Windows x64 / Node `22.22.2` 的真实回归启动一个不响应 MCP 握手的父进程及持续运行孙进程，确认 connect failure 返回前两个 PID 都已消失；目标终止/connect/真实树矩阵为 **3 files / 10 tests passed**。clean exact implementation SHA 上全部 `mcp-client*`、process-tree、相邻 headersHelper tree 与 Skill process-broker 矩阵为 **29 files / 275 tests passed**，另有 **1 file / 1 test** 因现有受限权限环境跳过；Broker platform/sync boundary 回归为 **2 files / 236 tests passed**。目标 Prettier、Node 语法、clean `git diff --check` 与 ESLint **0 errors** 均通过。
- 本项不扩张 Skill 权限事实：当前 production controlled `run_skill` 只暴露 `read_file`、`search_files`、`list_dir`，没有 OS spawn authority；`skill-process-broker` 仍是无 production consumer 的 legacy/future façade。因此本提交关闭 MCP stdio 子进程树，不证明未来若重新接入该 façade 时已有 host-owned dispose/deadline，也不关闭跨 Worker/进程撤权、任意 stdio command 的本地代码执行信任边界或三平台 artifact/长期 soak。

实现提交 `afbae6ffeb4931cd364fe80f609bb1c9d278c955`（tree `36bcdb77289378bb71c89a8254442310c43f8731`）关闭当前 Skill process-tree 的休眠权限面，而不是给无 production consumer 的 façade 伪造 lifecycle 证据：

- 全仓 production `src/` / `bin/` 没有 `createSkillProcessBroker` import 或 consumer；production `run_skill` 对非隔离 handler 固定返回 `CC_SKILL_DIRECT_HANDLER_BLOCKED`，不会 import `handler.js`、连接其 embedded MCP 或传入 process authority。隔离 Skill 只在 child Agent 中获得与父级 ceiling 相交的 `read_file`、`search_files`、`list_dir`，明确不携带 MCP client 或 process broker。因此原 `skill-process-broker.js` 的 `run` / `runSync` / `runFileSync` 只是不可达休眠权限，给它新增 `dispose()` 仍不能证明任何生产调用方会调用。
- 删除该 façade 及只验证固定 `policy: "allow"` 的孤立单测，并在真实 `agent-core` Skill 边界矩阵加入文件缺失守卫；这使当前 Skill OS child tree 的集合为空，也阻止后续代码在没有 source/digest approval、可执行字节身份、OS tree ownership、fixed deadline 与 host-owned dispose 证明时误接回旧 API。`capabilities: [shell-exec]` 现在只保留为 legacy descriptor/template metadata，不授予 runtime authority。
- CLI-Anything、CLI Pack 与 `init ai-*-creator` 仍会生成供迁移/检查的 legacy `handler.js`，相应 generator 测试继续直接注入 mock `processBroker` 验证模板逻辑；这些 inert output 不由 production `run_skill` 执行，不能外推为可运行能力或已批准的进程权限。current-design、IDE gap 与 2026-07-18 历史说明已同步修正，权威 spawn inventory 由生成器重建并保持 **357 matches / runtime 252 / brokered 183 / audited exemption 31 / non-executable 38 / unreviewed 0**。
- clean exact implementation SHA 在 Windows x64 / Node `22.22.2` 上的 Skill/Agent Core 矩阵为 **27 files / 626 tests passed**，legacy generator/handler integration 为 **4 files / 112 tests passed**，Skill/CLI-Anything E2E 为 **4 files / 57 tests passed**；spawn inventory check、目标 Prettier、Node 语法、clean `git diff --check` 与 ESLint **0 errors** 均通过。
- 本项的完成口径是“当前 production 零 Skill OS spawn authority”，不是承诺永远不再提供 executable Skill。未来若重新引入 handler/process capability，那是新的受门禁功能，必须先补齐上述身份、裁决、树持有、deadline、dispose 与三平台真实回归，不能把删除前的 façade 或模板 mock 当作既有授权。

实现提交 `21e36747fba0b528019578fe976ea775903546f5`（tree `b844e013efd0150e05f9616ff76f6cadd35aed79`）关闭 MCP stdio 配置可绕过来源信任、直接触发本地代码执行的入口：

- canonical `MCPClient.connect()` 在把 server 写入 registry 或调用 Process Broker 前，必须消费由宿主加载器签发的一次性对象 capability；普通 JSON 中的 `scope`、`origin`、`configSource` 等自报标签不能充当授权。capability 精确绑定 server name、command、args、env、transport、scope/origin/policy、配置来源、plugin 身份、sandbox policy，以及 project/plugin 的私有 workspace authority；配置篡改、伪造 token 与重放分别固定失败为 `CC_MCP_STDIO_EXECUTION_AUTHORITY_STALE` / `CC_MCP_STDIO_EXECUTION_AUTHORITY_REPLAYED`，缺失授权固定为 `CC_MCP_STDIO_LOCAL_CODE_TRUST_REQUIRED`。
- 消费授权后，client 从已批准 snapshot 重新物化独立的 command/args/env/sandbox/provenance，避免签发后修改原数组、环境对象或 sandbox graph 影响实际 spawn；token 不进入 server config 或子进程环境。stdio hot reconnect 只能从原 approval 续发绑定同一 invocation 的新一次性 token，resolver 若改变命令、参数、环境或私有来源 authority 就失败关闭。
- 签发点只位于已经通过各自门禁的生产入口：显式 `--mcp-config`、managed settings、持久注册配置、fingerprint-trusted project `.mcp.json`、trusted plugin，以及用户显式选择且帮助文本已声明可能执行本地 MCP 命令的 Agent bundle。`cc mcp` 的 query/doctor/connect 统一经过同一授权 helper；未经 project fingerprint trust 的文件型 stdio row 不能连接。Skill/Cowork 模板不再因声明 `mcpServers` 自动获得进程权限，宿主必须提供返回严格 `true` 的显式 local-code approval callback，否则在创建 client/spawn 前跳过。
- clean exact implementation SHA 在 Windows x64 / Node `22.22.2` 上的全部 `mcp-*` 回归为 **75 files：74 passed / 1 个平台条件 skip，1114 tests passed / 1 skipped**；其中真实 stdio 父子进程树回归包含在内。帮助索引/Agent runtime/Cowork/Skill 相邻矩阵为 **6 files / 152 tests passed**，最终 loader/transport 聚焦复跑为 **7 files / 101 tests passed**；生成帮助索引检查、目标 Prettier 与 `git diff --check` 通过。
- 本提交关闭的是“任意调用方仅凭 `{command,args}` 即可让 canonical MCP client 执行本地代码”的授权绕过，不是可执行内容身份闭包。PATH 解析后的 binary、解释器脚本、`npx`/`uvx` 等动态 launcher 的实际下载与模块字节仍未绑定到批准时 digest，也没有消除授权到 OS 打开可执行文件之间的 pathname/byte TOCTOU；这些继续作为下一批独立任务，且本地测试不能替代三平台 artifact/长期恶意 soak。

实现提交 `99883589ad9400ca26ff39a571ab5733d70f0755`（tree `b7170c981bc06906d0a26fd5d264de879143e700`）进一步关闭 canonical MCP stdio 的 direct executable 与已识别解释器 entrypoint 字节漂移窗口：

- client 只接受前述 loader-issued execution approval，并在 spawn 前把 PATH/PATHEXT 命令解析为 canonical real path；command 以及 Node/Python/shell/PowerShell/Java `-jar`/dotnet `.dll` 的直接 entrypoint 都通过 open descriptor 读取，绑定 regular non-symlink file identity、大小、时间元数据与 SHA-256。首次使用固定返回 `CC_MCP_STDIO_EXECUTABLE_TRUST_REQUIRED`，`cc mcp trust-executable <name>` 会输出并持久记录供人复核的精确路径与 digest；之后任一已绑定文件变化固定返回 `CC_MCP_STDIO_EXECUTABLE_CHANGED`，除非再次显式 trust。durable store 使用 strict cross-process lock、atomic replace 与 corrupt-store fail-closed，且不持久化 MCP env value。
- `npx`、`uvx`、`bunx`、`npm`、`pnpm`、`yarn`、`pipx`、`corepack` 等会在自身 binary 之外解析/下载代码的 dynamic launcher 不能用 launcher hash 冒充 package identity，现固定以 `CC_MCP_STDIO_DYNAMIC_LAUNCHER_UNPINNED` 拒绝。direct shebang launch 同样拒绝，必须显式配置 interpreter + local script 才能同时绑定两者。因此现有 registry 中以 `npx -y ...` 表示的 catalog 配置只能用于发现/安装记录，尚不能连接；后续需要独立的固定版本 materialization/package-byte lock 工作流，不能把本项外推为 npm package 已钉住。
- identity approval 产生单次 WeakMap object capability，精确绑定 canonical command/args 与 identity digest。Process Broker 在 sandbox/credential plan 完成后、调用 native `spawn` 前消费 capability 并重新从文件描述符复验全部字节；改参、改文件、伪造或重放都在 native spawn 前失败，私有 token 会从 child options 删除。真实 Windows stdio 父/孙进程回归已改为穿过 Broker，验证该 identity gate 与既有 Job/tree retirement 同时生效。
- clean implementation SHA 在 Windows x64 / Node `22.22.2` 上的完整 MCP 矩阵为 **78 files：77 passed / 1 个平台条件 skip，1167 tests passed / 2 skipped**；Process Broker 专项为 **6 files / 260 tests passed / 2 skipped**，真实 stdio process-tree 独立复跑 **1/1 passed**。新增 identity 对抗覆盖 first-use、显式 trust/retrust、entrypoint 改字节、approval 后改字节、Broker 零 native spawn、token replay、dynamic launcher、corrupt store 与 env canary；命令帮助、生成 help/manifest/completion 检查、目标 Prettier、`git diff --check` 与 ESLint **0 errors** 均通过（只报告既有 warning）。
- 本项的完成口径限于 direct command 与明确识别的 direct interpreter entrypoint。durable identity store 仍缺独立 anti-rollback anchor；最终 descriptor re-attestation 到 OS 按 pathname 再次 open/exec 之间仍有很小的非原子 TOCTOU；动态 import/module、native DLL/shared library、解释器内部再加载文件及自定义/改名 runtime 等传递依赖没有形成闭包。再加上 Linux/macOS exact-SHA artifact 与长期恶意 race/soak 尚缺，完整 Skill/MCP 产品项继续 **NO-GO**。

实现提交 `3f610f3f837f4f16bd68d9fc39cfb2084e8820ed`（tree `e77fc917aac65fe12515f69825e31c2311dce0c8`）关闭上述 durable MCP executable identity store 可被单独恢复旧快照的缺口：

- trust store 现在由独立 generation witness 绑定完整 store digest。每次 trust/retrust 都在同一严格跨进程锁下执行 `pending witness fsync → atomic store replace/fsync → committed witness fsync`；启动发现 pending 时，只允许当前 store 精确匹配 mutation 前态并撤销 pending，或精确匹配后态并补记 commit，其余组合统一以 `CC_MCP_STDIO_EXECUTABLE_IDENTITY_ROLLBACK` 失败关闭。首次迁移在一次已获准访问后把既有 store 绑定为 generation 0；corrupt store/witness、锁或持久化失败仍拒绝执行，不把丢失/损坏 authority 当作空 trust。
- 新对抗测试覆盖 store-only 旧快照恢复、pending 停在 store replace 前后两侧的确定恢复、不同 CLI home 仍使用同一外部 security anchor，以及既有 first-use/trust/retrust、pre-spawn byte race、Broker token replay、dynamic launcher 与真实 stdio process-tree。Windows x64 / Node `22.22.2` 上，完整 `mcp-*` 集合以单 worker、文件串行和 30 秒单测上限复跑为 **63 files：62 passed / 1 个平台条件 skip，898 tests passed / 2 skipped**。较早的并行复跑先暴露一个旧 `paths.js` 全量 mock 缺少新 authority export 的收集失败，修正为临时 home/state/外部 security anchor 的 partial mock 后，又有 `mcp-prompts-resources` 一例在 15 秒处因整批资源争用 timeout；该文件同一 tree 隔离复跑 **23/23 passed**，最终串行完整矩阵才是本节采用的结果。目标 Node 语法、Prettier、ESLint 0 errors 与 `git diff --check` 均通过。
- 该 witness 是同 OS 用户的 cooperating-process authority，不声称抵抗同 UID 攻击者同时回滚 trust store 与 witness，也不提供远端宿主共识。descriptor re-attestation 到最终 OS pathname `exec/open` 仍非原子，dynamic launcher 的固定版本 package materialization、解释器/module/native library 的传递依赖闭包，以及 Linux/macOS exact-SHA 恶意 race/长期 soak 仍未完成；因此第 16.8(3) 项继续 **NO-GO**。

上述增量只证明 **production Node WHATWG `ReadableStream` 上的有限 HTTP response body、成功正文的 host-owned 绝对 deadline、非 2xx HTTP body 零读取/零传播、HTTP/SSE `200` JSON-RPC error 的固定投影与防误重试、无 byte reader 成功 response 的固定 fail-closed、response callback deadline 的固定投影、后台 SSE 单事件字节/绝对时间预算与 handler-owner 生命周期、`ws` 单消息 wire/解压 payload 内存上限及普通 JSON 配置收紧、stdio 完整/未终止 stdout frame 的 UTF-8 字节上限、stderr 原文隔离/累计预算、malformed JSON frame 次数/字节累计预算、stdio/WS/后台 SSE 的持续有效消息速率与滚动累计流量预算、五条入站 JSON 路径的 parse 前深度/节点预算与共享对象边界的 descriptor-only 迭代复核、MCP tool schema/description 的逐项与聚合预算、MCP `tools/call` 最终 result 的专用接纳与 ledger/model/stream 失败关闭、MCP canonical stdio 的 Broker/进程组持有与 fixed-deadline whole-tree retirement、MCP stdio 一次性本地代码执行授权与同 invocation 重连绑定、MCP stdio direct command/recognized interpreter entrypoint 的 durable SHA-256 identity 与 Broker pre-spawn re-attestation、当前 production 的零 Skill OS spawn authority、Skill 文件/递归发现/主模型与隔离子 Agent 投影的逐项及聚合预算、`run_skill` 父级取消传播与迟到结果隔离、同机共享 `CHAINLESSCHAIN_HOME` 的 durable Skill authorization generation 撤权、ToolSearch token 估算失败关闭、peer `1009` 的方向中立 outcome-unknown、泛 WS close 的固定投影/结果未知防重放/elicitation waiter 清理、HTTP discard-response 与普通 HTTP tool/resource 主请求的 cancel/deadline/断连生命周期，以及普通 WS/stdio tool/resource 请求的 caller cancellation 生命周期**。合法 `-32042` 的四个 allowlist 字段仍会按协议进入显式用户 elicitation，不能外推为“所有 peer 内容都被删除”。非标准 fetch 若忽略 `AbortSignal`，宿主可以退休 controller registry/后台 stream 并拒绝或清理 late success，却不能强制一个永不 settle 的 adapter Promise/底层请求结束；非标准 response 若没有可用 `body.cancel()` 也只能保证零读取，不能强制其底层 socket 关闭。共享 token bucket 已覆盖持续有效消息速率与滚动累计流量；为避免健康永久连接必然耗尽，这不等同于 lifetime total。不同状态根/远端宿主撤权、可执行 identity store 的独立 anti-rollback anchor、最终 re-attest 到 OS exec/open 的原子 pathname/byte 绑定、传递依赖闭包、三平台 artifact 与长期 soak 仍不在本节范围内，因此完整 Skill/MCP 产品项继续 **NO-GO**。

实现提交 `16cb2f7a1b79d791b7801cb269705039641649b1`（tree `335831056d2661550d480fb9f529c6bc17f96f0d`）关闭 exact `npx` + direct Node bin 的固定 npm 依赖闭包子项：

- 新的显式命令 `cc mcp materialize-package <name> --package <name@version> [--bin <name>]` 只接受与已授权 stdio invocation 完全一致的 registry package 精确版本；tag、range、package 漂移、非 `npx` source 和 native/secondary-runtime bin 均失败关闭。安装固定经 Process Broker 以 argv/`shell:false` 调用当前 Node + `npm-cli.js`，带 `--ignore-scripts`、exact save、lockfile、nested strategy、no-audit/no-fund/omit-dev，并在安装进程和最终 MCP 进程两处剥离 `NODE_OPTIONS`、`NODE_PATH`、`NPM_CONFIG_NODE_OPTIONS`、`LD_*`、`DYLD_*`、Python/Ruby/Perl/Java/.NET 等代码注入环境变量。
- materializer 要求 package-lock v2+，逐项拒绝缺 exact version、HTTPS `resolved` 或 sha512 integrity 的所有非 root/非 link 条目；随后拒绝 symlink/special file，按文件数、单文件、总字节和深度预算以 descriptor 哈希完整 tree（仅排除 npm 生成的 `.bin`），把 approval fingerprint、lock digest、entrypoint、参数和 closure digest 发布为 content-addressed generation。运行时不再调用 `npx`，而是以当前 Node、`--no-global-search-paths`、generation 内直接 entrypoint 和原透传参数启动；materialization index、既有 executable trust witness 与 Broker pre-spawn 全树复验共同拒绝 extra/missing/changed file、旧 index 回滚和环境二次注入。
- Windows x64 / Node `22.22.2` 在该 exact code SHA 上串行复跑完整 `mcp-*` 矩阵为 **64 files：63 passed / 1 个平台条件 skip，905 tests passed / 2 skipped**；IDE roadmap 两项安全门为 **2 files / 8 tests passed**。命令帮助索引、Process Spawn Inventory（runtime `unreviewed: 0`）、目标 Prettier、`git diff --check` 与 ESLint **0 errors** 均通过（9 个既有 warning）。fixture 对抗覆盖 exact/range、完整 transitive lock、generation 复用、直接 Node 替换、ambient env 剥离、额外文件竞态、缺 integrity、materialization index 回滚和 Broker npm argv；本地未访问公网 registry，因此这些结果不冒充真实供应链下载或三平台 artifact。
- 在 `16cb2f7a1b` 这个历史切片上，完成口径严格限于 exact npm package、`npx` source 和直接 Node bin；当时 `uvx`/`bunx`/`pnpm`/`yarn` 等 launcher、自定义/改名 runtime、native bin、运行期动态 import 与外部 module/DLL/shared library 仍没有闭包。后续 launcher 与 Node 胶囊增量见第 16.9 节；descriptor re-attestation 到 OS 最终 `exec/open` 的非原子性、远端宿主 revoke、Linux/macOS exact-SHA 恶意 race 与长期 soak 在该切片上仍未完成。

实现提交 `b4990364f26c22925d4ddce74b497ae7eb7e4a53`（tree `64032dbfd1d3f32b6e8266c42260fe3f8ca246ae`）关闭 CLI 输出 EPIPE 直接跳过 teardown 的明确子项：

- 共享 pipe guard 的默认行为不再调用 `process.exit()`，而是设置 clean `exitCode` 并把控制权交回生命周期 owner；每次安装只处理一次 stdout/stderr EPIPE，提供 disposer，重复的进程内 invocation 不再保留旧 session callback。
- single-turn headless 与 stream-json 都把 EPIPE 转为独立 `AbortSignal`。single-turn 会穿过原有 `finally`，再结算 MCP、background shell、remote approval 与 Stop/SessionEnd hooks；断管后不再写最终 envelope 或持久化 partial assistant answer。stream-json 会同时中止当前 turn、唤醒等待新 stdin event 的空闲循环、停止仍处于 flowing 状态的输入流，然后执行 MCP/remote approval/SessionEnd 清理并返回 0，避免输出消费者已退出但 stdin handle 仍令进程存活。
- REPL 不再在 readline 尚未建立时直接退出：早到 EPIPE 只登记 pending clean close，等完整 `close` handler 注册后才触发；cleanup 使用 single-flight guard，既有 session persistence、MCP disconnect、background child、plugin monitor、hook supervisor、PATH/env restore 与 runtime shutdown 先完成，最后才沿用正常 close 终点。
- Windows x64 / Node `22.22.2` 的 final implementation tree 上，pipe/headless/stream/REPL 四个核心文件为 **4 files / 239 tests passed**；stream interrupt/approval/question 相邻文件为 **3 files / 25 tests passed**。八文件串行合跑为 **265 passed / 1 个既有 async-hook 用例在默认 5 秒处 timeout**；该 async-hook 文件随后在相同 final tree 上隔离复跑 **2/2 passed**，因此 timeout 只记录为并行/整批资源争用证据，不能写成单次 266/266。新增故障注入明确验证默认 guard 零 `process.exit()`、双输出 dedup/dispose、single-turn MCP cleanup、stream 空闲唤醒 + Node live input destroy + MCP cleanup，以及 REPL early-EPIPE wiring。Node 语法、目标 Prettier、`git diff --check` 与 ESLint **0 errors** 通过（仅既有 warning）。
- 本提交没有关闭 stdout/stderr `write(false)` backpressure、stream-json 非 EPIPE 异常的顶层 cleanup、ENOSPC/EROFS commit-state、真实 OS pipe/TTY/SSH/screen-reader/clipboard/键盘布局、FD/handle/process-descendant deadline 或长期 soak；上述矩阵仍须在 Linux/macOS/Windows exact SHA 上形成带 p95/RSS/I/O/资源差值的 artifact。因此只把“EPIPE 直接 `process.exit(0)` 绕过 cleanup”从第 16.8 节剩余项中移除；stream-json 通用异常 cleanup 由后继 `f7c869946e` / `e306837d5c` 单独结算，完整长期可靠性任务继续 **NO-GO**。

实现提交 `f7c869946e3bddc29ea5b7f2e89fabce062d2580`（tree `12295a0e9ec1ec9d76fed8cb005a2b2eae058dd7`）与 output-cleanup follow-up `e306837d5c6c849d84b589ec9d27066fd321078c`（final tree `599968f036aa4a8f49a48cb6aee11c089c8b4fec`）关闭 stream-json 只在正常尾部清理资源的缺口：

- `runAgentHeadlessStream()` 现在由最外层 `try/catch/finally` 持有 single-flight cleanup；pipe guard 安装、workspace admission、初始化、任意 early return、运行期 throw 与正常 EOF 都先结算 cleanup，再决定返回原 outcome、返回 EPIPE 的 clean 0，或重新抛出原错误。cleanup 自身某一 disposer 失败不会阻止后续 disposer，也不会覆盖原始运行错误；正常尾部复用同一 promise，因此外层 `finally` 不会双关资源。
- 资源在成功获取后立即登记，而不是依赖函数尾部仍能访问局部变量：Node live stdin 与 async iterator、挂起 approval/question 的 timer/promise、stream coalescer 的延迟 flush timer、MCP client、remote approval bridge 及 SessionEnd hook 均进入统一所有权。EPIPE 或调用方 abort 会立即停止输入并 fail-closed 结算挂起 approval/question，避免当前 turn 等待人机交互时反过来阻塞 `finally`；其余 MCP/remote/hook teardown 在最终 cleanup 中按固定顺序执行。
- 新故障注入覆盖三条此前会泄漏或掩盖错误的路径：MCP 已连接后 elicitation handler 安装抛错且 `disconnectAll()` 也抛错时，仍销毁 live input、清除 coalescer timer、调用 MCP disconnect、执行 SessionEnd 并保留原始 setup error；remote bridge 获取成功后 pairing output 抛错，bridge 仍只关闭一次；调用方 abort 发生在 approval pending 时，approval 固定 deny、live stdin 退休且 session 正常收束。既有 EPIPE 用例同时证明正常尾部与 outer finally 复用 cleanup 时 MCP 只断开一次。
- Windows x64 / Node `22.22.2` 的 final tree 上，全部 `headless-stream*.test.js` 以串行、单测 15 秒上限复跑 **19 files / 233 tests passed**；15 秒只用于规避本机重载全部 CLI runtime 时既有 5 秒单测阈值造成的资源争用 timeout，不是生产 cleanup deadline。目标 Node 语法、Prettier、`git diff --check` 与 ESLint **0 errors** 通过（仅既有 3 个 warning）。
- 本项关闭的是 production stream-json 已登记资源在所有可捕获 return/throw 路径中的顶层 cleanup，不证明任意第三方 async iterator 都能被宿主强杀：自定义 iterator 若同时忽略 `.return()` 且没有 `destroy()`/`pause()`，宿主只能撤销自身等待与引用。它也没有给 MCP/remote disposer 新增统一绝对 deadline，不覆盖 `write(false)` backpressure、磁盘故障、真实三平台 pipe/TTY 或长期资源 soak；这些仍保留在第 16.8 节。

实现提交 `b03a2d112bf4158113e69345a80bd44c2a637ded`（tree `f1664b6536a39aac141ff44830cb5dac881b20d7`）关闭 production single-turn headless 与 stream-json 两条机器输出主路径忽略 stdout/stderr `write(false)` 的明确缺口：

- 新增共享 Writable backpressure gate：原生 `write()` 首次返回 `false` 后不再继续向 Node Writable 写入，后续 chunk 进入 host-owned FIFO，并在 `drain` 后保持顺序继续写；host queue 默认上限为 1 MiB，超过上限固定以 `CC_OUTPUT_BACKPRESSURE_OVERFLOW` 失败关闭。同步/异步 stream error 都会拒绝 waiter 并中止输出 owner，EPIPE 保留既有 clean-pipe 语义并继续穿过顶层 cleanup。测试注入的 `writeOut` / `writeErr` 仍保持原同步、逐 chunk 字节兼容语义，不伪造 Node stream backpressure。
- single-turn runner 在每个 agent event 后等待 stdout/stderr drain，顶层返回前再次结算最终 result、text、OTLP notice 等输出；stream-json 的每个 agent event 与串行输入 event 之间执行同样的 drain barrier，coalescer flush 和最终 `system/end` 也由最外层 waiter 收口。输出失败会通过独立 abort signal 终止仍在运行的 turn；pipe safety 与 gate 共同持有实际注入/production stdout、stderr，而不再遗漏 direct stderr notice。
- Windows x64 / Node `22.22.2` 的 implementation tree 上，真实 Node `Writable({highWaterMark:1})` 回归为 **1 file / 7 tests passed**，明确验证首次 `false` 后零额外 native write、FIFO drain、1 MiB host queue 的可配置故障注入上限、同步/异步 EPIPE、注入 writer 兼容，以及 single-turn/stream-json 都在第一个模型事件处停止消费直至真实 `drain`。完整 `headless-stream*.test.js` 串行矩阵为 **19 files / 233 tests passed**，完整 `headless-runner*.test.js` 串行矩阵为 **9 files / 110 tests passed**；核心四文件合跑为 **4 files / 141 tests passed**。目标 Node 语法、Prettier、`git diff --check` 与 ESLint **0 errors** 通过（仅既有 7 个 warning）。
- 本项没有给永久不 `drain`、也不发 error 的第三方 Writable 增加超时；最终 waiter 会按真实 backpressure 等待，因此统一且可量化的 cleanup deadline 仍是独立未完成项。1 MiB 限制约束的是首次 native `write(false)` 之后的 host queue，不声称拆分或缩小已经交给 Node 的单个 chunk。REPL/readline/TTY 写入尚未接入同一 gate；stream-json 为保持 interrupt/approval/question 能即时打断当前 turn，独立的并发 stdin control pump 也不由 stdout drain 暂停。真实三平台 pipe/TTY、FD/handle、长期 soak 与磁盘故障仍未完成，完整长期可靠性任务继续 **NO-GO**。

实现提交 `4224729be8a82268bbfec039a1f8c920f1356ee3`（tree `9c5fa636753818b55413374b1b56d75a25c4eccf`）继续关闭 production REPL/readline/TTY 忽略 stdout/stderr `write(false)` 的实现缺口：

- primary Agent REPL、legacy Chat REPL 与 background dashboard 现在在各自生命周期内直接给实际 stdout/stderr 安装同一有限 backpressure gate，因此 readline prompt、logger 和既有 direct write 等传递写入无需逐点改写也会在首次 native `write(false)` 后进入有界 FIFO；退出或 setup 失败会恢复原始 `write` method，stdout/stderr 指向同一 Writable 时只安装一个可恢复 owner。gate 同时保持 Node `write(chunk[, encoding][, callback])` 签名，并以稳定失败通知尚未下发的 write callback。
- Agent provider 的 Ollama/OpenAI/Anthropic 流式读取会等待异步 token/thinking sink 结算后才读取下一行；legacy Chat provider 同样在 terminal drain 期间暂停 provider stall timer，并在继续读取前重置监测。输出队列溢出或 stream error 不再被 partial-response/best-effort callback 语义吞掉：Agent REPL 会 abort 当前 turn 并关闭 readline，Chat REPL 与 dashboard 会停止当前 owner；EPIPE 仍结算为 clean pipe，其他输出故障结算为失败。single-turn headless 的 provider fallback notice 也已改走既有受控输出 owner，不再旁路 raw stderr。
- Windows x64 / Node `22.22.2` 的 implementation tree 上，REPL/provider/TTY 定向矩阵为 **13 files / 229 tests passed**，包含真实 `Writable({highWaterMark:1})` 的 readline 传递写入停顿、FIFO drain、共享流恢复、discarded callback 失败结算、provider 下一次 read 节流、Chat REPL close 恢复和 dashboard drain；完整 `headless-stream*.test.js` 串行矩阵为 **19 files / 233 tests passed**，完整 `headless-runner*.test.js` 串行矩阵为 **9 files / 110 tests passed**。目标 Node 语法、Prettier、`git diff --check` 与 ESLint **0 errors** 通过（仅既有 93 个 warning）。
- 本项仍未新增统一 cleanup deadline；对永久不 `drain`、也不发 error 的第三方 Writable 不会伪造成功。ENOSPC/EROFS commit-state、真实 Linux/macOS/Windows pipe/TTY/SSH/screen-reader/clipboard/键盘布局、FD/handle/process-descendant 指标及长期 soak 也尚未关闭。三平台与严格沙箱结果必须由包含本提交的 final exact SHA GitHub Actions artifact 验证，不能用本地 Windows 结果代替；因此完整长期可靠性任务继续 **NO-GO**。

### 16.8 仍未完成的产品级任务

1. **已完成：三平台 `CLI Session Scale` formal matrix。** GitHub Actions run [`31085110318`](https://github.com/chainlesschain/chainlesschain/actions/runs/31085110318) 的 Ubuntu、macOS、Windows 三格均从输入指定的实现 SHA `f99f18e4cb3832b8848534186ba32756e98c66c9` checkout，artifact 内部 exact/expected SHA、clean tracked worktree 与 gate source tree 均验证通过；每格的 20 个 writer × 1,000 次 append、10,000 sessions、1 GiB transcript、15 个完整 CLI 冷进程样本、8 次真实进程强杀与 344 个 exhaustive partial-record cuts 全部成功且 violations 为空。该证据关闭第 1 项，但不替代后续代码提交各自需要的回归与 release gate。
2. **部分完成：Session 事实源与本地竞态闭包。** 当前变更把 canonical authority 扩展到 damaged/tombstoned/conflict prefix namespace，ambiguity 一律失败关闭；interactive/recent picker、feature flag 关闭场景、legacy fallback、resume/show/export/delete/rename、mirror push/prune、FTS/search/raw SQLite index 均改为同一 verified authority，损坏 canonical 不再被 legacy DB、缓存行或远端 prune 掩盖。append 改为描述符固定的 `O_APPEND`/`O_NOFOLLOW`（新文件 `O_EXCL`），在写入前后复核 FD/path 物理身份并拒绝同大小内部改写、prefix deletion 与同字节 pathname replacement；删除后重建由 store-owned generation authority 绑定前代 tombstone/head/count，marker 即使在 meta 丢失后仍保留 predecessor，恢复旧 transcript 与重复 live genesis 均失败关闭。本地去重后的相关矩阵为 14 files / 345 tests passed（store/index 2 files / 120、相邻消费者 13 files / 229，其中 `session-list-index` 重叠计入两组）。后续增量又加入同机共享状态根的 durable session-host lease：严格跨进程锁、单调 fencing token、TTL/heartbeat、活 PID 不接管、已死亡宿主 hard-exit takeover 与 `AbortSignal` 撤权；Headless、stream-json、REPL（含 `/session resume` 切换）和 WebSocket 均在 canonical admission 前持有租约，所有 canonical transcript/authority writer 在同一租约下复核。非 MCP `write_file`/shell/git push/publish 等副作用现在统一执行 `prepare→started` authority 预写并再次校验租约，只有随后才允许 generator 进入真实工具；结算为 committed/failed，崩溃留下的 started/unknown 在恢复时要求先核验而不盲目重放。真实 fork 子进程回归证明第二进程被拒绝、原宿主 hard exit 后 fencing token 单调推进；四类宿主生命周期与 REPL 预写失败关闭也有定向测试；提交前本地串行聚焦矩阵为 13 files / 512 tests passed。最新增量再把 anti-rollback 高水位放到 `CHAINLESSCHAIN_HOME` 之外的 OS 用户安全目录（Windows LocalAppData、macOS Application Support、Linux XDG state），按配置 home digest 隔离、用 256-way namespace bucket 做 ID 发现，并以每 session append-only/fsync 记录在严格跨进程锁下单调绑定 generation/status/head/count；只有已验证的 prefix advance、精确 tombstone 或绑定前代的 successor generation 才能推进。外部高水位现在参与 presence、prefix、list、metadata、verified read、append、fork/branch 与 delete，因而 transcript/meta/tombstone 整体丢失后删除身份仍可发现，恢复旧 live head 或 predecessor generation 均以 `CC_SESSION_ANTI_ROLLBACK_DETECTED` 失败关闭；无 hash 的历史 raw JSONL 不会被自动认证，须先走既有迁移/显式删除路径。新增矩阵连同上一增量串行为 15 files / 536 tests passed。当前代码闭包仅剩在最终待发布实现提交上形成三平台 exact-SHA artifact；该权威证据形成前第 2 项整体仍不标记完成。
3. 完成 Skill/MCP 真实恶意矩阵：第 16.7 节关闭了 production Node `ReadableStream` 的有限 HTTP response body、有限成功正文的 host-owned 绝对 deadline、非 2xx error body 零读取/零传播、HTTP/SSE `200` JSON-RPC error 固定投影与防误重试、无 byte reader 成功 response 的固定 fail-closed、response callback deadline 的固定投影、malformed HTTP JSON 和 WS malformed/binary frame 的固定 non-retryable error、后台 SSE 单事件字节/绝对时间预算与 handler-owner lifecycle、`ws` 单消息 wire/解压上限及普通 JSON 配置收紧、stdio 完整/未终止 stdout frame 的 UTF-8 字节上限、stderr 原文隔离/累计预算、malformed JSON frame 次数/字节累计预算、stdio/WS/后台 SSE 的持续有效消息速率与滚动累计流量预算、HTTP JSON/request SSE/后台 SSE/WS/stdio 的 parse 前 JSON 深度/节点预算与共享对象边界复核、MCP tool schema/description 的逐项与聚合预算、MCP `tools/call` 最终 result 的逐项预算及 ledger/model/stream 失败关闭、MCP canonical stdio 的 Broker/进程组持有与 fixed-deadline whole-tree retirement、MCP stdio 一次性本地代码执行授权与同 invocation 重连绑定、当前 production 零 Skill OS spawn authority、Skill 单文件/身份组件合计/递归目录项与文件数/总字节/深度预算、SkillImprover 读取预检、persona 聚合及主模型/隔离子 Agent 最终投影复核、`run_skill` 父级取消传播与迟到结果隔离、同机共享 `CHAINLESSCHAIN_HOME` 的 durable Skill authorization generation 撤权、ToolSearch token estimator 的失败关闭、peer `1009` 的方向中立 outcome-unknown、泛 WS close 的固定投影/结果未知防重放/elicitation waiter 清理、HTTP notification/server response/DELETE 的 body cancel、普通 HTTP tool/resource 在途请求的 caller cancel/宿主 deadline/断连/late-success fencing，以及普通 WS/stdio tool/resource 请求的 caller cancellation。明确的有效 RPC application rejection 结算为已知失败；真正的 dispatch/transport 不确定性对非幂等 `tools/call` 继续保持 outcome-unknown 且不自动重放。普通 HTTP/WS/stdio tool/resource caller `AbortSignal`、后台 SSE handler owner 与 `run_skill` 父级/同机共享状态 revoke signal 已贯穿各自 transport/隔离子循环；MCP canonical stdio 根进程的 connect failure、显式 disconnect 与意外 close 已按 deadline 退休完整 owned tree。当前受控 `run_skill` 不执行 legacy handler，休眠 `skill-process-broker` 已删除，因此不存在待清理的 production Skill OS child tree；未来恢复 executable handler 是必须重新通过身份/裁决/tree/deadline/dispose 门的新功能，而不是当前未完成 lifecycle。同机共享机器 authority 的 recovery generation 已贯穿不同 `CHAINLESSCHAIN_HOME`、Worker、子进程与独立 CLI；远端宿主 revoke 仍缺分布式 authority/共识边界。现有 Session Host MCP 场景只证明 ledger recovery fence，不是真实 transport 恶意矩阵。
   第 3 项末尾原列的“可执行字节身份绑定”已由 `99883589ad`、`3f610f3f83`、`16cb2f7a1b`、`c06c7a449c` 与 `451286fe43` 继续缩减：direct command 与已识别解释器 direct entrypoint 的 durable SHA-256 identity、显式 trust/retrust、Broker pre-spawn 复验、identity store 的独立 generation/digest anti-rollback witness，以及 exact JavaScript package launcher 的固定 npm provenance closure 与单文件 guarded CJS execution capsule 已完成。受支持的源入口现包括 `npx`、`npm exec`、`bunx`、`pnpx`、`pnpm dlx`、`yarn/yarnpkg dlx` 与 `corepack {pnpm|yarn} dlx`；它们只用于选择同一个 exact npm package，运行时不会执行这些动态 launcher 或 live `node_modules` entrypoint，未知 resolver flag 与不精确版本均失败关闭。普通静态 JS 依赖被打入胶囊，保留的动态 `require`/`import()` 被运行期 module guard 拒绝，native `.node` addon 在构建期拒绝，不能再把这一受限 exact npm Node 路径的常规模块闭包记为未实现。`pipx`/`uvx` 属于非 npm 生态，当前稳定拒绝且只有新增独立、完整的 Python materializer 后才可开放。现存任务是 re-attest 到 OS `exec/open` 的原子 pathname/byte 绑定、自定义/改名 runtime、native bin 与任意 DLL/shared-library 装载闭包、远端宿主 revoke，以及 Linux/macOS exact-SHA 恶意 race/长期 soak；受信任 MCP 代码仍可调用允许的 Node builtin，最终进程/文件系统隔离必须由平台 sandbox 证明，不能把胶囊 guard 外推成恶意代码沙箱。

4. **部分完成：native generation transaction 本地实现闭包，公开发行链待 formal 证据。** 截至实现提交 `ec35c18a7bff7b55636fa68ce311d391cd2b3dd8`（tree `57c1c3d6ebc572a5621359d93555b594133a7b09`），POSIX pointer installer、POSIX/Windows OTA 与 PowerShell installer 已统一接入 durable sidecar journal、明确 phase/commit decision、精确 target/alias/backup/lineage prestate、restart/offline recovery、stale-lock/owner PID 处置及恢复失败时的锁保留；CLI 启动遇到 Windows 待恢复 generation 会以固定重启码调度可信系统 `cmd.exe`/打包内固定 `install.ps1`，等待旧进程退出后再恢复，文件共享冲突只在重验 generation 身份后做有限退避重试。Windows x64 / Node `22.22.2` 本地最终矩阵中，完整 pack update applier 为 **1 file / 68 tests passed**，完整 native installer transaction 为 **1 file / 20 tests passed / 53 个非本 host 用例按平台跳过**，package/startup 定向组合为 **3 files / 47 tests passed / 137 skipped**；另有真实 Windows restart recovery、`verified`/`committed` 阶段 hard-crash、POSIX rescue/OTA/installer successor race 与精确旧 generation 恢复用例。目标 JS 语法、PowerShell AST、Prettier、ESLint、`git diff --check` 均通过。以上只关闭当前实现树的本地事务缺口，不能把 cross-target skip 当作产品证据；仍须在同一个最终 clean exact SHA 上取得 Linux/macOS/Windows x64 + ARM64 六目标真实二进制、notarization/Authenticode/Linux 签名、fresh install/upgrade/rollback 以及 Homebrew/WinGet/公开 manifest/asset 逐字节回读。该六目标公开发行链形成前第 4 项继续 **NO-GO**，也不授权发布新的 CLI/native 版本。
5. 完成 P1 命令生命周期观察窗：`0.162.198` 是包含当前 OTLP 接线的首个明确公开观察基线；仍须从该版本起积累至少两个 minor cycle，报告 collector 覆盖与抽样偏差，并按 command 比较 legacy/replacement 用量后逐项决定兼容 alias 是否可移除；在此之前不得删除旧入口。
6. 完成真实磁盘、pipe、终端与长期运行矩阵：`b4990364f2` 已关闭 EPIPE 直接 `process.exit(0)` 绕过 cleanup，并覆盖 single-turn、stream-json live input 与 REPL early-close 的本地故障注入；`f7c869946e` / `e306837d5c` 已把 production stream-json 登记资源接入所有可捕获 return/throw 的顶层 single-flight cleanup；`b03a2d112b` 已关闭 production single-turn headless 与 stream-json 机器输出路径的 stdout/stderr `write(false)`，包括有限 host queue、agent/input event drain barrier、最终输出结算与同步/异步 EPIPE；`4224729be8` 已把同一有限 gate 与 provider read pacing 接入 Agent REPL、legacy Chat REPL、background dashboard 及其 readline/logger/direct TTY 写入，并在 cleanup 恢复原始 Writable method。`2277097ea9` 又实现最长 10 秒的 host-owned 绝对 cleanup deadline，并把 `EROFS` / `ENOSPC` 按写入前、写入后未知和恢复失败投影为明确 commit-state；因此这两项不再属于实现缺口。现存任务是同一最终 clean exact SHA 上的真实 OS pipe、TTY、SSH、screen reader、Windows/macOS clipboard 与键盘布局、1,000+ turns、超大 MCP output、20+ 并发 Agent、FD/handle/orphan/worktree 清理和长期 soak formal 证据。各矩阵必须报告 p95、RSS、I/O、FD/handle/process-descendant 差值与 cleanup deadline，不能只记录“测试最终通过”。

当前总判定：**CLI npm 子范围 GO；完整产品实现仍为 NO-GO**。后续每关闭一个子项，都必须在本节追加 exact-SHA、矩阵范围、artifact 和未覆盖边界，不能改写历史失败，也不能用不同 SHA 的局部成功拼接授权。

### 16.9 2026-08-06 命令 telemetry/alias 决策与可靠性门禁增量

- 命令生命周期 telemetry 的仓库实现已收口：汇总 artifact 同时报告 collector coverage、sampling bias、逐命令 legacy/replacement route 用量和保守决策。当前 alias 决策统一为 `retain` 或 `insufficient-data`，工具不会自动修改 manifest 或删除兼容入口。`0.162.198` 仍是首个公开观察基线；在至少两个 minor release cycle 的代表性数据形成前，alias removal 继续 **NO-GO**。
- `packages/cli/scripts/cli-reliability-soak.mjs` 已升级为可原子 checkpoint/resume 的 v2 门禁，并把成功场景复用、运行中/失败场景重跑、profile/SHA/platform/arch 一致性校验写入 artifact。duplex soak 使用有界延迟样本，并按秒记录 RSS 与 FD/handle 的起点、终点和 high-water，避免门禁自身随 1,000+ turns 无界增长。
- 真实故障/宿主路径现已接线：Linux workflow 用独立 tmpfs 产生真实 `EROFS` 与 `ENOSPC`，要求 host errno、`CC_SESSION_PERSISTENCE_FAILED` commit-state 和模型零调用同时成立；pipe 覆盖 broken consumer 与真实暂停的 slow consumer；native PTY 和 Linux localhost `ssh -tt` 均在协议输出后主动断开并验证本地/远端 PID 在 10 秒 cleanup deadline 内退休。
- 新增真实 stdio MCP 超大输出探针：fixture 返回 1,572,864 字节 private canary，production CLI 必须只把 `CC_MCP_TOOL_RESULT_TOO_LARGE`/outcome-unknown 固定投影送入下一轮模型；canary 不得进入模型请求、stdout/stderr 或 artifact，MCP server PID 必须按期退出。Windows x64 / Node `22.22.2` 本地 smoke 已验证 1 次真实调用、2 次模型请求、canary 零传播和子进程退休；pipe/TTY 定向 smoke 也已验证 250 ms 真实停顿、约 2.52 MB 输出消费及 TTY disconnect 退休。resume smoke 验证 passed scenario 可从 v2 artifact 恢复。
- `3f3efcdf0a155164b0647a68f6eb7164d0f8a797`（tree `44ed8a64247172d096297374198e61ab28546fba`）的 clean Windows x64 / Node `22.22.2` exact-SHA smoke 已通过，artifact 为 `C:\tmp\cli-reliability-win32-3f3efcdf0a.json`：10 turns 的 p95 为 85.735 ms，RSS peak growth 为 11,460,608 bytes，handle peak delta 为 0，1/1 descendant 退休，I/O 计数可用；2 个 broken consumer 与 2 个 250 ms slow consumer 均退出 0、残留 descendant 为 0，slow path 各消费 2,519,997 bytes；native TTY normal/disconnect、3/3 并发 Agent、1,572,864-byte MCP output canary 隔离与 MCP server 退休均通过。Windows 没有配置 Linux tmpfs/localhost SSH，因此 disk 与 SSH 在该 artifact 中只是非 required 条件跳过，不能用于关闭 Linux formal 格。
- `23532dc1d1e99e9247104976639a94670b32b03c` 的 clean Linux x64 / Node `22.12.0` 补充 smoke 也已通过，artifact 为 `C:\tmp\cli-reliability-linux-basic-23532dc1d1.json`，head/expected SHA 精确一致且源码 change count 为 0。真实 stdio MCP 仍验证 1,572,864-byte canary 零传播与 server 退休；2 个 broken consumer 的 p95 为 3,926.3003 ms，2 个 250 ms slow consumer 的 p95 为 4,678.1906 ms，slow path 各消费 2,519,991 bytes 且残留 descendant 为 0；native PTY normal/disconnect、3/3 并发 Agent 通过。5 秒 duplex 样本完成 142 turns，p95 为 20.5808 ms，RSS peak growth 为 104,771,584 bytes，FD peak delta 为 6，进程后代全部退休；该 WSL1 环境无法提供可信 `/proc` I/O 计数、独立可限额 filesystem 或 localhost sshd，所以 I/O 明确记为 unavailable，disk/SSH 明确跳过。它只补充 Linux 基础行为，不替代 GitHub Ubuntu 的真实 EROFS/ENOSPC、SSH 与 2 小时 formal 格。
- 同一实现批次把 Node 22.12 Windows 的 transcript `fstat`/`lstat` 64 位身份见证切换为 BigInt 精确字段，同时保留旧版 rounded 元数据兼容升级，并移除普通 `appendEvent` 到 authority sink 的错误降级。Windows 本地 JSONL 122/122、原失败 ledger/adjudication 8/8、background realspawn 4/4、session-host component 12/12 和 session-host consistency 11/11 场景通过；最后一项是在 dirty implementation tree 上运行的功能证据，不冒充 clean exact-SHA artifact。
- `c06c7a449c` 把 JavaScript 动态 launcher 的 materialization 从 npx-only 扩展为上述 npm/bunx/pnpm/yarn/corepack 精确入口；source invocation 的 approval fingerprint 仍逐入口隔离，生成阶段继续统一使用禁 lifecycle script、exact lock、registry integrity 与全树 SHA-256 闭包，运行阶段只允许 direct Node entrypoint。`uvx`/`pipx`、未知 manager 子命令和可改变解析语义的前置 flag 均固定拒绝。materialization/identity 核心矩阵为 34 passed / 1 skipped，扩大 MCP client、sandbox policy 与 lazy-dispatch 为 85/85，帮助索引 drift、语法、ESLint、Prettier 与 diff-check 通过。该提交没有关闭 OS exec/open 原子性或运行期外部 module/DLL，因此第 16.8(3) 项整体仍为 **NO-GO**。
- `451286fe434a56a8c714ecd0a645761ab048e1f8`（tree `f733b0d8c7d0b1ed021fac6c602d549518cdba47`）把固定 npm materialization 升级为 v2 execution capsule。已哈希的完整安装树先经逐文件 descriptor copy 固定到私有 snapshot，copy 前后复核 FD 身份、长度、时间与 SHA-256；随后使用精确 `esbuild@0.28.1` 的平台原生二进制构建单一 `capsule/server.cjs`。Windows x64/ARM64/IA32、Linux x64/ARM64/IA32、macOS x64/ARM64 的 builder package、版本和 binary SHA-256 均写死复核，真实构建调用经 Process Broker、`shell:false` 和净化环境执行。metafile 只允许来自已见证 snapshot 的输入和 Node builtin external，动态 import 强制降为 guarded require；胶囊启动前安装不可改写的 `Module._load`/`process.dlopen` guard，因此迟到外部 JS module 与 native addon 分别在运行期/构建期失败关闭。发布 generation 同时绑定 provenance tree、builder identity、input digest 与 capsule digest，pre-spawn 继续复验原树和仅含一个文件的 capsule；最终 Node cwd/entrypoint 已从 live `node_modules` 切到 capsule 目录。
- 该提交在 Windows x64 / Node `22.22.2` 上的 materialization 对抗矩阵为 **26/26 passed**，覆盖完整 transitive bundle 实际启动、generation 确定性、原树与 capsule 替换、构建期间原树竞态、动态 `require`/`import()`、native `.node`、lock integrity、index rollback、Broker npm/esbuild argv 与环境注入；扩大 identity/lazy-dispatch/MCP client/sandbox policy 为 **5 files / 124 passed / 1 个既有平台 skip**。目标 Prettier、ESLint、Node syntax、help-index drift 与 `git diff --check` 通过；lockfile 的 production `esbuild@0.28.1` 解析和 npm pack dry-run 通过。它关闭的是受限 exact npm + direct Node bin 的常规模块依赖闭包，不关闭最终 OS `exec/open` 原子绑定、自定义 runtime/native executable/DLL、远端 revoke 或三平台恶意 race/soak，因此第 16.8(3) 项整体仍为 **NO-GO**。
- 以上是实现和本地 smoke 证据，不是产品级 formal closure。仍须在同一个最终 clean exact SHA 上取得 Ubuntu/macOS/Windows artifact；formal 每格不得低于 2 小时、1,000 turns、20 concurrent Agents、20 broken/slow pipe cases、5 disconnect cases和 2 秒 slow-consumer stall。Linux 还必须完成真实磁盘和 SSH；screen reader、Windows/macOS clipboard 与键盘布局继续属于独立真实交互矩阵。因此第 16.8(6) 项在三平台 artifact 形成前仍为 **NO-GO**，也不授权新的 CLI npm 发布。

### 16.10 2026-08-08 Session Host Consistency 正式关闭

第 16.8(2) 项现由最终公开发布提交 `dbb06e16fef0600e41d25d383c5595c7945f60ff` 的三平台 exact-SHA 权威证据关闭：[CLI Session Host Consistency `31191709454`](https://github.com/chainlesschain/chainlesschain/actions/runs/31191709454) 的 Ubuntu、macOS、Windows 三格均成功，逐格执行精确 checkout、lease/anti-rollback 聚焦回归与 cross-host JSONL consistency gate。artifact 分别为 `cli-session-host-consistency-ubuntu-latest-dbb06e16fef0600e41d25d383c5595c7945f60ff-1`（ID `8999192080`）、`cli-session-host-consistency-macos-latest-dbb06e16fef0600e41d25d383c5595c7945f60ff-1`（ID `8999214920`）和 `cli-session-host-consistency-windows-latest-dbb06e16fef0600e41d25d383c5595c7945f60ff-1`（ID `8999535513`）；三件 artifact 生成时均未过期。该提交随后以不可变 tag `v-npm-0-162-200` 公开发布。因此第 16.8(2) 项从本节起状态为 **已完成**；第 16.8 中早先的“部分完成”文字保留为当时的历史判定，不再代表当前状态。本证据不替代第 3、4、5、6 项各自的 formal 矩阵。

### 16.11 2026-08-08 `0.162.200` 命令生命周期决策快照

已生成 content-free [JSON 汇总](cli/evidence/command-lifecycle/0.162.200.json)与[逐命令审阅表](cli/evidence/command-lifecycle/0.162.200.md)。npm 公网时间证明 `0.162.198`（`2026-08-06T07:47:36.861Z`）至 `0.162.200`（`2026-08-07T16:55:32.069Z`）仍只有 `0.162` 一个 minor cycle；同时没有可批准为代表性用户 cohort 的 Collector export，因此汇总明确记录 opt-in/no-export sampling bias、三平台 coverage 缺失、零 accepted metric points 与 25/25 `insufficient-data`。本轮 operational alias 决策为 **25 个全部保留、0 个删除**，manifest 未修改。该快照完成了当前可诚实执行的 telemetry 汇总和 alias 决策，但不冒充第 16.8(5) 项要求的长期观察窗；只有后续 `0.163.x` 第二个 minor cycle、`0.164.0` removal floor 和真实覆盖/样本门同时成立后，才允许重新评估删除。

### 16.12 2026-08-08 `0.163.0` CLI npm 发布闭环与第二观察周期起点

- 轻量 tag `v-npm-0-163-0` 精确指向 release SHA `aed0a3ae5327917ce0490a5decbddd777f66f33b`。同 SHA 的 [CLI CI `31205224902`](https://github.com/chainlesschain/chainlesschain/actions/runs/31205224902) 完成全部 Linux、macOS、Windows 分片和三平台 `verify-cli`，最终为 **49 success / 1 conditional skip**；[CLI Strict Sandbox `31205231874`](https://github.com/chainlesschain/chainlesschain/actions/runs/31205231874) 的 Ubuntu、macOS、Windows 三格全部成功。稳定 release ref 只用于避免 `main` 后续提交触发 `cancel-in-progress`，两个门禁和 tag 均绑定上述同一不可变 SHA。
- 同一 SHA 的专用 [npm dry-run `31208255735`](https://github.com/chainlesschain/chainlesschain/actions/runs/31208255735) 成功完成完整测试、dry-run 打包和发布前校验；tag 触发的正式 [npm release `31209345410`](https://github.com/chainlesschain/chainlesschain/actions/runs/31209345410) 随后完成 exact-SHA gate、完整测试、immutable tarball、CycloneDX SBOM、npm Trusted Publishing、SLSA provenance、公开 registry 回读与 npmmirror 同步。release gate、immutable tarball 和公网回读 artifact ID 分别为 `9006034102`、`9006517503`、`9006584938`。
- npm 公网于 `2026-08-07T19:16:58.467Z` 发布 `chainlesschain@0.163.0`；公开 tarball 为 `https://registry.npmjs.org/chainlesschain/-/chainlesschain-0.163.0.tgz`，integrity 为 `sha512-EFi1IZQC1AB+bAz0OOWI+TKY7WQNt1tcyy7mMtARHUlx8ZKZPjMfdEXyYfozdsm/gYVcmU48sv+HDa0ATswsAg==`，registry attestations 声明 `https://slsa.dev/provenance/v1`。因此本版本的 **CLI npm exact-SHA 发布子闭环为 GO**。
- `0.163.0` 只启动第 16.8(5) 项要求的第二个 minor observation cycle，不会把没有代表性 collector export 的时间跨度解释为真实 adoption evidence。当前 25 个兼容 alias 继续全部保留，删除数仍为 0；只有代表性 cohort、三平台 coverage、抽样与逐命令 invocation/replacement 门同时成立，且版本达到既定 `0.164.0` removal floor 后，才能重新评估删除。因此第 16.8(5) 项继续 **NO-GO**；本次 CLI npm 发布也不替代第 16.8(3)、(4)、(6) 的恶意 Skill/MCP、六目标 native 签名发行或真实长期可靠性证据。

### 16.13 2026-08-08 `0.163.1` CLI npm 发布与长期可靠性正式关闭

- 轻量 tag `v-npm-0-163-1` 精确指向最终 release SHA `e3f56b11e27ae1bd5d19ad8638434843c244aa68`。同一 SHA 的 [CLI CI `31240892299`](https://github.com/chainlesschain/chainlesschain/actions/runs/31240892299) 与 [CLI Strict Sandbox `31240892177`](https://github.com/chainlesschain/chainlesschain/actions/runs/31240892177) 已分别完成全部配置的 Linux、Windows、macOS 门禁；[npm dry-run `31241030666`](https://github.com/chainlesschain/chainlesschain/actions/runs/31241030666) 成功后，tag 触发的正式 [npm release `31246063305`](https://github.com/chainlesschain/chainlesschain/actions/runs/31246063305) 完成 exact-SHA gate、完整测试、不可变 tarball、CycloneDX SBOM、npm Trusted Publishing/SLSA provenance、公开 registry 回读与 npmmirror 同步。公网 `latest` 已为 `chainlesschain@0.163.1`；tarball 为 `https://registry.npmjs.org/chainlesschain/-/chainlesschain-0.163.1.tgz`，SHA-1 为 `88158512c19b820f48706250f0167214f2312e65`，integrity 为 `sha512-qHen6M/y2etu+hTXjXmsSXbRojQPzkxpFZRZUiRu6ueDLmmAQ/+x403cWKc5Khrexp75C5kjqje95yte5aFfMg==`。因此本版本的 **CLI npm exact-SHA 发布子闭环为 GO**。
- 同一最终 clean exact SHA 的 [CLI Reliability Soak `31240943985`](https://github.com/chainlesschain/chainlesschain/actions/runs/31240943985) 在 Ubuntu x64、Windows x64 与 macOS ARM64 三格全部成功。artifact `cli-reliability-ubuntu-latest-e3f56b11e27ae1bd5d19ad8638434843c244aa68-1`（ID `9018414501`，digest `sha256:8c851918558d0987fda412c38519a3340dba059b69c9a83408e3a65dc0ee2ad5`）、`cli-reliability-windows-latest-e3f56b11e27ae1bd5d19ad8638434843c244aa68-1`（ID `9018446297`，digest `sha256:c92c590df56a199b425e99cc199d9ce1a54617adcf80bdf4ff03d756114766fe`）与 `cli-reliability-macos-latest-e3f56b11e27ae1bd5d19ad8638434843c244aa68-1`（ID `9018489707`，digest `sha256:a6321855d6a435cd08591c32dba7652deb504cc0f24ce570b4ab5286ed3dc1fc`）均记录 `status=passed`、`exactShaVerified=true`、源码 change count `0`、8/8 场景与零 violation。
- 三格 duplex 均完成 1,000 turns 与 20-turn warmup，连续时长依次为 `7200.039s`、`7202.076s`、`7200.163s`，p95 为 `5.327ms`、`9.392ms`、`25.792ms`。RSS growth 依次为 `-13,250,560`、`-79,241,216`、`-15,908,864` bytes，peak growth 为 `860,160`、`0`、`901,120` bytes，均低于 `134,217,728` bytes 上限；FD/handle 起终点 delta 为 `0`、`-2`、`0`，peak delta 均为 `1`，低于 `8` 上限。Linux `/proc` 与 Windows CIM I/O 计数可用；macOS artifact 明确记录 `host-has-no-portable-io-counter`，没有把缺失值伪造成零。三格观察到的 descendant 均为 1/1 退休且 `allRetired=true`，源码 worktree 也保持干净。
- 每格还完成 20 个 broken consumer、20 个 2 秒 slow consumer、5 个 native TTY disconnect、普通 TTY、`--ax-screen-reader` 模式和包含中文/阿拉伯文/希伯来文的真实 PTY 输入回显；screen-reader 输出均无 ANSI color 与 repaint。Windows/macOS 的 Unicode 剪贴板写入、读回和清理全部成功；Linux 的真实 tmpfs `EROFS`/`ENOSPC` 在模型调用前分别投影正确 host errno 与 `CC_SESSION_PERSISTENCE_FAILED` commit-state，localhost `ssh -tt` 正常路径和 5 次主动断连均验证远端 PID 退休。每格 20/20 并发 Agent 成功；1,572,864-byte stdio MCP private canary 未进入模型、wire 或 artifact，MCP server 退休，超限结果只形成固定 `CC_MCP_TOOL_RESULT_TOO_LARGE`/outcome-unknown 投影。
- 因此第 16.8(6) 项要求的真实磁盘、pipe、TTY、SSH、screen reader、多语言键盘输入、Windows/macOS clipboard、超大 MCP output、20+ 并发 Agent、FD/handle/orphan 清理及三平台两小时长期 soak 从本节起状态为 **已完成**。第 16.8 与 16.9 中早先的 `NO-GO` 文字保留为当时的历史判定，不再代表该子项当前状态。本闭环只覆盖 CLI 两小时可靠性门，不替代 8 小时 IDE soak、远程 IDE transport、第 16.8(3) 的恶意 Skill/MCP 安全闭包、第 16.8(4) 的签名 native 公开发行或第 16.8(5) 的代表性 telemetry 观察窗。

### 16.14 2026-08-08 MCP 代码快照、六目标 native 验证与 `0.163.1` alias 决策

- [PR #108](https://github.com/chainlesschain/chainlesschain/pull/108) 已以 merge commit `b18c876c572441ce02007ccb7b607ef58feeda99` 进入 `main`。实现提交 `5afa41209ec88ab206250ba0f9aa2aac8cece853` 不再依赖可执行文件名猜测 runtime，而是把 `native`、`node`、`python`、`posix-shell`、`powershell`、`java`、`dotnet` 的显式 `runtimeKind`、改名 runtime 与 direct entrypoint 身份绑定到 Broker 复验。该闭包解决自定义/改名解释器语义，但不把 runtime 的任意 DLL/shared-library 传递装载误报为已闭包。
- [PR #110](https://github.com/chainlesschain/chainlesschain/pull/110) 已以 merge commit `facd75309ca9468990ffb61ef647d3ce40e1c41b` 进入 `main`；其 exact head `50fa242279c298b15634c700aa00cdb2ddf09885` 通过 [IDE Roadmap Safety Matrix `31249744179`](https://github.com/chainlesschain/chainlesschain/actions/runs/31249744179) 的 Linux、macOS、Windows 与 aggregate 四格，以及该 SHA 的完整 CLI CI、CLI Strict Sandbox、三平台 Agent Team Soak 和全部 PR checks。MCP security aggregate v2 共执行 900 个工具样本，`unapprovedTransportCallCount`、`unapprovedMutationCount`、`unapprovedLedgerRecordCount` 与 `atomicPathReplacementEscapeCount` 均为 0；aggregate artifact `ide-roadmap-safety-aggregate-50fa242279c298b15634c700aa00cdb2ddf09885-1` 的 ID 为 `9019727342`、digest 为 `sha256:cdce63eef3706a1214bbfd5be05654f2657dfd9574f2893e99ef17468b12f59e`。Linux 使用 `verified-o_tmpfile-copy-inherited-fd-module-compile-v1`，runtime 与 entry snapshot 都保持 FD 原子绑定；macOS 使用 unlinked entry FD 加已复验私有 runtime 临时副本，实际 pathname replacement 探针只执行原始 entry、未执行恶意替换字节，但证据明确记录 `entrySnapshotAtomic=true`、`runtimeLaunchAtomic=false`。因此第 16.8(3) 项继续 **部分完成 / NO-GO**：剩余边界是 macOS runtime `exec/open` 原子绑定、任意 native/shared-library 装载闭包、远端宿主 revoke/distributed authority、更多重复 race/长期恶意 soak，以及受信任 Node builtin 的最终平台 sandbox；不得把单文件胶囊或本轮 entry race 外推成完整恶意代码隔离。
- 最终 npm release SHA `e3f56b11e27ae1bd5d19ad8638434843c244aa68` 的 [CLI Native Validation `31240927257`](https://github.com/chainlesschain/chainlesschain/actions/runs/31240927257) 已在 Linux x64/ARM64、Windows x64/ARM64、macOS x64/ARM64 六种匹配真实宿主上分别构建并执行 standalone binary，同时跑过 installer/updater transaction 回归；aggregate artifact ID `9017182712`、digest `sha256:768d0cf0ae22a94ee47dbd35ae98df27f8634f880ce90b71f4e97d14f8e34ab4`。每份 evidence 都固定声明 `signed=false`、`releaseEligible=false`，所以它关闭的是六目标无签名构建/执行缺口，不是第 16.8(4) 的公开发行链。`CLI Native Release` 现以 `blocked-pending-signing-and-public-distribution-evidence` 失败关闭，准确反映剩余前置条件：更新签名密钥、Windows Authenticode、macOS codesign/notarization、Sigstore、签名产物的 fresh install/upgrade/rollback、Homebrew/WinGet 实际发布与公开 asset 逐字节回读全部成功后才可改为 ready；当前第 4 项仍为 **NO-GO**。
- 新增 content-free [`0.163.1` JSON 汇总](cli/evidence/command-lifecycle/0.163.1.json)与[逐命令审阅表](cli/evidence/command-lifecycle/0.163.1.md)。npm 公网时间把观察窗精确绑定为 `0.162.198` 的 `2026-08-06T07:47:36.861Z` 到 `0.163.1` 的 `2026-08-08T07:40:07.699Z`，报告已识别 `0.162`、`0.163` 两个 minor cycle，因而不再声称“第二个 minor 尚未发布”。但没有获批的代表性 Collector export，三平台 reporting installation、coverage、sample rate 和 accepted metric points 仍全部为 0，且 `0.164.0` removal floor 尚未到达；形式判定为 25/25 `insufficient-data`、0 `remove`，对应的 operational alias 决策仍是 **25 个全部保留、0 个删除**。第 16.8(5) 项继续 **NO-GO**，不能用版本号跨过两个 minor 代替真实 adoption evidence。

### 16.15 2026-08-08 `0.163.2` CLI 发布回读、六项任务状态与 Windows helper 泄漏跟进

- `chainlesschain@0.163.2` 的 CLI npm 子闭环已经完成。轻量 tag `v-npm-0-163-2` 精确指向 release SHA `2d6f19aea243ed4f054b585d4bc709d4209ff80d`；同 SHA 的 [CLI CI `31277578939`](https://github.com/chainlesschain/chainlesschain/actions/runs/31277578939) 与 [CLI Strict Sandbox `31277578889`](https://github.com/chainlesschain/chainlesschain/actions/runs/31277578889) 均完成并成功。正式 [npm release `31277578900`](https://github.com/chainlesschain/chainlesschain/actions/runs/31277578900) 与独立公网 [readback `31278310621`](https://github.com/chainlesschain/chainlesschain/actions/runs/31278310621) 成功；npm registry 当前 `latest=0.163.2`，公开 tarball 为 `https://registry.npmjs.org/chainlesschain/-/chainlesschain-0.163.2.tgz`，SHA-1 为 `e12406b50e7aaaed481328015bd28819681ab615`，integrity 为 `sha512-JojaXMiE+UuFSAsuvEW8mjFClG8PxB9sPzMWiEJ4G5Pw+6RX+KfsfgXLgsqDWAYu1+3O+0YAT3BBHMX/3r5wZA==`。因此该精确版本的 **CLI npm 发布为 GO**；后续修复必须进入新版本，不能替换已发布的不可变 `0.163.2`。
- MCP sandbox policy 已由 [PR #120](https://github.com/chainlesschain/chainlesschain/pull/120) 合入 `main`，merge commit 为 `9fa5162e668fa9b457b0d70d54a0806773c363ab`。其 exact head `c3da912f6fd5890ff723ca812b37b080837406fd` 的 [CLI CI `31282766025`](https://github.com/chainlesschain/chainlesschain/actions/runs/31282766025)、[CLI Strict Sandbox `31282765938`](https://github.com/chainlesschain/chainlesschain/actions/runs/31282765938) 与 [CI Tests `31282765927`](https://github.com/chainlesschain/chainlesschain/actions/runs/31282765927) 均成功。该批关闭的是显式 policy 向 MCP transport/Broker 的传播和失败关闭，不等于默认 Node capsule 已具备文件系统、网络、builtin 或任意 native/shared-library 的完整恶意代码隔离。

按第 16.8 节六项任务的严格产品级验收口径，当前是 **3 项完成、3 项仍未完成**；此外有 1 个已完成项的测试基础设施 follow-up 正在收口：

| 任务                                 | 当前状态                               | 剩余边界与预计工作量                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------ | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. 长会话规模与冷进程 SLO            | **完成**                               | 已有正式矩阵，不再列为未完成任务。                                                                                                                                                                                                                                                                                                                                   |
| 2. Session Host 一致性               | **完成**                               | 已正式关闭，不再列为未完成任务。                                                                                                                                                                                                                                                                                                                                     |
| 3. Skill/MCP 真实恶意矩阵            | **部分完成 / NO-GO**                   | 当前 Linux native 插件只有 entry ELF 完整内容快照，非 entry 文件仍需全树封存；macOS runtime `exec/open` 原子绑定、任意 shared-library 递归闭包、远端 revoke/distributed authority、受信 Node builtin 的最终平台隔离与长期恶意 race 仍未关闭。Linux 全树快照窄切片约 2～4 工程日；整个任务取得可信 GO 预计仍需约 6～12 周，并依赖三平台实机/长期证据。                |
| 4. 签名 native 公开发行              | **NO-GO / 外部前置阻断**               | 六目标无签名构建执行已验证，但仓库没有更新签名 Ed25519 密钥、Windows Authenticode 证书、macOS Developer ID/notarization 凭据及对应公开渠道证据。凭据到位前无法给出可信完成日期；到位后仍须在同一 exact SHA 上完成签名、fresh install、upgrade、rollback、Homebrew/WinGet 与公开资产逐字节回读。                                                                      |
| 5. 命令 telemetry 与 alias 决策      | **操作决策完成，正式观察项 NO-GO**     | `0.163.1` 汇总仍为三平台 reporting installation、accepted points 与获批 Collector export 全部为 0，25/25 `insufficient-data`。当前决策是 **25 个 alias 全部保留、0 个删除**；只有达到 `0.164.0` removal floor 且取得代表性 cohort/coverage/抽样与逐命令 usage 数据后才能关闭，日历时间取决于真实数据而不是代码提交。`0.163.2` 仍属于同一 `0.163` minor，不改变结论。 |
| 6. 磁盘/pipe/TTY/SSH/资源与长期 soak | **完成；测试 helper follow-up 进行中** | `0.163.1` exact-SHA 三平台两小时可靠性矩阵已经正式关闭产品级任务。随后审计发现 Windows Vitest sandbox helper 缓存目录未完全退休；这是测试基础设施磁盘泄漏，不推翻已完成的产品 runtime soak，但必须在下一提交修复并取得 exact-SHA CI。                                                                                                                                |

Windows helper follow-up 的当前审计事实与安全边界如下：

- 初始检查在系统临时目录发现约 2,295 个 `chainless-win-sandbox-<48hex>` 测试 helper 目录，约 140 MiB。一个已否决的中间自动 scavenger 在测试过程中删除了 128 个历史 helper 缓存目录；这些目录只包含可重新生成的测试 helper，不含源码或 workspace，但删除不可恢复。该全局扫描方案因路径竞态/误删风险已完全移除，后续不得重新引入基于字符串路径的自动陈旧目录扫描。
- 随后的完整无分片 Vitest 压测因资源竞争出现大量 60 秒超时，不能作为发布门；它同时新增 2 个 helper 目录，使保留的历史计数从 2,167 变为 2,169，证明 hard-killed worker/child 不能仅依赖进程内 `afterAll`。现有历史目录暂不自动删除，必须另行做精确、非递归、人工授权的安全清理。
- 当前候选修复增加 `CC_WINDOWS_SANDBOX_ADAPTER_TEMP_ROOT`，按“显式 `tmpdir` > 显式 runtime root > 环境变量 > 系统默认”解析，并在每个 Windows plan 中只解析一次；只接受本地 DOS 盘绝对真实目录，NUL、相对路径、symlink/reparse、非目录或检查异常全部固定失败关闭为 `windows_adapter_temp_root_untrusted`。helper、invocation 与 identity 文件都绑定同一个已固定 root。测试层为每次 Vitest run 创建唯一 `cc-vitest-win-sandbox-*` 根，子 worker/CLI 继承该环境；global teardown 先完整预检，只允许精确 helper 目录/文件名和普通非链接文件，再用 `unlink`/`rmdir` 非递归删除，未知项、链接、特殊项或身份变化均失败并保留现场。
- 当前本地证据为：平台 sandbox 完整 focused 单测 **262/262 passed**；清理器 self-test **6/6 passed**；原先会泄漏的四个文件组合 **4 files / 85 tests passed**，系统历史 helper 计数 `2169 -> 2169`、新增 0/删除 0，专用 `cc-vitest-win-sandbox-*` 根 `0 -> 0`；e2e 配置下清理器再次 **6/6 passed** 且两类目录均为 0 增量。Prettier、目标 ESLint、Node syntax 与 `git diff --check` 已通过。该结果是**本地候选 GO**，尚需独立安全复审、提交/PR 和该 exact SHA 的 GitHub Actions 门禁后才能标记正式完成；预计剩余约半个工程日加 CI 时间。
- 随后的独立安全复审把上述“候选 GO”否决为新的中间快照，发现 **P0=1、P1=4、P2=3**。P0 是 Vitest 4 会捕获 global teardown rejection 后只记录错误，若清理遇到 locked/unknown/replaced 项，测试进程可能仍以 0 退出并留下 root；修复必须显式设置非零退出状态，并用真实子 Vitest 成功/失败契约验证。四个 P1 分别是：产品 temp root 只有 leaf `lstat` 和字符串复用，尚缺 canonical realpath、逐祖先 reparse 与稳定目录身份复验；teardown 仍是 `lstat/realpath -> chmod/unlink/rmdir` 的 path-based check-then-mutate，普通 hardlink 未拒且 `chmod` 可能在竞态下影响 root 外对象；显式 `tmpdir` 优先级使三个真实 Windows live tests 绕过 dedicated root；现有测试只证明环境继承与 mock cleanup，尚未证明“真实 helper materialize -> 强杀 child/worker -> outer cleanup -> helper/root/PID delta=0”。P2 包括 TTL policy 未进入 cache reuse 语义、统一 `applySandbox` 路径的 tmpdir 调用次数未覆盖，以及缺少真实 junction/hardlink/readonly/race 回归。因此 Windows helper follow-up 当前恢复为 **NO-GO / 不可提交**；只有关闭全部 P0/P1、补齐真实强杀与非零退出证据，再通过 PR exact-SHA CI 后才能更新为完成。

因此截至本节，用户可直接执行且不会误导的结论是：CLI npm `0.163.2` 已发布；六项中严格未完成数为 **3**；任务 6 产品级可靠性已完成但 Windows 测试 helper follow-up 尚未正式合并；下一优先级是先合并该泄漏修复，再继续任务 3 的 Linux native 全树快照。任务 4 与任务 5 都受外部材料/真实数据约束，不能用本地测试或版本号代替。

### 16.16 2026-08-09 P0/P1/P2 全量复核与 P2-4 调度内核判定

本次只读复核以 `github/main=d9b40850cc8ea6c8348d447c30bb9010fbfd3038` 为代码基线，并同时复用本文已经登记的 exact-SHA GitHub Actions、npm 发布和公网回读证据。状态口径为：**完成**表示原条目的关键实现与验收边界均已关闭；**部分完成**表示已有可用实现，但原条目仍有明确退出条件未满足；**未完成**表示目标内核尚未形成。未提交的本地候选、旧 SHA、单平台测试和相邻任务的证据均不计为正式关闭。

严格按第 5～7 节原始 15 项统计，当前为 **8 项完成、6 项部分完成、1 项未完成**，即仍有 **7 项未完全关闭**：

| 层级     |  完成 | 部分完成 | 未完成 | 未完全关闭 |
| -------- | ----: | -------: | -----: | ---------: |
| P0       |     4 |        1 |      0 |          1 |
| P1       |     3 |        3 |      0 |          3 |
| P2       |     1 |        2 |      1 |          3 |
| **合计** | **8** |    **6** |  **1** |      **7** |

逐项判定如下：

| 项目                                       | 判定                 | 证据与仍未关闭的边界                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------ | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0-1 lazy dispatch / 命令最多执行一次      | **完成**             | 实现提交 `c42820ab13`；[`lazy-dispatch.js`](../packages/cli/src/lazy-dispatch.js) 已有 phase-0 分发，并把 action 的 `parseAsync()` 放在 eager fallback 错误边界之外；[`lazy-dispatch.test.js`](../packages/cli/__tests__/unit/lazy-dispatch.test.js) 覆盖“产生一次副作用后抛错”且不重跑。                                                                                                                               |
| P0-2 secret、文件权限与 Sandbox 安全默认值 | **完成**             | 实现提交 `a4d1c05133`；schema secret、`set-secret`、get/list/export 统一脱敏、POSIX `0600/0700`、Windows owner-only ACL、`off/workspace-write/strict` 与 managed policy 禁止 off 均已接线并有安全测试。这里关闭的是**安全默认值**，不等于任意 Skill/MCP/native 代码已经获得完整恶意隔离。                                                                                                                               |
| P0-3 exact-SHA 发布门与可信更新链          | **部分完成 / NO-GO** | CLI npm 子链已完成：`0.163.2` release SHA `2d6f19aea243ed4f054b585d4bc709d4209ff80d` 的 CLI CI `31277578939`、CLI Strict Sandbox `31277578889`、publish `31277578900` 与 readback `31278310621` 成功。原条目还包含 native 可信更新链；`cli-native-release.yml` 仍以 `blocked-pending-signing-and-public-distribution-evidence` 关闭，validation 明示 `signed=false`、`releaseEligible=false`，因此不能由 npm 成功外推。 |
| P0-4 MCP WebSocket 与 scope 契约           | **完成**             | `392398a09d`、`0de8744151` 已进入 `main` 且是 `0.163.2` release SHA 的祖先；真实 WebSocket transport、结构化断线/取消/超时，以及 local/project/user/managed scope precedence 和 managed deny 均有生产实现与测试。这里关闭的是 transport/scope 契约，不替代完整恶意 MCP 隔离。                                                                                                                                           |
| P0-5 canonical Session 与长会话存储        | **完成**             | `CLI Session Scale` exact-SHA formal run `31085110318` 完成 20 writers × 1,000、10,000 sessions、1 GiB transcript、强杀/partial-record 和三平台 SLO；`CLI Session Host Consistency` run `31191709454` 又关闭 REPL/headless/background/WS 的一致性边界。                                                                                                                                                                 |
| P1-1 命令面收敛 / Agent 默认入口           | **部分完成**         | manifest v3 已设 `defaultCommand="agent"`，默认帮助为 10 个 core 入口，TTY/stdin 可直接进入 Agent；但当前仍注册 175 个入口、151 个 recommended 顶层入口，25 个 compatibility alias 尚未依据真实 usage 收敛。`0.163.1` lifecycle 汇总为 accepted points `0`、25/25 `insufficient-data`，所以兼容阶段可用，最终命令面收敛未完成。                                                                                         |
| P1-2 后台 Agent 恢复、隔离与预算取消       | **部分完成**         | 脱敏 launch profile、持久 session budget、预算耗尽主动 abort descendant/owned process tree 已实现。关键缺口仍在默认隔离：[`agent.js`](../packages/cli/src/commands/agent.js) 只有显式 `--worktree`，仅在 `options.worktree` 为真时创建；仓库没有 `--no-worktree`，mutating background task 尚未默认进入 worktree，相关 20-Agent/取消/清理长期验收也不能据已有通用 soak 自动外推。                                       |
| P1-3 `/btw` 与 OutputContext               | **完成**             | `316f7497b4`、`c42820ab13` 已实现即时 ephemeral、tool-free、单回答与 `--fork`；旧排队语义迁为 `/note-next`。[`program-base.js`](../packages/cli/src/program-base.js) 统一绑定 stdout/stderr、quiet/verbose/JSON 输出上下文。                                                                                                                                                                                            |
| P1-4 typed config schema                   | **完成**             | `a4d1c05133` 已提供版本化 schema、类型/enum/default/secret/scope/managed lock、未知 key 默认拒绝、插件 namespace，以及 `validate/effective/explain`。                                                                                                                                                                                                                                                                   |
| P1-5 官方 native 发行物与回滚升级          | **部分完成 / NO-GO** | 六目标 unsigned validation run `31240927257` 已完成真实构建/执行和 installer/updater 回归，但证据固定为 `signed=false`、`releaseEligible=false`。仍缺 updater Ed25519、Windows Authenticode、macOS Developer ID/notarization、签名后的 fresh install/upgrade/rollback、Homebrew/WinGet 实际发布和公开资产逐字节回读；该缺口与 P0-3 的 native 子范围重叠。                                                               |
| P1-6 长会话与运行时可靠性 SLO              | **完成**             | release SHA `e3f56b11e27ae1bd5d19ad8638434843c244aa68` 的三平台两小时 soak `31240943985` 已覆盖 1,000 turns、20 Agents、磁盘、pipe、TTY、SSH、screen reader、多语言输入、clipboard、超大 MCP output、FD/handle/orphan 退休。                                                                                                                                                                                            |
| P2-1 Provider-neutral Advisor / Critic     | **完成**             | 实现提交 `8e6e617373` 已接入 `/advisor on\|off\|once\|status`、方案/重复错误/完成前触发、provider/model/budget、managed allowlist、观测与 tool-free 建议，并包含生产 REPL 接线和测试。                                                                                                                                                                                                                                  |
| P2-2 交互细节                              | **部分完成**         | `6845c4a6ac`、`0550d052e2` 已接入 suggestions、recap、外部编辑器、prompt stash、keybindings，并有真实终端、screen-reader、多语言和文本 clipboard 证据。系统剪贴板**图片**仍只有可选 host binding/路径 fallback：[`clipboard-image.js`](../packages/cli/src/repl/clipboard-image.js) 没有生产 `readImage` host adapter，因此原条目未完全关闭。                                                                           |
| P2-3 MCP 可选协议面                        | **部分完成**         | [`mcp-client.js`](../packages/cli/src/harness/mcp-client.js) 已实现 resource templates、subscribe/unsubscribe、logging level 与 completion，[`mcp-client-optional-protocol.test.js`](../packages/cli/__tests__/unit/mcp-client-optional-protocol.test.js) 有协议测试；但没有生产调用方或基于代表性 server usage 的正式取舍报告，sampling 仍明确返回 `-32601`。这可以视为“已实现一批可选面”，不能写成整个条目完成。      |
| P2-4 调度内核收敛                          | **未完成**           | 当前仍是 Agenda、Routine、Cowork Cron、Automation、Loop 五套独立 store/driver；没有 canonical scheduler schema/service、统一 timezone/DST 与 missed-run policy、跨入口幂等/fencing、共享权限/预算、统一 history 或迁移。自 2026-08-01 路线图提出后，`github/main` 没有调度收敛提交。                                                                                                                                    |

#### P2-4 直接证据、目标范围与估算

- Agenda 的 [`agent-schedule-store.js`](../packages/cli/src/lib/agent-schedule-store.js) 使用 `~/.chainlesschain/agent-schedule/*.jsonl`，命令入口直接创建自己的 store。
- Routine 的 [`routine-store.js`](../packages/cli/src/lib/routine-store.js) 另存 `routines.json` 与 `runs.jsonl`，仍依赖外部 loop/system cron 驱动。
- Cowork Cron 的 [`cowork-cron.js`](../packages/cli/src/lib/cowork-cron.js) 使用 workspace 内独立 `schedules.jsonl` 和自己的 scheduler；Automation 的 [`automation-engine.js`](../packages/cli/src/lib/automation-engine.js) 使用独立 SQLite `auto_flows`；[`loop.js`](../packages/cli/src/lib/loop.js) 继续由自身 `setTimeout` 驱动。
- Agenda/Cowork cron 仍直接使用宿主本地 `Date` 字段，没有统一 IANA timezone/DST 模型；权限和预算主要只在 Agenda 路径完整存在。`EventRuntimeHost` 是 durable event queue worker，不具备 calendar scheduler 的 timezone、DST、missed-run 与 cron migration 契约，不能把它计作已统一的调度内核。

建议交付拆分及单工程师粗估为：

1. canonical schema/store、lease/fencing/history：约 **1.5～2 周**；
2. IANA timezone、DST、missed-run 与 idempotency：约 **1.5～2 周**；
3. Agenda/Routine/Cowork/Automation/Loop adapter 和兼容迁移：约 **2～3 周**；
4. 三平台 kill/restart、双实例、DST 边界和长期验证：约 **1～2 周**。

合计约 **6～10 周（单工程师）**，两人能真正并行时约 **4～6 周**。该估算包含设计、迁移和测试，不包含 CI 排队或发现历史数据异常后的额外处置；直接把其中一套 store 改名为“统一内核”不能缩短验收范围。

最后必须区分两种计数：第 16.8 节“六项产品任务”的 **3 完成、3 未完成** 是后续选定的专项清单；本节的 **8 完成、6 部分、1 未完成** 是 P0-1～P2-4 原始 15 项全量复核。前者没有覆盖 P2-4，也没有重新验证 P1-2 的默认 worktree 条件，因此两组数字并不矛盾。第 16.15 节 Windows test helper follow-up 是测试基础设施收口，也不单列为这 15 项中的新任务；在其实现提交、PR 与 exact-SHA CI 完成前，仍只能引用为本地候选证据，但不推翻 P1-6 已正式关闭的产品级两小时可靠性门。

### 16.17 2026-08-09 P1-2 默认隔离与后台所有权候选收口

本节记录 `fix/cli-background-worktree-default` 的 [PR #131](https://github.com/chainlesschain/chainlesschain/pull/131) 候选，用于修正第 16.16 节之后已经发生的实现变化，不回写或伪造当时的审计基线。候选已提交、变基到当时最新 `github/main` 并推送；PR head 后续可能因文档或修复提交变化，必须以 GitHub 的当前 `headRefOid` 为准，不能引用旧 SHA 的结果。正式状态仍是 **P1-2 部分完成 / 发布 NO-GO**：只有 PR 最终 exact SHA 通过 GitHub Actions，并补齐原条目的长期验收，才能把以下实现证据计为正式关闭。

候选实现已完成以下收口：

1. Git 仓库中的后台任务默认创建隔离 worktree，`--worktree` 可显式要求，只有显式 `--no-worktree` 才共享当前 checkout；foreground 与 stream-json 行为不变。
2. 仓库探测使用 canonical realpath 并逐级寻找 `.git`，非 `ENOENT` 错误 fail-closed；后台默认与后台显式 worktree 都要求源 checkout 干净，避免把未提交用户修改静默丢在 `HEAD` 快照之外。foreground 行为不由这条后台策略外推。
3. worktree 建立、进入目录、后台 spawn、launcher 最终化和清理组成显式所有权事务；失败时要么同步回滚，要么保留 path/branch/错误证据供检查，`.worktrees/` 通过 `.git/info/exclude` 幂等忽略。
4. 后台状态改为严格跨进程锁下的 read/mutate/atomic-rename；worker generation、真实 `applied` 认领结果、terminal absorbing、锁内 stale recheck 与停止 fence 关闭“终态后仍启动 turn”和“删除后旧 heartbeat 复活记录”。每次 turn 先持久化 token-bound prepare intent，再在第二个锁内完成 native spawn 与 agent PID commit，最后以同 token 单调推进 `spawned → terminated` 或记录 `not-spawned`；stop 遇到 unresolved intent/ownership uncertainty 只落 durable fence，由 owner 确认未 spawn 或整树终止后再收口，避免先杀 worker 后遗留 detached child。corrupt JSON、不同 generation、missing/deleted record 均 fail-closed。
5. launch profile 持久化为脱敏、版本化数据并带 config fingerprint；resume 重新构造 provider/model/tool policy/sandbox/MCP/settings/bundle/budget，而不是只恢复 session id。
6. 初始 piped prompt、attach follow-up、daemon resume、Agenda 和 dashboard dispatch 均使用单一 `--print=<text>` argv token；`--help`、`--no-worktree`、`--dangerously-skip-permissions` 等 option-shaped 文本只能作为 prompt 数据，不能在二次解析时扩大权限。
7. `--add-dir` 从调用 cwd 解析，仓库内部路径映射到 worktree，外部 canonical 目录保留并提示；resume/continue/fork/session 参数通过 Commander grammar 归一为一个确定 session。

当前本地去重聚焦证据为 **19 files / 295 passed / 1 skipped**，覆盖 supervisor、进程树终止、phase/reporter、状态/WS 稳定矩阵、argv grammar、默认 worktree、Agenda/dashboard、add-dir、launch profile、Broker workspace transaction 与真实 worktree cleanup E2E。Windows Git worktree 用例按 CLI 的 90 秒测试配置隔离复跑为 9/9，先前从仓库根误用 5 秒默认值产生的纯 timeout 不计作功能失败。最新 diff 的 Node syntax、command manifest/help-index/completions check、Prettier 与 `git diff --check` 均通过；目标 ESLint 为 **0 errors / 26 个既有 warnings**。仓库全量 lint 仍有本候选范围外的历史 errors，不能反向写成本候选回归。

仍未关闭的退出条件：

- PR #131 已创建，但其最终 exact-SHA `CLI CI` 与 `CLI Strict Sandbox` Linux/Windows/macOS 全矩阵尚未完成；任何后续 push 都会产生新 head，并使旧 SHA 的运行失去发布授权，因此不能据本地绿色或 superseded run 发布 npm 新版本。
- 原 P1-2 的 20-Agent 并发、取消/重连、worktree 清理和长期 soak 尚未在该候选 exact SHA 上执行；P1-2 继续计为**部分完成**，第 16.16 节 **8 完成、6 部分、1 未完成（7 项未完全关闭）**不变。
- 默认从仓库子目录启动时当前 cwd 落在 worktree 根，而不是对应子目录；worktree 仍位于仓库 `.worktrees/`，外部 managed root/descriptor identity、add-dir root-pivot/TOCTOU 加固列为 P2 follow-up。
- Broker 的 launcher post-native-spawn 异常目前仍是一次异步 whole-tree settlement；termination 未确认或 confirmed 后持久化持续失败时会保留 `launchFinalizationUncertain`、job 与 worktree，没有独立长期 keeper。turn worker 的 settlement 会重试仍存活根的终止与确认落盘，但一旦根已 closed 而 descendants 尚未证明退出，就必须停止复用裸 PID/PGID，保留 uncertainty，避免 PID reuse 误杀无关进程。另有不可外推的 hard-crash 窗口：prepare intent 已落盘后，若第二事务在 native spawn 返回与 agent PID commit 之间遭遇 SIGKILL/OOM，POSIX detached child 可能存活，而磁盘只有 intent、没有可回收 PID；两阶段协议关闭的是 cooperative stop 与可捕获持久化失败，不是 crash-safe OS containment。这些 fail-closed 残留必须纳入磁盘/pipe/TTY/SSH/资源泄漏长期 soak 和显式 recovery 设计，不能在本节宣称全局资源泄漏清零或 P1-2 完成。
- P2-4 调度内核未因本候选发生变化，仍按第 16.16 节估算为 **6～10 周（单工程师）/4～6 周（两人有效并行）**。

独立 selector follow-up [PR #129](https://github.com/chainlesschain/chainlesschain/pull/129) 已以 `b67dcfbd9908a7915dcd0506dadfecbb33282e83` 合入 `main`；其 exact head `e25e3c37bebc84cf80275f89314e005c279711c8` 的 required checks 6/6、手动 `CLI CI` `31300868245` 与 `CLI Strict Sandbox` `31300868232` 均通过。该事实只证明 selector 修复本身，不能替代 PR #131 最终 head 或未来 release SHA 的双工作流门禁；在新的 release commit 全平台绿色前，npm 已发布版本仍以 `0.163.2` 为准。

### 16.18 2026-08-10 `0.163.3` 发布闭环与六项任务最新判定

- [PR #131](https://github.com/chainlesschain/chainlesschain/pull/131) 的最终 head `fd51bcf910f1f879ad6a92c1350539a72818e621` 已通过 [CLI CI `31322040535`](https://github.com/chainlesschain/chainlesschain/actions/runs/31322040535)、[CLI Strict Sandbox `31322040389`](https://github.com/chainlesschain/chainlesschain/actions/runs/31322040389)、CLI Agent Team Soak、CLI Background Interaction E2E、Session Host Consistency 与全部 PR checks，并以 merge commit `5c9506c73c7692edc48e0b528355035c7e018fc6` 进入 `main`。因此第 16.17 节所写的“PR/exact-SHA 尚未完成”只保留为候选阶段历史，不再代表当前状态。默认后台 worktree、显式 `--no-worktree`、argv 数据边界、supervisor fencing 和可捕获失败的 worktree/tree settlement 已正式合入；但 native spawn 返回至 PID commit 之间的 hard-kill 窗口、无可复验 PID 的 detached descendant、独立长期 keeper 与 P1-2 专项长期矩阵仍未关闭，所以不能把本次合并外推为 P1-2 整项完成。
- 第 16.15 节 Windows sandbox helper follow-up 已由 [PR #124](https://github.com/chainlesschain/chainlesschain/pull/124) 与 [PR #127](https://github.com/chainlesschain/chainlesschain/pull/127) 合入，并包含在 `0.163.3` 最终发布树中。实现使用 run-owned canonical root、逐祖先 reparse/身份复验、只针对已捕获成员的非递归清理、失败非零退出契约和真实子 Vitest hard-kill/cleanup 夹具；系统历史 helper 目录不会被自动扫描或删除。当前发布树的专用本地复核为 **3 files / 21 tests passed**。最终 release SHA 的 Windows/Linux/macOS CLI CI 与 Strict Sandbox 均成功，因此该测试基础设施 follow-up 从本节起标记为 **完成**；这不改变任务 6 早已由正式两小时矩阵关闭的产品结论。
- 第 16.15 节对任务 3 的“Linux native 插件只有 entry 快照”已被后续 [PR #122](https://github.com/chainlesschain/chainlesschain/pull/122) 缩减。其 exact head `9eb25dceede50df698c06f386b8dbc9be8326707` 的 [CLI CI `31289151844`](https://github.com/chainlesschain/chainlesschain/actions/runs/31289151844)、[CLI Strict Sandbox `31289151762`](https://github.com/chainlesschain/chainlesschain/actions/runs/31289151762) 与 [CLI Agent Team Soak `31289151759`](https://github.com/chainlesschain/chainlesschain/actions/runs/31289151759) 成功，并以 `d9b40850cc8ea6c8348d447c30bb9010fbfd3038` 进入 `main`。Linux strict native/plugin 路径现在逐目录 FD 遍历，拒绝链接、跨设备/挂载、special file、hardlink 和超限树，把每个普通文件复制到独立匿名 sealed snapshot，再从合成只读树启动；因此“Linux 非 entry 文件未封存”不再是现存缺口。该实现明确只声明 per-file pin-to-launch，未伪称整个目录是单一原子事务。
- `chainlesschain@0.163.3` 已从最终 merge/release SHA `17fcf6aa7917dd0fcc83b3ab5204c196bbb81758` 公开发布。该 SHA 的 [CLI CI `31329476135`](https://github.com/chainlesschain/chainlesschain/actions/runs/31329476135)、[CLI Strict Sandbox `31329476020`](https://github.com/chainlesschain/chainlesschain/actions/runs/31329476020) 与 IDE Safety 三平台/aggregate 成功；[正式两小时 reliability/MCP soak `31329539092`](https://github.com/chainlesschain/chainlesschain/actions/runs/31329539092) 为 7/7 jobs success，并验证 300 host cycles、900 unapproved effects、100 Linux races、100 macOS fail-closed probes 和 0 escapes。轻量 tag `v-npm-0-163-3` 精确指向该 SHA；[正式 npm 发布 `31335579227`](https://github.com/chainlesschain/chainlesschain/actions/runs/31335579227) 与[独立 readback `31336362525`](https://github.com/chainlesschain/chainlesschain/actions/runs/31336362525) 成功，SLSA/Sigstore provenance 有效且 registry tarball 与不可变 workflow artifact 逐字节一致。该证据关闭 covered-scope 的重复 race/两小时恶意 MCP 观察缺口，但不替代下面仍列出的功能边界。

按第 16.8 节六项产品任务的严格口径，当前仍是 **3 项完成、3 项未完成**，但任务 3 的剩余范围已缩小，任务 6 已无 helper follow-up：

| 任务                                 | 最新状态                           | 当前未关闭边界                                                                                                                                                                                                           |
| ------------------------------------ | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. 长会话规模与冷进程 SLO            | **完成**                           | 无。                                                                                                                                                                                                                     |
| 2. Session Host 一致性               | **完成**                           | 无。                                                                                                                                                                                                                     |
| 3. Skill/MCP 真实恶意矩阵            | **部分完成 / NO-GO**               | Linux 全树封存与 covered-scope 两小时恶意 race 已关闭；仍缺 macOS runtime `exec/open` 原子绑定、任意 native/shared-library 递归闭包、远端宿主 revoke/distributed authority，以及受信 Node builtin 的最终跨平台隔离边界。 |
| 4. 签名 native 公开发行              | **NO-GO / 外部前置未满足**         | 仍缺 updater Ed25519、Windows Authenticode、macOS Developer ID/notarization、Linux/Sigstore 签名、签名后六目标 fresh install/upgrade/rollback、Homebrew/WinGet 实际发布和公开资产逐字节回读。                            |
| 5. 命令 telemetry 与 alias 决策      | **操作决策完成，正式观察项 NO-GO** | `0.163.3` 仍属于 `0.163` minor；没有获批的代表性 Collector export、非零 reporting coverage/accepted points 或逐命令 cohort 数据，且 `0.164.0` removal floor 未达到。25 个 alias 继续全部保留。                           |
| 6. 磁盘/pipe/TTY/SSH/资源与长期 soak | **完成**                           | Windows test-helper follow-up 也已正式合入并由最终 release SHA 门禁覆盖。                                                                                                                                                |

因此下一实施主线是任务 3 的剩余平台安全边界。任务 4 的凭据/渠道与任务 5 的代表性生产数据都必须使用真实外部材料，不能用新的本地测试、版本号或合成 telemetry 冒充完成证据。

### 16.19 2026-08-11 `0.163.4` 正式发布、P2-4 首个里程碑与当前余量

- [PR #148](https://github.com/chainlesschain/chainlesschain/pull/148) 已以 merge/release SHA `27ed0ac2005e16ce5ddff53990e85b1d13ea0b1d` 进入 `main`。该精确 SHA 的 [CLI CI `31421782916`](https://github.com/chainlesschain/chainlesschain/actions/runs/31421782916) 完成并成功（52 个 job success、1 个条件跳过、0 个失败），[CLI Strict Sandbox `31421782072`](https://github.com/chainlesschain/chainlesschain/actions/runs/31421782072) 在 Linux、Windows、macOS 三平台 3/3 成功。候选阶段暴露的双进程 CAS 测试 stdout 竞态已改为等待 child `close` 后断言；目标用例本地连续 6/6 通过，最终 SHA 的原失败 macOS unit shard 也已成功。
- 轻量 tag `v-npm-0-163-4` 精确指向上述 release SHA。[正式 npm 发布 `31424056034`](https://github.com/chainlesschain/chainlesschain/actions/runs/31424056034) 的 exact-SHA gate、发布前测试、package、Trusted Publishing、CLI publish 和 provenance 校验全部成功；[独立 readback `31425519966`](https://github.com/chainlesschain/chainlesschain/actions/runs/31425519966) 的 immutable artifact、registry bytes 与 signed provenance 校验成功。npm 公网已确认 `chainlesschain@0.163.4` 且 `latest=0.163.4`；公开 tarball 为 `https://registry.npmjs.org/chainlesschain/-/chainlesschain-0.163.4.tgz`，integrity 为 `sha512-mAZWXoCfraiwEFhN9n2l+HgpCnAsfOadXji2TtFMezz6oU+h7sJuVUYkGsuTftNo5QBk8HaU14nB9WZN6vpvTg==`。因此 `0.163.4` 的 **CLI npm exact-SHA 子闭环为 GO**。
- [PR #145](https://github.com/chainlesschain/chainlesschain/pull/145) 以 merge commit `ce575b3bcb4389e1fa4787cf87032b43bd40b7a0` 合入 scheduler-kernel v1 contract 与 SQLite store：版本化 schema、严格 schema verification、expected-revision CAS、logical occurrence 去重、durable claim、history 和双真实 handle 竞态测试已形成，定向测试为 11/11。该提交包含在 `0.163.4` 发布树中，因此 P2-4 从“完全未形成 canonical kernel”更新为 **部分完成**；它只是 storage/contract foundation，Agenda、Routine、Cowork Cron、Automation、Loop 仍未迁移到统一 service，timezone/DST、missed-run、共享权限/预算、跨入口 fencing、运行时驱动及迁移/回滚/长期矩阵仍未关闭。
- 按第 16.16 节原始 P0-1～P2-4 共 15 项口径，当前更新为 **8 项完成、7 项部分完成、0 项完全未开始，仍有 7 项未完全关闭**；变化只来自 P2-4 的“未完成 → 部分完成”，未完成总数没有减少。按原工作包扣除已交付的 contract/store 子切片，P2-4 剩余粗估约 **4.5～8 周（单工程师）/3～5 周（两人有效并行）**，主要工作量在统一 runtime/service、五类 adapter 与兼容迁移、timezone/DST/missed-run 语义及三平台 kill/restart/双实例/长期验证。
- 第 16.8 节六项产品专项仍是 **3 项完成、3 项未完成**：任务 1、2、6 完成；任务 3 Skill/MCP 真实恶意隔离仍为部分完成，任务 4 签名 native 公开发行仍受真实凭据和公开渠道阻断，任务 5 telemetry 的操作决策仍是 **25 个 alias 全部保留、0 个删除**，但代表性 Collector/cohort 数据、非零 accepted points 与 `0.164.0` removal floor 未满足。补丁版本 `0.163.4` 不构成新的 minor observation cycle，不能改变 alias 删除授权。

因此下一开发重点可以继续放在 P2-4 的统一 scheduler service 与首批 adapter 迁移；并行的产品发布阻断仍是任务 3 的剩余平台安全边界、任务 4 的外部签名/渠道材料和任务 5 的真实生产 telemetry。`0.163.4` 的成功发布只关闭本版本 npm 子链，不能外推为 signed native distribution、完整调度内核或 alias removal 已完成。

### 16.20 2026-08-11 P2-4 runtime 与 Routine 首个 adapter 候选

- 实现提交 `aa1eaadbe58f217912c2a9ff0def00f72bffbb59` 在 scheduler-kernel v1 store 上增加 host-owned `SchedulerRuntime`：只执行精确 job revision，要求显式 authorizer 和已注册 adapter；授权完成后再次复验 owner/fence 租约，再启动续租 heartbeat；成功、重试、死信和取消都只能由同一 owner/fence 结算。定向 `claimOccurrence` 不会消费其他 queued work，`claimNext(jobKind)` 允许 adapter driver 只恢复自己的 occurrence。
- Routine 是第一套迁入统一执行面的入口：`routine trigger` 的 manual invocation，以及 `routine run` 的 cron/once 路径，均先把版本化 routine snapshot、逻辑 trigger key 和结构化 authority envelope 写入 scheduler store，再经 runtime claim/authorize/adapter/settle。双 driver 对同一 logical occurrence 只允许一个 agent 执行；Routine job 的 expected-revision CAS、scheduled state digest 与 manual definition digest 防止旧快照或被修改的 prompt 静默执行。GitHub polling 暂时保留 legacy 路径，不在本候选的迁移声明内。
- 每个 scheduler occurrence 绑定确定性的 Routine run ID。若 agent 已完成且 run end 证据存在，但进程在 scheduler settle 前退出，后继 driver 会恢复同一 occurrence 并只补结算，不再次调用 agent；若只有 run start、没有 terminal evidence，则固定返回 `ROUTINE_RUN_OUTCOME_UNKNOWN` 并失败关闭。run ID、occurrence ID 与 snapshot digest 不匹配同样死信。该保证只覆盖进程崩溃后仍可读取的持久记录，不外推为断电/fsync、磁盘回滚或任意外部副作用的全局 exactly-once。
- 当前本地候选证据为 6 个聚焦文件 **93/93 passed**，覆盖双 SQLite handle CAS/claim、按 adapter kind 隔离、授权拒绝、慢授权租约丢失、续租、取消、重试/死信、双 driver 竞争、handle restart、settle 前崩溃恢复、outcome-unknown 与 binding mismatch。Prettier、Node syntax、`git diff --check`、Routine help、shell completion 和 `npm pack --dry-run` 通过；tarball 清单 991 项且包含新增 runtime/adapter。目标 ESLint 为 0 errors、1 个既有 warning。本地复用依赖目录缺少 `ajv/dist/2020.js`，所以 manifest/help-index 生成门没有形成有效本地结论，必须以干净 `npm ci` 的 PR GitHub Actions 为准。
- P2-4 继续是 **部分完成**，15 项总表仍为 **8 项完成、7 项部分完成、0 项完全未开始，7 项未完全关闭**。本候选尚未迁移 Agenda、Cowork Cron、Automation、Loop 与 Routine GitHub；没有统一 IANA timezone/DST/missed-run 语义，没有接入跨入口真实权限/预算 resolver，没有完整 standalone daemon/liveness/升级回滚，也没有三平台 kill/restart/双实例/磁盘故障/长期 soak。start-only outcome 仍需显式人工裁决，disabled/stale occurrence 的长期清理策略也未定义。
- 在第 16.19 节剩余估算基础上，扣除通用 runtime 和 Routine cron/once/manual 首个 adapter，但保留上述全部产品退出条件，当前粗估约 **4～7 周（单工程师）/2.5～4.5 周（两人有效并行）**。下一窄切片建议迁移 Agenda，并把其现有 permission mode、worktree、turn/token/cost/time budget 与统一 authority resolver 接通；随后处理 timezone/DST/missed-run，再迁移其余三类 driver 并完成长期矩阵。

本节仍是候选实现记录，不是 npm 发布授权。只有候选最终 exact SHA 的 `CLI CI` 与 `CLI Strict Sandbox` Linux/Windows/macOS 全矩阵成功并进入 `main` 后，才能把该增量计为正式已合并证据；即使合并，P2-4 也不会因此整项完成。

### 16.21 2026-08-11 P2-4 runtime/Routine adapter 正式合并证据

- [PR #150](https://github.com/chainlesschain/chainlesschain/pull/150) 的最终 head `8ff4c2a9dd6221a292acc5328c8e1d311c2a5a16` 已以 merge commit `2a894144499f96c2996babbb49687694bb6858ee` 进入 `main`。最终 head 的 [CLI CI `31447976697`](https://github.com/chainlesschain/chainlesschain/actions/runs/31447976697) 为 **53/53 jobs success**；手动 exact-SHA [CLI Strict Sandbox `31448029113`](https://github.com/chainlesschain/chainlesschain/actions/runs/31448029113) 为 Linux、macOS、Windows **3/3 success**。PR 汇总没有失败检查，因此第 16.20 节的 runtime、Routine cron/once/manual adapter、process-crash run evidence recovery 与聚焦测试从“本地候选”更新为**正式已合并增量**。
- 状态边界不变：P2-4 仍为 **部分完成**，原 15 项仍是 **8 项完成、7 项部分完成、0 项完全未开始，7 项未完全关闭**。Agenda、Cowork Cron、Automation、Loop、Routine GitHub、真实共享权限/预算、timezone/DST/missed-run、standalone daemon、迁移/回滚和三平台长期故障矩阵仍未关闭；当前剩余粗估继续采用第 16.20 节的 **4～7 周（单工程师）/2.5～4.5 周（两人有效并行）**。
- 本次没有修改 CLI 版本，也没有触发 npm 发布。公网最新版本仍是已经完成独立回读的 `0.163.4`；PR #150 的实现只能进入未来版本候选，必须在那个未来 release 的精确 SHA 上重新完成发布所需的 `CLI CI` 与 `CLI Strict Sandbox`，不得沿用本 PR 的成功直接发布。

### 16.22 2026-08-11 P2-4 Agenda wakeup/cron adapter 候选

- production 默认 `agenda run` 已把 wakeup 与 cron 接入统一 scheduler store/runtime；logical occurrence 在执行前绑定版本化 Agenda snapshot 和 SHA-256 digest，job 更新使用 expected-revision CAS，双 driver 只能由同一 owner/fence 执行及结算。monitor 仍保留 legacy driver，本候选不把它伪称为已迁移。
- snapshot 保留完整 `runPolicy`，包括 permission mode、默认/显式 worktree、turn/outer-turn、goal、token、cost、time budget 和 unattended allowlist；实际 Agent 启动继续复用原 Agenda `spawnAgent` 参数构造与安全策略。当前只形成结构化 `agent.execute` authority envelope 和 snapshot-bound authorizer，跨入口真实共享权限/预算 resolver 仍是后续退出条件。
- scheduler occurrence 在 Agent 副作用前，把 occurrence ID、snapshot digest、attempt 与 `running` evidence 写入 Agenda JSONL；成功时在同一次文件替换中写 terminal evidence 并把 wakeup 标为 fired 或把 cron 精确推进一次。已存在成功 evidence 的崩溃恢复只补 scheduler settlement，不再次启动 Agent；只有 start evidence 或 Agent 已返回成功但终态写盘失败时，固定按 outcome-unknown 死信并保留非过期 fence，禁止自动重放。
- 新旧 CLI 并存期间复用 `.agenda-claims` 锁：新内核绑定后写入旧版本可识别的非过期 `executionLease`，阻止旧 driver 重复领取；若旧 driver 先取得有效 lease，新内核不会覆盖，而是退避到该 lease 到期。已知 Agent 失败才清除 fence，并按 60 秒延迟、最多 3 次尝试执行有限重试。该机制只覆盖 cooperating process 与 durable file evidence，不外推为磁盘回滚、断电/fsync 或任意外部副作用的全局 exactly-once。
- 当前本地聚焦证据为 5 个文件 **128/128 passed**，覆盖完整 run policy、wakeup/cron、双新 driver、旧/新 driver 双向抢占、stale snapshot、已知失败重试、完成后进程崩溃恢复、start-only outcome-unknown、成功后终态持久化失败 fail-close，以及 production command route。Prettier、目标 ESLint、Node syntax、`agenda --help`、shell completion 与 `git diff --check` 通过；`npm pack --dry-run` 为 992 项并包含新增 Agenda adapter。完整 CLI 本地套件在形成最终汇总前被中断，因此不计为通过；复用依赖目录还缺少 `ajv/dist/2020.js`，导致 manifest 原生导入和依赖它的 help-index 检查没有形成有效本地结果。候选必须以干净 `npm ci` 下的 PR GitHub Actions 为准。
- P2-4 继续是 **部分完成**，原 15 项总表仍为 **8 项完成、7 项部分完成、0 项完全未开始，7 项未完全关闭**。剩余范围包括 Agenda monitor、Cowork Cron、Automation、Loop、Routine GitHub、真实共享权限/预算 resolver、IANA timezone/DST/missed-run、standalone daemon、未知结果人工裁决、迁移/回滚、磁盘故障和三平台长期矩阵。扣除 runtime、Routine 与 Agenda wakeup/cron 后，当前粗估约 **3.5～6.5 周（单工程师）/2.5～4 周（两人有效并行）**。

本节是未合并候选记录，不修改 CLI 版本，也不授权 npm 发布。只有候选最终 exact SHA 的 `CLI CI` 与 `CLI Strict Sandbox` Linux、Windows、macOS 全矩阵成功并进入 `main` 后，才能把该增量计为正式完成的 P2-4 子切片。

### 16.23 2026-08-11 P2-4 Agenda wakeup/cron adapter 正式合并证据

- [PR #152](https://github.com/chainlesschain/chainlesschain/pull/152) 的最终 head `7ed345b3663f9ef5b7f8b2940537a361b72128eb` 已以 merge commit `fa80965ab37fb7231c7be448294cb34e5aa6a0c5` 进入 `main`。该 exact head 的 [CLI Strict Sandbox `31462505731`](https://github.com/chainlesschain/chainlesschain/actions/runs/31462505731) 为 Linux、macOS、Windows **3/3 success**；[CLI CI `31462505772`](https://github.com/chainlesschain/chainlesschain/actions/runs/31462505772) attempt 2 为 **53/53 jobs success**，Linux、macOS、Windows `verify-cli` 均成功，其余 PR checks 无失败。
- CLI CI 首次 attempt 的 Windows integration shard 3/8 曾因既有 `mcp-client-stdio-process-tree` 夹具未及时发布 PID marker 而失败；同一用例在当前 Windows 工作树隔离复跑为 1/1，通过后对同一 run 仅重跑失败 job，最终成功。该过程没有修改 head SHA，也没有把首轮失败或局部结果当作通过；最终只采用 attempt 2 的完整绿色矩阵。
- 因此第 16.22 节的 production Agenda wakeup/cron runtime route、完整 `runPolicy` 保留、snapshot/occurrence binding、新旧 driver 双向 fencing、已知失败有限重试、成功 evidence 崩溃恢复及 outcome-unknown fail-close 从“候选”更新为**正式已合并 P2-4 子切片**。Agenda monitor 和其他未迁移入口不在该完成声明内。
- 总体判定不变：P2-4 仍为 **部分完成**，原 15 项仍为 **8 项完成、7 项部分完成、0 项完全未开始，7 项未完全关闭**；剩余粗估继续采用第 16.22 节的 **3.5～6.5 周（单工程师）/2.5～4 周（两人有效并行）**。本次未修改 CLI 版本、未创建 release tag、未发布 npm；公网最新版本仍为 `0.163.4`。

### 16.24 2026-08-11 P2-4 Cowork Cron adapter 候选

- production 默认 `cowork cron run` 已从独立 `CoworkCronScheduler` 路由到统一 scheduler store/runtime；workspace `schedules.jsonl` 继续保存兼容定义与执行证据，统一 SQLite 保存版本化 job、logical occurrence、owner/fence claim 和 history。job snapshot 只绑定 cron、template、message、files、enabled、createdAt 等定义字段，不把 `lastRunAt`、delivery lease 或 scheduler evidence 混入 digest；job 更新使用 expected-revision CAS，执行前再次核对 snapshot digest 与 enabled 状态。默认未显式传 `--interval` 时，五字段 cron 使用 60 秒轮询，六字段 cron 自动调为 1 秒，前台 timer 保持进程存活。
- 全局 scheduler DB 的恢复领取新增 `workspaceId` 限定：Cowork driver 只能 claim 当前 workspace authority 下的 occurrence，不能由工作区 A 的前台进程执行工作区 B 的 queued/retry work；同 kind 的 sibling occurrence 保持 queued，并可由其自身 workspace driver 恢复。该隔离同时保留 adapter kind 过滤和 snapshot-bound `cowork.task.execute` authority envelope，但尚未接入跨入口真实共享 permission/budget resolver。
- 新旧 CLI 并存时继续复用 Cowork `schedules.jsonl` 的同一 fail-closed lock、delivery ID、lease 与 fence。旧 driver 先取得有效 claim 时，新内核退避到 lease 到期；新内核先绑定时，写入旧 driver 可识别的非过期 `activeDelivery` 和 `schedulerExecution=running`，阻止重复领取。旧 driver 已完成同一 delivery 的 durable `lastDeliveryId` 可直接恢复为成功，不再次调用 Cowork task；成功时 scheduler terminal evidence、legacy last-run state 与 claim 清理在同一次原子文件替换中完成。
- 已知 task throw 会先持久化 failed evidence，并以 60 秒有界延迟、最多 3 次 attempt 重试；已有 succeeded evidence 的进程崩溃恢复只补 scheduler settlement。若只有 start evidence，或 task 已产生副作用但 terminal JSONL 替换失败，则固定按 outcome-unknown 死信并保留非过期 legacy fence，禁止自动重放。该保证只覆盖 cooperating process、文件锁与仍可读取的 durable evidence，不外推为断电/fsync、磁盘回滚、DST 重叠或任意外部副作用的全局 exactly-once。
- 本地 Cowork/内核相邻矩阵为 5 个文件 **106/106 passed**，其中 4 个核心文件为 **94/94 passed**；覆盖 definition-only snapshot、正常到期执行、前台保活与秒级自动调频、双 kernel driver、跨 workspace 隔离、旧 driver 先取 claim、旧版完成恢复、terminal-evidence 崩溃恢复、start-only outcome-unknown、已知失败重试、stale snapshot 和成功后持久化失败。Prettier、Node syntax、目标 ESLint（0 errors、4 个既有 warnings）、命令帮助、`git diff --check` 与 `npm pack --dry-run` 通过；tarball 清单 993 项且包含新增 Cowork adapter、不包含测试文件。完整 CLI 本地套件运行约 4 分钟仍未形成最终汇总后被主动停止，因此不计为通过；本地 help-index 检查在命令注册阶段报 `Manifest command is not registered: agent`，同样不形成有效通过结论，候选必须以干净 `npm ci` 的 PR GitHub Actions 为准。
- P2-4 继续是 **部分完成**，原 15 项总表仍为 **8 项完成、7 项部分完成、0 项完全未开始，7 项未完全关闭**。剩余范围包括 Agenda monitor、Automation、Loop、Routine GitHub、真实共享权限/预算 resolver、IANA timezone/DST/missed-run、standalone daemon/liveness、未知结果人工裁决、迁移/回滚、磁盘故障和三平台长期 soak；Cowork 的本地系统时区和 DST/missed-run 语义没有因本次 driver 迁移而关闭。扣除 Cowork Cron production adapter 后，当前粗估约 **3～6 周（单工程师）/2～3.5 周（两人有效并行）**。

本节是未合并候选记录，不修改 CLI 版本、不创建 release tag，也不授权 npm 发布。只有候选最终 exact SHA 的 `CLI CI` 与 `CLI Strict Sandbox` Linux、Windows、macOS 全矩阵成功并进入 `main` 后，才能把该增量计为正式完成的 P2-4 子切片。

### 16.25 2026-08-11 P2-4 Cowork Cron adapter 正式合并证据

- [PR #155](https://github.com/chainlesschain/chainlesschain/pull/155) 的最终 head `41a6a02fc9250a88a82a77d75c101b64a20c60e1` 已以 merge commit `2eb17a0c0cae9ac3cd46bb47d33fb5e3bde1f52e` 进入 `main`。该 exact head 的 [CLI CI `31469044102`](https://github.com/chainlesschain/chainlesschain/actions/runs/31469044102) 为 **53/53 jobs success**，包含 Linux、Windows、macOS 全部 unit/integration/E2E shards、三平台 `verify-cli`、Linux pack dry-run 与 publish dry-run；手动 exact-SHA [CLI Strict Sandbox `31469776963`](https://github.com/chainlesschain/chainlesschain/actions/runs/31469776963) 为 Linux、macOS、Windows **3/3 success**。PR 最终检查汇总为 **89 pass、7 skipped、0 fail**。
- branch protection 的 auto-merge 在完整 CLI CI 汇总结束前已经合入 PR，因为该完整 workflow 当时不属于 required 集；这不能作为发布门通过。期间没有修改 CLI 版本、创建 release tag 或发布 npm。只有在上述同一 head SHA 的 CLI 53/53 与 Strict 3/3 后，本节才把第 16.24 节的 production Cowork Cron runtime route、workspace-scoped recovery、definition snapshot、旧新 driver fencing、已知失败有限重试、terminal evidence 恢复和 outcome-unknown fail-close 更新为**正式已合并 P2-4 子切片**。
- 总体判定仍为 **部分完成**：原 15 项总表保持 **8 项完成、7 项部分完成、0 项完全未开始，7 项未完全关闭**。Agenda monitor、Automation、Loop、Routine GitHub、真实共享权限/预算 resolver、IANA timezone/DST/missed-run、standalone daemon/liveness、未知结果人工裁决、迁移/回滚、磁盘故障和三平台长期 soak 仍是退出条件；剩余粗估继续采用第 16.24 节的 **3～6 周（单工程师）/2～3.5 周（两人有效并行）**。公网最新 CLI 仍为 `0.163.4`，本次合并不单独授权新 npm 发布。

### 16.26 2026-08-12 `0.163.5` CLI npm 正式发布闭环

- [发布 PR #162](https://github.com/chainlesschain/chainlesschain/pull/162) 已合并为最终 release SHA `095087c1e859a8451ce01ed58c59af3fede756fd`；轻量 tag `v-npm-0-163-5` 不可移动地指向该提交。该版本把已经进入 `main` 的 scheduler store/runtime、Routine、Agenda wakeup/cron、Cowork Cron，以及 durable micro-compaction recovery/trace 修复打包为 `chainlesschain@0.163.5`，没有借发布动作把尚未合并的 Agenda monitor、Automation、Loop、Routine GitHub 或 standalone daemon 伪装为已发布。
- 最终 tag SHA 的 [CLI CI `31509337185`](https://github.com/chainlesschain/chainlesschain/actions/runs/31509337185) attempt 2 为 **53/53 jobs completed/success**，覆盖 Linux、Windows、macOS 全部 unit/integration/E2E shards 与三平台 `verify-cli`；[CLI Strict Sandbox `31509336854`](https://github.com/chainlesschain/chainlesschain/actions/runs/31509336854) 为三平台 **3/3 success**。首次 main push run 曾有 1 个 macOS 双进程 CAS 竞争用例抖动，随后同一 SHA 的完整重跑通过；tag run attempt 1 又因 GitHub Jobs API 把已完成成功的子 job 长时间保留为 `in_progress` 而不能满足 release gate，attempt 2 在不改代码、不移动 tag 的前提下形成全部终态成功矩阵。首轮失败、局部结果或顶层 success/子 job 未收敛状态均未被当作发布通过。
- 专用 [npm 发布 workflow `31509336832`](https://github.com/chainlesschain/chainlesschain/actions/runs/31509336832) attempt 2 的 exact-SHA gate、完整测试、不可变 `package-cli` artifact、CycloneDX SBOM、Trusted Publishing、签名 provenance 与 `publish` 全部 success；attempt 1 因上述 Jobs API 未收敛被严格拒绝，未发生本地补发或绕过 gate。公网 `latest` 已更新为 `0.163.5`，tarball 为 `https://registry.npmjs.org/chainlesschain/-/chainlesschain-0.163.5.tgz`，`sha1=5dc6677dee6d1d73b708e6a50e3808007a314894`，integrity 为 `sha512-Qf+4ozBUbWCT92gYry0tOA0uB84pawGQ3tGGyoiB/YehoZSzx7dvHzdfTHt/xTcTHfrmUKTNX7EV31iEKZ514A==`。
- 独立公网 [readback `31514940240`](https://github.com/chainlesschain/chainlesschain/actions/runs/31514940240) 重新下载 npm tarball，验证签名 provenance、tag/SHA/发布 run 身份，并证明 registry 字节与 GitHub 不可变 artifact 完全一致。因此 **`0.163.5` 发布任务正式关闭**，可以从未完成发布任务中减去 1 项。
- 该发布闭环不改变第 16.25 节的 P2-4 功能口径：原 15 项仍为 **8 项完成、7 项部分完成、0 项完全未开始，7 项未完全关闭**，剩余粗估仍为 **3～6 周（单工程师）/ 2～3.5 周（两人有效并行）**。下一步应继续一次只关闭一个 P2-4 子任务；不得因为版本已发布就把共享 permission/budget resolver、IANA timezone/DST/missed-run、standalone daemon/liveness、人工裁决、迁移/回滚、磁盘故障和三平台长期 soak 视为完成。

### 16.27 2026-08-12 P2-4 统一 scheduler service 正式合并证据

- [PR #161](https://github.com/chainlesschain/chainlesschain/pull/161) 的最终 head `0e7d016d48a413642fb4e465c4138118a4e03426` 已以 merge commit `08881ec573158745a7c4a1443082966167168520` 进入 `main`。它新增 `cc daemon scheduler run`，在一个前台常驻进程内托管 Agenda 与 Cowork：tick 串行执行、单域失败隔离为 degraded incident、内存只保留最近 100 份 summary，SIGINT/SIGTERM 会停止下一轮并在活动 tick 结算后关闭共享 scheduler store；`--domains`、有界轮询间隔、NDJSON lifecycle/heartbeat 和 `--once` 单轮执行均有命令级覆盖。
- 最终 head 的 [CLI CI `31500072164`](https://github.com/chainlesschain/chainlesschain/actions/runs/31500072164) 完成并成功，包含 Linux、Windows、macOS 的 unit/integration/E2E shards、三平台 `verify-cli`、pack 与 publish dry-run；其余 PR checks 无失败。合并后又对同一不可变 head 手动执行 [CLI Strict Sandbox `31543095330`](https://github.com/chainlesschain/chainlesschain/actions/runs/31543095330)，Linux、macOS、Windows **3/3 success**，没有借用其他 SHA 或局部矩阵。
- 因此“独立 scheduler service host + 事件型 liveness + 优雅关闭”子切片从候选更新为**正式已合并**。边界必须保留：`--once` 会真实执行一轮到期任务，不是无副作用的只读探针；常驻进程的健康判断应使用 supervisor 进程状态与 NDJSON heartbeat。仓库尚未为该命令提供开箱即用的 systemd/launchd/NSSM 安装单元，三平台 kill/restart、双实例、磁盘故障与长期 soak 也未因本次合并自动完成。
- 为避免原 15 项粗粒度统计长期看似不动，从本节开始同时记录 P2-4 内部可执行子项：第 16.25 节列出的 **11 个剩余子项现降为 10 个**，已移除 standalone daemon/liveness；剩余依次为 Agenda monitor、Automation、Loop、Routine GitHub、真实共享 permission/budget resolver、IANA timezone/DST/missed-run、未知结果人工裁决、迁移/回滚、磁盘故障、三平台长期 soak。原 P0-1～P2-4 共 15 项统计仍为 **8 项完成、7 项部分完成、0 项完全未开始，7 项未完全关闭**，原因是 P2-4 在该粗粒度总表中只占 1 项，必须待上述 10 个子项全部退出才会从“部分完成”变为“完成”。扣除本次 service host 后，剩余粗估约为 **2.5～5.5 周（单工程师）/1.5～3 周（两人有效并行）**。
- 本次只合并 scheduler service，不修改 CLI 版本、不创建 release tag、不发布 npm；公网 `0.163.5` 不包含该 merge commit。下一项继续从上述 10 个子项中只关闭一个。

### 16.28 2026-08-12 P2-4 Agenda monitor、Loop 与 Automation adapter 正式合并证据

- Agenda monitor 的 [PR #158](https://github.com/chainlesschain/chainlesschain/pull/158) 最终 head `81474931222e9f3f872d60fed9ef91c17311dbd3` 已以 merge commit `650154f8b4c045ae48ab68b88a9da7165b4af557` 进入 `main`。production command/file/HTTP monitor observation 已通过 `monitor.observe` authority、snapshot/occurrence binding、owner/fence 与 durable outcome evidence 进入统一 kernel；monitor re-arm/match 与 scheduler settlement 原子持久化，terminal evidence 可在进程崩溃后只补结算而不重复观察/通知，start-only outcome 继续 fail closed。该 exact head 的 [CLI CI `31474844368`](https://github.com/chainlesschain/chainlesschain/actions/runs/31474844368) 为 **53/53 success**，[CLI Strict Sandbox `31474844226`](https://github.com/chainlesschain/chainlesschain/actions/runs/31474844226) attempt 2 为三平台 **3/3 success**。
- Loop 的 [PR #156](https://github.com/chainlesschain/chainlesschain/pull/156) 最终 head `0cf5716b15e58eeb8f10f8b977a22c2bcf43152e` 已以 merge commit `98c6831329b82850b407d6ec97c3ad6b5dd31570` 进入 `main`。production `cc loop` iteration 已使用 immutable execution snapshot、least-capability authority、saved-session deterministic occurrence、live-owner fencing、terminal recovery 与 outcome-unknown fail-close，同时保留动态 pacing、stop condition、SIGINT 和 save/resume 兼容行为。该 exact head 的 [CLI CI `31475518293`](https://github.com/chainlesschain/chainlesschain/actions/runs/31475518293) 为 **53/53 success**，[CLI Strict Sandbox `31475526493`](https://github.com/chainlesschain/chainlesschain/actions/runs/31475526493) 为三平台 **3/3 success**。
- Automation 的 [PR #154](https://github.com/chainlesschain/chainlesschain/pull/154) 最终功能 head `930531a9868349d5a11ada5468a1b5abd12509ba` 已以 merge commit `af041852e6bf13be1604e44c277aabee37800bea` 进入 `main`。active cron flow 已通过 canonical snapshot digest、authority envelope、missed-run collapse、pause/stale-definition check、deterministic execution ID 与 durable recovery 进入统一 kernel，并新增 production `automation run-scheduled` route。该 head 的首轮 CLI CI 暴露的两平台失败不是 adapter 测试，而是发布后 canonical CHANGELOG 与内置 artifact 未同步；最小 [PR #167](https://github.com/chainlesschain/chainlesschain/pull/167) 只重新生成两条发布状态并以 merge commit `e23b7f3a351cbc3ff099cefe3c1a6716df0ee91a` 合入。最终 follow-up head `b609c30fb9bd1ce28f2e6a2dcdd3a092a9815f1e` 的 [CLI CI `31551868259`](https://github.com/chainlesschain/chainlesschain/actions/runs/31551868259) attempt 2 为 **53/53 success**，[CLI Strict Sandbox `31551894005`](https://github.com/chainlesschain/chainlesschain/actions/runs/31551894005) 为三平台 **3/3 success**。CLI CI attempt 1 唯一剩余失败是既有 `tenant-saas` 测试在等待 2ms 后两次 `Date.now()` 偶发相等；同 head 本地目标复验 1/1 成功，随后只重跑该失败 job并成功，没有修改 SHA 或把首轮失败冒充通过。
- P2-4 内部剩余可执行子项由第 16.27 节的 **10 个降为 7 个**：Routine GitHub、真实共享 permission/budget resolver、IANA timezone/DST/missed-run、未知结果人工裁决、迁移/回滚、磁盘故障、三平台长期 soak。Agenda monitor、Loop、Automation 已从列表删除；原 P0-1～P2-4 共 15 项粗粒度总表仍为 **8 项完成、7 项部分完成、0 项完全未开始，7 项未完全关闭**，因为 P2-4 整项仍未满足全部退出条件。剩余粗估下调为约 **2～4.5 周（单工程师）/1.5～2.5 周（两人有效并行）**。
- 本节三项合并均发生在 `0.163.5` 发布提交之后，当前公网包不包含这些增量；本节不修改 CLI 版本、不创建 tag，也不授权 npm 发布。下一项继续只关闭上述 7 个子项中的一个。

### 16.29 2026-08-12 P2-4 Routine GitHub adapter 正式合并证据

- [PR #157](https://github.com/chainlesschain/chainlesschain/pull/157) 的最终 head `6460e49b011720a3a233ffc7f0fd803bfe52e3c3` 已以 merge commit `cb354ef9c9744e7b60d837c077108750f7aae0a4` 进入 `main`。production Routine GitHub polling 已通过共享 scheduler kernel 执行：event batch 在 cursor 推进前持久化，以不可变 batch identity 去重；cursor/write 或进程崩溃后可恢复而不重复交付，repository rebinding 被拒绝，十进制 GitHub event cursor 保持单调。
- 该 exact head 的 [CLI CI `31541236578`](https://github.com/chainlesschain/chainlesschain/actions/runs/31541236578) 为 **53/53 jobs success**，[CLI Strict Sandbox `31541236398`](https://github.com/chainlesschain/chainlesschain/actions/runs/31541236398) 为 Linux、macOS、Windows **3/3 success**；普通 PR checks 同样无失败。因此 Routine GitHub adapter 从“未关闭”更新为**正式已合并 P2-4 子切片**。
- P2-4 内部剩余可执行子项由第 16.28 节的 **7 个降为 6 个**：真实共享 permission/budget resolver、IANA timezone/DST/missed-run、未知结果人工裁决、迁移/回滚、磁盘故障、三平台长期 soak。原 15 项粗粒度总表仍为 **8 项完成、7 项部分完成、0 项完全未开始，7 项未完全关闭**；剩余粗估约为 **1.5～4 周（单工程师）/1～2.5 周（两人有效并行）**。
- 本次不修改 CLI 版本、不创建 release tag、不发布 npm；公网 `0.163.5` 不包含该 adapter。下一项只处理 IANA timezone/DST/missed-run。

### 16.30 2026-08-12 P2-4 IANA timezone、DST 与 missed-run policy 正式合并证据

- Agenda 的 [PR #159](https://github.com/chainlesschain/chainlesschain/pull/159) 最终 head `092b5c7719f89b20793803f6c2c3cba2702b0dec` 已以 merge commit `fda5212638f7e3d84c8317c7a96b17bbbe137629` 进入 `main`。Agenda cron 现在保存并校验 canonical IANA timezone，按指定 civil time 计算 occurrence，不再依赖宿主时区；覆盖春季 DST gap 跳过、秋季重复分钟产生两个不同真实 instant，以及跨午夜回退。该 exact head 的 [CLI CI `31545397036`](https://github.com/chainlesschain/chainlesschain/actions/runs/31545397036) 为 **53/53 success**，[CLI Strict Sandbox `31545396812`](https://github.com/chainlesschain/chainlesschain/actions/runs/31545396812) 为 Linux、macOS、Windows **3/3 success**。普通 CI 首轮唯一失败来自 PDH 测试随机 MD5 恰含 `:42`，其余 4508 项通过；同一 SHA 只重跑失败 job 后，[attempt 2 `31545396815`](https://github.com/chainlesschain/chainlesschain/actions/runs/31545396815) 成功，没有修改实现或把首轮失败冒充通过。
- Cowork Cron 与统一 missed-run policy 的 [PR #173](https://github.com/chainlesschain/chainlesschain/pull/173) 最终 head `c0155a2d9116f8c46c22c90c82da7de3e7435f07` 已以 merge commit `90f266efeeec38913587c9b92203315cedec6206` 进入 `main`。`cowork cron add --timezone <iana>` 会持久化 canonical timezone；5/6 字段 cron 在指定 civil time 下求值并保留 POSIX DOM/DOW OR 语义，支持非整点偏移、春季缺失分钟和秋季重复分钟。durable `nextAt` 与固定 `missedRunPolicy="collapse"` 把停机期间多个到期点收敛为最新一个，enqueue 后再用 CAS 推进 cursor；旧记录迁移不会回放升级前历史，带 `lastRunAt` 的记录最多补一次，禁用窗口不会补跑，耗尽 cursor 保持 `null`。秋季重复 wall time 使用 epoch occurrence identity，因此两个真实 instant 各执行一次；host-local legacy key 仍保留混合版本兼容。
- PR #173 exact head 的 [CLI CI `31562505163`](https://github.com/chainlesschain/chainlesschain/actions/runs/31562505163) 为 **53/53 jobs success**，[CLI Strict Sandbox `31562610018`](https://github.com/chainlesschain/chainlesschain/actions/runs/31562610018) 为三平台 **3/3 success**。本地最终扩展矩阵为 **44 files / 1213 tests passed**，聚焦矩阵为 **6 files / 179 passed**；manifest、help index、completions、CLI reference、Prettier、Node syntax、`git diff --check` 与 npm pack dry-run 均通过，目标 ESLint 为 0 errors（6 个既有 warnings）。branch protection 在完整 CLI CI 汇总前已自动合并 PR，故合并动作本身不被当作门禁；只有同一 head 后续取得上述 53/53 与 3/3 后，本节才将该子项更新为正式完成。
- P2-4 内部剩余可执行子项由第 16.29 节的 **6 个降为 5 个**：真实共享 permission/budget resolver、未知结果人工裁决、完整迁移/回滚、磁盘故障、三平台长期 soak。Agenda/Cowork 的 timezone、DST 与 missed-run 语义已从列表删除；本次兼容 legacy Cowork cursor 只关闭该入口的无回放升级规则，不等于五类入口、多个 store 与 schema 的完整迁移/回滚已经完成。原 P0-1～P2-4 共 15 项粗粒度总表仍为 **8 项完成、7 项部分完成、0 项完全未开始，7 项未完全关闭**，因为 P2-4 整项仍是一个“部分完成”条目。剩余粗估下调为约 **1.25～3.5 周（单工程师）/0.75～2 周（两人有效并行）**；下一项继续只关闭上述 5 项中的一个，优先真实共享 permission/budget resolver。本节不修改版本、不创建 tag，也不授权 npm 发布。

### 16.31 2026-08-12 P2-4 真实共享 permission/budget resolver 正式合并证据

- [PR #175](https://github.com/chainlesschain/chainlesschain/pull/175) 的最终 head `f5295cf2b875caaeb66a34782f8aabbc95bf44ff` 已以 merge commit `149bc9adac3d8354bd77c41b2653ee6b294eb3f5` 进入 `main`。Agenda、Routine、Cowork、Automation、Loop 现在统一绑定 exact-capability scheduler policy revision，并通过同一 SQLite transaction 完成预算预留和 terminal settlement；retry/reclaim 复用 occurrence reservation，不重复计费。missing/disabled/stale policy、capability mismatch、预算耗尽、usage/reservation 损坏和未绑定旧 occurrence 均失败关闭。`cc daemon scheduler policy get/set` 提供精确 capability、window/run/unit 上限和 expected-revision CAS 的管理面，不接受 wildcard。
- Automation 同时保留 PR #168 的 createdBy 身份、connector permission、live revocation 与 flow-level run/action budget：domain authority 与共享 `schedulerPolicyRevision` 分层校验，不因共享层增加引用而放宽 decision/grant/approval/delegation 绑定。v1→v2 store migration 在同一事务校验旧 authority，为当前 job 与非 terminal occurrence 写入共享 policy reference，并保持 terminal snapshot 不变；该 forward migration 不是完整混合版本 rollback 的完成声明。
- exact head 的 [CLI CI `31579897054`](https://github.com/chainlesschain/chainlesschain/actions/runs/31579897054) attempt 2 最终为 **53/53 jobs success**，[CLI Strict Sandbox `31579951907`](https://github.com/chainlesschain/chainlesschain/actions/runs/31579951907) 为 Linux、macOS、Windows **3/3 success**。CLI CI attempt 1 的 Windows unit shard 唯一测试失败是未修改的 `headless-stream-questions` timeout/`stdin-closed` timing 竞态，本机 Windows 精确复验 11/11 通过；另一个 Windows E2E shard 在 checkout 阶段因 `SEC_E_UNTRUSTED_ROOT` 未运行测试。同一 SHA 仅重跑这两个失败 job 后均成功，随后三平台 `verify-cli` 全部成功；没有修改 SHA，也没有把首轮失败冒充通过。
- P2-4 内部剩余可执行子项由第 16.30 节的 **5 个降为 4 个**：未知结果人工裁决、完整迁移/回滚、磁盘故障、三平台长期 soak。原 P0-1～P2-4 共 15 项粗粒度总表仍为 **8 项完成、7 项部分完成、0 项完全未开始，7 项未完全关闭**；P2-4 仍是一个“部分完成”条目。剩余粗估下调为约 **1～3 周（单工程师）/0.75～1.75 周（两人有效并行）**。本节只关闭共享 resolver 子项；不把 forward schema migration、局部故障测试或组件回归外推为其余四项完成。

## 17. 2026-08-06 `0.162.198` 发布闭环与继续执行边界

`0.162.198` 是第 16 节之后的 CLI-only 补丁发布，纳入 P0-1 canonical session workbench、P0-2 rewind/branch 宿主绑定、P0-3 发布可靠性跟进，以及 REPL/headless/provider/TTY 输出背压和跨平台 release fixture 修复。它不改变第 16.8 节产品级未完成项的授权边界。

| 发布事实                    | 状态     | exact-SHA / 公网证据                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0-1 / P0-2 / P0-3 合并     | **完成** | P0-1 [PR #89](https://github.com/chainlesschain/chainlesschain/pull/89)、P0-2 [PR #88](https://github.com/chainlesschain/chainlesschain/pull/88) 已进入 `main`；P0-3 follow-up [PR #90](https://github.com/chainlesschain/chainlesschain/pull/90) squash 为 `0b7a5471e7a9356708ae722cc084ca57457cec46`。                                                                                                                                                  |
| `0.162.198` 版本提交        | **完成** | [PR #92](https://github.com/chainlesschain/chainlesschain/pull/92) squash 为最终 release SHA `3c0f62fa17242cfa3123ab502a9bf5d1cbed8481`；该提交的 `packages/cli/package.json` 与 lockfile 均为 `0.162.198`。                                                                                                                                                                                                                                              |
| 最终 SHA 三平台发布门       | **完成** | [CLI CI `31078499968`](https://github.com/chainlesschain/chainlesschain/actions/runs/31078499968) 的 Ubuntu/Windows/macOS unit、integration、E2E、package/dry-run 与三平台 `verify-cli` 成功；[CLI Strict Sandbox `31078499270`](https://github.com/chainlesschain/chainlesschain/actions/runs/31078499270) 三平台成功。两者 `headSha` 均为 `3c0f62fa17242cfa3123ab502a9bf5d1cbed8481`。                                                                  |
| 不可变 tag、制品与 npm 发布 | **完成** | 轻量 tag `v-npm-0-162-198` 精确指向最终 release SHA。[发布 run `31081337370`](https://github.com/chainlesschain/chainlesschain/actions/runs/31081337370) 的 immutable tag identity、exact-SHA gate、完整测试、tarball、CycloneDX SBOM、Trusted Publishing、签名 provenance、registry 回读与 npmmirror 同步全部成功。                                                                                                                                      |
| 独立公网逐字节回读          | **完成** | [readback `31082366544`](https://github.com/chainlesschain/chainlesschain/actions/runs/31082366544) 从 npm 重新下载 `chainlesschain@0.162.198`，验证签名 provenance、原发布 workflow/tag/SHA、不可变 artifact 与 registry tarball 字节一致。npm `latest` 已为 `0.162.198`；公开 tarball `sha1=0438e7ef25fbc089b0299a0a6d18a4a3f0d2cd25`，integrity 为 `sha512-TUL4ZYdl6rvZgwBN1J9QFwXo95r9KSER2lHiGKnbSG/SKwu/7iZw6vtaD9AYT2w2RdxuAvd2Sba1387ORA5DsA==`。 |

因此 `0.162.198` 的 **CLI npm exact-SHA 子闭环为 GO**，并成为第 16.8(5) 项命令生命周期 observation window 的公开起点。该结论仍不授权第 16.8 节中的 cold-process formal scale、session anti-rollback/TOCTOU、真实恶意 Skill/MCP、native generation transaction、真实终端/磁盘/长期 soak、IDE Marketplace 或 Desktop/native 公开发行链；这些任务继续保持未完成，必须各自取得同范围的 exact-SHA 矩阵与 artifact。

## 18. 2026-08-14 当前未完成任务与执行顺序

本节是面向继续开发的**当前清单**，优先级高于第 14～17 节保留的历史阶段判定。本次发布核验基线为最终 release SHA `3e997168621c53708a1682868c6cc4edc9baf15b`；公网 npm `latest` 为 `chainlesschain@0.163.7`，其 release SHA 同为该提交。PR #180 的 outcome-unknown 人工裁决、PR #183 的五域迁移/回滚和 PR #182 的因果可观测性均已进入该公开版本；完整发布证据见第 18.8 节。

### 18.1 三种统计口径

| 口径                     | 当前结论                                             | 说明                                                                        |
| ------------------------ | ---------------------------------------------------- | --------------------------------------------------------------------------- |
| 原始 P0-1～P2-4 共 15 项 | **8 完成、7 部分完成、0 完全未开始；7 项未完全关闭** | P2-4 虽已连续关闭多个子切片，在原始总表中仍只占一个“部分完成”条目。         |
| 第 16.8 节六项产品任务   | **3 完成、3 未完成**                                 | 任务 1、2、6 完成；任务 3、4、5 未完成。该专项清单没有覆盖全部原始 15 项。  |
| P2-4 调度内核内部清单    | **磁盘故障矩阵正式完成，1 个子项仍未完成**           | 磁盘故障矩阵已通过 exact-SHA 三平台门禁并进入 `main`；仅剩三平台长期 soak。 |

### 18.2 原始 15 项中仍未完全关闭的 7 项

| 原始项                               | 当前状态                  | 仍需完成的退出条件                                                                                                                                                                                                                                  |
| ------------------------------------ | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0-3 exact-SHA 发布门与可信更新链    | **部分完成 / NO-GO**      | CLI npm exact-SHA 子链已是 GO；native 仍需 updater Ed25519、Windows Authenticode、macOS Developer ID/notarization、Linux/Sigstore、签名后的 fresh install/upgrade/rollback、Homebrew/WinGet 实际发布与公开资产逐字节回读。                          |
| P1-1 命令面收敛 / Agent 默认入口     | **部分完成**              | Agent 默认入口与核心帮助面已完成，但 25 个 compatibility alias 仍全部保留。只有取得代表性 Collector/cohort、三平台 reporting coverage、非零 accepted points 与逐命令 usage，并达到 `0.164.0` removal floor 后，才能作最终删除决策。                 |
| P1-2 后台 Agent 恢复、隔离与预算取消 | **部分完成**              | PR #131 已关闭默认后台 worktree、显式 `--no-worktree` 和主要 supervisor fencing；仍缺 native spawn 返回到 PID commit 之间的 hard-kill 窗口、无可复验 PID 的 detached descendant、独立长期 keeper，以及针对该边界的 kill/restart/并发/清理长期矩阵。 |
| P1-5 官方 native 发行物与回滚升级    | **部分完成 / NO-GO**      | 六目标 unsigned validation 已完成，签名公开发行链仍未完成。该项与 P0-3 的 native 子范围重叠，属于同一个主要交付包，不应重复估算为两套独立工作。                                                                                                     |
| P2-2 交互细节                        | **部分完成**              | suggestions、recap、外部编辑器、prompt stash、keybindings 与文本 clipboard 已覆盖；标准终端仍没有 production 系统剪贴板图片 `readImage` adapter，目前只有嵌入宿主 binding 与路径 fallback。                                                         |
| P2-3 MCP 可选协议面                  | **部分完成 / 候选待门禁** | 独立候选已把 resource templates 接成只读 `list_mcp_resource_templates` 生产工具，并正式决定 defer subscribe/logging/completion、保持 sampling `-32601`；在候选 exact-SHA 双门通过并合并前仍不从未完成清单删除，见第 18.10 节。                      |
| P2-4 调度内核收敛                    | **部分完成**              | 磁盘故障矩阵已正式完成；仍有三平台长期 soak 1 个内部子项，见下一节。完成某个 adapter、UI 或 preflight 不能把整项改为完成。                                                                                                                          |

### 18.3 P2-4 剩余 1 个内部子项

1. **三平台长期 soak**：在 Linux、Windows、macOS 上验证 kill/restart、双实例 lease/fencing、DST 边界、积压恢复、FD/handle/orphan 退休与长期资源稳定性。

五域迁移/回滚已随 `chainlesschain@0.163.7` 的最终 release SHA 双门禁、不可变 tag、专用发布和独立公网回读完成而关闭，证据见第 18.8 节。磁盘故障矩阵已由 [PR #186](https://github.com/chainlesschain/chainlesschain/pull/186) 正式关闭，证据见第 18.9 节；其覆盖 ENOSPC、short/partial write、file/directory fsync、rename、损坏记录、原生 SQLite `SQLITE_FULL` 事务回滚、Automation 源恢复原子性、数据库截断与 reopen fail-closed。Agenda/Cowork 权威写入也已改为 private temp + 完整写循环 + fsync + atomic rename，并区分 `not-committed`/`unknown`。

剩余三平台长期 soak 的脚本/修复粗估 **2～4 个工程日**，并至少需要 **3～7 个自然日**观察窗口。P2-4 全部关闭现按约 **0.5～1 周（单工程师）/3～7 个自然日（有效并行）**计划；自然观察时间不能靠并行完全压缩。每次只把已获得 exact-SHA 门禁与相应 artifact 的子项从清单删除。

截至本次核验，先前列为候选的 Automation 相关 PR 状态已更新如下；这些合并扩大了 `main` 功能面，但不替代 P2-4 剩余一项（三平台长期 soak）的退出条件：

| PR                                                                                                       | 当前 head / base                                | 核验状态                                                             | 与剩余清单的关系                                                                   |
| -------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [#166](https://github.com/chainlesschain/chainlesschain/pull/166) channel event dispatch                 | head `5a2ad185ef32119944a9ff6914b23d1bf1264894` | merged as `4681fd84a2d08854d2e3a2e51dae0f7c71a7e0df`                 | 关闭事件 dispatch 切片，不关闭 adjudication、迁移或 soak。                         |
| [#168](https://github.com/chainlesschain/chainlesschain/pull/168) Automation permission/budget preflight | head `42e98215fae0fd564a39245c1abc1e28545b6417` | merged as `1e7efd50d23589f35b2f76fadaeb46a10187c6ab`                 | Automation domain authority 已正式合并，并由 PR #175 组合到跨五入口共享 resolver。 |
| [#169](https://github.com/chainlesschain/chainlesschain/pull/169) Automation Center                      | head `91a3d9c6e5d6a76f06788cf869ac37acd4284a7b` | merged as `074bc471297b4ae0f02445b9bdb30d4dd11d5536`                 | 管理与可视化入口已合并，不替代剩余可靠性退出条件。                                 |
| [#172](https://github.com/chainlesschain/chainlesschain/pull/172) Automation Center 中的 Routine 控制    | head `e0274a477dbc1c76aed61c6d98fda69f4d9b119f` | merged into #169 stack as `a3412b2a6d137c50a9c3bb5858420fe93de5e640` | UI/control 子切片随 #169 进入 main，不单独改变 P2-4 剩余计数。                     |

[PR #174](https://github.com/chainlesschain/chainlesschain/pull/174) 是 base `main`、head `0723e5382cc23a160419b45ec0f33eae0a2bb082` 的 docs-only 历史候选，现已关闭且未合并；本节直接在最新 main 事实之上更新，不沿用该 PR 作为完成证据。

### 18.4 六项产品任务中仍未完成的 3 项

| 产品任务                        | 当前判定                           | 下一关闭条件                                                                                                                                                                            |
| ------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3. Skill/MCP 真实恶意矩阵       | **部分完成 / NO-GO**               | 完成 macOS runtime `exec/open` 原子绑定、任意 native/shared-library 递归闭包、远端 revoke/distributed authority、受信 Node builtin 的最终跨平台隔离边界，并补齐对应三平台长期恶意证据。 |
| 4. 签名 native 公开发行         | **NO-GO / 外部前置未满足**         | 取得真实签名凭据与公开渠道后，在同一 exact SHA 上完成签名、fresh install、upgrade、rollback、渠道发布和公开字节回读；不得以 unsigned validation 或 npm provenance 代替。                |
| 5. 命令 telemetry 与 alias 决策 | **操作决策完成，正式观察项 NO-GO** | 当前继续保留 25/25 alias；等待获批的代表性 Collector/cohort 数据、三平台 coverage、非零 accepted points、逐命令 usage 与 `0.164.0` removal floor。                                      |

### 18.5 推荐执行顺序与总判定

1. `0.163.7` 发布闭环与磁盘故障矩阵均已完成；P2-4 下一且唯一重点是三平台长期 soak。
2. 并行推进 Skill/MCP 剩余平台安全边界；该项取得完整三平台恶意证据前保持 NO-GO。
3. 签名 native 发行等待真实凭据/渠道，一旦前置到位即按 exact-SHA 六目标矩阵执行。
4. telemetry 按真实 observation window 持续采集；在数据和 `0.164.0` floor 前不删除 alias。
5. P2-2 clipboard image 与 P2-3 resource templates 均已有独立候选；分别取得 exact-SHA 双门并合并后才更新完成计数，且不能替代前述发布与安全门。

当前总判定为：**公网 CLI npm `0.163.7` 的 exact-SHA 发布子链为 GO；完整 CLI 产品与 native 公开发行仍为 NO-GO**。`0.163.7` release commit `3e997168621c53708a1682868c6cc4edc9baf15b` 已包含 outcome-unknown adjudication、五域迁移/回滚和因果可观测性，并完成最终 SHA 双门禁、不可变发布和独立回读；磁盘故障矩阵是其后由 PR #186 独立合并的增量，不反写成 `0.163.7` 已包含。长期 soak、Skill/MCP 恶意矩阵和签名 native 发行仍未完成。

### 18.6 2026-08-12 P2-4 outcome-unknown 人工裁决正式合并证据

- 本地候选分支 `feature/cli-scheduler-adjudication-v1` 把 scheduler store 从 schema v2 前向迁移到 v3，新增 `scheduler_occurrence_adjudications` 单调记录。裁决只接受 error code 以 `_OUTCOME_UNKNOWN` 结尾的 dead letter，并以最新 occurrence、authority、payload、last error 和预算 reservation 的摘要形成 `evidenceDigest`；写入时对 exact digest、attempt、fence 做同一 SQLite immediate transaction 内的 CAS，同时记录确定性 request ID、decision、reason digest 与 operator identity digest。一个 occurrence 只允许一条裁决，reason 和本机操作者原文均不进入数据库。
- `confirmed_applied` 只通过一个 host-owned synthetic claim 调用 adapter 的 `adjudicate()` 钩子，然后直接结算 scheduler success，不调用原副作用 `execute()`；`confirmed_not_applied` 只开放一个有界新 claim。Agenda/Cowork 会在 adapter claim 下幂等清除永久 legacy fence；Routine 保留 append-only start/adjudication 历史后再开始一次确定性 run；Automation/Automation Event 会把原 RUNNING 证据改名归档为 CANCELLED adjudication evidence，再用原 execution ID 执行一次；Loop 只在绑定该 request ID、原 attempt 和新 fence 的 claim 中越过默认防重放。共享 scheduler/Automation reservation 均按 occurrence 去重，不重复扣预算。若裁决后的最终 claim 再次崩溃，lease expiry 会把 adjudication 与 reservation 一并 fail-close 结算，不开放第二次裁决。
- 新命令为 `cc daemon scheduler adjudication list|show|decide`。`decide` 强制交互 TTY，先读取只存摘要的 reason，再要求逐字输入包含 `HOST STOPPED AND SCHEDULER DISPATCH DRAINED`、occurrence、decision、evidence digest、attempt 和 fence 的 challenge。该 challenge 是操作性证明，不是 machine-wide process lease；操作者仍必须先停止所有 scheduler host、drain 已 dispatch 工作并核验外部结果，随后重启 host 应用 durable decision。
- 提交前本地证据为 9 个聚焦测试文件 **128/128 passed**，覆盖 v1→v3、v2→v3 迁移、schema fingerprint、防并发 CAS、只筛真正 outcome-unknown、单调 deny、预算 reservation 复用、无副作用 replay 的 confirmed-applied、五类 adapter 的 confirmed-not-applied 恢复以及 CLI TTY/challenge。目标 ESLint 为 **0 errors、7 个既有 warnings**；Prettier、Node syntax、`git diff --check`、help-index/completions check 与 production command help 均通过。
- [PR #180](https://github.com/chainlesschain/chainlesschain/pull/180) 的最终 head `15f337b919df501fbd5d1e5b2c72859b01f5c142` 已以 merge commit `7057d1ad31baebf4b185d114095e7fe63d2fc959` 进入 `main`。该 head 的 [CLI CI `31609620383`](https://github.com/chainlesschain/chainlesschain/actions/runs/31609620383) attempt 2 为 **53/53 success**，[CLI Strict Sandbox `31609663692`](https://github.com/chainlesschain/chainlesschain/actions/runs/31609663692) 为 Ubuntu、macOS、Windows **3/3 success**，两套 workflow 的 `headSha` 均为最终 head。首个 head 的 CLI CI 暴露 `0.163.6` canonical changelog 与内置 artifact 漂移，随后只重新生成 artifact 并形成最终 head；最终 head 首轮唯一失败是未修改的 Windows `headless-stream-questions` 在 `timeout` 与 `stdin-closed` 两个等价终态间的计时竞态，同分片 7361 项及 changelog parity 均通过，同一 SHA 只重跑失败 job 后成功，三平台 `verify-cli` 随后全部成功。没有借用旧 SHA 的 Strict 结果，也没有把首轮失败冒充通过。
- 因此 outcome-unknown 人工裁决从“本地候选”更新为**正式已合并 P2-4 子项**，第 18.3 节内部未完成数由 4 个降为 3 个：完整迁移/回滚、磁盘故障、三平台长期 soak。原始 15 项粗粒度统计仍是 **8 完成、7 部分完成、0 完全未开始；7 项未完全关闭**，因为 P2-4 整项仍未满足全部退出条件。本次没有修改 CLI 版本、创建 release tag 或发布 npm。

### 18.7 2026-08-14 P2-4 五域迁移/回滚与 `0.163.7` 发布闭环进展

- [PR #183](https://github.com/chainlesschain/chainlesschain/pull/183) 已把 Agenda、Cowork Cron、Routine、Automation、Loop 五域迁移/回滚合并到 `main`。最终功能 head 为 `56f0fc579d4999ad10256c5c920f1d1d90b7d870`，merge commit 为 `1fa938fae7a9bb68f1b826927566065448ad6e38`。该 head 的 [CLI CI `31728288640`](https://github.com/chainlesschain/chainlesschain/actions/runs/31728288640) attempt 2 为 **53/53 success**，[CLI Strict Sandbox `31728288347`](https://github.com/chainlesschain/chainlesschain/actions/runs/31728288347) 为 Ubuntu、macOS、Windows **3/3 success**；两套 workflow 的 `headSha` 都是最终功能 head。
- 并发开发的 [PR #182](https://github.com/chainlesschain/chainlesschain/pull/182) 随后以 merge commit `de6105566b54cdd26df0f551259009015c8e3059` 进入 `main`，因此 release branch 已变基到该最新基线。PR #182 的最终 head `53880c298385b58492e8cbf321a672cd96a4b5c3` 通过 [CLI CI `31728668076`](https://github.com/chainlesschain/chainlesschain/actions/runs/31728668076) **53/53** 和 [CLI Strict Sandbox `31728667629`](https://github.com/chainlesschain/chainlesschain/actions/runs/31728667629) **3/3**，新增受验证 session→delivery 因果报告、fail-closed `call-ledger@1` 预算和后台恢复 authority 加固。它的图证明显式绑定到精确 verified revision，不证明某次模型调用在语义上造成某个 hunk；scope 不是身份/成员证明，digest 不是数字签名，machine-local anti-rollback 也不外推为远端信任。
- scheduler store 已前向迁移到 **schema v5**，新增 `source_locator_json`。五域 locator 使用按 domain 收紧的结构（Agenda/Routine 目录、Cowork workspace、Automation database、Loop session ID + directory），校验其与 source scope 一致并拒绝额外/敏感字段；管理输出只暴露 locator 是否存在及其 SHA-256 digest，不回显原始路径。locator 可对旧 journal 做一次性 CAS 绑定/补写，但不会改变原 migration/entry 的不可变业务身份；冲突绑定、同源多 entry 和 target definition 漂移均失败关闭。
- Windows source path 使用独立 canonical 规则：只接受完整 drive 路径或完整 UNC share，统一分隔符并大小写折叠；拒绝 `C:relative`、`\root-relative`、不完整 UNC 及 `\\.\pipe` 等 device namespace。Agenda、Cowork、Routine、Automation 和 Loop 均在 journal 前持久化该 canonical identity，避免相同源因 Windows 拼写差异形成两份迁移或回滚到错误位置。
- 新管理面为 `cc daemon scheduler migration list|show|rollback`。`list/show` 返回去敏 journal、target 计数和 rollback blockers；`rollback` 要求最新 evidence digest、交互 TTY 和逐字 challenge，并为五域分别重新打开/核验源 store。rollback 顺序为**先停用或恢复 scheduler target，再恢复 legacy source**：target revision、definition digest、执行证据与 journal 状态在 SQLite transaction/CAS 下推进；跨 store 的 source restore 再以原 source digest、retirement token 和 marker/fence 复核，进程在 source 已恢复但 journal 未落盘的窗口退出时可幂等重试。它不是跨文件系统的全局原子事务，也不外推为断电/磁盘损坏已经验证。
- Automation locator 绑定到 canonical database identity；从磁盘打开时强制 `fileMustExist`，不会因路径错误静默创建空数据库。由于 sql.js/WASM 兼容层的持久化不提供本迁移所要求的原子 durability，Automation migration 与 rollback 在该后端上明确 **fail closed**，只允许 native SQLite 执行；这不表示整个 CLI 禁止 WASM fallback，而是避免把不可可靠回滚的 Automation 源提前退休。
- scheduler 聚焦矩阵为 **10 files / 196 tests passed**，覆盖 schema v1→v5、source locator、五域 adapter、管理命令、rollback、Windows canonical path、WASM 拒绝、multi-entry guard、target-first/CAS 与崩溃重试边界。功能 PR 门禁过程中又修复 Windows distributed queue worker 有界退出、team adjudication 原子 rename 的瞬态共享错误重试、跨平台 fixture identity，以及短生命周期 Skill authority child 的消息监听竞态；最终功能 head 的两套权威三平台矩阵均已通过。CLI CI attempt 1 唯一失败是 macOS hosted runner 上未修改启动基准的 version p95 为 626.1 ms；同 SHA 只重跑该失败 job 后 version/root-help/command-help/quick-status p95 分别为 106.8/97.7/136.7/205 ms 并通过，不能把首次失败冒充通过。
- 首个 `0.163.7` release head `96cda224eac6269346546db28fdb895a34fee7c2` 的 [CLI Strict Sandbox `31739003932`](https://github.com/chainlesschain/chainlesschain/actions/runs/31739003932) 三平台和 main required checks 6/6 成功，但 [CLI CI `31739004201`](https://github.com/chainlesschain/chainlesschain/actions/runs/31739004201) 为 **49 success / 1 failure / 1 skipped**，因此明确不能授权合并或发布。唯一失败是 Windows unit shard 2/4 的 Skill authority 并发 fixture 在结果已交给 IPC 后正常 `exit(0)`，父端却先观察到 exit、后处理已排队 message。此前只提前安装 listener 仍不足以约束 Windows 的事件交付顺序；后续候选改为终态消息 ACK，并且父端只有在 ACK 后实际观察到 `exit(0)` 才按结果结算，ACK 失败、fixture 非零退出或结构化 error 均继续失败。聚焦文件 5/5、修正版重复 20/20、额外并发 30 轮共 180 次撤销通过；一次本机完整 unit shard 2/4 长时间无汇总后被终止，不计为通过，必须由新 exact SHA 的 Actions 完整重验。
- `release/cli-0.163.7` 变基到 `main@de6105566b54cdd26df0f551259009015c8e3059` 后形成 [PR #185](https://github.com/chainlesschain/chainlesschain/pull/185)。初始候选只包含 CLI version、根 lockfile、根 CHANGELOG、内置 changelog artifact 和本进度文档五个发布文件；首轮权威门暴露上述 Windows fixture 阻断后，候选又加入两个直接相关的测试协议文件及相应 release notes，没有混入新的产品功能。修正后的最终 PR head `670db1b9899d417e31a958afe66ca32ec449e765` 通过完整双门禁，随后以 merge commit `3e997168621c53708a1682868c6cc4edc9baf15b` 进入 `main`；完整发布证据见第 18.8 节。
- PR #183 的功能门禁只证明代码已合并；第 18.8 节记录的 `0.163.7` 最终 SHA 双门禁、tag/publish 和独立 readback 才关闭发布授权。五域迁移/回滚现已从第 18.3 节删除，P2-4 内部未完成数由 3 降为 2；之后剩余项为**磁盘故障矩阵**和**三平台长期 soak**。P2-4 全部剩余工期仍受至少 3～7 个自然日 soak 观察窗约束。

### 18.8 2026-08-14 `0.163.7` 最终发布与独立公网回读证据

| 证据阶段              | 精确结果                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PR head 门禁          | PR #185 最终 head `670db1b9899d417e31a958afe66ca32ec449e765` 的 [CLI CI `31743357727`](https://github.com/chainlesschain/chainlesschain/actions/runs/31743357727) attempt 1 为 **53/53 success**；[CLI Strict Sandbox `31743357375`](https://github.com/chainlesschain/chainlesschain/actions/runs/31743357375) 为 Ubuntu、macOS、Windows **3/3 success**。两者 `headSha` 均为该 PR head，main required checks 6/6 success。Windows unit shard 2/4 在修正后的真实 GitHub Windows runner 上成功。                                                                                                                                                                                                                                                                                                |
| 最终 merge SHA 门禁   | PR #185 以 merge commit `3e997168621c53708a1682868c6cc4edc9baf15b` 进入 `main`，父提交为 `de6105566b54cdd26df0f551259009015c8e3059` 与 `670db1b9899d417e31a958afe66ca32ec449e765`。该精确 SHA 的 [CLI CI `31745391661`](https://github.com/chainlesschain/chainlesschain/actions/runs/31745391661) attempt 2 成功，最终 53 个 jobs 为 **52 success / 1 个正式 tag 路径不适用的条件 skip / 0 failure**；[CLI Strict Sandbox `31745391321`](https://github.com/chainlesschain/chainlesschain/actions/runs/31745391321) 三平台 **3/3 success**。attempt 1 唯一失败是 macOS `--version` p95 `271.7 ms` 超过 `250 ms`，同一代码树的 PR head 为 `120.4 ms`；没有修改代码或阈值，只重跑失败 job，attempt 2 的 version/root-help/command-help/quick-status p95 为 `108.7/110.9/109.5/162.6 ms` 并成功。 |
| 不可变 tag 与专用发布 | 轻量 tag `v-npm-0-163-7` 精确指向最终 merge SHA。专用 [npm 发布 run `31748153519`](https://github.com/chainlesschain/chainlesschain/actions/runs/31748153519) attempt 1 的 exact-SHA gate、完整 test、不可变 tarball、CycloneDX SBOM、Trusted Publishing、CLI publish、registry 字节回读、签名 provenance、证据上传与 npmmirror 同步全部成功；关键 jobs `94607510142`、`94607510220`、`94610203867`、`94610684959` 均 success。不可变 CLI artifact 为 `9200204550`，发布内回读证据为 `9200271483`。                                                                                                                                                                                                                                                                                             |
| 独立公网回读          | [readback `31749404980`](https://github.com/chainlesschain/chainlesschain/actions/runs/31749404980) / job `94611498750` 从 tag 解析同一最终 SHA，重新下载 `chainlesschain@0.163.7`，验证发布 run `31748153519` 的签名 provenance，并证明 registry tarball 与不可变 workflow artifact 字节完全一致。CLI `.tgz` 的 SHA-256 为 `d7ca295e6cdb4e442ee7ad6bb9cc0b9d923f40de4eae395974d91b4dfab83a9d`；GitHub 不可变 artifact ZIP digest 另为 `sha256:b1a49a3e1a735e4cbaed4cbf1a06af1b65c965dbfdd2f2e274890264aa846066`，两者不混用。独立证据 artifact `9200337771` 已上传并保留 90 天。                                                                                                                                                                                                               |
| npm 公网身份          | npm `latest=0.163.7`；公开 tarball 为 `https://registry.npmjs.org/chainlesschain/-/chainlesschain-0.163.7.tgz`，`dist.shasum=5bfb7471643cfe4d4cd0b0a382b31c63fc1efdff`，`dist.integrity=sha512-wcvnXKQqszc/QdwRBhSmDLl0k7BkeLeD/IhO2qZuDlBNKHidt3xh2ZjthLHsB66B8+7ZEtWbDYUY6YXqH+L9Pw==`。npm 未返回 `gitHead` 字段，因此不把缺失元数据冒充身份依据；tag、provenance、发布 artifact 和独立逐字节回读共同绑定最终 SHA。                                                                                                                                                                                                                                                                                                                                                                          |

因此 `chainlesschain@0.163.7` 的 **CLI npm exact-SHA 子闭环为 GO**。五域迁移/回滚已随最终 release SHA 双门禁、不可变 tag、专用发布和独立公网回读完成而关闭；截至 `0.163.7` 发布时点，P2-4 内部未完成数由 3 降为 2。该发布时点的结论仍不授权完整 CLI 产品、签名 native 公开发行、磁盘故障矩阵、三平台长期 soak 或 Skill/MCP 真实恶意矩阵；磁盘矩阵的后续正式完成证据见第 18.9 节。

### 18.9 2026-08-14 P2-4 磁盘故障矩阵正式合并证据

- [PR #186](https://github.com/chainlesschain/chainlesschain/pull/186) 的功能分支 `feature/cli-scheduler-disk-fault-matrix` 关闭了审计发现的两个生产缺口。Agenda 原先会把任意读取错误当作空库、跳过损坏行并直接覆盖 JSONL；现在只有 `ENOENT` 表示不存在，所有权威 mutation 都严格拒绝 unreadable、malformed 或非 object 记录。Agenda 与 Cowork 均通过同目录随机 `wx`/`0600` 临时文件、完整 short-write 循环、file fsync、close、atomic rename 和 POSIX directory fsync 发布新 generation；rename 前失败标记 `not-committed`，rename 后目录 fsync 失败标记 `unknown`，Windows 不伪造不支持的目录 fsync。
- 确定性故障注入覆盖 Agenda/Cowork 的 ENOSPC、成功短写、多次写后失败、file fsync、rename、directory fsync、临时文件与 descriptor 清理、旧 generation 保持、完整新 generation 可恢复，以及损坏/不可读 authority 的 fail-closed。Scheduler 使用真实 better-sqlite3 file DB 和 `PRAGMA max_page_count` 触发原生 `SQLITE_FULL`，证明同一 IMMEDIATE transaction 中先更新 job、后插入 event 的组合整体回滚，关闭重开后 `quick_check=ok` 且旧状态不变；Automation source restore 同样验证 flow 恢复与 migration marker 删除在 `SQLITE_FULL` 下整体回滚。已有效 scheduler 数据库被截断后，重启通过 `quick_check`/schema 验证拒绝打开。
- Routine 继续复用既有 `durable-security-store` 的 private temp、file fsync、rename、POSIX directory fsync 和 corrupt fail-closed；Loop 继续复用 JSONL session append/CAS 的 short-write、fsync、partial-tail、anchor 与 restart 保护。本次没有把这些已存在的通用耐久实现重复改写成 scheduler 专用副本。
- 本地最终 scheduler 矩阵为 **15 files / 362 passed / 1 skipped**；唯一 skip 是 Windows 上不适用的 POSIX directory-fsync 故障。Cowork 相邻 unit/integration 为 **3 files / 64 passed**，Routine/Loop/持久化错误投影相邻矩阵为 **4 files / 50 passed**；Node syntax、Prettier、generated changelog parity 和 `git diff --check` 通过。独立只读复审在修复 Cowork `existsSync` 误判读取错误与合法非 object JSON 后判定无 P0/P1、无提交 blocker。完整本地 `__tests__/unit` 在 10 分钟上限内未返回汇总，不能记为通过；另一次 `jsonl-session-store` 扩展运行的 142 项中 1 项因复用依赖目录缺少 `ajv/dist/2020.js` 未加载，非本次断言失败，也不能记为通过。
- PR #186 最终 head `445a646ebd044a08b4b5a207f4a52cda2b6fd4fa` 的 [CLI CI `31754318604`](https://github.com/chainlesschain/chainlesschain/actions/runs/31754318604) attempt 1 为 **53/53 success**，[CLI Strict Sandbox `31754338463`](https://github.com/chainlesschain/chainlesschain/actions/runs/31754338463) 为 Ubuntu、Windows、macOS **3/3 success**；两套 workflow 的 `headSha` 均为该最终 head。同一 head 的普通 CI 也无失败，最后完成的 Windows Node 22 unit job `94626715280` 为 success。PR 随后以 merge commit `b4813e8e260d2e313a63303eab2e9f829750919e` 进入 `main`，并已同步 GitHub/Gitee。因此磁盘故障矩阵正式完成并从 P2-4 剩余清单删除；P2-4 仅剩三平台长期 soak。跨进程 hard-kill、双实例长期 contention、DST/积压、FD/handle/orphan 和多小时资源稳定性属于该最后一项，不重复计入磁盘矩阵。本次没有修改 CLI 版本、创建 release tag 或发布 npm。

### 18.10 2026-08-14 P2-3 MCP 可选协议面产品决策与 resource templates 候选

独立候选分支 `feature/cli-mcp-resource-templates` 基于 `github/main@b57fad84aeee53e043611ee95e2f4899ccac7b54`，选择一个有明确只读用途的 optional capability 进入生产面，而不是为协议条目数量一次性开放全部能力：

- `setupMcpFromConfig` 现在累计并标注 server-owned resource templates；只要连接结果含 concrete resource 或 template，就注册既有 list/read resource 工具。templates-only server 因而也能先由模型取得 URI 模板，再把具体 URI 与返回的 server 名称显式交给 `read_mcp_resource`。
- 新工具 `list_mcp_resource_templates {server?}` 只读取 MCPClient 已有的有界 capability-discovery cache，返回 `{count, resourceTemplates}`，支持按 server 过滤；它不在调用时新增网络请求、不自动实例化 URI、不订阅通知。descriptor 固定为 low-risk/read-only/idempotent/closed-world，多批 `--mcp-config`、registered server 与 IDE 累计接线只注册一次。
- 本地聚焦矩阵为 **11 files / 186 tests passed**，覆盖 templates-only server、跨批次幂等、旧 `deps.into` backfill、只读 effect contract、按 server 查询、`resources/list_changed` 后的 live template cache，以及真实 headless model→tool→下一轮 model 将 `file:///{path}` 实例化为具体 URI、携带显式 server 后读取的 template/list/read round trip；全部 `mcp-client*` 加相邻 resource/agent config 扩大矩阵为 **29 files / 375 tests passed**。目标 Prettier、Node syntax、spawn inventory 与 `git diff --check` 均通过；ESLint 为 **0 errors、21 个既有 warnings**。本地通过不替代 exact-SHA `CLI CI` 和 `CLI Strict Sandbox` 三平台门禁。

本轮正式产品取舍如下：

| 可选协议面                      | 决策                | 边界与理由                                                                                                                                                                                                       |
| ------------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| resource templates              | **ship 只读生产面** | 已有 discovery/cache、明确的资源读取工作流和 server ownership；只暴露模板元数据，具体读取仍走既有显式 `read_mcp_resource` 边界。                                                                                 |
| resources subscribe/unsubscribe | **defer**           | 保留低层 MCPClient API 与 `resource-updated` typed event，但不自动订阅或在 reconnect 后静默重订阅；等待真实长连接消费方、退订/恢复语义和 unsolicited update 展示策略。                                           |
| logging level / log message     | **defer**           | 保留 level request 与 typed event，但不把 peer-controlled log data 自动写入终端、模型或 session；生产接线前需要独立的有界展示、去敏、背压和信任策略。                                                            |
| completion                      | **defer**           | 保留 `completion/complete` 低层请求，不在 prompt/resource 参数编辑中自动发起远端调用；等待明确交互入口、deadline/cancel UX 与代表性 server 需求。                                                                |
| sampling `createMessage`        | **保持不支持**      | client 不声明 sampling capability，server request 继续稳定返回 JSON-RPC `-32601`；server 发起的模型调用涉及 prompt/data disclosure、费用、provider policy、权限、预算和 durable ledger，不能由可选协议自动放开。 |

该候选取得最终 exact-SHA 双门并进入 `main` 后，resource templates 的生产调用方与其余 optional capability 的明确取舍将共同满足 P2-3 原退出条件，届时可把 P2-3 从原始未完成清单删除。候选状态不关闭 Skill/MCP 真实恶意矩阵，不授权 native 发行，也不改变 npm 版本或创建 release tag。
