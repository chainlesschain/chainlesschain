# RSIAgent 第四次工程实施：探索快照的独立持久化权威

> 日期：2026-09-17（Asia/Shanghai）<br>
> 前置实施：[第三次 Evolution Ledger 锚定](./rsiagent-third-batch-implementation-2026-09-17.md)<br>
> 实施基线：`5142f6744220e1ff7af68214e066a8f62b18e02e`；本文记录未提交工作树，不代表已发布版本。<br>
> 状态：PM 探索恢复快照已在 Ledger 追加前交由独立 durability authority 保留，并可在本地 artifact 缓存丢失后从权威副本恢复；尚未完成真实断电演练、生产组合、业务 receipt 验签或 Explorer 开放。
> 后续进展：[第五次工程实施](./rsiagent-fifth-batch-implementation-2026-09-17.md)已把真实存储品牌收窄为 Desktop 主进程只读 readiness capability；本文保留第四次实施完成时的边界。

本文的“第四次”只表示工程交付次序，不对应差距分析路线图中的“第四批：条件性扩展”。当前仍在“第二批：最小探索闭环”的工程准备阶段，没有开始效果判定或受控试用。

## 1. 本次结果

[PM exploration ledger adapter](../packages/cli/src/lib/evolution/pm-exploration-ledger-adapter.js)现在要求可信 root composition 同时注入：

- 精确的 `EvolutionArtifactPorts` 实例，用作本地 canonical artifact 缓存；
- 精确的 `artifactDurabilityAuthority`，负责保留独立权威副本；
- 由同一 artifact ports、authority、tenant 和 purpose 构造的品牌化 durable resolver；
- 精确的 `EvolutionLedger` 实例，负责追加签名 domain event。

[Evolution Ledger ports](../packages/cli/src/lib/evolution/evolution-ledger-ports.js)为 durable resolver 增加只读身份捕获。适配器不仅核对 authority ID，还核对 resolver 是否确由同一个 authority 对象、同一个 artifact ports 对象及相同 tenant/purpose 构造。仅复制字段、使用同 ID 的另一 authority、普通函数、Proxy 或未品牌化 resolver 均不能取得可信端口。

## 2. 提交顺序与失败边界

新快照按以下顺序提交：

1. 通过 artifact ports 写入本地 canonical artifact，并验证持久化与写后回读回执。
2. 按产品 schema 重建 canonical durable record 字节，验证其摘要与发布 ref 完全一致。
3. 把精确字节及绑定信息交给 durability authority；严格验证同步、精确形状、认证、durable、authority、tenant、purpose、retention、type、ref 和 digest 回执。
4. 只有前三步全部成功，才以 Ledger 当前 HEAD/sequence 执行 CAS 追加。

因此，authority 保留失败不会产生引用不存在权威副本的新 Ledger 事件。若最后的 Ledger CAS 失败，内容寻址的权威副本可能成为未引用对象，但不会伪造已提交 revision；后续可由受治理的保留策略清理，不能反向补写日志。

读取仍以已验证 Ledger 事件为入口。durable resolver 优先校验并读取权威副本；本地 artifact 只作可替换缓存。测试删除本地文件后仍能从权威副本恢复，随后同时删除权威副本时读取会 fail-closed，不会仅凭 Ledger 摘要合成快照。

## 3. 证据语义

acknowledgement/restore envelope 现在区分：

| 字段                        | 当前值       | 含义                                                                      |
| --------------------------- | ------------ | ------------------------------------------------------------------------- |
| `authenticated`             | `true`       | Ledger 事件、artifact 绑定及 authority 回读链均通过现有协议校验           |
| `durable`                   | `true`       | 可信 durability authority 已为该精确 artifact 返回 durable receipt        |
| `ledgerAuthenticated`       | `true`       | Ledger 身份、事件摘要与签名链可验证                                       |
| `ledgerDurable`             | `true`       | Ledger 事件及 HEAD 已由现有 witness 提交                                  |
| `artifactPersisted`         | `true`       | 本地 artifact 写入成功                                                    |
| `artifactReadbackVerified`  | `true`       | 本地写后回读与摘要校验通过                                                |
| `durabilityAuthorityId`     | authority ID | 指明声明持久性的权威，不接受仅同名但不同对象的替换                        |
| `authorityDurable`          | `true`       | 权威回执对精确 ref/digest/binding 声明 durable                            |
| `powerLossDurabilityTested` | `false`      | 本次没有执行真实进程强杀、文件系统断电、刷盘设备或远端存储故障演练        |
| `snapshotAuthenticated`     | `false`      | checkpoint 内 execution/grader/merge/evaluator receipt 仍未建立独立验签链 |
| `qualifiesForPromotion`     | `false`      | 不得把可恢复快照当作正式 Memory、效果结论或发布晋级证据                   |

