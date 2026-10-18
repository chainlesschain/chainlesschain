# Dots / Muse / Mods 借鉴：实施进度

更新日期：2026-10-18。原 `feature/dots-muse-mods-foundation` 已通过 `58a30cbae7` 完整合入 `main`。开始实施时基线：`1de6f0f8d052eb1186a06ce6d30d0aa2dfffe85b`。2026-10-18 CLI/IDE 批次在 `7111f3f78725c82c35927fd5bada0e0b1be5983c` 基础的共享工作树验证，按用户要求将已完成的九批内容整理至独立 `feature/dmm-cli-ide-20261018`，保留并行任务改动。见下文新批次；历史回归数字不与本批相加。

依据：[分析与实施计划](./chainlesschain-dots-muse-mods-analysis-2026-10-06.md)。B0/B1 目标基础与公共持久调度模块已提交为 `f74ae00de0`，首个风险巡检宿主与目标面板为 `ae8b2c5b57`，持久建议/原生动作与恢复为 `e8b5c87951`。独立完成检查器、停止单次执行、结束跟进及桌面验收面板已进入 `5c5a742a6b`，并随功能分支合入主分支；目标记忆原生驱动、引用/授权/恢复服务及桌面 IPC 已完成本地验证，记忆面板已完成本地组件回归，持久站内通知、静默策略与深链接已完成本地回归，扩展及实际业务验收仍需继续交付。

**历史验收与控制回归：30 个互不重叠的测试文件，545 项通过，0 失败、0 跳过。** 分别为 CLI 292 项、Desktop 172 项、Renderer 79 项及隔离打包 2 项；包含 34 项独立完成、69 项监控、26 项跨域 usage 和既有 13 项真实 Node 子进程恢复用例。历史动作与恢复批次为 26 个文件、453 项，监控为 36 个文件、705 项，基础为 21 个文件、412 项，共享调度器为 27 个文件、521 项；各批有重叠，不相加。Electron 窗口和对话框在宿主测试中为替身，尚未运行真实 Electron GUI、真实业务效果评测或候选提交的远端发行矩阵。

| 任务                 | 本轮状态                                 | 已实现                                                                                                                                                              | 仍需实施或验收                                                                                          |
| -------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| DMM-00 宿主接入      | 公共模块与首个桌面宿主完成               | 共享调度器与授权额度；主进程派生私有独立调度库；当前原生驱动、连接轮换和退出 draining；隔离 npm pack 加载                                                           | 实际桌面应用打包、完整 GUI 旅程及远端候选提交验证                                                       |
| DMM-01 目标合同      | 合同与独立业务完成检查器完成             | 版本/控制代次、个人引用；监控、原生动作、独立验收共享预算；明确业务断言与人工验收，完成证明同事务提交；模型 usage 保留未知费用与实际下界                            | 真实模型调用 adapter、其他执行域及实际业务有效性验收                                                    |
| DMM-02 存储适配      | CLI 与原生项目 SQLite 基础完成           | 同一 CLI 文件、严格锁内 CAS、旧数据安全缺省值、超限旧历史兼容、原生事务内身份/归属复核、当前权限读取、IPC/preload                                                   | 用户显式导入 CLI 目标到项目的备份/映射/回退流程；进程级并发及故障恢复演练；真实 GUI 使用入口            |
| DMM-03 持续调度      | 风险 adapter、独立停止控制与进程恢复完成 | 真实 SIGKILL、双进程抢占、迟到 fence、撤权恢复；持久停止本次执行与结束跟进；共享预算、离线合并和真实 draining 投影                                                  | 其他 adapter 和 canonical Graph 接入                                                                    |
| DMM-04 受控动作      | 原生动作回执与独立完成复核已接通         | goal→risk review→intent/admission→ActionRun；当前版本预览、原生确认、同事务血缘与 usage；未解决动作阻止验收；暂停/修订/到期/撤权/退出阻止旧确认；未知结果不换键重放 | 真实 Electron 旅程及更完整的审计展示                                                                    |
| DMM-05 记忆与通知    | 记忆与持久站内通知本地回归完成           | 记忆分类/修正/撤权/删除/恢复；监控事务内通知投影、语义去重、静默时段、已读、源授权复核与目标深链接；身份失效清空与迟到响应防护                                      | 真实 GUI；模型输出阶段 Memory 授权 adapter；业务效果与发布门                                            |
| DMM-06 工作区闭环    | 目标/动作/验收与结束控制界面回归完成     | 建议分页、范围设置、草稿恢复、当前预览、原生确认、回执/风险证据；验收配置/检查/完成历史、停止本次与结束跟进；跨身份/版本丢弃迟到响应及失效证据                      | 真正 Electron GUI 旅程与最终产品验收                                                                    |
| DMM-07 扩展 SDK      | 只读、离线采纳与在线待审提议接通 | 严格准入、CLI/IDE 面板/目录；独立 v3 入队、持久授权/撤权、来源分页、先存请求引用及未知结果查询；原生预览/确认/回执 | 事件订阅与真实 GUI 旅程 |
| DMM-08 场景包        | 只读与提议样例可接入，完整助手仍原型 | 只读 viewer 与 `goal-description-drafter`；两端 IDE 原生提议入口、风险来源绑定与原生确认恢复 | 完整可安装项目交付助手装配、扩权升级及重新安装后显式恢复 |
| DMM-09/10 效果与发行 | 恢复演练已补，待业务与发行验收           | 13 项真实进程演练；CLI 默认单元/集成集合及桌面固定配置包含新回归；本批 545 项独立证据                                                                               | 实际业务样本、准确候选提交三平台 CI、默认关闭开关、灰度和迁移/回退；发行时遵守 OIDC 与子包→CLI→IDE 顺序 |

## CLI/IDE 在线待审草稿连接（2026-10-18）

新增独立 `goal.drafts` v3 连接，复用原生登录身份与私有连接目录。CLI `goal draft-access` 导出已安装、信任、能力同意和策略准入插件的来源请求；桌面通过原生 picker 读取、原生确认后建立持久 grant。来源标签与声明摘要不鉴定插件代码，持有凭据的程序只能使用该来源标签提交待审草稿。已有 v1 摘要与 v2 历史证据连接不能获得此能力。

[持久来源服务](../../../packages/session-core/lib/project-goal-external-drafts.js)绑定 actor/store/project/goal/完整插件身份与声明摘要；原生确认带 expectedEpoch CAS，迟到确认不能恢复已撤权来源。同一有效授权重连保留 epoch，禁用后启用或目标/声明变化轮换 epoch。断开、到期和退出停止连接，已保存草稿与原生授权保留；桌面来源面板可显式撤权，阻止旧草稿、转换和待确认预览继续使用，已完成回执保留。CLI 插件信任和原生来源授权相互独立。

协议固定 `/goal-drafts`，只开放目标摘要、来源分页、入队与提交回执；每页至多扫描 20 个原生 proposal，不复制任务正文或审批。请求 HMAC 绑定方法、路径、nonce 与实际正文 hash；响应绑定 nonce、HTTP 状态与精确正文。16 KiB 请求/响应、5 秒接收/读取期限、nonce/socket/15 分钟 lease 上限沿用连接防护。收包结束与返回前重验上下文；原生 enqueue 同步复核完整来源与授权，接口没有 preview/approve/execute 操作。

CLI 新增 `goal draft-sources`、`draft-send`、`draft-receipt`。`draft-send --record` 必须先 wx 创建并 fsync 无正文、无凭据的精确请求引用，再经真实 SDK adapter 发起至多一次提交。已有同一引用只查询回执；不同正文、插件、授权或请求身份冲突。`saved` 只证明待审草稿保存；`unknown` 保留原引用查询；`not-found` 仅说明查询时无回执，不能证明迟到请求不会保存。来源失效后仍可查询已保存回执；连接失效、grant epoch 或插件准入变化时，不能声称未提交，可在桌面核对历史。

VS Code 与 JetBrains 新增导出来源请求、在线提交和独立回执查询。连接、正文与请求记录路径均来自原生 picker，风险来源来自有界原生分页选择器；固定目标/插件版本/声明摘要/grant epoch，丢弃身份或面板代际变化后的迟到展示。关闭发送界面后仍可重新选择持久记录查询。桌面新增授权/草稿分页、正文核对、撤权与原生预览；操作失败、来源和身份变化会先清除待执行缓存。

本批 **52 个独立测试文件、943 项通过、0 失败、3 项 Windows 符号链接用例跳过**（CLI / 共享核心 701、桌面 144、Vue 81、JetBrains 17）。[本批验证与制品说明](./evidence/dmm-cli-online-drafts-2026-10-18/README.md)及[源码/命令/报告汇总](./evidence/dmm-cli-online-drafts-2026-10-18/summary.json)独立保存。真实 SQLite、Windows DACL、HTTP、真实 CLI 插件准入及 SDK 联调已覆盖 pending-only、断开重启、原生预览/确认、撤权、收包竞态和回包丢失查询；Electron 登录/窗口/对话框、IDE 选择交互和 preload 为替身，未运行真实 GUI。Astra 实现共享授权/CLI/JetBrains并复核其他接线；发现的 VS Code 完整 binding 丢失已修正并追加针对性复测，汇总按测试文件取最终结果，不累加重叠报告。

事件订阅、完整可安装交付助手、真实 Electron/IDE GUI、独立业务效果与准确提交发行门仍未完成。未升级版本或发布；发行继续使用完整配置的三平台准确提交 CI、GitHub Actions OIDC 与子包→CLI→IDE 顺序。

## CLI/IDE 提议文件移交与原生采纳（2026-10-18）

以下为上一批次快照；独立在线连接见上文。

新增 `cc goal draft-request` 与 proposal-only 样例 `goal-description-drafter`。CLI 从显式连接读取当前目标，复核所选已安装插件、工作区信任、能力同意、管理策略和声明摘要；读取 UTF-8 正文并导出固定 schema 的不可信请求文件。来源 ID 必须从桌面当前原生风险建议复制，不能从风险摘要猜测。正文限 8192 UTF-8 字节，请求包限 16 KiB；目标、环境、选项及输出路径在异步调用前固定，输出文件独占创建、不覆盖。导出结果明确为 request-exported，不伪称已保存原生草稿。两端 IDE 新增 **Export goal draft request…**，连接/正文/输出路径均来自原生选择器，webview 只能发起动作。

