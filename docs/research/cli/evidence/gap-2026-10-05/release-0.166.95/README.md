# CLI 0.166.95 配对发布验证

## 2026-10-10 完整验证后发布受阻

CLI `0.166.95` 的准确提交 `3caf14f2ee866335608487ab57add325972709d7` 已取得 CLI CI **71/71**、Strict **5/5**、IDE **18 成功 / 1 条件跳过**及 ARM64 **10/10**。但 OIDC 发布 run `37985598206` 在 Agent SDK `0.2.13` 的整个源码树复用检查失败，CLI 发布步骤明确跳过；它没有成为新公开 CLI。SDK 的签名来源校验通过，实际改变的是测试诊断文件，公开 tarball 字节一致的预检不足以证明整个 Git 子树未变。

新候选为 Agent SDK `0.2.14`、CLI `0.166.96`、VS Code `0.37.140`、JetBrains `0.4.158`。两端 IDE 尚未发布，因此保留插件版本并将推荐 CLI 改为 `.96`；SDK 与锁文件升级，VS Code/Desktop 生成标记同步，SDK 运行时输出摘要未变。保留 `.95` 原标签和失败原件，不移动标签、不削弱复用门。新提交必须重新完成自身的三平台完整矩阵，再按 SDK → CLI → IDE → 合并顺序发行。当前没有发布新版本。

[发布失败原件](./npm-publish-failure/manifest.json)与[已验证源码原件](./validated-source-3caf/manifest.json)保留实际来源。此前“子包源码无变化”的前置判断漏掉了 SDK 测试树变化，已由严格发布门拒绝；不能据 tarball 一致复用该版本。

正式 36 tasks + 9 firstRuns 保持 `NOT_RUN`，完整 native review 保持 `NOT_ADMITTED`；冻结源码、配置、分母、$99、observations 以及 Windows/macOS durable、账户账单、独立人工和长时验收状态不变。

以下为原候选诊断历史，未改写原失败结果。

## 第六候选：Windows 2025.2 审批控件与布局

准确候选 `8e538362109dbe0bf455d4f72dcab865962e668c` 的 ARM64 完整门 **10/10** 成功，包括此前失败的 Windows JetBrains 2026.2.0.1 恢复菜单旅程；但 IDE Extensions run `37958205583` 的 Windows 2025.2 job `113925289634` 在 `Approve Once` 控件查找上超过原 **45 秒**。真实 UI **7 通过 / 1 失败**，整体 IDE 为 **16 success / 1 failure / 2 skip**；不能用 ARM64 成功替代该失败。原日志 **128202 bytes**、SHA256 `bd1eb10a33a3e325e82dd8a492e36339b47587c6f2747446cef3efbd27da3700`；[第六候选原件](./prepublish-attempt6/manifest.json)保留完整失败与局部成功门的各自来源。

artifact `11632252463` 的公开元数据、ZIP digest、原 journey **28/28** 文件及两项聚合 digest 均已核对。协议证实同一 CLI 进程接收权限消息、确认接受并输出审批请求，没有审批响应；截图没有审批卡。stdout.write 和原协议记录不能证明 IDE 已消费该事件。此失败尚未执行新 popup helper；缺少原现场 DOM、host 收包/render 与 idea.log，发送保护、Vulkan、卡片清理/布局等机制都不能据此认定为原 CI 根因。

独立真实 Swing/EDT 合同证明现有 card viewport 结构的一项布局缺陷：仅验证滚动窗格内层，新增卡的 preferred height 已增长但实际 viewport 保留零高度；验证外层布局后按钮可见。新增 `ChatCardsLayout.refresh` 在八处卡片增删后验证外层区域；实际 helper 的两个合同覆盖卡显示、真实单次按钮回调、删除后的空间回收及多卡下 composer 可见。调度由无窗口合同控制，未复现原 CI。默认关闭的元数据观察记录 receive/map/EDT/render/card 边界与原异常；显式宿主诊断保留完整 IDE 日志、轮转及事件 trace 原字节，缺失单独标记，不改变原功能结果或重试条件。失败组件树仅作读取，ownerCount=0 不代表成功捕获 conversation。

