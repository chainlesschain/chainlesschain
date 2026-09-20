# RSIAgent 第二批实施：Desktop 就绪边界与逐轮探索合同

> 日期：2026-09-17（Asia/Shanghai）<br>
> 对应审计：[RSIAgent 差距分析](./rsiagent-gap-analysis-2026-09-17.md)中的 G01/G04，并继续收紧 G05。<br>
> 实施基线：`5142f6744220e1ff7af68214e066a8f62b18e02e`；本文记录的是未提交工作树，不代表已发布版本。<br>
> 状态：可信宿主的只读就绪投影、轮次合同和可重放恢复快照已经实现；真实执行器、签名回执、快照持久化宿主及效果验证仍未完成，因此 G01/G04 仍是“部分实施”。

> 后续进展：[第三次工程实施：Evolution Ledger 锚定](./rsiagent-third-batch-implementation-2026-09-17.md)已实现普通重启回读和追加约束；独立 durability authority 与生产组合仍未接入。

## 1. 本批结果

| 项目             | 已交付                                                                                                                                                       | 尚未完成的边界                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| G01 Desktop 宿主 | 在主进程组合真实模型入口、LLM manager、DID manager、数据库和环境配置，生成不含密钥、DID 与路径值的只读就绪投影                                               | 不探测真实 provider，不签发运行令牌，不创建隔离工作区，不执行任务                         |
| G04 逐轮闭环     | 不透明 Journal/Round capability、Broad 分支、合并门、Deep 串行阶段、候选 Memory checkpoint、预算与无收益停止、最终冻结合同，以及静止点恢复快照与全量重放校验 | 尚未接入受治理持久层；execution/grader/merge/evaluator receipt 目前只绑定摘要，未验证签名 |
| G05 训练边界     | Round plan 从已验证 suite 的 training-only 投影派生任务白名单；每轮启动时强制检查任务 ID                                                                     | 仍需可信执行宿主隔离上下文、文件和工具，防止运行时旁路读取 holdout                        |

本批没有开放 Explorer 运行入口。所有 checkpoint、merge 和 frozen-memory 产物固定为 `authenticated:false`、`qualifiesForPromotion:false`，不能进入正式 Memory、Registry 或发布链路。

## 2. Desktop 就绪边界

[Desktop PM readiness host](../../../desktop-app-vue/src/main/evolution/desktop-pm-exploration-readiness.js)只接受主进程持有的对象，并通过 `WeakMap` 品牌标记保存不透明能力。应用在 bootstrap 的实例装配结束后，由 [主进程入口](../../../desktop-app-vue/src/main/index.js)重新组合该 host。

当前投影检查：

- 模型入口必须是受品牌保护的 Desktop model ingress；LLM manager 也必须来自受治理构造路径。
- LLM manager 已初始化、具有 client 且没有暂停；这里只读状态，不发起 provider 调用。
- DID manager 能返回已解锁的 `did:` 身份；输出不复制 DID。
- 数据库能执行 `SELECT 1 AS ok`，当前数据库路径为绝对路径；输出不复制路径。
- production、mock、原生数据库、持久化、Actor guard 和 RBAC guard 必须与预注册配置完全一致。

即使上述配置全部满足，结果仍为 `requires-runtime-evidence`，且 `readyForExecution:false`。缺失证据固定包括：真实 provider 探针、宿主强制结构化工具策略、一次性工作区与数据库重置、宿主预算取消、签名独立 grader，以及重启持久化和无残留演练。

这一区分避免把“依赖看起来已装配”误报成“可以开始真实探索”。

## 3. Broad/Deep 轮次合同

[PM exploration rounds](../../../packages/cli/src/lib/evolution/pm-exploration-rounds.js)实现以下状态流：

```text
broad ──各分支至少一个已结算 checkpoint──> broad-complete
  │                                             │
  │ 分支之间可并行，单分支内串行                │ merge digest 精确绑定
  │                                             v
  └── reject/unsafe/超预算不推进 Memory       deep ──至少一轮──> frozen
```

关键约束如下：

1. Plan 绑定 suite、training partition、训练任务 ID 白名单、环境、初始 Memory、分支和全部预算，并计算稳定摘要。
2. Round 只能引用白名单中的训练任务；Broad 可跨分支并行，同一分支只能有一个活动轮次；Deep 全局串行。
3. 完成一轮必须绑定 execution receipt、grader receipt、输出 Memory 和资源计量。只有 `accept` 且未超预算才推进分支或 Deep 的当前 Memory。
4. `reject`、`unsafe` 和超预算候选保留证据，但下一轮继续使用上一个有效 Memory。接受但摘要未变化的结果也会被拒绝。
5. 所有 Broad 分支至少完成一轮且没有活动轮次后才能合并；Deep 入口必须精确绑定该 merge digest。
6. token、工具调用或墙钟预算超限，以及连续无收益或最大轮数触发的停止状态，不能通过进入 Deep 阶段重置。
7. 冻结要求至少一个 Deep checkpoint、没有活动轮次，且最终 Memory 必须等于当前 Deep head。

