# RSIAgent 第六次工程实施：恢复与 CAS 故障演练

> 日期：2026-09-17（Asia/Shanghai）<br>
> 前置实施：[第五次 Desktop 只读持久化接线](./rsiagent-fifth-batch-implementation-2026-09-17.md)<br>
> 后续实施：[第七次三系统精确 SHA 恢复门禁](./rsiagent-seventh-batch-implementation-2026-09-17.md)<br>
> 实施基线：`5142f6744220e1ff7af68214e066a8f62b18e02e`；本文记录未提交工作树，不代表已发布版本。<br>
> 状态：新增可重复执行的 PM 探索恢复演练，在临时目录中使用真实文件 Ledger、artifact store、独立副本和 16 个子进程验证恢复与并发边界；authority 和密钥均为测试专用，结果不具备生产晋级资格。

本文的“第六次”只表示工程交付次序。它仍属于最小探索闭环的工程准备，不是路线图中的效果判定、Pilot 或正式发布。

## 1. 演练入口

新增 [PM recovery drill](../../../packages/cli/scripts/pm-exploration-recovery-drill.mjs)，可从仓库根目录执行：

```bash
npm run test:pm:recovery-drill
```

CLI workspace 同时提供 `test:pm-exploration-recovery-drill`。演练使用 [独立子进程 fixture](../../../packages/cli/__tests__/fixtures/pm-exploration-recovery-process.mjs)和受限 [process helper](../../../packages/cli/__tests__/helpers/pm-exploration-recovery-process.js)：

- 每个子进程最大堆为 256 MiB；
- 标准输出和错误输出合计限制为 256 KiB；
- 单进程超时为 60 秒，超时后强制终止；
- 只使用运行时创建的系统临时目录；
- 清理前验证目标确实是新建临时根或其明确子目录；
- 测试 HMAC secret 只通过子进程环境传递，不读取生产凭据。

## 2. 已执行场景

### 2.1 普通重启与副本恢复

第一个子进程提交 revision 1，第二个新进程重新构造完整 adapter 并验证相同 Ledger HEAD 和快照。随后演练删除本地 artifact 目录，新进程仍从 durability authority 副本恢复；再删除副本后，新进程必须失败，不能仅凭 Ledger 摘要返回成功。

### 2.2 提交阶段强制退出

演练在三个确定性 hook 以 exit code 86 终止子进程，不执行正常返回或清理：

| 退出点          | 预期恢复结果                                             |
| --------------- | -------------------------------------------------------- |
| `after-retain`  | authority 已保留孤立内容，但 Ledger 无事件；恢复为空历史 |
| `after-segment` | Ledger 尚未形成可认证提交；恢复为空历史                  |
| `after-witness` | witness 已确认提交；新进程恢复唯一 revision 1            |

这验证了“是否已提交”由认证 Ledger/witness 状态决定，而不是由 artifact 或副本文件是否存在决定。`after-retain`产生的未引用内容不会被伪造成 revision。

这里使用的是确定性 `process.exit(86)`故障注入，不是拔电、内核崩溃或存储设备缓存丢失测试。

### 2.3 跨进程 CAS 竞争

两个进程先各自完成 artifact 发布和 authority 保留，然后在同一栅栏后竞争 Ledger HEAD：

- 不同快照：只能一个提交；另一个收到 `CC_EVOLUTION_LEDGER_HEAD_CONFLICT`，最终 Ledger 仍只有一个事件。
- 相同快照：只能一个首次提交；另一个通过已认证历史返回 `recovered:true`，两者快照摘要完全相同，Ledger 仍只有一个事件。

栅栏放在 authority retain 之后，确保演练实际到达 Ledger CAS，而不是在 artifact 发布阶段提前竞争失败。

## 3. 证据语义

成功报告使用 `chainlesschain.pm-exploration-recovery-drill/v1`，本次直接运行结果为：

| 字段                                   | 结果   |
| -------------------------------------- | ------ |
| `status`                               | passed |
| `processCount`                         | 16     |
| `freshProcessRestartRecovered`         | true   |
| `localCacheLossRecoveredFromAuthority` | true   |
| `authorityLossRejected`                | true   |
| `forcedExitAfterRetainRejected`        | true   |
| `uncommittedLedgerExitRejected`        | true   |
| `committedLedgerExitRecovered`         | true   |
| `divergentCasConflictRejected`         | true   |
| `identicalCasCommitIdempotent`         | true   |
| `falseSuccessReceipts`                 | 0      |
| `testAuthority`                        | true   |
| `productionAuthority`                  | false  |
| `physicalPowerLossVerified`            | false  |
| `qualifiesForProduction`               | false  |

报告强制保留四类未验证条件：物理断电、生产 KMS/HSM/PKI、独立远端故障域，以及生产文件系统与设备缓存语义。当前演练不能关闭 Desktop readiness 中的 `restart-persistence-and-no-residue-drill`，因为它没有运行目标部署的真实 authority、目录、安装包和操作系统矩阵。

## 4. 自动化验证

新增 [recovery drill tests](../../../packages/cli/__tests__/unit/pm-exploration-recovery-drill.test.js)，检查全部报告字段、强制退出判定、零假成功回执和非生产限定，并验证非法 progress observer 在创建临时目录前被拒绝。

本次定向结果：

| 检查                           | 结果                 |
| ------------------------------ | -------------------- |
| Recovery drill unit tests      | 2 passed，0 failed   |
| 直接执行 recovery drill        | passed，16 processes |
| 第一至六次工程实施 PM 定向单测 | 96 passed，0 failed  |
| Desktop deployment / readiness | 28 passed，0 failed  |
| Evolution deployment loader    | 56 passed，0 failed  |
| ESLint / Node syntax           | 0 error / 通过       |

## 5. 当前边界与下一步

本次将“普通单进程单测可恢复”提升为“真实多进程和确定性提交阶段故障下可重复验证”。它没有证明真实模型任务、业务 receipt、生产权限或物理耐久性。

下一步：

1. 将该命令加入 Linux、Windows、macOS CI，分别保存与精确提交 SHA 绑定的报告；单平台本地通过不能替代矩阵。
2. 为目标 Desktop 隔离部署配置受审查的真实 authority 和存储目录，在安装包环境重复同一演练，并增加无残留检查。
3. 增加磁盘满、只读文件系统、远端 authority 超时/断连和设备级断电测试；这些结果必须与本次测试 authority 报告分开。
4. 在 durability 矩阵稳定后实现强制预算 executor 和签名 execution/grader/merge/evaluator receipt，继续保持 Explorer 关闭。
