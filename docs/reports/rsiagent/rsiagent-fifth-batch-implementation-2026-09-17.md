# RSIAgent 第五次工程实施：Desktop 只读持久化接线

> 日期：2026-09-17（Asia/Shanghai）<br>
> 前置实施：[第四次独立持久化权威](./rsiagent-fourth-batch-implementation-2026-09-17.md)<br>
> 实施基线：`5142f6744220e1ff7af68214e066a8f62b18e02e`；本文记录未提交工作树，不代表已发布版本。<br>
> 状态：签名 Desktop deployment 已能构造并返回真实 PM Ledger adapter；Desktop loader 会验证其品牌并立即收窄为主进程只读、无可枚举字段的 storage host。readiness 会检查该 host 是否配置且可回读，但仍固定 `readyForExecution:false`。
> 后续进展：[第六次工程实施](./rsiagent-sixth-batch-implementation-2026-09-17.md)新增真实子进程恢复与 Ledger CAS 故障演练；仍不代表生产断电验收完成。

本文的“第五次”仅表示工程交付次序，不对应差距分析路线图中的“第五批：受控试用”。当前仍未进入效果判定、Pilot 或正式发布。

## 1. 接线结果

[Evolution deployment loader](../../../packages/cli/src/lib/evolution/evolution-deployment-loader.js)只为 `desktop`命令向已验签 deployment module 提供以下 PM 存储组合工厂：

- `createPmExplorationPlan`；
- `createPmExplorationLedgerAdapter`；
- `createEvolutionArtifactPorts`；
- `createEvolutionLedgerDurableArtifactResolver`；
- `createEvolutionLedgerFileBackend`；
- `createArtifactStore`。

这些工厂仍处于已验证 deployment bytes 的调用边界内；普通 renderer、IPC 参数或未签名配置不能取得它们。实际 authority、密钥、目录、tenant 和计划仍必须由目标部署提供，本次没有生成或硬编码生产凭据。

签名 deployment 可返回 `pmExplorationLedgerStore`。Desktop loader 使用本地 [PM Ledger adapter](../../../packages/cli/src/lib/evolution/pm-exploration-ledger-adapter.js)的品牌捕获函数验证它确实来自真实构造器，然后只捕获 `load`端口，生成 `desktopPmExplorationStorageHost`：

- host 外观是冻结的空对象；
- 不暴露 `commitJournal`、`restoreLatestJournal`、Ledger、artifact ports、authority 或目录；
- 原始 store 不进入返回给 bootstrap/IPC registry 的依赖对象；
- store 缺失、伪造、使用 accessor、异步回读、抛错或返回不符合恢复 schema 的证据时 fail-closed。

## 2. Readiness 投影

[Desktop PM readiness](../../../desktop-app-vue/src/main/evolution/desktop-pm-exploration-readiness.js)新增两个配置检查：

| 检查                      | 通过条件                                             |
| ------------------------- | ---------------------------------------------------- |
| `durable-recovery-store`  | capability 由 Desktop loader 的私有 WeakMap 品牌确认 |
| `recovery-store-readable` | 同步、只读 `load`完成且返回空历史或合法恢复证据      |

readiness 只输出经过净化的 `recoveryStorage`投影：是否配置、是否可读、是否存在 durable 快照，以及固定为假的 `powerLossDurabilityTested`、`snapshotAuthenticated`和 `qualifiesForPromotion`。它不输出快照、计划、authority ID、路径、tenant、摘要或错误正文。

没有历史快照时，真实存储仍可被判定为“已配置且可读”，以免形成“必须先有快照才能启动第一轮、但第一轮又要求 readiness”的循环依赖。存在快照时，只接受当前恢复 schema 中认证、Ledger durability 和 authority durability 均为真的证据；这仍不改变业务 receipt 未验签的事实。

