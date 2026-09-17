# RSIAgent 第八次工程实施：存储与 authority 故障关闭

> 日期：2026-09-17（Asia/Shanghai）<br>
> 前置实施：[第七次三系统精确 SHA 恢复门禁](./rsiagent-seventh-batch-implementation-2026-09-17.md)<br>
> 实施基线：`5142f6744220e1ff7af68214e066a8f62b18e02e`；本文记录未提交工作树，不代表已发布版本。<br>
> 状态：恢复演练已扩展为 31 个独立子进程，验证本地产物只读、authority 超时/断连/无效回执以及 witness 前后 `ENOSPC` 的提交语义；同时修复 PM Ledger-retained artifact 在 authority 不可用时错误回退本地缓存的问题。

本文的“第八次”只表示工程交付次序。所有新增故障均为确定性测试注入，不是真实只读挂载、真实磁盘耗尽、远端服务或物理断电测试。

## 1. 审计发现与修复

[durable artifact resolver](../packages/cli/src/lib/evolution/evolution-ledger-ports.js)的注释和设计合同要求 Ledger-retained subject 必须从可信 durability authority 解析，本地 ArtifactPorts 只作为交叉校验与缓存。

第八批演练首次注入 `authority-resolve-timeout` 后发现：PM 恢复快照虽然声明 `retention: "ledger"`，resolver 原实现却只对发布流程内部的五种 artifact type 强制 authority，PM type 会在 authority 失败时继续使用本地缓存并报告恢复成功。这会让 `authorityDurable: true` 的含义失真。

修复后，凡同时满足以下绑定的 durable artifact 都必须具有精确 authority 副本：

- Schema 为 `chainlesschain.evolution-durable-artifact-record/v1`；
- tenant、purpose 与 resolver 构造参数一致；
- retention 为 `ledger`。

不再依据某个局部 artifact type 白名单决定是否允许缓存回退。authority 超时时，即使本地字节完整也必须失败；authority 恢复后，同一 Ledger 可再次正常读取。

## 2. 新增故障场景

[多进程恢复 fixture](../packages/cli/__tests__/fixtures/pm-exploration-recovery-process.mjs)和[恢复演练](../packages/cli/scripts/pm-exploration-recovery-drill.mjs)新增七个故障 profile：

| Profile                       | 注入位置                                     | 预期提交状态                             |
| ----------------------------- | -------------------------------------------- | ---------------------------------------- |
| `artifact-erofs`              | 本地 ArtifactStore 锁定/写入边界返回 `EROFS` | 未提交；重启为空历史                     |
| `authority-retain-timeout`    | authority retain 返回 `ETIMEDOUT`            | 未提交；不能签发成功回执                 |
| `authority-retain-reset`      | authority retain 返回 `ECONNRESET`           | 未提交；不能签发成功回执                 |
| `authority-invalid-receipt`   | authority 返回 `durable:false`               | 已保留的孤立字节不能形成 Ledger 提交     |
| `authority-resolve-timeout`   | 已提交记录回读时 authority 返回 `ETIMEDOUT`  | 已提交但当前不可读；authority 恢复后可读 |
| `ledger-enospc-after-segment` | segment 发布后、witness 前注入 `ENOSPC`      | 未提交；重启为空历史                     |
| `ledger-enospc-after-witness` | witness 发布后注入 `ENOSPC`                  | 通过认证历史恢复为已提交 revision 1      |

本地产物只读、retain 超时/断连、无效回执和 witness 前 `ENOSPC` 这些未提交路径都会启动新进程重新打开存储并确认不存在假 revision。`authority-resolve-timeout` 与 witness 后 `ENOSPC` 则验证“当前读取失败”和“提交结果未知”不能被误判为未提交；恢复必须依据认证 witness 和 authority 状态，而不是依据调用是否抛错。

## 3. 证据合同升级

恢复、单平台证据和三平台聚合 Schema 升级为：

- `chainlesschain.pm-exploration-recovery-drill/v2`
- `chainlesschain.pm-exploration-recovery-evidence/v2`
- `chainlesschain.pm-exploration-recovery-aggregate/v2`

v2 强制校验全部七个 fault result、故障与恢复进程 PID、观察到的错误码、提交状态、零假成功回执以及下列边界：

- `syntheticFaultInjection: true`
- `realDiskFullVerified: false`
- `realReadOnlyFilesystemVerified: false`
- `realRemoteAuthorityVerified: false`
- `physicalPowerLossVerified: false`
- `qualifiesForProduction: false`

精确 SHA 和三系统聚合规则保持不变；旧 v1 报告不会被 v2 聚合器当成当前通过证据。

## 4. 自动化验证

[PM adapter 回归测试](../packages/cli/__tests__/unit/pm-exploration-ledger-adapter.test.js)新增“authority 不可用但本地缓存仍存在”负例，要求返回 `CC_EVOLUTION_LEDGER_PORTS_UNAVAILABLE`。[恢复测试](../packages/cli/__tests__/unit/pm-exploration-recovery-drill.test.js)检查七种故障的提交语义，[证据测试](../packages/cli/__tests__/unit/pm-exploration-recovery-evidence.test.js)拒绝缺少 fault result 的伪完整报告。

本批定向验证结果：

| 检查                            | 结果                                    |
| ------------------------------- | --------------------------------------- |
| PM 恢复演练                     | 2 passed，31 processes，0 false success |
| PM 证据合同                     | 5 passed                                |
| PM Ledger adapter               | 12 passed                               |
| Evolution Ledger ports          | 12 passed                               |
| 第一至第八次 PM 定向套件        | 102 passed                              |
| ESLint / Prettier / Node syntax | 0 error / passed                        |

## 5. 保留边界与下一步

`artifact-erofs` 由测试 ArtifactStore 端口抛出错误；两个 `ENOSPC` profile 由确定性 Ledger phase hook 注入；authority 超时和断连由同步测试 authority 抛出错误。它们验证业务提交与恢复状态机，不验证操作系统挂载、磁盘控制器、网络栈、远端副本或时间边界。

下一步应将真实 Linux 只读挂载和小容量文件系统加入独立的特权可靠性工作流，并用进程外 authority 服务验证超时、断连、重连和服务端已保留但客户端未收到回执的场景。真实故障结果应使用独立 Schema 和 artifact，不能把本批 synthetic 标志改为生产通过。
