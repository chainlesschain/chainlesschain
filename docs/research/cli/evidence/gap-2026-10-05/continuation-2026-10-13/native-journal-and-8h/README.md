# native 实际日志验证与 Linux 8 小时原件

正式全火山 v3 保持 **NOT_RUN / 0/36 / 0/9 / NOT_PAID_READY**，原共享上限 **$99**，实际剩余预算未知。本记录没有新增 provider 调用、正式 observations、发行或合并。Astra 与根代理均为 AI 审阅者，不记为人工评审。

本归档追加较新的事实，保留[此前 12:45 UTC 快照](../native-and-soak-recovery/README.md)。原件及哈希见 [manifest.json](./manifest.json)，结论与范围见 [summary.json](./summary.json)。316 个原件映射不是测试数或正式样本数。

## 已实际验证的 native 范围

新的 Windows scratch 原型保留原 owner-only 两对象、actor 原进程 HANDLE、Job/token 身份检查、九个继承句柄和直接路径拒绝。actor 不获得目标对象 HANDLE。主机仅以 `131205` 打开固定文件，包括 `APPEND_DATA`，不含 `WRITE_DATA` 或 `GENERIC_WRITE`。

实际协议支持序列、预期 generation、完整文件摘要、16 字节 operation ID、最多 64 字节 payload；执行追加、`FlushFileBuffers`、完整链扫描和身份回读后才发送成功回执。

| build004 实际场景 | 请求 | 提交 | 幂等回执 | 拒绝 | 只读重开                    |
| ----------------- | ---: | ---: | -------: | ---: | --------------------------- |
| clean             |   17 |    2 |        3 |   12 | exit0，352 字节完整链       |
| partial           |   17 |    1 |        1 |   15 | exit2，268 字节部分尾被拒绝 |

两个场景各观察到两次 flush API 成功；partial 的第二次写入只有 84 字节，随后状态中毒，不发送成功回执。部分文件逐字节等于 clean 文件前 268 字节。两个 actor 的六种直接对象操作均返回 Win32 `5`；actor exit0、Job active processes=0、profile 删除、目标 ACL 与身份保持、loopback exemption 不存在、宿主盘符映射未改变。

根代理独立读取原件，重算 28 份运行 artifacts 及每个场景 27 份源码/二进制 pin，并逐项检查回执。Astra 另核对复制文件、phase 身份及原始链字节。Node 22.12.0 实际加载 native addon，不把 22.22 headers 的存在当成 ABI 验证。

首次 build003 clean 虽有 17 个实际协议响应、两次 flush、两次提交，broker 仍因关闭管道竞态以 `109 / exit2` 失败；缺少最终 ACL 和只读重开，原失败完整保留。build004 只为 `ERROR_BROKEN_PIPE`、空待处理帧且原 caller HANDLE 在三秒内真实退出的情况继续原有退出结算；其他错误与超时仍拒绝。

**完整 native review 仍未完成：`NOT_ADMITTED / durable=false`。** 上述部分尾是受控故障，未执行真实进程崩溃、断电或跨 supervisor 重启。完整冻结工具链、baseline/candidate/mutant、连续权限和 macOS 后端尚缺。归档中的下一阶段 crash/restart 文件只是设计，不能计为执行回执。

## 长时任务的最新实际事实

Linux 原 `.99` 冻结源码 `311e01a5ec34a8e433c7abde0e4b6b05bce4513b` 在 `2026-10-13T13:20:52.755Z` 保存实际 **28813.414 秒**检查点，7851 个循环；观察器随后记录 8h。原始字节 SHA-256 为 `6df0741868406ca2cd761b049ddce240c59f89ac45dbd0f3f8d1d54e1d1fa51f`。根代理按原 metadata 的观察时间验证历史摘要、来源、计数与时长，没有用当前进程查询虚构历史存活证明。

`13:56:37 UTC` 实际回读确认 Linux 原进程身份匹配，当前检查点时长约 **8h35m47s**、8395 循环，仍 running，observer MONITORING，零消息丢失、重复效果或不变式违例。24h 尚未到达；预计回读时点为北京时间 **10 月 14 日 13:20**，届时必须验证真正最终报告。原 809.555 秒未观测前缀及约 190 秒空档保留，`qualifyingEvidence=false / formalHostAcceptance=false`。这不是九个公开 CLI/IDE 入口的长期验收。

Windows b395 修复任务 PID 24616 已退出。最后已发布检查点 `12:50:00.378Z`、426.439 秒、421 循环；observer 于 `12:51:05.061Z` 通过原生查询报告目标已不存活。旧文件中的 `running` 是陈旧状态，之前预计的 8h/24h 时点失效，不能继续累加。退出码和准确退出时间未知。

同一时段 Windows resource-exhaustion 事件 2004 显示 commit charge 为 limit 的约 99.79%，一个 PowerShell 进程使用约 40.2 GiB。原 XML 保留，但这仅是时间相关证据，不能证明它杀死了 Node。

两个固定无网络 heartbeat 启动试验均失败、无心跳，没有启动新长时 workload。第二次通过保留的 HANDLE 取得真实 exit1 和退出时间。Node 22.12 上游 libuv 源码显示首次非 detached `spawn` 会把 Node 父进程加入其私有 Job；试验先调用 `spawnSync` 证明器再要求“任何 Job 都没有”，存在自触发断言问题。不能把 Job membership=true 推断成工具安全机制重新纳管，也不能用该发现解释历史 workload 退出。后续外部原生监视器尚需独立试验。

## 正式费用与 CI

预算代理的生产 authority/transport loopback 原型，Astra 与根代理各运行一次 **14/14** 实际 HTTP 测试；根代理使用 Node 22.12.0、SQLite 12.1.0。认证、流式终态、并发、重试、未知费用、撤销、存储故障均通过；真实子进程反例同时证明环境变量过滤无法约束全部网络出口。此处尚未运行冻结公开 `.99` 的完整产品路径。

只读费用核对选定 161 份 artifacts，得到 40 个去重 provider 身份及 96 个单独未关联的 CLI usage 事件，不相加。最新 13 次原始调用的 **CNY 0.2478572** 只是公开常规价 token-only 条件估算；账户账单、美元换算、总谱系费用与剩余额度仍未知。核对工具现有 10/10 测试使用 Node 22.22.2，原始输出保存。

生产契约不强制 provider 硬配额，也不必一律使用发票；可信账户计费上限、含费用的结算汇率上限及完整历史核销仍需成立。实际 OS 强制、持有凭据的全出口计量可以作为本地上限控制。当前 authority 对任意历史 `unknown=true` 全局停止；保守预留并不自动解除停止，未清空历史或将估算伪装为实际支出。

`2026-10-13T14:04:57Z` 精确 head `46befbda9de2eeec816ae79657b46cfc39fcd1cc` 的 Strict Sandbox、Reliability Soak、Host Diagnostics 全部成功；CLI CI 有 47 个成功、4 个运行中、14 个排队，无当时已知失败。保留完整 API 原件，**不记作完整矩阵通过**。后续证据提交也不能借用旧 head 的 checks 获得发行资格。

原始 gzip 档案可独立校验：

```powershell
node docs/research/cli/evidence/gap-2026-10-05/continuation-2026-10-13/native-journal-and-8h/verify-archive.mjs
```
