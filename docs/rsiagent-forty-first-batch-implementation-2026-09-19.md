# 第四十一次工程实施：调用回执跨版本消费与环境失效门禁

日期：2026-09-19

## 本批结论

本批继续收敛 G07，补齐 Skill invocation receipt 的跨版本消费契约。v1 回执仍可完成结构、摘要校验并用于历史回读，但不再能以自身的旧 `attributionEligible: true` 进入实时结果指标；v2 只有完整绑定 `environmentDigest` 时才具备环境归因资格，消费端提供当前环境摘要后还必须精确匹配。

这是一项仓内协议与消费者回归，不等同于生产环境变化复评、撤销/回滚演练或混合历史存储恢复已经完成。

## 主要实现

### 1. session-core 单一兼容策略

`skill-invocation-receipt` 新增三档消费用途：

- `historical-read`：v1/v2 均可读，但仍须通过各自版本的结构与摘要校验；
- `environment-bound-attribution`：只接受归因字段完整且带有效环境摘要的 v2；
- `current-environment-evidence`：在上一档基础上，要求调用方提供当前环境摘要并与回执精确相等。

兼容检查会给出 `legacy-unbound`、`missing`、`bound-unchecked`、`current` 或 `stale` 状态。旧版、缺失归因、缺少当前环境和环境过期分别使用稳定错误码失败关闭。options 的 proxy、accessor 和未知字段也会在读取不受信值前拒绝。

### 2. CLI 结果与 Workbench 消费端

CLI transcript outcome authority 升级为 v2，并按统一兼容策略聚合：

- v1 继续留在认证 transcript 中，但不计入归因样本或成功率；
- 不完整 v2 不计入；
- 配置 `expectedEnvironmentDigest` 后，环境不同的 v2 记为 stale 且不影响实时 Skill 检索排序；
- evidence 分别报告 legacy-unbound、stale 和 incomplete 数量，并把 `bound/current` 策略纳入 source digest。

Evolution Workbench metrics 的增量聚合与历史 backfill 同样要求环境绑定的 v2，避免旧 v1 在 trace projection 已标记不完整后仍通过旧布尔字段进入正式指标。

### 3. Desktop 结果消费端

Desktop 本地数据库 outcome authority 同步升级为 v2 并使用同一兼容判断。路由 adapter 会把宿主配置的 `expectedEnvironmentDigest` 传入 authority；`skills:route` 可通过主进程私有的 `skillRoutingEnvironmentDigest` 配置该边界。v1 和 stale v2 仍可在数据库中保留和校验，但不会参与实时路由分数。VS Code 结果消费者同时接受旧 outcome authority v1 与新 v2，并对 v2 分类计数做一致性校验。

## 兼容矩阵

| 回执与环境状态             | 历史读取 | 环境归因 | 当前环境证据/实时结果指标 |
| -------------------------- | -------- | -------- | ------------------------- |
| v1，摘要有效               | 允许     | 拒绝     | 拒绝                      |
| v2，归因或环境摘要不完整   | 允许     | 拒绝     | 拒绝                      |
| v2，环境已绑定但未提供现态 | 允许     | 允许     | 拒绝                      |
| v2，与当前环境摘要不一致   | 允许     | 允许     | 拒绝并标记 stale          |
| v2，与当前环境摘要精确一致 | 允许     | 允许     | 允许                      |

## 负例覆盖

本批新增或扩展以下验证：

1. v1 可读，但用于环境归因时返回 `CC_SKILL_INVOCATION_RECEIPT_LEGACY_UNBOUND`；
2. v2 缺少环境摘要时不能作为环境绑定证据；
3. 当前环境用途未提供期望摘要时失败关闭；
4. 环境摘要变化后旧 v2 返回 `CC_SKILL_INVOCATION_RECEIPT_ENVIRONMENT_STALE`；
5. 匹配环境的完整 v2 保持可用；
6. CLI transcript、Workbench metrics 和 Desktop DB 聚合均不再把 v1 当成合格样本；
7. CLI/Desktop 在 current policy 下只统计匹配环境，stale 与 legacy 数量可审阅；
8. Desktop 路由 adapter 将宿主环境摘要原样传给数据库 authority；
9. 兼容 options 的 accessor/proxy 不会被执行。

## 验证结果

```text
session-core  Test Files  1 passed (1)   Tests  9 passed (9)
CLI           Test Files  8 passed (8)   Tests  82 passed (82)
Desktop       Test Files  4 passed (4)   Tests  100 passed (100)
VS Code       Test Files  1 passed (1)   Tests  9 passed (9)
Total         Test Files  14 passed      Tests  200 passed
```

相关 JavaScript 文件通过 ESLint（0 errors；保留 `skills-ipc.js` 1 个既有 unused-variable warning），全部本批文件通过 Prettier 与 `git diff --check`。

## 仍未完成

- 生产管理 deployment 尚未提供实际环境摘要并执行“旧 release 阻断 → 受信复评 → 恢复”的真实演练；
- 撤销或回滚后的 release 仍需在真实检索、缓存和多进程重启路径证明不能被召回；
- 已持久化的 v1/v2 混合 transcript、Workbench snapshot 与 Desktop 数据库尚未进行断电、重开和迁移恢复演练；
- 当前变更不修改历史回执，也不把 v1 补造为 v2；旧证据只能保持历史可读。
