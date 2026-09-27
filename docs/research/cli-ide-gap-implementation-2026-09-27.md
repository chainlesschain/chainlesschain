# CLI / IDE 差距实施状态（2026-09-27）

对应 [CLI 审计](./cli/cli-claude-code-codex-gap-analysis-2026-09-27.md) 与 [IDE 审计](./ide/ide-claude-code-codex-gap-analysis-2026-09-27.md)。审计描述修改前快照；本表记录后续实现，避免重复开工或将局部测试当成全部验收。

实现分支：`feature/cli-ide-gap-closure-2026-09-27`。基线 SHA：`24911a536c9e9800c1e2e6b1d72e610841be4f5c`。按已验证范围分批提交，提交记录见下文；本地结果不代表 GitHub Actions 发布验收。

| ID                      | 当前状态         | 实现与有效证据                                                                                                                                                               | 剩余条件                                                            |
| ----------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| MODEL-01                | 本地合同验证通过 | GPT-6 Astra/Sol/Luna、Opus 5.5 精确 profile；官方 endpoint 与自定义网关隔离；三个 GPT-6 型号的 Responses stream/tool/reasoning 回归                                          | 目标账号真实调用；未更改用户默认模型                                |
| MODEL-02                | 本地合同验证通过 | tracker、预算、durable usage、恢复结算和 Eval 统一定价；逐请求长上下文/缓存/服务层级；未知价为 NULL/unpriced。已纳入 45 文件 822 项回归                                      | 目标账号与账单对照；旧聚合缺逐请求信息时保持 unpriced               |
| READY-01                | 本地验证通过     | CLI-only 在 Run/付费分解/通知前拒绝；help、detect JSON、status 区分安装与准入；API 标为 text-only；`--cli-tool` 真正选后端。router/orchestrator 73 项通过，实际命令 4 项通过 | 精确提交 CI；保留逐请求治理门                                       |
| CODEX-01                | 局部实现并验证   | camelCase item、文本/工具 delta、tokenUsage；thread/turn 关联；早到通知有界缓冲；RPC 超时；未知提交不 fallback。12 项通过                                                    | 官方生成 schema 校验、最新固定版本真实 turn；未扩大生产白名单       |
| BRIDGE-01               | 局部实现并验证   | finalize-once；abort/timeout 共用 TERM/KILL；同步 spawn 拒绝；存活 child 的 error 等待 close；task:start 内取消不会 spawn。32 项通过                                         | 各平台真实进程树退出证明；主路由继续拒绝未 attested CLI             |
| IDE-REPLAY / SESSION-01 | 局部实现并验证   | v2 历史与双 IDE 增量合并、来源与身份检查；Windows 双 IDE 实际包恢复通过；JetBrains 旧七标签副本恢复和按选中读取后的完整旅程通过 | 原旧 profile 失败唯一根因未定；其他宿主版本/系统、旧历史边界及真实 rewind/compaction |
| IDE-DRAFT               | 局部实现并验证   | 双 IDE composer/附件/问题草稿、发送前保存与回执核对；Windows 双宿主草稿重启恢复；JetBrains 实际 GUI 的 init 等待中 Stop、迟到 init、取消草稿重启且不重发已通过 | 附件/问题表单真实宿主、跨平台和可访问性待验收；其余准备/写入阶段及再次发送后的 Stop 宿主专项待补 |
| IDE-STREAM              | 本地验证通过     | 稳定文本节点增量 append，结束解析一次；选择区延迟格式化；follow-bottom；10K/100K/200K 与生成 Webview 滚动测试                                                                | 真实宿主 frame p95/最长 task 基准与验收                             |
| IDE-MODE                | 局部实现并验证   | 双 IDE requested/effective/pending/failed/unconfirmed；CLI init 关联 ID、实际模式与 policy digest；JetBrains 独立停止线程、退出确认、启动取消与过期响应隔离                  | 真实组织策略/宿主旅程与全平台进程树证明；观测句柄不是 OS 进程隔离   |
| IDE-IMAGE               | 局部实现并验证   | 双 IDE 4 张/20 MiB turn/40MP 单图；异步处理、逐项错误；CLI 保留 8 张上限，并补齐 20 MiB turn/40MP/header/有界同句柄读取；CLI 图片相关 4 文件 61 项通过                       | 真实宿主测量；完整 codec/动画帧与读取延迟不在 header 准入证明内     |
| NET-01                  | 待实施           | 当前受限域名执行继续 fail-closed                                                                                                                                             | Linux 不可绕过出口后端及真实绕过探针                                |
| NET-02                  | 待实施           | 不宣称已有 HTTP/WS 撤销已覆盖                                                                                                                                                | 依赖 NET-01；revision 收紧终止存量连接                              |
| VERIFY-01               | 待实施/验收      | 保留历史真实模型试点及其范围                                                                                                                                                 | 冻结 30–50 任务、干净安装、实际项目、双 IDE、成本/维护窗口          |
| PLATFORM-01             | 待实施/验收      | 保留 Strict Sandbox 与 unsupported 分支                                                                                                                                      | OS/架构/后端/stdio 矩阵及最新系统真进程探针                         |
| PERF-01                 | 局部实现并验证   | 同磁盘夹具全扫/首进程建索引/已有索引新进程/热首页与下一页/失效重建对照；逐页全量内容校验；路径观测失败不报告完整索引验证                                                     | 精确 SHA 三系统 formal、目标硬件与冻结 SLO；Memory 仍为原全文件端口 |
| PERF-02                 | 待实施/验收      | 复用压缩与工具配对保护                                                                                                                                                       | 真实 usage 校准；中文/代码/emoji/schema 与事实保真                  |
| MCP-01                  | 本地验证通过     | 真实 loopback HTTP 验证 stateless 404、过期 session、并发单次重建、重建失败；只恢复连接，不重放结果未知的工具调用。相关 57 项回归通过                                        | 目标 MCP 服务端互操作与最终提交 CI                                  |
| MAINT-01                | 局部实现并验证   | JetBrains 问答字段合同、存储/请求生命周期和原生表单抽取；保留原 child 交付、schema 校验和草稿恢复不变量                                                                      | 其余 runtime 与平台职责抽取、保行为验证                             |
| DOC-01                  | 实现中           | 本表为两份报告共享状态入口                                                                                                                                                   | 随实现更新证据、最终 SHA 与验收条件                                 |
| UX-01                   | 按现有入口改进   | READY-01 改进 help/status；MODEL-02 改进费用未知值                                                                                                                           | 复用 doctor/instructions/cost；语音/主题不自动立项                  |

真人 NVDA/VoiceOver/Orca 听测、8h/24h 生产观察、真实模型账号尚无本轮新增结果。真实宿主新增 Windows VS Code 1.132.0 与 IntelliJ 2024.2 的有限恢复旅程证据，分别绑定下述提交；模型输出仍为夹具。云恢复与新交互产品仍为报告中的条件性产品决策。

共 20 个分组工作项：5 项本地验证通过、8 项局部实现/验证、5 项待实施/系统验收、2 项持续文档/体验。该计数不是最终验收完成率。[候选发布范围](./cli-ide-release-candidate-2026-09-27.md)单独冻结；长期差距仍按本表继续追踪。用户要求先按依赖顺序发布子 npm 包，再发布并验证 CLI，最后发布 VS Code / JetBrains 插件，已同步到根 AGENTS.md。

### 首轮 GitHub Actions 失败定位与修复

