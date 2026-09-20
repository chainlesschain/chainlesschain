# 第四十二次工程实施：混合版本历史回执恢复与指标迁移

日期：2026-09-19

## 本批结论

本批继续收敛 G07 的持久化恢复边界。上一批已阻止新读入的 v1 回执进入 outcome 指标，但旧 Workbench snapshot 可能已在历史聚合中计入 v1；仅在读取时检查新 delta，无法修正这种存量状态。

Evolution Workbench metrics snapshot 因此升级为 v2。新 snapshot 明确记录回执兼容策略与排除数量；旧 v1 snapshot 在取得完整、认证且耐久的回执历史并完成 backfill 前不能继续聚合。迁移保留所有历史 receipt digest 用于防重放，但只用环境绑定且归因完整的 invocation receipt v2 重建正式指标。

## 主要实现

### 1. Workbench metrics snapshot v2

snapshot v2 新增：

- `receiptCompatibilityPolicy: "environment-bound-v2"`；
- `excludedReceiptCount`；
- 新的不变量：`版本指标中的 receiptCount + excludedReceiptCount = retainedReceiptCount + 热 receipt digest 数量`。

v1 与 v2 使用各自 schema domain 重新计算 snapshot digest。v1 保持可验证、可加载，但 aggregator 读取到非空或空的 v1 snapshot 都会在读取新 delta 前返回 `CC_WORKBENCH_METRICS_COMPATIBILITY_BACKFILL_REQUIRED`，避免旧聚合结果被静默延续。

Skill outcome index 对非空 snapshot 只接受完成 backfill 的 v2；即使旧 v1 自称 `outcomeHistoryComplete: true` 也不能恢复为实时检索分数。无任何历史回执的空 v1 仍可作为空结果读取。

### 2. 认证历史 backfill

backfiller 对旧 snapshot 执行两次不同用途的重算：

1. 使用全部 v1/v2 回执重算旧版 totals，确认完整历史与旧 snapshot 一致；
2. 只使用满足 `environment-bound-v2` 的回执构建新 v2 `versions`。

历史中的 v1 或不完整 v2 不会删除：其 digest 继续留在 hot/retained 集合中参与容量、CAS 和防重放，只是不再贡献成功率、成本、token 或 outcome 计数。retained digest 仍须由 durability query 逐项确认，迁移提交后还要从 authority 回读精确 snapshot digest。

### 3. 三类重开验证

- CLI JSONL：向真实临时 transcript 写入 current v2、stale v2 和 v1，重置模块并重新注册 anti-rollback anchor 后回读；三条历史均保持可验证，但 current policy 只统计匹配环境的 v2。
- Workbench Ledger/artifact：将 v1 receipt 放入 retained 集，将 v1 snapshot 与完整混合历史交给重建后的 adapter；backfill 后 snapshot v2 保留两条 digest，只统计合格 v2，并记录一条 excluded。
- Desktop SQLite：向真实临时 `better-sqlite3` 文件写入 current v2、stale v2 和 v1，关闭并以只读连接重开；Desktop outcome authority v2 仍只输出一个 current 样本。

## 负例覆盖

本批新增或调整以下验证：

1. snapshot v2 缺少兼容策略、排除计数不合法或总数不守恒时拒绝；
2. snapshot v1 可验证但不能直接继续 aggregate；
3. backfill 历史无法复算旧 totals、缺少 retained receipt 或 digest 不一致时拒绝；
4. 非空 v1 snapshot 即使声明 outcome history 完整，也不能进入 Skill outcome index；
5. v1 receipt 可被落盘、重开和验证，但迁移后只增加 `excludedReceiptCount`；
6. 被排除 receipt 的 digest 仍保留，重复出现仍触发 replay 防护；
7. 混合 v1/v2 历史迁移后只由合格 v2 形成 outcome 指标；
8. JSONL anti-rollback、Ledger/artifact durability 与 SQLite 文件重开均未把旧资格恢复出来。

## 验证结果

```text
CLI      Test Files  8 passed (8)   Tests  84 passed (84)
Desktop  Test Files  4 passed (4)   Tests  101 passed (101)
Total    Test Files  12 passed      Tests  185 passed
```

## 仍未完成

- 尚未在生产数据副本执行正式迁移，也未覆盖迁移中途断电、进程崩溃、磁盘写满和多个旧/新进程滚动并存；
- Workbench backfill 依赖完整、认证、耐久的历史提供方，生产 authority 与 operator 运维流程尚未装配；
- 生产管理 deployment 仍需用真实环境变化证明旧 release 被阻断、受信复评后恢复；
- 撤销或回滚后的 release 仍需在真实检索、缓存和多进程重启路径证明不能被召回。
