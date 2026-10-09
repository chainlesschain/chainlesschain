# CLI 0.166.95 配对发布验证

候选为 CLI `0.166.95`、VS Code `0.37.140`、JetBrains `0.4.158`。用户已授权功能测试通过后发布；当前尚未发布。子 npm 包源码和精确版本无变化，仍要求公开可获取性、依赖与既有 tarball 校验。

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