桌面目标建议区增加[采纳面板](../../../desktop-app-vue/src/renderer/components/projects/ProjectGoalDraftImportsPanel.vue)，显示可复制的当前来源 ID，并通过固定 native picker 入口读取一次文件。原生对话框展示目标、身份、声明来源、风险来源、完整正文和内容摘要；摘要不证明插件身份。确认前后重验身份、认证代次、窗口/导航、数据库及原生目标/来源。确认后不重新读取文件，因此文件替换不能改变已展示内容。

[共享采纳服务](../../../packages/session-core/lib/project-goal-draft-imports.js)使用独立固定的 `native-imported-description` 原生身份和 `origin:user-edited`，文件声明标签仅为元数据。每份采纳绑定 actor、goalRef、原生 sourceRef、完整 payload、稳定 requestId 和独立 epoch；采纳与 pending 草稿经 `enqueueInTransaction` 在同一原生 immediate 事务提交，任何一步失败均回滚。相同请求身份/正文返回原记录，同身份改正文拒绝；来源变化仍可核对“此前已保存，当前不可继续”，不换键重复插入。逐份撤销推进 epoch，重导原文件不会恢复；已经完成的任务修改不会自动回滚。CLI 插件禁用不替代原生采纳撤销。

原生工作流按已校验 draft 的固定身份精确路由 verifier，不依次试不同队列或吞掉校验错误。采纳记录与原 payload/epoch 在预览、执行和保存阶段复核；实际任务修改继续需要第二次原生确认，确认文本正确标注“已采纳外部请求”。重启沿原转换/intent 读取预览，不自动执行。面板在目标/身份/风险来源变化、读取/准备失败或未知结果时清除旧正文和父级待执行预览；撤销和准备请求前先失效旧预览，保留完成历史。

新增五个固定通道：`project:goal-draft-import`、`project:goal-draft-imports-list`、`project:goal-draft-import-read`、`project:goal-draft-import-prepare`、`project:goal-draft-import-revoke`。renderer 不提交文件路径、插件授权或审批结论。原摘要/evidence 凭据没有扩权；本批没有在线 POST 写接口。Astra 设计和实现复核推动修正了 CLI 等待期间的可变 options/env，以及失败后父级旧预览残留；复核后无剩余阻断项。

[本批独立证据](./evidence/dmm-cli-draft-handoff-2026-10-18/summary.json)记录真实 SQLite 原子回滚、重复导入/重启恢复、撤销后旧意图拒绝、完整风险来源校验，以及实际私有 DACL/HMAC 连接→真实插件准入→导出→原生采纳→预览→确认/回执。Electron 原生窗口、登录上下文与对话框、IDE/Vue UI 为测试替身；真实产品 GUI 与业务效果仍待验收。

最终 **44 个独立测试文件、843 项通过、0 失败、3 项 Windows 符号链接用例跳过**：[CLI/共享核心 30 个文件、619 项](./evidence/dmm-cli-draft-handoff-2026-10-18/cli-tests.json)，[桌面 8 个文件、139 项](./evidence/dmm-cli-draft-handoff-2026-10-18/desktop-final-tests.json)，[Vue 5 个文件、74 项](./evidence/dmm-cli-draft-handoff-2026-10-18/renderer-tests.json)，[JetBrains 1 个类、11 项](./evidence/dmm-cli-draft-handoff-2026-10-18/jetbrains-tests.xml)。不与历史批次或初次/中间回归相加。首次桌面全组出现取消只读连接后残留一个导航监听的问题，[原报告 138 通过、1 失败](./evidence/dmm-cli-draft-handoff-2026-10-18/desktop-tests.json)保留；现仅写入上下文启用共享导航代次监听，bridge 继续清理自身监听，取消专项和最终全组均通过。Astra 复核确认导航撤权和导入窗口固定未被削弱。

[Session Core 隔离包](./evidence/dmm-cli-draft-handoff-2026-10-18/packed-session-core.json)验证新 CJS/ESM 公共出口和真实 SQLite 采纳/预览/撤销；[CLI 包](./evidence/dmm-cli-draft-handoff-2026-10-18/cli-package.json)核对新样例、导出实现、命令/帮助及更新后的 README；[VSIX](./evidence/dmm-cli-draft-handoff-2026-10-18/vscode-package.json)源码和 [JetBrains ZIP](./evidence/dmm-cli-draft-handoff-2026-10-18/jetbrains-package.json)编译类与当前来源一致。制品均位于临时目录并记录 SHA-256，未发布。命令生成、固定 IPC、相关源码/README 格式及差异检查见[检查记录](./evidence/dmm-cli-draft-handoff-2026-10-18/checks.json)；[最终 53 处源码快照](./evidence/dmm-cli-draft-handoff-2026-10-18/source-final-snapshot.json)在测试完成后再次核对。

在线提议写入仍需独立连接/持久 grant、原生撤权、来源目录和未知结果查询；事件订阅、完整项目交付助手与准确候选提交发行门也未完成。未升级版本或发布；仍按准确提交三平台检查、OIDC 与子包→CLI→IDE 顺序执行。

## CLI/IDE 风险历史与动作回执摘要（2026-10-18）

以下为上一批次快照；本批提议文件移交与逐份原生采纳见上文。

桌面连接控件增加 **另行授权风险与回执摘要**。原生对话框独立说明最新历史检查、最近 20 条动作回执元数据及排除的正文；新连接使用 v2 描述符、`goal.evidence` capability 与固定 `/goal-evidence` 路径。原 v1 摘要连接仍只有 `/goal-summary`；不能沿用原同意扩大范围。TTL、私有文件、双向 HMAC、当前登录/窗口/导航/数据库及目标版本复核沿用上一批。renderer 只取得连接状态，不取得凭据。

[只读证据服务](../../../packages/session-core/lib/project-goal-evidence-reader.js)用内部 WeakSet 标记的原生 SQLite 视图复用现有校验器；要求 native statement 的 `readonly/reader` 标记，事务统一使用 deferred。构造与读取不初始化 schema、不触发工作流恢复、不改变 usage；摘要读取也切到同一只读入口。真实 SQLite `PRAGMA query_only=ON`、schema 与 `total_changes()` 验证覆盖整条读取链路。

风险来源取最新持久 check，而不是只记录完整检查的 proposal observation；最新不完整或损坏结果不得退回旧的成功检查。缺表显示 unavailable，尚无记录显示 not-recorded，信息不足的风险数量为 null。每个历史结果绑定原 review、检查时间及目标 revision/control generation，不声称当前风险或目标完成。回执先核验全部有界意图，再按真实 ActionRun 插入顺序取最近 20 条，较新的草稿不遮蔽真实回执；running 保持 unresolved，不恢复或结算。读取 JSON 前先在 SQL 层限制检查和回执大小，正文、预览及审批证据不对外投影。

CLI 为 evidence 连接显式启用 `panel:goal.evidence`，仍逐次复核已安装插件、当前工作区信任、能力同意与策略；投影期间固定完整证据摘要，变化则拒绝混合返回。summary 槽即使使用 evidence 连接也只能读说明和状态。[goal-evidence-viewer](../../../packages/cli/src/lib/plugin-runtime/examples/goal-evidence-viewer/plugin.json)仅声明一个只读文本面板，无事件或提议；CLI README 给出安装、信任、同意及连接命令。两端 IDE 复用原生文件选择器，只有显式连接读取才接受 evidence 槽，仍显示带读取时间的文本快照。

Astra 只读实现复核发现“workflow 存在而 ActionRun 表缺失”误显示空历史的问题，已补两表存在校验与专门回归。真实 SQLite/HMAC/SDK 集成使用实际检查与原生动作回执；Electron 登录、原生对话框及 IDE UI 为测试替身。验证结果、制品与源码摘要见[本批独立证据](./evidence/dmm-cli-project-evidence-2026-10-18/summary.json)，本批不与历史数字相加。

最终 **40 个独立测试文件、807 项通过、0 失败、3 项 Windows 符号链接用例跳过**：CLI/共享核心 [27 个文件、602 项](./evidence/dmm-cli-project-evidence-2026-10-18/cli-tests.json)与 [SDK 证据权限/快照 1 个文件、5 项](./evidence/dmm-cli-project-evidence-2026-10-18/cli-evidence-host-tests.json)，桌面 [7 个文件、124 项](./evidence/dmm-cli-project-evidence-2026-10-18/desktop-tests.json)，Vue [4 个文件、66 项](./evidence/dmm-cli-project-evidence-2026-10-18/renderer-tests.json)，JetBrains [1 个类、10 项](./evidence/dmm-cli-project-evidence-2026-10-18/jetbrains-tests.xml)。reader/契约的 [27 项最终复核](./evidence/dmm-cli-project-evidence-2026-10-18/cli-evidence-final-tests.json)与主回归重叠，不重复计数。

[Session Core 隔离包](./evidence/dmm-cli-project-evidence-2026-10-18/packed-session-core.json)验证 CJS/ESM 公共出口、真实 SQLite query-only、零写入和无执行端口；[CLI 包](./evidence/dmm-cli-project-evidence-2026-10-18/cli-package.json)核验新样例和连接源码确实分发。[VSIX](./evidence/dmm-cli-project-evidence-2026-10-18/vscode-package.json)内源码与 [JetBrains ZIP](./evidence/dmm-cli-project-evidence-2026-10-18/jetbrains-package.json)内编译类均与本地来源匹配。制品保存在临时目录并记录 SHA-256，未发布；命令生成、固定 IPC、Prettier 与差异检查见[检查记录](./evidence/dmm-cli-project-evidence-2026-10-18/checks.json)。

项目提议写入桥、事件订阅、完整可安装交付助手、真实 Electron/IDE GUI、实际业务效果及准确候选提交发行门仍未完成。无版本升级或发布；发行继续遵循准确提交三平台检查、OIDC 与子包→CLI→IDE 顺序。

