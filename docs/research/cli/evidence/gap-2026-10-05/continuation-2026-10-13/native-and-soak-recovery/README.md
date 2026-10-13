# 正式验收续做：native 目标认证与长时实际中断

本轮修复源码为 `b395af36991c048e7de2948e5a03eab6c0adde0b`，草稿 [PR #441](https://github.com/chainlesschain/chainlesschain/pull/441)。正式全火山 v3 仍为 **NOT_RUN / 0/36 任务 / 0/9 首次安装 / 原共享 $99**；剩余额度和总账单未知，当前付费入口仍 **NOT_PAID_READY**。本轮新增 provider 调用为 **0**，没有发布或合并。

## Windows 原运行实际失败

冻结 `.99` 源码 `311e01a5ec34a8e433c7abde0e4b6b05bce4513b` 的 Windows PID 13412 已退出。原已发布报告仍写着 `running`，最后检查点是 `2026-10-13T12:01:37.605Z`，不能据此断言进程仍在运行。

原 `live-report.json.13412.tmp` 保留真实未发布的 **failed** 报告：检查点 `12:02:16.291Z`，完成时间 `12:02:16.341Z`，持续 **24316.467 秒，约 6h45m16s**。原检查点替换遭遇 `EPERM rename`，随后失败报告替换也遭遇同一错误。原件 SHA-256 为 `e9eb4c96f6f229107a2f60dab1e62c0caa70ba3eb215e78d78c1e79be494dee7`。这条运行没有达到 8h 或 24h；文件被哪个读取者或系统组件占用尚未确认。

Windows 原观察段在 `06:22:58.670Z` 拒绝；第二段在 `07:12:25.523Z` 拒绝，保存了 PowerShell 身份查询的 `ETIMEDOUT`，15 秒参数对应实际约 24 秒退出。两个失败及空档均保留。Astra 随后的查询返回 Win32 87，确认该时点目标 PID 已不存在；没有证据支持把它归因为 `SYNCHRONIZE` 权限不足。

## 修复与独立复核

- 生产者与观察器共享原子 JSON 写入助手。仅 Windows 的 `EPERM/EACCES/EBUSY` 进行固定 20/40/80/160/320ms 重试，总睡眠上限 620ms。始终重试同一完整临时文件，保留旧目标；永久失败保留各次唯一临时文件。二次报告发布失败不会覆盖原异常。
- 新原生进程查询器通过同一持有 HANDLE 读取创建时间、可执行文件、命令和前后存活状态，保留旧身份元组及 15 秒查询期限。源码和二进制按字节 pin，不调用 CIM；没有扩大任何沙箱或 durable 权限。
- 显式新观察段与恢复校验来源、依赖和查询器 pin。递归原字节档案、原拒绝、未观测前缀与空档继续保留；首次取证就失败也不会虚构一次成功观察。

Astra 的准确源码复审结论为 **ACCEPTED_FOR_SUPPLEMENTARY_ENGINEERING_OBSERVATION**，`reviewerKind=AI / independentHumanReview=false`。独立负控确认二次发布失败保留原异常、依赖变化拒绝恢复；独立真实 Windows 文件占用测试也通过。

最终 Node **22.12.0** 回归为 **Windows 78/78、Ubuntu/WSL Linux 76/76，零 skip**，测试前后源码摘要一致。Windows 额外执行真实文件共享锁替换、真实子进程身份与退出后的拒绝。原默认 TEMP 的 sandbox 失败、WSL 访问拒绝，以及使用 `Start-Sleep` 的初版锁夹具失败原件全部保存；随后明确使用工作区 TEMP、授权访问 WSL，并用 `Thread.Sleep(200)` 固定夹具的实际持锁时间，生产重试上限没有增加。

## 完整 native review 的准确范围

已修复一个真实预检缺陷：原 `bindings.matrix` 未认证，修改 Windows 的 OS/Node 元数据可以消除不匹配提示，而 plan/comparison 摘要仍通过。现在要求唯一、不重叠的目标匹配，并认证完整环境摘要及 provider/platform/arch/node。

新的[只读预检](../../../../../../../packages/cli/scripts/verify01-native-preflight.mjs)覆盖实际 v3 **Windows 12 项与 macOS 12 项**，绑定冻结源码、评审实现和基线 guard 身份；九次首次旅程保持 `NOT_ASSESSED`。这没有执行 native checker 或创建 observations，完整 review 仍 **NOT_ADMITTED**。

- macOS `verify-17` 的唯一 journal 基线整体跳过，冻结实现本身也拒绝非 Linux 平台；删除 skip 无法补齐实现。
- Windows `verify-21` 有一个准确已知的部分基线 skip。**当前** parser 在 `baseline=true` 时允许部分 pending，同时要求实际 passed、无 failed/todo；全部 pending 仍拒绝。candidate/mutant 的 no-skip 要求保持。历史冻结生成器必须按各自摘要辨别，不能笼统说当前所有基线都禁止 skip。
- macOS `verify-16` 的 Windows 专属 skip 条件不触发。无静态 guard 仅表示未发现这一类静态障碍，不证明导入、setup 或沙箱执行通过。

受保护 storage broker、journal/CAS/flush/crash recovery、真实完整工具链与 baseline/candidate/mutant/进程结算仍缺。既有 owner-canary 只读 RPC、普通宿主测试与本轮预检都不能代替这些条件。

## 当前两条工程观察

实际进程身份回读时点 `2026-10-13T12:45:32Z`：

| 运行                                  | 源码 / 起点                       | 实际状态                              | 当时持续 / 循环 |
| ------------------------------------- | --------------------------------- | ------------------------------------- | --------------- |
| 新 Windows 10 / Node 22.12            | b395 / `2026-10-13T12:42:53.830Z` | workload running、observer MONITORING | 152 秒 / 153    |
| 原 Ubuntu 24.04.3 / WSL1 / Node 22.12 | 311e / `2026-10-13T05:20:39.076Z` | workload running、observer MONITORING | 26681 秒 / 7210 |

新 Windows PID **24616**、observer PID **5828**；原 Linux PID **8**、Windows wrapper **9148**、observer **28616**。新 Windows 在准确、干净的独立 b395 工作树完成真实 smoke 后才启动，运行字节与已审阅、测试字节一致。旧 Windows 失败运行的持续时间没有接入新运行。

预计里程碑仅用于安排回读，不能代替实际回执：Linux 8h 为北京时间 **10 月 13 日 21:20**，24h 为 **10 月 14 日 13:20**；新 Windows 8h 为 **10 月 14 日 04:42**，24h 为 **10 月 14 日 20:42**。

双方回读时丢失消息、重复效果和不变量违例均为 0。`monitoringCompleteFromLaunch=false`，新 Windows 的未观测前缀约 3.605 秒，Linux 保留旧前缀及约 190 秒空档；均为 `qualifyingEvidence=false / formalHostAcceptance=false`。这是本地组件工程观察，实际九个公开 CLI/IDE 入口、目标硬件 SLO、辅助技术和正式长时验收仍需独立回执。

后续原件保留在 `.work/verify01-windows-long-repair-20261013` 与 `.work/verify01-linux-long-observation-20261013`。到期需读取实际报告、进程/来源、里程碑原字节，并调用对应冻结 producer 的完成 validator；当前归档只是运行中快照。

## 正式 collection 与原件

准确 v3 计划和 72 脚本 review 校验通过，`reviewValidated=true`；collection 实际退出 **2 / INSUFFICIENT_EVIDENCE**，仍 0/36 与 0/9。历史第二轮诊断的 13 次火山请求、约 ¥0.2478572 token-only 估算和实际失败候选另保留；账单未知，这不是本轮新调用或正式样本。

[summary.json](./summary.json)、[manifest.json](./manifest.json)和[validation.json](./validation.json)保存 113 份原件映射与压缩/解压双摘要。原件数量不是测试或正式样本数量。准确提交的 Actions 结果另补；本机测试和 queued/running 作业不构成完整 CI 或发布通过。真实目标宿主、账户费用/FX/历史 lineage/全出口控制及完整 native 后端仍需落实。