Journal 和 Round token 都是不透明进程内 capability，不能用结构相似的普通对象伪造，也不能跨 Journal 使用或重复结算。输入拒绝 Proxy、访问器、意外字段、稀疏数组、重复 ID、非法摘要和非安全整数；输出为递归冻结的最小投影。

恢复快照只能在没有活动轮次的静止边界导出。恢复时不会直接信任序列化状态，而是从 Plan 新建 Journal，按顺序重新执行每个 Broad checkpoint、merge、Deep checkpoint 和 freeze 转换，并逐项比较重算后的摘要，最后要求整份快照摘要完全复现。JSON 往返和恢复后继续探索已有测试覆盖。快照仍为 `authenticated:false`：公开摘要只能发现意外损坏，不能代替宿主签名或证明 receipt 来源真实。

## 4. 与数据分区的接线

[PM benchmark tooling](../../../packages/cli/src/lib/evolution/pm-exploration-benchmark.js)新增 `buildPmExplorationRoundPlan`。它先重新验证 canonical Eval suite，再从 `projectPmExplorationTrainingView`派生：

- `suiteDigest`；
- `trainingPartitionDigest`；
- 仅包含 training split 的任务 ID 白名单。

调用方不能自行把 validation/test ID 填入计划。篡改 suite 后再派生会先因摘要不一致失败。Round plan 本身不包含 private expected、grader ID、分组原值、验证任务或测试任务。

这仍只是结构边界：真正运行时还必须由 Desktop 宿主限制模型上下文、文件、IPC 工具和网络，不能让 Actor 通过其他入口读取私有数据。

## 5. 代码与测试

- [Desktop readiness host](../../../desktop-app-vue/src/main/evolution/desktop-pm-exploration-readiness.js)
- [Desktop readiness tests](../../../desktop-app-vue/src/main/evolution/__tests__/desktop-pm-exploration-readiness.test.js)
- [主进程装配](../../../desktop-app-vue/src/main/index.js)
- [轮次协议](../../../packages/cli/src/lib/evolution/pm-exploration-rounds.js)
- [轮次协议测试](../../../packages/cli/__tests__/unit/pm-exploration-rounds.test.js)
- [PM suite/plan 接线](../../../packages/cli/src/lib/evolution/pm-exploration-benchmark.js)
- [PM suite/plan 测试](../../../packages/cli/__tests__/unit/pm-exploration-benchmark.test.js)

本机定向验证结果：

| 检查                                | 结果                | 能证明什么                                                               |
| ----------------------------------- | ------------------- | ------------------------------------------------------------------------ |
| Round + benchmark 单测              | 52 passed，0 failed | 状态转换、训练白名单、摘要绑定、预算、停止、冻结、恢复重放和负例合同成立 |
| Desktop readiness + deployment 单测 | 24 passed，0 failed | readiness 品牌边界和既有 Desktop evolution deployment 回归通过           |
| 新增/修改 JS 的 ESLint              | 0 error             | 静态规则通过；仓库现有 `MODULE_TYPELESS_PACKAGE_JSON` 提示仍存在         |
| Node 语法检查                       | 通过                | 新模块以及主进程入口可被解析                                             |

这些测试不启动 Electron、不调用真实模型、不验证付费 provider、不执行完整 PM Journey，也不等同于 Windows/Linux/macOS 发布矩阵。

## 6. 未关闭事项与下一步

第二批先建立了 fail-closed 合同，但没有伪造其外部依赖。下一步按以下顺序接线：

1. 在可信 Desktop 主进程实现一次性 workspace/database clone、结构化 IPC tool broker、硬预算计量和可取消执行。
2. 由独立只读 grader 生成签名 receipt；host 校验 execution、grader、merge 和 evaluator receipt 的主体、计划、环境与 checkpoint 绑定。
3. 由可信宿主将静止点快照原子写入受治理持久层，并补真实进程终止、重复消息、损坏文件、回滚和重启回读演练；当前模块已能验证和重放快照，但不负责选择存储位置或赋予快照可信身份。
4. 用合法/越权角色运行小规模真实 PM 任务，执行重置无残留演练，再建立同预算 baseline 与探索对照。
5. 只有 holdout 结果、权限安全、恢复性和成本指标同时满足预注册门槛，才允许生成 Promotion Candidate；本批产物不得直接晋级。

因此，本批关闭的是“缺少可测试的轮次/恢复语义”和“Desktop 依赖没有集中只读检查”两项工程空白，不是 G01/G04 的生产验收。