[Desktop 主进程组合](../../../desktop-app-vue/src/main/index.js)只把 `evolutionDeploymentDependencies.desktopPmExplorationStorageHost`传给 readiness host。即使所有本地配置检查通过，返回值仍保持：

- `status: requires-runtime-evidence`；
- `readyForExecution:false`；
- `runtimeVerified:false`；
- `authenticated:false`；
- `qualifiesForPromotion:false`。

因此，本次接线不能被 renderer 或模型当作执行令牌。

## 3. 安全边界

本次刻意没有：

- 自动创建生产 authority、签名密钥、状态目录或 deployment descriptor；
- 将写端口放入 Desktop host、IPC、WebSocket、renderer 或模型上下文；
- 在 readiness 检查中调用模型 provider 或运行探索任务；
- 把“存储可读”解释为已完成进程强杀、掉电、磁盘损坏或远端副本演练；
- 验证 checkpoint 内 execution、grader、merge、evaluator receipt；
- 改变 Review/Pilot/Release `HOLD`或 Memory promotion 边界。

通用 bootstrap 和 IPC registry 仍可能接收到 `desktopPmExplorationStorageHost`这个依赖名，但其值是没有公开属性或方法的 opaque capability，而不是原始 store。只有同一主进程模块持有的私有 WeakMap 能执行只读投影。

## 4. 测试证据

新增或扩展的负例覆盖：

- Desktop loader 不返回 `commitJournal`或 `restoreLatestJournal`；
- 真实 PM adapter 经真实 `capturePmExplorationLedgerStore`后才能跨越 Desktop 边界；
- 提交真实 durable 快照后，只读 host 能反映“存在 durable snapshot”，但不泄漏快照正文；
- 未品牌化 store、accessor、异步 load、读取异常和非法恢复证据被拒绝或投影为不可读；
- 缺失、伪造或不可读 host 会让 Desktop readiness 进入 `blocked`；
- 未配置快照的真实空 store 可通过存储配置检查，但仍缺少六类 runtime evidence；
- PM 工厂只在签名 Desktop deployment 的内建 factory 集合中提供。

本次定向验证结果：

| 检查                              | 结果                           |
| --------------------------------- | ------------------------------ |
| Desktop deployment / readiness    | 28 passed，0 failed            |
| Evolution deployment loader       | 56 passed，0 failed            |
| PM Ledger adapter（含跨边界测试） | 11 passed，0 failed            |
| 第一至五次工程实施 PM 定向单测    | 94 passed，0 failed            |
| Ledger / artifact ports           | 54 passed，1 skipped           |
| Desktop main process build        | 通过                           |
| PM preflight                      | 按设计 exit 1 并保持 `blocked` |
| ESLint / Node syntax              | 0 error / 通过                 |

预检的非零退出是当前环境缺少真实模型、身份、隔离、预算、独立 grader 和重启持久化证据时的预期 fail-closed 结果；不能把它记录成可运行。Desktop 测试仍有仓库已有的 `punycode`弃用提示。

## 5. 当前结论与下一步

本次解决的是“如何让 Desktop 可信根确认独立持久化组合已经存在且可读，同时不传播写权限”。它没有提供可执行生产配置，也没有证明 Explorer 的权限、安全、效果或恢复演练已经达标。

下一步应按顺序完成：

1. 为目标 Desktop 部署准备经过签名和审查的 authority、witness、目录及 tenant 配置，并在隔离测试租户验证只读投影；不得把测试 HMAC 或临时目录迁入生产。
2. 增加子进程强杀、本地缓存损坏、authority 副本恢复、authority 中断和 Ledger CAS 竞争演练，形成目标平台 CI 证据。
3. 实现强制 token/tool/time budget executor 和签名 execution/grader/merge/evaluator receipt；执行端与只读 readiness capability 分离。
4. 完成等预算 baseline/Explorer 离线对照和人工审核后，再决定是否申请最小范围 Pilot；在此之前继续保持执行关闭。