草稿 [PR #383](https://github.com/chainlesschain/chainlesschain/pull/383) 的首轮检查绑定 `01b6c0b7e450c3dca60e03d1b0a5e965b1ff7c53`。用户要求同时处理 Actions 错误；截至本次日志核对，23 个失败作业主要归于下列原因，包含下游聚合失败，不能当作 23 个独立产品缺陷。

| 类别 | 失败证据与原因 | 本批处理与验证边界 |
| --- | --- | --- |
| Strict Sandbox / Session Host Consistency | 三系统 MCP 恢复报 `completion-authority-malformed`；新 canonical projection 增加 `replayEvents`，严格字段校验仍只接受原三字段 | 明确允许可选函数字段，保留未知字段、accessor、head/count 拒绝；不调用 replay lease。原 3 项在 Windows 复现失败，修复后 4 文件 115 项通过 |
| Execution Location | Local 三系统、WSL、Container、SSH 共 6 作业在 npm 安装报 `Cannot read properties of null (reading 'edgesOut')`，下游 aggregate 无产物 | 源宿主与隔离目标均从仓库根使用锁文件及指定 CLI workspace 的 `npm ci`，保留 ignore-scripts。隔离清单目录 dry-run、7 项矩阵合同、actionlint、Bash/PowerShell 语法检查通过；真实各目标仍需新 SHA Actions |
| VS Code ARM64 | Linux / Windows 完整旅程末尾 DOM 缺已出现过的 permission/interrupt 状态 | 普通和 canonical 旅程均在状态出现时保存独立 DOM，仍强制核验两种状态与完整协议记录；不要求瞬时状态在历史重建后保留。69 项宿主/relay 回归通过；新宿主矩阵待跑 |
| JetBrains ARM64 | 四个 macOS/Linux × 2024.2/2025.2 作业等待旧 `force-stopped the agent process` 提示，实际已显示等待退出确认 | 使用当前提示，并在双击 Stop 前只读观测真实 child/descendant PID，等待观测进程全部退出后才继续 resume。UI driver 编译通过，远端实机结果待新提交 |
| Accessibility / Performance | 三系统同一失败摘要；Linux 原始产物含 1 个页面错误、1 个语义播报遗漏，无性能阈值超限 | 本地真实 Chromium 复现 about:blank 缺 `crypto.randomUUID`，发送未发生；夹具改为本地拦截 HTTPS 来源，与实际 webview 安全上下文一致，不模拟 UUID。完整 Chromium 分支页面错误、关键播报遗漏、重复播报、stream replay、heading 遗漏均为 0；不等于人工听测或完整 P2-4 验收 |
| Workspace Publish Staleness | Agent SDK 和 VS Code 源码改动未递增版本 | 保留门禁失败；候选冻结时统一版本和依赖，本批没有发布或改版本 |

另补 v3 宿主旅程检查“取消准备后显式再次发送，第一次 Stop 应为普通中断且保留同一 child”。验证器 51 项、真实 CLI peer/夹具 16 项通过。`1c4cfc08b8` 首次实际 ZIP 尝试在第一个 init gate 前已用尽发送等待时间，未执行到新场景，失败证据摘要为 `sha256:640425af19c82410eaf7f5aa886de5fb6d3bf52a66b0b529cf4cab1bad9c08e6`。夹具 gate 已移到 canonical store 导入/首次 ACL 初始化之前；该失败不作为产品 Stop 缺陷已复现或已修复的证据，后续实机结果另记。

后续在 `e71ace3dc1` 的实际 ZIP 中已经复现产品缺陷：取消准备时没有派发 user，却向空闲 child 写了 interrupt 并保留 `interruptRequested`；随后显式发送的新一轮第一次 Stop 进入了强停分支。失败证据 `sha256:436d269a9e8b4d5fe863160a41a4f75095dccb45d0c2ce6e557425508ed81532` 保留原样。修复在无活动 turn、无待结束 turn 且没有预约 stdin 写入时只取消本地准备/保持空闲，不发送 interrupt 或预约下一次强停；已预约写入和已有活动 turn 仍走原中断及二次 Stop 升级。v3 驱动同时覆盖取消后的空闲 Stop、再次显式发送及同一 child 的普通 Stop；51 项证据/runner 测试通过，实际修复后 ZIP 验收待执行。

修复后准备/预约写入、Agent/进程树停止和草稿相关 4 类共 18 项 Java 回归无失败、无跳过；实际 ZIP 构建与 UI driver 编译通过。

### 第二轮 CI 与 Stop v3 宿主验收

`bcb94c585147e3cf2b98ce1adcc73effd19361e9` 的 [CLI Strict Sandbox](https://github.com/chainlesschain/chainlesschain/actions/runs/36322601225) 三系统全部通过；[Accessibility/Performance](https://github.com/chainlesschain/chainlesschain/actions/runs/36322600985) 三系统作业全部通过，聚合检查另行收集。Session Host Consistency 的 Windows/Linux 已通过，macOS 尚待结果。以上仅属于该 SHA，不能替代后续发布提交的完整矩阵。

JetBrains `bcb94c5851` 的 initial/restart GUI 均通过，但聚合验证器将 Windows `cmd.exe` 启动器 PID 与 Node 夹具 PID 直接比较，整体失败；原失败证据 `sha256:a458e3e38f13af213d24e4af7de9270ab7fb573aad63a6152ac9ee669a9237b7` 保留。验证器改为要求启动器 PID 不变、夹具 PID 始终属于只读观测到的子进程树，并按夹具 PID 关联真实协议记录；增加缺失进程树、无关进程和启动器/Node PID 不同的回归，54 项 Node 测试及驱动编译通过。

干净源码 `c54e902b6346cbc54e6bd3515ddb151c6948c213` 的完整实际 ZIP v3 旅程重新通过，[独立回执](./ide/evidence/jetbrains-canonical-recovery-windows-c54e902b63.json) 复核 **37 个产物长度与 SHA-256**、ZIP 安装逐文件一致性、真实 history/receipt 子进程及 A/B 六行引用。证据摘要 `sha256:61f7a017e588681a6fcd12fed50af6fd055507240fbb96d02df3210a1d2a72ca`。新增证据包括取消准备、迟到 init、空闲 Stop、显式再次发送后第一次 Stop 只中断该 turn 且保留同一启动器和 Node 进程；仍限 Windows x64 / IntelliJ 2024.2 与确定性模型夹具。

第二轮远端 JetBrains ARM64 越过原双 Stop 检查后，普通旅程在重启发送遇到 8 条未知输入保护上限。该旧夹具没有提供 input receipts；增加隔离磁盘的合成回执与只读查询，按 session/client ID 关联、跨进程去重并拒绝 ID 换内容，不修改产品上限或把未知输入自动标为成功。实际子进程回执/Workbench 2 项及 54 项 evidence/runner 测试通过；该普通夹具不作为真实 canonical 存储证据，远端宿主复验待新 SHA。

Execution Location 的依赖安装已通过，后续 Linux/SSH/WSL 日志显示 `session resume` 未向新版 Chat REPL 传入 authenticated evolution ingress；本地 Node 22.22.2 与 CI 固定 Node 22.12.0 均复现。Windows CI 另有更早的 target prepare 失败，本地两版 Node 未复现同一错误。继续分别处理，尚不宣称迁移矩阵通过。Workspace Publish Staleness 仍需候选冻结时统一版本。

`session resume` 已复用当前目标的 Chat 部署授权和 Run 绑定，等待同一 ingress 的交互生命周期结束；仅恢复入口加载部署，read-only history 不受影响。迁移脚本在隔离目标配置临时签名 Chat 测试部署，不传递源账号凭证，也不授予未签名调用权限。真实 CLI 子进程三种场景通过：无部署/仅 Agent 部署拒绝 Chat 恢复，有 Chat 部署正常恢复后 `/exit`，三种情况下只读历史均可用。相关部署、usage 和迁移合同另 4 文件 22 项通过；actionlint、Bash/PowerShell 语法及修改源 ESLint 通过。完整迁移过程和跨平台结果仍待提交后重跑；此处不证明真实 provider 或正式部署权限策略。

`949695433a` 的干净源码 Windows local `prepare-reconnect` 已完成真实目标 prepare、attestation、handoff 与 Chat `/exit`，产出 `reconnect-prepared.json`；未完成 100 次 campaign 或故障阶段，不能报整个矩阵通过。该结果也不能确定此前 Windows CI prepare 失败的唯一根因。

第二轮 VS Code ARM64 Linux 的两阶段 DOM relay 已执行成功，但聚合缺少 `initial-permission-dom.txt`：上一批仅修正 CDP 分支，relay 仍把快照写入限定于 canonical 模式。现在两种模式均保存原始观察快照，明确使用 artifactDir 而非 trace 文件所在目录；测试同时要求权限快照不含尚未出现的 interrupt。69 项真实驱动/runner 模拟回归通过，远端宿主待重跑。

### 第三轮平台修复与普通宿主复验

`c448c08305` 的远端 Linux/Windows Accessibility/Performance 已通过，JetBrains Linux ARM64 的 2024.2 / 2025.2 也已通过；CLI Strict Sandbox 三系统和 Local Linux 100 次迁移随后通过。其余排队或运行中的作业仍按对应 SHA 收集，不能将旧截图中的失败数作为当前缺陷数。版本检查继续保留失败，未升版本或发布。

该提交的 Windows IntelliJ 2024.2 普通控制旅程 initial/restart 均通过：[本地回执](./ide/evidence/jetbrains-control-windows-c448c08305.json) 独立复核 44 个产物长度/摘要，重新检查 rewind、模型设置与 Workbench 协议，并验证 100 个可见性样本。模型与输入回执为合成夹具，不替代 canonical 存储验收；收集目录包含旧共享截图，旧截图不作为本次成功证据。运行开始时源码干净，独立复核时已有后续未提交修复，回执明确区分两者。

同一干净提交的 Windows local [缩小迁移冒烟](./cli/evidence/execution-location-local-windows-c448c08305.json) 完成 prepare、断连/重连、生命周期故障、结果收集/审查/导入和 finalize，共 2 条轨迹；9 个产物哈希/长度复核通过。秘密转移、重复 handoff/settlement、孤儿进程、过期授权接受和静默 fallback 均为 0。此结果不满足 100 次门槛，也没有确定 Windows CI prepare 失败原因。

| 失败类别 | 已核实原因与处理 | 验证与剩余条件 |
| --- | --- | --- |
| Container target provisioning | Docker exec 默认从 `/` 启动，使 home 防护将临时 home 视为工作目录后代而正确拒绝；测试部署配置改用已知仓库路径作为 cwd | 真实子进程从文件系统根启动配置 Chat 部署通过；保持仓库外 home 和签名部署校验，远端 Container 待重跑 |
| WSL1 ArtifactStore identity | 实机内核 `4.4.0-19041-Microsoft` 将 birthtime 回退为 ctime，创建子目录后该值变化而 dev/inode 未变 | 只在 Linux / 4.4 Microsoft 内核且两时间相等时不将该值作为创建身份；dev/inode、无链接、包含关系和句柄校验保留。Node 22.12.0 实机正常 start/complete 通过，目录替换、root/files/index 符号链接四负例仍拒绝；不宣称能防所有 inode reuse/ABA |
| Windows target prepare | 本地两版 Node 和完整缩小流程未复现 CI 退出 1；现有上层错误丢弃目标输出，不能判断根因 | 增加固定枚举失败类别，不回传目标 stdout/stderr、路径或参数，不影响授权/重试决策。12 类回归含秘密哨兵，相关目标/监督器共 34 项通过；等待远端类别后继续修复，不能标为已解决 |

ArtifactStore、WSL1 身份、根目录启动的 Chat 部署、迁移合同共 4 文件 58 项通过、1 项 Windows 符号链接测试按既有条件跳过；上述 WSL1 实机负例补充验证了实际符号链接拒绝。修改源 ESLint 通过。迁移证据的 producer 清单补入部署 helper、签名测试夹具、session resume 和 ArtifactStore 身份依赖，后续最终提交须重新取得完整矩阵。

后续 `8db732245f` 的 Windows CI prepare 仍返回退出 1，固定类别为 `unknown`，因此未将其标为修复。进一步增加白名单源码标签/行号（例如 `session-store:5422`）：目标 JSON 命令在失败时发出有界标记，源端只允许已知标签和合法行号，不返回完整堆栈、目标路径或消息；未知格式丢弃，失败继续阻止迁移。相关 55 项单元/合同通过，真实命令路由与协议升级回归另 27 项通过。工作流路径过滤同步覆盖目标部署 helper、签名夹具、Chat resume 和 ArtifactStore 依赖。

`c448c08305` 的 JetBrains ARM64 五个版本/系统单元最终均通过，SSH 100 次迁移也通过。VS Code Windows/macOS 的 minimum 宿主都在等待 interrupt 结果时超时，Windows 失败证据为 `sha256:7456b01e40422d7ff8289ebe0a225e8dbe914fcaa0cd2855fb85e3fc8425b2a8`；原始协议确认 Stop 已送达且 CLI 在 3 秒后返回 interrupted。产品 Webview 在有流式历史行时抑制了非错误终态文字，使中断提示只剩短暂的读屏播报。修复将 interruption 保留为独立 info 状态行，不覆盖已有回答，不依赖 aria-live 文本；缓存与切换会话的重绘使用同一行身份，内部 UI 协议 6→7 使旧保留 Webview 正常重载。带/不带流的两个回归先失败后通过，历史同步/恢复/流式渲染共 23 项通过，host/relay/SDK Node 测试 77 项通过；远端 minimum 宿主复验仍待新 SHA，不提前算通过。

`8db732245f` 的本地 Windows→WSL1 缩小运行完成 prepare、断连/重连、生命周期故障、1 次 campaign 和 finalize，产物记录 2 条轨迹、graceful SIGTERM、结果收集/审查/导入各 2 次，以及秘密转移/重复/孤儿/静默 fallback 均为 0。不过外层 PowerShell 工具返回退出 1，日志仅有 Node 22.12 的 CJS/ESM ExperimentalWarning，尚未独立确认最外层退出状态；暂记为成功观察产物，不计作干净退出或完整 100 次 CI 验收。

### IDE-REPLAY 规范压缩前历史分页

新增 `session show --json --history --page-size 50 [--before <cursor>] <id>`，使用 `chainlesschain.session-transcript-page/v2`；不带 `--history` 的 v1 active context 页保持兼容。规范 Kernel compaction 的摘要、类型及输出投影一致时，显示历史保留此前原始消息，不重复加入压缩摘要；不改变模型 resume context。每条显示消息按 session/event hash/item index 标识，重复正文仍是独立消息。游标包含 session、generation、revision、eventCount 与 before，读完整 hash chain/namespace/anchor 后核对历史前缀；追加消息和规范压缩不使旧页重复，回退或替换使旧游标失效。

旧式 `compact` 同时承担迁移、session-end 保存和上下文替换，不能一概视为保留历史的压缩。无法确认规范压缩、缺少可验证来源的 timeline rewind 或旧 snapshot branch 均明确返回 `coverage=snapshot-boundary`；VS Code 显示历史起于保存快照，不能借此恢复已撤销的消息。完整复制 fork 保留父链历史，显示身份绑定新 session，不允许跨 session 游标。旧 snapshot branch 本身只保存了所选上下文；新写入的回退前缀和分支继承见下文，不能据此将旧记录标为全历史验收。

VS Code 显式请求 v2，检查消息身份、连续序号、重复 ID、revision/coverage 及下一页边界；切换回 live cache 保留分页入口与覆盖范围说明。旧 CLI 不支持新 flag 时明确加载失败，不悄悄宣称完整历史。读取不启动 Agent、不执行工具、不重新发送用户输入。仍是快照分页替换，尚未实现 durable/live 事件增量合并与去重；JetBrains 后续接入见下节。

页面保留至多 100 条/1 MiB 行载荷，单条文字最多 200K 字符；省略标记通过 truncated 返回，旧页逐步遍历。完整性验证每次仍需 O(N) 扫描，规范压缩校验临时空间受单个 canonical record 大小限制，不宣称索引页性能或全文不截断。

本批相关回归 8 文件 72 项通过；新增历史/宿主 2 文件 15 项最终通过。首次扩展运行的摘要夹具预算过小，Kernel 正确排除摘要而未覆盖预期路径；提高夹具预算后，已断言 active context 确实包含摘要、显示历史仍只含原正文。覆盖真实磁盘、两次规范压缩、保留摘要、追加后的旧游标、回退、两类分叉、无效 revision、篡改尾记录、有界多页遍历、只读命令及宿主身份校验。修改源文件 ESLint 0 errors/warnings；Prettier、三个命令 drift check 与本地 VSIX 构建通过。实现边界见 [Chat history recovery](../../packages/vscode-extension/docs/CHAT_TRANSCRIPT_HISTORY.md)。未执行真实双 IDE GUI 或精确提交 Actions。

### IDE-REPLAY 回退的有效祖先前缀

CLI timeline `restore-conversation` / `restore-both` 在既有同步会话事务中写入 `historyPrefix`：绑定实际当前 head、源上下文长度与保留前缀长度。历史读取同时核对前一事件 hash、完整保留消息及被选 user 的来源；不能仅凭相同正文猜测原事件。规范压缩的直接消息按 source sequence / source digest 追踪，摘要按可核对的 parent digests 合并来源区间；来源未知、区间跨越回退点或替换正文不匹配时仍只使用显式快照。

验证通过后保留回退点之前的原始显示行及身份，排除已撤销路径，generation 改变并使旧游标失效。回退后追加、再次压缩、再次回退及完整复制 fork 沿用这条有效祖先范围；先前已存在的 snapshot coverage 不升级为 from-origin。仅改变显示历史选择，不改变模型恢复上下文、文件恢复事务、绑定表裁剪或审批权限。

回退点可能早于内存页缓存，因此按最终选定范围在同一读锁内重扫完整链，再核对相同 head / event count / namespace / anchor；只读 visitor 在 finish 返回时失效，禁止异步或重入。页仍最多 100 条 / 1 MiB 行 JSON；可选来源映射最多 32,768 条 / 8 MiB 当前消息 JSON，超限丢弃映射并在回退时退到快照。最多 16,384 个不连续范围，超限明确失败；解析单条 canonical record 的临时内存另受原记录限制。可能需要两次 O(N) 扫描，不宣称索引查询或延迟改善。

本批当时的旧回退记录、timeline summary-from/to、snapshot branch、无法匹配持久化布局或摘要 parent 的来源仍是明确边界；后续新分支和新摘要记录的改进见下文。本批没有回填旧会话、借父文件恢复分支或合并 durable/live 事件。真实双 IDE 宿主、精确 SHA 跨平台 Actions 仍待验收。

本批 9 文件 224 项：222 通过、2 项既有目录 fsync 用例在 Windows 条件跳过、0 失败。覆盖真实 JSONL/Kernel、真实 CLI timeline 预览与确认、回退到页缓存之外、连续回退/摘要压缩、重复正文的来源身份、追加后分页、完整复制 fork、快照覆盖边界、错误前缀/未知 parent/交叉摘要/映射超量、只读重扫期间篡改及 lease 失效；同时回归 canonical store、输入回执、v1 分页和 checkpoint 权威路径。最后避免映射超量后继续解码消息的优化，另 4 项来源回归通过。修改源文件 ESLint 0 errors/warnings，只有根 package.json 既有 ESM 提示；Prettier 与 diff 检查通过。未将这些本地结果视作真实宿主或发布验收。

### IDE-REPLAY 分支的独立显示历史

新 timeline branch 在父会话事务内以限定同步读取凭据取得有效前缀，再在目标分支锁内流式复制显示记录。父源完整验证及 head 检查、来源范围与相同上下文核对均保留；读取过程中不能向父 writer 追加，凭据离开读锁后失效。分支持久化自身的消息、来源事件/item、上下文 origin 区间、条数与完整创建摘要，读取时不再依赖父会话路径。父会话删除后仍可分页；重复正文、嵌套分支、后续压缩/回退及完整复制 fork 各自保留有效范围与 session 命名空间。

显示归档使用独立事件，模型上下文沿用原有 branch 投影，不继承父会话审批、输入回执、工具执行请求或计费权威。完整可显示文字按每片最多 128K 字符写入，避免将页面的 200K 显示限制变成永久存储截断；不拆开 surrogate pair。每条逻辑行按最后一片的事件标识，分片顺序、来源一致性、context message digest、行/上下文计数和完成摘要均核对。最多组装 16 MiB 文字 / 256 片，源单条 canonical record 仍有 16 MiB 限制；图片保留显示占位，不宣称复制完整原始媒体或工具事件日志。

创建与重试不再把整条分支读入 event 数组；按流比较准确前缀后续写。未完成历史分支不提前发布 sidecar/witness，第二次失败也不会将半份副本变为可恢复会话；较高的既有 anchor 不回退。旧版本已创建的 snapshot branch 保持原内容与幂等性，不在重试时重写成新历史。未知来源、旧回退/摘要记录及旧 snapshot branch 的覆盖缺口仍明确保留；后续新摘要来源验证见下文。源验证、摘要与复制需要多次全扫和逐记录持久化，不宣称创建延迟 SLO。

同时修复 v1/v2 页面对大量转义字符的字节边界：单行 JSON 超过 1 MiB 时保留带 truncated 标记的文字前缀，不再整行丢失；分页显示限制与分支完整存储分开。真实 IDE GUI、可访问性听测、durable/live 增量去重和精确提交三系统 Actions 仍待完成。

本批最终 9 文件 234 项：232 通过、2 项既有目录 fsync 用例在 Windows 条件跳过、0 失败。覆盖真实 CLI 的分支预览/确认与回退、父会话删除后读取、嵌套分支、摘要压缩后继承/回退、完整复制 fork、两代大文本原文保存、emoji 分片、旧分支幂等、两个连续失败后的前缀恢复、较高 anchor 回退拒绝、复制期间源篡改、分片顺序/完成摘要/上下文来源验证、过期凭据/读期间写入拒绝；同时回归 canonical store、v1/v2 分页、输入回执和 checkpoint 权威路径。首轮两处夹具误用了删除函数名与命令响应层级，已修正并复跑。修改源文件 ESLint 0 errors/warnings（只有根 package.json 既有 ESM 提示），格式与 diff 检查通过；没有运行真实 IDE GUI、发布插件或精确提交 Actions。

### IDE-REPLAY 时间线摘要的可验证来源

新 `summary-from` / `summary-to` 在现有会话事务内写入 `historySummary` v1：绑定提交前的实际 head、源上下文条数及替换范围。计划器和读取器共用确定性摘要投影，读取器核对完整输出与 durable system provenance 后保留原正文；不是凭 action 名称或相同文字猜测来源。模型仍使用原有摘要上下文，原显示行、generation 与已有分页游标不因可验证摘要而改变；后续真实回退仍使游标失效。

摘要的 system 消息继续携带保守来源区间，参与后续摘要、Kernel compaction、分支导入与回退的交叉检查；未知来源或横跨回退点时退到快照，不能因 system 不显示而绕过验证。`summary-to` 的首条 system、已授权 durable system、未标记 system 排除规则，以及绑定表裁剪均沿用既有行为。区间只表示依赖范围，不宣称摘要保留全部事实或已校准压缩保真。

连续摘要、压缩前后摘要、新分支独立复制、父会话删除及完整复制 fork 均沿用这条来源链。早先 snapshot coverage 不升级；旧摘要缺少证书、head/count/range/output 不一致、上下文映射超过 32,768 条 / 8 MiB 时仍显示快照边界。v1 投影及 extractive formatter 的改变须升级来源协议或保留 v1 reader；不兼容时不能声称完整历史。每次历史读取仍验证完整链并重建摘要，无索引或延迟改善承诺。

带 system 摘要来源的分支使用 branch-history descriptor v2，其余仍写 v1；新 reader 同时读取两版，并校验 system 的 durable tag 及来源区间。旧 reader 拒绝 v2，避免忽略新来源；v1 的 system 空来源规则保持不变。扩展回归首次发现旧分支 reader 拒绝非空 system 来源，已据此补齐版本化协议并复跑。

本批最终 9 文件 252 项：250 通过、2 项既有 Windows 目录 fsync 条件跳过、0 失败。覆盖两种摘要后的原行身份与旧游标、连续摘要、system 来源移动/交叉/缺失、压缩前后摘要、分支幂等与父会话删除后读取、完整复制 fork、v1/v2 来源规则、非法证书/输出、映射超量及旧记录快照边界；同时回归 canonical store、checkpoint 权威路径、v1/v2 分页与输入回执。CLI 旅程在 Vitest 中直接执行实际 Commander 预览/确认实现，未启动已安装 CLI 子进程。修改源文件 ESLint 0 errors/warnings（只有根 package.json 既有 ESM 提示）；Prettier 与 diff 检查通过。本批未修改 IDE 实现、重建或发布插件；真实双 IDE GUI、durable/live 增量合并、精确提交跨平台 Actions、生产观察和发布验收仍未完成。

### IDE-REPLAY 持久历史增量读取

最新 v2 history 页增加 `syncCursor`，绑定 session/generation、实际 head/eventCount 和下一条显示 ordinal；旧页导航返回 null，不推进最新视图的同步基线。新增 `session show --json --history --after <cursor> --page-size 50 -- <id>`，返回 `chainlesschain.session-transcript-changes/v1`，包括 `from`、连续显示行、`nextCursor` 与 `hasMore`。每次返回游标之后的首个有界批次；达到条数或字节限制时将下一行留给续页，不能跳过大消息后返回更晚的小消息。

消费者需按 session/event/item 身份去重重试；批次之间继续追加不会遗漏。只有元数据变化时可返回空行并推进 verified revision。规范压缩和已验证 timeline summary 保持游标；回退、快照替换、跨 session/fork 或错误版本明确失败，不能把新路径追加到旧 durable 视图。增量命令的 JSON 错误对象与非零退出码保留 stale/不可读/存储错误的区分，完整性错误不能伪装成普通游标过期。即使当前批次已满，仍验证完整尾链及 anchor；既有历史回退需要的同锁重扫不变。单批至多 100 行 / 1 MiB 行 JSON，单行至多 200K 字符，复杂度仍是 O(N) 验证，不声称索引或延迟改善。

协议与消费规则见 [CLI transcript changes](../../packages/cli/docs/SESSION_TRANSCRIPT_CHANGES.md)。本批是后续 durable/live 合并所需的持久读取合同；双 IDE 仍使用快照页，尚未接入现场流输出与 canonical 行的稳定对应及增量合并，不将新增 API 计为 IDE-REPLAY 全部完成。

相关 7 文件 89 项通过；补充 JSON 错误路径后，相关 2 文件 34 项再次通过，结果有重叠不相加。新增 9 项场景包括真实磁盘、Kernel 压缩、timeline 摘要/回退、批次间追加、重试、同正文身份、metadata-only 空页、快照覆盖、字节上限、跨 fork/错误游标及满页之后的坏尾链。独立 Node 进程实际运行仓库 CLI 入口，验证只读增量、参数互斥、stale JSON 与完整性错误区别；不是已安装发布包或真实 IDE 宿主。修改源文件 ESLint 0 errors/warnings（只有根 package.json 既有 ESM 提示）；Prettier、diff 与四项命令生成 drift check 通过。生成器记录顶层命令信息，本次子命令选项没有产生生成文件变更。真实宿主、当前跨平台、发布与完整增量合并仍待验收。

### IDE-REPLAY 最终回复与持久事件引用

stream-json 每轮最终 `result` 可带 `transcript_refs` v1：绑定 session 与本轮已提交的 assistant event hash，已知时附带 user event hash 和 client message ID。普通消息写入函数实际返回同步提交回执；仅 `commitState:committed` 与合法字符串 hash 可生成引用，不将回执误当完整消息事件。用户 ID 来自本轮普通 append 或已验证输入接受回执；无持久化、重复输入 ACK、未确认/失败的 assistant append 和未落盘的提前结束均不产生最终回复引用。预算/错误结果若保存了最终文字仍可携带引用，引用不修改执行结果或接受状态。

共享 schema 增加可选字段及正反 fixture，并生成 TypeScript/Python/Kotlin/Swift/CLI 产物；SDK 公共 ResultEvent 提供类型。消费者仍须核对原 child/session/view、外层 session ID 及经完整历史验证的行和角色，再按完整 row ID 合并；不能按正文相等去重，不能把最终回复 ID 套到所有流片段/工具卡，也不能从引用恢复执行权。双 IDE 本批仍未接入引用和增量合并，IDE-REPLAY / SESSION-01 保持局部验收。

本批 CLI headless 71 项、SDK 3 文件 44 项、共享协议 19 项、Python 3.12 协议 17 项与 JetBrains ProtocolFixturesTest 9 项通过，共 160 项，无跳过或失败。真实临时 canonical 存储测试连续运行三轮相同输入/回复，核对六条历史行与各自事件身份，覆盖带/不带 client ID；模型循环为注入夹具，未调用真实模型。另覆盖未确认/缺失/非法/异步/失败 append、重复接受 ACK、SDK 原样传递及共享 schema 正反样例。首次 Python 命令选到本机 3.8，低于项目 >=3.10 要求；改用已安装 3.12 后通过，不计旧解释器运行作通过。SDK build、schema 与 VS Code/Desktop vendor drift check、Prettier 和 diff check 通过；修改源文件 ESLint 0 errors、3 项既有 unused-variable warnings。Kotlin 编译通过并保留既有冗余 `?` 提示；未编译 Swift，也未进行真实双 IDE GUI、最终提交 Actions 或发布。

### IDE-REPLAY VS Code 增量合并与原位显示

VS Code 已接入 latest `syncCursor` / `--history --after`，校验连续 ordinal、完整 row ID、session/generation、revision/eventCount 与下一游标；每次至多读取 8 个 50 行批次，应用后才推进游标，余量通过 Latest 继续读取。Older 独立浏览，不推进增量基线，也不被后台流输出替换。后台标签继续更新自身缓存；活动 turn 延后读取，异步结果核对 conversation、child、session、request、异步代次与 transcript revision，重置/替换/关闭后的迟到结果不落入新视图。

输入接受回执和最终回复引用只建立候选关联：原 child 的 client ID 对应用户行，最终 assistant segment 对应已提交 event hash；核对已验证历史的 session/event/role/item 后才变成 saved row。重复回执和重试批次可复用此前验证行；同正文的不同事件保留为独立消息。未关联的过程文字、工具活动和诊断保留为 live-only；旧 CLI 无引用时不能按文字猜测对应，可能同时显示无法关联的 live 与 saved 行。只有明确 stale 错误触发新基线；完整性/解析/进程错误保留缓存和游标并显式提示。

Webview 通过稳定显示 ID 原位更新，保持未变化节点、工具控件与滚动位置。选区内的冲突修改/删除/重排延后到取消选择；新的 live 事件使旧延后投影失效。显式切换 Older/Latest 可重建当前页，UI 协议升级为 v6 以替换保留的旧脚本。合并缓存仍限制 100 行 / 500K 字符，DOM 仍限制 800 节点，早期持久行通过分页查看。本批未给所有工具/过程片段补持久化，也未完成 JetBrains 增量合并或真实双宿主验收。

本批相关 25 个 Vitest 文件 312 项通过，扩展原生 `test:unit` 最终 215 项通过；覆盖真实 canonical 临时磁盘、生产 ChatViewProvider（VS Code API stub）、共享输入引用、生成 Webview 的 DOM/选区、停止后 partial 与诊断分离、八批次上限与继续读取。新增测试统一使用扩展实际 CommonJS 加载路径，避免测试转译与原生 require 产生两份进程归属记录；旧断言补充新增显示 ID。首次原生全量出现 1 项失败且输出截断，未定位失败项；随后两次原生全量均 215 项通过，保留该未复现记录，不声称已查明并修复其原因。修改源文件 ESLint 0 errors/warnings；本地 VSIX 打包成功（保留既有未 bundle 提示）。这些是本地实现与回归证据，未运行真实 VS Code GUI、跨平台或精确提交 Actions。

最后补充“从 Older 返回时只重建一次，迟到读取不再次清空选区”的防护后，相关 2 文件 14 项通过（与前述结果重叠）；Prettier / diff check 通过。最终本地 VSIX 中 5 个修改/新增聊天模块的 SHA-256 与当前源码一致；未安装或发布该包。

### IDE-REPLAY JetBrains 历史恢复与只读分页

JetBrains 重建/选择已有会话读取 v2 page；Older 使用独立历史面板，Live 回到保留的现场正文，Latest 显式读取最新页。发送输入回到现场，不将新回复拼接到旧页。后台完成仍保留各自正文，迟到读取按 session/view epoch/request/live revision 隔离；活动 turn 推迟替换，重置/切换 session/关闭取消旧请求。自动更新保留选中文字及向上阅读位置；失败、interrupt 和退出提示不被自动快照清掉。历史替换不执行工具、不重发审批、不重复播报结束事件。

使用独立读取通道，2 个后台 worker、32 项队列；stdout 最多 2 MiB，stderr 最多保留 16 KiB 并继续排空，非零退出、错误 UTF-8、非法页、超时/超量均显示失败。解析核对 session/event/item ID、重复项、连续序号、revision 与游标范围；页中至多 100 条/1 MiB 文本/每条 200K 字符完整显示，避免旧 live document 的 200K cap 把同页前半部分静默丢掉。下一次现场输出恢复 live cap；显示为可选择的纯文本。CLI 二进制解析仍复用原机制，35 秒 timeout 从 query capture 开始；退出证明沿用已观测子孙机制，不宣称隔离容器或捕获已脱离子孙。

实现与剩余边界见 [JetBrains saved conversation history](../../packages/jetbrains-plugin/docs/CHAT_TRANSCRIPT_HISTORY.md)。新增同一份真实 CLI 输出 fixture 供 Java 与 VS Code 消费，另有真实 Java 子进程输出/取消/超时及 Swing 双会话、迟到结果、选择/滚动保留、分页、错误与大页测试。全量 JDK 21 test/smokeTest/buildPlugin：103 个 suite、889 项 JUnit，886 通过、3 项既有平台跳过，0 failures/errors；1,436 项 smoke 断言通过，并生成本地 ZIP。首次 UTF-8 子进程夹具沿用 Windows stdout 默认编码，严格解码正确拒绝；夹具改为显式 UTF-8 字节后全量通过。CLI/VS Code 历史回归 2 文件 16 项通过。最后补充滚动/紧凑导航、停止提示在切 tab 后仍保留的行为后，相关 4 个 JUnit 文件 25 项及打包再次通过；ZIP 内 8 个相关 class 与当前编译产物 SHA-256 一致。滚动夹具在初始 caret 布局完成后模拟读者上滚，避免把初始布局误作刷新行为。真实 IntelliJ GUI、可访问性听测和最终提交 Actions 均未执行。

### IDE-REPLAY JetBrains 增量合并与现场身份

JetBrains 现接入 latest sync cursor 与 `--history --after`，核对 session/generation/head/count、连续 ordinal 和续页边界，应用成功才推进游标。每轮最多八批，剩余通过 Latest 继续。Older 保持独立面板/游标；metadata-only 更新推进 revision 而保留可见消息范围。只在非零退出的合法 changes-error 对象明确声明原 session 游标 stale 时读取新基线；完整性、无效 UTF-8、跨 session、解析和其他进程失败均保留原正文与游标。

发送 worker 在写 stdin 前通过 EDT 固定用户行的 client ID / child / session 身份；快速接受回执可找到已显示的输入。终态引用仅绑定同 child 的用户候选和最终 assistant 段，经已验证 row/event/role/item 核对后合并；过程文字、工具和停止诊断保持独立。相同正文的不同事件不去重，重复回执/重复批次不复制已识别行；旧 CLI 没有引用时不猜测匹配，可能同时保留现场与保存行。

Swing document 按范围修改，保留未变化文字、选区及上滚阅读位置。冲突删除/替换/重排或受选区阻止的淘汰延后至选择结束；child/session/epoch/request/live revision 变化后旧结果不再应用。历史缓存最多 100 条 saved 行 / 1 MiB 加 16,384 标题字符，metadata 最多 4,096 项；saved 行淘汰同时移除正文，不能丢身份后伪装成 live-only。live append 沿用 200K cap，早期 saved 内容通过分页查看。选中的最终 assistant Markdown 保留纯文本，本批没有实现取消选择后的延迟 Markdown 格式化。

本地 JDK 21 全量 `test smokeTest buildPlugin`：107 suite、907 项 JUnit，其中 904 通过、3 项既有平台跳过，0 failures/errors；1,436 smoke 断言通过。随后补充 100 行缓存淘汰、metadata-only 可见范围与 4,096 项范围上限期间的候选身份保护后，最终相关 8 suite、44 项全部通过，并再次生成本地插件 ZIP。测试使用真实 CLI 子进程输出的共享 baseline/changes/metadata/rewind/九批续页 fixture，及真实 Java 错误/UTF-8 子进程、Swing selection/document/viewport。首次发现历史插入触发 DefaultCaret 延迟滚动，已通过更新策略和可见性保护修复；新增选区夹具最初混用 Windows 序列化 CRLF 偏移，改为真实 Document 偏移并断言所选文本后通过。

CLI / VS Code 共享历史回归 2 文件、49 项通过；新 fixture 由隔离临时 home/security 下的实际 CLI stdout 生成，生成脚本可重跑。最终插件 ZIP 内 28 个相关 class（含内部类）与当前编译产物 SHA-256 一致。新增生成脚本 ESLint 0 errors/warnings，保留根 package.json 既有 ESM 提示；Prettier / diff check 通过。以上运行有重叠，不累加成独立覆盖率。

这些是本地组件/协议/打包证据，未执行真实 IntelliJ GUI、双 IDE 安装旅程、真人读屏或最终 SHA Actions。本批没有将 IDE-REPLAY / SESSION-01 标记为全部完成。

### IDE-DRAFT 输入回执边界

新增可选 `client_message_id`，CLI 仅在 canonical 持久化可用时声明 `input_receipts.version=1`。原始输入摘要与 user event 一同写入已有 writer authority，完整验证 chain/anchor 后才返回接受回执；重复 ID 不再调用模型，冲突/校验异常/存储失败不能降级为普通发送。`session show --json --input-receipt <id>` 只读查询，压缩后仍可查询原回执。SDK 已提供可选传参，并同步 VS Code / Desktop vendor。

接受不等于执行完成；落盘后、执行前崩溃可能仅留下已接受输入。丢失 ACK 时应先只读核对，不自动重放。当前查询与去重仍为 O(N) 全历史验证，未宣称索引性能或跨进程外部副作用 exactly-once。双 IDE composer 与问题表单草稿已接入；不能将后端合同或局部宿主实现计为 IDE-DRAFT 全部验收。

本批 CLI 回执/stream/session page/lazy dispatch：4 文件 93 项通过；SDK 发送与共享协议映射：2 文件 33 项通过；SDK 构建及 schema drift check 通过；修改的 CLI 源文件 ESLint 0 errors、3 项既有 unused-variable warnings。

JetBrains `ProtocolFixturesTest` 也已通过，包含同一份新增回执 fixture；这验证旧宿主可忽略新 ACK 并处理重复输入的终止事件，不代表 UI 已实现持久接受状态。

### IDE-DRAFT VS Code composer 与发送状态

工作区专属存储使用稳定 draft key，正文与校验过的附件快照分开保存，Memento 只保留 tab/key。生成的 Webview 使用有界文字备份保留等待 host 保存的输入；发送先保存待确认记录，再写入 UNKNOWN，最后写 stdin。init 的可用性确认、会话 ID、child token 与 generation 都参与发送检查；只有匹配的 CLI 回执或只读查询可标记 accepted。旧 CLI 和 EPIPE 不伪装成持久接受；恢复不自动发送。图片尚未加载、缺失或被改写时阻止发送，延迟恢复不覆盖新的文字。关闭/重置后的草稿可通过恢复入口打开，reopen shortcut 保持原 draft key。

限制为单条文本 100K 字符、4 张/20 MiB/40MP 图片、每草稿 8 条未解决输入、128 个存储目录与 100 MiB；保存队列限制 64 项及 40 MiB 图片载荷。元数据临时文件 flush 后 rename，失败保留旧记录并清理新快照。未宣称断电耐久、多 Extension Host 并发写同一存储的协调，或完成真实宿主验收。实现说明见 [Chat draft recovery](../../packages/vscode-extension/docs/CHAT_DRAFT_RECOVERY.md)。

本批最终聊天回归：23 文件、281 项通过，其中新增草稿/host/生成 Webview 场景 15 项。覆盖真实临时目录、rename 失败注入、快速连续编辑、缺失/改写附件、旧 CLI、延迟 ACK、写入失败、重建 host、reset/close、异步查询期间先恢复 composer。修改的 VS Code 源文件 ESLint 0 errors / 0 warnings；`git diff --check` 通过。未将此结果视为真实 GUI 或发布产物验收。

### IDE-DRAFT VS Code 问题表单与原生 review

问题草稿绑定 session/request/完整 interaction binding 与 schema/问题摘要；host 为每个 live request 生成独立实例，Webview 重建恢复同实例，Extension Host 重建仅对后端重新发出的精确绑定请求恢复字段。旧式无 binding 请求只允许原 host 实例恢复。表单文本、checkbox、select 保持 DOM 顺序；密码、writeOnly 及无法判断敏感性的 JSON fallback 不落盘、不进入 Webview 备份。普通自由文本仍为本地明文草稿，不宣称能够自动识别所有秘密。

发送回答先预约再保存，重复点击不会重复写管道；仅 `question_resolved` 将请求标为结束，pipe 失败或明确 reject 留在未知/未完成状态，不自动重试。URL elicitation 使用 host 保存的原 URL 和原 session，并在 await 后重验，已覆盖切 tab / stop / 替换 session 的回调隔离。取消、schema 变化、blocking turn 结束及 child 退出均归档；迟到字段只能更新归档文本，不能恢复旧执行权；deferred 请求可跨 turn 保留。归档内容可从现有草稿入口复制到空 composer 继续编辑，不自动回答旧问题。

App Server 原生 InputBox/QuickPick 初始增量捕获半输入文字、筛选词和选择值，与 Chat 共用串行 store。崩溃后精确重发才能恢复 live 字段，cancel/accept 后只保留归档文字；保存失败阻止提交。后续结构化 schema review 与原连接生命周期实现见下节；未将原生 callback 返回值当成服务端接受确认。

每草稿最多 16 条问题记录、128 字段、单字段 32K 字符、字段总载荷 64 KiB；record 上限 128 KiB、host request map 上限 256。Webview 文字备份最多 16 表单/64K JSON 字符；schema 身份计算有深度、节点数与字符预算。限制达到时显式显示保存失败，不声称 forced exit 无损恢复。

本批最终聊天回归为 24 文件、295 项通过（含新增问题草稿场景 14 项）；原生对话框 / App Server pilot / Host DOM relay 的 Node 回归 3 文件、25 项通过。新增场景覆盖真实临时文件存储、生成 HTML、原生 API stub、匹配重发、schema 变化、tab 切换、迟到恢复/编辑、密码排除、重复点击、失败保存与 URL 回调隔离。修改的 VS Code 源文件 ESLint 0 errors / 0 warnings，Prettier 与 `git diff --check` 通过。仍未执行真实 VS Code/JetBrains GUI 或精确提交 Actions。

### IDE-DRAFT VS Code 原生结构化表单与确认状态

补齐 App Server `_questionRequest` 丢失 MCP metadata 的调用链：通知与 question/answer RPC 均保留 form/URL、server、schema 与 elicitation ID，普通问题保持既有形态。原生界面使用字段列表、InputBox/QuickPick 编辑与显式 Submit；复用共享 schema core 的文本、数值、布尔和单/多选校验及类型转换，支持 Back 和 250 ms 编辑合并保存。password/writeOnly 不进入保存投影或列表值预览；未知 schema 仅明确的 JSON object fallback，不落盘。

新增 native request lifecycle，按原 client connection generation、thread、turn、question ID/digest 保留至多 256 个身份。相同 live request 共用一次 review，已结束请求不复活；退出、连接替换、interrupt、到期与 blocking turn 结束使旧 UI 失效，deferred 可跨 turn。SDK 仍向原 child 回复，host 另检查原 client/generation，迟到字段或原生回调不能给新进程回答。URL 使用不可变目标及 HTTPS 显式确认，await 前后检查撤销。没有 workspace store 时也能立即关闭失效原生输入。完整原生 review 串行占用 QuickInput，最多 128 个等待项；并发问题不互相隐藏当前字段，排队期间也可撤销。

原生 callback 返回仅进入 awaiting；匹配服务端 question/resolved 后才显示 resolved，状态栏显示变化，原有 App Server status 命令展示 review/awaiting/unknown 数量。复用 ID 改内容的回执不伪造确定结束；连接故障/超时保留 unknown，不重试。状态为 host 内存观察，不是 durable 接受回执，也不证明外部副作用 exactly-once。最终保存期间撤销会等待同一次写入；旧 MCP digest 未区分 form/URL 时仅保留文字恢复，不自动套入新身份。

扩展 `npm run test:unit` 213 项通过，新增原生测试已纳入此命令。最后补充无 workspace 撤销及原生 review 队列后，原生/生命周期/pilot 4 文件 25 项再次通过。CLI App Server 16 项、共享 schema 与 Chat 问题草稿 2 文件 17 项通过；覆盖真实临时磁盘、崩溃前文件恢复、半输入、数值校验、敏感值排除、保存失败、重复提交、读/写期间撤销、URL 等待期间替换与元数据协议往返。修改源文件 ESLint 0 errors/warnings；已构建本地 VSIX。这些仍是本地 API stub / 协议与打包验证，未执行真实 VS Code GUI、最新双宿主旅程或精确提交 Actions。App Server 继续 opt-in pilot。

### IDE-DRAFT JetBrains composer、附件与接受回执

在 IDE config 目录按 workspace hash / 稳定 draft key 保存本地文本和图片快照，项目属性只保存本功能的 tab 元数据。编辑合并后保存；发送先排队保存当前 composer，再做 CLI 探测和启动，随后保存独立 submission 并在写 stdin 前记为 unknown。缺失/旧 CLI capability 不伪造接受；只有原 child/session 的匹配 ID 与合法 hash 回执可标 accepted。CLI 解析可能从正文发现图片路径，host 不把未解析的本地 wire digest 强充 CLI inputDigest。

Saved inputs 提供只读核对与恢复到空 composer；Recover drafts 可找回关闭 tab，恢复不启动 Agent。稳定 key 贯穿重启、关闭重开与手动恢复。迟到恢复不覆盖新输入，关闭冲突 tab 时新输入另存；缺失/篡改图片阻止发送，但文字修改仍可保存，显式 Clear attachments 后才放弃原附件。接受回执早于执行完成，图片保留到无待处理 turn 的后续发送或用户安全丢弃记录。

上限为每条 100K 字符、4 张/20 MiB/40MP、每草稿 8 条 submission、128 个草稿目录、100 MiB 存储、2 MiB 元数据；独立 I/O 队列最多 64 个操作。同 IDE 进程内串行，原子临时文件 flush + rename；失败保留旧记录并清理未引用图片。普通文本为本地明文；未证明断电持久性、强制退出最后一次编辑无损或多个独立 IDE 并发写同一 config 目录的协调。问题/elicitation 表单草稿后续增量见下文；不保存或重放审批。实现说明见 [JetBrains Chat draft recovery](../../packages/jetbrains-plugin/docs/CHAT_DRAFT_RECOVERY.md)。

本批全量 `test smokeTest`：96 个 suite、846 项，843 通过、3 项既有平台跳过、0 failures/errors，另 1,436 项 smoke 断言通过。补充“附件缺失时保存文字”和“恢复冲突关闭时另存新输入”后，新增 2 文件 9 项再次通过。覆盖真实临时磁盘、原子替换失败、快照/校验/预算与 Swing 组件恢复竞态；不是实际 IntelliJ GUI 旅程。`buildPlugin` 已成功生成本地 ZIP，搜索选项构建为 headless；未进行 Marketplace 发布、真实 IDE 手工交互或最终提交 Actions。

### IDE-DRAFT JetBrains 问题表单与请求归属

普通问题与受支持 MCP schema 现为聊天面板内的原生表单；保留声明顺序、文本/checkbox/select、数值校验和 coerced answer。多个 deferred 问题使用有界滚动区域，composer 保持可达。字段草稿绑定 session/request/完整 interaction binding 及问题/schema 摘要；跨 host 恢复仅对 CLI 重新发出的相同完整绑定请求恢复字段，无 binding 仅原 live 实例保留；迟到加载不覆盖新输入。密码/writeOnly 不读入持久化投影或恢复文字，未知 schema JSON fallback 不保存。

回答/取消先预约并保存归档字段，I/O 成功后才允许 send worker 向原 child/generation 写一次；普通表单不再通过模态弹窗结束时重新选择当前 child。仅原 child/session 的 question_resolved 确认结束；管道失败/reject 保留 unknown，不自动重试。持久化失败且未发送可显式重试；复用 ID 改 schema 的回执不能伪造确定结束。URL 显式 HTTPS 确认后再次检查原请求归属。blocking turn 结束、Stop、替换、退出/关闭归档，deferred 可跨 turn。归档不恢复执行权，Saved inputs 可复制到空 composer 或显式丢弃；归档保存失败时表单保持可读和可复制，保存成功后才自动移除。关闭仍未保存的 tab/强制退出不保证数据无损。

每草稿最多 16 条问题记录、128 字段、单字段 32K 字符、字段 64 KiB、记录 128 KiB；每个 child 保留至多 256 个请求身份，已结束请求重发不能复活。schema snapshot/hash 限深度、节点与字节；沿用独立 I/O 队列及原子替换。元数据写 v2、读 v1/v2，旧宿主拒绝 v2，避免丢失新字段。常规自由文本仍为本地明文，不宣称自动识别所有秘密、跨进程写协调或断电无损。

本批全量 JDK 21 test/smokeTest/buildPlugin：100 个 suite、872 项，869 通过、3 项既有平台跳过，0 failures/errors；1,436 项 smoke 断言通过，并生成本地插件 ZIP。最后补充请求 session 隔离后，4 个新增文件 27 项回归和打包再次验证。覆盖真实临时文件、v1 迁移、保存失败/重试、迟到恢复、重复点击、跨 child 拒绝、secret 排除、原生 Swing 字段校验及归档保存失败。没有运行真实 IntelliJ GUI、跨平台宿主旅程、Marketplace 发布或最终提交 Actions；IDE-DRAFT 仍为局部验收。

### IDE-MODE JetBrains 状态与进程替换

新增纯 Java `PermissionModeState`，按 child generation、session、request correlation、requested mode 与 policy digest 接受 CLI ACK；旧 CLI、缺失/无效 ACK 和 15 秒超时显示 unconfirmed。切换立即使旧 ACK 与排队的旧模式输入失效，停止失败保留 last confirmed 模式与原进程句柄；状态栏与聊天面板不将请求值显示成已生效值。组织策略覆盖的有效模式可以不同于请求值。

`AgentChatSession.stopAndWait()` 使用独立线程，TERM 后升级 FORCE，等待根进程与已观测子孙退出；不等待 stdin 写锁，因此管道阻塞不再挡住停止。并发停止共用 future，失败保留句柄供重试，超过 1,024 观测句柄或进程枚举失败不能报告成功。ConversationView 在后台等待确认，再处理替换、配置重载、时间线恢复和会话交接；回答/审批绑定原 session/generation。启动前后检查取消，二进制解析或环境准备期间的停止不会在返回后重新启动 Agent。

这里确认的是**已观测句柄**退出：在首次观测之前已脱离/被重挂的子孙仍可能遗漏，未实现 Windows Job Object / Linux cgroup 隔离，不将自然根进程退出等同于完整树退出。真实组织策略、真实 JetBrains GUI、Linux/macOS 探针及最终提交 Actions 均未验收。输入在切换期间写出时通过 composer 或 Saved inputs 保留并提示交付未知；JetBrains 的 composer 与输入回执增量见上文。

共享协议补充可选 `permission_mode_state` schema/类型与正反 fixture，已重新生成 TypeScript/Python/Kotlin/Swift/CLI 产物并同步 VS Code/Desktop SDK vendor。CLI headless/mode/stop 回归 3 文件 85 项、SDK 协议回归 2 文件 24 项、协议 Node 回归 3 项通过；SDK build、schema/vendor drift check 通过。未执行 Swift 编译。详细设计与限制见 [JetBrains approval mode lifecycle](../../packages/jetbrains-plugin/docs/APPROVAL_MODE_LIFECYCLE.md)。

最终 JetBrains JDK 21 `test smokeTest`：94 个 JUnit suite、837 项，834 通过、3 跳过、0 失败/错误；PureLogicSmokeMain 1,436 项断言通过。新增模式/终止测试 11 项全部通过，包括真实 Java 根进程/子孙、8 MiB 阻塞写入、环境准备期间取消与模式切换。跳过项为 Windows 无可用符号链接时的路径用例及 2 项仅限 POSIX 的 lockfile ACL 用例；不将跳过计入通过。生成 Kotlin 的既有冗余 `?` 警告不影响编译。

### IDE-IMAGE CLI 最终读取边界

普通 `--image`、REPL 自动识别与 stream-json 共用最终文件读取限制：单条消息合计最多 20 MiB，文件必须为 regular file，扩展名匹配 PNG/JPEG/GIF/WebP header，单图尺寸最多 40MP。先检查句柄上的文件大小，再在最多 1 MiB 内读取尺寸；后续完整读取最多分配原始大小加 1 字节，读取期间文件增长、截短或观察到修改会拒绝。错误指出附件序号；超过 8 张明确报错，不再静默截断。真实临时文件及模拟短读/增长测试覆盖这些条件，另验证无效图片不会进入模型循环且后续文本仍可处理。

图片边界连同 stream 输入回执的扩展回归：5 文件 123 项通过；CLI 修改源文件 ESLint 0 errors、3 项既有 warnings；SDK 构建与 protocol schema drift check 通过。

### PERF-01 后台列表真实分页对照

容量 harness 保留原全扫基线，新增固定 50 条页大小的实际分页对照。首次建索引与已有索引分别运行新 Node 进程；热首页/下一页/权威记录原子替换后的重建分别计时。每阶段比较完整投影摘要，计时外遍历所有页防止遗漏/重复/乱序，失效测试同时改变排序与正文并最终恢复夹具。`indexObserver` 只提供读取路径与数量，回调抛错不改变结果；新进程失败或回退全扫不能标记 pathsVerified。

保留 O(N) inventory/stat/sort 边界，RSS 新增进程高水位且明确包含此前分配，分页锁等待标为不适用而非 0。smoke / formal 仍为测量，不宣称 SLO 或生产 PASS。说明见 [容量对照记录](./cli/cli-persistent-capacity-comparison-2026-09-27.md)。

相关回归 3 文件：130 通过、22 项既有平台条件跳过；最后的测量计时与夹具目录校验修改后，容量/index 2 文件 8 项再次通过。包含真实磁盘/Node 子进程、105 条三页遍历、失效重建/恢复、冷进程失败和观测回调异常。修改源文件 ESLint 0 errors / 0 warnings（Node 提示现有根 package.json 未声明 ESM），`git diff --check` 通过。

干净 SHA `6c47788623d6bc4ab64afa096d8ce739ebbacf0a` 默认 smoke 23.279 秒完成；Windows 10.0.19045 / x64 / Node 22.22.2。后台 100/1k 均 pathsVerified，1k 全扫/热首页/失效重建 p95 分别 336.129 / 164.045 / 694.739 ms（3 样本）。Memory 两档可读，并发读/更新/删除全部成功；[原始 receipt](./cli/evidence/persistent-capacity-smoke-windows-6c47788623.json) 的 canonical digest 已核对。保留单机少样本与重建成本边界，未设定性能 PASS。

## Windows 并发初始化与真实存储宿主夹具

新增宿主夹具的可选 canonical 模式：模型回复仍为确定性测试内容，输入接受回执、去重、最终事件引用和历史查询使用生产存储与真实 CLI 子进程；数据根为工作区外的临时目录，home/security 为同级隔离目录。相同正文与输入 ID 的双会话并发测试暴露了 Windows ACL 初始化竞态。

修复包括：会话目录在首次使用前完成显式权限校验；单项与批量 PowerShell ACL 修复使用同一路径互斥并在锁内重新检查，已有合规 ACL 不再重写；进程内权限缓存核对 dev/ino/birthtime，避免同路径替换目录命中旧缓存。保留物理 witness 的 ctime 检查以及 owner/reparse 拒绝边界。重复修复真实目录/文件不改变子文件身份和时间戳，替换目录会重新校验。

Windows 本地验证：存储、安全及 canonical peer 3 文件 208 项通过、2 项既有平台条件跳过；补充安全、生成 Webview、Workbench 与 JetBrains 宿主夹具 4 文件 74 项通过。两轮有重叠，不相加为独立覆盖率。CLI CI / Strict Sandbox 的精确 SHA 三系统门禁尚未运行，这些结果不构成发布批准。

VS Code 新增 `CC_UI_CONVERSATION_RECOVERY=1` 真实宿主旅程：复用原 user-data profile 进行进程重启，停用旧的合成 deep-link resume；通过现有令牌保护的 DOM 控件编辑草稿、创建/切换会话并读取行 ID。验收步骤覆盖后台完成时间边界、相同正文的独立保存行、A/B 未发送中文草稿、重启后行 ID 与草稿恢复及协议日志无重放。生成 Webview 测试核对输入事件和保存 ACK，宿主驱动 69 项本地测试通过；VSIX 已本地打包。此处仅记录旅程实现与本地回归，真实宿主运行结果另行记录；尚不覆盖 canonical rewind/compaction、附件、问题表单或人工无障碍验收。

首次真实 VS Code 1.132.0 运行（源码 `6ea65d987d`）通过多窗口/双工作区启动，但在 interrupt 阶段失败：协议记录显示 interrupt 先于异步保存中的下一条 user 输入抵达 CLI。失败 evidence digest 为 `sha256:bf757c755db626449d573247b41a5492e48a3d263f87f9a15828b8c83e8c6cbd`，未计为恢复验收通过。后续修复为 Stop / session stop 推进独立输入取消 revision，保存、init 等待和 UNKNOWN 落盘后均检查取消，未发送的已保存输入标记 rejected 并可恢复；图片准备取消后删除新建临时文件并恢复输入。普通中断旅程同时改为等待该轮开始，避免将“取消准备”误认成“中断已运行任务”。相关 4 文件 95 项通过，最后图片取消清理修改后 2 文件 31 项通过，宿主 relay 18 项通过；真实宿主须在新提交上重新验证。

第二次（源码 `e0d1ad3fd7`）通过初始双会话、重复正文、后台完成及草稿切换检查，但整个旅程仍失败，digest 为 `sha256:a0ed0a6fda121d27a7758134cb8c3eac7ed8e053503d91a1a7908ddf1756c169`。检查宿主 `main.js` 确认 `extensionTestsLocationURI` 会令 `getStorageOptions()` 返回 `useInMemoryStorage: true`；因此原 Extension Tests 启动方式即使复用 profile 也不能证明 Memento 重启恢复。canonical 模式改用不含 `--extensionTestsPath` 的普通隔离宿主，以已有令牌驱动命令运行旅程，并通过正常 Quit 保存状态。默认 smoke 模式保留原启动方式。启动器/relay 的 69 项本地回归通过；必须重新运行完整旅程后才能计入恢复验收。

第三次（源码 `f2f3bbd554`）实际磁盘 profile 的初始/重启恢复步骤均通过：A/B 保存行 ID 与中文草稿不变、协议无自动重发。整体仍为失败（digest `sha256:df5f9cdcaab2ee37f7c603d5be7f3d170a8226a6be19e0fda89b1094f9584fc7`）：旧 DOM 聚合断言在切回原会话后要求临时 permission/interrupted 提示仍留在最终画面；规范 final 回复会替换相应 assistant 正文，而 ready 状态会替代 interruption 状态。驱动改为在两条提示实际被观察到时保存各自 DOM 文件；聚合继续要求这些原标记、初始/重启其余标记和恢复证据全部存在。不回写旧运行状态，须用新提交再跑整轮。相关 69 项启动器/relay 测试通过。

### Windows VS Code 实际安装与重启恢复通过

干净源码 `5382a8c3be6f5525c1332c1b2a0e24553dfb5b4e` 的第四次运行于 2026-09-27 16:53:41～16:58:49（北京时间）完成，VS Code `1.132.0` / Windows x64 / 本地 VSIX `0.37.118`。通过双工作区/双窗口启动、stream/retry/plan/permission/interrupt、100 次 Workbench 采样、A 后台完成、A 同正文两轮独立保存行、A/B 草稿切换、同磁盘 profile 的真实进程重启、原保存行 ID/中文 emoji 草稿恢复及协议无自动重发。P95 `1125 ms` 是本地夹具 Workbench 可见性，不能外推至真实模型或网络。

证据摘要 `sha256:3a4743eecdcc83c2485d2777993e7e0f068954e3caf6f17880be8055d7f31e83`；独立重跑所有产物断言并核对 31 个证据文件的字节数/SHA-256、bundle digest、源码 HEAD 和干净工作树，通过后保存[本地回执](./ide/evidence/vscode-canonical-recovery-windows-5382a8c3be.json)。VSIX SHA-256 为 `FC725F46070D130D4CE5DA106E842D5FF4B5B9BFB580F718FB3803AB6EB3E1E4`。完整本地 bundle 在 `.tmp/vscode-canonical-recovery-5382a8c3be`。PowerShell 的 stderr 重定向令外层工具报 exit 1；已用正常退出的独立 Node 文件复现，并验证显式传递 LASTEXITCODE 为 0。宿主 runner 的完整 passed manifest 与所有断言/哈希另行验证通过；该细节保留于回执，不将外层工具状态隐去。

范围仍有限：canonical 会话存储、回执和 history 子进程为生产实现，模型/Workbench/checkpoint 响应为夹具。尚未通过 JetBrains 对应旅程、其他系统、canonical rewind/compaction、附件/问题表单真实宿主、真人听测或长时观察。CLI CI / Strict Sandbox 精确发布 SHA 矩阵仍待运行；未推送、打 tag 或公开发布。

### JetBrains Stop 取消发送准备与管道顺序

复核发现 Stop 原先只向已存在的 child 发送 interrupt，无法取消等待 composer 保存、启动或 init 能力确认的输入。新增每次发送独立的原子状态：Stop 在写入预约前取消该输入；`AgentChatSession` 在同一 stdin monitor 内取得预约后才写入，预约后的 interrupt 因此排在该输入之后。EDT 取消不获取管道锁，保留第二次 Stop 的独立强制停止路径。能力等待可被取消，但不破坏该会话共享的 init future；文件保存完成后再检查取消，不中断持久化写入。

从未取得写入预约的 saved submission 记为 `rejected`，保留文本和附件，composer 恢复可编辑；清除仅属于原 child/client ID、没有回执或保存身份的临时用户行。开始写入后失败仍保持 `unknown`，不误报为未发送；已有 canonical acceptance 不会被本地取消降级。Stop 按钮与 `/stop` 共用此路径，模式切换及关闭也取消尚未发送的准备。

本地 Gradle 编译及 8 类共 **56 项测试通过，0 skipped/failures/errors**，包含真实 Java 子进程、受控管道阻塞、EDT 响应、预约前后 Stop 顺序、拒绝重复写入、共享 init 后续复用、持久化重新读取、草稿恢复、历史行身份隔离、模式状态与进程终止回归。未把这批结果记作真实 JetBrains GUI、其他系统或发布 CI 验收；JetBrains 恢复旅程仍待执行。

### JetBrains 实际宿主恢复旅程准备

`CC_UI_CONVERSATION_RECOVERY=1 node packages/jetbrains-plugin/scripts/run-ui-host-journey.mjs --ide-version 2024.2 --artifact-dir <新证据目录>` 启用独立的 `jetbrains-canonical-conversation-recovery` 旅程。沿用 Remote Robot 和原生 Swing 按钮、输入框、标签页；只读反射采集实际渲染行对应的保存身份，驱动不调用插件内部发送/恢复方法或写草稿存储。CLI `home` / `security` 位于仓库外新建的临时目录。

检查 A 在 B 激活期间完成、A 两次相同正文保留四条独立保存行、A/B 中文 emoji 草稿隔离，以及使用相同磁盘 profile、不同 IDE PID 重启后的身份和草稿保留；协议台账必须恰有 A 两次和 B 一次输入，并有实际 CLI history 查询。该独立旅程不替代原有 chat/control/Workbench/rewind 旅程，也不声称夹具 checkpoint 是真实 canonical rewind。

UI 驱动编译通过；证据验证器与启动器 23 项 Node 测试、既有宿主夹具 11 项 Vitest 测试通过；修改的 JS 文件 ESLint 无错误。真实 GUI 执行结果尚未取得，不能将准备完成计作宿主验收通过。

首次 Windows IntelliJ 2024.2 实际宿主运行（源码 `bf5829ba7f`）失败于驱动读取第一个快照：`String.valueOf(frame.callJs(...))` 的 Java 泛型推断选中 `char[]` 重载，对实际 String 返回值强转失败。改为先接收 Object 再转换，UI 驱动重新编译通过。失败证据保留在 `.tmp/jetbrains-canonical-recovery-bf5829ba7f`，digest `sha256:a6e81d3ca9a256d5197d5a645f1d213baef5831d42d4bbfa1531153631f5badc`；该次未取得恢复验收结果，须用新提交重跑。

第二次（源码 `1b9a0190d1`）初始及真实进程重启的 GUI 断言均通过，保存行身份和双草稿保留，但整体证据验证失败：Windows `JTextPane.getText()` 经 EditorKit 输出 CRLF，而每条保存行从 `Document.getText()` 读取为 LF，严格的“行正文属于渲染文档”比较因此不匹配。驱动统一从同一 Document API 读取全文和行，保留严格归属断言。旧失败 bundle `.tmp/jetbrains-canonical-recovery-1b9a0190d1`（digest `sha256:96d287db4ba4fd126f20d0cfc3cc307c5dfc61e6e07cd7a5377dcf12205659f4`）不回写为成功。

第三次（干净源码 `edc2d89cc6`）完整旅程及证据汇总通过，工具退出码 0。独立复核 24 个产物哈希、bundle/evidence digest、全部恢复断言及六条渲染行与 canonical 提交引用的对应关系，通过后保存[本地回执](./ide/evidence/jetbrains-canonical-recovery-windows-edc2d89cc6.json)。证据 digest 为 `sha256:dd3747653fbdb75161ddf0aa1b6d20544de58ed9c356d490f6c73fd783b2a29f`。

安装核对同时发现：Gradle testing extension 的 GUI 沙箱将 JUnit/Kotlin test runtime 放入本插件目录，且未包含 ZIP 的 searchable-options JAR。生产插件 JAR 与 ZIP 字节相同，但该次不是干净 ZIP 安装验收，回执明确保留这一限制。新增 `installUiJourneyPlugin`：在宿主启动前将本插件目录同步为实际构建 ZIP 的内容，保留独立的 Robot 插件；同步前检查规范路径限定在工作区 `build/idea-sandbox` 内。恢复驱动初始/重启两阶段均读取实际已加载插件路径，逐文件比较 ZIP 的完整清单和 SHA-256，禁止额外测试依赖，记录安装证据。

新增安装任务及 UI 编译通过，实际沙箱本插件目录仅有 ZIP 中两个 JAR；25 项 Node 证据/启动器测试、11 项既有夹具回归通过，JS ESLint 无错误。干净 ZIP 的实际 GUI 重跑待完成，第三次有限通过结果不扩大为这一新增门禁通过。

第四次（源码 `fdbdd382b0`）两次宿主安装均通过实际 ZIP 清单/字节检查，初始恢复旅程通过；重启时 A 历史加载失败，草稿仍保留，整体结果失败（`.tmp/jetbrains-canonical-recovery-fdbdd382b0`，digest `sha256:6ceb244fb203930c192edc0ea238452df14cb3f96d286ab6ce0e4a56171e4706`）。在与 GUI 相同用户环境中直接运行实际 CLI，原 A/B 历史分别读出四条/两条，未发现存储数据丢失；该次诊断没有将宿主失败改写为成功。

后续为每轮指定独立的 IDE profile 和项目目录（同一轮初始/重启共用），避免累积旧轮次标签页；宿主快照新增完整 history 状态及已选 CLI 名称。夹具的 `--version` 移到 canonical 存储初始化前，版本探测不再触发 ACL/存储；四个生产 CLI 候选名均提供隔离的夹具入口，避免 fallback 到全局安装。版本无存储副作用和真实候选入口回归通过；相关 CLI 两文件 15 项、Node 25 项通过，隔离目录下 UI 编译和 ZIP 安装任务通过。这些是隔离和诊断改进，尚不能据此断言第四次失败的唯一根因。

第五次（源码 `b5ec362733`）在构建阶段被隔离目录名校验拒绝：启动器直接使用含 `2024.2` 点号的日志目录名，而 Gradle 只允许字母、数字和连字符。启动器改为将点号转换成连字符，保持路径检查不放宽；尚未启动 GUI 的失败证据保留（digest `sha256:967562311e8e6d901a6601d13ec6e9e02dcc2168aaf3c41b445674cd8323fbf7`）。

### Windows IntelliJ 实际 ZIP 与隔离 profile 重启恢复通过

第六次运行使用干净源码 `510b443ac36099035c7d95aa5ec8c65e5dd560c8`，于 2026-09-27 20:05:02～20:08:25（北京时间）完成，Windows x64 / IntelliJ `2024.2` / 本地插件 ZIP `0.4.139`，工具退出码 0。初始与重启阶段均逐文件核对实际加载的插件目录与 ZIP：只有打包的生产 JAR 和 searchable-options JAR，路径/内容完全一致，没有额外测试运行库。每轮使用独立项目/profile，同一轮重启使用同一磁盘 profile 并验证 IDE PID 已改变。

完整通过 A 在 B 激活时完成、相同正文两轮保留独立身份、中间工具文本保留、A/B 中文 emoji 草稿隔离、重启后的六条保存行身份与双草稿恢复，以及协议恰有 A 两次/B 一次输入、没有自动重发。独立重跑全部证据断言，核对 **31 个产物的字节数和 SHA-256**、bundle/evidence digest、渲染行与真实 canonical 提交引用、完整 ZIP 安装清单及源码干净状态，通过后保存[本地回执](./ide/evidence/jetbrains-canonical-recovery-windows-510b443ac3.json)。证据 digest 为 `sha256:4925c866ffb777ca1536ab2bf073cc3cfc6db1eacef1db5957c83f4900031987`；ZIP SHA-256 为 `111483296646e9f9f084fba46664c9f5e7396478a53536fe3ff2eef724002c0a`。

这是独立恢复旅程，未替代既有 chat/control/Workbench/rewind 流程；模型回复仍为夹具。第四次旧复用 profile 的历史加载失败唯一根因尚未确认，保留旧配置/多标签恢复复核项；新隔离运行通过不抹去该失败。其他 IntelliJ 版本/操作系统、Stop GUI 专项、附件/问题表单、真实模型、人工听测、长时观察及发布准确 SHA 的完整 CI 仍待完成。尚未推送、打 tag 或公开发布。

### 旧七标签 profile 副本读取复核

干净源码 `9e44569972` 下，将第四次失败的项目配置和 profile 复制到独立目录，按新项目路径重映射草稿命名空间，保留七个标签的原会话/草稿身份、原 canonical 存储及原正文。只运行恢复读取阶段，未发送输入或调用模型。Windows / IntelliJ 2024.2 实际 ZIP 清单校验、A/B 六条原保存行及双草稿恢复通过，诊断进程正常退出。

独立复核原始基线的标签/行身份、草稿、协议无输入、ZIP 哈希与安装清单后，保存[诊断回执](./ide/evidence/jetbrains-old-profile-diagnostic-windows-9e44569972.json)，digest `sha256:320f8fc3954921d9e32c61b2cec3641ad0a0e9f79d465d579eefc5dda0f5e7aa`。这是配置副本的读取诊断，不是新的完整双阶段旅程；仅预期 profile 路径作了显式重映射，原失败记录仍为失败。

当前无存储副作用的版本探测和四 CLI 别名隔离下可读取旧配置，但尚未证明原故障的唯一根因。观察到 29 次版本探测和 9 次历史查询，后台标签查询排在 A/B 前；快照时六行已可见，后续增量刷新状态仍为 Loading。版本发现并发去重、恢复读取调度与稳定就绪延迟仍有优化空间，不据本诊断宣称启动性能验收。

### IDE 发布前确认配套 CLI 已公开可安装

根据用户要求的“子 npm 包 → CLI → IDE”顺序，保留现有 npm 子包先发、字节回读和候选 CLI 全新安装门禁，在 IDE 工作流的实际上传步骤前补充共享 composite action。从 npm 公共 registry 安装配套 CLI 精确版本，复用子包验证器检查实际依赖和锁记录，再检查 CLI 自身 registry 锁、依赖集合及真实版本/能力输出；失败阻止 Open VSX、Microsoft 补发和 JetBrains 上传。普通分支构建不要求提前发布 CLI。

本地 20 项 Node 校验/发布契约测试、actionlint 与 ESLint 通过；Windows 从 npm 新安装已发布 `chainlesschain@0.166.77` 后，10 个内部子包及 CLI 版本/能力探测通过，保存[公开安装探测回执](./cli/evidence/ide-cli-prerequisite-smoke-windows-2026-09-27.json)。这仅验证前置检查实现和旧已发布版本的可用性；未验证本批源码的准确 SHA 发布门、完整安装生命周期或真实模型，也没有修改版本号、推送或发布。

### JetBrains 恢复时按选中标签读取

根据旧配置诊断观察，ConversationView 不再在每个后台标签构造时立即发起 CLI 版本/配置及历史读取；首次选中时启动提示探测，历史仍在选中及实际后台 turn 完成时更新。恢复首个标签显式触发读取，避免首次选中事件被批量建标签过程屏蔽；本地草稿和计划状态仍按原流程恢复。此改动减少未访问旧标签对两个历史读取 worker 的占用，没有引入全局缓存失败或改变运行中会话的后台处理。

27 项相关 Java 回归（3 类，0 跳过/失败/错误）、插件 ZIP 构建及 UI 驱动编译通过。GUI 历史断言进一步要求状态为 Saved messages，不再仅凭保存行已出现即通过；旧七标签副本和完整双阶段旅程待在本次源码提交后重新验证。

源码 `30c1a0e183` 后续两项实际宿主验证均通过。旧七标签副本保留原六条保存行和双草稿，版本探测从前次 29 次降至 6 次，历史查询从 9 次降至 3 次；A/B 状态分别为 `Saved messages 1–4 of 4` / `1–2 of 2`，协议无用户输入。[旧配置诊断回执](./ide/evidence/jetbrains-old-profile-diagnostic-windows-30c1a0e183.json)保留副本路径重映射与单次观察的边界，不能据次数下降宣称延迟 SLO 或原故障唯一根因已经查明。

同一干净源码的完整 initial/restart 恢复旅程也通过，模型仍为夹具；实际 ZIP 安装、后台完成、重复正文独立身份、双草稿及真实进程重启恢复均通过，四份 A/B 快照全部显示历史已加载完成。独立核对 31 个产物的长度和 SHA-256、bundle/evidence digest、行身份与真实提交引用及完整 ZIP 清单后保存[完整恢复回执](./ide/evidence/jetbrains-canonical-recovery-windows-30c1a0e183.json)。证据 digest `sha256:8005d099a4aabf8bff1e5125b18324382d1b3d6be15ce76787d5b90b80a42244`，ZIP `sha256:5a89b430908371d980a2cf8e5dd62ab845fb7b57a82ad047e79d94448305541d`。范围仍为 Windows x64 / IntelliJ 2024.2；未替代其他宿主/交互场景、真实模型和最终 SHA Actions。

### JetBrains Stop 初始化等待的真实宿主验收准备

canonical 恢复驱动新增独立 C 标签场景：fixture 按 session/nonce 在 init 前等待显式放行，驱动通过原生 Send/Stop 控件取消准备中的输入，先确认 composer 可编辑、草稿已保存及尚未收到 init，再放行并确认共享 capability future 正常完成。随后运行原 A/B 后台完成与重复正文旅程；重启恢复 C 的未发送草稿，要求真实 CLI 历史为空、不启动 Agent，并从完整协议记录检查没有自动重发。

新证据使用 recovery v2，验证 gate 原始 trace、观察顺序、原 session/标签身份、初始/重启进程以及保存行与加载状态。v1 旧证据仍可按原范围读取，不新增 Stop 通过声明。fixture gate 仅在隔离 GUI 子进程环境启用，不修改生产 CLI 初始化逻辑。

39 项 Node 证据/启动器测试、16 项 CLI 真实 peer/宿主夹具测试及 UI 驱动编译通过；修改 JS 的 ESLint 与 diff check 通过。实际 ZIP 的新 GUI 场景待源码提交后运行，尚不将新增测试代码计为宿主验收完成。

首次 v2 宿主运行（`09c61578d7`）失败：取消提示、可编辑 composer 和 `Draft saved` 已出现，但驱动用 JavaScript `Boolean(...)` 转换反射返回的 Java boxed Boolean，将 false 对象判为 true，导致 `sendInFlight` 一直显示 true。等待至夹具 init gate 超时后失败，不能据此报告 Stop 旅程通过。驱动改为按 Java 布尔值的字符串表示显式比较；原失败 bundle `.tmp/jetbrains-canonical-recovery-09c61578d7`（digest `sha256:923ee464d21e3075afab2c893dac2c2fdb238995339a80fb2aeb365c64831f05`）保留，修正后需要重新运行。

修正后的干净源码 `989a46cd6e` 完整 v2 旅程通过。真实控件确认 send 准备中且无 init → 点击 Stop → composer 可编辑、取消提示及草稿保存 → 显式放行 init → 共享 capability 正常完成；随后原 A/B 旅程和真实进程重启全部通过。重启后 C 草稿仍在，实际 CLI 返回空历史，未启动 C Agent，完整协议无 C 用户输入；模型输出仍为夹具。

独立重跑全部 v2 验证器，核对 **34 个产物的长度/SHA-256**、完整 ZIP 安装清单、bundle/evidence digest、六条 A/B 渲染行与真实 canonical 提交引用，保存[恢复与 Stop 回执](./ide/evidence/jetbrains-canonical-recovery-windows-989a46cd6e.json)。证据 digest `sha256:66c4ed0f29ef58ff288b76e0ce328706230a6836e0fcd529807e5665f95b5d33`；插件 ZIP 与前一生产实现相同（`sha256:5a89b430908371d980a2cf8e5dd62ab845fb7b57a82ad047e79d94448305541d`）。范围仅为 Windows x64 / IntelliJ 2024.2 的 init 等待取消；未覆盖磁盘保存/附件准备/阻塞 stdin 的全部 GUI 分支、再次发送后的 Stop、真实 provider 或其他系统。

### JetBrains canonical 恢复接入发布宿主矩阵

`IDE Extensions` 的 Windows/Linux/macOS × IntelliJ 2024.2/2025.2 六个宿主单元，保留原 chat/control/Workbench/rewind 旅程，额外执行 canonical recovery v2（包括 init 等待中的 Stop）。新增锁文件约束的 CLI workspace 依赖安装，以运行实际 CLI 历史子进程；每个旅程独立 profile/项目及证据目录，使用同一准确源码 SHA，任一旅程失败即阻止该宿主 job 通过。

更新后的发布/前置检查契约共 21 项 Node 测试通过，actionlint 通过。此处记录 CI 配置已接入，尚未取得六单元的远端通过结果；本地 Windows 2024.2 回执不扩大为整套矩阵通过。

## 本地验证与提交记录

- 第一轮跨模块回归：45 文件、822 项通过，覆盖模型/费用/ledger/恢复、编排、外部 adapter/bridge、MCP、Chat/replay/streaming。
- 后续权限模式相关回归：5 文件、137 项通过；退出确认另 4 项通过；附件与 Chat 回归 5 文件、110 项通过，附件边界另 6 项通过。这些运行有重叠，不相加作为独立覆盖率。
- 修改的 CLI / VS Code 源文件 ESLint：0 errors；6 项既有 unused-variable warnings。
- 已重新生成命令 manifest、help index、四种 shell completion 和 CLI reference，三个 drift check 全部通过。
- 扩展回归 64 文件：1011 项通过，1 项旧模式测试未等待退出确认而失败；更新该 fixture 后，相关 3 文件 56 项全部通过。模型/计费/bridge/MCP 的最新补充回归 6 文件 111 项通过。
- JetBrains 初次 Gradle 被缺少完整 JDK 21 阻断；下载官方 Temurin JDK 21.0.12.1+1 并核对 SHA-256 后，`compileKotlin`、`compileJava`、`compileTestJava` 与 `ImageAttachmentsTest` 的 8 项测试通过（0 skipped / failures / errors）。未跑真实 GUI。
- 以下为本地提交，没有推送或发布；后续未完成工作继续沿用上表任务 ID。

| 提交         | 已提交范围                                                                                                            |
| ------------ | --------------------------------------------------------------------------------------------------------------------- |
| `3571acda0e` | 最新模型 profile、Responses 三型号回归、统一价格与 durable ledger / budget / Eval 计费                                |
| `42010e7148` | 外部 Agent 生命周期与 Codex 事件关联、MCP 404 安全重建、编排准入状态及生成文档                                        |
| `025dddcd46` | 有界 canonical context 分页、VS Code 后台正文恢复与流式渲染、CLI mode ACK/退出确认、异步图片与会话内输入隔离          |
| `8e9c6f9d4d` | JetBrains 图片 header/字节/像素限制、异步处理、错误显示与 JUnit                                                       |
| `2d5084605c` | CLI canonical 输入接受回执、只读查询与 ID 去重，SDK 可选传参、共享协议 fixture 及 vendor 同步                         |
| `6b5da7f538` | CLI 普通图片入口的 header/字节/像素校验、固定句柄有界读取及超量明确拒绝                                               |
| `4889036941` | VS Code composer/附件持久化、发送前保存、输入接受回执核对、关闭草稿恢复                                               |
| `03957c15d4` | VS Code 问题表单与原生文本/选项草稿恢复、请求绑定隔离及回答交付预约                                                   |
| `d45175eeac` | JetBrains 权限 ACK、独立进程退出确认、启动取消与过期输入隔离；共享协议类型与生成产物同步                              |
| `6c47788623` | 实际后台列表全扫/索引分页/失效重建容量对照、完整内容遍历与路径观测回归                                                |
| `f6f7840502` | 干净 Windows SHA 的实际分页容量对照 receipt；保留少样本与未冻结 SLO 边界                                              |
| `38fc29e634` | JetBrains composer/附件草稿、稳定 tab 身份、输入接受回执核对与安全恢复                                                |
| `e5dc0aa6ed` | JetBrains 问题表单草稿、原 child/generation 响应隔离、归档恢复与敏感字段排除                                          |
| `f9fb1ec91b` | VS Code 原生结构化 schema review、字段草稿、QuickInput 队列、原连接请求生命周期与确认状态；CLI 传递 MCP metadata      |
| `6a3498820c` | v2 display history 保留规范压缩前正文、revision 游标、fork 隔离与替换边界；VS Code 历史分页及真实 store / Kernel 回归 |
| `0616351a36` | JetBrains v2 历史页、独立有界读取与取消、历史/现场切换、选择及滚动保留；共享 CLI fixture、真实子进程及 Swing 回归     |
| `e873b93667` | 新 timeline 回退前缀来源校验、跨规范压缩的有效祖先范围、同锁有界重扫与旧游标失效；真实 CLI / store 回归               |
| `c5cff5f5df` | 分支流式复制独立显示历史、上下文来源与创建摘要校验、失败重试和父会话删除后读取；完整文字分片及 v1/v2 页字节边界修复   |
| `f60236db18` | timeline 摘要来源证书、原始正文与游标保留、system 摘要依赖的回退检查及 branch-history v2；连续摘要/分支/压缩回归      |
| `875b15d560` | verified sync cursor 与连续增量历史读取、JSON 错误分类及真实存储/CLI 回归；双 IDE 仍使用快照读取                      |
| `70a51435da` | 最终结果关联已提交 user/assistant event，输入 ID 与共享协议类型、生成产物及 SDK 同步；160 项本地回归通过              |
| `44db0e64ab` | VS Code 连续增量历史合并、原 child 终态引用关联、重复正文独立身份、选区及原位显示保护；相关回归与本地 VSIX 验证       |
| `c6852748ba` | JetBrains 连续增量历史合并、输入行写入前预约、终态身份关联、选区/滚动与有界淘汰；共享真实 CLI fixture 与本地 ZIP 验证 |
| `71760f5da6` | Windows ACL 幂等互斥修复、身份缓存及会话目录初始化；真实 canonical 宿主 peer、双进程回执/历史与去重回归 |
| `6ea65d987d` | VS Code 实际宿主双会话、重复正文、草稿与重启恢复旅程实现 |
| `e0d1ad3fd7` | Stop 取消保存/init/UNKNOWN/图片准备中的未发送输入，保留恢复记录与清理新建图片 |
| `f2f3bbd554` | 恢复旅程使用实际磁盘 profile 的普通宿主，并正常 Quit 保存状态 |
| `5382a8c3be` | 单独保留瞬时控制 DOM 证据；此 SHA 的完整 Windows VS Code 恢复旅程通过 |
| `a6bc8a5b0f` | VS Code Windows 恢复旅程的独立哈希复核与本地回执 |
| `356d7fd794` | JetBrains Stop 取消准备、stdin 原子预约、未发送草稿恢复和临时行清理；56 项回归通过 |
| `bf5829ba7f` | JetBrains 独立 canonical 恢复旅程、原生控件驱动及证据验证器 |
| `1b9a0190d1` / `edc2d89cc6` | 修正 Robot 泛型返回类型和 Windows 文档换行；旧沙箱的有限完整旅程通过并保留其安装限制 |
| `fdbdd382b0` | GUI 宿主安装实际 ZIP，初始/重启逐文件校验，排除额外 test runtime |
| `b5ec362733` / `510b443ac3` | 独立项目/profile、无存储副作用的版本探测与四候选入口隔离；后者的实际 ZIP 完整恢复旅程通过 |
| `3532bfd45f` | IDE 上传前验证配套 CLI 和子包已从公共 npm 安装并可执行；发布前置检查及公开旧版本安装探测 |
| `30c1a0e183` | JetBrains 按选中标签发起恢复查询；27 项 Java 回归、旧七标签副本与完整实际 ZIP 重启旅程通过 |
| `09c61578d7` / `989a46cd6e` | 受控 init gate 与 v2 Stop/草稿恢复旅程；后者修正 Java Boolean 取值并完成实际 ZIP 验收 |

提交表示这部分实现及其本地回归已经保存，不表示同 ID 下的真实账号、跨平台、完整历史、宿主输入接受旅程或生产观察验收已完成。

### Windows Actions ACL 定位与追加实机回执

`3b0bc23021530d0624ca07e52515d5e8ac040cb7` 的 [Windows Local 作业](https://github.com/chainlesschain/chainlesschain/actions/runs/36326262392/job/108639499011) 报 `private-storage:1210`，对应 `ensurePrivateDirectory` 的 ACL 修复失败。固定目录树已经由源端批量创建并修复，目标进程仍会独立校验会话目录；本机 prepare 通过，尚未确认托管 Windows 原生失败原因。

追加 PowerShell 固定操作阶段和 HRESULT；上层仅接受白名单阶段及固定长度十六进制值，不返回目标路径、会话正文、原生异常消息。保持 owner-only、链接拒绝、失败拒绝、原超时与重试预算。相关 3 文件 116 项测试通过；真实 PowerShell 验证权限修复成功、重复检查不改变子文件 ctime、缺失路径仍拒绝且仅输出 `lookup:0x80131501`。这次提交是诊断补全，尚不标为 Windows CI 修复。

干净 `3b0bc23021` 的 Windows VS Code 1.85.2 实际 VSIX 普通控制旅程退出 0，独立复核 29 个产物、bundle/evidence digest、完整初始/重启与双窗口断言，保存[回执](./ide/evidence/vscode-control-minimum-windows-3b0bc23021.json)。覆盖 Stop 可见提示与 Workbench 100 样本，模型和输入回执仍为合成夹具，不扩展为 canonical 恢复或真实 provider 通过。

同一干净源码 Windows→已有 Ubuntu WSL1 的完整缩小流程退出 0；初始化、准备、断连探测、恢复、生命周期故障、结果返回和 finalize 均完成。独立复核 9 个产物及 2 条轨迹 outcome，保存[回执](./cli/evidence/execution-location-wsl-windows-3b0bc23021.json)。临时 home/security 为 `/tmp` 兄弟目录；仓库从 Windows 挂载，不能代替 CI 独立 rootfs 或 100 条轨迹门。旧 `8db732245f` Container 100 条轨迹远端通过；最终 SHA 的三系统发布门仍待齐备。