本机 UI 编译、Java 全套 **952 通过 / 3 原有 POSIX 跳过**、smoke **1445/1445**，原首轮 headful peer 初始化失败与 headless 修正分别保留；真实 IDE 的 uiSmokeTest JVM 未设 headless。事件观察合同 **4/4**、driver **13/13**、实际编译脚本 Rhino/Swing 合同 **6/6**；旧节点上限漏标 truncated 的失败也留存。真实收录链路完整保留 **757780 bytes trace** 与 **300004 bytes idea.log** 合同输入，不能冒充原 CI 现场日志。所有本地合同不相加为正式样本，新提交仍须完整门。当前版本尚未发布，正式 36+9、冻结 review 及独立平台/账单/人工/长时验收状态不变。

## 第五候选：Windows Git 检出与归档路径

准确候选 `9f4df1157e493daaee137655c4e1d37c066c50e8` 的 CLI CI Windows unit shard 2 job `113911369726` 在 checkout 阶段失败；日志明确六份新增 receipt 的 **236 字符相对路径**触发 `Filename too long`。ARM64 Windows 与其他 Windows job 也在 checkout 失败，后续报告缺失是未执行测试的后果，尚无 SDK 或新 UI 旅程结果。[第五候选原件](./prepublish-attempt5/manifest.json)保存准确提交 API、checkout 日志及独立 annotations；原日志 SHA256 `40d103ac38bd72468cd439103dac77672093c1a264e17b6a10d460f2b028712f`。矩阵快照未完成，不是成功门。

只将六份归档 basename 缩为 `011-receipt.json` 至 `016-receipt.json`；72 份原件全部字节与 source/hash 不变，attempt4 最长相对路径降为 **202 字符**。更新的 attempt4 manifest 明确记录原路径到归档路径映射，原 journey manifest 未修改；映射归档不再冒称原 artifact 提取树。旧 attempt4 manifest 原字节另存第五候选，保留前后出处。UI 测试源码与已编译脚本未改；修正后的新提交仍须完整准确 SHA 门，尚未发布。

独立路径审阅按实际 Windows runner 的 34 字符 checkout root 核对，最长绝对路径为 **237 字符**；六份 receipt 降为 **185 字符**。原 archive-tools 生成脚本作为原件不改，重建当前映射归档需再应用第五候选的缩名脚本及外层 `archivePathMapping`，不能直接用原 journey manifest 的相对路径解析重命名后的文件。

## 第四候选：Windows ARM64 JetBrains 弹窗过渡

