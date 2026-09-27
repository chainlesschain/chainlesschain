# CLI / IDE 差距实施状态（2026-09-27）

对应 [CLI 审计](./cli/cli-claude-code-codex-gap-analysis-2026-09-27.md) 与 [IDE 审计](./ide/ide-claude-code-codex-gap-analysis-2026-09-27.md)。审计描述修改前快照；本表记录后续实现，避免重复开工或将局部测试当成全部验收。

实现分支：`feature/cli-ide-gap-closure-2026-09-27`。基线 SHA：`24911a536c9e9800c1e2e6b1d72e610841be4f5c`。按已验证范围分批提交，提交记录见下文；本地结果不代表 GitHub Actions 发布验收。

| ID                      | 当前状态         | 实现与有效证据                                                                                                                                                               | 剩余条件                                                                            |
| ----------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| MODEL-01                | 本地合同验证通过 | GPT-6 Astra/Sol/Luna、Opus 5.5 精确 profile；官方 endpoint 与自定义网关隔离；三个 GPT-6 型号的 Responses stream/tool/reasoning 回归                                          | 目标账号真实调用；未更改用户默认模型                                                |
| MODEL-02                | 本地合同验证通过 | tracker、预算、durable usage、恢复结算和 Eval 统一定价；逐请求长上下文/缓存/服务层级；未知价为 NULL/unpriced。已纳入 45 文件 822 项回归                                      | 目标账号与账单对照；旧聚合缺逐请求信息时保持 unpriced                               |
| READY-01                | 本地验证通过     | CLI-only 在 Run/付费分解/通知前拒绝；help、detect JSON、status 区分安装与准入；API 标为 text-only；`--cli-tool` 真正选后端。router/orchestrator 73 项通过，实际命令 4 项通过 | 精确提交 CI；保留逐请求治理门                                                       |
| CODEX-01                | 局部实现并验证   | camelCase item、文本/工具 delta、tokenUsage；thread/turn 关联；早到通知有界缓冲；RPC 超时；未知提交不 fallback。12 项通过                                                    | 官方生成 schema 校验、最新固定版本真实 turn；未扩大生产白名单                       |
| BRIDGE-01               | 局部实现并验证   | finalize-once；abort/timeout 共用 TERM/KILL；同步 spawn 拒绝；存活 child 的 error 等待 close；task:start 内取消不会 spawn。32 项通过                                         | 各平台真实进程树退出证明；主路由继续拒绝未 attested CLI                             |
| IDE-REPLAY / SESSION-01 | 局部实现并验证   | 后台有界正文缓存；v2 规范压缩前正文、有效回退前缀、分支独立历史与可验证 timeline 摘要；双 IDE 分页、身份及 revision 游标；真实 store / Kernel / CLI / 子进程 / Swing 回归    | 旧回退/摘要记录、旧快照分支及不兼容来源映射，durable 增量去重和真实双宿主验收仍待补 |
| IDE-DRAFT               | 局部实现并验证   | 双 IDE composer/附件持久化、发送前保存、ACK/unknown 分离与只读核对；双 IDE 问题表单与 VS Code 原生 schema 草稿、原 child/request 隔离、过期仅文字恢复                        | 双 IDE 真实宿主旅程、当前跨平台与可访问性验收待完成                                 |
| IDE-STREAM              | 本地验证通过     | 稳定文本节点增量 append，结束解析一次；选择区延迟格式化；follow-bottom；10K/100K/200K 与生成 Webview 滚动测试                                                                | 真实宿主 frame p95/最长 task 基准与验收                                             |
| IDE-MODE                | 局部实现并验证   | 双 IDE requested/effective/pending/failed/unconfirmed；CLI init 关联 ID、实际模式与 policy digest；JetBrains 独立停止线程、退出确认、启动取消与过期响应隔离                  | 真实组织策略/宿主旅程与全平台进程树证明；观测句柄不是 OS 进程隔离                   |
| IDE-IMAGE               | 局部实现并验证   | 双 IDE 4 张/20 MiB turn/40MP 单图；异步处理、逐项错误；CLI 保留 8 张上限，并补齐 20 MiB turn/40MP/header/有界同句柄读取；CLI 图片相关 4 文件 61 项通过                       | 真实宿主测量；完整 codec/动画帧与读取延迟不在 header 准入证明内                     |
| NET-01                  | 待实施           | 当前受限域名执行继续 fail-closed                                                                                                                                             | Linux 不可绕过出口后端及真实绕过探针                                                |
| NET-02                  | 待实施           | 不宣称已有 HTTP/WS 撤销已覆盖                                                                                                                                                | 依赖 NET-01；revision 收紧终止存量连接                                              |
| VERIFY-01               | 待实施/验收      | 保留历史真实模型试点及其范围                                                                                                                                                 | 冻结 30–50 任务、干净安装、实际项目、双 IDE、成本/维护窗口                          |
| PLATFORM-01             | 待实施/验收      | 保留 Strict Sandbox 与 unsupported 分支                                                                                                                                      | OS/架构/后端/stdio 矩阵及最新系统真进程探针                                         |
| PERF-01                 | 局部实现并验证   | 同磁盘夹具全扫/首进程建索引/已有索引新进程/热首页与下一页/失效重建对照；逐页全量内容校验；路径观测失败不报告完整索引验证                                                     | 精确 SHA 三系统 formal、目标硬件与冻结 SLO；Memory 仍为原全文件端口                 |
| PERF-02                 | 待实施/验收      | 复用压缩与工具配对保护                                                                                                                                                       | 真实 usage 校准；中文/代码/emoji/schema 与事实保真                                  |
| MCP-01                  | 本地验证通过     | 真实 loopback HTTP 验证 stateless 404、过期 session、并发单次重建、重建失败；只恢复连接，不重放结果未知的工具调用。相关 57 项回归通过                                        | 目标 MCP 服务端互操作与最终提交 CI                                                  |
| MAINT-01                | 局部实现并验证   | JetBrains 问答字段合同、存储/请求生命周期和原生表单抽取；保留原 child 交付、schema 校验和草稿恢复不变量                                                                      | 其余 runtime 与平台职责抽取、保行为验证                                             |
| DOC-01                  | 实现中           | 本表为两份报告共享状态入口                                                                                                                                                   | 随实现更新证据、最终 SHA 与验收条件                                                 |
| UX-01                   | 按现有入口改进   | READY-01 改进 help/status；MODEL-02 改进费用未知值                                                                                                                           | 复用 doctor/instructions/cost；语音/主题不自动立项                                  |

