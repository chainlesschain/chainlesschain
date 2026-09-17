# RSIAgent 第三次工程实施：探索快照的 Evolution Ledger 锚定

> 日期：2026-09-17（Asia/Shanghai）<br>
> 前置实施：[第一批基础工具](./rsiagent-first-batch-implementation-2026-09-17.md)、[第二批轮次与恢复合同](./rsiagent-second-batch-implementation-2026-09-17.md)<br>
> 实施基线：`5142f6744220e1ff7af68214e066a8f62b18e02e`；本文记录未提交工作树，不代表已发布版本。<br>
> 状态：恢复快照已能写入并从真实文件型 Evolution Ledger 重开；本地产物存储尚未接入独立 durability authority，因此整体证据明确保持 `durable:false`，也没有接入 Desktop 生产组合。
> 后续进展：[第四次工程实施](./rsiagent-fourth-batch-implementation-2026-09-17.md)已接入独立持久化权威；本文保留第三次实施完成时的历史证据口径。

本文的“第三次”仅表示代码交付次序，不代表差距分析路线图中的“第三批：效果判定”已经开始；当前仍处于最小探索闭环的工程准备阶段。

## 1. 本批结果

新增 [PM exploration ledger adapter](../packages/cli/src/lib/evolution/pm-exploration-ledger-adapter.js)，把第二批的静止点恢复快照作为受限 Evolution artifact 写入现有 Ledger，而不是另建新的权威日志。

适配器提供三项能力：

- `commitJournal`：从不透明 Journal 导出静止点快照，执行 append-only/CAS 检查，写入 canonical artifact，再追加签名 Ledger domain event。
- `load`：从当前已验证 Ledger 读取最新事件，通过受品牌保护的 artifact resolver 回读精确字节，并完整重放快照。
- `restoreLatestJournal`：从已回读的快照重建新的不透明 Journal，供宿主在重启后继续 Broad/Deep 状态机。

当前没有把该适配器暴露给 renderer、IPC 或模型，也没有自动创建生产存储。`capturePmExplorationLedgerStore`只接受真实构造的适配器实例，供后续可信 root composition 捕获最小端口。

## 2. 追加与恢复约束

每个持久化记录绑定：

- tenant、artifact tenant、audience、purpose 和 `planDigest` 的 descriptor digest；
- 单调递增 revision；
- 前一快照摘要；
- 当前快照摘要和完整快照；
- 提交时间。

对应 domain event 使用 `planDigest`作为 correlation ID，以前一事件的 subject ref 作为唯一 source ref。读取时会验证 revision 无缺口、前驱摘要连续、事件 ID、原因、时间、artifact tenant、source ref 和 artifact 内容完全一致。

新快照必须保留旧 checkpoint 的精确前缀，阶段只能按 `broad → broad-complete → deep → frozen`前进；已提交 merge 不能变化，frozen 状态不能继续扩展。相同快照重试返回 `recovered:true`且不重复写事件，陈旧 Journal 会以冲突失败。

适配器只接受精确的 `EvolutionLedger`与 `EvolutionArtifactPorts`实例，并直接绑定其原型方法；结构相似的普通对象、Proxy、子类覆写、未品牌化 resolver、计划不匹配和 descriptor 访问器都不能取得可信存储端口。

## 3. Artifact allow-list

[Evolution artifact ports](../packages/cli/src/lib/evolution/evolution-artifact-ports.js)新增有限类型 `pm-exploration-recovery-snapshot`，并且只允许以 `evolution-ledger` purpose 使用 ledger retention。部署仍只能缩小产品 allow-list，调用者不能在运行时添加任意产物类型。

这项修改是显式安全接线：测试最初因类型未登记而被拒绝；实现没有绕过 allow-list，而是补充产品级枚举、retention 类型和 purpose 映射，并运行已有 allow-list 回归。

## 4. 证据语义

当前 acknowledgement/restore envelope 明确区分：

| 字段                       | 当前值  | 含义                                                          |
| -------------------------- | ------- | ------------------------------------------------------------- |
| `authenticated`            | `true`  | Ledger 事件及本地 artifact envelope 已按现有 authority 验证   |
| `ledgerAuthenticated`      | `true`  | Ledger 身份、事件摘要和签名链可验证                           |
| `ledgerDurable`            | `true`  | Ledger 事件及 HEAD 已由现有 witness 提交                      |
| `artifactPersisted`        | `true`  | ArtifactStore 已写入                                          |
| `artifactReadbackVerified` | `true`  | 写后回读和摘要校验通过                                        |
| `powerLossDurable`         | `false` | 尚无独立权威副本证明掉电持久性                                |
| `durable`                  | `false` | 因上一项缺失，整体恢复证据不声明完整 durability               |
| `snapshotAuthenticated`    | `false` | 探索 checkpoint 中引用的 execution/grader 等 receipt 仍未验签 |
| `qualifiesForPromotion`    | `false` | 不得作为正式 Memory 或发布晋级证据                            |

这种拆分避免把“普通重启后可恢复”误报成“抗掉电、独立副本和全部业务证据均可信”。删除本地 artifact 后，读取会 fail-closed，不会仅根据 Ledger 中的摘要伪造恢复成功。

## 5. 测试结果

新增 [ledger adapter tests](../packages/cli/__tests__/unit/pm-exploration-ledger-adapter.test.js)，使用真实 `ArtifactStore`、`EvolutionArtifactPorts`、文件型 `EvolutionLedger`、独立测试签名 authority 和 witness，不使用内存假 Ledger。

| 检查                    | 结果                 | 覆盖                                                                                                                 |
| ----------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------- |
| PM Ledger adapter       | 9 passed，0 failed   | 首次提交、真实重开、恢复后继续、追加 revision、幂等、陈旧回滚、活动轮次、跨计划、缺失 artifact、冻结不晋级、构造边界 |
| 第一至三批 PM 定向单测  | 92 passed，0 failed  | grader、数据分区、轮次/恢复合同和 Ledger adapter 的组合回归                                                          |
| Artifact ports 完整单测 | 42 passed，1 skipped | 新类型的有限 purpose、完整枚举及既有 artifact 安全边界                                                               |
| ESLint / Node syntax    | 0 error / 通过       | 新适配器及测试静态检查通过；仓库已有模块类型提示仍存在                                                               |

这些测试证明普通进程重开和签名 Ledger 锚定成立，不证明磁盘掉电、远程副本、生产密钥、Desktop 组合或真实模型探索成立。

## 6. 下一步

1. 由可信 root composition 注入独立 `artifactDurabilityAuthority`，在 Ledger append 前保存 canonical artifact 字节，并在恢复时以权威副本为准、本地副本仅作交叉检查。
2. 将该组合接入 Desktop readiness host，但仍先保持只读/不可执行；完成真实进程终止、损坏本地缓存、权威副本恢复和 CAS 竞争演练。
3. 再实现带强制取消的 token/tool/time budget executor，以及 execution/grader/merge/evaluator receipt 的签名验证。
4. 只有完整 durability、真实权限、独立 grader 和 holdout 结果同时满足门槛，才考虑打开受控运行令牌。

本次解决的是“恢复快照如何进入现有证据平面并在普通重启后可信回读”，没有解决“快照内每条业务证据是否真实”或“是否可以开始自主探索”。