准确候选 `a3f3ed3dd1fb809fb7fd520ad5a35616ae64bb3b` 的 [IDE ARM64 Host Validation #37947977140](https://github.com/chainlesschain/chainlesschain/actions/runs/37947977140)，Windows ARM64 JetBrains **2026.2.0.1** job `113880537429` 为 **7 通过 / 1 失败**：`Restore code + conversation` 动作菜单在原 **45 秒**内未出现。前两轮单独恢复代码、对话已完成匹配的 preview/confirm；第三轮 timeline 返回并激活 `partial turn-2` 后没有 restore-both 请求。失败位于时间线选中到动作菜单过渡，不能称已执行的恢复逻辑失败，也未确认 popup 被取消、焦点或 WSL updater 的因果关系。[第四候选原件](./prepublish-attempt4/manifest.json)保留 API、日志、JUnit、协议与关键截图；原日志 SHA256 `f79aae2aa80b9f49bb586dab677027fe09cbae044208cc986e74f936f5a27804`。该提交的其他成功门不能替代此失败宿主门。

IDEA build `262.8665.337` 的官方源码确认 Enter 在父 popup 清理并等待焦点稳定后才调用选中回调，未修改生产 `showTimelineActions`。测试驱动在同一个 deferred EDT runnable 内复核 showing、唯一目标，再选择并执行真实 Enter；IIFE 捕获原组件与目标，记录 `scheduled/entered/validated/dispatch-returned/failed`、可见性与焦点。原 **45 秒**预算和真实下一菜单、匹配 preview、confirm、完成文本断言保持，无 retry；Enter 返回且旧 popup 隐藏只完成这一调度步骤，不代表选中回调完成。

JDK **21.0.12.1** 下 `compileUiTestJava` 编译通过。Astra 以真实已编译方法导出的脚本在 Rhino **1.7.15**、Swing JList/Enter Action 和真实 EDT 下验证 [10/10 调度合同](./prepublish-attempt4/popup-contract/report.json)，仅 IDE 队列与 showing 为替身；没有真实 GUI/CI，也未复现原失败。审阅发现 Java 泛型 `callJs` 的 `String.valueOf` 误选 `char[]` 重载，已用显式 `(Object)` 修正；[最新字节码回读](./prepublish-attempt4/popup-contract/review-resolution.json)确认 Object 重载，生成脚本摘要与已通过合同逐字节相同。修正后的准确提交仍须完整发布矩阵。

## 第三候选：桌面原生恢复功能预算

候选 `a3cbe918e4f8fcda77dafa7514401d5f643b36df` 的 Windows CI Tests job `113865516304` 在 `project-goal-monitoring-host.test.js` 的恢复用例报默认 **5000ms** 超时，报告用时 **8073ms**；该边界 suite **230/231**。selector/fallback 后续未执行，其强制汇总正确失败。真实日志、部分矩阵快照和本地诊断见[第三候选原件](./prepublish-attempt3/manifest.json)，日志 SHA256 `0a6f0a39c9f07beb95e570cc5351a42580d1309002ca6d165917b10794a764a5`。当时 CLI/Strict/IDE 仍未完成，不能称该 SHA 完整通过。

Astra 确认此用例注入权限 protector，不运行 SDK 的真实 Windows ACL 子进程。engine close 先 abort 后 drain，service sleep 在 abort 时取消定时器，没有必需五秒等待；原日志无 `SQLITE_BUSY`，不能据超时认定挂起或锁争用。匹配 CI 堆栈的 Vitest runner 会在 promise 完成后检查超期，同步数据库工作也可能触发这个错误，慢 I/O 仍未确认。

只对原恢复用例显式设 **30_000ms** 功能预算，原生 SQLite、全部业务断言与生产锁/ACL/生命周期期限保持，无 retry；各阶段进入/完成及总时间使用 `performance.now()`。本机完整宿主文件 **20/20、32.25秒**；独立计时只选原恢复用例 **1 通过 / 19 未选择**，原始 stdout 显示 body **164.49ms**、old close **3.70ms**，没有复现 CI 超期。本机 Vitest **4.1.10** 与 CI **4.1.11** 的差异保留。首次本机缺 SQLite binding、修复官方预编译包及首次计时脚本路径错误分别记载，不归因于原 CI。新提交必须取得自己的完整门。

## 第二候选：SDK 初始化前退出（历史）

准确提交 `43eb29d1f72697d849b6f1aed573fd044ad9da9b` 的 [CLI CI #37929591872](https://github.com/chainlesschain/chainlesschain/actions/runs/37929591872) 为 **69 success / 2 failure**。Windows verify-cli 的 Agent SDK `0.2.13` 测试 **82 通过 / 1 失败**，真实 sibling CLI 在 init 前以 code 1 退出，用时 16.066 秒。SDK fixture 虽收集 stderr，启动等待却位于原诊断 catch 之外；因此当前日志不足以确认根因。默认 ACL 15 秒与用时接近只是线索，未据此改变期限或称基础设施失败。

后续四个上传步骤报 `No files found`，相应生成步骤因 SDK 失败未执行；这不是网络上传故障。Windows PM recovery artifact `11620769736` 已上传，PM 汇总因完整父 job 门失败拒绝。原始 API、失败日志及已成功 Windows unit shard 3 日志见[第二候选清单](./prepublish-attempt2/manifest.json)，两个原日志 SHA256 分别为 `fa3a2871b4edbd3906b5d239208dc558bead58af3f97805b7fb3c251d04f5626`、`9623123547d869421b21e9ed3f9c18e74b93ad787e0ab1c2bd1ac7500678e27e`。

此准确提交的 Strict **5/5**、IDE Extensions **18 成功 / 1 非标签 Marketplace 后验证跳过**、质量安全、模型审查、PR Tests、CI Tests、Full Test Automation 与 IDE Roadmap Safety Matrix 全部结束且成功，原始回读均归档。它们不能替代失败 CLI CI，也不能转移到下个提交。

本机 Windows 原 SDK E2E **1/1**，用时 135.73 秒，真实文件写入、审批及 resume 断言通过；补诊断后的全部 SDK **83/83、9 文件**通过，用时 128.87 秒，均未复现 hosted runner 原退出。当前补丁只对测试首次 init、各结果和 resume 等待添加独立 stderr/events/phase/cause；spawn error 也立即拒绝并清理监听器。SDK runtime、发布版本、180 秒用例期限、ACL 期限、全部业务断言和 sandbox 选择不变，不自动重试。退出时管道可能未完全排空，诊断明确只报告失败前观察到的内容。新提交须取得自己的完整发布门。

### 独立诊断合同

Astra 对实际 fixture helper 的[独立诊断合同](./sdk-startup-diagnostics/run2/report.json) **3/3** 通过：first/resume 真实 Node 子进程退出 1 的各自 stderr/events 不串线、phase 与 cause 保留，真实 OS spawn ENOENT 立即拒绝，三条路径的临时 init/exit/error listeners 均归零。报告明确 `originalCiFailureReproduced:false`；首次诊断 harness 对 Windows cmd shim 的错误假设和修正原件也保留，不能冒称原 CI 根因已复现。helper 与实际 SDK 源码摘要已独立回读；[诊断清单](./sdk-startup-diagnostics/manifest.json)保持原字节。

## 第一次完整候选验证与修复（历史）

准确候选 `d4b936395ee40726bff956fd3adfd4f01ff24e77` 的 [CLI CI](https://github.com/chainlesschain/chainlesschain/actions/runs/37912153625) 失败：Windows unit shard 3 的并发 scoped permission 用例在两秒锁期限内遇到存活持有者，返回明确 `not-committed` 的 `STATE_LOCK_UNAVAILABLE`；Windows verify-cli 被跳过，PM 三平台汇总因缺项失败。没有用其他平台或旧提交的成功替代缺项。

测试 fixture 仅对明确未提交、仍存活锁持有者的争用做最多五次、十秒预算内的重试；未知提交状态和其他错误立即失败。生产两秒锁期限未改变，四个真实子进程的唯一 ID、generation 4→8 和四项 revoked 断言全部保留。所有子进程结束后才清理。定向 14/14 通过，另有强制四进程先超时再成功的真实诊断。

[IDE Extensions](https://github.com/chainlesschain/chainlesschain/actions/runs/37912152479) 三平台浏览器旅程均在生成报告前因完整 Git diff 超过 64 MiB 同步缓冲而 `ENOBUFS`；原运行没有 browser evidence artifact。修复为对同一完整二进制 diff 流式 SHA256，保留所有字节、参数、非零退出和 signal 的失败语义。超过 64 MiB 且含末尾标记、部分输出后失败及无法启动的回归连同既有合同共 15/15 通过。

桌面 [E2E Linux](https://github.com/chainlesschain/chainlesschain/actions/runs/37912152844) 和 [PM error/performance](https://github.com/chainlesschain/chainlesschain/actions/runs/37912152813) 在测试开始前因 Playwright 自动拼接整个 Git patch 触发 `RangeError: Invalid string length`。根配置关闭可选 HTML 报告 diff 附件，保留 CI 提交元数据和全部测试。3 项 smoke、35 项 error/performance 测试收集通过；这只是配置验证，完整功能测试仍由新提交 Actions 验证。

此候选 Strict 五个 job、质量安全、常规与全套自动化已通过，仍不能据此发布失败的 CLI/IDE 候选。原件、API 元数据、JUnit、诊断及摘要见 [首次候选证据清单](./prepublish-attempt1/manifest.json)。它们保留原候选身份，后续修复必须取得自己的准确提交完整矩阵。

VERIFY01 PR 的 macOS JetBrains 在实际 IDE 启动时退出，随后 artifact 上传因 DNS `ENOTFOUND` 失败；缺少 IDE 日志，不能给首次退出编造网络或合同根因。该 PR 实际检出 merge `b26d7135c25592fd17c8ae8cc25765cdb867df33`，push 才检出候选 head，后者的三项 macOS 旅程与上传已成功。可读取日志是 gh 呈现内容；原始日志 API 的 403 拒绝另存，未把呈现日志冒充原始日志。见 [VERIFY01 补充清单](./prepublish-attempt1/verify01-manifest.json)；新提交仍需重新验证。

正式 36 tasks + 9 firstRuns、冻结反例矩阵、预算与 observations 未改。原生完整 review、Windows/macOS durable authority、受保护 journal/服务重启、WFP、账户账单、人工与长时验收保持开放；发布不授予这些验收。