## CLI/IDE 已登录项目摘要只读桥（2026-10-18）

以下为上一批次快照；风险与回执的独立授权、只读投影见上文。

桌面目标区新增[连接控件](../../../desktop-app-vue/src/renderer/components/projects/ProjectGoalCliConnectionPanel.vue)，原生确认后由[主进程桥](../../../desktop-app-vue/src/main/task/project-goal-cli-bridge.js)在 `127.0.0.1` 随机端口开放单个目标的说明、active 状态与完整目标引用。授权绑定真实登录 DID/认证代次、数据库句柄、可信窗口/frame、导航和目标 revision/control generation；请求及返回前重验当前归属、项目状态与目标期限。每宿主至多一个连接、15 分钟固定有效期，绝对期限与单调计时同时约束，重新打开应用不恢复授权。取消或停止后的迟到原生对话框不能重新启用连接，新连接仅在成功后替换旧连接。

连接文件只能保存在桌面 userData 下的专用 `goal-connections` 目录。创建文件前先设置并核验目录 owner-only 权限，Windows 使用共享 `private-storage` 的真实 DACL 实现；不能把 `0600` 当作 Windows ACL。原生保存返回后再次核验父目录；独占创建文件、核验 FD/路径身份与单链接、设置文件私有权限后才写入密钥。这样避免了公共目录中的空文件在收紧 ACL 前被其他用户持有读取 handle。文件不含数据库路径；renderer 只取得 enabled/到期时间/目标引用，不取得密钥、端口或连接路径。停止后文件保留但失效，需用户显式新建连接。

连接凭据授予持有者固定字段的外部读取权，不证明调用者是可信插件。密钥不随 HTTP 请求发送：客户端为每次读取生成随机 nonce，请求 MAC 绑定 method/path/nonce，返回 MAC 绑定 nonce 和精确 JSON 正文；端口被复用的其他进程无法伪造摘要。服务拒绝 Origin、其他路径/方法/Host、重放 nonce，单连接至多 512 个已认证请求、8 个 socket，响应上限 16 KiB，客户端总时限 5 秒。CLI 对私有文件作有界 FD 读取及身份复核，验证双向 MAC、schema 与固定 goalRef；失败不退回本地文件目标或数据库。

`cc goal catalog --connection <file> --json` 返回唯一获准目标；`cc goal panels <id> --connection <file> --expected-store <store> ...` 复用原有 SDK 的插件发现、信任、能力同意、管理策略和读取前后准入复查。VS Code/JetBrains 的目标选择器增加 **Open desktop goal connection…**，通过原生文件选择器取得路径，再调用 CLI；webview 不能直接指定凭据路径。选择 store、目标 ID 和文件路径一并固定，过期或连接失败不会自动读取其他来源。展示仍为带读取时间的文本快照，无后台订阅或项目写入权限。

本批验证及准确源码摘要见[独立证据](./evidence/dmm-cli-project-summary-bridge-2026-10-18/summary.json)。真实 SQLite、原生文件权限、loopback HTTP 和全新 CLI 子进程覆盖原生授权后的摘要读取，以及插件安装、未信任/未同意拒绝、显式准入、禁用和连接停止；Electron 原生窗口/对话框与登录凭据为测试替身，尚未运行真实产品 GUI。Astra 独立复核后修正 Windows 权限窗口，最终未发现剩余阻断问题。既有草稿/预览/回执回归同批验证。

最终结果为 [CLI 7 个文件、124 项通过、3 项 Windows 符号链接用例跳过](./evidence/dmm-cli-project-summary-bridge-2026-10-18/cli-tests.json)、[桌面主进程 7 个文件、123 项通过](./evidence/dmm-cli-project-summary-bridge-2026-10-18/desktop-tests.json)、[Vue 组件 4 个文件、65 项通过](./evidence/dmm-cli-project-summary-bridge-2026-10-18/renderer-tests.json)，以及 [JetBrains 1 个测试类、10 项通过](./evidence/dmm-cli-project-summary-bridge-2026-10-18/jetbrains-tests.xml)：合计 19 个独立测试文件、322 项通过、0 失败，不与历史批次相加。Windows 真实 DACL 多次校验使新权限用例耗时超过普通 30 秒预算；仅该测试组改用 90 秒功能验证预算后完整通过，真实 CLI 子进程旅程为独立 180 秒预算，不代表产品性能指标。[原超时报告](./evidence/dmm-cli-project-summary-bridge-2026-10-18/desktop-before-timeout-budget.json)保留；共享身份上下文抽取时漏传 `actorDid` 导致的既有草稿确认回归也已修复，最终同批重新通过。

[VS Code VSIX](./evidence/dmm-cli-project-summary-bridge-2026-10-18/vscode-package.json)与 [JetBrains ZIP](./evidence/dmm-cli-project-summary-bridge-2026-10-18/jetbrains-package.json)已在临时目录构建并保存 SHA-256；VSIX 内两处新源码与当前源码一致，JetBrains 编译了原生文件选择界面，包内两处连接类也已核对。构建使用缓存的 IntelliJ Community 2024.2 与 JBR 21 编译器；离线解析/JDK 选择问题经 `-Porg.gradle.java.installations.paths` 修正后通过。准确命令与版本见各制品记录。命令生成、固定 IPC、相关源码/测试/CLI README 的 Prettier 与 `git diff --check` 见[检查记录](./evidence/dmm-cli-project-summary-bridge-2026-10-18/checks.json)；[31 个关键源码的测试中快照](./evidence/dmm-cli-project-summary-bridge-2026-10-18/source-snapshot.json)在测试结束后再次匹配。

当前桥只读取目标摘要；项目风险/回执投影、扩展提议写入桥、事件订阅、完整可安装交付助手、真实 GUI 与业务效果仍待继续。未升级版本或发布。发行仍遵守准确提交跨平台检查、GitHub Actions OIDC 与子包→CLI→IDE 顺序。

## 扩展草稿到原生意图与回执（2026-10-18）

以下为上一批次快照；本批新增的已登录摘要只读桥见上文。

本批继续复用 CLI SDK 已接通的共享队列，补齐可信宿主的 `prepareDraft({ id })`。插件仍只能提交待确认建议；宿主根据持久草稿读取正文与权限上下文，客户端不提交新的正文、请求键或授权。每份草稿先在独立原生事务内保存唯一、不可变的转换记录，再调用已有工作流建立当前预览，避免嵌套事务。转换 ID、原生 requestId 与 intentId 由草稿 ID/digest 派生；预览失败、关闭重开或响应丢失均恢复同一转换。转换记录限 8 KiB，正文在转换前校验 8192 UTF-8 字节上限。

[转换绑定](../../../packages/session-core/lib/project-goal-extension-conversion.js)覆盖 actor、插件版本、目标 revision/control generation、原生风险 proposal/review、正文与原始 prepare input digest。原生 intent、预览请求和动作证据保留 `extensionRef` 的 draftId/conversionId 及两个内容摘要；普通意图保持原六字段引用。扩展 intent 使用保留的确定性 ID，删除引用不能降级为普通手动意图，其他草稿也不能复用已被占用的来源。

`ProjectGoalWorkflow` 在 prepare、preview、admission、before-write 与成功记录阶段校验绑定和当前同步宿主 verifier；缺失、异步或拒绝的 verifier 不准入。普通 get/list 同样隐藏失效的未执行扩展预览，execute 不绕过撤权；成功记录阶段允许本次已授权业务写入改变目标任务快照，仍重验授权与完整血缘。历史和 running/terminal 回执只验证完整性、当前业务读取权限，不恢复执行权；未知结果保留原 intent 和未知 usage，不换键重放。

桌面增加固定 `project:goal-delivery-drafts-prepare` 通道及 `prepareGoalDeliveryDraft({ id })`。普通 renderer prepare 禁止复制 `extensionRef`。可信窗口/frame、数据库、DID 与认证代次绑定覆盖全部目标动作入口；原生业务确认同时显示草稿/转换 ID 和草稿 digest。草稿面板显式建立意图后重新加载建议区，用户核对当前/拟保存说明后再点击原生确认。界面恢复只发送持久 draft ID；助手授权 epoch、身份、store/control generation、来源 review 或明确来源拒绝使待执行扩展缓存失效，历史回执保留。转换成功会作废并重读旧列表，组件测试覆盖迟到列表不能覆盖新预览。

[本批独立证据](./evidence/dmm-extension-intent-conversion-2026-10-18/summary.json)包含 [CLI/共享核心 27 个文件、583 项通过、4 项 Windows 符号链接用例跳过](./evidence/dmm-extension-intent-conversion-2026-10-18/cli-tests.json)、[桌面主进程 6 个文件、102 项通过](./evidence/dmm-extension-intent-conversion-2026-10-18/desktop-tests.json)及 [Vue 组件 3 个文件、62 项通过](./evidence/dmm-extension-intent-conversion-2026-10-18/renderer-tests.json)：共 36 个独立文件、747 项通过，0 失败，与历史批次重叠，不累加。包括既有动作/风险血缘、任务创建及组织工作流回归；普通手动草稿的版本冲突提示与输入保留也有回归。

新增[真实 Node 子进程恢复用例](../../../packages/cli/__tests__/integration/goal-extension-conversion-process.test.js)，在转换提交、原生 draft 提交、prepared 提交、业务提交后响应前，以及原生确认中断处退出进程。关闭句柄并以新进程恢复后验证固定 ID、唯一 ActionRun 和不重复写入；确认中断恢复为 unresolved/unknown。退出点由测试夹具局部拦截并调用 `process.exit`，未增加生产故障入口，不等同断电或操作系统强杀演练。SQLite 为真实实现；登录身份、Electron 窗口/原生对话框为测试替身，Vue 使用真实组件与模拟 preload API。