真人 NVDA/VoiceOver/Orca 听测、8h/24h 生产观察、真实模型账号与真实 IDE 宿主验收分开记录，目前没有新增结果。云恢复与新交互产品仍为报告中的条件性产品决策。

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

### IDE-REPLAY JetBrains 历史恢复与只读分页

JetBrains 重建/选择已有会话读取 v2 page；Older 使用独立历史面板，Live 回到保留的现场正文，Latest 显式读取最新页。发送输入回到现场，不将新回复拼接到旧页。后台完成仍保留各自正文，迟到读取按 session/view epoch/request/live revision 隔离；活动 turn 推迟替换，重置/切换 session/关闭取消旧请求。自动更新保留选中文字及向上阅读位置；失败、interrupt 和退出提示不被自动快照清掉。历史替换不执行工具、不重发审批、不重复播报结束事件。

使用独立读取通道，2 个后台 worker、32 项队列；stdout 最多 2 MiB，stderr 最多保留 16 KiB 并继续排空，非零退出、错误 UTF-8、非法页、超时/超量均显示失败。解析核对 session/event/item ID、重复项、连续序号、revision 与游标范围；页中至多 100 条/1 MiB 文本/每条 200K 字符完整显示，避免旧 live document 的 200K cap 把同页前半部分静默丢掉。下一次现场输出恢复 live cap；显示为可选择的纯文本。CLI 二进制解析仍复用原机制，35 秒 timeout 从 query capture 开始；退出证明沿用已观测子孙机制，不宣称隔离容器或捕获已脱离子孙。

实现与剩余边界见 [JetBrains saved conversation history](../../packages/jetbrains-plugin/docs/CHAT_TRANSCRIPT_HISTORY.md)。新增同一份真实 CLI 输出 fixture 供 Java 与 VS Code 消费，另有真实 Java 子进程输出/取消/超时及 Swing 双会话、迟到结果、选择/滚动保留、分页、错误与大页测试。全量 JDK 21 test/smokeTest/buildPlugin：103 个 suite、889 项 JUnit，886 通过、3 项既有平台跳过，0 failures/errors；1,436 项 smoke 断言通过，并生成本地 ZIP。首次 UTF-8 子进程夹具沿用 Windows stdout 默认编码，严格解码正确拒绝；夹具改为显式 UTF-8 字节后全量通过。CLI/VS Code 历史回归 2 文件 16 项通过。最后补充滚动/紧凑导航、停止提示在切 tab 后仍保留的行为后，相关 4 个 JUnit 文件 25 项及打包再次通过；ZIP 内 8 个相关 class 与当前编译产物 SHA-256 一致。滚动夹具在初始 caret 布局完成后模拟读者上滚，避免把初始布局误作刷新行为。真实 IntelliJ GUI、可访问性听测和最终提交 Actions 均未执行。

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

提交表示这部分实现及其本地回归已经保存，不表示同 ID 下的真实账号、跨平台、完整历史、宿主输入接受旅程或生产观察验收已完成。
