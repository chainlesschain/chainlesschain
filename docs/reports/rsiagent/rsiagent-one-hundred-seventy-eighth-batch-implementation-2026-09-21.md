# 第一百七十八次工程实施：模型预算 IPC 身份绑定与输入边界

## 本批目标

关闭模型预算读取、设置和删除三个 IPC 入口未验证 renderer、DID tenant 与用途授权，且接受 renderer 自报 `userId` 作为数据库作用域、直接展开任意配置对象的缺口。

## 实施结果

- 三个入口在任何数据库访问前统一复用 LLM Core authorization，校验实际 Desktop 主窗口/main frame，从主进程当前 identity 绑定 actor DID/tenant，并按预算读取、写入和删除用途取得明确授权。
- 数据库 `user_id` 只使用 authorization 返回的当前 actor DID。读取不再接受 renderer 参数；设置和删除不再接受 `userId`，跨身份字符串及其他未声明字段不能影响查询、upsert 或 delete 的作用域。
- 设置输入只接受 provider、model、三类 USD 限额和三个布尔开关；对象必须是 plain、non-Proxy 的可枚举自有数据字段。provider/model 受长度、空白和控制字符约束，金额必须是 0 至 10 亿之间的有限数值，布尔值拒绝隐式转换。
- 删除输入只接受 provider/model；未知字段、Symbol、accessor、Proxy、缺失标识、无限值和错误类型均在 SQL prepare 前失败关闭。
- upsert 主键改用 `crypto.randomUUID()`；设置和删除只返回共享冻结 success 回执。读取继续通过模型预算字段白名单投影，不返回数据库 ID、user_id、时间戳或扩展列。
- 三个操作的 purpose 与允许字段集进入统一 authorization 映射；缺失授权组件时预算模块注册失败关闭。

## 回归与门禁

- 模型预算 authorization、输入、actor 作用域、记录投影、聚合隐私与注册定向回归：5 test files、68 tests passed。
- 完整主 LLM 回归：43 test files、608 tests passed、15 skipped。
- 相关 ESLint：0 errors、0 warnings。
- Desktop 主进程构建通过；`git diff --check` 通过。

## 未完成边界

- 历史 `user_id = 'default'` 预算行不会自动归入任意新 actor；需要目标环境依据认证身份制定一次性迁移或明确废弃策略，不能在运行时无鉴别回退读取。
- 本批未执行真实 Electron renderer/preload 与 SQLite 用户目录 E2E，也未验证身份切换时预算面板缓存立即失效。
- Retention 与 Alert 辅助 IPC 后续已分别由第一百七十九、第一百八十批完成 actor DID/tenant/用途授权与输入收口；生产 purpose authority/企业组织 RBAC、token 辅助 IPC 授权、tenant HMAC 和耐久审计仍待处理。