[隔离打包](./evidence/dmm-extension-intent-conversion-2026-10-18/packed-session-core.json)验证新增内部转换模块随 `lib/` 打包、公共引用校验和可信 prepare/verifier 端口可加载，队列没有执行端口。命令 manifest/help/completions、固定 IPC、相关源码/测试/包 README 的 Prettier 与 `git diff --check` 见[检查记录](./evidence/dmm-extension-intent-conversion-2026-10-18/checks.json)。Astra 分别复核核心/IPC 和最终界面；发现并修复 store/control 监听遗漏、跨授权缓存、转换刷新竞态、明确来源拒绝的旧预览残留，最终未发现剩余阻断，未重复运行测试。

CLI/IDE 产品仍只接独立文件目标；可信已登录项目桥、事件订阅、`task.create` 类型合同、完整可安装项目交付助手、真实 Electron/IDE GUI 与业务效果尚未完成。本批无版本升级或发布；打包为本地未提交源码制品。新增子包能力仍需准确提交的跨平台门禁、GitHub Actions OIDC 与子包→CLI→IDE 发行顺序。

## 原生扩展草稿队列与桌面内置场景（2026-10-18）

以下保留上一批次的实现与验证快照；本批新增的持久转换及执行衔接见上文。

新增 Session Core 公共[提议合同](../../../packages/session-core/lib/goal-extension-proposal-contract.js)与[原生待确认队列](../../../packages/session-core/lib/project-goal-extension-queue.js)。CLI SDK 改为复用该合同，并以实际 SQLite、真实 CLI 插件发现/信任/能力同意接通宿主适配联调。CLI 仍没有已登录项目 actor 或新的项目写命令；现有 VS Code/JetBrains 入口继续读取独立文件目标，本批不把测试注入的可信项目身份当成产品授权桥。

队列固定当前插件身份和宿主同步准入回调；在原生 immediate 事务中重验 actor、store、目标 revision/controlGeneration、项目归属与状态、期限、允许动作和原生风险来源。工作流新增公开事务内检查口，复用原 `_live/_source`，不在新事务中嵌套 `prepare()`。SDK `task.description.update` 显式映射为原生 `task.update-description`；`task.create` 缺少 taskType 合同，本适配器明确拒绝。

每份草稿绑定原生 proposalId、风险 reviewId/digest、信号摘要与目标引用。即使后续检查保留同一 proposalId，也不能把新 review 当成原来源；来源修订、目标暂停/到期、项目转移、已有原生 intent 或准入变化均阻止继续读取。幂等键绑定 actor、插件版本、完整目标引用和 requestId；同键参数变化报冲突。关闭全部数据库句柄后沿原键回读，不生成 intent、ActionRun 或“执行成功”回执。每 actor/目标/插件保留至多 100 份、单份 48 KiB；分页至多检查 20 份，无效历史计数并推进游标，不伪装成空项目。

桌面[固定内置规则](../../../desktop-app-vue/src/main/task/project-goal-delivery-drafts.js)使用独立命名空间 `desktop-builtin:project-delivery-drafts@0.1.0`，默认禁用。用户在原生对话框同意后，grant 绑定 actor/store/project/goal、固定包版本/能力摘要及 epoch；确认返回后重验可信窗口/frame、认证代次、数据库、当前目标和旧 epoch。启用前及提交前复核项目状态与期限。禁用保留历史并阻止读取/新增；重新启用推进 epoch，旧草稿仍不可推进，必须显式创建新请求。授权 JSON 在 SQL 层限为 4 KiB。

新增五个固定 IPC/preload 入口：状态、配置、生成、分页、精确读取。renderer 仅提交目标引用、原生来源 ID 和请求键，不能指定插件身份、actor、能力准入或审批结论；说明由主进程固定规则生成，记录 `origin: builtin-rule`，不把 renderer 文本伪称为插件输出。

[草稿面板](../../../desktop-app-vue/src/renderer/components/projects/ProjectGoalExtensionDraftsPanel.vue)已嵌入目标建议区：先允许任务说明建议并运行当前风险检查，再原生启用助手、选择风险建议、保存与重新核对草稿。内容仅为文本。身份、目标及来源 review 指纹变化会清除旧内容并丢弃迟到读写；观察到新 grant epoch 后清空旧页/游标并重读首页。相同来源/epoch 的未知保存结果沿用原请求，显式重新启用或来源变化才产生新键。本片仅保存/展示草稿，未自动转换为原生 intent；原来的任务预览和原生确认链路保持独立。

本批结果见[独立证据](./evidence/dmm-native-extension-drafts-2026-10-18/summary.json)：[CLI 23 个文件、510 项通过、4 项平台相关跳过](./evidence/dmm-native-extension-drafts-2026-10-18/cli-tests.json)，[桌面主进程 6 个文件、95 项通过](./evidence/dmm-native-extension-drafts-2026-10-18/desktop-tests.json)，[组件 3 个文件、47 项通过](./evidence/dmm-native-extension-drafts-2026-10-18/renderer-tests.json)。本批共 32 个独立文件、652 项通过，与历史批次有重叠，不累加。窗口/对话框为替身，SQLite 与 CLI 插件准入为真实实现；组件使用真实 Vue 与测试工具，缺失依赖在临时目录按锁定版本恢复后链接，未修改项目依赖声明或锁文件。打包出口与固定 IPC 检查单独记录，不能替代真实产品 GUI 或准确提交发行门。

[Session Core 隔离打包探测](./evidence/dmm-native-extension-drafts-2026-10-18/packed-session-core.json)已验证新公共出口、原生来源检查口可从解包制品加载，队列没有执行端口；制品保存在临时目录并记录 SHA-256，未发布。固定 IPC、命令 manifest/help/completions、Prettier 与 `git diff --check` 通过。

Astra 独立复核并确认来源指纹迟到响应、跨授权周期请求键及旧分页残留问题已修复；最终未发现剩余阻塞。真实 Electron/IDE GUI、CLI/IDE→已登录项目的可信桥、事件订阅、草稿到 intent 的持久转换、完整可安装交付助手及业务效果仍待继续。此批无发布或版本升级；新增公共出口需先发行对应 Session Core 子包，再走准确提交的三平台/OIDC 门禁与 CLI→IDE 顺序。

## CLI/IDE 目标目录与原生选择器（2026-10-18）

新增[有界目标目录](../../../packages/cli/src/lib/cli-goal-catalog.js)与 `cc goal catalog [--after <cursor>] [--limit 1..20] [--json]`，供两端 IDE 的 **CLI goal panels…** 原生选择器使用。用户可以按标题、状态和 ID 选择，显式翻页，或切换到手工 ID；取消不会读取目标面板。旧 CLI 缺少目录命令时仍可手工输入，面板命令本身也缺失则显示不可用。

目录仅返回 ID、160 字符内的标题、生命周期状态与版本，不输出 notes、memory 或完整目标。使用 `opendir/read` 最多读取 2,049 个目录项探测 2,048 项上限；超限整次拒绝并保留手工入口。每页最多访问 20 个候选，包括坏源，因此不会为了凑齐有效结果读取整库正文。单源限 64 KiB，有效源输出前再读、重算完整原始字节摘要；每页总源读取约 2.5 MiB 上限。损坏、超限、项目归属、异库及非普通文件记录计入 `skippedCount`，非法 JSON 文件名独立记为目录级 `invalidNameCount`。只在初始目录确实不存在时返回空页，扫描中的删除或悬空链接报错。

游标绑定逻辑 storeId 和最后扫描 ID；坏源占用页预算并推进游标，空的有效结果页不等于末页。每页为独立的新读取，目录变化可能改变后页，不承诺跨页冻结快照。选中条目后，IDE 调用 `goal panels --expected-store <storeId>`，CLI 在打开目标正文前拒绝异库；后页失败再手工输入也保留先前绑定。两端解析器再次检查回传存储，原有源授权/插件准入与输出前复核继续生效。

[共享严格文件读取](../../../packages/cli/src/lib/cli-goal-source.js)从原面板宿主提取，目录和面板使用相同 FD、目录身份、UTF-8、原始摘要与文件上限。VS Code 继续绑定当前工作区并丢弃清除/刷新/关闭后的迟到目录或面板响应；JetBrains 在工作线程读取目录，原生选择后复核 generation/项目状态，目标内容仍显示于只读文本区。目录标题移除控制/双向文本字符；Swing 选择标签以前置安全 ID 开头，内容不作为 HTML 解释。

本批验证与源码摘要见[独立证据](./evidence/dmm-cli-goal-catalog-2026-10-18/summary.json)：[CLI/VS Code 18 个文件、382 项通过、4 项平台相关跳过](./evidence/dmm-cli-goal-catalog-2026-10-18/cli-tests.json)，[JetBrains 9 项 JUnit 通过](./evidence/dmm-cli-goal-catalog-2026-10-18/jetbrains-plugin-manager.xml)，真实 Gradle 编译通过；帮助索引及命令/completions 一致性检查通过。新增目录和共享 reader 已进入 npm dry-run 包清单。与此前批次有重叠，不累加。IDE API 在 VS Code 交互测试中为替身；JetBrains 的真实编译/核心 JUnit 不替代交互 GUI 验收。

Astra 独立复核修正了目录 ENOENT 被误报空页、翻页错误后丢失存储绑定及 Java 计数溢出问题，并补相应回归。此批改进 CLI/IDE 选择与读取；DMM-07 项目服务、事件订阅和持久提议事务仍未完成。现有桌面项目入口要求可信窗口与主进程登录身份，旧 CLI `--user` 或直接打开数据库不能代替该授权。下一步须建立受信宿主适配器，显式映射扩展 `task.description.update` 到原生 `task.update-description`，并保留来源版本、认证代次与原生确认。真实 IDE/Electron GUI、业务样本和准确提交发行门仍未运行，本批没有发布或版本升级。

## CLI/IDE 独立目标面板接线（2026-10-18）

新增可实际调用的 [CLI 宿主](../../../packages/cli/src/lib/plugin-runtime/cli-goal-extension-host.js)和 `cc goal panels <id> [--plugin <name>] [--scope <scope>] [--json]`。该宿主只读取用户明确选择的独立 CLI 文件目标，提供 `panel:goal.summary` 的 objective/status 文本快照；不连接桌面项目数据库，不获得项目 actor，也不创建任务、启动巡检或返回 ActionRun。旧 `goal show`、目标生命周期和文件位置保持兼容。