这里的 `durable:true`是对受信 authority 协议回执的声明，不等于已经实测物理断电。`powerLossDurabilityTested:false`保留了这一区别；后续生产验收不能只检查前一个字段。

## 4. 测试覆盖

扩展 [ledger adapter tests](../packages/cli/__tests__/unit/pm-exploration-ledger-adapter.test.js)，使用文件型本地 artifact、文件型独立 authority 副本及真实文件型 Evolution Ledger，覆盖：

- 提交、重开、继续追加、幂等、陈旧 Journal、活动轮次与跨计划拒绝；
- 删除本地 artifact 后由权威副本恢复；本地与权威副本同时缺失时 fail-closed；
- authority `retain`失败时不追加 Ledger 事件；
- 同 ID 但不同 authority 对象、不同 resolver 绑定、未品牌化 resolver 和 descriptor 访问器拒绝；
- frozen 快照仍保持 `snapshotAuthenticated:false`与 `qualifiesForPromotion:false`。

本次定向验证结果：

| 检查                                   | 结果                                                              |
| -------------------------------------- | ----------------------------------------------------------------- |
| PM Ledger adapter                      | 10 passed，0 failed                                               |
| 第一至四次工程实施 PM 定向单测         | 93 passed，0 failed                                               |
| Evolution Ledger ports                 | 12 passed，0 failed                                               |
| Evolution artifact ports               | 42 passed，1 skipped                                              |
| Desktop readiness / deployment         | 24 passed，0 failed                                               |
| PM Journey Playwright 收集             | 33 tests；仅执行 `--list`，未运行完整 Electron E2E                |
| PM preflight                           | 按设计以 exit 1 fail-closed；配置不兼容且六类真实运行证据均未提供 |
| ESLint / Node syntax / diff whitespace | 0 error / 通过                                                    |

预检的非零退出是本次环境未满足真实模型、身份、隔离、预算、独立 grader 和重启持久化证据时的预期结果，不是把阻断状态解释为可运行。仓库已有 `MODULE_TYPELESS_PACKAGE_JSON`和 `punycode`弃用提示仍存在，不影响上述用例判定。

## 5. 仍未开放的能力

本次没有：

- 把 Explorer、renderer IPC、模型或外部调用者接到该存储端口；
- 建立可执行的真实身份、RBAC、网络/工具沙箱和强制预算 executor；
- 验证 execution、grader、merge、evaluator receipt 的真实性；
- 完成真实进程终止、断电、磁盘损坏、远端副本中断或 CAS 并发演练；
- 证明探索经验改善 holdout 任务，或改变现有 Review/Pilot/Release `HOLD`边界。

因此，独立权威副本解决的是“Ledger 所引用的恢复字节在本地缓存之外是否有受信保留来源”，不是“快照内所有业务结果是否可信”，更不是“现在可以开始自主探索”。

## 6. 下一步

1. 在 Desktop 可信 root composition 中注入生产级 authority、artifact ports、durable resolver 和 Ledger，但继续保持 readiness 只读、执行 fail-closed。
2. 增加子进程强杀、本地缓存破坏、权威副本恢复、authority 不可用和 Ledger CAS 竞争演练，并由目标平台 CI 验证实际存储语义。
3. 实现可强制取消的 token/tool/time budget executor，以及 execution/grader/merge/evaluator receipt 的签名和回放验证。
4. 冻结实验合同后运行等预算 baseline/Explorer 比较；只有安全、收益、成本和回滚门同时通过，才考虑申请受控运行令牌。
