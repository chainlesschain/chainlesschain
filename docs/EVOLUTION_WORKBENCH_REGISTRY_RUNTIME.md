# Workbench 当前 Registry 状态接线

`createEvolutionWorkbenchRegistrySource()` 将真实发布状态接入工作台。它解决回滚或后续晋升后仍显示旧 Run active 的问题，不签发身份、审批或 mutation 权限，也不自动启用用户环境。

## 状态与历史分离

完成的 EvolutionRun 是不可改写的历史记录。工作台不为改变显示而追加完成后的事件，也不改变共享 `session-core` Run 协议或旧快照。

| 字段                                                         | v1 历史投影            | v2 Registry 投影                                       |
| ------------------------------------------------------------ | ---------------------- | ------------------------------------------------------ |
| `run.status / activeReleaseId / lastKnownGoodReleaseId`      | 原 Run 投影            | 同样保留原 Run 历史                                    |
| `registry`                                                   | 无                     | 实际 Ledger identity、迁移基线、完整发布事务与当前状态 |
| 候选 `actualUsage.active`                                    | 由 Run/transition 推导 | 匹配当前 Registry candidate/content                    |
| 过滤后 `governance.activeReleaseId / lastKnownGoodReleaseId` | Run 历史值             | Registry 当前值；真实空 Registry 返回 null             |

v2 的完整 schema 为 `chainlesschain.evolution-workbench-projection/v2`，嵌套 Registry schema 为 `chainlesschain.evolution-workbench-registry-state/v1`。CLI/App Server/IDE 消费的过滤后字段形状不变；旧 v1 保留用于历史读取，不成为生产 ReviewRuntime 缺少 Registry source 时的回退。

## 真实只读来源

签名 deployment loader 在 `evolution` / `serve` 暴露此工厂，并要求 descriptor 的 `handlerArtifactDigest` 等于实际认证模块摘要。配置项：

- `descriptor`：与 Review/rollback runtime 完全相同的 tenant、artifact tenant、run、Skill、stream、audience、purpose 和 handler 绑定。
- `ledger / ledgerArtifactResolver / releaseRegistry / transactionLedger`：实际实例、branded resolver 与相互绑定的 Registry/transaction Ledger。
- `verifierLedger / verifierLedgerArtifactResolver / verifierReleaseRegistry / verifierTransactionLedger`：独立重新打开同一持久存储的实例，不能复用第一组对象或复制其属性冒充 reader。

source 在每次读取时重新认证两组完整 Ledger checkpoint，枚举该 tenant/Skill 的实际 prepare/finalize 历史，并重新读取发布内容、依赖锁和 active/LKG。历史读取不接受调用者传入 limit 或筛掉旧事务；上限为 10,000 个事务，超限明确拒绝。迁移基线保留原 revision/state、制品引用和真实事件证明，后续事务从该基线验证连续性。重复 operationId、缺少前驱、错误 LKG、替换 release 内容或两组 reader 不一致均拒绝。

workflow transition 使用与原 writer 相同的 canonical request/attempt/settlement 解析逻辑，只授予读能力，不构造假的 source verifier 或 mutation authority。每个 settlement 还必须匹配同账本中更早发生的真实 promotion：transaction、candidate、release、request、authority receipt、state 和 revision 全部一致。当前 revision 已高于旧 settlement 不足以证明该旧事务真实存在。

没有 workflow request 时，真实 reader 可返回空列表，但实际 Registry 事务仍显示在 `release-registry` 时间线；不能用空列表掩盖真实晋升或回滚。未 finalize 的事务产生明确冲突。其他 Run 合法晋升了新候选时，旧 Run 不会被改写；当前版本照常展示，旧候选不再标 active，并提示 `active-outside-run`。

## 一致性与恢复

投影读取开始与所有异步来源读取结束之间，完整 Ledger checkpoint 必须保持一致，期间改变则重试读取，不能返回混合快照。Registry 的语义摘要不包含无关审核/身份审计/投影保留事件的最新 head，避免保存投影本身就使其立即失效；每次读取仍认证完整当前账本，而不是跳过新增事件。

宿主启动时先打开实际 Registry 并完成自身 journal 恢复，再恢复 Review/rollback settlement，随后向 CLI/App Server 开放工作台。回滚已完成但尚未补记工作台 settlement 时，当前状态仍来自真实 Registry，历史补记不会再次切换发布版本。

`verifyWorkbenchRegistryState()` 只验证视图的结构、摘要和历史一致性，不能替代上述真实 source 的认证。重新散列一个 JSON 对象不会得到 Ledger 权限。两个本机 reader 也不代表两个主机的独立故障域。

## 验证与剩余启动门

定向测试覆盖完成 Run 的不可变性、真实回滚与后续跨 Run 晋升、非空 workflow 事务绑定、伪造事务、空 Registry 审核、迁移基线、重算摘要攻击，以及无关审计追加后仍可保留当前投影。跨进程回归在五个真实 SIGKILL 窗口检查恢复前后 active/LKG、历史 Run 与重复恢复的实际 mutation 次数。另有真实 Registry→Commander 命令→固定 App Server 方法联调用例，验证回滚后 list 返回一致的当前状态，compare 正常消费 v2 投影；读取不请求人工身份，也不再次执行 mutation。这不是签名部署模块加载或用户 IDE 安装环境验收。具体执行结果见总任务文档 §7.2。

这里的签名、人工服务和 Eval 数据均为明确测试夹具，不是用户生产身份或目标模型验收。完整宿主身份/PKI、部署签名、生产 authority/witness、相关 Wiki/Pilot/调用来源及 CLI→App Server→目标 IDE 联调仍需完成。没有自动生成生产密钥、修改 IDE 安装或发布 npm。发布仍须先核对各子 npm 包的真实 payload，再按精确 release SHA 通过 GitHub 全平台 CLI CI 与 CLI Strict Sandbox。