[goal-progress-viewer 样例](../../../packages/cli/src/lib/plugin-runtime/examples/goal-progress-viewer/plugin.json)可通过现有插件命令安装，依次显式信任及授予能力后读取。禁用、撤权或卸载后新的读取不再包含面板；重新启用后须由用户再次请求读取，不启动自动运行。真实 CLI 子进程用例证明上述操作不改写源目标。项目交付助手需要的风险/动作能力超过该只读宿主上限，会明确拒绝，不能用摘要样例代替 DMM-08 的业务验收。

```powershell
# 从仓库根目录运行；<id> 来自已有 cc goal set/list。
node packages/cli/bin/chainlesschain.js plugin add packages/cli/src/lib/plugin-runtime/examples/goal-progress-viewer --scope project --json
node packages/cli/bin/chainlesschain.js plugin trust goal-progress-viewer --scope project
node packages/cli/bin/chainlesschain.js plugin consent goal-progress-viewer --scope project --grant --json
node packages/cli/bin/chainlesschain.js goal panels <id> --plugin goal-progress-viewer --scope project --json
```

源文件通过同一次有界 FD 读取注入现有 `createGoalFileAdapter` 归一化，避免安全检查后再次打开路径。固定逻辑 storeId 与物理目录身份，拒绝文件符号链接/设备、损坏 JSON、错误 store 和归属；读取前后比较文件身份、大小与时间，原始字节摘要覆盖整个文件，输出前重新读取源与所有参与插件的准入。单源限制 64 KiB、输出 128 KiB、最多 16 个面板；无法复核则不输出旧内容。

兼容修正同时落入共享合同：无 schema 的旧目标不能通过丢弃 ownerRef/projectRef 变成独立目标；缺少可选 title/createdAt 的旧目标可以归一化，只读时不改写字节。授权摘要使用原始字节，避免补出的时间使相同旧目标误报变更。长 objective 的展示有截断标记，其未展示尾部仍参与变更检查；CLI 人类输出移除终端转义序列。

VS Code 和 JetBrains 插件管理器增加 **CLI goal panels…**，通过原生输入选择具体 goal ID，调用相同 CLI 服务并显示纯文本快照；不会扫描全部目标正文或自动把内容发送给模型。VS Code 明确使用所选工作区目录，清除/刷新/插件操作/关闭面板后丢弃旧响应，正文仅写入 `textContent`；JetBrains 使用只读 `JTextArea`，关闭或切换操作后丢弃未完成请求。已显示内容是带时间的快照，外部撤权后需重新读取或清除，不声称实时订阅。

验证结果：CLI **17 个文件，365 项通过、0 失败、2 项跳过**；共享 Goal 合同 **19 项通过**；JetBrains **8 项 JUnit 通过**，并通过完整插件源码 Gradle 编译。Windows 跳过的两项为现有 active pointer 符号链接用例和新增 POSIX 源文件符号链接用例。真实子进程旅程使用实际 CLI bin、真实工作区信任/持久同意/安装生命周期，仅把安全状态文件定位到临时目录；VS Code 界面使用 API 替身，尚未执行真实 IDE GUI 旅程。证据见 [本批摘要](./evidence/dmm-cli-goal-panels-2026-10-18/summary.json)、[CLI 报告](./evidence/dmm-cli-goal-panels-2026-10-18/cli-tests.json)、[共享合同](./evidence/dmm-cli-goal-panels-2026-10-18/goal-contract-tests.json)和 [Gradle JUnit XML](./evidence/dmm-cli-goal-panels-2026-10-18/jetbrains-plugin-manager.xml)。本批与下文基础批次有重叠，不相加。

上批未发现的本机 Java 21 工具链位于 IDE 的 `jbr`，本批显式传给 Gradle 后完成编译与测试；命令仅对当前构建生效，不更改系统 Java 配置：

最后完善 CLI 诊断标签的终端转义过滤后，又重跑 [最终控制回归](./evidence/dmm-cli-goal-panels-2026-10-18/cli-final-controls.json)：2 个文件、18 项通过、1 项 POSIX 跳过；与上述 17 文件集合重叠，不重复相加。命令帮助索引已更新，manifest/help/completions 一致性检查和 Prettier、`git diff --check` 均通过。

```powershell
# cwd: packages/jetbrains-plugin；本机路径，其他环境换成已有 JDK 21。
$env:JAVA_HOME = 'C:/Users/longfa/AppData/Local/Programs/idea-2025.3/jbr'
.\gradlew.bat '-Dorg.gradle.java.installations.paths=C:/Users/longfa/AppData/Local/Programs/idea-2025.3/jbr' --offline --no-daemon test --tests com.chainlesschain.ide.PluginManagerTest --console=plain
```

相同 Java 21 工具链下 `buildPlugin` 也已成功，生成本地 `packages/jetbrains-plugin/build/distributions/chainlesschain-ide-bridge-0.4.166.zip`，哈希与打包类检查记录在本批摘要。该制品来自未提交工作树，用于本地检查，不是已发布或远端发行门通过的候选。

DMM-07 的项目服务、持久提议事务、真实事件订阅和跨平台 GUI 仍未完成；DMM-08 的项目交付助手业务装配、DMM-09/10 的独立样本与准确提交发行门仍待继续。本批没有发布或升级 npm/IDE 公开版本。

本批包含 Session Core 的旧目标兼容修正；将来发行时须先准备对应子包新版本、通过准确提交的三平台门禁并用 OIDC 发布，再发布 CLI，最后对齐并发布 IDE 扩展。当前本地源码与 ZIP 不作为公开版本已支持新命令的证明，旧 CLI 对 IDE 新入口返回不支持时只显示不可用状态。

## CLI/IDE 扩展 SDK 基础（2026-10-18）

此为上一基础批次，新增 [声明合同](../../../packages/cli/src/lib/plugin-runtime/goal-extension-contract.js)及[宿主边界](../../../packages/cli/src/lib/plugin-runtime/goal-extensions.js)，不修改项目目标数据库或既有桌面动作执行服务。后续已接通的按需只读面板见上文。管理清单中的 `runtimeAvailable: false` 保持未激活的保守状态，不是 `goal panels` 的能力探测结果；实际读取每次通过 CLI 服务复核，清单本身不能授予权限或启动后台执行。

| 接口                         | 本批行为与边界                                                                                                                                                                                                                |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `manifest.goalExtension`     | 声明 API、宿主 semver 范围、只读事件、固定 UI 插槽和动作提议；拒绝代码入口、HTML、审批身份及回执写入字段。合法的未来 API 保留声明，但当前实现只接受 `1.0.0`。                                                                 |
| `permissions.goalExtension`  | 使用 `event:*`、`panel:*`、`proposal:*` 的具体枚举 token，不接受通配符或布尔/字符串强制转换。新增能力进入原有 normalize/diff/describe/consent 链路；旧同意记录缺少该字段时按空集处理。                                        |
| `collectGoalExtensions`      | 重新读取插件、当前 managed policy、工作区信任和能力同意。即使旧 runtime 关闭 consent 强制门，新接口仍需显式声明、受信、同意、启用且宿主能力满足；拒绝 legacy、坏 active pointer、禁用和不可读取的授权。                       |
| `projectGoalExtensionEvent`  | 仅支持 `goal.status.changed`、`risk.review.completed`、`action.receipt.updated`。由可信宿主 reader 取得摘要；读取前及输出前重验源权限与当前准入，只投影有界摘要/时间/版本化目标引用。                                         |
| `projectGoalExtensionPanel`  | 仅支持 `goal.summary`、`goal.evidence`、`goal.actions` 固定槽；字段白名单为 objective/status/riskSummary/receiptSummary。输出 `format: text`，不接受扩展 HTML。读取前后重验，期间变更面板声明则拒绝输出。                     |
| `proposeGoalExtensionAction` | 仅支持 `task.create`、`task.description.update` 的待确认提议。固定目标版本、控制代次、sourceRef、requestId 和参数；只调用宿主待办队列，严格要求 `{proposalId,state: "pending-confirmation"}`，拒绝执行终态和 ActionRun 回执。 |
| CLI / IDE 管理面             | `plugin validate --json` 增加 `goalExtensionSummary`，`plugin installed --json` 增加 `goalExtension`；VS Code 和 JetBrains 以白名单解析并显示声明宿主/不支持的 API，绝不由管理 JSON 推断已授权或已激活。                      |

跨异步调用固定工作区绝对路径、managed settings 文件、环境快照、宿主版本/能力和 adapter 回调；复核仍读取该固定工作区的最新授权，不接受等待期间切换到另一工作区的同名插件。Astra 独立复核指出的跨工作区 trust 回退、异步 options 替换、未来 minor API 误接纳、矛盾队列回执改写均已修复并加入回归。

可信宿主 adapter 仍承担业务授权与事务义务：`authorize(context)` 必须按当前登录身份、项目/目标归属、revision/controlGeneration 和源版本核验；`readEvent/readPanel` 只返回授权摘要。`enqueueProposal` 必须在原生事务内重新核验这些条件，按插件/版本/目标/requestId 去重并保存待确认建议。当前未实现这一持久 adapter，因此未宣称 SDK 已能取消队列提交期间的在途业务工作；实际执行仍需既有原生确认与动作服务，模型和扩展不能传入可信 actor、消费审批或写执行终态。

[项目交付助手样例](../../../packages/cli/src/lib/plugin-runtime/examples/project-delivery-assistant/plugin.json)随 CLI 的 `src/` 打包范围分发，仅含声明，无 hooks/bin/MCP 或 JS/TS 入口。宿主版本下界描述本批工作树，不能作为公开发行已支持 SDK 的证明。从仓库根可检查：

```powershell
node packages/cli/bin/chainlesschain.js plugin validate packages/cli/src/lib/plugin-runtime/examples/project-delivery-assistant --json
```

