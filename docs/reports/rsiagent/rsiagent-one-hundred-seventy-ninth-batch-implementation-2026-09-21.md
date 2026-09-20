# 第一百七十九次工程实施：数据保留 IPC 身份作用域与安全清理

## 本批目标

关闭 LLM 数据保留配置读取、设置和手动清理三个 IPC 入口未验证 renderer、DID tenant 与用途授权，接受 renderer 自报 `userId` 作为数据库作用域，并允许任一身份从无 owner 列的全局缓存表删除数据的缺口。

## 实施结果

- 三个入口在任何数据库访问前统一复用 LLM Core authorization，校验实际 Desktop 主窗口/main frame，从主进程当前 identity 绑定 actor DID/tenant，并按配置读取、配置写入和保留数据删除用途取得明确授权。
- 配置查询、upsert、usage log 清理、alert history 清理和最后清理时间更新只使用 authorization 返回的 actor DID。读取和清理不再接受 renderer 参数，设置不再接受 `userId`。
- 设置输入只接受三类保留天数和自动清理布尔开关；对象必须是 plain、non-Proxy 的可枚举自有数据字段。天数限制为 0 至 3650 的安全整数，未知字段、Symbol、accessor、Proxy 与错误类型在 SQL prepare 前失败关闭。
- 配置写入由可能静默无效的单行 UPDATE 改为 actor 作用域 UPSERT，新身份可以创建自己的配置行；主键使用 `crypto.randomUUID()`，设置和清理只返回共享冻结 success 回执。
- 手动清理在同一 SQLite 事务中读取并校验当前 actor 配置、删除其 usage/alert 行并更新清理时间，任一步失败都会整体回滚。
- `llm_cache` 当前没有 actor 或 tenant 所有权列，因此该身份作用域入口不再删除全局缓存；`cacheRetentionDays` 继续保存，待 schema 和 cache key 具备认证 owner 后再执行清理。
- 三个操作的 purpose 与允许字段集进入统一 authorization 映射；缺失授权组件时 retention 模块注册失败关闭。

## 回归与门禁

- Retention authorization、输入、actor 作用域、事务清理、记录投影、聚合隐私与注册定向回归：5 test files、68 tests passed。
- 完整主 LLM 回归：44 test files、611 tests passed、15 skipped。
- 相关 ESLint：0 errors、0 warnings。
- Desktop 主进程构建通过；`git diff --check` 通过。

## 未完成边界

- 历史 `user_id = 'default'` retention 行不会自动归入任意新 actor；需要目标环境依据认证身份制定迁移或明确废弃策略。
- 全局 `llm_cache` 的 tenant/actor schema、既有行认证迁移和安全的分区清理尚未实现；当前 per-actor 清理会保留这些缓存行。
- Alert 辅助 IPC 后续已由第一百八十批完成 actor DID/tenant/用途授权和输入收口；本批未执行真实 Electron renderer/preload 与 SQLite 用户目录 E2E，生产 purpose authority/企业组织 RBAC、token 辅助 IPC 授权、tenant HMAC 和耐久审计仍待处理。
