# CLI 0.166.95 配对发布验证

候选为 CLI `0.166.95`、VS Code `0.37.140`、JetBrains `0.4.158`。用户已授权功能测试通过后发布；当前尚未发布。子 npm 包源码和精确版本无变化，仍要求公开可获取性、依赖与既有 tarball 校验。

## 第一次完整候选验证与修复

准确候选 `d4b936395ee40726bff956fd3adfd4f01ff24e77` 的 [CLI CI](https://github.com/chainlesschain/chainlesschain/actions/runs/37912153625) 失败：Windows unit shard 3 的并发 scoped permission 用例在两秒锁期限内遇到存活持有者，返回明确 `not-committed` 的 `STATE_LOCK_UNAVAILABLE`；Windows verify-cli 被跳过，PM 三平台汇总因缺项失败。没有用其他平台或旧提交的成功替代缺项。

测试 fixture 仅对明确未提交、仍存活锁持有者的争用做最多五次、十秒预算内的重试；未知提交状态和其他错误立即失败。生产两秒锁期限未改变，四个真实子进程的唯一 ID、generation 4→8 和四项 revoked 断言全部保留。所有子进程结束后才清理。定向 14/14 通过，另有强制四进程先超时再成功的真实诊断。

[IDE Extensions](https://github.com/chainlesschain/chainlesschain/actions/runs/37912152479) 三平台浏览器旅程均在生成报告前因完整 Git diff 超过 64 MiB 同步缓冲而 `ENOBUFS`；原运行没有 browser evidence artifact。修复为对同一完整二进制 diff 流式 SHA256，保留所有字节、参数、非零退出和 signal 的失败语义。超过 64 MiB 且含末尾标记、部分输出后失败及无法启动的回归连同既有合同共 15/15 通过。

桌面 [E2E Linux](https://github.com/chainlesschain/chainlesschain/actions/runs/37912152844) 和 [PM error/performance](https://github.com/chainlesschain/chainlesschain/actions/runs/37912152813) 在测试开始前因 Playwright 自动拼接整个 Git patch 触发 `RangeError: Invalid string length`。根配置关闭可选 HTML 报告 diff 附件，保留 CI 提交元数据和全部测试。3 项 smoke、35 项 error/performance 测试收集通过；这只是配置验证，完整功能测试仍由新提交 Actions 验证。

此候选 Strict 五个 job、质量安全、常规与全套自动化已通过，仍不能据此发布失败的 CLI/IDE 候选。原件、API 元数据、JUnit、诊断及摘要见 [首次候选证据清单](./prepublish-attempt1/manifest.json)。它们保留原候选身份，后续修复必须取得自己的准确提交完整矩阵。

VERIFY01 PR 的 macOS JetBrains 在实际 IDE 启动时退出，随后 artifact 上传因 DNS `ENOTFOUND` 失败；缺少 IDE 日志，不能给首次退出编造网络或合同根因。该 PR 实际检出 merge `b26d7135c25592fd17c8ae8cc25765cdb867df33`，push 才检出候选 head，后者的三项 macOS 旅程与上传已成功。可读取日志是 gh 呈现内容；原始日志 API 的 403 拒绝另存，未把呈现日志冒充原始日志。见 [VERIFY01 补充清单](./prepublish-attempt1/verify01-manifest.json)；新提交仍需重新验证。

正式 36 tasks + 9 firstRuns、冻结反例矩阵、预算与 observations 未改。原生完整 review、Windows/macOS durable authority、受保护 journal/服务重启、WFP、账户账单、人工与长时验收保持开放；发布不授予这些验收。