本批最终 CLI 回归 **12 个不重叠文件，306 项通过、0 失败、1 项跳过**；其中新增 SDK 文件 47 项通过。跳过项为既有 scopes 测试中仅适用非 Windows 的 `.active` 符号链接检查，不代表已完成该平台验证。另有 JetBrains 管理器纯核心 JUnit **7 项通过、0 失败/跳过**。测试与源码摘要见 [证据目录](./evidence/dmm-cli-ide-sdk-2026-10-18/summary.json)及 [CLI 原始报告](./evidence/dmm-cli-ide-sdk-2026-10-18/cli-tests.json)。CLI 新测试位于默认 Vitest unit 集合，VS Code 管理解析测试沿用 CLI parity 集合，JetBrains `PluginManagerTest` 属于已有 Gradle/JUnit 集合；Java 临时 runner 仅用于本机缺少 JDK 21 时执行相同 JUnit 测试。可复现的主要命令：

```powershell
npm.cmd --prefix packages/cli test -- __tests__/unit/plugin-goal-extension.test.js __tests__/unit/plugin-runtime-manifest.test.js __tests__/unit/plugin-runtime-capabilities.test.js __tests__/unit/plugin-runtime-capability-consent.test.js __tests__/unit/plugin-runtime-consent-enforce.test.js __tests__/unit/plugin-runtime-policy.test.js __tests__/unit/plugin-runtime-install.test.js __tests__/unit/plugin-runtime-scopes.test.js __tests__/unit/plugin-runtime-trust.test.js __tests__/unit/plugin-lifecycle-command.test.js __tests__/unit/plugin-consent-command.test.js __tests__/unit/vscode-ext-plugin-manager.test.js
# 已配置 JDK 21 与 IntelliJ 依赖的环境中：
cd packages/jetbrains-plugin
.\gradlew.bat --offline test --tests com.chainlesschain.ide.PluginManagerTest --console=plain
```

本机完整 Gradle 尝试因缺少所需 JDK 21 在编译前失败；使用已有 JDK 17 与缓存 JUnit 5 独立编译 MiniJson、PluginManager 和相同 PluginManagerTest，7 项通过，0 失败/跳过。该纯核心结果不替代插件打包或真实 IDE 旅程。ESLint 本地依赖缺失，未取得 lint 结果；Prettier 与差异检查单独记录。没有进行版本升级、发布或准确提交的远端发行验证；这些仍按原计划 OIDC 与子包→CLI→IDE 顺序执行。

下一步先把新边界接入经授权的项目服务与持久提议事务，再为 CLI/IDE 装配实际事件投影/目标面板，最后验证场景包禁用/卸载后目标与历史保留、扩权重新同意和重新安装后显式恢复。真实 Electron/IDE 旅程、独立业务效果及发行门保持未完成。

## 公共契约和加载边界

新增公共子路径：

- `@chainlesschain/session-core/scheduler-contract`
- `@chainlesschain/session-core/scheduler-service`
- `@chainlesschain/session-core/scheduler-authority-resolver`
- `@chainlesschain/session-core/scheduler-runtime`
- `@chainlesschain/session-core/scheduler-store`
- `@chainlesschain/session-core/scheduler-source-path`
- `@chainlesschain/session-core/private-storage`
- `@chainlesschain/session-core/host-storage-environment`
- `@chainlesschain/session-core/goal-contract`
- `@chainlesschain/session-core/goal-repository`
- `@chainlesschain/session-core/project-goal-service`
- `@chainlesschain/session-core/project-goal-monitoring`
- `@chainlesschain/session-core/goal-usage-ledger`
- `@chainlesschain/session-core/project-goal-workflow`
- `@chainlesschain/session-core/project-goal-completion`

[调度契约](../../../packages/session-core/lib/scheduler-contract.js)和[调度服务](../../../packages/session-core/lib/scheduler-service.js)复用原实现；CLI 原 `scheduler-kernel/contract.js` 与 `service.js` 现在是薄入口。CJS 宿主和 ESM CLI 的构造器、常量、错误实例保持一致。隔离包测试只安装公共入口及其依赖闭包，未加载 CLI 私有模块、整个 Session Core index 或原生数据库驱动。

后续切片已将 runtime、store、source-path 和文件保护实现移至 Session Core 公共 CJS 子路径，CLI 保留原 Graph、home 和原生数据库装配的兼容入口。中立 runtime 必须注入 Graph Authority，或明确选择 legacy Graph 模式；两种方式均要求实时授权回调。中立 store 必须由宿主显式提供 file、Database 和同步确认的 protectStorage；磁盘文件在打开前后均验证保护，失败时拒绝打开或关闭连接。

共享文件保护保留原有 Windows ACL 缓存、工作目录、超时、链接检查和隐藏辅助进程语义。调度账本仍校验独立的 application ID、schema version 和 catalog，不能直接放入已有项目库。首个桌面风险巡检宿主现已接入：按可信应用数据路径与数据库实路径派生独立账本，以同一原生驱动打开，退出时中止并等待后台及手动操作结算后再关闭。连接替换会锁住并排空旧宿主，再建立新宿主。

## 目标与存储行为

[目标契约](../../../packages/session-core/lib/goal-contract.js)保留 `active/paused/done/abandoned`，执行状态单独保存。记录包含权威存储标识、revision、控制代次和个人项目引用。通用修订不允许改写身份、项目绑定、存储 ID、版本、控制代次、执行状态或完成证明。

修订通过 CAS 增加 revision 和控制代次。进度为 100 不能将项目目标标为完成；完成需可信独立检查器，其证据绑定目标定义、当前版本与全部验收条件。当前桌面已安装原生业务验收检查器并暴露独立验收/完成接口，详细边界见下文。授权引用与允许动作类型只是描述，不能替代真实业务授权。

[CLI 适配器](../../../packages/cli/src/lib/goal-store.js)与既有 `cc goal` 读写同一文件。读旧文件仅产生兼容视图，不自动改写、绑定 DID、监控或项目权限；修改和可选删除 CAS 都在现有严格文件锁内检查。旧命令的明确关闭仍是人工声明，不产生核验完成证明。已核验的独立目标需先重新打开再修改；重新打开清除当前完成证明并推进控制代次。

旧版允许较长历史。无法无损放入新记录边界的 versionless 文件继续使用旧适配路径，保留全部 notes 并维护 revision/controlGeneration；暂停、进度和附注仍可使用。新格式记录不能降级进入此路径。错误、未知 schema 和 CAS 冲突不写入原文件。

[个人项目存储](../../../packages/session-core/lib/project-goal-service.js)在现有原生数据库创建 `cc_project_goal_store_meta` 和 `cc_project_goals`。每次读取/写入均从宿主解析当前 DID 并检查当前项目归属；拒绝直接组织/工作区字段以及 `organization_projects`、`workspace_resources` 关联。写入在 native immediate 事务内比较 revision 并重验身份；错误或身份变化回滚。真实 SQLite 关闭重开验证记录和存储标识持久化。

记录整体、JSON 结构、文本和分页都有上限；整体序列化上限为 64 KiB。数据损坏、元数据不一致和超限记录明确拒绝，避免出现“写入成功但读取失败”的大小边界差异。本轮没有宣称本地 SQLite 测试证明生产加密配置或真实进程崩溃恢复。

## 桌面开发接口

[项目目标 IPC](../../../desktop-app-vue/src/main/task/project-goal-ipc.js)已接入任务 IPC 初始化，使用可信来源、有效窗口和主进程当前身份。元数据、监控、建议/动作、验收及单次停止/结束跟进通道均已加入 preload 与固定 renderer 能力清单。

```js
const goal = await window.electronAPI.project.createGoal({
  projectId: "personal-project-id",
  objective: "持续关注本项目交付风险",
  acceptanceCriteria: [
    {
      id: "risk-reviewed",
      kind: "manual",
      description: "核对项目风险及处理结果",
    },
  ],
  budgetPolicy: { maxRuns: 20 },
});

const current = await window.electronAPI.project.readGoal({ id: goal.id });
const goals = await window.electronAPI.project.listGoals({
  projectId: "personal-project-id",
  limit: 20,
});

await window.electronAPI.project.reviseGoal({
  id: current.id,
  expectedRevision: current.revision,
  patch: { status: "paused" },
});
```

创建目标仍保存 `executionState: idle` 的意图，不自动开启工作。实时执行状态从监控状态接口读取，除 `waiting/running/blocked/pause-requested/paused/idle` 外，还区分结束跟进的 `end-requested/ended` 和独立完成后的 `completion-draining/completed`；目标记录本身不伪造执行状态或完成证明。

## 持久风险巡检与主进程登录态

[巡检引擎](../../../packages/session-core/lib/project-goal-monitoring.js)在项目原生库保存显式监控配置、手动请求绑定和已完成检查。风险 review、检查证据与每目标 usage 同事务提交；调度库的 occurrence 结算是独立投影。注入“项目已提交、调度结算失败”后，真实重开数据库并重新取得租约，会读取同一 review，检查次数及 principal 预留均不重复扣账。租约丢失、身份变化、期限/时间超限或保存检查失败会回滚项目 review 和检查。

手动请求绑定 goal revision、control generation 和 scheduler policy revision；新请求可绑定当前策略，历史请求保留原身份。检查结果与历史读取都重验记录摘要和授权风险证据，已成功的 scheduler 终态也不能绕过复核。每目标最多保留 1000 次有效检查/手动意图，状态展示最新 20 条；单次扫描及执行最多 50 项，以游标避免撤权记录阻塞后续目标。检查周期为 1 分钟至 7 天，离线周期合并为一次到期检查。

目标次数/时间预算与 principal 全局额度独立执行；耗尽、过期、撤权时不持续新增无效 timer 队列。当前规则不调用模型，模型 tokens/cost usage 为零。暂停目标与关闭配置在同一 CAS 事务中更新；尚有 claimed occurrence 时显示“暂停中”，待结算后才显示“已暂停”。这些检查不改业务任务，也不自动完成目标。

[专用主进程会话](../../../desktop-app-vue/src/main/task/project-goal-auth-session.js)仅从真实可信 PIN/密码登录成功 handler 建立。默认 DID 自动加载不代表登录；软件密码模式不要求 UKey；UKey 模式绑定当前驱动，锁定、拔出、驱动切换和身份变化会撤销授权。认证代次阻止延迟返回的旧 PIN 结果在锁定/退出后恢复会话。退出登录先等待主进程撤销确认，再清除界面登录态；原有明文凭据日志已移除。本批沿用既有密码校验规则，没有将其写成新密码认证系统。

[目标面板](../../../desktop-app-vue/src/renderer/components/projects/ProjectGoalMonitoringPanel.vue)已放入现有项目风险面板。支持保存目标、显式开启巡检、立即检查、暂停、重新启用、预算/授权阻塞显示、历史 review 联动和分页。超时保留本次 requestId；重试读取同一次检查。项目/身份切换会清除数据并丢弃旧响应，策略换版后允许显式刷新巡检授权。

开发调用示例（使用当前 active 目标的最新 revision）：

```js
const status = await window.electronAPI.project.startGoalMonitoring({
  id: goal.id,
  expectedRevision: goal.revision,
  intervalMs: 3_600_000,
});
const request = {
  id: goal.id,
  expectedRevision: goal.revision,
  requestId: crypto.randomUUID(),
};
const check = await window.electronAPI.project.checkGoalNow(request);
// 网络/IPC结果不确定时复用request；新的独立检查使用新的requestId。
const paused = await window.electronAPI.project.stopGoalMonitoring({
  id: goal.id,
  expectedRevision: goal.revision,
});
const current = await window.electronAPI.project.getGoalMonitoringStatus({
  id: goal.id,
});
```

## 本批受控动作与恢复

[工作流服务](../../../packages/session-core/lib/project-goal-workflow.js)在风险检查的原生事务内保存建议。语义签名排除检查时间与行更新时间；同一目标控制代次中的同一风险/动作建议只消费一次。每目标分别保留最多 500 条建议与 500 条意图，单次检查最多新增 100 条建议；容量不足明确记录省略数量，仍保存完整风险检查。准备时先持久化 requestId、参数与幂等身份，再读取当前原生版本并保存精确预览；中断后沿原请求恢复。

执行通过既有 TaskDescriptionActionService / TaskCreateActionService，严格原生确认后再次检查目标 revision/control、到期、身份、归属、风险来源和对象版本。动作变更、ActionRun、风险血缘、目标意图及 usage 在同一项目 SQLite 事务提交；关联保存失败则回滚业务写入，保留未解决的 admission。桌面窗口、来源导航、连接或身份变化均阻止旧确认。目标的允许动作列表仅作为范围上限，不能代替当前业务授权与原生确认。

[使用量账本](../../../packages/session-core/lib/goal-usage-ledger.js)共享风险检查和原生动作的次数/时间预算，并为未来模型 adapter 保存真实或未知 quantities。未知费用不能写成零；已报告实际量是不可降低的下界；终态预留不能重新用作派发许可。原生动作没有模型调用，因此 token/模型费用为零，但未知动作耗时保持 null。真实崩溃后的恢复只核查原 ActionRun 并标记未知时间，不重新确认或写入；同进程正在等待确认的操作保留活跃预留，另一进程恢复后的迟到确认失效。

新增桌面固定通道为 `project:goal-proposals`、`project:goal-intent-prepare`、`project:goal-intent-execute`、`project:goal-intent-read`，对应 preload 的 `listGoalProposals`、`prepareGoalIntent`、`executeGoalIntent`、`readGoalIntent`。执行接口只接收已持久化的 intentId，不接收 renderer 提供的审批。现有目标卡片内的[动作面板](../../../desktop-app-vue/src/renderer/components/projects/ProjectGoalActionsPanel.vue)提供范围设置、当前预览、原生确认入口、草稿恢复、未知状态和回执查询。描述修改或新建任务不修改截止时间与依赖字段；复查仍可能命中原风险，也不表示目标完成。

本批证据：[CLI 226 项](./evidence/dmm-workflow-2026-10-07/cli-tests.json)、[Desktop 158 项](./evidence/dmm-workflow-2026-10-07/desktop-tests.json)、[Renderer 67 项](./evidence/dmm-workflow-2026-10-07/renderer-tests.json)、[隔离打包 2 项](./evidence/dmm-workflow-2026-10-07/packed-host.tap)、[来源与汇总](./evidence/dmm-workflow-2026-10-07/summary.json)。汇总保存源码文件 SHA-256、宿主/依赖、场景和真实/替身边界；不将这些本地证据视为候选提交的远端发行门。

两份真实进程测试分别覆盖 [10 项巡检恢复](../../../packages/cli/__tests__/integration/project-goal-process-recovery.test.js)与 [3 项动作恢复](../../../packages/cli/__tests__/integration/project-goal-workflow-process-recovery.test.js)。父进程先独立读库确认 admission/项目结果已提交，再强制终止存活子进程；动作恢复用例在 kill 后确认 usage 仍为 reserved，证明未经过正常 catch 清理。检查计时、租约时钟和审批等待屏障是测试控制；它们不代替真实 Electron 或业务样本验收。

```powershell
# 从 packages/cli 运行；完整批次的精确选择见证据中的 cli-command.json。
node ../../node_modules/vitest/vitest.mjs run __tests__/unit/project-goal-workflow.test.js __tests__/unit/goal-usage-ledger.test.js __tests__/unit/project-goal-monitoring.test.js __tests__/integration/project-goal-process-recovery.test.js __tests__/integration/project-goal-workflow-process-recovery.test.js
```

Astra 完成真实进程用例与独立复核，已修复未知时间误报零、建议容量回滚完整检查、大风险快照摘要边界、跨目标恢复分页和持久草稿缺少继续入口的问题。npm pack 初次因沙箱外缓存写入失败，获准重跑后通过；该环境重试与业务失败分开记录。

## 最新独立验收与停止控制

[独立完成服务](../../../packages/session-core/lib/project-goal-completion.js)要求用户明确配置验收条件及类型映射，不从目标描述、模型文本、进度或调度成功推断完成。当前支持三种业务断言：`all-tasks-completed` 要求项目非空且所有当前任务均为 completed；`selected-risk-signals-cleared` 仅验证显式选择的逾期/未完成依赖信号；`all-goal-actions-resolved` 要求目标没有 draft/prepared/running 意图。取消任务、空项目、旧风险检查或未解决动作不能满足相应条件。人工条件必须通过 strict/high 原生 ApprovalGate 确认，renderer 不能提交确认结论。

配置推进目标 revision/controlGeneration，将计划绑定目标定义与条件摘要；修订后旧计划和旧人工确认失效。每次独立检查读取新的原生风险证据与目标动作成员快照；完成操作重新核验当前业务行，不复用早先通过的检查。完成 CAS、来源证据、回执、真实 verifier usage 与关闭巡检在同一原生事务提交。失败检查保存原因与实际费用/时间；`native-verifier` 与监控/动作共享预算且模型 token/cost 为零。若保存证据时跨过到期时间或超出预算，保留失败记录和真实 usage，不完成目标。

计划、人工确认、检查和来源保存于 `cc_project_goal_acceptance`，每目标有界保留。相同 requestId 读取原回执，不重做检查或再次计费；不同请求身份冲突明确拒绝。回读重新核对计划/目标绑定、源风险证据、动作成员及终态回执、逐项结果、verifier 账本与目标完成证据的 digest/version。缺少 usage、重算后与源事实不一致、或只有相同证明 ID 而版本不同均拒绝。

停止本次执行使用 `stopGoalOccurrence({id, expectedRevision, occurrenceId, expectedFence, requestId})`，项目库的停止意图持久化后，再投影到独立调度库；未来巡检保持配置。投影失败或执行仍 claimed 显示 `stop-requested`，实际结算后显示 `stopped`；已经结束显示 `already-finished` 并保留真实结果。外部恢复调度控制不能绕过项目停止意图，也不退回已经消耗的预算。`endGoalFollowUp({id, expectedRevision})` 则将目标置为 abandoned、推进版本/控制代次并关闭未来巡检；尚有执行时显示 `end-requested`，结算后显示 `ended`。两库不宣称原子提交。

新增七个固定通道：`project:goal-occurrence-stop`、`project:goal-follow-up-end`、`project:goal-acceptance-configure`、`project:goal-acceptance-status`、`project:goal-acceptance-acknowledge`、`project:goal-acceptance-check`、`project:goal-complete`。人工验收对话框显示当前目标/版本/归属及全部人工条件，并在返回后复核可信 frame/window、登录身份、数据库连接及 revision；导航、退出登录、身份切换、连接轮换或修订均拒绝旧确认。

目标卡片的[验收面板](../../../desktop-app-vue/src/renderer/components/projects/ProjectGoalAcceptancePanel.vue)提供条件配置、原生人工验收、独立检查、重新核验并完成、逐项结果/历史和原始风险证据。仅当当前完成证明可授权读取时显示验收完成。身份/版本变化丢弃迟到响应；权威读取失败清除旧证据，并清除父卡片中已失去授权的目标元数据。检查和确认结果不确定时保留 requestId；已知 revision/fence 冲突清除失效请求。

本批证据：[CLI 292 项](./evidence/dmm-acceptance-2026-10-07/cli-tests.json)、[Desktop 172 项](./evidence/dmm-acceptance-2026-10-07/desktop-tests.json)、[Renderer 79 项](./evidence/dmm-acceptance-2026-10-07/renderer-tests.json)、[隔离打包 2 项](./evidence/dmm-acceptance-2026-10-07/packed-host.tap)、[来源与汇总](./evidence/dmm-acceptance-2026-10-07/summary.json)。汇总绑定报告、源码 SHA-256、具体命令与测试/替身边界；修正命令记录中相对于 cwd 的 Vitest 路径，并保留原显示记录。测试通过后的 preload 改动仅为 Prettier 格式化，不将该后置快照写成准确提交 CI 证明。

Astra 独立复核并复测了到期边界、缺失 verifier usage 与完成证据版本绑定问题，均已修复。固定 IPC 清单验证通过（1250 个准确通道）；实际 Electron GUI、业务样本和远端候选提交验证仍未运行，不能用本地 545 项回归替代。

## 目标记忆原生基础与桌面 IPC

本批 **25 个互不重叠文件、375 项通过，0 失败、0 跳过**：目标记忆服务 29 项、既有目标/独立验收 45 项、桌面主进程 189 项、Kernel 全包 112 项（其中新增原生驱动 13 项）。与此前 545 项验收批次有重叠，不相加。记忆 renderer 面板仍在实现，本批未将其列为已验证交付，也未运行真实 Electron GUI。

[共享原生 MemoryPort](../../../packages/context-memory-kernel/lib/native-sqlite-memory-port.js)实现同步精确 read/readEvent、不可扩大作用域、逐操作可信授权、原生 immediate CAS/事件血缘及永久墓碑。使用现有 Kernel reducer/propose/decide/delete/reconcile，不复制生命周期逻辑、不依赖 CLI 私有模块。记录、事件、作用域版本及删除协调操作在现有原生连接持久化；两个独立连接的 CAS 与关闭全部句柄后的删除协调恢复已有真实 SQLite 用例。

[目标记忆服务](../../../packages/session-core/lib/project-goal-memory.js)由可信宿主派生 store/actor/project/goal 的散列 scope 和精确 sink。目标只存 `{kind,id,version}` 引用，version 绑定 revision/digest；权限由当前项目归属、目标引用和持久 grant/epoch 共同决定。用户明确事实、Agent 推断与执行备注保持分类，不把目标文本、progress 或执行状态自动写成长期事实。

输出前同步读取精确记录并检查 active/reinforced、有效期、精确 scope/sink/revision/digest，再复核当前 Goal/grant。`revalidateOutput` 不接收缓存正文，旧 envelope 不能越过身份、版本或撤权代次。修正生成 successor 并保存 supersede 事件；删除或撤权先提交读取 denial，再恢复 Kernel 清理。操作日记不复制正文，相同请求沿原身份恢复；目标修订后的孤立 candidate 可显式丢弃。已验收目标仍可做隐私清理，不伪造替代完成证明。

Astra 独立复核发现的全目标 pending/容量阻止其他记忆撤权、复用丢弃键误认另一条删除回执，以及缺失删除回执仍可回放的问题已修复并加入回归。清理身份绑定原 operation、精确 memoryId 和 discardRequestId；purged 回执复核 Kernel reconciliation 与当前墓碑 revision/digest。同步 purge target 抛错现会生成 partial 回执并保留 denial，不再跳出协调流程。

桌面新增八个固定 memory 通道及 body-free invalidation 事件；preload 提供查看/创建/修正/删除/撤权/操作查询/恢复/丢弃。宿主绑定窗口、frame URL、当前认证代次/DID 与捕获的原生连接，跨 await 变化拒绝迟到结果。固定 IPC 验证通过（1259 个准确通道）。新 Kernel driver 已登记为唯一 canonical runtime 的存储适配，目标服务登记为 capability client。

证据：[目标/验收 74 项](./evidence/dmm-memory-2026-10-07/core-tests.json)、[桌面 189 项](./evidence/dmm-memory-2026-10-07/desktop-tests.json)、[Kernel 112 项](./evidence/dmm-memory-2026-10-07/kernel-tests.tap)、[命令与来源汇总](./evidence/dmm-memory-2026-10-07/summary.json)。这是当前本地工作树快照；其中含并行组织权限调整，不能称为准确提交 CI 或发行门证据。`purged` 表示权威记录与注册在线清理目标的逻辑清理，不证明 SQLite WAL、备份或此前导出的物理擦除。持久通知、真实模型输出 adapter、实际业务效果和远端发行验证仍待完成。

## 目标记忆面板回归

[记忆面板](../../../desktop-app-vue/src/renderer/components/projects/ProjectGoalMemoryPanel.vue)已接入目标卡片，提供来源/分类/范围/版本/到期展示及显式保存、修正、撤权、两步删除、操作查询/恢复/丢弃。撤权使用 grant 版本，删除与修正使用 canonical 版本；partial 清理显示待读取回执，不标为完成。

失效事件、读取失败、到期与身份变化清除列表正文及复制到修正框的旧正文。修正结果不确定时只保留操作 ID 做恢复，不继续重发不可见的旧正文；宿主明确返回操作不存在时解锁输入，允许重新提交。记忆和操作分页均校验读取代际，旧响应与旧 finally 不覆盖新状态或提前解除 busy；翻页替换旧正文，不累积缓存。

本批 **8 个文件、99 项通过，0 失败、0 跳过**（其中新记忆面板 20 项）。证据：[Renderer](./evidence/dmm-memory-ui-2026-10-07/renderer-tests.json)、[命令与来源](./evidence/dmm-memory-ui-2026-10-07/summary.json)。Astra 独立复核并复现的迟到操作分页与操作不存在造成输入锁定均已修复。到期测试使用前进的 Date 和可控制的 window timer，避免将 Vue 事件时间戳回拨误认为产品问题。真实 Electron、通知投递及实际业务成效仍待验收；本批与原生记忆/历史界面回归不相加。

## 上一批监控验证与证据

| 验证                  | 最新结果   | 范围                                                                         |
| --------------------- | ---------- | ---------------------------------------------------------------------------- |
| CLI 21 个文件         | 408 项通过 | 目标/受控动作及共享调度器回归、44 项原生巡检、7 项授权解析、真实 Windows ACL |
| Session Core 2 个文件 | 91 项通过  | 目标与业务对象合同、独立完成证明、有界 JSON                                  |
| Desktop 7 个文件      | 144 项通过 | 19 项宿主/真实 ACL、21 项生产认证链路、38 项旧 UKey IPC 与既有安全边界       |
| Renderer 5 个文件     | 60 项通过  | 11 项目标交互、6 项退出登录、风险/任务面板和已有组件旅程                     |
| Node 打包 1 个文件    | 2 项通过   | 真实 npm pack、CJS/ESM 新公共模块及 CLI shim 身份、隔离宿主加载              |
| 固定 IPC 能力与差异   | 通过       | 固定 renderer 能力清单及 git diff --check                                    |

历史证据：[CLI](./evidence/dmm-monitoring-2026-10-07/cli-tests.json)、[Session Core](./evidence/dmm-monitoring-2026-10-07/session-core-tests.json)、[Desktop](./evidence/dmm-monitoring-2026-10-07/desktop-tests.json)、[Renderer](./evidence/dmm-monitoring-2026-10-07/renderer-tests.json)、[打包 TAP](./evidence/dmm-monitoring-2026-10-07/packed-host.tap)、[来源与汇总](./evidence/dmm-monitoring-2026-10-07/summary.json)。保留 [foundation](./evidence/dmm-foundation-2026-10-07/) 和 [neutral scheduler](./evidence/dmm-neutral-scheduler-2026-10-07/) 历史证据。

本机使用已准备的工作区依赖与 Node 22.22.2。Renderer 的 Happy DOM 位于工作区 junction，而 Vitest 实际位于 npm cache，本地通过仅重定位该现有依赖的 Node import hook 运行标准环境；额外 Pinia 安装在 Windows Temp，并以工作区 junction 提供。未改项目 dependency manifest/lockfile。正常依赖安装环境直接运行：

```powershell
# 分别从对应package目录运行：
node ../../node_modules/vitest/vitest.mjs run __tests__/unit/project-goal-monitoring.test.js
node ../node_modules/vitest/vitest.mjs run --config vitest.business-actions.config.mjs
node ../node_modules/vitest/vitest.mjs run --config vitest.business-actions-renderer.config.mjs
# 从仓库根目录运行：
node --test packages/session-core/__tests__/scheduler-host-boundary.node.cjs
node desktop-app-vue/scripts/verify-fixed-renderer-ipc.mjs
```

Astra 独立复核了调度权限、恢复和真实锁定链路；已修复旧手动 job 换版、终态证据绕过、预算耗尽持续入队、分页误报停止及 UKey 锁定仍保留 DID 的问题。本地结果不代表远端三平台发行门通过。

后续仍需交付：canonical Graph、记忆/通知、声明式扩展及场景包；同时完成实际 Electron GUI、CLI 显式导入、真实模型 adapter、真实业务样本和默认关闭/迁移/回退验收。DMM-05 下一步采用现有 Memory Kernel，由可信宿主派生 store/actor/project/goal 作用域，目标仅存版本引用；修正/删除/撤权后按记录重新授权，站内通知使用独立身份隔离的持久引用投影与语义去重，避免复用全局 localStorage 或未按 actor 过滤的旧通知查询。真实业务样本尚待用户提供项目来源与独立预期。发行时仍必须通过准确提交的三平台 CI，并遵循 OIDC 和子包→CLI→IDE 顺序；总体实施目标保持进行中。

## 持久站内通知与深链接

本批 **32 个不重叠文件、598 项测试通过，0 失败、0 跳过**：CLI 146、Desktop 231、Renderer 201、契约 18、隔离打包 2。见 [验证说明](./evidence/dmm-notifications-2026-10-07/README.md)及[源码与报告摘要](./evidence/dmm-notifications-2026-10-07/summary.json)。历史批次不与本批相加。

监控检查、预算、建议观察与通用通知引用同事务提交；相同风险推进来源而不重置已读，投影失败全部回滚。静默策略与命名时区免打扰窗口持久化；重开补投递，控制变化阻断旧待投递通知。通知列表、计数、已读及打开均复核宿主认证与源权限，未复制目标/任务/记忆正文，不自动发送 OS 通知。

两处桌面通知中心接入授权目标列表；点击重新核验来源并打开指定目标抽屉，直接读取目标 ID，不依赖列表前 20 条。策略面板显式版本保存；身份/版本失效清草稿，同设备重新登录与迟到结果已覆盖。已投递通知是历史检查提示，当前状态需重新检查；界面只展示最近 50 条。

**尚未完成**真实 Electron GUI、模型 dispatch/usage/output-time Memory 授权、CLI 显式导入与回退、canonical Graph 与其他 adapter、扩展 SDK/场景包、独立业务样本与准确候选提交发布门；原计划未删减，也未标记整体完成。
